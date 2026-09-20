from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session, joinedload, selectinload

from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.ingredients import normalize, parse_ingredient_line, resolve
from app.list_access import is_list_visible
from app.models import Recipe, RecipeImage, RecipeIngredient, RecipeStep, RecipeTagName, User
from app.schemas import RecipeCreate, RecipeOut, RecipeSummaryOut, RecipeUpdate
from app.security import decode_access_token
from app.templating import templates
from app.ws_manager import recipe_manager

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


def parse_tag_names(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: dict[str, str] = {}
    for chunk in raw.split(","):
        name = " ".join(chunk.split())
        if not name:
            continue
        key = normalize(name)
        if key and key not in seen:
            seen[key] = name[:60]
    return list(seen.values())


def get_or_create_tag(db: Session, name: str) -> RecipeTagName:
    key = normalize(name)
    tag = db.query(RecipeTagName).filter(RecipeTagName.norm_key == key).first()
    if tag is None:
        tag = RecipeTagName(name=name[:60], norm_key=key[:60])
        db.add(tag)
        db.flush()
    return tag


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


def apply_tags(db: Session, recipe: Recipe, names: list[str]) -> None:
    recipe.tags = [get_or_create_tag(db, name) for name in names]


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
    tag: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request.session["last_page"] = "/recipes"
    recipes = search_recipes(db, current_user, q=q, tag=tag)
    all_tags = db.query(RecipeTagName).order_by(func.lower(RecipeTagName.name)).all()
    return templates.TemplateResponse(
        request,
        "recipes.html",
        {
            "recipes": recipes,
            "all_tags": all_tags,
            "q": q or "",
            "active_tag": tag or "",
            "current_user": current_user,
        },
    )


@router.get("/recipes/new", response_class=HTMLResponse)
def recipe_new_page(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        request,
        "recipe_form.html",
        {"recipe": None, "ingredient_text": "", "step_text": "", "tag_text": "", "current_user": current_user},
    )


@router.post("/recipes")
def recipe_create(
    title: str = Form(...),
    description: str = Form(""),
    servings: str = Form(""),
    prep_minutes: str = Form(""),
    cook_minutes: str = Form(""),
    ingredients: str = Form(""),
    steps: str = Form(""),
    tags: str = Form(""),
    notes: str = Form(""),
    source_url: str = Form(""),
    source_name: str = Form(""),
    is_public: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = Recipe(
        title=title.strip()[:300],
        description=description.strip()[:2000] or None,
        servings=_parse_int(servings),
        prep_minutes=_parse_int(prep_minutes),
        cook_minutes=_parse_int(cook_minutes),
        notes=notes.strip() or None,
        source_type="url" if source_url.strip() else "manual",
        source_url=source_url.strip()[:1000] or None,
        source_name=source_name.strip()[:200] or None,
        owner_id=current_user.id,
        is_public=is_public,
    )
    db.add(recipe)
    db.flush()
    apply_ingredient_lines(db, recipe, split_lines(ingredients))
    apply_step_lines(recipe, split_lines(steps))
    apply_tags(db, recipe, parse_tag_names(tags))
    db.commit()
    return RedirectResponse(url=f"/recipes/{recipe.id}", status_code=status.HTTP_302_FOUND)


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
            "ingredient_text": "\n".join(i.raw_text for i in recipe.ingredients),
            "step_text": "\n".join(s.text for s in recipe.steps),
            "tag_text": ", ".join(recipe.tag_names),
            "current_user": current_user,
        },
    )


@router.post("/recipes/{recipe_id}/edit")
async def recipe_update(
    recipe_id: int,
    title: str = Form(...),
    description: str = Form(""),
    servings: str = Form(""),
    prep_minutes: str = Form(""),
    cook_minutes: str = Form(""),
    ingredients: str = Form(""),
    steps: str = Form(""),
    tags: str = Form(""),
    notes: str = Form(""),
    source_url: str = Form(""),
    source_name: str = Form(""),
    is_public: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = get_visible_recipe(db, recipe_id, current_user)
    recipe.title = title.strip()[:300]
    recipe.description = description.strip()[:2000] or None
    recipe.servings = _parse_int(servings)
    recipe.prep_minutes = _parse_int(prep_minutes)
    recipe.cook_minutes = _parse_int(cook_minutes)
    recipe.notes = notes.strip() or None
    recipe.source_url = source_url.strip()[:1000] or None
    recipe.source_name = source_name.strip()[:200] or None
    recipe.is_public = is_public
    apply_ingredient_lines(db, recipe, split_lines(ingredients))
    apply_step_lines(recipe, split_lines(steps))
    apply_tags(db, recipe, parse_tag_names(tags))
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
    recipe.description = (payload.description or "").strip()[:2000] or None
    recipe.servings = payload.servings
    recipe.prep_minutes = payload.prep_minutes
    recipe.cook_minutes = payload.cook_minutes
    recipe.notes = (payload.notes or "").strip() or None
    recipe.source_type = payload.source_type
    recipe.source_url = (payload.source_url or "").strip()[:1000] or None
    recipe.source_name = (payload.source_name or "").strip()[:200] or None
    recipe.image_url = (payload.image_url or "").strip()[:1000] or None
    recipe.is_public = payload.is_public

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
    apply_tags(db, recipe, parse_tag_names(", ".join(payload.tags)))


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
