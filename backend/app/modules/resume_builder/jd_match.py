"""Requirements from a job description, ranked, and matched against a resume.

Two steps, both deterministic so the same resume and posting always get the
same verdict:

  build_requirements   JDAnalysis -> a de-duplicated list of requirements,
                       each ranked critical / high / medium / low.
  match_requirements   each requirement -> exact / related / transferable /
                       missing, with the resume line that is the evidence.

WHAT THE FOUR MATCH LEVELS LICENSE

  exact         The resume names it. The JD's own spelling may be used.
  related       The resume names something that IS it (PostgreSQL for "SQL",
                pytest for "automated testing"). The JD's wording may be
                written onto the resume, because it is true.
  transferable  The resume shows a sibling (MySQL for a PostgreSQL role). The
                competency carries over and the analysis says so, but the
                JD's term is never written onto the resume on its strength.
  missing       No evidence. Reported as a gap; never added.

`supported_terms` and `forbidden_terms` on the result are exactly that split,
and are what the rewrite prompt and its checks are given.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date
from functools import lru_cache

from app.core.taxonomy import canonical, implied_skills, skill_candidates
from app.modules.jd_analyzer.schemas import JDAnalysis
from app.modules.resume_analyzer.quality import split_sections
from app.modules.resume_builder import skill_categories

IMPORTANCE_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1}
MATCH_CREDIT = {"exact": 1.0, "related": 0.85, "transferable": 0.5, "missing": 0.0}

# An LLM skill name longer than this is a phrase ("experience building
# distributed systems at scale"), not a skill a resume could list.
MAX_SKILL_WORDS = 4

# Words that make "kubernetes experience" a restatement of "kubernetes".
_FILLER = {"experience", "systems", "system", "knowledge", "skills", "familiarity", "proficiency", "other", "or", "and", "with", "in", "of"}


@dataclass
class Requirement:
    key: str  # canonical name; unique within a list
    label: str  # as the JD wrote it
    kind: str  # skill | education | certification | experience
    importance: str  # critical | high | medium | low
    required: bool
    jd_evidence: str = ""
    alternatives: list[str] = field(default_factory=list)
    min_years: int | None = None


@dataclass
class Match:
    requirement: Requirement
    level: str  # exact | related | transferable | missing
    evidence: str | None = None  # the resume line, verbatim
    via: str | None = None  # "PostgreSQL" for a related/transferable match
    demonstrated: bool = False  # found in an experience or project bullet
    section: str | None = None

    def to_dict(self) -> dict:
        r = asdict(self.requirement)
        return {
            "requirement": r["label"],
            "key": r["key"],
            "kind": r["kind"],
            "importance": r["importance"],
            "required": r["required"],
            "jd_evidence": r["jd_evidence"],
            "match": self.level,
            "resume_evidence": self.evidence,
            "via": self.via,
            "demonstrated": self.demonstrated,
            "section": self.section,
        }


# ── term matching ─────────────────────────────────────────────────────────

@lru_cache(maxsize=4096)
def term_pattern(term: str) -> re.Pattern[str]:
    """A whole-term pattern tolerant of spacing, hyphens and plurals:
    "REST APIs" matches "REST API", "rest-api" and "REST APIs"."""
    words = [w for w in re.split(r"[\s\-/]+", (term or "").strip().lower()) if w]
    if not words:
        return re.compile(r"(?!x)x")
    last = words[-1]
    if len(last) > 4 and last.endswith("s") and not last.endswith("ss"):
        words[-1] = last[:-1]
    body = r"[\s\-/]*".join(re.escape(w) for w in words)
    return re.compile(rf"(?<![\w+#.]){body}(?:s|es)?(?![\w+#])", re.IGNORECASE)


def _surface_forms(term: str) -> list[str]:
    from app.core.taxonomy import CANONICAL_ALIASES

    node = canonical(term)
    forms = {term, node} | {alias for alias, target in CANONICAL_ALIASES.items() if target == node}
    if node == "cicd":
        forms |= {"ci/cd", "ci cd", "continuous integration"}
    if node == "rest apis":
        forms |= {"rest api", "restful"}
    return sorted((f for f in forms if f), key=len, reverse=True)


def find_term(text: str, term: str) -> re.Match[str] | None:
    for form in _surface_forms(term):
        if m := term_pattern(form).search(text or ""):
            return m
    return None


def mentions(text: str, term: str) -> bool:
    return find_term(text, term) is not None


def _count(text: str, term: str) -> int:
    return max((len(term_pattern(f).findall(text or "")) for f in _surface_forms(term)), default=0)


# ── requirements ──────────────────────────────────────────────────────────

def _display(name: str, evidence: str) -> str:
    """The skill as the JD spelled it, when its evidence quote contains it."""
    if m := find_term(evidence, name):
        found = m.group(0).strip()
        # Keep the JD's casing but not a stray plural it never meant ("APIs" fine).
        return found
    return name if any(c.isupper() for c in name) else name.title() if len(name) > 3 else name.upper()


def _is_restatement(name: str, others: set[str]) -> bool:
    """'kubernetes experience' or 'kafka or other event streaming systems'
    when 'kubernetes' / 'kafka' is already a requirement."""
    words = name.split()
    if len(words) < 2:
        return False
    for other in others:
        if other == name or other not in name:
            continue
        leftover = [w for w in name.replace(other, " ").split() if w not in _FILLER]
        if len(leftover) <= 1:
            return True
    return False


_REQUIREMENTS_HEADING = re.compile(
    r"^\s*(requirements|qualifications|required|minimum qualifications|basic qualifications|"
    r"what you.?ll (?:need|bring)|what we.?re looking for|you have|must have)\b", re.I)
_OTHER_HEADING = re.compile(
    r"^\s*(nice to have|preferred|bonus|responsibilities|what you.?ll do|benefits|about)\b", re.I)


def _requirement_lines(jd_text: str) -> list[str]:
    lines, active = [], False
    for line in (jd_text or "").splitlines():
        if _REQUIREMENTS_HEADING.match(line):
            active = True
        elif _OTHER_HEADING.match(line):
            active = False
        elif active and line.strip():
            lines.append(line.strip())
    return lines


def _names(line: str, term: str) -> bool:
    """mentions(), but case-sensitive for one-letter-ish language names, so
    the verb "go" is not the Go language."""
    if term in ("Go", "C", "R"):
        return bool(re.search(rf"(?<![\w+#]){term}(?![\w+#])", line))
    return mentions(line, term)


def build_requirements(analysis: JDAnalysis, jd_text: str, job_title: str | None = None) -> list[Requirement]:
    title = f"{job_title or ''} {analysis.job_title or ''}"
    requirements: list[Requirement] = []
    seen: set[str] = set()

    def add_skill(name: str, evidence: str, required: bool, weight: float | None, group: str | None) -> None:
        key = canonical(name)
        if not key or key in seen or len(key.split()) > MAX_SKILL_WORDS:
            return
        mentions_n = _count(jd_text, name)
        in_title = mentions(title, name)
        if required:
            importance = "critical" if in_title or mentions_n >= 2 else "high"
        else:
            importance = "medium" if mentions_n >= 2 or (weight or 0) >= 0.75 or in_title else "low"
        seen.add(key)
        requirements.append(
            Requirement(
                key=key, label=_display(name, evidence or jd_text), kind="skill",
                importance=importance, required=required, jd_evidence=evidence or "",
                alternatives=[group] if group else [],
            )
        )

    weights = {canonical(k.term): k.weight for k in analysis.ats_keywords}
    for skill in analysis.required_skills:
        add_skill(skill.name, skill.evidence, True, weights.get(canonical(skill.name)), skill.alternative_group)
    for skill in analysis.preferred_skills:
        add_skill(skill.name, skill.evidence, False, weights.get(canonical(skill.name)), skill.alternative_group)
    for tool in analysis.tools_technologies:
        add_skill(tool, "", False, weights.get(canonical(tool)), None)

    # A rules-only analysis misses technologies it has no rule for (it read
    # "Java or Python" as Python alone). The JD's own keyword candidates fill
    # that in, but only for names this module knows to be technologies; one
    # named under a Requirements heading is required.
    required_lines = _requirement_lines(jd_text)
    short_names = [n for n in ("Go", "C", "R") if re.search(rf"(?<![\w+#]){n}(?![\w+#])", jd_text)]
    for term in skill_candidates(jd_text) + short_names:
        if canonical(term) in skill_categories.KNOWN_TECH:
            in_requirements = next((ln for ln in required_lines if _names(ln, term)), None)
            line = in_requirements or next((ln.strip() for ln in jd_text.splitlines() if _names(ln, term)), "")
            add_skill(term, line, in_requirements is not None, None, None)

    keys = {r.key for r in requirements}
    cert_keys = {canonical(c.name) for c in analysis.certifications}
    requirements = [
        r for r in requirements
        if not _is_restatement(r.key, keys - {r.key}) and r.key not in cert_keys
    ]

    # One degree line ("Bachelor's or Master's in CS") is one requirement,
    # however many names a rules-only analysis split it into.
    edu_quotes: set[str] = set()
    for edu in analysis.education:
        if edu.evidence in edu_quotes:
            continue
        edu_quotes.add(edu.evidence)
        requirements.append(Requirement(
            key=f"education:{canonical(edu.name)}", label=edu.name, kind="education",
            importance="high" if edu.required else "low", required=edu.required, jd_evidence=edu.evidence,
        ))
    for cert in analysis.certifications:
        requirements.append(Requirement(
            key=f"certification:{canonical(cert.name)}", label=cert.name, kind="certification",
            importance="high" if cert.required else "low", required=cert.required, jd_evidence=cert.evidence,
        ))
    if analysis.min_years_experience:
        requirements.append(Requirement(
            key="experience:years", label=f"{analysis.min_years_experience}+ years of experience",
            kind="experience", importance="high", required=True,
            min_years=analysis.min_years_experience,
        ))

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    requirements.sort(key=lambda r: (order[r.importance], not r.required))
    return requirements


# ── resume evidence ───────────────────────────────────────────────────────

@dataclass
class ResumeEvidence:
    """The resume, indexed for matching."""

    text: str
    bullets: list[tuple[str, str]]  # (section, bullet text) for experience and projects
    sections: dict[str, str]
    skill_items: list[str]
    confirmed: list[str]


def index_resume(resume_text: str, parsed: dict, confirmed_skills: list[str] | None = None) -> ResumeEvidence:
    bullets: list[tuple[str, str]] = []
    for exp in parsed.get("experiences") or []:
        bullets += [("experience", b) for b in exp.get("bullets") or []]
    for project in parsed.get("projects") or []:
        bullets += [("projects", b) for b in project.get("bullets") or []]
        if project.get("tech"):
            bullets.append(("projects", project["tech"]))
    items = [i for g in parsed.get("skill_groups") or [] for i in g.get("items") or []]
    return ResumeEvidence(
        text=resume_text or "",
        bullets=bullets,
        sections=split_sections(resume_text or ""),
        skill_items=items,
        confirmed=[s.strip() for s in confirmed_skills or [] if s and s.strip()],
    )


def _locate(ev: ResumeEvidence, term: str) -> tuple[str | None, str | None, bool]:
    """(evidence line, section, demonstrated) for the first mention of term."""
    for section, bullet in ev.bullets:
        if mentions(bullet, term):
            return bullet, section, True
    for name, body in ev.sections.items():
        for line in body.splitlines():
            if line.strip() and mentions(line, term):
                return line.strip(), name, False
    return None, None, False


_DEGREE_LEVELS = [
    (4, r"\bph\.?\s?d\b|\bdoctor(ate|al)?\b"),
    (3, r"\bmaster'?s?\b|\bm\.?\s?s\.?\b|\bm\.?\s?eng\b|\bmba\b|\bm\.?\s?tech\b|\bm\.?\s?sc\b"),
    (2, r"\bbachelor'?s?\b|\bb\.?\s?s\.?\b|\bb\.?\s?a\.?\b|\bb\.?\s?tech\b|\bb\.?\s?e\.?\b|\bb\.?\s?sc\b|\bundergraduate\b"),
    (1, r"\bassociate'?s?\b"),
]


def _degree_levels(text: str) -> list[int]:
    return [level for level, pattern in _DEGREE_LEVELS if re.search(pattern, text or "", re.I)]


_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _parse_point(text: str, today: date) -> tuple[int, int] | None:
    text = text.strip().lower()
    if text in {"present", "current", "now"}:
        return today.year, today.month
    year = re.search(r"(19|20)\d{2}", text)
    if not year:
        return None
    month = next((n for name, n in _MONTHS.items() if name in text), None)
    if month is None and (m := re.match(r"(\d{1,2})[/-]", text)):
        month = int(m.group(1))
    return int(year.group(0)), month or 1


def years_of_experience(experiences: list[dict], today: date | None = None) -> float | None:
    """Total distinct months across listed roles, in years. Overlapping
    roles are counted once. None when no role has a readable date range."""
    today = today or date.today()
    months: set[int] = set()
    for exp in experiences or []:
        parts = re.split(r"\s*(?:[-–—]|to)\s*", exp.get("dates") or "", maxsplit=1)
        if len(parts) != 2:
            continue
        start, end = _parse_point(parts[0], today), _parse_point(parts[1], today)
        if not start or not end:
            continue
        a, b = start[0] * 12 + start[1], end[0] * 12 + end[1]
        if b >= a:
            months.update(range(a, b + 1))
    return round(len(months) / 12, 1) if months else None


def _match_skill(req: Requirement, ev: ResumeEvidence) -> Match:
    line, section, demonstrated = _locate(ev, req.label)
    if line is None and req.label.lower() != req.key:
        line, section, demonstrated = _locate(ev, req.key)
    if line is not None:
        return Match(req, "exact", line, None, demonstrated, section)

    if any(canonical(s) == req.key or mentions(s, req.label) for s in ev.confirmed):
        return Match(req, "exact", "You confirmed this skill", None, False, "confirmed")

    # Something on the resume that IS this requirement.
    for term in skill_categories.related_evidence_terms(req.key):
        line, section, demonstrated = _locate(ev, term)
        if line is not None:
            return Match(req, "related", line, term, demonstrated, section)
    # Or something whose taxonomy parents include it (PyTorch -> deep learning).
    for candidate in skill_candidates(ev.text):
        if req.key in implied_skills(candidate):
            line, section, demonstrated = _locate(ev, candidate)
            return Match(req, "related", line, candidate, demonstrated, section)

    for sibling in skill_categories.transferable_from(req.key):
        line, section, demonstrated = _locate(ev, sibling)
        if line is not None:
            return Match(req, "transferable", line, sibling, demonstrated, section)

    return Match(req, "missing")


def _match_education(req: Requirement, ev: ResumeEvidence) -> Match:
    edu_text = ev.sections.get("education", "")
    if not edu_text.strip():
        return Match(req, "missing")
    needed = _degree_levels(req.label + " " + req.jd_evidence)
    have = _degree_levels(edu_text)
    line = next((ln.strip() for ln in edu_text.splitlines() if _degree_levels(ln)), edu_text.strip().splitlines()[0])
    if needed and (not have or max(have) < min(needed)):
        return Match(req, "missing", line, None, False, "education")
    field_words = re.findall(r"computer science|software engineering|computer engineering|electrical engineering|information technology|data science|mathematics|statistics", req.jd_evidence + " " + req.label, re.I)
    if field_words and not any(re.search(re.escape(f), edu_text, re.I) for f in field_words):
        # A degree at the right level in another field: "or a related field" is
        # the JD's own allowance for exactly this.
        return Match(req, "related" if "related" in req.jd_evidence.lower() else "transferable", line, None, False, "education")
    return Match(req, "exact", line, None, False, "education")


def _match_certification(req: Requirement, ev: ResumeEvidence) -> Match:
    stem = re.sub(r"\b(certifications?|certified|certificate)\b", " ", req.label, flags=re.I).strip()
    pool = ev.sections.get("certifications", "") or ev.text
    for line in pool.splitlines():
        if re.search(r"certif", line, re.I) and stem and all(mentions(line, w) for w in stem.split()[:3]):
            return Match(req, "exact", line.strip(), None, False, "certifications")
    return Match(req, "missing")


def _match_years(req: Requirement, ev: ResumeEvidence, years: float | None) -> Match:
    if years is None:
        return Match(req, "missing")
    note = f"About {years:g} years across the roles listed"
    if years >= (req.min_years or 0):
        return Match(req, "exact", note, None, False, "experience")
    if years >= (req.min_years or 0) - 1:
        return Match(req, "related", note, None, False, "experience")
    return Match(req, "missing", note, None, False, "experience")


def match_requirements(
    requirements: list[Requirement], ev: ResumeEvidence, years: float | None
) -> list[Match]:
    matches: list[Match] = []
    for req in requirements:
        if req.kind == "education":
            matches.append(_match_education(req, ev))
        elif req.kind == "certification":
            matches.append(_match_certification(req, ev))
        elif req.kind == "experience":
            matches.append(_match_years(req, ev, years))
        else:
            matches.append(_match_skill(req, ev))

    # Alternatives ("Java or Python"): one satisfied alternative satisfies the
    # group, so the others are not reported as gaps.
    satisfied = {
        g for m in matches if m.level in ("exact", "related") for g in m.requirement.alternatives
    }
    return [
        m for m in matches
        if not (m.level == "missing" and any(g in satisfied for g in m.requirement.alternatives))
    ]


def coverage(matches: list[Match]) -> int:
    """Importance-weighted share of requirements evidenced, 0-100. A
    requirement-level figure, explained line by line in the analysis — not the
    trained model's ATS score, which stays the product's one authoritative
    number."""
    total = sum(IMPORTANCE_WEIGHT[m.requirement.importance] for m in matches)
    if not total:
        return 0
    got = sum(IMPORTANCE_WEIGHT[m.requirement.importance] * MATCH_CREDIT[m.level] for m in matches)
    return round(100 * got / total)


def supported_terms(matches: list[Match]) -> list[str]:
    """JD skill terms that may be written onto the resume, most important first."""
    return [m.requirement.label for m in matches if m.requirement.kind == "skill" and m.level in ("exact", "related")]


def forbidden_terms(matches: list[Match], resume_text: str) -> list[str]:
    """JD skill terms the resume does not support. Transferable ones are
    included: MySQL experience does not make "PostgreSQL" true."""
    return [
        m.requirement.label for m in matches
        if m.requirement.kind == "skill" and m.level in ("transferable", "missing")
        and not mentions(resume_text, m.requirement.label)
    ]
