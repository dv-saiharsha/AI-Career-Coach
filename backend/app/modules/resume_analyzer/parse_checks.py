"""Parse-compatibility checks, named by what they verify.

Applicant tracking systems do not score resumes; they extract fields from
them. A resume that a parser cannot read fails before any of its content is
considered, which is why these are reported separately from the rubric.

On what these are NOT: they are not per-vendor verdicts. This product has no
integration with Greenhouse, Workday, iCIMS or any other ATS, so it cannot
report that a document passes one. Rendering "Workday: Pass" would state a
result about software nobody here ran, and a candidate would reasonably rely
on it when deciding whether to fix their layout. What can be verified is the
document itself, and each check below names the specific property it tested.

The requirements are the widely documented ones — a text layer, plain section
headings, a single column, machine-findable contact details. They are general
parser requirements rather than any one vendor's rulebook.

A check whose inputs are missing reports `passed: None`, not failure. "We
could not check this" and "this failed" are different findings, and a resume
marked as failing a check nobody ran sends its owner off to fix nothing.
"""

from app.modules.resume_analyzer.layout_check import (
    MIN_EXTRACTABLE_CHARS,
    check_contact_placement,
    check_glyph_integrity,
    inspect_ats_parsing_readiness,
)
from app.modules.resume_analyzer.quality import parse_end_year
from app.modules.resume_builder.autofill import extract_contact, extract_experiences



def _chronological(resume_text: str) -> dict:
    """Whether roles run newest-first.

    Reverse-chronological is the order recruiters and parsers both expect, and
    unlike "section order" it is a real convention that can be checked: the end
    years either descend or they do not.

    Fewer than two datable roles returns None. One role is trivially in order,
    and reporting a pass there would dress up "nothing to check" as a result.
    """
    years = [
        year
        for role in extract_experiences(resume_text)
        if (year := parse_end_year(role.get("dates") or "")) is not None
    ]
    if len(years) < 2:
        return {"ok": None, "reason": "Fewer than two roles with readable dates, so there is no order to check."}
    descending = all(a >= b for a, b in zip(years, years[1:]))
    return {
        "ok": descending,
        "reason": (
            f"Roles run newest to oldest ({', '.join(str(y) for y in years)})."
            if descending
            else f"Roles are not newest-first ({', '.join(str(y) for y in years)}). "
            "Recruiters read the top entry as your current role."
        ),
    }


def build_checks(resume_text: str, pdf_bytes: bytes | None = None) -> list[dict]:
    readiness = inspect_ats_parsing_readiness(resume_text, pdf_bytes)
    contact = extract_contact(resume_text)
    headers = readiness["detected_headers"]
    chars = readiness["extracted_characters"]
    repeated = [w for w in readiness["warnings"] if "Repeated header" in w["issue"]]
    glyphs = check_glyph_integrity(resume_text)
    placement = check_contact_placement(
        pdf_bytes, [contact["email"], contact["phone"]]
    )
    chronology = _chronological(resume_text)

    return [
        {
            "key": "text_layer",
            "name": "Text layer is extractable",
            "passed": chars >= MIN_EXTRACTABLE_CHARS,
            "detail": f"{chars:,} characters were read out of the file.",
            "why": (
                "A scanned or image-exported PDF has no text to extract, and a parser "
                "reads it as an empty document however good it looks on screen."
            ),
        },
        {
            "key": "headings",
            "name": "Section headings are recognisable",
            "passed": len(headers) >= 2,
            "detail": (
                f"Found {len(headers)}: {', '.join(headers[:5])}."
                if headers
                else "No standard section headings were found."
            ),
            "why": (
                "Parsers locate your experience and education by their headings. Plain "
                "ones on their own line — Experience, Education, Skills — are found; "
                "styled or inline ones often are not."
            ),
        },
        {
            "key": "single_column",
            "name": "Layout is a single column",
            # Genuinely three-valued: without the original PDF the geometry
            # cannot be measured, and text alone cannot tell columns from
            # wide spacing.
            "passed": readiness["is_single_column"],
            "detail": (
                readiness["column_check_skipped_reason"]
                if readiness["is_single_column"] is None
                else "Words form one continuous band down the page."
                if readiness["is_single_column"]
                else "Words split into separate bands with a gap between them."
            ),
            "why": (
                "Parsers read straight across the page. Two columns interleave into "
                "nonsense — a skills sidebar lands inside your job descriptions."
            ),
        },
        {
            "key": "no_repeated_edges",
            "name": "No repeated headers or footers",
            "passed": not repeated,
            "detail": (
                repeated[0]["detail"] if repeated else "No text repeats across pages."
            ),
            "why": "Repeated edge lines are frequently spliced into the body text.",
        },
        {
            "key": "name_found",
            "name": "Your name is machine-findable",
            "passed": bool(contact["name"]),
            "detail": (
                f"Read as \"{contact['name']}\"."
                if contact["name"]
                else "No name could be identified in the header block."
            ),
            "why": (
                "The name field is populated from the top of the document. A name set "
                "in a graphic, a text box or beneath the contact block is often missed."
            ),
        },
        {
            "key": "contact_found",
            "name": "Contact details are machine-findable",
            "passed": bool(contact["email"] or contact["phone"]),
            "detail": ", ".join(
                filter(None, [
                    f"Email: {contact['email']}" if contact["email"] else None,
                    f"Phone: {contact['phone']}" if contact["phone"] else None,
                ])
            ) or "Neither an email address nor a phone number was found near the top.",
            "why": (
                "Contact details in a header, a footer or an image are commonly dropped, "
                "and an application with no reachable address goes nowhere."
            ),
        },
        {
            "key": "contact_placement",
            "name": "Contact details are in the body, not a margin",
            "passed": placement["ok"],
            "detail": placement["reason"],
            "why": (
                "Some parsers read only the body frame of a page. An email in the page "
                "header can survive extraction and still never reach the recruiter."
            ),
        },
        {
            "key": "glyph_integrity",
            "name": "Characters decode to readable text",
            "passed": glyphs["ok"],
            "detail": glyphs["reason"],
            "why": (
                "A font embedded without a unicode mapping extracts as (cid:72)(cid:101) "
                "rather than words. The document looks perfect on screen and arrives as "
                "gibberish — the worst case here, because nothing about it is visible to you."
            ),
        },
        {
            "key": "reverse_chronological",
            "name": "Roles are in reverse-chronological order",
            "passed": chronology["ok"],
            "detail": chronology["reason"],
            "why": (
                "Both parsers and recruiters treat the first role as your current one. "
                "Out-of-order entries put an old job at the top of your history."
            ),
        },
    ]
