import textwrap
from io import BytesIO

import fitz  # PyMuPDF
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


def _wrap(text: str, width: int = 90) -> list[str]:
    return textwrap.wrap(text, width) or [text]


def build_report_pdf(record, result: dict) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER
    y = height - 1 * inch

    def line(text: str, size: int = 11, gap: int = 16, bold: bool = False) -> None:
        nonlocal y
        if y < 1 * inch:
            c.showPage()
            y = height - 1 * inch
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(1 * inch, y, text)
        y -= gap

    line("ApplyCenter - Resume Feedback Report", size=16, bold=True, gap=26)
    line(f"Resume: {record.resume_filename}")
    line(f"Generated: {record.created_at.strftime('%Y-%m-%d %H:%M')}")
    y -= 6
    line(f"ATS Match Score: {result['ats_score']}/100", size=13, bold=True, gap=22)

    line("Missing Keywords", bold=True)
    for kw in result.get("missing_skills") or ["None - great keyword coverage."]:
        line(f"  - {kw}", size=10, gap=14)

    y -= 6
    line("Matched Keywords", bold=True)
    for kw in result.get("matched_skills") or ["None found."]:
        line(f"  - {kw}", size=10, gap=14)

    y -= 6
    line("Suggestions", bold=True)
    for s in result.get("suggestions") or []:
        for chunk in _wrap(s):
            line(f"  {chunk}", size=10, gap=14)

    c.save()
    return buffer.getvalue()


# ── "Tailor my resume" — overlay new skills onto the candidate's own PDF ───
# The goal is zero visible change to the original document except the added
# skills: same fonts, same layout, same page. PyMuPDF can only safely reuse
# its 14 built-in base fonts for freshly inserted text (an arbitrary embedded
# font from the source PDF isn't reliably reusable by name), so size, color,
# and position are matched exactly to the surrounding text; the typeface
# itself falls back to a clean sans-serif rather than risk broken glyphs.

_SKILLS_HEADINGS = {
    "technical skills", "core skills", "key skills", "skills & technologies",
    "skills and technologies", "skills", "technologies", "areas of expertise",
    "core competencies", "key competencies", "competencies", "technical proficiencies",
    "proficiencies", "professional skills", "relevant skills", "technical expertise",
    "skills summary", "domain expertise", "domain knowledge",
}

_ADDENDUM_HEADING = "Additional Skills (Added by ApplyCenter)"
_SECTION_HEADINGS = _SKILLS_HEADINGS | {
    "experience", "work experience", "professional experience", "projects",
    "education", "certifications", "certification", "research papers",
    "publications", "achievements", "summary", "objective", "awards",
    "additional skills (added by applycenter)",
}


def _wrap_to_width(text: str, fontname: str, fontsize: float, max_width: float) -> list[str]:
    words = text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or fitz.get_text_length(candidate, fontname=fontname, fontsize=fontsize) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _find_skills_heading(page) -> fitz.Rect | None:
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if text.lower().strip(" :._-") in _SKILLS_HEADINGS:
                return fitz.Rect(line["bbox"])
    return None


def _overlay_skills_onto_pdf(original_bytes: bytes, skills_to_add: list[str]) -> bytes | None:
    """Inserts the missing skills directly below the resume's existing
    skills section, matching size/color/position. Returns None (caller
    falls back) if no skills section is found or there's no room to add
    to it without overlapping the next section."""
    if not skills_to_add:
        return None
    try:
        doc = fitz.open(stream=original_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        for page in doc:
            heading_rect = _find_skills_heading(page)
            if heading_rect is None:
                continue

            content_bottom = heading_rect.y1
            next_heading_top = page.rect.height
            body_font_size, body_color, left_x = 10.0, (0, 0, 0), heading_rect.x0
            sampled_body_font = False

            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    bbox = fitz.Rect(line["bbox"])
                    if bbox.y0 <= heading_rect.y1 + 1:
                        continue
                    text = "".join(span["text"] for span in line["spans"]).strip()
                    norm = text.lower().strip(" :._-")
                    if norm in _SECTION_HEADINGS:
                        next_heading_top = min(next_heading_top, bbox.y0)
                        continue
                    if bbox.y0 < next_heading_top:
                        content_bottom = max(content_bottom, bbox.y1)
                        left_x = min(left_x, bbox.x0)
                        if not sampled_body_font and line["spans"]:
                            span = line["spans"][0]
                            body_font_size = span.get("size", body_font_size)
                            color_int = span.get("color", 0) or 0
                            body_color = (
                                ((color_int >> 16) & 255) / 255,
                                ((color_int >> 8) & 255) / 255,
                                (color_int & 255) / 255,
                            )
                            sampled_body_font = True

            line_height = body_font_size * 1.35
            available_height = next_heading_top - content_bottom - 4  # small buffer, never touch next section
            max_new_lines = max(0, int(available_height // line_height))
            if max_new_lines == 0:
                return None

            max_width = max(120.0, (page.rect.width - 0.75 * 72) - left_x)
            wrapped = _wrap_to_width("+ " + ", ".join(skills_to_add), "helv", body_font_size, max_width)
            wrapped = wrapped[:max_new_lines]
            if not wrapped:
                return None

            y = content_bottom + line_height
            for wrapped_line in wrapped:
                page.insert_text((left_x, y), wrapped_line, fontname="helv", fontsize=body_font_size, color=body_color)
                y += line_height

            out = BytesIO()
            doc.save(out)
            return out.getvalue()

        return None  # no skills-section heading found anywhere in the document
    finally:
        doc.close()


def _append_addendum_to_last_page(original_bytes: bytes, skills_to_add: list[str]) -> bytes | None:
    """Fallback when there's no room in the skills section itself: a clearly
    labeled, separate section on the last page — or a new page entirely if
    the last one is already full.

    Regression: this previously wrote a bare comma-joined line with no
    heading at whatever y-position happened to sit near the bottom margin,
    with no check for existing content there. On a resume whose last page
    ended with something like Certifications, the skills list landed
    directly under it with no visual separation or label — reading as a
    raw, unexplained text dump rather than a ApplyCenter-added section.
    """
    if not skills_to_add:
        return None
    try:
        doc = fitz.open(stream=original_bytes, filetype="pdf")
    except Exception:
        return None
    try:
        page = doc[-1]
        heading_size, body_size = 11.0, 9.0
        margin_bottom = 40.0
        x = 54.0
        max_width = page.rect.width - 2 * x

        lowest_content_y = 0.0
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                lowest_content_y = max(lowest_content_y, fitz.Rect(line["bbox"]).y1)

        heading_lines = _wrap_to_width(_ADDENDUM_HEADING, "hebo", heading_size, max_width)
        body_lines = _wrap_to_width(", ".join(skills_to_add), "helv", body_size, max_width)
        needed_height = (
            len(heading_lines) * heading_size * 1.35 + 6 + len(body_lines) * body_size * 1.35
        )

        y_start = lowest_content_y + 14
        if y_start + needed_height > page.rect.height - margin_bottom:
            # No room left on the last page without overlapping existing
            # content — a fresh page beats squeezing a label-less blob
            # into whatever gap is left.
            page = doc.new_page(-1, width=page.rect.width, height=page.rect.height)
            y_start = 54.0

        y = y_start
        for wrapped_line in heading_lines:
            page.insert_text((x, y), wrapped_line, fontname="hebo", fontsize=heading_size, color=(0, 0, 0))
            y += heading_size * 1.35
        y += 6
        for wrapped_line in body_lines:
            page.insert_text((x, y), wrapped_line, fontname="helv", fontsize=body_size, color=(0.35, 0.35, 0.35))
            y += body_size * 1.35

        out = BytesIO()
        doc.save(out)
        return out.getvalue()
    finally:
        doc.close()


def _build_resume_pdf_from_text(record, full_name: str, skills_to_add: list[str]) -> bytes:
    """Last-resort fallback for records with no stored original PDF (scans
    made before this feature existed) — rebuilds from extracted text."""
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER
    y = height - 1 * inch

    def line(text: str, size: int = 10, gap: int = 13, bold: bool = False, color=None) -> None:
        nonlocal y
        if y < 1 * inch:
            c.showPage()
            y = height - 1 * inch
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.setFillColor(color or "black")
        c.drawString(1 * inch, y, text)
        c.setFillColor("black")
        y -= gap

    line(full_name, size=18, bold=True, gap=24)
    line(f"Updated by ApplyCenter - {record.created_at.strftime('%Y-%m-%d')}", size=9, gap=22)

    for paragraph in (record.resume_text or "").split("\n"):
        if not paragraph.strip():
            y -= 6
            continue
        for chunk in _wrap(paragraph, width=95):
            line(chunk, size=10, gap=13)

    if skills_to_add:
        y -= 10
        line("Additional Skills (added by ApplyCenter)", size=12, bold=True, gap=18, color="#6D28D9")
        for skill in skills_to_add:
            line(f"  + {skill}", size=10, gap=14, color="#6D28D9")

    c.save()
    return buffer.getvalue()


def build_updated_resume_pdf(record, full_name: str, skills_to_add: list[str]) -> bytes:
    original = record.resume_file_bytes
    if original and not skills_to_add:
        return original  # nothing to add — return the exact original, unmodified
    if original:
        overlaid = _overlay_skills_onto_pdf(original, skills_to_add)
        if overlaid:
            return overlaid
        addended = _append_addendum_to_last_page(original, skills_to_add)
        if addended:
            return addended
    return _build_resume_pdf_from_text(record, full_name, skills_to_add)
