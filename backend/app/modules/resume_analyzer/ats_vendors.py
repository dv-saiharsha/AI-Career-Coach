"""Per-vendor ATS compatibility, built from checks we actually run.

WHY THIS IS NOT A SCORE PER VENDOR

Competing products display something like "Greenhouse 72, Taleo 79, Workday
78". Those numbers cannot be what they appear to be. Greenhouse's parser is
proprietary and not available to score against; nobody outside these companies
can produce a calibrated 0-100 for how their specific system rates a document.
A number that precise, with no way to have measured it, is the kind of figure
a candidate would most regret trusting — they would rewrite a CV to move it.

What CAN be done honestly is the more useful half anyway. Two separate things
combine here, and the distinction is kept visible in the output:

  MEASURED     Facts about this specific PDF, from layout_check.py: is it
               single-column, do the glyphs extract, is the contact block in
               the body rather than a margin, which section headers survive
               extraction, does any text repeat across pages. Every one is
               computed from the user's actual file.

  DOCUMENTED   Which of those a given ATS is known to be sensitive to. This is
               widely-reported behaviour of these systems, not something this
               codebase measured, and `evidence` says so per vendor rather
               than letting it read as a lab result.

So "your two-column layout will interleave in Taleo" is a measured fact about
the file plus a documented property of the system. "Taleo: 79" is neither.

The number reported per vendor is the share of that vendor's applicable checks
the document passes — 5 of 6 is 83%, and the six are listed. It is arithmetic
the user can verify, not a model output.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Vendor:
    name: str
    # Which checks this system is reported to be sensitive to. Names match the
    # keys produced by evaluate() below.
    sensitive_to: tuple[str, ...]
    # Why, in one line, so the UI can explain rather than assert.
    evidence: str


# Ordered roughly oldest-and-most-brittle to newest. The older systems predate
# modern layout parsing and are where most real rejections happen.
VENDORS: tuple[Vendor, ...] = (
    Vendor(
        name="Taleo",
        sensitive_to=("single_column", "glyphs", "section_headers", "contact_placement", "repeated_lines"),
        evidence=(
            "Oracle Taleo is the oldest of the major systems and the least tolerant of "
            "layout. Multi-column and table-based resumes are widely reported to "
            "interleave, and it relies on conventional section headings to route content."
        ),
    ),
    Vendor(
        name="iCIMS",
        sensitive_to=("single_column", "glyphs", "section_headers"),
        evidence=(
            "Reported to handle single-column documents reliably and to mis-order "
            "multi-column ones, with content routing driven by recognisable headings."
        ),
    ),
    Vendor(
        name="Workday",
        sensitive_to=("glyphs", "section_headers", "repeated_lines"),
        evidence=(
            "Generally robust on layout, but relies on section headings for field "
            "mapping and is reported to splice running headers and footers into the body."
        ),
    ),
    Vendor(
        name="Greenhouse",
        sensitive_to=("glyphs", "contact_placement"),
        evidence=(
            "Modern text extraction that copes with most layouts. The failure that still "
            "bites is a PDF whose fonts carry no ToUnicode map, which extracts as noise."
        ),
    ),
    Vendor(
        name="Lever",
        sensitive_to=("glyphs", "contact_placement"),
        evidence="Modern parser; the practical risks are unextractable glyphs and contact details placed in a margin.",
    ),
    Vendor(
        name="SmartRecruiters",
        sensitive_to=("glyphs", "section_headers"),
        evidence="Modern parser that still maps content to fields using section headings.",
    ),
)

# Human-readable names for the checks, so the UI never has to invent copy.
CHECK_LABELS = {
    "single_column": "Single-column layout",
    "glyphs": "Text extracts as real characters",
    "section_headers": "Standard section headings present",
    "contact_placement": "Contact details in the body, not a margin",
    "repeated_lines": "No running header or footer",
}


def _check_results(readiness: dict, glyphs: dict, contact: dict) -> dict[str, bool | None]:
    """The measured facts, as three-valued pass / fail / not-checked.

    None means the check could not run — a DOCX has no page geometry, a scan
    that predates byte storage has no file to inspect. It is deliberately not
    collapsed into False: reporting an unverified document as failing would be
    a claim with no evidence, which is the mistake this whole module exists to
    avoid.
    """
    warnings = readiness.get("warnings") or []
    has_repeated = any("header or footer" in (w.get("issue") or "").lower() for w in warnings)

    # Section headings the extractor actually found in the text.
    detected = {h.lower() for h in (readiness.get("detected_headers") or [])}
    essential = {"experience", "education", "skills"}
    headers_ok = essential.issubset(detected) if detected else None

    contact_ok = contact.get("ok")

    return {
        "single_column": readiness.get("is_single_column"),
        "glyphs": glyphs.get("ok"),
        "section_headers": headers_ok,
        "contact_placement": contact_ok if contact_ok is not None else None,
        # Absence of a warning is a pass only when the check ran at all, which
        # it does whenever there is a PDF to inspect.
        "repeated_lines": (not has_repeated) if readiness.get("extracted_characters") else None,
    }


def evaluate(readiness: dict, glyphs: dict, contact: dict) -> dict:
    """Per-vendor compatibility for one resume.

    Returns the shared measured checks once, then per vendor the subset that
    applies to it, so the UI can show both "what is true of this file" and
    "what that means for this system" without recomputing anything.
    """
    results = _check_results(readiness, glyphs, contact)

    vendors = []
    for vendor in VENDORS:
        applicable = [name for name in vendor.sensitive_to if results.get(name) is not None]
        failed = [name for name in applicable if results[name] is False]
        unchecked = [name for name in vendor.sensitive_to if results.get(name) is None]

        vendors.append(
            {
                "name": vendor.name,
                "evidence": vendor.evidence,
                # Arithmetic the reader can verify: passes over checks that ran.
                # None rather than 100 when nothing could be checked — an
                # unexamined document is not a clean one.
                "passed": len(applicable) - len(failed),
                "applicable": len(applicable),
                "percent": (
                    round((len(applicable) - len(failed)) / len(applicable) * 100)
                    if applicable
                    else None
                ),
                "failures": [
                    {"check": name, "label": CHECK_LABELS[name]} for name in failed
                ],
                "not_checked": [
                    {"check": name, "label": CHECK_LABELS[name]} for name in unchecked
                ],
                # The headline a UI can show without interpreting anything.
                "verdict": (
                    "not checked"
                    if not applicable
                    else "will parse cleanly"
                    if not failed
                    else "will lose content"
                ),
            }
        )

    return {
        "checks": [
            {"check": name, "label": CHECK_LABELS[name], "result": value}
            for name, value in results.items()
        ],
        "vendors": vendors,
        # Stated rather than implied. These systems are proprietary; the checks
        # are measured on the file, the mapping to each system is reported
        # behaviour, and conflating the two would be the fabrication this
        # module was written to avoid.
        "methodology": (
            "Checks are measured on your actual PDF. Which checks matter to each "
            "system is based on that system's widely-reported parsing behaviour, "
            "not on testing against the system itself — these parsers are "
            "proprietary and cannot be scored directly."
        ),
    }
