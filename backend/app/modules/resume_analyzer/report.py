import textwrap
from io import BytesIO

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

    line("AI Career Coach - Resume Feedback Report", size=16, bold=True, gap=26)
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


def build_updated_resume_pdf(record, full_name: str, skills_to_add: list[str]) -> bytes:
    """Rebuilds the candidate's resume text as a clean PDF, with the staged
    missing skills appended as a clearly-labeled new section."""
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
    line(f"Updated by AI Career Coach - {record.created_at.strftime('%Y-%m-%d')}", size=9, gap=22)

    for paragraph in (record.resume_text or "").split("\n"):
        if not paragraph.strip():
            y -= 6
            continue
        for chunk in _wrap(paragraph, width=95):
            line(chunk, size=10, gap=13)

    if skills_to_add:
        y -= 10
        line("Additional Skills (added by AI Career Coach)", size=12, bold=True, gap=18, color="#6D28D9")
        for skill in skills_to_add:
            line(f"  + {skill}", size=10, gap=14, color="#6D28D9")

    c.save()
    return buffer.getvalue()
