"""The deterministic half of JD analysis: everything done in code, not by the model.

A small model is good at reading a posting and poor at being consistent about
what it means, so the judgements that must be repeatable live here:

  * the job title and the seniority level it states,
  * years of experience, and the level they imply when no level is stated,
  * whether a quote makes something optional ("a plus", "or equivalent"),
  * which skills a quote offers as alternatives ("Go, Java, or Python"),
  * the ATS keyword weights,
  * a complete rules-only analysis, for when the model cannot be used.
"""

import re

from app.core.keywords import keyword_candidates
from app.core.skill_match import named_at_end, named_in
from app.core.taxonomy import CANONICAL_ALIASES, DOMAINS, IMPLIED_PARENTS, canonical, skill_candidates
from app.modules.jd_analyzer import cleaning
from app.modules.jd_analyzer.schemas import (
    MAX_RESPONSIBILITIES,
    JDAnalysis,
    Keyword,
    Requirement,
    Seniority,
    SenioritySource,
    Skill,
)

# ── Seniority ────────────────────────────────────────────────────────────

# Level words and what they map to. In a title the highest-ranked level wins
# ("Senior Engineering Manager" is a manager).
_LEVEL_WORDS: list[tuple[str, tuple[str, ...]]] = [
    ("manager", ("manager", "director", "head of", "vp of", "vice president")),
    ("lead", ("lead", "staff", "principal", "tech lead")),
    ("senior", ("senior", "sr", "sr.")),
    ("mid", ("mid", "mid-level", "mid level", "midlevel", "intermediate")),
    ("junior", ("junior", "jr", "jr.", "entry level", "entry-level", "new grad", "new-grad", "graduate")),
    ("intern", ("intern", "internship")),
]
_LEVEL_OF_WORD = {word: level for level, words in _LEVEL_WORDS for word in words}

# Phrases that state a level when they appear anywhere in the text. Deliberately
# short: "senior engineers" in the body describes the team, not the opening.
_STATED_IN_TEXT = {
    "entry level": "junior",
    "entry-level": "junior",
    "new grad": "junior",
    "new-grad": "junior",
    "mid-level": "mid",
    "mid level": "mid",
}


def normalize_level(raw: str | None) -> Seniority:
    """A model's or a title's level word, mapped to the schema's levels.
    Anything unrecognised is "unknown", never a guess."""
    word = re.sub(r"\s+", " ", (raw or "").strip().lower())
    if word in _LEVEL_OF_WORD:
        return _LEVEL_OF_WORD[word]  # type: ignore[return-value]
    if word in ("manager", "engineering manager"):
        return "manager"
    return "unknown"


def _level_in_title(title: str) -> Seniority:
    words = re.findall(r"[a-z][a-z.\-]*", title.lower())
    text = " ".join(words)
    for level, vocabulary in _LEVEL_WORDS:
        for word in vocabulary:
            if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", text):
                return level  # type: ignore[return-value]
    return "unknown"


def stated_level(title: str, text: str) -> Seniority:
    """The level the JD states: a level word in the title, or one of a few
    unambiguous phrases in the text. "unknown" when it states none."""
    from_title = _level_in_title(title)
    if from_title != "unknown":
        return from_title
    lowered = text.lower()
    for phrase, level in _STATED_IN_TEXT.items():
        if phrase in lowered:
            return level  # type: ignore[return-value]
    return "unknown"


def years_to_level(years: int | None) -> Seniority:
    """0-2 junior, 3-5 mid, 6+ senior. Only used when no level word is stated."""
    if years is None:
        return "unknown"
    if years <= 2:
        return "junior"
    if years <= 5:
        return "mid"
    return "senior"


def resolve_seniority(
    title: str, text: str, years: int | None, model_level: str | None = None
) -> tuple[Seniority, SenioritySource]:
    """Seniority and where it came from, decided in code.

    1. A level word the JD states (title first, then a few phrases): "stated".
    2. The model's level, but only if the JD contains a word for it.
    3. The stated years mapped to a level: "years".
    4. Otherwise "unknown".
    """
    level = stated_level(title, text)
    if level != "unknown":
        return level, "stated"

    guess = normalize_level(model_level)
    if guess != "unknown":
        vocabulary = next(words for lvl, words in _LEVEL_WORDS if lvl == guess)
        if any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text.lower()) for w in vocabulary):
            return guess, "stated"

    level = years_to_level(years)
    return (level, "years") if level != "unknown" else ("unknown", "unknown")


# ── Years of experience ──────────────────────────────────────────────────

_YEARS_RANGE = re.compile(r"(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b", re.IGNORECASE)
_YEARS_ONE = re.compile(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b", re.IGNORECASE)


def years_mentioned(text: str) -> list[int]:
    """Every number of years the text states, in order of appearance (both ends
    of a range)."""
    found: list[tuple[int, int]] = []
    covered: list[tuple[int, int]] = []
    for match in _YEARS_RANGE.finditer(text):
        found.append((match.start(1), int(match.group(1))))
        found.append((match.start(2), int(match.group(2))))
        covered.append(match.span())
    for match in _YEARS_ONE.finditer(text):
        if not any(start <= match.start() < end for start, end in covered):
            found.append((match.start(1), int(match.group(1))))
    return [value for _, value in sorted(found)]


def first_years(text: str) -> int | None:
    """The first figure of years the text states, taking a range's lower end.
    That is the overall requirement: later figures ("including 2+ years of ...")
    describe a subset of it."""
    first_range = _YEARS_RANGE.search(text)
    first_one = _YEARS_ONE.search(text)
    candidates = [m for m in (first_range, first_one) if m]
    if not candidates:
        return None
    earliest = min(candidates, key=lambda m: m.start())
    return int(earliest.group(1))


def resolve_years(model_years: int | None, text: str) -> int | None:
    """The model's figure if the JD really states it, otherwise the first figure
    the JD states, otherwise None. Never a number the text does not contain."""
    mentioned = years_mentioned(text)
    if model_years is not None and model_years in mentioned:
        return model_years
    return first_years(text)


# ── Title ────────────────────────────────────────────────────────────────


def title_from_text(text: str) -> str:
    """The job title when the model's is unusable: the first line, cut at the
    first dash or pipe ("Junior Data Scientist — early-stage fintech ...")."""
    for line in text.splitlines():
        line = line.strip()
        if line:
            break
    else:
        return ""
    head = re.split(r"\s[—–|]\s|\s-\s", line, maxsplit=1)[0].strip()
    if len(head) > 90 or head.endswith("."):
        head = re.split(r"(?<=[.!?])\s", head, maxsplit=1)[0]
        head = " ".join(head.split()[:8])
    return head.strip(" .:")


def title_forms(title: str) -> set[str]:
    """Names the job title can appear under, so it can be kept out of the skills:
    the title, and the title without its level words and company suffix."""
    forms = set()
    for candidate in {title, title.split(",")[0], re.split(r"\s[—–|]\s|\s-\s", title)[0]}:
        forms.add(canonical(candidate))
        stripped = " ".join(
            w for w in candidate.split() if not re.fullmatch(r"(?i)(senior|sr\.?|junior|jr\.?|lead|staff|principal|mid-level)", w)
        )
        forms.add(canonical(stripped))
    forms.discard("")
    return forms


# ── Optional or required ─────────────────────────────────────────────────

_OPTIONAL = re.compile(
    r"\b(?:a plus|is a plus|are a plus|would be a plus|nice[- ]to[- ]haves?|preferred|bonus|ideally|"
    r"desirable|desired|not required|not necessary|good to have|an advantage|or equivalent)\b",
    re.IGNORECASE,
)
_REQUIRED = re.compile(r"\bmust\b|(?<!not )\brequired\b|\bminimum\b", re.IGNORECASE)
_OPTIONAL_SECTION = re.compile(r"nice[- ]to[- ]have|bonus|preferred|desirable|optional|a plus|extra credit", re.IGNORECASE)


def sentence_containing(text: str, quote: str) -> str:
    """The sentence (or list line) of `text` that holds `quote`, or the quote
    itself if it cannot be located."""
    pattern = r"\s+".join(re.escape(part) for part in quote.split())
    match = re.search(pattern, text, re.IGNORECASE) if pattern else None
    if not match:
        return quote
    start = max(text.rfind(".", 0, match.start()), text.rfind("\n", 0, match.start()))
    ends = [i for i in (text.find(".", match.end()), text.find("\n", match.end())) if i != -1]
    end = min(ends) if ends else len(text)
    return text[start + 1 : end + 1].strip()


def section_heading(text: str, quote: str) -> str:
    """The nearest heading above `quote`, lower-cased, or ""."""
    pattern = r"\s+".join(re.escape(part) for part in quote.split())
    match = re.search(pattern, text, re.IGNORECASE) if pattern else None
    if not match:
        return ""
    for line in reversed(text[: match.start()].splitlines()):
        if cleaning.is_heading(line):
            return cleaning.heading_name(line)
    return ""


def is_optional(text: str, quote: str) -> bool:
    """Whether the JD makes what `quote` says optional: the sentence says so
    ("is a plus", "or equivalent") without also saying it is required, or the
    section it sits under is a nice-to-have section."""
    sentence = sentence_containing(text, quote)
    if _OPTIONAL.search(sentence) and not _REQUIRED.search(sentence):
        return True
    if "not required" in sentence.lower():
        return True
    return bool(_OPTIONAL_SECTION.search(section_heading(text, quote)))


def requirement_flag(text: str, evidence: str, model_flag: bool) -> bool:
    """Whether a degree or certification is required. The JD's own wording wins
    over the model: optional wording ("or equivalent", "a plus", "not required")
    makes it false, "must"/"required" makes it true, and only a quote that says
    neither falls back to the model's flag."""
    if is_optional(text, evidence):
        return False
    if _REQUIRED.search(sentence_containing(text, evidence)):
        return True
    return model_flag


# ── Either/or groups ─────────────────────────────────────────────────────

_OR = re.compile(r",?\s+or\s+", re.IGNORECASE)


def find_alternative_sets(evidence: str, names: list[str]) -> list[set[str]]:
    """Sets of skill names that `evidence` offers as alternatives.

    For each "or" in the text: the skills right after it, and the run of
    comma-separated items before it that END in a skill name ("Go, Java, or
    Python", "either XGBoost or LightGBM", "experience with queues (Kafka, SQS,
    or RabbitMQ)"). The first item of a list may be preceded by lead-in words, so
    a segment longer than three words ends the run after it is counted, and only
    the skill at its very end counts: "message queues (Kafka" yields Kafka, not
    "message queues". A long clause before the "or" ("Kubernetes and Terraform in
    production or staging") names nothing at its end and yields no group.
    """
    sets: list[set[str]] = []
    for match in _OR.finditer(evidence):
        right = re.split(r"[,;]|\band\b", evidence[match.end() :], maxsplit=1, flags=re.IGNORECASE)[0]
        right = " ".join(right.split()[:3])
        members = {n for n in names if named_in(right, n)}
        for segment in reversed(evidence[: match.start()].split(",")):
            segment = segment.strip()
            named = {n for n in names if named_at_end(segment, n)} if segment else set()
            if not named:
                break
            members |= named
            # "Python, SQL, and either Go or Java": the "or" binds only the items
            # after the "and"; what comes before it is a different list.
            if len(segment.split()) > 3 or re.match(r"(?:and|plus)\b", segment, re.IGNORECASE):
                break
        if len(members) >= 2:
            sets.append(members)
    return sets


def assign_alternative_groups(skills: list[Skill], text: str | None = None) -> list[Skill]:
    """Give every skill that the posting offers as an alternative the same
    `alternative_group`, even when the model did not.

    Each either/or list is its own group. The list is read from the skill's quote
    and, when `text` is given, from the whole sentence around the quote: a model
    that quoted only "AWS" for a skill from "a major cloud: AWS, GCP, or Azure"
    still gets AWS grouped with the others.

    The model's label is kept when it is the label of exactly one list; if the
    model gave two lists the same label ("language" for both the languages and the
    queues), neither keeps it. A group of one is no group.
    """
    names = [s.name for s in skills]
    by_name = {s.name: s for s in skills}
    model_labels = {s.name: s.alternative_group for s in skills}  # read before they are cleared below
    groups: list[set[str]] = []

    def add(members: set[str]) -> None:
        merged = set(members)
        for existing in [g for g in groups if g & merged]:
            merged |= existing
            groups.remove(existing)
        groups.append(merged)

    for skill in skills:
        for members in find_alternative_sets(skill.evidence, names):
            add(members)
        if text:
            sentence = sentence_containing(text, skill.evidence)
            if sentence != skill.evidence:
                for members in find_alternative_sets(sentence, names):
                    if skill.name in members:
                        add(members)

    def model_label(members: set[str]) -> str | None:
        labels = [model_labels[n].strip().lower() for n in sorted(members) if model_labels[n]]
        return max(set(labels), key=labels.count) if labels else None

    claimed = [model_label(g) for g in groups]
    for skill in skills:
        skill.alternative_group = None
    for members, label in zip(groups, claimed):
        if not label or claimed.count(label) > 1:
            label = "any-of:" + "/".join(sorted(members))
        for name in members:
            by_name[name].alternative_group = label
    return skills


# ── ATS keywords ─────────────────────────────────────────────────────────


def build_keywords(analysis: JDAnalysis) -> list[Keyword]:
    """Weights from the analysis, not from the model: required skills and
    required certifications 1.0, the job title 0.8, preferred skills and
    optional certifications 0.5, other named tools 0.4. A term appearing
    several ways keeps its highest weight."""
    weights: dict[str, float] = {}

    def add(term: str, weight: float) -> None:
        term = term.strip().lower()
        if term:
            weights[term] = max(weights.get(term, 0.0), weight)

    for skill in analysis.required_skills:
        add(skill.name, 1.0)
    for cert in analysis.certifications:
        add(cert.name, 1.0 if cert.required else 0.5)
    for skill in analysis.preferred_skills:
        add(skill.name, 0.5)
    if analysis.job_title:
        bare = " ".join(
            w for w in analysis.job_title.split(",")[0].split()
            if not re.fullmatch(r"(?i)(senior|sr\.?|junior|jr\.?|lead|staff|principal)", w)
        )
        add(bare, 0.8)
    for tool in analysis.tools_technologies:
        add(tool, 0.4)
    return [Keyword(term=t, weight=w) for t, w in weights.items()]


# ── Validators ───────────────────────────────────────────────────────────

# Words that name a category of thing, never a skill: "language", "framework".
GENERIC_SKILL_NAMES = {
    "language", "languages", "programming language", "programming languages", "framework", "frameworks",
    "tool", "tools", "library", "libraries", "platform", "platforms", "technology", "technologies",
    "skill", "skills", "experience", "software", "system", "systems", "team", "teams", "project",
    "projects", "environment", "environments", "stack", "service", "services", "application",
    "applications", "code", "data", "product", "products", "solution", "solutions", "process",
    "processes", "practice", "practices", "knowledge", "fundamentals",
}

# Soft skills are not skills here; mentoring and the like are responsibilities.
SOFT_SKILLS = {
    "communication", "communication skills", "written communication", "verbal communication", "teamwork",
    "team player", "collaboration", "leadership", "problem solving", "critical thinking", "adaptability",
    "creativity", "time management", "attention to detail", "interpersonal skills", "work ethic",
    "initiative", "self motivated", "fast learner", "eagerness to learn", "willingness to learn",
    "curiosity", "organizational skills", "multitasking", "flexibility", "positive attitude", "ownership",
    "mentoring", "mentorship", "stakeholder management", "presentation skills", "public speaking",
    "negotiation",
}

_DEGREE_WORDS = re.compile(
    r"\b(?:bachelors?|masters?|doctorate|ph\.?d|degree|diploma|associates?|mba|b\.?s\.?c?|m\.?s\.?c?|high school|ged)\b",
    re.IGNORECASE,
)
_CERT_WORDS = re.compile(
    r"certif|licen[sc]e|\+|\b(?:cissp|cism|cisa|ceh|oscp|osce|gpen|gsec|pmp|capm|csm|cka|ckad|cks|ccna|ccnp|ccie|"
    r"cpa|cfa|frm|itil|togaf|six sigma|scrum master)\b",
    re.IGNORECASE,
)


def is_generic_name(name: str) -> bool:
    return canonical(name) in GENERIC_SKILL_NAMES


def is_soft_skill(name: str) -> bool:
    return canonical(name) in SOFT_SKILLS


def education_name_ok(name: str) -> bool:
    """An education requirement has to be about a degree: "coursework" and
    "CS fundamentals" are not, whatever the model filed them under."""
    return bool(_DEGREE_WORDS.search(name))


def certification_name_ok(name: str) -> bool:
    """A certification has to look like one: "certified", "license", a "+" suffix
    (Security+), or a well-known credential. "coursework" does not."""
    return bool(_CERT_WORDS.search(name))


def same_requirement_name(a: str, b: str) -> bool:
    """Whether two degree or certification names are the same thing: one contains
    the other, or they share at least 60% of the words of the shorter."""

    def words(text: str) -> list[str]:
        return [w for w in re.sub(r"[^a-z0-9+#]+", " ", text.lower()).split() if len(w) >= 3]

    wa, wb = words(a), words(b)
    if not wa or not wb:
        return False
    if " ".join(wa) in " ".join(wb) or " ".join(wb) in " ".join(wa):
        return True
    return len(set(wa) & set(wb)) / min(len(set(wa)), len(set(wb))) >= 0.6


def backfill_certifications(text: str, existing: list[Requirement]) -> list[Requirement]:
    """Certifications the pattern rules find that `existing` does not have. The
    model files a certification as a preferred skill now and then; the quote is
    the whole sentence, as written, so it is verbatim."""
    found = rules_requirements(text)[1]
    return [c for c in found if not any(same_requirement_name(c.name, e.name) for e in existing)]


# ── Rules-only analysis ──────────────────────────────────────────────────

_NOISE = {
    "requirements", "requirement", "responsibilities", "qualifications", "preferred", "nice", "bonus",
    "comfortable", "familiarity", "exposure", "solid", "deep", "strong", "junior", "senior", "mid",
    "intern", "internship", "remote", "hybrid", "onsite", "you'll", "you", "your", "we", "our",
    # Acronyms that are not skills.
    "api", "apis", "sdk", "eeo", "usa", "us", "uk", "hr", "pto", "ceo", "cto", "vp", "faq", "asap",
}

_KNOWN_NODES = (
    set(DOMAINS) | set(IMPLIED_PARENTS) | set(CANONICAL_ALIASES.values())
    | {p for parents in IMPLIED_PARENTS.values() for p in parents}
)

_DEGREE = re.compile(
    r"(?:bachelor|master|doctorate|ph\.?d|associate)(?:['’]s)?(?:\s+degree)?(?:\s+in\s+[A-Za-z][A-Za-z &/-]{2,40}?)?(?=[\s,.;)]|$)",
    re.IGNORECASE,
)
_CERT = re.compile(
    r"\b(?:Security\+|Network\+|CISSP|CISM|CEH|OSCP|PMP|CKA|CKAD|CCNA|"
    r"AWS Certified [A-Z][A-Za-z -]+?(?=\s+(?:certification|or|and)\b|[,.;)]|$)|"
    r"Certified [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,3})",
)


def _looks_like_skill(candidate: str) -> bool:
    """Rule candidates are noisy (every mid-sentence capital). Accept only what
    is plausibly a technology: a name the taxonomy knows, an acronym, or a
    token with a digit or symbol (C++, CI/CD, S3)."""
    lower = candidate.lower()
    if lower in _NOISE or lower.isdigit():
        return False
    if canonical(candidate) in _KNOWN_NODES:
        return True
    # A slash joins two words ("and/or", "A/B", "online/offline", "matplotlib/
    # seaborn") far more often than it names one thing; only the taxonomy's own
    # names ("ci/cd") get through above.
    if "/" in candidate:
        return False
    return (candidate.isupper() and 2 <= len(candidate) <= 5) or bool(re.search(r"[0-9+#.]", candidate))


def rule_skill_candidates(text: str, exclude: set[str]) -> list[str]:
    """Technology-looking terms the existing keyword rules find in `text`."""
    seen: set[str] = set()
    out: list[str] = []
    for term in skill_candidates(text):
        node = canonical(term)
        if node in exclude or node in seen or not _looks_like_skill(term):
            continue
        seen.add(node)
        out.append(term)
    return out


def _as_written(text: str, term: str) -> str | None:
    """The first occurrence of `term` in `text`, exactly as written there."""
    match = re.search(r"(?<![\w])" + re.escape(term) + r"(?![\w])", text, re.IGNORECASE)
    return match.group(0) if match else None


def rules_requirements(text: str) -> tuple[list[Requirement], list[Requirement]]:
    """(education, certifications) by pattern. Evidence is the whole sentence,
    so "or equivalent" and "a plus" travel with it."""
    education: list[Requirement] = []
    for match in _DEGREE.finditer(text):
        name = match.group(0).strip(" ,.;")
        evidence = sentence_containing(text, match.group(0)).strip()
        if name and not any(r.name.lower() == name.lower() for r in education):
            education.append(Requirement(name=name, required=not is_optional(text, evidence), evidence=evidence))
    certifications: list[Requirement] = []
    for match in _CERT.finditer(text):
        name = match.group(0).strip(" ,.;")
        evidence = sentence_containing(text, match.group(0)).strip()
        if name and not any(r.name.lower() == name.lower() for r in certifications):
            certifications.append(Requirement(name=name, required=not is_optional(text, evidence), evidence=evidence))
    # "Certified Kubernetes Administrator (CKA)" matches twice, as the name and as
    # its acronym; keep the name.
    initials = {"".join(w[0] for w in c.name.split()).upper() for c in certifications if len(c.name.split()) >= 2}
    certifications = [c for c in certifications if not (c.name.isupper() and c.name in initials)]
    return education, certifications


def rules_responsibilities(text: str) -> list[str]:
    """What "You'll ..." sentences say the person will do."""
    found: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n", text):
        match = re.match(r"\s*you(?:'ll|’ll| will)\s+(.+?)[.!?]?\s*$", sentence, re.IGNORECASE)
        if match:
            phrase = " ".join(match.group(1).split()[:14])
            if phrase and phrase not in found:
                found.append(phrase)
    return found[:MAX_RESPONSIBILITIES]


def rules_analysis(text: str) -> JDAnalysis:
    """A complete analysis with no model: the job title, level, years, the
    technology-looking terms the keyword rules find (optional when their
    sentence says so), degrees, certifications and what "You'll" sentences
    describe. Plainer than the model's, and never wrong about what the text
    says; used when the model cannot be."""
    title = title_from_text(text)
    years = first_years(text)
    level, level_source = resolve_seniority(title, text, years)

    forms = title_forms(title)
    title_words = {w.lower() for w in re.findall(r"[A-Za-z0-9+#]+", title)}
    required: list[Skill] = []
    preferred: list[Skill] = []
    for term in rule_skill_candidates(text, exclude=forms):
        written = _as_written(text, term)
        if not written or written.lower() in title_words:
            continue
        skill = Skill(name=canonical(term), evidence=written)
        (preferred if is_optional(text, written) else required).append(skill)

    education, certifications = rules_requirements(text)
    tools = [s.name for s in required + preferred if s.name in _KNOWN_NODES]
    analysis = JDAnalysis(
        job_title=title,
        seniority=level,
        seniority_source=level_source,
        min_years_experience=years,
        required_skills=assign_alternative_groups(required, text),
        preferred_skills=assign_alternative_groups(preferred, text),
        tools_technologies=tools,
        education=education,
        certifications=certifications,
        responsibilities=rules_responsibilities(text),
        source="rules",
    )
    analysis.ats_keywords = build_keywords(analysis)
    return analysis


# keyword_candidates is re-exported so callers that want only the single-token
# list (the older tailoring code) can pass it as their fallback.
__all__ = ["keyword_candidates"]
