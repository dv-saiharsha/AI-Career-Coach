"""ATS parsing readiness: does the document survive text extraction intact?

This is about *structure*, not content. A resume can name every keyword a job
asks for and still score badly with a real ATS because the parser reads a
two-column layout as interleaved gibberish, or because the text is an image.

Column detection uses actual word coordinates from PyMuPDF, not a heuristic on
line lengths. Counting short lines can't distinguish a two-column layout from a
one-column resume that lists skills one per line — and the second is common and
perfectly fine. Word x-positions can: a two-column page has words clustered in
two bands with an empty gutter between them, and a single-column page does not.

Requires the original PDF bytes. Falls back to text-only checks when a scan
predates resume_file_bytes, and says so rather than reporting a column verdict
it has no evidence for.
"""

import re
from collections import Counter

# Matched against a normalised heading line. Broader than a minimal set on
# purpose: "Professional Experience" and "Employment History" are both entirely
# standard, and flagging them as non-standard would be a false warning on a
# well-built resume.
STANDARD_HEADERS = {
    "experience", "work experience", "professional experience", "employment",
    "employment history", "work history", "relevant experience",
    "education", "academic background",
    "skills", "technical skills", "core skills", "key skills", "technologies",
    "core competencies", "technical proficiencies", "areas of expertise",
    "projects", "personal projects", "academic projects", "selected projects",
    "summary", "professional summary", "profile", "objective", "about",
    "certifications", "certification", "licenses", "credentials",
    "publications", "awards", "achievements", "honors", "volunteer",
    "leadership", "activities", "interests", "references",
}

# A heading is short. Without a cap, a sentence containing "experience" would
# register as a section header.
_MAX_HEADING_WORDS = 5

# Below this, extraction has effectively failed — the file is a scan, a vector
# outline, or otherwise not machine-readable. A real one-page resume runs well
# over a thousand characters.
MIN_EXTRACTABLE_CHARS = 300

# Fraction of page width that must be empty for a gap to count as a gutter.
# 6% of ~612pt is ~37pt, wider than any inter-word space and narrower than the
# whitespace a genuine column break leaves.
_MIN_GUTTER_RATIO = 0.06

# A gutter that only separates a handful of words is a tab stop (dates on the
# right), not a column. Both sides need real volume.
_MIN_SIDE_SHARE = 0.20


def _normalise_heading(line: str) -> str:
    return re.sub(r"[^a-z& ]", " ", line.strip().lower()).strip()


def find_headers(lines: list[str]) -> list[str]:
    found: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or len(stripped.split()) > _MAX_HEADING_WORDS:
            continue
        normalised = _normalise_heading(stripped)
        normalised = re.sub(r"\s+", " ", normalised)
        if normalised in STANDARD_HEADERS:
            found.add(normalised)
    return sorted(found)


def detect_columns(pdf_bytes: bytes) -> dict:
    """Look for a vertical gutter splitting each page's words into two bands.

    Returns `checked: False` when the PDF can't be opened, so the caller
    reports "not checked" rather than "single column" — an unverified pass is
    worse than an honest gap.
    """
    try:
        import fitz
    except ImportError:  # pragma: no cover - PyMuPDF is a hard dependency
        return {"checked": False, "reason": "PyMuPDF unavailable", "multi_column_pages": []}

    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return {"checked": False, "reason": "Could not open the PDF", "multi_column_pages": []}

    multi_column_pages: list[int] = []
    try:
        for index, page in enumerate(document):
            width = page.rect.width or 1
            words = page.get_text("words")  # (x0, y0, x1, y1, word, ...)
            if len(words) < 40:
                # Too little text on the page to judge; a sparse cover page
                # shouldn't produce a column warning.
                continue

            # Occupancy histogram across the page width. A column break shows
            # up as a run of empty bins between two populated regions.
            bins = 50
            occupied = [False] * bins
            for word in words:
                start = max(0, min(bins - 1, int(word[0] / width * bins)))
                end = max(0, min(bins - 1, int(word[2] / width * bins)))
                for b in range(start, end + 1):
                    occupied[b] = True

            # Longest empty run that isn't the page margins.
            first = next((i for i, o in enumerate(occupied) if o), 0)
            last = next((i for i in range(bins - 1, -1, -1) if occupied[i]), bins - 1)

            best_gap, best_start, current, current_start = 0, 0, 0, first
            for i in range(first, last + 1):
                if not occupied[i]:
                    if current == 0:
                        current_start = i
                    current += 1
                    if current > best_gap:
                        best_gap, best_start = current, current_start
                else:
                    current = 0

            if best_gap / bins < _MIN_GUTTER_RATIO:
                continue

            # Both sides must carry real content — otherwise this is a tab
            # stop for right-aligned dates, not a column layout.
            split_x = (best_start + best_gap / 2) / bins * width
            left = sum(1 for w in words if w[2] <= split_x)
            right = len(words) - left
            share = min(left, right) / len(words)
            if share >= _MIN_SIDE_SHARE:
                multi_column_pages.append(index + 1)
    finally:
        document.close()

    return {"checked": True, "reason": None, "multi_column_pages": multi_column_pages}


# Fraction of page height treated as the header/footer band.
_EDGE_BAND = 0.12


def _repeated_edge_lines(pdf_bytes: bytes | None) -> list[str]:
    """Short lines that repeat in the top/bottom margin of multiple pages.

    Page-aware on purpose. Counting repeats in flat extracted text cannot tell
    a running header from a phrase a candidate happens to reuse in several
    bullets on one page — and flagging the second as a formatting defect would
    be a false warning on a perfectly good resume. Requires two pages before
    anything can qualify, since a one-page resume has no running header by
    definition.
    """
    if not pdf_bytes:
        return []
    try:
        import fitz

        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return []

    try:
        if document.page_count < 2:
            return []

        # Per page, the set of distinct edge-band lines. A set so one page
        # repeating a line internally contributes it only once.
        per_page: list[set[str]] = []
        for page in document:
            height = page.rect.height or 1
            edge: set[str] = set()
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    y = line["bbox"][1]
                    if y > height * _EDGE_BAND and y < height * (1 - _EDGE_BAND):
                        continue
                    text = "".join(span["text"] for span in line["spans"]).strip()
                    if 0 < len(text) <= 60:
                        edge.add(text)
            per_page.append(edge)

        counts = Counter(text for page_lines in per_page for text in page_lines)
        return sorted({text for text, count in counts.items() if count >= 2})
    finally:
        document.close()


def inspect_ats_parsing_readiness(
    raw_text: str,
    pdf_bytes: bytes | None = None,
) -> dict:
    """Score 0-100 for how cleanly this document is likely to be parsed.

    Starts at 100 and deducts for concrete, named defects, so the score always
    corresponds to a list the user can act on. Nothing is deducted for a check
    that could not run.
    """
    text = raw_text or ""
    lines = text.splitlines()

    warnings: list[dict] = []
    score = 100.0

    # 1. Extractability. Checked first because if this fails, every other
    #    signal below is measuring an empty string.
    stripped = text.strip()
    if len(stripped) < MIN_EXTRACTABLE_CHARS:
        score -= 45.0
        warnings.append({
            "severity": "critical",
            "issue": "Almost no text could be extracted",
            "detail": (
                f"Only {len(stripped)} characters came out of this file. It's most likely a "
                "scan or an image export, which most ATS parsers read as an empty document. "
                "Export it again as a text-based PDF."
            ),
        })

    # 2. Section headers.
    headers = find_headers(lines)
    if len(headers) < 2:
        score -= 20.0
        warnings.append({
            "severity": "high",
            "issue": "Standard section headings not found",
            "detail": (
                "Parsers locate your experience and education by their headings. Use plain ones "
                "on their own line — Work Experience, Education, Technical Skills."
            ),
        })

    # 3. Columns — real geometry when the PDF is available.
    column_result = {"checked": False, "reason": "No PDF stored for this scan", "multi_column_pages": []}
    if pdf_bytes:
        column_result = detect_columns(pdf_bytes)
        if column_result["multi_column_pages"]:
            score -= 25.0
            pages = ", ".join(str(p) for p in column_result["multi_column_pages"])
            warnings.append({
                "severity": "high",
                "issue": f"Multi-column layout on page {pages}",
                "detail": (
                    "Words are split into two bands with a gap between them. Parsers read across "
                    "that gap, interleaving the columns into nonsense. Use a single column."
                ),
            })

    # 4. Running headers/footers.
    repeated = _repeated_edge_lines(pdf_bytes)
    if repeated:
        score -= 10.0
        warnings.append({
            "severity": "medium",
            "issue": "Repeated header or footer text",
            "detail": (
                f"{len(repeated)} line(s) repeat across pages (e.g. \"{repeated[0][:40]}\"). "
                "Parsers often splice these into the body. Keep headers minimal."
            ),
        })

    return {
        "parsing_readiness_score": round(max(0.0, score), 1),
        "detected_headers": headers,
        "warnings": warnings,
        # Explicitly three-valued: True, False, or None for "couldn't check".
        # Reporting an unverified document as single-column would be a claim
        # with no evidence behind it.
        "is_single_column": (
            None if not column_result["checked"] else not column_result["multi_column_pages"]
        ),
        "column_check_skipped_reason": column_result["reason"],
        "extracted_characters": len(stripped),
    }
