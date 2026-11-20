"""Ways to get a recipe out of FamilyHub: plain text (for email), a PDF, and the public
permalink URL. Pure functions over a loaded Recipe — no DB or request access — so the
web routes and the API share exactly one rendering.
"""

import io
import secrets
from urllib.parse import quote

from fpdf import FPDF
from PIL import Image

from app.models import Recipe

# Mail clients choke on very long mailto: URLs (Outlook on Windows truncates around 2000
# characters, silently). Past this encoded size the body is trimmed at a line break and
# the reader is pointed at the PDF instead of getting a recipe that just stops.
MAILTO_BODY_LIMIT = 1700
TRIM_NOTE = "\n[Recipe trimmed to fit an email link. Use Download PDF for the full version.]"


def new_share_token() -> str:
    # 24 random bytes -> 32 URL-safe chars, ~192 bits: not guessable or enumerable.
    return secrets.token_urlsafe(24)


def _meta_line(recipe: Recipe) -> str:
    parts = []
    if recipe.servings:
        parts.append(f"Serves {recipe.servings}")
    if recipe.prep_minutes:
        parts.append(f"{recipe.prep_minutes} min prep")
    if recipe.cook_minutes:
        parts.append(f"{recipe.cook_minutes} min cook")
    return "  |  ".join(parts)


def recipe_to_text(recipe: Recipe, link: str | None = None) -> str:
    lines: list[str] = [recipe.title]
    meta = _meta_line(recipe)
    if meta:
        lines.append(meta)
    if recipe.tag_names:
        lines.append(", ".join(recipe.tag_names))
    if recipe.description:
        lines += ["", recipe.description]

    lines += ["", "INGREDIENTS"]
    lines += [
        f"- {item.raw_text}{' (optional)' if item.optional else ''}" for item in recipe.ingredients
    ] or ["(none listed)"]

    if recipe.steps:
        lines += ["", "METHOD"]
        lines += [f"{n}. {step.text}" for n, step in enumerate(recipe.steps, start=1)]
    if recipe.notes:
        lines += ["", "NOTES", recipe.notes]

    source = " - ".join(p for p in (recipe.source_name, recipe.source_url) if p)
    if source:
        lines += ["", f"Source: {source}"]
    if link:
        lines += ["", f"View online: {link}"]
    lines += ["", "Shared from FamilyHub"]
    return "\n".join(lines)


def recipe_mailto(recipe: Recipe, link: str | None = None) -> str:
    body = recipe_to_text(recipe, link)
    if len(quote(body, safe="")) > MAILTO_BODY_LIMIT:
        trimmed = body
        while len(quote(trimmed + TRIM_NOTE, safe="")) > MAILTO_BODY_LIMIT and "\n" in trimmed:
            trimmed = trimmed.rsplit("\n", 1)[0]
        body = trimmed + TRIM_NOTE
    return f"mailto:?subject={quote(recipe.title, safe='')}&body={quote(body, safe='')}"


# ── PDF ─────────────────────────────────────────────────────────────────────────

# fpdf2's built-in fonts are Latin-1 only and the project has no font files to ship, so
# the common non-Latin-1 characters recipes actually contain (fraction glyphs, smart
# quotes, dashes) are mapped to plain equivalents; anything else becomes "?" rather than
# raising mid-render.
_PDF_TRANSLATE = str.maketrans({
    "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"',
    "–": "-", "—": "-", "−": "-", "•": "-", "…": "...",
    " ": " ", " ": " ", " ": " ",
    "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5",
    "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8",
    "⅝": "5/8", "⅞": "7/8", "⁄": "/",
})


def _pdf_text(value: str) -> str:
    return value.translate(_PDF_TRANSLATE).encode("latin-1", "replace").decode("latin-1")


class _RecipePDF(FPDF):
    def __init__(self, credit: str):
        super().__init__(format="Letter")
        self.credit = _pdf_text(credit)
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(18, 18, 18)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(130, 130, 130)
        self.cell(0, 6, f"{self.credit}   Page {self.page_no()}", align="C")


def recipe_to_pdf(recipe: Recipe, link: str | None = None) -> bytes:
    pdf = _RecipePDF(f"{recipe.owner.display_name}'s recipe - FamilyHub")
    pdf.set_title(_pdf_text(recipe.title))
    pdf.set_creator("FamilyHub")
    pdf.add_page()

    def heading(text: str):
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(60, 60, 60)
        pdf.cell(0, 7, _pdf_text(text.upper()), new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(200, 200, 200)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.ln(2)

    def body(text: str, indent: float = 0, size: int = 11):
        pdf.set_font("Helvetica", "", size)
        pdf.set_text_color(30, 30, 30)
        pdf.set_x(pdf.l_margin + indent)
        pdf.multi_cell(0, 5.6, _pdf_text(text), new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 9, _pdf_text(recipe.title), new_x="LMARGIN", new_y="NEXT")

    meta = _meta_line(recipe)
    if recipe.tag_names:
        meta = f"{meta}  |  {', '.join(recipe.tag_names)}" if meta else ", ".join(recipe.tag_names)
    if meta:
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(110, 110, 110)
        pdf.multi_cell(0, 5.5, _pdf_text(meta), new_x="LMARGIN", new_y="NEXT")
    if recipe.description:
        pdf.ln(2)
        pdf.set_font("Helvetica", "I", 11)
        pdf.set_text_color(70, 70, 70)
        pdf.multi_cell(0, 5.6, _pdf_text(recipe.description), new_x="LMARGIN", new_y="NEXT")

    heading("Ingredients")
    if recipe.ingredients:
        for item in recipe.ingredients:
            text = item.raw_text + (" (optional)" if item.optional else "")
            body(f"-  {text}", indent=2)
            pdf.ln(0.6)
    else:
        body("No ingredients listed.")

    # Same rule as the print page: a scan-only recipe skips an empty "Method" heading
    # because the scan itself is the method.
    if recipe.steps or not recipe.images:
        heading("Method")
        if recipe.steps:
            for number, step in enumerate(recipe.steps, start=1):
                body(f"{number}.  {step.text}", indent=2)
                pdf.ln(1.4)
        else:
            body("No steps listed.")

    if recipe.notes:
        heading("Notes")
        body(recipe.notes)

    if recipe.images and not recipe.steps:
        for index, image in enumerate(recipe.images, start=1):
            try:
                with Image.open(io.BytesIO(image.data)) as img:
                    width_px, height_px = img.size
                    if img.mode not in ("RGB", "L"):
                        img = img.convert("RGB")
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=85)
            except Exception:
                continue  # an unreadable scan shouldn't fail the whole export
            max_w = pdf.w - pdf.l_margin - pdf.r_margin
            max_h = pdf.h - pdf.t_margin - 30
            scale = min(max_w / width_px, max_h / height_px)
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(60, 60, 60)
            pdf.cell(0, 7, f"SCAN {index}", new_x="LMARGIN", new_y="NEXT")
            buf.seek(0)
            pdf.image(buf, x=pdf.l_margin, y=pdf.get_y() + 1, w=width_px * scale, h=height_px * scale)

    source = " - ".join(p for p in (recipe.source_name, recipe.source_url) if p)
    if source or link:
        pdf.ln(6)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(110, 110, 110)
        if source:
            pdf.multi_cell(0, 5, _pdf_text(f"Source: {source}"), new_x="LMARGIN", new_y="NEXT")
        if link:
            pdf.multi_cell(0, 5, _pdf_text(f"View online: {link}"), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


def pdf_filename(recipe: Recipe) -> str:
    # ASCII only: the name goes into a Content-Disposition header, which is Latin-1 at best.
    slug = "".join(c if c.isascii() and c.isalnum() else "-" for c in recipe.title.lower()).strip("-")
    slug = "-".join(part for part in slug.split("-") if part)[:60]
    return f"{slug or 'recipe'}.pdf"
