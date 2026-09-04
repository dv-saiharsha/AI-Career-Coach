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

# Words that name a job, and words that name an employer. Used to tell a
# title from a company by what the line SAYS rather than where it sits,
# because where it sits is genuinely not reliable — the same resume puts the
# company above the dates and the title below them, and the next template
# does the reverse.
_ROLE_WORDS = re.compile(
    r"\b(engineer|developer|scientist|analyst|manager|director|intern(?:ship)?|"
    r"assistant|consultant|architect|designer|lead|specialist|administrator|"
    r"researcher|associate|officer|founder|head|coordinator|technician|"
    r"programmer|strategist|advisor|apprentice|fellow|trainee)\b",
    re.I,
)
_ORG_WORDS = re.compile(
    r"\b(inc|llc|ltd|corp|corporation|university|college|institute|labs?|"
    r"technologies|technology|systems|solutions|group|company|holdings|"
    r"gmbh|plc|foundation|hospital|bank|school)\b",
    re.I,
)

# A line long enough to be a sentence rather than a heading. Bullet markers do
# not survive PDF text extraction — the • is a glyph, not a character in the
# content stream — so length and terminal punctuation are what is left to
# separate a role's body from its header.
PROSE_MIN_CHARS = 55

# How long a title/company line carried across an entry boundary is allowed
# to be (see _split_entries) — looser than PROSE_MIN_CHARS on purpose. A
# project title ("SmartGroc – Intelligent Grocery & Expense Management
# Platform", 63 characters) can run well past a typical header line without
# becoming a sentence; a wrapped bullet's first physical line, the thing this
# still has to exclude, tends to run considerably longer than that because it
# took most of a full page width before wrapping.
MAX_CARRIED_HEADER_CHARS = 80

# A bare list of tools ("Python, Flask, SQL, REST APIs, JavaScript, HTML/CSS")
# — the line _split_header_and_bullets uses to recognise a sub-project
# header appearing mid-role (see its docstring). Short, no sentence-ending
# punctuation anywhere in it, and at least one comma — a real sentence that
# happens to contain a comma still runs on well past 80 characters.
_TECH_STACK_LINE = re.compile(r"^(?=.{1,80}$)[^.!?;:]*,[^.!?;:]*$")

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
        # Two to six words, alphabetic.
        #
        # The cap was four, and "Shiva Venkata Raj Chowdary Valluri" is five —
        # so the header of a real CV produced no name at all, and the built
        # resume was printed with a blank or a fragment where the candidate's
        # name belongs. Four words is not a property of names; it is a
        # property of the naming convention the author happened to have in
        # mind, and it fails on South Asian, Hispanic and Portuguese names
        # among others.
        #
        # A role word is the real guard against matching a job title, and it
        # is one the old range never provided: "Senior Software Engineer" is
        # three words and passed the count test cleanly.
        if (
            2 <= len(words) <= 6
            and all(re.fullmatch(r"[A-Za-z.'-]+", w) for w in words)
            and not _ROLE_WORDS.search(stripped)
        ):
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
            # The employer's name usually sits on the line ABOVE the dates, so
            # a clean cut at the date line leaves it stranded at the end of
            # the previous role — which then reports no company at all. Any
            # short non-prose lines trailing the previous entry are handed to
            # the new one instead. Bounded at two so a genuinely short final
            # bullet cannot drag real content across the boundary.
            carried: list[str] = []
            while (
                len(carried) < 2
                and current
                and len(current[-1].strip()) < MAX_CARRIED_HEADER_CHARS
                # A wrapped bullet's continuation starts lower-case — it is
                # the back half of a sentence, never a title or company.
                # Found by running a real resume through this parser: a
                # 63-character project title ("SmartGroc – Intelligent
                # Grocery & Expense Management Platform") failed the old,
                # tighter PROSE_MIN_CHARS cutoff and was left stranded as the
                # previous role's bogus trailing bullet, leaving the next
                # entry with no title at all. The case check is what actually
                # tells a title from a sentence fragment; length alone was
                # never able to draw that line correctly for both.
                and not current[-1].strip()[:1].islower()
                # A short line ending in a full stop is the tail of a wrapped
                # bullet, not an employer. Without this the last fragment of
                # the previous role's final bullet becomes the next role's
                # company — "pipeline execution time by 40%." as an employer.
                and not current[-1].strip().endswith((".", "!", "?", ";", ":"))
                and not _DATE_RANGE.search(current[-1])
                and not _BULLET_PREFIX.match(current[-1])
                and any(_DATE_RANGE.search(ln) for ln in current[:-1])
            ):
                carried.insert(0, current.pop())

            entries.append(current)
            current = [*carried, line]
        else:
            current.append(line)

    if current:
        entries.append(current)
    return entries[:MAX_ENTRIES]


def _split_header_and_bullets(entry: list[str]) -> tuple[list[str], list[str]]:
    """One role's lines, divided into its header block and its bullets.

    WHY THIS CANNOT JUST LOOK FOR BULLET CHARACTERS

    It used to, and that produced the bug this function exists to fix. A PDF
    draws "•" as a glyph; it is frequently absent from the extracted text
    stream. So on a real uploaded CV every bullet failed the marker test,
    fell through into the header block, and the second bullet was read as the
    employer's name. The generated resume then said the candidate worked at
    "Implemented secure user authentication and middleware-based
    authorization controls".

    What survives extraction is shape. A header line is short and has no
    sentence punctuation; a bullet is a sentence. Once the first sentence
    appears, everything after it in the entry is body — with one exception,
    found running a real resume through this parser: a role that bundles
    several sub-projects under one date range repeats its own mini-header
    (a title-shaped line, then a tools line — "Workflow Automation &
    Operations Dashboard" / "Python, Flask, SQL, REST APIs, JavaScript,
    HTML/CSS") between each one. The old version had nowhere for that to go
    but the bullet list, so it printed as if it were an achievement
    ("• Workflow Automation & Operations Dashboard Python, Flask, SQL...").
    Recognised by the same title-shape as above plus the tools-line lookahead
    and dropped outright — there is no field in this schema for a
    sub-project heading, and a wrong field is worse than a missing one.

    Wrapped lines are rejoined on that same basis, but a marker only ever
    closes the bullet BEFORE it, never the one it starts: two marked lines in
    a row are always two separate bullets, even when the first has no
    terminal punctuation — real bullets routinely end "...by 40%" with no
    full stop, and merging those would silently fuse two separate
    achievements into one. But a marked line followed by an UNMARKED one is
    exactly the wrapped-bullet case: the marker survived on the first physical
    line of a bullet that word-wrapped in the source PDF, and the second
    physical line carries no marker of its own. Confirmed against a real
    resume in production: five wrapped bullets each split into two — one
    ending mid-clause ("...case assignment, user") and the next starting
    lower-case with the rest of the same sentence ("tracking, and
    service-level agreement (SLA) workflows.") — because the old version
    flushed every marked line immediately, before it had a chance to pick up
    the continuation that followed it.
    """
    header: list[str] = []
    # (text, had_an_explicit_marker) — the marker is what decides whether a
    # line is ever eligible to be merged into its neighbour below.
    body: list[tuple[str, bool]] = []
    in_body = False

    lines = [raw.strip() for raw in entry]
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line:
            i += 1
            continue

        if _BULLET_PREFIX.match(line):
            # A marker did survive. Unambiguous, and it also proves the body
            # has started.
            in_body = True
            body.append((_BULLET_PREFIX.sub("", line), True))
            i += 1
            continue

        if not in_body:
            # A title immediately followed by its own dates is header
            # material whatever its length — found by running a real resume
            # through this parser: a 63-character project title carried
            # across an entry boundary (see _split_entries) still needs to
            # survive THIS check too, and length alone cannot tell it apart
            # from a real bullet's long first line (both are capitalised,
            # unpunctuated prose by this measure). A bullet is never
            # immediately followed by a second date line — dates appear once,
            # at the top of an entry — so that adjacency is the one signal
            # that resolves the ambiguity without weakening the original
            # length check for every other line.
            next_is_date = i + 1 < len(lines) and bool(_DATE_RANGE.search(lines[i + 1]))
            is_prose = (
                not next_is_date
                and len(line) >= PROSE_MIN_CHARS
                and not _DATE_RANGE.search(line)
            )
            if not is_prose:
                header.append(line)
                i += 1
                continue
            in_body = True
        elif (
            not line[:1].islower()
            and len(line) < MAX_CARRIED_HEADER_CHARS
            and not line.endswith((".", "!", "?", ";", ":"))
            and _TECH_STACK_LINE.match(lines[i + 1] if i + 1 < len(lines) else "")
        ):
            # A sub-project header appearing after the body has already
            # started — see docstring. Drop it and the tools line right
            # after it rather than filing either as a bullet.
            i += 2
            continue

        body.append((line, False))
        i += 1

    # A marked line closes any pending buffer and starts a new one — two
    # marked lines are always two bullets, whatever punctuation either ends
    # with. An unmarked line only ever extends the buffer already open: at
    # the top of an entry that is the sentence-accumulation case above; after
    # a marked line it is that same bullet's wrapped continuation. Either way
    # the buffer is not closed until it actually ends in terminal punctuation
    # — a marked line is not "unambiguous on its own" just because it has a
    # marker, only because nothing after it claims to continue it.
    bullets: list[str] = []
    buffer = ""
    for text, had_marker in body:
        if had_marker:
            if buffer:
                bullets.append(buffer)
            buffer = text
        else:
            buffer = f"{buffer} {text}".strip() if buffer else text
        if buffer.endswith((".", "!", "?", ";")):
            bullets.append(buffer)
            buffer = ""
    if buffer:
        bullets.append(buffer)

    cleaned = [c for c in (_clean(b, MAX_BULLET_CHARS) for b in bullets) if c]
    return header, cleaned[:MAX_BULLETS_PER_ROLE]


def _title_and_company(fragments: list[str]) -> tuple[str | None, str | None]:
    """Which fragment is the job and which is the employer.

    Decided by vocabulary, not position. Position was the old rule and it is
    wrong about half the time by construction: this resume reads
    company / dates / title, the next reads title / company / dates, and
    taking fragments[0] as the title silently swaps the two on everything in
    the first group.

    "Research Assistant - Arizona State University" contains both a role word
    and an org word, and "Arizona State University" contains only the org
    word — so a role word is what decides, and the employer is whatever is
    left rather than whatever came second.
    """
    if not fragments:
        return None, None

    titles = [f for f in fragments if _ROLE_WORDS.search(f)]
    if titles:
        title = titles[0]
        rest = [f for f in fragments if f is not title]
        # Prefer an explicit organisation name for the employer; otherwise the
        # nearest remaining fragment.
        company = next((f for f in rest if _ORG_WORDS.search(f)), rest[0] if rest else None)
    else:
        # No role word anywhere. Fall back to the old positional reading,
        # which is a guess, but an ordered one.
        title = fragments[0]
        company = fragments[1] if len(fragments) > 1 else None

    # Templates that repeat the employer inside the title ("Research Assistant
    # - Arizona State University") would otherwise print it twice on one line.
    if title and company:
        trimmed = re.sub(
            rf"\s*[-–—|,]\s*{re.escape(company)}\s*$", "", title, flags=re.I
        ).strip()
        if trimmed:
            title = trimmed

    return _clean(title), _clean(company)


def extract_experiences(resume_text: str) -> list[dict]:
    """Roles with their bullets, from the EXPERIENCE section.

    Returns [] when no experience section was recognised, rather than
    scavenging the whole document — a false role is more work to delete than a
    missing one is to add.
    """
    section = split_sections(resume_text).get("experience", "")
    results: list[dict] = []

    for entry in _split_entries(section):
        header_lines, bullets = _split_header_and_bullets(entry)

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

        title, company = _title_and_company(remainder)

        # "Senior Software Engineer, Stripe" is one line in many templates, so
        # a title carrying a separator is split rather than left whole with an
        # empty company beside it. Only when company is otherwise unknown —
        # a real two-line layout already has the better answer.
        if title and not company:
            # The plain hyphen belongs here: "Software Engineer - Microsoft"
            # is the commonest form of this. But it must require whitespace on
            # both sides to count — found by running a real resume through
            # this parser: "AI-Based Phishing & Cyber-Threat Detection System"
            # is a single project title with a compound word in it, and the
            # old pattern matched that internal hyphen too (no whitespace
            # required around it), splitting the title into "AI" / "Based
            # Phishing & Cyber-Threat Detection System". The typographic
            # dashes and the other separators are unambiguous even without
            # spaces — nobody writes them mid-word — so only the plain
            # hyphen needs the extra constraint.
            if parts := re.split(
                r"\s*(?:[|•·–—]|,|\bat\b)\s*|\s+-\s+", title, maxsplit=1
            ):
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


def _split_education_entries(section_text: str) -> list[list[str]]:
    """Group an EDUCATION section's lines into one block per degree.

    Deliberately not _split_entries. That function treats a date as the
    START of a new entry, which is right for experience — the date sits on
    the same header line as the title, with bullets still to come — and
    wrong for education, where a resume commonly writes

        Arizona State University, Tempe, AZ | Master of Science | GPA: 4.0
        2024 - 2026
        Koneru Lakshmaiah University, ... | Bachelor of Technology | GPA: 9.0
        2020 - 2024

    Here the date is the LAST line of the entry it belongs to, not the
    first line of the next one. Reusing the experience rule merged both
    degrees into a single entry — the date line "2024 - 2026" was appended
    to the school above it and did not become a boundary until a second
    date was reached, by which point the second school's name had already
    been swept into the first entry's remainder.

    So here a date — range or bare year — closes whatever entry it is part
    of. Education blocks have no bullets to protect, which is what makes
    this simpler rule safe for this section specifically.
    """
    entries: list[list[str]] = []
    current: list[str] = []

    for line in (section_text or "").splitlines():
        if not line.strip():
            continue
        current.append(line)
        if _DATE_RANGE.search(line) or re.search(r"\b(19|20)\d{2}\b", line):
            entries.append(current)
            current = []

    if current:
        entries.append(current)
    return entries[:MAX_ENTRIES]


def _institution_and_degree(lines: list[str]) -> tuple[str | None, str | None]:
    """One or several header lines, split by what each segment names.

    "Arizona State University, Tempe, AZ | Master of Science | GPA: 4.0"
    has no positional label saying which half is the school — so, as with
    _title_and_company, the segment naming an institution (a word like
    "University" or "College") is taken as the institution and the rest is
    kept together as the degree, GPA included, rather than discarded.

    Takes every remaining line, not just a single pipe-joined one — found by
    running a real resume through this parser: its EDUCATION entry was three
    separate lines ("Arizona State University" / "Tempe, AZ" / "Master of
    Science in Information Technology | GPA: 4.0/4.0"), and the old version
    only ever looked at remainder[0] and remainder[1] positionally whenever
    there was more than one line — reporting the institution AS the degree,
    the location AS the institution, and silently dropping the real degree
    line altogether.
    """
    segments = [s.strip() for line in lines for s in line.split("|") if s.strip()]
    if len(segments) < 2:
        return None, None

    institution = next((s for s in segments if _ORG_WORDS.search(s)), None)
    if not institution:
        return None, None

    degree = ", ".join(s for s in segments if s != institution)
    return _clean(institution), _clean(degree) or None


def extract_education(resume_text: str) -> list[dict]:
    """Degrees from the EDUCATION section."""
    section = split_sections(resume_text).get("education", "")
    results: list[dict] = []

    for entry in _split_education_entries(section):
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
                # A combined "School | Degree | GPA" line legitimately runs
                # past MAX_FIELD_CHARS (120) — this one real example is 133 —
                # and the default limit truncated it to "GPA: 9." before
                # _institution_and_degree ever got to split it on "|". The
                # institution and degree are re-cleaned to the normal length
                # individually once they are apart; only the combined,
                # still-unsplit line needs the longer allowance.
                cleaned = _clean(line, limit=300)
                if cleaned:
                    remainder.append(cleaned)

        if not remainder:
            continue

        # "School | Degree | GPA" split across one line or several — split by
        # content whenever a segment names an institution, rather than
        # reporting the whole thing as the degree with no institution at all.
        institution, degree = _institution_and_degree(remainder)

        results.append(
            {
                "degree": degree or (remainder[0] if remainder else ""),
                "institution": institution or (remainder[1] if len(remainder) > 1 else ""),
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
