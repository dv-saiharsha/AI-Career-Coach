"""The "Tailor my resume" overlay path (build_updated_resume_pdf) — real PDFs
built with reportlab and read back with PyMuPDF, not source-string
assertions, since the bug this guards against (a raw, unlabeled skills dump
landing under an unrelated section like Certifications) is only visible in
the actual rendered layout.
"""

from io import BytesIO

import fitz
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

from app.modules.resume_analyzer import report


def _build_pdf(sections: list[tuple[str, list[str]]], fill_last_page: bool = False) -> bytes:
    """A minimal synthetic resume: a list of (heading, body_lines) sections,
    all on one page unless fill_last_page pads it to the bottom margin."""
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER
    y = height - 72

    for heading, lines in sections:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(54, y, heading)
        y -= 18
        c.setFont("Helvetica", 10)
        for line in lines:
            c.drawString(54, y, line)
            y -= 14
        y -= 60  # room below each section for the overlay to insert into

    if fill_last_page:
        c.setFont("Helvetica", 10)
        while y > 40:
            c.drawString(54, y, "Filler line to exhaust remaining page space.")
            y -= 14

    c.save()
    return buffer.getvalue()


def _extract_all_text(pdf_bytes: bytes) -> str:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


class TestOverlayOntoRecognizedHeading:
    def test_exact_heading_match_gets_skills_inline_no_addendum(self):
        original = _build_pdf([("Technical Skills", ["Python, SQL"]), ("Experience", ["Did things."])])
        result = report.build_updated_resume_pdf(
            type("Rec", (), {"resume_file_bytes": original, "resume_text": "", "created_at": None})(),
            "Jane Doe",
            ["Kubernetes"],
        )
        text = _extract_all_text(result)
        assert "Kubernetes" in text
        assert report._ADDENDUM_HEADING not in text

    def test_broadened_heading_synonym_is_recognized(self):
        """Regression: 'Core Competencies' previously wasn't in
        _SKILLS_HEADINGS, so a resume using it fell through to the raw-dump
        fallback even though it clearly has a skills section."""
        original = _build_pdf([("Core Competencies", ["Leadership, SQL"]), ("Experience", ["Did things."])])
        result = report.build_updated_resume_pdf(
            type("Rec", (), {"resume_file_bytes": original, "resume_text": "", "created_at": None})(),
            "Jane Doe",
            ["Kubernetes"],
        )
        text = _extract_all_text(result)
        assert "Kubernetes" in text
        assert report._ADDENDUM_HEADING not in text


class TestFallbackAddendum:
    def test_no_recognized_heading_produces_labeled_section_not_raw_dump(self):
        """Regression: the exact bug reported — no recognized skills heading
        anywhere, so the old code silently appended a bare comma-joined list
        with no heading at the bottom of the last page. Now it must always
        carry a real label."""
        original = _build_pdf([("Certifications", ["AWS Certified", "PMP"])])
        result = report.build_updated_resume_pdf(
            type("Rec", (), {"resume_file_bytes": original, "resume_text": "", "created_at": None})(),
            "Jane Doe",
            ["Kubernetes", "Terraform"],
        )
        text = _extract_all_text(result)
        assert report._ADDENDUM_HEADING in text
        assert "Kubernetes" in text
        assert "Terraform" in text
        # The heading must appear before the skills list, not after — a
        # trailing label would be just as confusing as no label at all.
        assert text.index(report._ADDENDUM_HEADING) < text.index("Kubernetes")

    def test_full_last_page_spills_to_a_new_page_instead_of_overlapping(self):
        """Regression: the old fallback wrote at a fixed offset from the
        bottom with no check for existing content there — on a full last
        page this would overlap real resume text instead of adding a page."""
        original = _build_pdf([("Certifications", ["AWS Certified"])], fill_last_page=True)
        with fitz.open(stream=original, filetype="pdf") as doc:
            original_page_count = doc.page_count

        result = report.build_updated_resume_pdf(
            type("Rec", (), {"resume_file_bytes": original, "resume_text": "", "created_at": None})(),
            "Jane Doe",
            ["Kubernetes"],
        )

        with fitz.open(stream=result, filetype="pdf") as doc:
            assert doc.page_count == original_page_count + 1
            last_page_text = doc[-1].get_text()
        assert report._ADDENDUM_HEADING in last_page_text
        assert "Kubernetes" in last_page_text


class TestNoSkillsToAdd:
    def test_returns_original_unmodified(self):
        original = _build_pdf([("Technical Skills", ["Python"])])
        result = report.build_updated_resume_pdf(
            type("Rec", (), {"resume_file_bytes": original, "resume_text": "", "created_at": None})(),
            "Jane Doe",
            [],
        )
        assert result == original
