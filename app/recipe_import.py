"""Turn a URL, a photo, or a block of pasted text into a structured recipe draft.

Three things worth knowing about the design:

**JSON-LD first.** Most recipe sites publish `schema.org/Recipe` metadata. When it's
there we take the title, steps, servings, times and hero image from it verbatim — free,
instant, and exactly right — and only send the ingredient *lines* to the model to be
split into quantity/unit/name. Asking a model to read a whole rendered page when the
page already states the answer is slower, costlier and less accurate.

**Nothing here writes to the database.** Extraction returns a draft that the user
reviews and edits before saving. Extraction is good but not perfect, and a wrong
ingredient silently poisons grocery lists and pantry matching later, so a human sees it
first. That also means no job queue, no status column and no polling — one request, one
response.

**Blocked pages are expected, not exceptional.** Facebook and Instagram will refuse to
be fetched. That path raises RecipeImportError with a message telling the user to paste
the text or a screenshot instead, which is the realistic way to get a recipe out of a
social post.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import secrets
import time

import anthropic
import httpx
from bs4 import BeautifulSoup
from PIL import Image
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)

# A real browser UA. Recipe sites routinely 403 anything that looks automated, and this
# is a person importing a page they're already reading, not a crawler.
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
_FETCH_TIMEOUT = 15.0
_MAX_PAGE_BYTES = 2 * 1024 * 1024

# Anthropic's vision guidance: images larger than this are downscaled server-side anyway,
# so sending more just costs upload time.
_MAX_IMAGE_EDGE = 1568
_MAX_IMAGES = 5

_SOCIAL_HOSTS = ("facebook.com", "fb.com", "instagram.com", "threads.net", "tiktok.com")


class RecipeImportError(Exception):
    """Something went wrong the user can act on. The message is shown to them verbatim,
    so it says what to do next rather than what failed internally."""


class DraftIngredient(BaseModel):
    raw_text: str = Field(description="The ingredient line exactly as written in the source")
    quantity: float | None = Field(default=None, description="Numeric amount, e.g. 1.5 for '1 1/2'. Null if none given.")
    unit: str | None = Field(default=None, description="Singular unit, e.g. 'cup', 'tablespoon', 'pound'. Null if none.")
    name: str = Field(description="Just the ingredient, without amount or preparation, e.g. 'all-purpose flour'")
    canonical_name: str = Field(description="Simplest common pantry name, singular, e.g. 'chicken breast' for '2 lbs boneless skinless chicken breasts'")
    prep_note: str | None = Field(default=None, description="Preparation, e.g. 'finely chopped'. Null if none.")
    optional: bool = Field(default=False, description="True for garnishes, 'to taste', or anything marked optional")


class RecipeDraft(BaseModel):
    title: str
    description: str | None = Field(default=None, description="One sentence describing the dish. Not the author's story.")
    servings: int | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: list[str] = Field(default_factory=list, description="A few short labels, e.g. 'weeknight', 'vegetarian'")
    ingredients: list[DraftIngredient] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list, description="Method steps in order, without step numbers")


_SYSTEM_PROMPT = """You extract recipes into structured data.

Rules:
- Copy ingredient lines into raw_text exactly as written. Never reword or re-order them.
- Ignore everything that is not the recipe: ads, navigation, comments, subscribe prompts,
  and the author's personal story. A recipe blog post is mostly narrative; you want the
  ingredient list and the method, nothing else.
- canonical_name is what you would call the item in a kitchen cupboard: singular, no
  amount, no brand, no preparation. "2 lbs boneless skinless chicken breasts, cubed"
  gives canonical_name "chicken breast". "1 (14.5 oz) can of diced San Marzano tomatoes"
  gives "canned tomato".
- Keep meaningful descriptors that change what the item is: "ground beef" is not "beef",
  "heavy cream" is not "cream", "dried basil" is not "basil".
- Mark garnishes, "to taste" items and anything labelled optional as optional.
- Steps are the method only, in order, with any leading step numbers removed.
- If a value genuinely isn't stated, use null rather than guessing. Do not invent
  servings or timings that the source does not give."""


def _client() -> anthropic.AsyncAnthropic:
    if not settings.anthropic_api_key:
        raise RecipeImportError(
            "Recipe import isn't configured yet — ANTHROPIC_API_KEY needs to be set on the server."
        )
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


async def _parse_draft(content: list[dict], *, context: str) -> RecipeDraft:
    """One structured-output call. `content` is a user message content list."""
    client = _client()
    try:
        response = await client.messages.parse(
            model=settings.recipe_model,
            max_tokens=8000,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
            output_format=RecipeDraft,
        )
    except anthropic.AuthenticationError:
        raise RecipeImportError("The Anthropic API key on the server was rejected. Check ANTHROPIC_API_KEY.") from None
    except anthropic.RateLimitError:
        raise RecipeImportError("Hit the Anthropic rate limit. Wait a moment and try again.") from None
    except anthropic.APITimeoutError:
        raise RecipeImportError("The recipe service took too long to respond. Try again.") from None
    except anthropic.APIConnectionError:
        raise RecipeImportError("Couldn't reach the recipe service. Check the server's internet connection.") from None
    except anthropic.APIStatusError as exc:
        logger.warning("Recipe extraction failed (%s): %s", context, exc)
        raise RecipeImportError("The recipe service returned an error. Try again in a moment.") from None

    draft = response.parsed_output
    if draft is None or not draft.title.strip():
        raise RecipeImportError("Couldn't find a recipe in that. Try pasting the text directly.")
    return draft


# ── URL import ──────────────────────────────────────────────────────────────────


def _is_social(url: str) -> bool:
    return any(host in url.lower() for host in _SOCIAL_HOSTS)


async def _fetch(url: str) -> str:
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=_FETCH_TIMEOUT,
            headers={"User-Agent": _USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        ) as client:
            response = await client.get(url)
    except httpx.TimeoutException:
        raise RecipeImportError("That page took too long to load. Try pasting the recipe text instead.") from None
    except httpx.HTTPError:
        raise RecipeImportError("Couldn't open that link. Check it, or paste the recipe text instead.") from None

    if response.status_code in (401, 403, 429) or (_is_social(url) and response.status_code >= 400):
        raise RecipeImportError(
            "That site wouldn't let us read the page — social posts usually block this. "
            "Paste the post's text, or take a screenshot and use Photo instead."
        )
    if response.status_code >= 400:
        raise RecipeImportError(f"That page returned an error ({response.status_code}). Try pasting the text instead.")

    # Guard against someone pointing this at a huge file.
    return response.text[: _MAX_PAGE_BYTES]


def _walk_json_ld(node, found: list[dict]) -> None:
    """schema.org Recipe can be a bare object, an array, or buried in an @graph."""
    if isinstance(node, list):
        for item in node:
            _walk_json_ld(item, found)
        return
    if not isinstance(node, dict):
        return
    node_type = node.get("@type")
    types = node_type if isinstance(node_type, list) else [node_type]
    if any(isinstance(t, str) and t.lower() == "recipe" for t in types):
        found.append(node)
    for key in ("@graph", "mainEntity", "mainEntityOfPage"):
        if key in node:
            _walk_json_ld(node[key], found)


def extract_json_ld_recipe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    found: list[dict] = []
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            _walk_json_ld(json.loads(raw), found)
        except (json.JSONDecodeError, ValueError):
            # Malformed JSON-LD is common; it just means we fall back to reading the page.
            continue
    return found[0] if found else None


def _iso8601_minutes(value) -> int | None:
    """"PT1H30M" -> 90. Recipe sites use ISO 8601 durations for cook and prep times."""
    if not isinstance(value, str):
        return None
    match = re.match(r"^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?", value.strip(), re.IGNORECASE)
    if not match or not any(match.groups()):
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    total = hours * 60 + minutes
    return total or None


def _json_ld_text(value) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        return _json_ld_text(value.get("name") or value.get("text") or value.get("url"))
    if isinstance(value, list) and value:
        return _json_ld_text(value[0])
    return None


def _json_ld_steps(value) -> list[str]:
    steps: list[str] = []
    if isinstance(value, str):
        # Some sites cram the whole method into one string.
        parts = [p.strip() for p in re.split(r"(?:\r?\n)+", value) if p.strip()]
        return parts or [value.strip()]
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and item.get("@type") == "HowToSection":
                steps.extend(_json_ld_steps(item.get("itemListElement")))
                continue
            text = _json_ld_text(item.get("text") if isinstance(item, dict) else item)
            if text:
                steps.append(text)
    return steps


def _json_ld_servings(value) -> int | None:
    text = _json_ld_text(value)
    if not text:
        return None
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None


async def extract_from_url(url: str) -> tuple[RecipeDraft, str | None, str | None]:
    """Returns (draft, source_name, image_url)."""
    html = await _fetch(url)
    data = extract_json_ld_recipe(html)

    soup = BeautifulSoup(html, "html.parser")
    site_name = None
    meta_site = soup.find("meta", property="og:site_name")
    if meta_site and meta_site.get("content"):
        site_name = meta_site["content"].strip()[:200]

    if data:
        # The page already states everything except the ingredient breakdown, so only
        # that goes to the model.
        lines = [t for t in (_json_ld_text(i) for i in (data.get("recipeIngredient") or [])) if t]
        steps = _json_ld_steps(data.get("recipeInstructions"))
        title = _json_ld_text(data.get("name")) or "Untitled recipe"

        if lines:
            draft = await _parse_ingredient_lines_only(title, lines, steps)
        else:
            draft = RecipeDraft(title=title, steps=steps)

        draft.description = _json_ld_text(data.get("description")) or draft.description
        draft.servings = _json_ld_servings(data.get("recipeYield")) or draft.servings
        draft.prep_minutes = _iso8601_minutes(data.get("prepTime")) or draft.prep_minutes
        draft.cook_minutes = _iso8601_minutes(data.get("cookTime")) or draft.cook_minutes
        # The page's own steps win over the model's. They're the author's exact wording,
        # and the model is only in this path to break ingredient lines apart — letting a
        # paraphrase through would quietly rewrite the method.
        if steps:
            draft.steps = steps

        category = data.get("recipeCategory") or data.get("keywords")
        if isinstance(category, str):
            draft.tags = [t.strip() for t in category.split(",") if t.strip()][:5]
        elif isinstance(category, list):
            draft.tags = [str(t).strip() for t in category if str(t).strip()][:5]

        image_url = _json_ld_text(data.get("image"))
        return draft, site_name, image_url

    # No structured data — read the page.
    text = _readable_text(soup)
    if len(text) < 120:
        raise RecipeImportError(
            "That page didn't have readable text — it may need JavaScript. "
            "Paste the recipe text, or use a screenshot."
        )
    draft = await _parse_draft(
        [{"type": "text", "text": f"Extract the recipe from this page.\n\n{text}"}],
        context=f"url {url}",
    )
    meta_image = soup.find("meta", property="og:image")
    return draft, site_name, (meta_image.get("content") if meta_image else None)


def _readable_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "nav", "footer", "aside", "form", "noscript", "svg", "iframe"]):
        tag.decompose()
    text = soup.get_text("\n")
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)[: settings.recipe_max_page_chars]


async def _parse_ingredient_lines_only(title: str, lines: list[str], steps: list[str]) -> RecipeDraft:
    """The JSON-LD fast path: the page gave us everything but the ingredient breakdown."""
    joined = "\n".join(lines)
    draft = await _parse_draft(
        [{
            "type": "text",
            "text": (
                f'Recipe title: "{title}". Below are its ingredient lines, already extracted '
                f"from the page. Break each one into structured fields. Return the steps "
                f"exactly as given.\n\nIngredients:\n{joined}\n\n"
                f"Steps:\n" + "\n".join(steps[:60])
            ),
        }],
        context="json-ld ingredients",
    )
    draft.title = title
    return draft


# ── Text and photo import ───────────────────────────────────────────────────────


async def extract_from_text(text: str) -> RecipeDraft:
    cleaned = text.strip()
    if len(cleaned) < 40:
        raise RecipeImportError("That's too short to be a recipe — paste the ingredients and method.")
    return await _parse_draft(
        [{"type": "text", "text": f"Extract the recipe from this text.\n\n{cleaned[: settings.recipe_max_page_chars]}"}],
        context="pasted text",
    )


def prepare_image(data: bytes) -> tuple[bytes, str]:
    """Downscale and re-encode a photo for both the vision call and storage.

    Phone cameras produce 3-12MB images; re-encoding to a 1568px JPEG puts them at a few
    hundred KB, which matters twice over — it's what gets sent to the model, and it's
    what gets stored as a BYTEA row since there's no object storage.
    """
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        raise RecipeImportError("That file didn't look like an image.") from None

    # EXIF orientation: a photo taken in portrait is often stored rotated, and a sideways
    # cookbook page is materially harder to read.
    try:
        from PIL import ImageOps

        image = ImageOps.exif_transpose(image)
    except Exception:
        pass

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    longest = max(image.size)
    if longest > _MAX_IMAGE_EDGE:
        scale = _MAX_IMAGE_EDGE / longest
        image = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.LANCZOS)

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85, optimize=True)
    return buffer.getvalue(), "image/jpeg"


async def extract_from_images(images: list[bytes]) -> tuple[RecipeDraft, list[tuple[bytes, str]]]:
    """Returns (draft, prepared images) so the caller can store what was actually sent."""
    if not images:
        raise RecipeImportError("No photo was uploaded.")
    if len(images) > _MAX_IMAGES:
        raise RecipeImportError(f"Too many photos — {_MAX_IMAGES} at a time is the limit.")

    prepared = [prepare_image(raw) for raw in images]
    content: list[dict] = []
    for data, media_type in prepared:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()},
        })
    plural = "these photos" if len(prepared) > 1 else "this photo"
    content.append({
        "type": "text",
        "text": (
            f"Extract the recipe from {plural} of a cookbook page, recipe card or "
            f"handwritten note. Read the handwriting as carefully as you can; if a word "
            f"is genuinely illegible, keep your best reading in raw_text rather than "
            f"dropping the line."
        ),
    })
    draft = await _parse_draft(content, context=f"{len(prepared)} image(s)")
    return draft, prepared


# ── Holding area for scans awaiting review ──────────────────────────────────────
#
# Photos are uploaded when the import runs, but the recipe row only exists once the user
# saves the reviewed draft — and nothing is supposed to hit the database before they've
# looked at it. So prepared images wait here under a token that rides through the review
# form as a hidden field.
#
# In-process and deliberately so, matching ws_manager: it's a 30-minute window on a
# single-replica app. A restart mid-review loses the scan, and the user re-picks the
# photo; that's a better failure than orphaned rows or a 2MB form post.

_PENDING_SCANS: dict[str, tuple[float, list[tuple[bytes, str]]]] = {}
_SCAN_TTL_SECONDS = 30 * 60
_MAX_PENDING_SCANS = 20


def _prune_scans(now: float) -> None:
    for token in [t for t, (created, _) in _PENDING_SCANS.items() if now - created > _SCAN_TTL_SECONDS]:
        _PENDING_SCANS.pop(token, None)


def stash_scans(images: list[tuple[bytes, str]]) -> str | None:
    """Park prepared images for the review step; returns the token, or None if empty."""
    if not images:
        return None

    now = time.monotonic()
    _prune_scans(now)
    # Hard cap so a stuck tab can't grow this without bound.
    while len(_PENDING_SCANS) >= _MAX_PENDING_SCANS:
        oldest = min(_PENDING_SCANS, key=lambda t: _PENDING_SCANS[t][0])
        _PENDING_SCANS.pop(oldest, None)

    token = secrets.token_urlsafe(16)
    _PENDING_SCANS[token] = (now, images)
    return token


def take_scans(token: str | None) -> list[tuple[bytes, str]]:
    """Claim the images for a token. Consumed on read, so a double-submit can't attach
    the same scans to two recipes."""
    if not token:
        return []

    _prune_scans(time.monotonic())
    entry = _PENDING_SCANS.pop(token, None)
    return entry[1] if entry else []


def draft_to_lines(draft: RecipeDraft) -> tuple[str, str, str]:
    """Flatten a draft into the textarea contents the review form edits."""
    ingredients = "\n".join(i.raw_text.strip() for i in draft.ingredients if i.raw_text.strip())
    steps = "\n".join(s.strip() for s in draft.steps if s.strip())
    tags = ", ".join(t.strip() for t in draft.tags if t.strip())
    return ingredients, steps, tags
