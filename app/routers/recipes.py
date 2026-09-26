from datetime import date, timedelta

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile,
    WebSocket, WebSocketDisconnect, status,
)
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session, joinedload, selectinload

from app.config import settings
from app.database import SessionLocal, get_db
from app.grocery_ops import DEFAULT_CATEGORY_NAME, add_or_merge_item
from app.deps import get_current_user
from app.ingredients import normalize, parse_ingredient_line, resolve, scaled_amount
from app.list_access import get_visible_list, is_list_visible, visible_lists_query
from app.models import (
    LEFTOVER_RATINGS,
    SCALE_OPTIONS,
    GroceryCategory,
    GroceryList,
    MealPlanEntry,
    PantryItem,
    Recipe,
    RecipeImage,
    RecipeIngredient,
    RecipeStep,
    RecipeTagName,
    User,
)
from app.meal_plan import (
    delete_entry,
    entries_for_week,
    normalize_slot,
    sync_event_for,
    week_grid,
    week_shopping_lines,
    week_start,
)
from app.ingredient_review import list_items_by_ingredient, needs_review, suggest_match
from app.recipe_match import ingredient_key_map, match_recipe, on_hand, rank_recipes
from app.recipe_import import (
    RecipeImportError,
    draft_to_lines,
    extract_from_images,
    extract_from_text,
    extract_from_url,
    stash_scans,
    take_scans,
)
from app.schemas import (
    RecipeCreate,
    RecipeDraftOut,
    MealPlanEntryCreate,
    MealPlanEntryOut,
    RecipeMatchOut,
    RecipeOut,
    RecipeSummaryOut,
    RecipeUpdate,
    ToGroceryRequest,
    ToGroceryResult,
    ToGroceryRowOut,
)
from app.security import decode_access_token
from app.templating import templates
from app.routers.grocery import render_category as render_grocery_category
from app.routers.grocery import render_item_datalist as render_grocery_datalist
from app.ws_manager import grocery_manager, recipe_manager

router = APIRouter()

# Sent to anyone with the detail page open when the recipe is deleted out from under
# them: the body becomes a tombstone and the Edit/Delete toolbar is emptied, so nobody
# is left clicking buttons that now 404.
DELETED_TOMBSTONE = (
    '<article id="recipe-body" hx-swap-oob="outerHTML">'
    '<p class="empty">This recipe was deleted.</p>'
    '<p><a href="/recipes">Back to recipes</a></p></article>'
    '<div id="recipe-toolbar" hx-swap-oob="innerHTML"></div>'
)


def render_recipe_detail(recipe: Recipe, oob_mode: str = "none") -> str:
    template = templates.get_template("_recipe_detail.html")
    return template.render(recipe=recipe, oob_mode=oob_mode)


def visible_recipes_query(db: Session, user: User) -> Query:
    """Same rule as app.list_access.visible_lists_query, written out because that helper
    orders by `model.name` and a Recipe has a `title`."""
    return (
        db.query(Recipe)
        .filter(or_(Recipe.is_public.is_(True), Recipe.owner_id == user.id))
        .order_by(func.lower(Recipe.title))
    )


def get_visible_recipe(db: Session, recipe_id: int, user: User) -> Recipe:
    recipe = db.get(Recipe, recipe_id)
    # 404 rather than 403 for a recipe you can't see, matching the lists convention:
    # a private recipe shouldn't even confirm it exists.
    if recipe is None or not is_list_visible(recipe, user):
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


def search_recipes(db: Session, user: User, q: str | None = None, tag: str | None = None) -> list[Recipe]:
    # `tag` is only used by apps older than 1.8.4; nothing sets tags any more.
    query = visible_recipes_query(db, user).options(
        joinedload(Recipe.owner), selectinload(Recipe.tags)
    )
    if q:
        needle = f"%{q.strip().lower()}%"
        # Match the title, or any ingredient in the recipe — "what do I do with celery?"
        # is at least as common a question as searching by name.
        matching_ids = (
            db.query(RecipeIngredient.recipe_id)
            .filter(func.lower(RecipeIngredient.name).like(needle))
            .distinct()
        )
        query = query.filter(
            or_(func.lower(Recipe.title).like(needle), Recipe.id.in_(matching_ids))
        )
    if tag:
        tag_key = normalize(tag)
        query = query.filter(Recipe.tags.any(RecipeTagName.norm_key == tag_key))
    return query.all()


def split_lines(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [" ".join(line.split()) for line in raw.splitlines() if line.strip()]


def apply_ingredient_lines(db: Session, recipe: Recipe, lines: list[str]) -> None:
    """Replace a recipe's ingredients from written lines.

    Each line is parsed for quantity/unit/name and resolved to a canonical Ingredient
    (creating one when it's a name we've never seen), which is what later lets the
    pantry answer "can I make this tonight?".
    """
    recipe.ingredients.clear()
    db.flush()
    for index, line in enumerate(lines):
        parsed = parse_ingredient_line(line)
        ingredient = resolve(db, parsed["name"], create=True)
        recipe.ingredients.append(
            RecipeIngredient(
                raw_text=parsed["raw_text"],
                quantity=parsed["quantity"],
                unit=parsed["unit"],
                name=parsed["name"],
                prep_note=parsed["prep_note"],
                optional=parsed["optional"],
                ingredient_id=ingredient.id if ingredient else None,
                sort_order=index * 10,
            )
        )


def apply_step_lines(recipe: Recipe, lines: list[str]) -> None:
    recipe.steps.clear()
    for index, text in enumerate(lines, start=1):
        recipe.steps.append(RecipeStep(step_number=index, text=text))


def attach_scans(recipe: Recipe, scan_token: str | None) -> None:
    """Move photos held from the import step onto the saved recipe.

    take_scans consumes the token, so re-submitting the review form can't attach the
    same photos twice, and an expired or already-used token is simply a no-op — the
    recipe still saves, just without its scans.
    """
    for index, (data, content_type) in enumerate(take_scans(scan_token)):
        recipe.images.append(
            RecipeImage(data=data, content_type=content_type, sort_order=index * 10)
        )


def load_recipe_full(db: Session, recipe_id: int, user: User) -> Recipe:
    """Detail view with the relationships eager-loaded, so rendering doesn't fire a
    query per ingredient row.

    Collections use selectinload rather than joinedload: joining four of them in one
    query multiplies the rows together (ingredients x steps x images x tags) for no
    benefit. RecipeImage.data in particular is deliberately left out of that explosion —
    it's loaded here only because the detail page lists the scans, and image bytes are
    served by their own endpoint.
    """
    recipe = get_visible_recipe(db, recipe_id, user)
    return (
        db.query(Recipe)
        .options(
            joinedload(Recipe.owner),
            selectinload(Recipe.tags),
            selectinload(Recipe.steps),
            selectinload(Recipe.images),
            selectinload(Recipe.ingredients).joinedload(RecipeIngredient.ingredient),
        )
        .filter(Recipe.id == recipe.id)
        .one()
    )


# ── Web pages ───────────────────────────────────────────────────────────────────


@router.get("/recipes", response_class=HTMLResponse)
def recipes_page(
    request: Request,
    q: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/recipes"
    recipes = search_recipes(db, current_user, q=q)
    return templates.TemplateResponse(
        request,
        "recipes.html",
        {"recipes": recipes, "q": q or "", "current_user": current_user},
    )


@router.get("/recipes/new", response_class=HTMLResponse)
def recipe_new_page(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        request,
        "recipe_form.html",
        {
            "recipe": None,
            "draft": None,
            "ingredient_text": "",
            "step_text": "",
            "leftover_ratings": LEFTOVER_RATINGS,
            "draft_source_url": "",
            "draft_source_name": "",
            "draft_image_url": "",
            "scan_token": "",
            "current_user": current_user,
        },
    )


@router.post("/recipes")
def recipe_create(
    title: str = Form(...),
    servings: str = Form(""),
    prep_minutes: str = Form(""),
    cook_minutes: str = Form(""),
    ingredients: str = Form(""),
    steps: str = Form(""),
    notes: str = Form(""),
    leftover_rating: str = Form(""),
    leftover_notes: str = Form(""),
    source_url: str = Form(""),
    source_name: str = Form(""),
    image_url: str = Form(""),
    scan_token: str = Form(""),
    source_type: str = Form(""),
    is_public: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = Recipe(
        title=title.strip()[:300],
        servings=_parse_int(servings),
        prep_minutes=_parse_int(prep_minutes),
        cook_minutes=_parse_int(cook_minutes),
        notes=notes.strip() or None,
        leftover_rating=_parse_rating(leftover_rating),
        leftover_notes=leftover_notes.strip() or None,
        source_type=(source_type.strip() or ("url" if source_url.strip() else "manual"))[:20],
        source_url=source_url.strip()[:1000] or None,
        source_name=source_name.strip()[:200] or None,
        image_url=image_url.strip()[:1000] or None,
        owner_id=current_user.id,
        is_public=is_public,
    )
    db.add(recipe)
    db.flush()
    apply_ingredient_lines(db, recipe, split_lines(ingredients))
    apply_step_lines(recipe, split_lines(steps))
    attach_scans(recipe, scan_token.strip() or None)
    db.commit()
    return RedirectResponse(url=f"/recipes/{recipe.id}", status_code=status.HTTP_302_FOUND)


# ── Import (Link / Photo / Paste) ───────────────────────────────────────────────


def _render_review(request: Request, current_user: User, draft, *, source_url="", source_name="", image_url="", scan_token=""):
    """Show an extracted draft in the ordinary edit form.

    The review step reuses recipe_form.html rather than having its own screen: what you
    get back is a normal recipe form with the fields filled in, so correcting the model
    uses exactly the same controls as writing a recipe by hand.
    """
    ingredient_text, step_text = draft_to_lines(draft)
    return templates.TemplateResponse(
        request,
        "recipe_form.html",
        {
            "recipe": None,
            "draft": draft,
            "ingredient_text": ingredient_text,
            "step_text": step_text,
            "leftover_ratings": LEFTOVER_RATINGS,
            "draft_source_url": source_url or "",
            "draft_source_name": source_name or "",
            "draft_image_url": image_url or "",
            "scan_token": scan_token or "",
            "current_user": current_user,
        },
    )


@router.get("/recipes/import", response_class=HTMLResponse)
def recipe_import_page(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        request,
        "recipe_import.html",
        {"current_user": current_user, "import_enabled": settings.recipe_import_enabled, "error": None},
    )


@router.post("/recipes/import", response_class=HTMLResponse)
async def recipe_import(
    request: Request,
    mode: str = Form("url"),
    url: str = Form(""),
    text: str = Form(""),
    photos: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_user),
):
    """Extract a draft and hand back the review form. Nothing is saved here."""
    try:
        if mode == "url":
            if not url.strip():
                raise RecipeImportError("Paste a link first.")
            draft, site_name, image_url = await extract_from_url(url.strip())
            return _render_review(
                request, current_user, draft,
                source_url=url.strip(), source_name=site_name, image_url=image_url,
            )

        if mode == "photo":
            blobs = []
            for upload in photos:
                if not upload or not upload.filename:
                    continue
                blobs.append(await upload.read())
            if not blobs:
                raise RecipeImportError("Choose at least one photo.")
            draft, prepared = await extract_from_images(blobs)
            return _render_review(request, current_user, draft, scan_token=stash_scans(prepared) or "")

        draft = await extract_from_text(text)
        return _render_review(request, current_user, draft, source_name="Pasted")

    except RecipeImportError as exc:
        # Re-render the import page with the message and whatever they typed, so a
        # blocked Facebook link doesn't cost them the URL they pasted.
        return templates.TemplateResponse(
            request,
            "recipe_import.html",
            {
                "current_user": current_user,
                "import_enabled": settings.recipe_import_enabled,
                "error": str(exc),
                "mode": mode,
                "url": url,
                "text": text,
            },
            status_code=400,
        )


@router.post("/api/recipes/import", response_model=RecipeDraftOut)
async def api_recipe_import(
    mode: str = Form("url"),
    url: str = Form(""),
    text: str = Form(""),
    photos: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_user),
):
    """Mobile's import. Returns the draft plus a scan_token to pass to POST /api/recipes."""
    try:
        if mode == "url":
            if not url.strip():
                raise RecipeImportError("Paste a link first.")
            draft, site_name, image_url = await extract_from_url(url.strip())
            return RecipeDraftOut(
                **draft.model_dump(), source_url=url.strip(), source_name=site_name,
                image_url=image_url, scan_token=None,
            )
        if mode == "photo":
            blobs = [await upload.read() for upload in photos if upload and upload.filename]
            if not blobs:
                raise RecipeImportError("Choose at least one photo.")
            draft, prepared = await extract_from_images(blobs)
            return RecipeDraftOut(**draft.model_dump(), scan_token=stash_scans(prepared))
        draft = await extract_from_text(text)
        return RecipeDraftOut(**draft.model_dump(), source_name="Pasted")
    except RecipeImportError as exc:
        # 422 rather than 500: the request was understood, the source just wasn't usable.
        raise HTTPException(status_code=422, detail=str(exc)) from None


# ── What can I cook tonight? ────────────────────────────────────────────────────


@router.get("/recipes/cook-now", response_class=HTMLResponse)
def cook_now_page(
    request: Request,
    max_missing: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/recipes/cook-now"
    matches, available = rank_recipes(db, current_user, max_missing=max_missing)
    buckets = {
        "ready": [m for m in matches if m.bucket == "ready"],
        "one": [m for m in matches if m.bucket == "one"],
        "several": [m for m in matches if m.bucket == "several"],
    }
    pantry_count = db.query(PantryItem).count()
    return templates.TemplateResponse(
        request,
        "cook_now.html",
        {
            "buckets": buckets,
            "total": len(matches),
            "on_hand_count": len(available.ids),
            "pantry_count": pantry_count,
            "max_missing": max_missing,
            "lists": visible_lists_query(db, GroceryList, current_user).all(),
            "current_user": current_user,
        },
    )


@router.post("/recipes/{recipe_id}/missing-to-grocery")
async def recipe_missing_to_grocery(
    recipe_id: int,
    list_id: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One-tap: put just the ingredients you're short of onto a list.

    Shares the same push path as the full recipe, so amounts still combine with anything
    already there and categories are still created on demand.
    """
    recipe = load_recipe_full(db, recipe_id, current_user)
    match = match_recipe(recipe, on_hand(db))
    shortfall_ids = [item.id for item in match.missing + match.unknown]
    if shortfall_ids:
        await _push_to_grocery(db, recipe, list_id, shortfall_ids, 1.0, current_user)
    return RedirectResponse(url=f"/grocery/lists/{list_id}", status_code=status.HTTP_302_FOUND)


@router.get("/api/recipes/cook-now", response_model=list[RecipeMatchOut])
def api_cook_now(
    max_missing: int | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    matches, _ = rank_recipes(db, current_user, max_missing=max_missing, q=q)
    return [
        RecipeMatchOut(
            recipe=m.recipe,
            have=m.have,
            missing=m.missing,
            unknown=m.unknown,
            optional_missing=m.optional_missing,
            shortfall=m.shortfall,
            can_make=m.can_make,
            bucket=m.bucket,
        )
        for m in matches
    ]


# ── Meal planning ───────────────────────────────────────────────────────────────


@router.get("/recipes/plan", response_class=HTMLResponse)
def meal_plan_page(
    request: Request,
    start: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/recipes/plan"
    try:
        anchor = date.fromisoformat(start) if start else date.today()
    except ValueError:
        anchor = date.today()
    monday = week_start(anchor)
    entries = entries_for_week(db, monday)
    return templates.TemplateResponse(
        request,
        "meal_plan.html",
        {
            "week_start": monday,
            "prev_week": monday - timedelta(days=7),
            "next_week": monday + timedelta(days=7),
            "today": date.today(),
            "days": week_grid(entries, monday),
            "entry_count": len(entries),
            "recipes": visible_recipes_query(db, current_user).all(),
            "lists": visible_lists_query(db, GroceryList, current_user).all(),
            "shopping": week_shopping_lines(entries),
            "current_user": current_user,
        },
    )


@router.post("/recipes/plan/entries")
def meal_plan_add(
    recipe_id: int = Form(...),
    day: str = Form(...),
    meal_slot: str = Form("dinner"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, recipe_id, current_user)
    try:
        planned = date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date") from None

    entry = MealPlanEntry(
        recipe_id=recipe.id,
        date=planned,
        meal_slot=normalize_slot(meal_slot),
        added_by_id=current_user.id,
    )
    db.add(entry)
    db.flush()
    sync_event_for(db, entry, recipe, current_user)
    db.commit()
    return RedirectResponse(
        url=f"/recipes/plan?start={week_start(planned).isoformat()}",
        status_code=status.HTTP_302_FOUND,
    )


@router.post("/recipes/plan/entries/{entry_id}/delete")
def meal_plan_remove(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(MealPlanEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Planned meal not found")
    monday = week_start(entry.date)
    delete_entry(db, entry)
    db.commit()
    return RedirectResponse(
        url=f"/recipes/plan?start={monday.isoformat()}", status_code=status.HTTP_302_FOUND
    )


@router.post("/recipes/plan/shopping")
async def meal_plan_shopping(
    list_id: int = Form(...),
    start: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Put the whole week of ingredients onto one list.

    Goes through the same add_or_merge_item as a single recipe push, so amounts combine
    with whatever is already there and categories are still created on demand.
    """
    get_visible_list(db, GroceryList, list_id, current_user)
    try:
        monday = week_start(date.fromisoformat(start))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid week") from None

    entries = entries_for_week(db, monday)
    touched: set[int] = set()
    key_map = ingredient_key_map(db)
    for row in week_shopping_lines(entries):
        item, _ = add_or_merge_item(
            db, list_id,
            name=row["name"], quantity=None, category_name=row["category"],
            user_id=current_user.id, ingredient_id=row["ingredient_id"], key_map=key_map,
        )
        touched.add(item.category_id)

    if touched:
        html = "".join(
            render_grocery_category(db.get(GroceryCategory, cid), oob_mode="replace")
            for cid in touched
            if db.get(GroceryCategory, cid) is not None
        ) + render_grocery_datalist(db, list_id)
        await grocery_manager.broadcast(list_id, html)

    return RedirectResponse(url=f"/grocery/lists/{list_id}", status_code=status.HTTP_302_FOUND)


@router.get("/api/recipes/plan", response_model=list[MealPlanEntryOut])
def api_meal_plan(
    start: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        anchor = date.fromisoformat(start) if start else date.today()
    except ValueError:
        anchor = date.today()
    return entries_for_week(db, week_start(anchor))


@router.post("/api/recipes/plan", response_model=MealPlanEntryOut)
def api_meal_plan_add(
    payload: MealPlanEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, payload.recipe_id, current_user)
    entry = MealPlanEntry(
        recipe_id=recipe.id,
        date=payload.date,
        meal_slot=normalize_slot(payload.meal_slot),
        added_by_id=current_user.id,
    )
    db.add(entry)
    db.flush()
    sync_event_for(db, entry, recipe, current_user)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/api/recipes/plan/{entry_id}", status_code=204)
def api_meal_plan_remove(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(MealPlanEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Planned meal not found")
    delete_entry(db, entry)
    db.commit()
    return Response(status_code=204)


@router.get("/recipes/{recipe_id}", response_class=HTMLResponse)
def recipe_detail_page(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = load_recipe_full(db, recipe_id, current_user)
    request.session["last_page"] = f"/recipes/{recipe_id}"
    return templates.TemplateResponse(
        request,
        "recipe_detail.html",
        {"recipe": recipe, "current_user": current_user},
    )


@router.get("/recipes/{recipe_id}/cook", response_class=HTMLResponse)
def recipe_cook_page(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cook mode: one screen, big text, screen stays awake.

    Deliberately not inside the live-updating detail page — someone editing the recipe
    while you're halfway through cooking it shouldn't move the step you're reading.
    """
    recipe = load_recipe_full(db, recipe_id, current_user)
    return templates.TemplateResponse(
        request,
        "recipe_cook.html",
        {"recipe": recipe, "scales": SCALE_OPTIONS, "current_user": current_user},
    )


@router.get("/recipes/{recipe_id}/print", response_class=HTMLResponse)
def recipe_print_page(
    recipe_id: int,
    request: Request,
    scale: str = "1.0",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A paper version: no navigation, no live updates, no controls on the page itself.

    Scaling is a query parameter rather than cook mode's client-side toggle, because what
    comes out of the printer has to be what the server rendered — a sheet of paper can't
    re-scale itself, and "print what you see" is the only rule that survives contact with
    a browser's print preview. Anything unrecognised falls back to 1x rather than
    erroring: this is a page you reach mid-cook, not an API.
    """
    recipe = load_recipe_full(db, recipe_id, current_user)
    # Taken as text and parsed here rather than declared `float`, so a hand-edited URL
    # lands on the 1x page instead of a 422.
    try:
        chosen = float(scale)
    except ValueError:
        chosen = 1.0
    if chosen not in SCALE_OPTIONS:
        chosen = 1.0
    # Deliberately no `request.session["last_page"]`: being returned to a print view on
    # your next login would be strange.
    return templates.TemplateResponse(
        request,
        "recipe_print.html",
        {
            "recipe": recipe,
            "scale": chosen,
            # The RecipeIngredient.scaled_amounts dict is keyed by str(scale).
            "scale_key": str(chosen),
            "scales": SCALE_OPTIONS,
            "printed_on": date.today(),
            "current_user": current_user,
        },
    )


@router.get("/recipes/{recipe_id}/edit", response_class=HTMLResponse)
def recipe_edit_page(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = load_recipe_full(db, recipe_id, current_user)
    return templates.TemplateResponse(
        request,
        "recipe_form.html",
        {
            "recipe": recipe,
            "draft": None,
            "ingredient_text": "\n".join(i.raw_text for i in recipe.ingredients),
            "step_text": "\n".join(s.text for s in recipe.steps),
            "leftover_ratings": LEFTOVER_RATINGS,
            "current_user": current_user,
        },
    )


@router.post("/recipes/{recipe_id}/edit")
async def recipe_update(
    recipe_id: int,
    title: str = Form(...),
    servings: str = Form(""),
    prep_minutes: str = Form(""),
    cook_minutes: str = Form(""),
    ingredients: str = Form(""),
    steps: str = Form(""),
    notes: str = Form(""),
    leftover_rating: str = Form(""),
    leftover_notes: str = Form(""),
    source_url: str = Form(""),
    source_name: str = Form(""),
    is_public: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, recipe_id, current_user)
    recipe.title = title.strip()[:300]
    recipe.servings = _parse_int(servings)
    recipe.prep_minutes = _parse_int(prep_minutes)
    recipe.cook_minutes = _parse_int(cook_minutes)
    recipe.notes = notes.strip() or None
    recipe.leftover_rating = _parse_rating(leftover_rating)
    recipe.leftover_notes = leftover_notes.strip() or None
    recipe.source_url = source_url.strip()[:1000] or None
    recipe.source_name = source_name.strip()[:200] or None
    recipe.is_public = is_public
    apply_ingredient_lines(db, recipe, split_lines(ingredients))
    apply_step_lines(recipe, split_lines(steps))
    db.commit()

    fresh = load_recipe_full(db, recipe_id, current_user)
    await recipe_manager.broadcast(recipe_id, render_recipe_detail(fresh, oob_mode="replace"))
    return RedirectResponse(url=f"/recipes/{recipe_id}", status_code=status.HTTP_302_FOUND)


@router.post("/recipes/{recipe_id}/delete", response_class=HTMLResponse)
async def recipe_delete(
    recipe_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, recipe_id, current_user)
    if recipe.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this recipe")
    db.delete(recipe)
    db.commit()
    await recipe_manager.broadcast(recipe_id, DELETED_TOMBSTONE)
    return HTMLResponse("")


@router.get("/recipes/{recipe_id}/images/{image_id}")
def recipe_image(
    recipe_id: int,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    get_visible_recipe(db, recipe_id, current_user)
    image = db.get(RecipeImage, image_id)
    if image is None or image.recipe_id != recipe_id:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(
        content=image.data,
        media_type=image.content_type,
        # Image bytes never change once stored — a new scan is a new row.
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


def _parse_rating(value: str | None) -> int | None:
    rating = _parse_int(value)
    return rating if rating in LEFTOVER_RATINGS else None


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        parsed = int(text)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


# ── Recipe -> grocery list ──────────────────────────────────────────────────────


def _ingredient_target(item: RecipeIngredient) -> tuple[str, str | None]:
    """The name and grocery category to shop for.

    Prefers the canonical ingredient ("chicken breast") over the recipe's wording
    ("2 lbs boneless skinless chicken breasts, cubed") so two recipes calling for the
    same thing land on one line of the list. Falls back to the parsed name when the
    ingredient never resolved.
    """
    if item.ingredient is not None:
        return item.ingredient.name, item.ingredient.category
    return item.name, None


def _grocery_rows(db: Session, recipe: Recipe, list_ids: list[int]) -> list[dict]:
    """Each ingredient with what we know about it: already on a list, already in the
    kitchen, or an auto-created name that looks like one we know.

    Staples, optional extras and anything in the pantry or freezer start unticked —
    they're usually already in the kitchen, and a list padded with salt goes unread. A
    pantry entry marked "low" doesn't count as having it.
    """
    key_map = ingredient_key_map(db)
    on_lists = list_items_by_ingredient(db, list_ids, key_map)
    in_pantry = {
        ingredient_id
        for (ingredient_id,) in db.query(PantryItem.ingredient_id).filter(PantryItem.low.is_(False))
    }
    kitchen = on_hand(db)

    rows = []
    for item in recipe.ingredients:
        name, category = _ingredient_target(item)
        ingredient = item.ingredient
        have = None
        if ingredient is not None:
            if ingredient.id in in_pantry:
                have = "pantry"
            elif kitchen.sources.get(ingredient.id) == "freezer":
                have = "freezer"
        staple = bool(ingredient and ingredient.is_staple)
        rows.append({
            "item": item,
            "name": name,
            "category": category or DEFAULT_CATEGORY_NAME,
            "staple": staple,
            "have": have,
            "on_lists": {
                list_id: found[ingredient.id].name
                for list_id, found in on_lists.items()
                if ingredient is not None and ingredient.id in found
            },
            "suggestion": suggest_match(db, ingredient, key_map) if needs_review(ingredient) else None,
            "preselected": not item.optional and not staple and have is None,
        })
    return rows


def _render_to_grocery(request: Request, db: Session, recipe: Recipe, user: User, error: str | None = None):
    lists = visible_lists_query(db, GroceryList, user).all()
    return templates.TemplateResponse(
        request,
        "recipe_to_grocery.html",
        {
            "recipe": recipe, "lists": lists, "current_user": user, "error": error,
            "rows": _grocery_rows(db, recipe, [l.id for l in lists]),
        },
        status_code=400 if error else 200,
    )


@router.get("/recipes/{recipe_id}/to-grocery", response_class=HTMLResponse)
def recipe_to_grocery_page(
    recipe_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = load_recipe_full(db, recipe_id, current_user)
    return _render_to_grocery(request, db, recipe, current_user)


async def _push_to_grocery(
    db: Session,
    recipe: Recipe,
    list_id: int,
    ingredient_ids: list[int],
    scale: float,
    user: User,
) -> tuple[int, int, list[str]]:
    """Shared by the form post and the JSON API. Returns (added, merged, names)."""
    get_visible_list(db, GroceryList, list_id, user)
    wanted = set(ingredient_ids)
    added = merged = 0
    names: list[str] = []
    touched_categories: set[int] = set()
    key_map = ingredient_key_map(db)

    for item in recipe.ingredients:
        if item.id not in wanted:
            continue
        name, category = _ingredient_target(item)
        quantity = scaled_amount(item.quantity, item.unit, scale) if item.quantity is not None else None
        grocery_item, created = add_or_merge_item(
            db, list_id, name=name, quantity=quantity, category_name=category, user_id=user.id,
            ingredient_id=item.ingredient_id, key_map=key_map,
        )
        touched_categories.add(grocery_item.category_id)
        names.append(name)
        if created:
            added += 1
        else:
            merged += 1

    # Push the changed categories to anyone with that grocery list open. This is the
    # first cross-feature broadcast in the app: the recipe router writing into the
    # grocery room so a list open on the kitchen tablet updates as you add to it.
    if touched_categories:
        html = "".join(
            render_grocery_category(db.get(GroceryCategory, cid), oob_mode="replace")
            for cid in touched_categories
            if db.get(GroceryCategory, cid) is not None
        ) + render_grocery_datalist(db, list_id)
        await grocery_manager.broadcast(list_id, html)

    return added, merged, names


@router.post("/recipes/{recipe_id}/to-grocery")
async def recipe_to_grocery(
    recipe_id: int,
    request: Request,
    list_id: int = Form(...),
    ingredient_ids: list[int] = Form(default=[]),
    scale: str = Form("1"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = load_recipe_full(db, recipe_id, current_user)
    if not ingredient_ids:
        return _render_to_grocery(request, db, recipe, current_user, "Tick at least one ingredient to add.")

    await _push_to_grocery(db, recipe, list_id, ingredient_ids, _parse_scale(scale), current_user)
    return RedirectResponse(url=f"/grocery/lists/{list_id}", status_code=status.HTTP_302_FOUND)


def _parse_scale(value: str) -> float:
    try:
        scale = float(value)
    except (TypeError, ValueError):
        return 1.0
    # Guard against a hand-edited form turning one recipe into a thousand portions.
    return min(max(scale, 0.25), 20.0)


@router.get("/api/recipes/{recipe_id}/to-grocery/preview", response_model=list[ToGroceryRowOut])
def api_recipe_to_grocery_preview(
    recipe_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = load_recipe_full(db, recipe_id, current_user)
    list_ids = [l.id for l in visible_lists_query(db, GroceryList, current_user)]
    return [
        ToGroceryRowOut(
            recipe_ingredient_id=row["item"].id,
            ingredient_id=row["item"].ingredient_id,
            name=row["name"],
            raw_text=row["item"].raw_text,
            category=row["category"],
            optional=row["item"].optional,
            staple=row["staple"],
            have=row["have"],
            on_lists=row["on_lists"],
            suggestion=row["suggestion"],
            preselected=row["preselected"],
        )
        for row in _grocery_rows(db, recipe, list_ids)
    ]


@router.post("/api/recipes/{recipe_id}/to-grocery", response_model=ToGroceryResult)
async def api_recipe_to_grocery(
    recipe_id: int,
    payload: ToGroceryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = load_recipe_full(db, recipe_id, current_user)
    if not payload.ingredient_ids:
        raise HTTPException(status_code=422, detail="Select at least one ingredient")
    added, merged, names = await _push_to_grocery(
        db, recipe, payload.list_id, payload.ingredient_ids, _parse_scale(str(payload.scale)), current_user
    )
    return ToGroceryResult(added=added, merged=merged, names=names, list_id=payload.list_id)


# ── WebSocket ───────────────────────────────────────────────────────────────────


def _authenticate_ws_user(db: Session, session_user_id, token: str | None) -> User | None:
    user_id = session_user_id
    if user_id is None and token:
        user_id = decode_access_token(token)
    if user_id is None:
        return None
    return db.get(User, int(user_id))


@router.websocket("/ws/recipes/{recipe_id}")
async def recipe_ws(websocket: WebSocket, recipe_id: int, token: str | None = None):
    session = websocket.scope.get("session", {})
    db = SessionLocal()
    try:
        user = _authenticate_ws_user(db, session.get("user_id"), token)
        recipe = db.get(Recipe, recipe_id) if user else None
        if user is None or recipe is None or not is_list_visible(recipe, user):
            await websocket.close(code=4401)
            return
    finally:
        db.close()
    await recipe_manager.connect(recipe_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        recipe_manager.disconnect(recipe_id, websocket)


# ── JSON API ────────────────────────────────────────────────────────────────────


@router.get("/api/recipes", response_model=list[RecipeSummaryOut])
def api_list_recipes(
    q: str | None = None,
    tag: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return search_recipes(db, current_user, q=q, tag=tag)


@router.get("/api/recipes/{recipe_id}", response_model=RecipeOut)
def api_get_recipe(
    recipe_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return load_recipe_full(db, recipe_id, current_user)


def _apply_payload(db: Session, recipe: Recipe, payload: RecipeCreate) -> None:
    recipe.title = payload.title.strip()[:300]
    recipe.servings = payload.servings
    recipe.prep_minutes = payload.prep_minutes
    recipe.cook_minutes = payload.cook_minutes
    recipe.notes = (payload.notes or "").strip() or None
    recipe.source_type = payload.source_type
    recipe.source_url = (payload.source_url or "").strip()[:1000] or None
    recipe.source_name = (payload.source_name or "").strip()[:200] or None
    recipe.image_url = (payload.image_url or "").strip()[:1000] or None
    recipe.is_public = payload.is_public
    # Only when sent: an app too old to know about leftovers mustn't erase them on save.
    if "leftover_rating" in payload.model_fields_set:
        recipe.leftover_rating = payload.leftover_rating
    if "leftover_notes" in payload.model_fields_set:
        recipe.leftover_notes = (payload.leftover_notes or "").strip() or None

    if payload.ingredients:
        recipe.ingredients.clear()
        db.flush()
        for index, item in enumerate(payload.ingredients):
            # Clients may post either a fully parsed ingredient (the Phase 2 import
            # review screen) or just the written line (the mobile editor, which is a
            # plain textarea). Parse the raw line either way and let anything the client
            # actually supplied win, so both paths end up with quantity, unit and a
            # canonical ingredient rather than only the web form doing so.
            parsed = parse_ingredient_line(item.raw_text)
            supplied_name = item.name.strip()
            name = (
                supplied_name
                if supplied_name and supplied_name != item.raw_text.strip()
                else parsed["name"]
            )
            ingredient = resolve(db, name, create=True)
            recipe.ingredients.append(
                RecipeIngredient(
                    raw_text=item.raw_text[:300],
                    quantity=item.quantity if item.quantity is not None else parsed["quantity"],
                    unit=item.unit or parsed["unit"],
                    name=name[:200],
                    prep_note=item.prep_note or parsed["prep_note"],
                    optional=item.optional or parsed["optional"],
                    ingredient_id=ingredient.id if ingredient else None,
                    sort_order=index * 10,
                )
            )
    apply_step_lines(recipe, [s for s in payload.steps if s.strip()])


@router.post("/api/recipes", response_model=RecipeOut)
def api_create_recipe(
    payload: RecipeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = Recipe(title=payload.title.strip()[:300], owner_id=current_user.id)
    db.add(recipe)
    db.flush()
    _apply_payload(db, recipe, payload)
    attach_scans(recipe, payload.scan_token)
    db.commit()
    return load_recipe_full(db, recipe.id, current_user)


@router.put("/api/recipes/{recipe_id}", response_model=RecipeOut)
async def api_update_recipe(
    recipe_id: int,
    payload: RecipeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, recipe_id, current_user)
    _apply_payload(db, recipe, payload)
    db.commit()
    fresh = load_recipe_full(db, recipe_id, current_user)
    # A phone edit updates any browser tab that has the recipe open, the same way the
    # grocery JSON routes already push to open web clients.
    await recipe_manager.broadcast(recipe_id, render_recipe_detail(fresh, oob_mode="replace"))
    return fresh


@router.delete("/api/recipes/{recipe_id}", status_code=204)
async def api_delete_recipe(
    recipe_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, recipe_id, current_user)
    if recipe.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this recipe")
    db.delete(recipe)
    db.commit()
    await recipe_manager.broadcast(recipe_id, DELETED_TOMBSTONE)
    return Response(status_code=204)
