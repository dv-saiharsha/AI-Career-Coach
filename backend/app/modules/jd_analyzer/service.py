"""Analyse a job description into a JDAnalysis.

The order is fixed, because each step protects the next:

  1. clean       strip markup, EEO text and benefits (cleaning.py)
  2. cache       SHA-256 of the cleaned text; a hit costs nothing
  3. ask         one schema-constrained call (complete_tool_json, temperature 0),
                 split by section if the text would not fit the context window,
                 validated with pydantic and re-asked with the error on failure
  4. check       everything the model claims is checked in code: quotes must be
                 verbatim, the job title is kept out of the skills, the level
                 and the years come from the text, either/or groups are found
                 from the quotes
  5. second ask  one more call shown the posting and what was found, asked only
                 for what is missing; its answer goes through the same checks
                 (cache misses only; a failure here keeps the first answer)
  6. backstop    vocabulary concepts and technology-looking terms the keyword
                 rules find and the model missed (source "hybrid")
  7. fall back   if the model cannot be used or never answers properly, the
                 rules-only analysis (source "rules")

analyze() never raises. A flow that wanted a JD analysis and could not get a
model's gets a rules one, and goes on.
"""

import hashlib
import json
import logging
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.llm import LLMProviderError, llm_client
from app.core.skill_match import named_in
from app.core.taxonomy import canonical, skill_candidates
from app.models.jd_analysis import JDAnalysisRecord
from app.modules.job_market.enrichment import quote_in_text
from app.modules.jd_analyzer import cleaning, rules
from app.modules.jd_analyzer.schemas import (
    MAX_RESPONSIBILITIES,
    JDAnalysis,
    Requirement,
    Skill,
)

logger = logging.getLogger(__name__)

# Bumped whenever the prompt or the post-processing changes what an analysis
# looks like, so analyses cached under the old rules are not served as current.
ANALYZER_VERSION = 14

TOOL_NAME = "analyze_job_description"
MISSED_TOOL_NAME = "list_missed_skills"
# The second "what did you miss" call. Off only in tests that count calls.
SECOND_PASS = True
MAX_OUTPUT_TOKENS = 1800
MEMORY_CACHE_SIZE = 256
# A responsibility is a short phrase; a sentence-length one is the model
# pasting a paragraph.
MAX_RESPONSIBILITY_CHARS = 200

_SKILL_RULES = (
    "required_skills: technical skills, technologies, methods and practices the posting requires. "
    "preferred_skills: those it marks optional (\"nice to have\", \"a plus\", \"preferred\", "
    "\"bonus\"). Never list soft skills (communication, teamwork, eagerness), the job title, "
    "benefits, perks or what the company does.\n"
    "List conceptual skills and practices the posting asks for, not only named tools and languages: "
    "for example \"load balancing\", \"query optimization\", \"data modeling\" or \"feature "
    "engineering\". A phrase such as \"strong understanding of X\" or \"experience with X\" makes X a "
    "required skill whether X is a product or a concept.\n"
    "Every skill has three fields. name: the skill alone, one to three words, as a standalone term "
    "(a language, tool, framework, method or practice), never a sentence and never with words such as "
    "\"deep\", \"strong\" or \"experience\". evidence: the SHORTEST exact phrase copied letter for "
    "letter from the posting that names it, usually just the skill as written there; never reword it "
    "and never join pieces of different sentences. alternative_group: see below.\n"
    "When the posting offers alternatives joined by \"or\" (such as \"Ruby, PHP, or Perl\" or \"Redis "
    "or Memcached\"), list EACH alternative as its own skill, give all of them the same evidence (the "
    "list copied exactly as written) and the same short alternative_group label such as \"language\"; "
    "otherwise alternative_group is null.\n"
)

SYSTEM_PROMPT = (
    "You analyse a job posting and report only what its text states. Never infer, never fill "
    "a field to seem helpful: an empty list, null, or \"unknown\" is the right answer when the "
    "posting does not say.\n\n"
    "job_title: the title as written at the top.\n"
    "seniority: only a level the posting states (intern, junior, mid, senior, lead, manager); "
    "otherwise \"unknown\". Do not work it out from years of experience.\n"
    "min_years_experience: the overall minimum years of experience, the first figure the posting "
    "gives (for \"3-5 years\" answer 3; for \"6+\" answer 6); null if no years are stated.\n"
    + _SKILL_RULES
    + "tools_technologies: every tool, language, framework, platform or service the posting names, "
    "including ones that are only where the work happens.\n"
    "education and certifications: each has name, required (false when the posting says \"or "
    "equivalent\", \"a plus\", \"preferred\", \"nice to have\" or \"not required\"), and evidence "
    "(the whole clause as written, including those words).\n"
    "responsibilities: at most 10 short phrases (under 12 words) saying what the person will do, "
    "taken from sentences such as \"You'll ...\" or a list of duties; empty only if none are stated."
)

MISSED_PROMPT = (
    "You check an analysis of a job posting for omissions. You are given the posting and the skills "
    "and tools already found. List ONLY skills and tools the posting states that are NOT already "
    "found; never repeat a found one, and never add anything the posting does not say. Empty lists "
    "are the right answer when nothing is missing.\n\n"
    + _SKILL_RULES
    + "tools_technologies: tools, languages, frameworks, platforms or services the posting names "
    "that are not already found."
)

_SKILL_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "evidence": {"type": "string"},
        "alternative_group": {"type": ["string", "null"]},
    },
    "required": ["name", "evidence", "alternative_group"],
}
_REQUIREMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "required": {"type": "boolean"},
        "evidence": {"type": "string"},
    },
    "required": ["name", "required", "evidence"],
}
LLM_SCHEMA = {
    "type": "object",
    "properties": {
        "job_title": {"type": "string"},
        "seniority": {"type": "string", "enum": ["intern", "junior", "mid", "senior", "lead", "manager", "unknown"]},
        "min_years_experience": {"type": ["integer", "null"]},
        "required_skills": {"type": "array", "items": _SKILL_SCHEMA},
        "preferred_skills": {"type": "array", "items": _SKILL_SCHEMA},
        "tools_technologies": {"type": "array", "items": {"type": "string"}},
        "education": {"type": "array", "items": _REQUIREMENT_SCHEMA},
        "certifications": {"type": "array", "items": _REQUIREMENT_SCHEMA},
        "responsibilities": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "job_title", "seniority", "min_years_experience", "required_skills", "preferred_skills",
        "tools_technologies", "education", "certifications", "responsibilities",
    ],
}
MISSED_SCHEMA = {
    "type": "object",
    "properties": {
        "required_skills": {"type": "array", "items": _SKILL_SCHEMA},
        "preferred_skills": {"type": "array", "items": _SKILL_SCHEMA},
        "tools_technologies": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["required_skills", "preferred_skills", "tools_technologies"],
}


class _LLMSkill(BaseModel):
    name: str
    evidence: str
    alternative_group: str | None = None


class _LLMRequirement(BaseModel):
    name: str
    required: bool = True
    evidence: str


class _LLMOutput(BaseModel):
    """What the model returns, before any of it is trusted. Every field is
    required, as in the JSON schema: a reply that is JSON but is not an analysis
    (missing fields) is rejected and re-asked, not read as an empty one."""

    job_title: str
    seniority: str
    min_years_experience: int | None
    required_skills: list[_LLMSkill]
    preferred_skills: list[_LLMSkill]
    tools_technologies: list[str]
    education: list[_LLMRequirement]
    certifications: list[_LLMRequirement]
    responsibilities: list[str]

    @classmethod
    def empty(cls) -> "_LLMOutput":
        return cls(
            job_title="", seniority="unknown", min_years_experience=None, required_skills=[],
            preferred_skills=[], tools_technologies=[], education=[], certifications=[], responsibilities=[],
        )


class _LLMMissed(BaseModel):
    """What the second call returns: only what the first answer left out."""

    required_skills: list[_LLMSkill]
    preferred_skills: list[_LLMSkill]
    tools_technologies: list[str]


class _AnalysisFailed(Exception):
    """The model could not be made to answer; the caller falls back to rules."""


@dataclass
class AnalysisReport:
    """What happened on one analysis. Not stored with the analysis; the
    evaluation and the logs read it."""

    source: str = "rules"
    cached: str | None = None  # "memory" | "db" | None
    attempts: int = 0
    chunks: int = 1
    cleaned_chars: int = 0
    seconds: float = 0.0
    llm_error: str | None = None
    dropped_by_evidence: list[str] = field(default_factory=list)
    # Rejected by a validator (generic name, soft skill, wrong kind of requirement),
    # as opposed to dropped because the quote was not in the posting.
    rejected: list[str] = field(default_factory=list)
    title_leaks: list[str] = field(default_factory=list)
    unsupported_tools: list[str] = field(default_factory=list)
    moved_to_tools: list[str] = field(default_factory=list)
    rule_additions: list[str] = field(default_factory=list)
    second_call_attempts: int = 0
    second_call_added: list[str] = field(default_factory=list)
    second_call_seconds: float = 0.0
    second_call_error: str | None = None


# ── cache ────────────────────────────────────────────────────────────────

_memory: "OrderedDict[str, tuple[JDAnalysis, str | None]]" = OrderedDict()
_memory_lock = threading.Lock()


def jd_hash(cleaned: str) -> str:
    return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()


def clear_cache() -> None:
    with _memory_lock:
        _memory.clear()


def _memory_get(key: str) -> tuple[JDAnalysis, str | None] | None:
    with _memory_lock:
        hit = _memory.get(key)
        if hit:
            _memory.move_to_end(key)
        return hit


def _memory_put(key: str, analysis: JDAnalysis, model: str | None) -> None:
    with _memory_lock:
        _memory[key] = (analysis, model)
        _memory.move_to_end(key)
        while len(_memory) > MEMORY_CACHE_SIZE:
            _memory.popitem(last=False)


def _model_name() -> str | None:
    return getattr(llm_client, "model", None) or (
        settings.ANTHROPIC_MODEL if getattr(llm_client, "provider", "") == "anthropic" else None
    )


def _db_lookup(db: Session, digest: str) -> tuple[JDAnalysis, str | None] | None:
    """A stored analysis for this text. Rows whose source is "rules" are ignored:
    they were made while the model was unavailable, and the next request should
    get the chance to do better."""
    row = (
        db.query(JDAnalysisRecord)
        .filter(
            JDAnalysisRecord.jd_hash == digest,
            JDAnalysisRecord.analyzer_version == ANALYZER_VERSION,
            JDAnalysisRecord.source != "rules",
        )
        .order_by(JDAnalysisRecord.id.desc())
        .first()
    )
    if row is None:
        return None
    try:
        return JDAnalysis.model_validate(row.analysis), row.model
    except ValidationError:
        logger.warning("jd analysis %s in the database no longer validates; re-analysing", row.id)
        return None


def _db_store(db: Session, digest: str, analysis: JDAnalysis, model: str | None, job_listing_id: int | None) -> None:
    existing = (
        db.query(JDAnalysisRecord)
        .filter(
            JDAnalysisRecord.jd_hash == digest,
            JDAnalysisRecord.analyzer_version == ANALYZER_VERSION,
            JDAnalysisRecord.job_listing_id == job_listing_id,
        )
        .first()
    )
    payload = analysis.model_dump(mode="json")
    if existing is not None:
        existing.analysis, existing.source, existing.model = payload, analysis.source, model
    else:
        db.add(
            JDAnalysisRecord(
                jd_hash=digest,
                job_listing_id=job_listing_id,
                analysis=payload,
                source=analysis.source,
                model=model,
                analyzer_version=ANALYZER_VERSION,
            )
        )
    db.commit()


# ── the model call ───────────────────────────────────────────────────────


def max_chars_per_call() -> int:
    """How much posting fits one call: the context window less room for the
    instructions, the schema and the answer, at about three characters a token
    (conservative; English averages four)."""
    return max(4000, (settings.OLLAMA_NUM_CTX - 2500) * 3)


def _short(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:4])


def _call_llm(
    text: str,
    report: AnalysisReport,
    system: str = SYSTEM_PROMPT,
    tool: str = TOOL_NAME,
    schema: dict = LLM_SCHEMA,
    shape: type[BaseModel] = _LLMOutput,
    note: str = "",
):
    """One chunk through the model. A reply that is not valid JSON, or is JSON of
    the wrong shape, is re-asked with the problem named, up to
    OLLAMA_MAX_RETRIES more times. A provider failure is not retried here: the
    client has already retried transport errors itself."""
    prompt = f"JOB POSTING:\n{text}" + (f"\n\n{note}" if note else "")
    problem = ""
    for _ in range(1 + max(0, settings.OLLAMA_MAX_RETRIES)):
        user = prompt if not problem else (
            f"{prompt}\n\nYour previous answer was rejected: {problem}\nAnswer again with a corrected JSON object."
        )
        report.attempts += 1
        try:
            raw = llm_client.complete_tool_json(system, user, tool, schema, max_tokens=MAX_OUTPUT_TOKENS)
            return shape.model_validate(raw)
        except ValidationError as exc:
            problem = _short(exc)
            logger.warning("jd analysis: model reply failed validation (%s)", problem)
        except (LLMProviderError, ValueError) as exc:
            report.llm_error = f"{type(exc).__name__}: {exc}"
            logger.warning("jd analysis: model call failed (%s)", report.llm_error)
            raise _AnalysisFailed(report.llm_error) from exc
    report.llm_error = f"invalid reply after retries: {problem}"
    raise _AnalysisFailed(report.llm_error)


def _ask_what_was_missed(chunks: list[str], first: JDAnalysis, report: AnalysisReport) -> _LLMOutput | None:
    """The second call: the posting and what the first answer found, asking only
    for what is missing. Anything it returns that was already found is ignored;
    the rest is checked exactly like the first answer (by _finalize). A failure
    here keeps the first answer, so it returns None rather than raising."""
    found = [s.name for s in first.required_skills + first.preferred_skills] + list(first.tools_technologies)
    taken = {canonical(n) for n in found}
    note = "ALREADY FOUND (do not repeat): " + (", ".join(found) or "nothing")
    started, first_attempts = time.monotonic(), report.attempts
    extra = _LLMOutput.empty()
    try:
        for chunk in chunks:
            missed = _call_llm(chunk, report, MISSED_PROMPT, MISSED_TOOL_NAME, MISSED_SCHEMA, _LLMMissed, note)
            # What a "find more" call over-reaches with: a field word, a generic
            # category, or the company's industry. Dropped by category.
            for name in [s.name for s in missed.required_skills + missed.preferred_skills] + missed.tools_technologies:
                if rules.is_category_or_domain(name):
                    report.rejected.append(f"{canonical(name)} (second call: category or domain)")
            keep = lambda n: canonical(n) not in taken and not rules.is_category_or_domain(n)  # noqa: E731
            extra.required_skills += [s for s in missed.required_skills if keep(s.name)]
            extra.preferred_skills += [s for s in missed.preferred_skills if keep(s.name)]
            extra.tools_technologies += [t for t in missed.tools_technologies if keep(t)]
    except _AnalysisFailed as exc:
        report.second_call_error = str(exc)
        report.llm_error = None  # the first answer stands; this is not a failed analysis
        logger.warning("jd analysis: the second call failed (%s); keeping the first answer", exc)
        return None
    finally:
        # `attempts` stays the first answer's count; the second call's are its own.
        report.second_call_attempts = report.attempts - first_attempts
        report.attempts = first_attempts
        report.second_call_seconds = round(time.monotonic() - started, 2)
    return extra


def _merge(outputs: list[_LLMOutput]) -> _LLMOutput:
    """One output from several chunks of the same posting: the first chunk's
    title, level and years that exist, and the union of everything else."""
    merged = _LLMOutput.empty()
    for out in outputs:
        merged.job_title = merged.job_title or out.job_title
        if merged.seniority == "unknown":
            merged.seniority = out.seniority
        if merged.min_years_experience is None:
            merged.min_years_experience = out.min_years_experience
        merged.required_skills += out.required_skills
        merged.preferred_skills += out.preferred_skills
        merged.tools_technologies += out.tools_technologies
        merged.education += out.education
        merged.certifications += out.certifications
        merged.responsibilities += out.responsibilities
    return merged


# ── checking what the model said ─────────────────────────────────────────


def _clean_skills(
    items: list[_LLMSkill], cleaned: str, leak_forms: set[str], report: AnalysisReport
) -> list[Skill]:
    """Canonical names, verbatim evidence that really names the skill, no
    duplicates, and never the job title."""
    out: list[Skill] = []
    seen: set[str] = set()
    for item in items:
        # A fragment of a multi-token name ("soc" of "SOC 2") becomes the whole name.
        name = canonical(rules.full_name(cleaned, rules.trim_generic_suffix(canonical(item.name))))
        evidence = item.evidence.strip()
        if not name:
            continue
        if rules.is_generic_name(name):
            report.rejected.append(f"{name} (generic name)")
            continue
        if rules.is_soft_skill(name):
            report.rejected.append(f"{name} (soft skill)")
            continue
        if not quote_in_text(evidence, cleaned):
            report.dropped_by_evidence.append(f"{name} <- {evidence[:60]!r} (not in the posting)")
            continue
        if not (named_in(evidence, name) or named_in(evidence, item.name)):
            report.dropped_by_evidence.append(f"{name} <- {evidence[:60]!r} (quote does not name it)")
            continue
        if name in leak_forms:
            report.title_leaks.append(name)
            continue
        if name in seen:
            continue
        seen.add(name)
        out.append(Skill(name=name, evidence=evidence, alternative_group=(item.alternative_group or None)))
    return out


def _name_supported(name: str, evidence: str) -> bool:
    """A degree or certification name must be in (or mostly in) its own quote."""
    flat = lambda t: re.sub(r"[^a-z0-9+#]+", " ", t.lower()).strip()  # noqa: E731
    if flat(name) in flat(evidence):
        return True
    words = [w for w in flat(name).split() if len(w) >= 3]
    return bool(words) and sum(w in flat(evidence).split() for w in words) / len(words) >= 0.6


def _clean_requirements(
    items: list[_LLMRequirement],
    cleaned: str,
    report: AnalysisReport,
    name_ok: Callable[[str], bool],
    kind: str,
) -> list[Requirement]:
    out: list[Requirement] = []
    for item in items:
        name, evidence = item.name.strip(), item.evidence.strip()
        if not name:
            continue
        if not name_ok(name):
            report.rejected.append(f"{name} (not a {kind})")
            continue
        if not quote_in_text(evidence, cleaned) or not _name_supported(name, evidence):
            report.dropped_by_evidence.append(f"{name} <- {evidence[:60]!r} (requirement quote not in the posting)")
            continue
        if any(r.name.lower() == name.lower() for r in out):
            continue
        out.append(Requirement(name=name, required=rules.requirement_flag(cleaned, evidence, item.required), evidence=evidence))
    return out


def _finalize(out: _LLMOutput, cleaned: str, report: AnalysisReport) -> JDAnalysis:
    """Everything the model said, checked."""
    title = rules.title_from_text(out.job_title.strip())
    if not title or not quote_in_text(title, cleaned):
        title = rules.title_from_text(cleaned)
    leak_forms = rules.title_forms(title)

    required = _clean_skills(out.required_skills, cleaned, leak_forms, report)
    preferred = _clean_skills(out.preferred_skills, cleaned, leak_forms, report)

    # Where the JD puts a skill wins over the model's bucket: a nice-to-have
    # section or optional wording makes it preferred, a requirements section
    # makes it required (rules.skill_bucket).
    placed: dict[str, list[Skill]] = {"required": [], "preferred": []}
    for default, bucket in (("required", required), ("preferred", preferred)):
        for skill in bucket:
            placed[rules.skill_bucket(cleaned, skill.evidence, default)].append(skill)
    required, preferred = placed["required"], placed["preferred"]
    # A named platform mentioned only as where the work happens ("deployment on
    # AWS SageMaker") is a tool, not a skill the candidate must already have.
    environment: list[str] = []
    for bucket in (required, preferred):
        for skill in list(bucket):
            if rules.environment_only(skill.name, cleaned):
                bucket.remove(skill)
                environment.append(skill.name)
    report.moved_to_tools.extend(environment)
    required_names = {s.name for s in required}
    seen_preferred: set[str] = set()
    preferred = [
        s for s in preferred
        if s.name not in required_names and not (s.name in seen_preferred or seen_preferred.add(s.name))
    ]

    tools: list[str] = []
    for tool in out.tools_technologies:
        name = canonical(rules.full_name(cleaned, rules.trim_generic_suffix(canonical(tool))))
        if not name or name in tools:
            continue
        if name in leak_forms:
            report.title_leaks.append(name)
        elif named_in(cleaned, tool):
            tools.append(name)
        else:
            report.unsupported_tools.append(name)
    tools += [name for name in environment if name not in tools]

    years = rules.resolve_years(out.min_years_experience, cleaned)
    level, level_source = rules.resolve_seniority(title, cleaned, years, out.seniority)

    responsibilities: list[str] = []
    for phrase in out.responsibilities:
        phrase = " ".join(phrase.split()).strip(" .;")
        if phrase and len(phrase) <= MAX_RESPONSIBILITY_CHARS and phrase.lower() not in {r.lower() for r in responsibilities}:
            responsibilities.append(phrase)

    analysis = JDAnalysis(
        job_title=title,
        seniority=level,
        seniority_source=level_source,
        min_years_experience=years,
        required_skills=rules.assign_alternative_groups(required, cleaned),
        preferred_skills=rules.assign_alternative_groups(preferred, cleaned),
        tools_technologies=tools,
        education=_clean_requirements(out.education, cleaned, report, rules.education_name_ok, "degree"),
        certifications=_clean_requirements(out.certifications, cleaned, report, rules.certification_name_ok, "certification"),
        responsibilities=responsibilities[:MAX_RESPONSIBILITIES],
        source="llm",
    )

    # Certifications the pattern rules find that the model filed elsewhere or skipped.
    for extra in rules.backfill_certifications(cleaned, analysis.certifications):
        analysis.certifications.append(extra)
        report.rule_additions.append(f"certification: {extra.name}")

    # Rules merge: concepts from the vocabulary and technology-looking terms the
    # model missed, each placed by the wording of its sentence (required for
    # "must" / "experience with" / "strong" ..., preferred for "plus" / "nice to
    # have" ... or neither). The model's own tools are excluded, so something it
    # judged to be only where the work happens is not promoted by the rules.
    taken = {s.name for s in analysis.required_skills + analysis.preferred_skills} | set(tools) | leak_forms
    for name, written in rules.rule_found_skills(cleaned, exclude=taken):
        bucket = rules.classify_rule_skill(cleaned, written)
        target = analysis.required_skills if bucket == "required" else analysis.preferred_skills
        target.append(Skill(name=name, evidence=written))
        report.rule_additions.append(f"{name} ({bucket})")
    if report.rule_additions:
        analysis.source = "hybrid"
        analysis.required_skills = rules.assign_alternative_groups(analysis.required_skills, cleaned)
        analysis.preferred_skills = rules.assign_alternative_groups(analysis.preferred_skills, cleaned)

    analysis.ats_keywords = rules.build_keywords(analysis)
    return analysis


# ── public API ───────────────────────────────────────────────────────────


def listing_text(title: str | None, description: str | None) -> str:
    """The text to analyse for a crawled listing: its title on the first line,
    then the description. Crawled descriptions often leave the title out, and
    the title is where the level ("New Grad", "Staff", "Lead") is usually
    stated. A description that already opens with the title is left as it is.
    Pasted job descriptions are analysed as pasted, without this."""
    title = " ".join((title or "").split())
    body = description or ""
    if not title:
        return body
    first = next((line.strip() for line in cleaning.clean_jd(body).splitlines() if line.strip()), "")
    if first.lower() == title.lower():
        return body
    return f"{title}\n\n{body}"



def analyze_with_report(
    jd_text: str,
    db: Session | None = None,
    job_listing_id: int | None = None,
    use_cache: bool = True,
) -> tuple[JDAnalysis, AnalysisReport]:
    """The analysis and what it took. Never raises."""
    started = time.monotonic()
    report = AnalysisReport()
    cleaned = cleaning.clean_jd(jd_text)
    report.cleaned_chars = len(cleaned)
    digest = jd_hash(cleaned)
    key = f"{digest}:{ANALYZER_VERSION}"

    def done(analysis: JDAnalysis) -> tuple[JDAnalysis, AnalysisReport]:
        report.source = analysis.source
        report.seconds = round(time.monotonic() - started, 2)
        return analysis, report

    if use_cache:
        hit = _memory_get(key)
        if hit:
            report.cached = "memory"
            if db is not None and job_listing_id is not None:
                _db_store(db, digest, hit[0], hit[1], job_listing_id)
            return done(hit[0].model_copy(deep=True))
        if db is not None:
            stored = _db_lookup(db, digest)
            if stored:
                report.cached = "db"
                _memory_put(key, *stored)
                if job_listing_id is not None:
                    _db_store(db, digest, stored[0], stored[1], job_listing_id)
                return done(stored[0].model_copy(deep=True))

    analysis: JDAnalysis | None = None
    if llm_client.available and len(cleaned) >= 20:
        try:
            chunks = cleaning.split_sections(cleaned, max_chars_per_call())
            report.chunks = len(chunks)
            first = _merge([_call_llm(chunk, report) for chunk in chunks])
            if SECOND_PASS:
                # Finalize on a scratch report: only the final pass is reported.
                first_analysis = _finalize(first.model_copy(deep=True), cleaned, AnalysisReport())
                extra = _ask_what_was_missed(chunks, first_analysis, report)
                if extra is not None:
                    before = {s.name for s in first_analysis.required_skills + first_analysis.preferred_skills}
                    before |= set(first_analysis.tools_technologies)
                    analysis = _finalize(_merge([first, extra]), cleaned, report)
                    after = [s.name for s in analysis.required_skills + analysis.preferred_skills] + analysis.tools_technologies
                    report.second_call_added = [n for n in dict.fromkeys(after) if n not in before]
            if analysis is None:
                analysis = _finalize(first, cleaned, report)
        except _AnalysisFailed:
            analysis = None  # logged where it was raised; fall back below
        except Exception as exc:  # noqa: BLE001 - JD analysis is best-effort; the caller must not fail on it
            logger.exception("jd analysis: unexpected failure; using the rules-only analysis")
            report.llm_error = f"unexpected {type(exc).__name__}: {exc}"
            analysis = None
    elif not llm_client.available:
        report.llm_error = "no model available"

    if analysis is None:
        analysis = rules.rules_analysis(cleaned)
        analysis.ats_keywords = rules.build_keywords(analysis)
    else:
        model = _model_name()
        # A copy goes in the cache: the caller owns `analysis` and may change it.
        _memory_put(key, analysis.model_copy(deep=True), model)
        if db is not None:
            _db_store(db, digest, analysis, model, job_listing_id)
    return done(analysis)


def analyze(jd_text: str, db: Session | None = None, job_listing_id: int | None = None) -> JDAnalysis:
    return analyze_with_report(jd_text, db=db, job_listing_id=job_listing_id)[0]


def peek(jd_text: str, db: Session | None = None) -> JDAnalysis | None:
    """An analysis already on hand for this text (memory, then the database), or
    None. Never runs the model, so a flow that promises to be free can use an
    analysis a previous step made without ever causing one."""
    cleaned = cleaning.clean_jd(jd_text)
    digest = jd_hash(cleaned)
    hit = _memory_get(f"{digest}:{ANALYZER_VERSION}")
    if hit:
        return hit[0].model_copy(deep=True)
    if db is not None:
        stored = _db_lookup(db, digest)
        if stored:
            return stored[0].model_copy(deep=True)
    return None


def keywords_peek(
    jd_text: str, fallback: Callable[[str], list[str]] = skill_candidates, db: Session | None = None
) -> list[str]:
    """keywords_for, but only from an analysis that already exists: with none, the
    caller's own older list. For flows that must not call the model."""
    analysis = peek(jd_text, db=db) if (jd_text or "").strip() else None
    return keywords_from(analysis, jd_text, fallback) if analysis is not None else fallback(jd_text or "")


def _display(skill: Skill) -> str:
    """The skill as the JD wrote it ("CI/CD", not the canonical "cicd"), found in
    its own quote; the canonical name if it cannot be."""
    from app.core.taxonomy import CANONICAL_ALIASES

    forms = {skill.name} | {a for a, t in CANONICAL_ALIASES.items() if t == skill.name}
    for form in sorted(forms, key=len, reverse=True):
        match = re.search(r"(?<![\w])" + re.escape(form) + r"(?![\w])", skill.evidence, re.IGNORECASE)
        if match:
            return match.group(0)
    return skill.name


def keywords_for(
    jd_text: str, fallback: Callable[[str], list[str]] = skill_candidates, db: Session | None = None
) -> list[str]:
    """The flat keyword list the older scan and tailoring code works with,
    derived from the analysis (see keywords_from)."""
    if not (jd_text or "").strip():
        return fallback(jd_text or "")
    return keywords_from(analyze(jd_text, db=db), jd_text, fallback)


def keywords_from(
    analysis: JDAnalysis, jd_text: str, fallback: Callable[[str], list[str]] = skill_candidates
) -> list[str]:
    """Required skills, then preferred, then the other named tools, as the JD
    wrote them.

    When the analysis is only the rules one, `fallback` (the function the caller
    used before) gives the list instead, so a flow with no model behaves
    exactly as it did before the analyzer existed.
    """
    if analysis.source == "rules":
        return fallback(jd_text)
    keywords: list[str] = []
    seen: set[str] = set()
    for skill in analysis.required_skills + analysis.preferred_skills:
        term = _display(skill)
        if skill.name not in seen:
            seen.add(skill.name)
            keywords.append(term)
    for tool in analysis.tools_technologies:
        if tool not in seen:
            seen.add(tool)
            keywords.append(tool)
    return keywords


def structured_summary(analysis: JDAnalysis) -> str:
    """A compact text form of the analysis, for prompts that should work from the
    structured result as well as the raw posting."""
    lines = [f"Title: {analysis.job_title or 'not stated'}"]
    if analysis.seniority != "unknown":
        lines.append(f"Level: {analysis.seniority}")
    if analysis.min_years_experience is not None:
        lines.append(f"Minimum years of experience: {analysis.min_years_experience}")
    if analysis.required_skills:
        lines.append("Required: " + ", ".join(s.name for s in analysis.required_skills))
    if analysis.preferred_skills:
        lines.append("Preferred: " + ", ".join(s.name for s in analysis.preferred_skills))
    if analysis.certifications:
        lines.append("Certifications: " + ", ".join(
            f"{c.name} ({'required' if c.required else 'optional'})" for c in analysis.certifications
        ))
    return "\n".join(lines)


def to_json(analysis: JDAnalysis) -> str:
    return json.dumps(analysis.model_dump(mode="json"))
