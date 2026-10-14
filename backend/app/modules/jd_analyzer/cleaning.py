"""Turn a pasted or crawled job description into the text worth analysing.

What comes out is the one string everything else works from: the model is shown
it, every evidence quote must appear word for word in it, and its SHA-256 is the
cache key. So the cleaning has to be deterministic, and it has to remove only
what carries no information about the job:

  * HTML tags and entities (reusing the crawler's strip_html),
  * equal-opportunity and accommodation statements,
  * benefits / perks blocks.

Benefits and EEO text is not harmless noise. "401(k)", "remote-friendly" and
"unlimited PTO" read like keywords, and a model told to list what the posting
mentions will list them.
"""

import re

from app.modules.job_market.ats_boards import strip_html

# Marks an HTML heading through strip_html (which keeps text and drops tags) so
# the benefits-block rule can tell where a section ends. An invisible separator:
# it never occurs in a posting, and it is removed before the text is returned.
_HEADING_MARK = "⁣"
_HTML_HEADING = re.compile(r"<h[1-6][^>]*>", re.IGNORECASE)

# A sentence that is equal-opportunity or accommodation boilerplate. Once one
# appears, the rest of its paragraph goes too: these statements run on for
# several sentences ("... is an equal opportunity employer. We do not
# discriminate ... If you need an accommodation ...") and only the first has to
# contain a trigger phrase.
_EEO = re.compile(
    r"equal[- ]opportunity|equal[- ]employment|\beeo\b|affirmative action|"
    r"(?:do|does|will)\s+not\s+discriminate|without regard to (?:race|color|religion|sex|gender)|"
    r"reasonable accommodations?|protected (?:veteran|class)|e-verify|"
    r"pay transparency|applicants with disabilities",
    re.IGNORECASE,
)

# Headings that open a block to drop, and headings that close one. Matched on
# the heading text lower-cased with punctuation and "&" removed.
_DROP_HEADINGS = re.compile(
    r"^(?:our |the |your )?(?:benefits?|perks?|perks (?:and|&) benefits|benefits (?:and|&) perks|"
    r"compensation(?: (?:and|&) benefits)?|total rewards|what we offer|what's in it for you|"
    r"what you get|why join us|why you'll love working here|equal opportunity(?: employer)?|eeo(?: statement)?)$",
    re.IGNORECASE,
)
_KEEP_HEADINGS = re.compile(
    r"^(?:about (?:us|the (?:role|team|job|position|company))|the role|the team|responsibilities|"
    r"what you'll do|what you will do|what you'll be doing|key responsibilities|requirements?|"
    r"qualifications|minimum qualifications|basic qualifications|preferred qualifications|"
    r"required qualifications|required skills|preferred skills|must[- ]haves?|nice[- ]to[- ]haves?|"
    r"bonus(?: points)?|pluses|preferred|what you(?:'ll| will)? need|what you(?:'ll| will)? bring|"
    r"what we're looking for|who you are|about you|you have|skills|experience|education|your impact)$",
    re.IGNORECASE,
)

_MAX_HEADING_CHARS = 60
# A line this long is prose, not a benefit bullet: it ends a benefits block.
_PROSE_LINE_CHARS = 160


def _norm_heading(line: str) -> str:
    cleaned = line.replace(_HEADING_MARK, "").strip().rstrip(":").strip()
    return re.sub(r"\s+", " ", cleaned).lower().replace("’", "'")


def _is_heading(line: str) -> bool:
    """A standalone short line that names a section: marked as an HTML heading,
    ending in a colon, or one of the section names above."""
    stripped = line.strip()
    if not stripped:
        return False
    if _HEADING_MARK in stripped:
        return True
    if len(stripped) > _MAX_HEADING_CHARS or stripped.endswith("."):
        return False
    name = _norm_heading(stripped)
    return stripped.endswith(":") or bool(_DROP_HEADINGS.match(name) or _KEEP_HEADINGS.match(name))


def is_heading(line: str) -> bool:
    """Public form of the heading test, for section-aware callers."""
    return _is_heading(line)


def heading_name(line: str) -> str:
    return _norm_heading(line)


def _drop_eeo(line: str) -> str:
    """Cut a line at its first EEO sentence."""
    if not _EEO.search(line):
        return line
    kept: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", line):
        if _EEO.search(sentence):
            break
        kept.append(sentence)
    return " ".join(kept).strip()


def clean_jd(raw: str | None) -> str:
    """The text of the posting, without markup, EEO statements or benefits.

    Deterministic: the same input always gives the same output, which the
    analysis cache and the verbatim-evidence check both depend on.
    """
    if not raw:
        return ""
    marked = _HTML_HEADING.sub(f"\n{_HEADING_MARK}", raw)
    text = strip_html(marked, limit=None)

    kept: list[str] = []
    dropping = False
    for line in text.split("\n"):
        if _is_heading(line):
            dropping = bool(_DROP_HEADINGS.match(_norm_heading(line)))
            if dropping:
                continue
        elif dropping:
            # Inside a benefits block, until a heading or a line of real prose.
            if not line.strip() or len(line) <= _PROSE_LINE_CHARS:
                continue
            dropping = False
        # "Benefits: competitive salary, ..." on one line.
        if re.match(r"\s*(?:benefits?|perks)\s*:", line, re.IGNORECASE):
            continue
        line = _drop_eeo(line)
        kept.append(line.replace(_HEADING_MARK, "").strip())

    # Blank lines left behind by dropped blocks collapse to at most one.
    cleaned: list[str] = []
    for line in kept:
        if not line and (not cleaned or not cleaned[-1]):
            continue
        cleaned.append(line)
    return "\n".join(cleaned).strip()


def split_sections(text: str, limit: int) -> list[str]:
    """Split `text` into chunks of at most `limit` characters, breaking at
    section headings or blank lines where possible and otherwise between
    sentences, so no chunk cuts a sentence in two unless a single sentence is
    longer than the limit. Text within the limit comes back as one chunk."""
    if len(text) <= limit:
        return [text]

    pieces: list[str] = []
    for block in re.split(r"\n(?=\S)", text):
        if len(block) <= limit:
            pieces.append(block)
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", block):
            while len(sentence) > limit:
                cut = sentence.rfind(" ", 0, limit)
                cut = cut if cut > 0 else limit
                pieces.append(sentence[:cut])
                sentence = sentence[cut:].lstrip()
            if sentence:
                pieces.append(sentence)

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        joined = f"{current}\n{piece}" if current else piece
        if len(joined) <= limit:
            current = joined
        else:
            if current:
                chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks
