"""Extraction equivalence and the latency budget that motivated it.

The PDF text path moved from pdfplumber to PyMuPDF. That is the kind of change
that looks like a preference and gets reverted by the next person who has a
habit, so the numbers and the correctness argument live here rather than only
in a commit message.

Two things are asserted:

  Equivalence. Across the shapes a resume actually takes — two-column,
  ligature/unicode, table grid, image-only, multi-page — the two extractors
  produce whitespace-identical text. If that ever stops being true, this fails
  and the change has to be re-argued rather than silently degrading scores.

  Correction. On rotated text they disagree, and pdfplumber is wrong: it reads
  the run backwards. Sidebar skill columns are common in modern templates, and
  hard_skill_match carries weight 30 in the rubric, so those candidates were
  being matched against reversed gibberish.
"""

import io
import time

import fitz
import pytest

from app.modules.resume_analyzer.services import extract_text


def _pdfplumber_text(pdf_bytes: bytes) -> str:
    """The implementation this module replaced, kept only as the comparand."""
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


def _norm(text: str) -> str:
    return " ".join(text.split())


def _two_column() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    for y in range(80, 700, 14):
        page.insert_text((50, y), f"LEFT column line {y} Python Kubernetes", fontsize=9)
        page.insert_text((320, y), f"RIGHT column line {y} Terraform Postgres", fontsize=9)
    out = doc.tobytes()
    doc.close()
    return out


def _unicode_ligature() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    lines = [
        "efficient workflow office fluffy",
        "Résumé — naïve café coöperate",
        "Bullet • dash – emdash — quote “x”",
        "Zoë Ångström  ½ ¼  →  ≥ 100%",
    ]
    for i, line in enumerate(lines):
        page.insert_text((50, 100 + i * 30), line, fontsize=11, fontname="helv")
    out = doc.tobytes()
    doc.close()
    return out


def _table_grid() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    for row in range(12):
        for col in range(4):
            page.insert_text((60 + col * 120, 100 + row * 20), f"r{row}c{col}", fontsize=9)
    out = doc.tobytes()
    doc.close()
    return out


def _image_only() -> bytes:
    """A scanned resume: pixels, no text layer."""
    doc = fitz.open()
    page = doc.new_page()
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 80))
    pixmap.clear_with(200)
    page.insert_image(fitz.Rect(50, 50, 250, 130), pixmap=pixmap)
    out = doc.tobytes()
    doc.close()
    return out


def _multipage(pages: int = 8) -> bytes:
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page()
        for y in range(60, 760, 11):
            page.insert_text(
                (50, y), f"- Shipped feature {y} improving throughput 18% via Kafka and Go", fontsize=8
            )
    out = doc.tobytes()
    doc.close()
    return out


def _rotated() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((60, 400), "SIDEBAR SKILLS Python Go Rust", fontsize=11, rotate=90)
    page.insert_text((150, 100), "Main body content here with metrics 42%", fontsize=11)
    out = doc.tobytes()
    doc.close()
    return out


@pytest.mark.parametrize(
    "name,builder",
    [
        ("two-column", _two_column),
        ("unicode-ligature", _unicode_ligature),
        ("table-grid", _table_grid),
        ("image-only", _image_only),
        ("multipage", _multipage),
    ],
)
def test_pymupdf_matches_pdfplumber(name: str, builder) -> None:
    """The extractors agree on every shape but the one pdfplumber gets wrong."""
    pdf_bytes = builder()
    assert _norm(extract_text("resume.pdf", pdf_bytes)) == _norm(_pdfplumber_text(pdf_bytes)), (
        f"extraction diverged on the {name} fixture"
    )


def test_rotated_text_reads_forwards() -> None:
    """The divergence, asserted in the direction that says which one is right.

    pdfplumber returns "RABEDIS SLLIKS nohtyP oG tsuR" here. Every skill in a
    rotated sidebar is therefore invisible to hard_skill_match, which is the
    heaviest metric in the rubric.
    """
    pdf_bytes = _rotated()
    text = extract_text("resume.pdf", pdf_bytes)

    for skill in ("Python", "Go", "Rust", "SIDEBAR", "SKILLS"):
        assert skill in text, f"{skill!r} missing from rotated-sidebar extraction"

    assert "nohtyP" not in text and "RABEDIS" not in text, "rotated text came back reversed"


def test_image_only_pdf_yields_no_text() -> None:
    """The 'couldn't read any text' refusal depends on this staying empty."""
    assert extract_text("scan.pdf", _image_only()).strip() == ""


def test_extraction_stays_inside_the_latency_budget() -> None:
    """A canary on the regression that motivated the change.

    The deterministic analysis path is budgeted at 100ms end to end. Under
    pdfplumber, extraction alone measured 915ms on this 8-page fixture — nine
    times the budget for the whole request, before any scoring ran.

    The ceiling here is 250ms rather than anything near the measured 5.4ms,
    because CI runners are shared and a tight bound would fail for reasons
    that have nothing to do with this code. It is sized to catch a return to
    the old order of magnitude, not to police milliseconds.
    """
    pdf_bytes = _multipage(8)
    extract_text("resume.pdf", pdf_bytes)  # warm the import

    start = time.perf_counter()
    text = extract_text("resume.pdf", pdf_bytes)
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert text.strip(), "fixture produced no text, so the timing means nothing"
    assert elapsed_ms < 250, (
        f"8-page extraction took {elapsed_ms:.0f}ms; pdfplumber's was 915ms. "
        "Something has put a slow parser back on this path."
    )
