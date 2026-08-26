"""Best-effort structured extraction from a parsed resume.

This exists so the builder form arrives filled in. Retyping a resume into a
web form when the PDF is already parsed is the kind of busywork that makes
people abandon a tool, and every field here is one the user had to key by hand.

Everything below is heuristic, and the honest consequence is that it must
never overwrite silently or guess confidently:

  * A field it cannot determine comes back None, not a plausible-looking
    default. A wrong phone number on a resume is worse than a blank one,
    because the user will not think to check a field that looks filled.
  * `confident` reports which fields came from an unambiguous match (an email
    regex) versus a positional guess (the name). The UI marks the guesses so
    they get read rather than trusted.
  * Nothing here is written to the database. It is a read of text the user
    already uploaded, returned for them to correct.

Section segmentation is reused from the analyzer rather than reimplemented —
two parsers disagreeing about where EXPERIENCE ends is a bug that only shows
up on someone else's resume.
"""

import re

from app.modules.resume_analyzer.quality import split_sections

# Contact patterns. These are the reliable half of this module: an email or a
# linkedin.com/in/ URL either matches or does not.
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_LINKEDIN = re.compile(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_-]+/?", re.I)

# Deliberately strict: 10+ digits with common separators. A loose pattern
# matches years, zip codes and bullet metrics ("reduced latency 30-40%"),
# and a resume that autofills a phone number of "2019-2023" is worse than one
# that leaves the field empty.
_PHONE = re.compile(
    r"(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b"
)

# "Austin, TX" / "Toronto, ON" / "Berlin, Germany". Requires the comma —
# without it almost any two capitalised words qualify.
# [ \t] rather than \s throughout: \s matches newlines, so a name on one line
# followed by "Phoenix, AZ" on the next matched as a single location reading
# "Venkata Sai Harshith Danda Phoenix, AZ". Searched per line for the same
# reason.
_LOCATION = re.compile(
    r"\b([A-Z][a-z]+(?:[ \t-][A-Z][a-z]+)*),[ \t]*([A-Z]{2}\b|[A-Z][a-z]+(?:[ \t][A-Z][a-z]+)*)"
)

_URL_ISH = re.compile(r"(https?://|www\.|\.com|\.io|\.dev|@)", re.I)

_SUMMARY_HEADING = re.compile(
    r"^\s*(professional\s+)?(summary|objective|profile|about(\s+me)?)\b", re.I
)

# A date range is what marks the start of a role or a degree. Covers
# "Jan 2020 - Present", "2020–2023", "03/2019 - 06/2021".
_MONTHS = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
_DATE_RANGE = re.compile(
    rf"((?:{_MONTHS}\.?\s*)?(?:\d{{1,2}}[/-])?\d{{4}})\s*(?:[-–—]|to)\s*"
    rf"((?:{_MONTHS}\.?\s*)?(?:\d{{1,2}}[/-])?\d{{4}}|present|current|now)",
    re.I,
)

_BULLET_PREFIX = re.compile(r"^\s*[-•*·▪◦‣o]\s+|^\s*\d+[.)]\s+")

# Guards against a parse that has clearly gone wrong. A "role title" of 200
# characters is a paragraph that happened to contain a date.
MAX_FIELD_CHARS = 120
MAX_BULLET_CHARS = 400
MAX_ENTRIES = 12
MAX_BULLETS_PER_ROLE = 10


def _clean(text: str | None, limit: int = MAX_FIELD_CHARS) -> str | None:
    if not text:
        return None
    value = re.sub(r"\s+", " ", text).strip(" ,|·•-–—\t")
    return value[:limit] or None


def extract_contact(resume_text: str) -> dict:
    """Email, phone, LinkedIn, location and name from the header block.

    Contact details are searched in the whole document because plenty of
    templates put them in a footer or a sidebar. The *name* is searched only
    in the pre-heading block, since the first thing on a resume is the
    candidate's name in practically every layout, and scanning further down
    would happily return a former employer's.
    """
    header = split_sections(resume_text).get("other", "") or resume_text[:600]

    email = _clean(m.group(0) if (m := _EMAIL.search(resume_text)) else None)
    linkedin = _clean(m.group(0) if (m := _LINKEDIN.search(resume_text)) else None)

    # Phone is taken from the header only. Body text is full of numbers that
    # satisfy the pattern — "scaled to 1,500,000 requests" among them.
    phone = _clean(m.group(0) if (m := _PHONE.search(header)) else None)

    location = None
    for line in header.splitlines():
        # Contact lines are commonly pipe-separated, and the city sits in one
        # segment — searching the whole line would let the pattern run from a
        # capitalised word in a previous segment into the city.
        for segment in re.split(r"[|·•]", line):
            if _URL_ISH.search(segment):
                continue
            if m := _LOCATION.search(segment.strip()):
                location = _clean(m.group(0))
                break
        if location:
            break

    name = None
    for line in header.splitlines():
        stripped = line.strip()
        if not stripped or _URL_ISH.search(stripped):
            continue
        if _EMAIL.search(stripped) or _PHONE.search(stripped):
            continue
        words = stripped.split()
        # Two to four words, mostly alphabetic. Titles ("Senior Software
        # Engineer") usually fail the alphabetic-and-capitalised test less
        # cleanly than names do, so this is the least certain field here and
        # is reported as a guess.
        if 2 <= len(words) <= 4 and all(re.fullmatch(r"[A-Za-z.'-]+", w) for w in words):
            name = _clean(stripped)
            break

    return {"name": name, "email": email, "phone": phone, "linkedin": linkedin, "location": location}


def extract_summary(resume_text: str) -> str | None:
    """The paragraph under a SUMMARY/OBJECTIVE/PROFILE heading.

    Only returned when such a heading exists. The alternative — treating the
    longest paragraph near the top as a summary — reliably picks up address
    blocks and skill lists on resumes that have no summary at all.
    """
    lines = (resume_text or "").splitlines()
    for index, line in enumerate(lines):
        if not _SUMMARY_HEADING.match(line.strip()):
            continue
        collected: list[str] = []
        for following in lines[index + 1:]:
            stripped = following.strip()
            if not stripped:
                if collected:
                    break
                continue
            # A new short line that looks like a heading ends the summary.
            if len(stripped.split()) <= 4 and stripped.isupper():
                break
            collected.append(stripped)
            if len(" ".join(collected)) > 600:
                break
        return _clean(" ".join(collected), 600)
    return None


def _split_entries(section_text: str) -> list[list[str]]:
    """Group a section's lines into entries, one per date range.

    A date range is the only reliable entry boundary across resume templates:
    title, company and location swap order constantly, but "2021 - Present"
    appears on the header line of every role. Lines before the first date
    range belong to that first entry — many layouts put the title above it.
    """
    lines = [ln for ln in (section_text or "").splitlines()]
    entries: list[list[str]] = []
    current: list[str] = []

    for line in lines:
        if not line.strip():
            continue
        starts_entry = bool(_DATE_RANGE.search(line)) and not _BULLET_PREFIX.match(line)
        if starts_entry and current and any(_DATE_RANGE.search(ln) for ln in current):
            entries.append(current)
            current = [line]
        else:
            current.append(line)

    if current:
        entries.append(current)
    return entries[:MAX_ENTRIES]


def extract_experiences(resume_text: str) -> list[dict]:
    """Roles with their bullets, from the EXPERIENCE section.

    Returns [] when no experience section was recognised, rather than
    scavenging the whole document — a false role is more work to delete than a
    missing one is to add.
    """
    section = split_sections(resume_text).get("experience", "")
    results: list[dict] = []

    for entry in _split_entries(section):
        header_lines = [ln for ln in entry if not _BULLET_PREFIX.match(ln)]
        bullets = [
            _clean(_BULLET_PREFIX.sub("", ln), MAX_BULLET_CHARS)
            for ln in entry
            if _BULLET_PREFIX.match(ln)
        ]
        bullets = [b for b in bullets if b][:MAX_BULLETS_PER_ROLE]

        dates = None
        remainder: list[str] = []
        for line in header_lines:
            if (m := _DATE_RANGE.search(line)) and dates is None:
                dates = _clean(m.group(0))
                # Whatever shared the line with the date is usually the title
                # or the company, so it is kept rather than discarded.
                rest = _clean(line[: m.start()] + " " + line[m.end():])
                if rest:
                    remainder.append(rest)
            else:
                cleaned = _clean(line)
                if cleaned:
                    remainder.append(cleaned)

        if not dates and not bullets:
            continue

        # Order varies by template and cannot be told apart reliably, so the
        # first two non-date fragments are taken positionally and the user
        # corrects them. This is why `confident` never includes experience.
        title = remainder[0] if remainder else None
        company = remainder[1] if len(remainder) > 1 else None

        # "Senior Software Engineer, Stripe" is one line in many templates, so
        # a title carrying a separator is split rather than left whole with an
        # empty company beside it. Only when company is otherwise unknown —
        # a real two-line layout already has the better answer.
        if title and not company:
            if parts := re.split(r"\s*(?:[|•·–—]|,|\bat\b)\s*", title, maxsplit=1):
                if len(parts) == 2 and all(p.strip() for p in parts):
                    title, company = _clean(parts[0]), _clean(parts[1])

        results.append(
            {
                "title": title or "",
                "company": company or "",
                "dates": dates or "",
                "bullets": bullets,
            }
        )

    return results


def extract_education(resume_text: str) -> list[dict]:
    """Degrees from the EDUCATION section, same entry-splitting rules."""
    section = split_sections(resume_text).get("education", "")
    results: list[dict] = []

    for entry in _split_entries(section):
        dates = None
        remainder: list[str] = []
        for line in entry:
            if _BULLET_PREFIX.match(line):
                continue
            if (m := _DATE_RANGE.search(line)) and dates is None:
                dates = _clean(m.group(0))
                rest = _clean(line[: m.start()] + " " + line[m.end():])
                if rest:
                    remainder.append(rest)
            else:
                # A bare graduation year is common and is not a range.
                if dates is None and (y := re.search(r"\b(19|20)\d{2}\b", line)):
                    dates = y.group(0)
                    rest = _clean(line[: y.start()] + " " + line[y.end():])
                    if rest:
                        remainder.append(rest)
                    continue
                cleaned = _clean(line)
                if cleaned:
                    remainder.append(cleaned)

        if not remainder:
            continue
        results.append(
            {
                "degree": remainder[0] if remainder else "",
                "institution": remainder[1] if len(remainder) > 1 else "",
                "dates": dates or "",
            }
        )

    return results


def build_autofill(resume_text: str) -> dict:
    """Everything the builder form can be pre-filled with.

    `confident` lists only the fields matched by an unambiguous pattern. The
    rest are positional guesses, and the UI says so — a user who is told the
    name was guessed will read it, where one shown a filled box will not.
    """
    contact = extract_contact(resume_text)
    experiences = extract_experiences(resume_text)
    education = extract_education(resume_text)
    summary = extract_summary(resume_text)

    confident = [key for key in ("email", "phone", "linkedin") if contact.get(key)]
    if summary:
        confident.append("summary")

    return {
        **contact,
        "summary": summary,
        "experiences": experiences,
        "education": education,
        "confident_fields": confident,
        # Lets the UI say "we couldn't read your roles" instead of silently
        # showing an empty form that looks like nothing was tried.
        "parsed_experience_count": len(experiences),
        "parsed_education_count": len(education),
    }
