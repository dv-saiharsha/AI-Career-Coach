"""Tailor Resume: one stored resume + one job description -> a finished,
fact-checked, one-page resume, with the analysis that explains it.

    parse -> analyse the JD -> match -> gaps -> prioritise -> rewrite
          -> ATS-format -> fit to the page -> validate

Everything except the rewrite is deterministic and runs with no model at all.
The rewrite is one LLM call (whichever provider core/llm selects), and its
output is treated as a proposal, never as content:

  * Every rewritten bullet is checked against the entry it came from
    (guards.verify_suggestion, scoped to that role or project, not to the
    whole resume). A new number, a tool the entry never names, a dropped
    metric, or a JD term the resume does not support reverts the bullet to
    the candidate's own text. Reverted, not flagged: a flagged line still
    gets copied, and the candidate is the one who has to defend it.
  * The summary gets the same checks against the whole resume.
  * A JD skill with no evidence (jd_match "missing") or only a sibling's
    evidence ("transferable") is never written onto the resume. It is
    reported as a gap, and the candidate can confirm it if they have it;
    a confirmed skill is their statement, so it may be listed.

If the model is unavailable or its reply fails validation, the resume is still
tailored (reordered, regrouped, trimmed to the page, re-scored), and the
response says the wording was left as written.

Nothing is stored except an optional cache row (router.py). The scan the
resume came from is never modified.
"""

from __future__ import annotations

import base64
import copy
import logging
import re

from app.core.config import settings
from app.core.llm import llm_client
from app.core.taxonomy import canonical, implied_skills, skill_candidates
from app.modules.jd_analyzer import service as jd_service
from app.modules.resume_analyzer import layout_check
from app.modules.resume_analyzer.quality import _SECTION_PATTERNS
from app.modules.resume_builder import autofill, fit, guards, jd_match, outlook, skill_categories
from app.modules.resume_builder.jd_match import IMPORTANCE_WEIGHT, mentions

logger = logging.getLogger(__name__)

MIN_RESUME_CHARS = 150
MIN_JD_CHARS = 80
MAX_CONFIRMED_SKILLS = 15
MAX_REWRITE_BULLETS = 32
MAX_SKILLS = 26
MAX_BULLET_CHARS = 260
MAX_SUMMARY_WORDS = 75
DUPLICATE_JACCARD = 0.7

Design = str  # "faang" | "original"


class TailorInputError(ValueError):
    """The resume or JD cannot be tailored; the message is shown to the user."""


# ── the rewrite call ─────────────────────────────────────────────────────

REWRITE_SYSTEM_PROMPT = """You are an expert technical recruiter and resume writer tailoring a candidate's resume to one job.

Your job is to present the candidate's REAL evidence as strongly and clearly as possible for this role. You are not allowed to add anything that is not already true.

HARD RULES (a rewrite that breaks any of these is discarded):
1. Never invent or change numbers. Keep every number, percentage and metric from the original bullet exactly. Never add a new number, team size, user count, or outcome.
2. Only name a technology in a bullet if it appears in that bullet or in the TOOLS line of the same entry. Never move a tool from one job or project to another.
3. Never use any term from the DO NOT CLAIM list.
4. Use the job's wording (from ALLOWED JD TERMS) only when the original work really is that thing.
5. No first person (I, my, we, our). No buzzword filler ("synergy", "rockstar", "passionate").

HOW TO WRITE EACH BULLET:
- Pattern: strong action verb + the technical work + technology/method + scope or outcome (only if the original states it).
- Past tense for past roles, present tense for current roles. One sentence, at most 30 words.
- Replace weak openers ("Worked on", "Helped with", "Responsible for", "Made") with a precise verb that is still true ("Developed", "Built", "Implemented", "Tested", "Analyzed").
- If a bullet is already strong and relevant, return it unchanged.

SUMMARY: 2 to 3 sentences, at most 60 words, written for this exact role. Lead with what the candidate has that the employer needs most. Mention only skills from ALLOWED JD TERMS or the resume. Do not state a number of years unless FACTS gives it.

HIRING INTENT: one or two sentences on what problem this employer is hiring someone to solve and what they will value most.

Every bullet is marked [REWRITE] or [OPTIONAL]. You MUST return an improved version of every [REWRITE] bullet. Return an [OPTIONAL] bullet only if you can make it clearly more relevant to this job without breaking a rule. Use each id at most once.

Do not name the employer in the summary, and do not write "seeking" or an objective statement: the summary states what the candidate brings."""

REWRITE_SCHEMA = {
    "type": "object",
    "properties": {
        "hiring_intent": {"type": "string"},
        "summary": {"type": "string"},
        "bullets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "text": {"type": "string"}},
                "required": ["id", "text"],
            },
        },
    },
    "required": ["hiring_intent", "summary", "bullets"],
}

# A role level ("Software Engineer I") is stripped first so it is not read as
# first person. "us" is left out: it is far more often "US".
_WEAK_OPENERS = re.compile(
    r"^(?:worked|helped|assisted|responsible|participated|involved|made|did|handled|"
    r"tasked|duties|was|were|supported|contributed)\b",
    re.I,
)


def needs_rewrite(bullet: str) -> bool:
    """A bullet worth rewriting: a weak opener, or no action verb at all."""
    text = (bullet or "").strip()
    return bool(_WEAK_OPENERS.match(text)) or not guards.structure(text)["action_verb"]


_ROLE_LEVEL = re.compile(
    r"\b(?:Engineer|Developer|Analyst|Scientist|Associate|Specialist|Technician|Administrator)\s+(?:I{1,3}|IV)\b"
)


def _first_person(text: str) -> bool:
    cleaned = _ROLE_LEVEL.sub(" ", text or "")
    return bool(re.search(r"(?<![\w-])I(?![\w-])", cleaned)) or bool(
        re.search(r"\b(?:me|my|mine|we|our)\b", cleaned, re.I)
    )


def _entries(parsed: dict) -> list[dict]:
    """Roles and projects as one indexed list: id, kind, label, tools, bullets."""
    entries = []
    for i, exp in enumerate(parsed.get("experiences") or []):
        entries.append({
            "id": f"E{i + 1}", "kind": "experience", "index": i,
            "label": " at ".join(x for x in (exp.get("title"), exp.get("company")) if x) or f"Role {i + 1}",
            "dates": exp.get("dates") or "", "tools": "", "bullets": list(exp.get("bullets") or []),
        })
    for i, project in enumerate(parsed.get("projects") or []):
        entries.append({
            "id": f"P{i + 1}", "kind": "project", "index": i, "label": project.get("name") or f"Project {i + 1}",
            "dates": project.get("dates") or "", "tools": project.get("tech") or "",
            "bullets": list(project.get("bullets") or []),
        })
    return entries


def _entry_text(entry: dict) -> str:
    return "\n".join([entry["label"], entry["tools"], *entry["bullets"]])


def _generalizations(text: str) -> set[str]:
    """JD-style terms a piece of text truthfully supports: PostgreSQL -> SQL,
    pytest -> automated testing, PyTorch -> deep learning."""
    terms: set[str] = set()
    for requirement, instances in skill_categories.RELATED.items():
        if any(mentions(text, i) for i in instances):
            terms.add(requirement)
    for candidate in skill_candidates(text):
        terms |= set(implied_skills(candidate))
    return terms


def _license(text: str, extra: list[str] | None = None) -> str:
    """The text a rewrite may draw its tool names from: the text itself, what
    it truthfully generalises to, and every spelling of those terms."""
    terms = _generalizations(text) | {t for t in extra or [] if t}
    forms = {f for t in terms for f in jd_match._surface_forms(t)}
    return "\n".join([text, ", ".join(sorted(terms | forms))])


def _numbers(text: str) -> set[str]:
    return guards._normalise_numbers(text or "")


def check_bullet(original: str, rewritten: str, entry_license: str, forbidden: list[str]) -> list[str]:
    """Why a rewritten bullet may not replace the original; [] if it may."""
    problems: list[str] = []
    text = (rewritten or "").strip()
    if not text:
        return ["empty rewrite"]
    if len(text) > MAX_BULLET_CHARS:
        problems.append("too long for one or two lines")
    verdict = guards.verify_suggestion(original, text, entry_license)
    problems += verdict["violations"]
    dropped = sorted(_numbers(original) - _numbers(text))
    if dropped:
        problems.append("drops figures the original states: " + ", ".join(dropped))
    claimed = [t for t in forbidden if mentions(text, t) and not mentions(original, t)]
    if claimed:
        problems.append("claims skills the resume does not support: " + ", ".join(claimed))
    if _first_person(text) and not _first_person(original):
        problems.append("first person")
    return problems


def check_summary(summary: str, resume_license: str, resume_text: str, forbidden: list[str], years: float | None) -> list[str]:
    problems: list[str] = []
    text = (summary or "").strip()
    if not text:
        return ["empty summary"]
    if len(text.split()) > MAX_SUMMARY_WORDS:
        problems.append("too long")
    allowed_numbers = _numbers(resume_text)
    if years is not None:
        allowed_numbers |= {str(int(years)), guards._fmt(float(years))}
    invented = sorted(_numbers(text) - allowed_numbers)
    if invented:
        problems.append("states figures the resume does not: " + ", ".join(invented))
    tools = [t for t in guards.extract_tools(text) if not guards._is_licensed(t, "", resume_license)]
    if tools:
        problems.append("names technologies absent from the resume: " + ", ".join(sorted(tools)))
    claimed = [t for t in forbidden if mentions(text, t)]
    if claimed:
        problems.append("claims skills the resume does not support: " + ", ".join(claimed))
    if _first_person(text):
        problems.append("first person")
    if re.search(r"\b(seeking|looking for|aspiring|objective)\b", text, re.I):
        problems.append("reads as an objective statement, not a summary")
    return problems


def _rewrite_prompt(
    entries: list[dict], selected: list[tuple[str, str]], analysis, job_title: str, company: str,
    matches: list[jd_match.Match], supported: list[str], forbidden: list[str],
    original_summary: str, facts: list[str], jd_text: str,
) -> str:
    needs = [
        f"- [{m.requirement.importance}] {m.requirement.label}"
        for m in matches if m.requirement.importance in ("critical", "high")
    ][:12]
    evidence = [
        f"- {m.requirement.label}: {m.level}" + (f" (via {m.via})" if m.via else "")
        for m in matches if m.level in ("exact", "related")
    ][:16]
    by_entry: dict[str, list[str]] = {}
    for bid, text in selected:
        flag = "REWRITE" if needs_rewrite(text) else "OPTIONAL"
        by_entry.setdefault(bid.split(".")[0], []).append(f"  {bid} [{flag}]: {text}")
    blocks = []
    for entry in entries:
        if entry["id"] not in by_entry:
            continue
        head = f"{entry['id']} {entry['kind'].upper()}: {entry['label']}" + (f" ({entry['dates']})" if entry["dates"] else "")
        tools = ", ".join(sorted({t for t in skill_candidates(_entry_text(entry))}))[:300]
        blocks.append("\n".join([head, f"  TOOLS: {tools or 'none named'}", *by_entry[entry["id"]]]))
    responsibilities = "\n".join(f"- {r}" for r in (analysis.responsibilities or _responsibilities(jd_text))[:8]) or "(not listed)"
    return (
        f"TARGET ROLE: {job_title or analysis.job_title or 'not stated'}"
        f"{' at ' + company if company else ''}"
        f"{' (' + analysis.seniority + ' level)' if analysis.seniority != 'unknown' else ''}\n\n"
        f"WHAT THE ROLE DOES:\n{responsibilities}\n\n"
        f"MOST IMPORTANT REQUIREMENTS:\n" + ("\n".join(needs) or "(none extracted)") + "\n\n"
        "CANDIDATE EVIDENCE FOR THEM:\n" + ("\n".join(evidence) or "(none)") + "\n\n"
        f"ALLOWED JD TERMS (supported by the resume): {', '.join(supported) or 'none'}\n"
        f"DO NOT CLAIM (no evidence in the resume): {', '.join(forbidden) or 'none'}\n\n"
        f"FACTS:\n" + "\n".join(f"- {f}" for f in facts) + "\n\n"
        f"CURRENT SUMMARY: {original_summary or '(none)'}\n\n"
        f"BULLETS TO TAILOR:\n" + "\n\n".join(blocks) + "\n\n"
        f"JOB DESCRIPTION (excerpt):\n{jd_text[:2500]}"
    )


def _call_rewrite(system: str, user: str) -> dict | None:
    if not llm_client.available:
        return None
    try:
        model = settings.OLLAMA_TAILOR_MODEL if settings.LLM_PROVIDER == "ollama" and settings.OLLAMA_TAILOR_MODEL else None
        extra = {"model": model} if model else {}
        return llm_client.complete_tool_json(
            system, user, "submit_tailored_resume", REWRITE_SCHEMA, max_tokens=3500, **extra
        )
    except Exception as exc:  # provider down, timeout, malformed reply
        logger.warning("tailor rewrite call failed: %s", exc)
        return None


# ── prioritisation ───────────────────────────────────────────────────────

def _weighted_terms(matches: list[jd_match.Match]) -> list[tuple[tuple[str, ...], float]]:
    """(the surface terms that evidence one requirement, its weight). A text
    earns each requirement once, however many of its spellings it uses."""
    terms: list[tuple[tuple[str, ...], float]] = []
    for m in matches:
        if m.requirement.kind != "skill" or m.level == "missing":
            continue
        w = IMPORTANCE_WEIGHT[m.requirement.importance] * jd_match.MATCH_CREDIT[m.level]
        forms = [] if m.level == "transferable" else [m.requirement.label, m.requirement.key]
        if m.via:
            forms.append(m.via)
        terms.append((tuple(dict.fromkeys(forms)), w))
    return terms


_STOP = {"with", "and", "the", "for", "from", "that", "this", "into", "using", "build", "work", "team", "teams", "across", "other"}


def _stems(text: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[a-z]+", (text or "").lower()) if len(w) > 3 and w not in _STOP}


def responsibility_terms(duties: list[str]) -> list[set[str]]:
    return [st for st in (_stems(d) for d in duties) if len(st) >= 2]


def relevance(text: str, terms: list[tuple[tuple[str, ...], float]], duties: list[set[str]] | None = None) -> float:
    score = sum(w for forms, w in terms if any(mentions(text, f) for f in forms))
    # Work the JD describes as the job ("mentor engineers and lead design
    # reviews") counts too, not only the skills it names.
    if duties:
        stems = _stems(text)
        if any(len(stems & duty) >= 2 for duty in duties):
            score += 2.0
    structure = guards.structure(text)
    # Small tie-breakers: a quantified, verb-led bullet beats a vague one
    # with the same evidence.
    return score + 0.3 * structure["quantified_metric"] + 0.1 * structure["action_verb"]


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", (text or "").lower()) if len(w) > 2}


def _is_duplicate(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    return bool(ta and tb) and len(ta & tb) / len(ta | tb) >= DUPLICATE_JACCARD


_ECHOED_TAG = re.compile(r"^\s*(?:\[(?:REWRITE|OPTIONAL)\]\s*|[EP]\d+\.\d+\s*[:\-]\s*)+", re.I)


def _tidy(bullet: str) -> str:
    text = _ECHOED_TAG.sub("", bullet or "")
    text = re.sub(r"\s+", " ", text.strip())
    text = re.sub(r"\b(\w+) \1\b", r"\1", text, flags=re.I)
    return text[:1].upper() + text[1:] if text else text


def _skill_groups(
    parsed: dict, stored: dict, matches: list[jd_match.Match], terms: list[tuple[str, float]],
    confirmed: list[str], design: Design,
) -> tuple[list[dict], list[str], list[str]]:
    """Skills rows, most relevant first. Returns (groups, added, dropped)."""
    rows: list[tuple[str, str]] = []  # (row label, item)
    for group in parsed.get("skill_groups") or []:
        rows += [(group["category"], item) for item in group["items"]]
    if not rows:
        # No SKILLS section was readable; the scan's own extracted skills,
        # which quick_tailor uses for the same reason.
        rows = [("Skills", s) for s in (stored.get("matched_skills") or []) + (stored.get("extracted_skills") or []) if s]

    # The JD's spelling for an alias the candidate wrote differently
    # ("Postgres" -> "PostgreSQL"): same skill, the term an ATS searches for.
    jd_spelling = {m.requirement.key: m.requirement.label for m in matches if m.requirement.kind == "skill" and m.level == "exact"}
    added: list[str] = []
    seen: set[str] = set()
    items: list[tuple[str, str]] = []
    for label, item in rows:
        key = canonical(item)
        if not key or key in seen:
            continue
        seen.add(key)
        items.append((label, jd_spelling.get(key, item)))

    # Requirements the resume evidences under another name (SQL via
    # PostgreSQL), and skills the candidate confirmed. Both are true.
    for m in matches:
        if m.requirement.kind == "skill" and m.level == "related" and m.requirement.importance != "low":
            if m.requirement.key not in seen:
                seen.add(m.requirement.key)
                items.append(("", _skill_label(m.requirement.label)))
                added.append(f"{m.requirement.label} (shown by {m.via})")
    for skill in confirmed:
        if canonical(skill) not in seen:
            seen.add(canonical(skill))
            items.append(("", skill))
            added.append(f"{skill} (you confirmed it)")

    def row_for(label: str, item: str) -> str:
        if design == "original" and label:
            return label
        return skill_categories.category_of(item) or skill_categories.category_from_label(label) or ("Concepts" if not label else "Tools")

    scored = [(row_for(label, item), item, relevance(item, terms)) for label, item in items]
    # Rows rank by the most important requirement one of their items IS, not
    # by everything an item implies (PostgreSQL would otherwise also earn
    # "SQL" and "relational databases" and outrank the Languages row).
    direct = {
        key: IMPORTANCE_WEIGHT[m.requirement.importance]
        for m in matches if m.requirement.kind == "skill" and m.level in ("exact", "related")
        for key in (m.requirement.key, canonical(m.requirement.label))
    }
    # Keep everything relevant; fill the rest of the budget with the
    # candidate's other skills in their own order.
    relevant = [s for s in scored if s[2] >= 1]
    other = [s for s in scored if s[2] < 1]
    budget = max(MAX_SKILLS - len(relevant), 0)
    kept, dropped = relevant + other[:budget], [s[1] for s in other[budget:]]

    order: list[str] = []
    grouped: dict[str, list[tuple[str, float]]] = {}
    row_rank: dict[str, int] = {}
    for row, item, score in kept:
        if row not in grouped:
            grouped[row] = []
            order.append(row)
        grouped[row].append((item, score))
        row_rank[row] = max(row_rank.get(row, 0), direct.get(canonical(item), 0))
    standard = {c: i for i, c in enumerate(skill_categories.CATEGORIES)}
    # Strongest single match first (a row holding a critical skill outranks a
    # row of several minor ones), then the conventional row order.
    # Rows holding a critical/high requirement first, then the conventional
    # order (Languages leads, as recruiters expect); Concepts always last.
    order.sort(key=lambda r: (r == "Concepts", -(row_rank[r] >= IMPORTANCE_WEIGHT["high"]), standard.get(r, len(standard))))
    groups = [
        {"category": row, "items": [i for i, _ in sorted(grouped[row], key=lambda x: -x[1])]}
        for row in order
    ]
    return groups, added, dropped


def _skill_label(term: str) -> str:
    """"relational databases" -> "Relational Databases"; "CI/CD" untouched."""
    return term if any(c.isupper() for c in term) else " ".join(w[:1].upper() + w[1:] for w in term.split())


def _original_layout(resume_text: str) -> tuple[list[str], dict[str, str]]:
    """The candidate's section order and heading wording, for design="original"."""
    order: list[str] = []
    titles: dict[str, str] = {}
    for line in (resume_text or "").splitlines():
        stripped = line.strip()
        if not stripped or len(stripped.split()) > 6:
            continue
        key = None
        if autofill._SUMMARY_HEADING.match(stripped):
            key = "summary"
        else:
            key = next((name for name, pattern in _SECTION_PATTERNS if pattern.search(stripped)), None)
        if key and key not in order:
            order.append(key)
            heading = stripped.rstrip(":").strip()
            titles[key] = heading.title() if heading.isupper() else heading
    return order, titles


def _is_early_career(years: float | None, parsed: dict) -> bool:
    if years is None or years < 2:
        return True
    titles = " ".join(e.get("title") or "" for e in parsed.get("experiences") or [])
    return bool(re.search(r"\bintern", titles, re.I)) and years < 3


# ── the pipeline ─────────────────────────────────────────────────────────

def tailor(
    record,
    jd_text: str,
    *,
    analysis_text: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    full_name: str = "",
    design: Design = "faang",
    target_pages: int = 1,
    confirmed_skills: list[str] | None = None,
    db=None,
) -> dict:
    resume_text = record.resume_text or ""
    if len(resume_text.strip()) < MIN_RESUME_CHARS:
        raise TailorInputError("We couldn't read enough text from this resume to tailor it. Upload a text-based PDF or DOCX and try again.")
    jd_text = (jd_text or "").strip()
    if len(jd_text) < MIN_JD_CHARS:
        raise TailorInputError("This job description is too short to tailor against. Paste the full posting, including its requirements.")

    parsed = autofill.build_autofill(resume_text)
    if not (parsed["experiences"] or parsed["projects"] or parsed["education"]):
        raise TailorInputError(
            "We couldn't find Experience, Projects or Education sections in this resume. "
            "Make sure each section has a clear heading and re-scan it."
        )
    stored = _stored_result(record)
    confirmed = [s.strip()[:60] for s in (confirmed_skills or []) if s and s.strip()][:MAX_CONFIRMED_SKILLS]

    # 1-3. Analyse the JD, rank its requirements, match them.
    analysis = jd_service.analyze(analysis_text or jd_text, db=db)
    requirements = jd_match.build_requirements(analysis, jd_text, job_title)
    ev = jd_match.index_resume(resume_text, parsed, confirmed)
    years = jd_match.years_of_experience(parsed["experiences"])
    matches = jd_match.match_requirements(requirements, ev, years)
    supported = jd_match.supported_terms(matches)
    forbidden = jd_match.forbidden_terms(matches, resume_text + "\n" + "\n".join(confirmed))
    terms = _weighted_terms(matches)
    duties = responsibility_terms(analysis.responsibilities or _responsibilities(jd_text))

    entries = _entries(parsed)
    original_bullets = {e["id"]: list(e["bullets"]) for e in entries}

    # 4. Rewrite, in one call, then check every line of the reply.
    selected: list[tuple[str, str]] = []
    for entry in entries:
        cap = 6 if entry["kind"] == "experience" else 4
        for j, bullet in enumerate(entry["bullets"][:cap]):
            selected.append((f"{entry['id']}.{j + 1}", bullet))
    selected = selected[:MAX_REWRITE_BULLETS]

    facts = [f"{e['label']}" + (f" ({e['dates']})" if e["dates"] else "") for e in entries if e["kind"] == "experience"]
    facts += [f"Education: {d.get('degree', '')}, {d.get('institution', '')}".strip(", ") for d in parsed["education"]]
    if years is not None and years >= 1:
        facts.append(f"About {int(years)} years of listed experience")

    reply = None
    if selected or parsed.get("summary"):
        reply = _call_rewrite(
            REWRITE_SYSTEM_PROMPT,
            _rewrite_prompt(entries, selected, analysis, job_title or "", company or "", matches,
                            supported, forbidden, parsed.get("summary") or "", facts, jd_text),
        )

    changes: list[dict] = []
    by_id = {e["id"]: e for e in entries}
    accepted = reverted = 0
    if reply:
        proposed = {str(b.get("id", "")).strip(): b.get("text", "") for b in reply.get("bullets") or [] if isinstance(b, dict)}
        for bid, original in selected:
            new = _tidy(proposed.get(bid, ""))
            if not new or new.rstrip(".") == original.rstrip("."):
                continue
            entry = by_id[bid.split(".")[0]]
            problems = check_bullet(original, new, _license(_entry_text(entry)), forbidden)
            j = int(bid.split(".")[1]) - 1
            if problems:
                reverted += 1
                changes.append({"entry": entry["label"], "original": original, "tailored": new, "status": "reverted", "reasons": problems})
            else:
                accepted += 1
                entry["bullets"][j] = new
                changes.append({"entry": entry["label"], "original": original, "tailored": new, "status": "rewritten", "reasons": []})

    resume_license = _license(resume_text, confirmed + supported) + "\n" + f"{job_title or ''} {company or ''} {analysis.job_title}"
    summary = parsed.get("summary") or ""
    summary_note = None
    if reply and (reply.get("summary") or "").strip():
        candidate = re.sub(r"\s+", " ", reply["summary"]).strip()
        problems = check_summary(candidate, resume_license, resume_text, forbidden, years)
        if problems:
            summary_note = "AI summary discarded: " + "; ".join(problems)
        else:
            summary = candidate
    hiring_intent = (reply or {}).get("hiring_intent", "").strip()[:600] or _hiring_intent(analysis, matches, job_title, company, jd_text)

    # 5. Prioritise: bullets by relevance within each entry, projects by
    # relevance, duplicates out, space by relevance.
    notes: list[str] = []
    kept_bullets: list[str] = []
    removed_duplicates = 0
    entry_scores: dict[str, float] = {}
    for entry in entries:
        scored = sorted(
            ((relevance(b, terms, duties), j, b) for j, b in enumerate(entry["bullets"])),
            key=lambda x: (-x[0], x[1]),
        )
        unique = []
        for score, _, bullet in scored:
            if any(_is_duplicate(bullet, k) for k in kept_bullets):
                removed_duplicates += 1
                continue
            kept_bullets.append(bullet)
            unique.append((score, bullet))
        entry["scored"] = unique
        entry_scores[entry["id"]] = sum(s for s, _ in unique[:3])

    roles = [e for e in entries if e["kind"] == "experience"]
    ranked_roles = sorted(roles, key=lambda e: -entry_scores[e["id"]])
    for position, entry in enumerate(ranked_roles):
        cap = 5 if position < 2 else 4
        if entry_scores[entry["id"]] < 1 and entry["index"] >= 2:
            cap = 2
            notes.append(f"Compressed {entry['label']}: little of it bears on this job")
        entry["bullets"] = [b for _, b in entry["scored"][:cap]]

    projects = sorted((e for e in entries if e["kind"] == "project"), key=lambda e: -entry_scores[e["id"]])
    dropped_projects = []
    if len(projects) > 2:
        while len(projects) > 2 and entry_scores[projects[-1]["id"]] < 1:
            dropped_projects.append(projects.pop()["label"])
    for entry in projects:
        entry["bullets"] = [b for _, b in entry["scored"][:3]]
    if projects and [p["index"] for p in projects] != sorted(p["index"] for p in projects):
        notes.append(f"Moved {projects[0]['label']} to the top of Projects: it is the most relevant to this job")
    if dropped_projects:
        notes.append("Left out projects unrelated to this job: " + ", ".join(dropped_projects))

    groups, added_skills, dropped_skills = _skill_groups(parsed, stored, matches, terms, confirmed, design)

    certifications = sorted(parsed["certifications"], key=lambda c: -relevance(c, terms))

    # 6. Format.
    if design == "original":
        section_order, section_titles = _original_layout(resume_text)
    elif _is_early_career(years, parsed):
        section_order, section_titles = ["summary", "education", "skills", "experience", "projects", "certifications", "awards", "publications"], {}
    else:
        section_order, section_titles = list(fit.latex.DEFAULT_SECTION_ORDER), {}

    payload = {
        "candidate_name": (full_name or "").strip() or parsed.get("name") or "Candidate",
        "email": parsed.get("email") or "",
        "phone": parsed.get("phone") or "",
        "location": parsed.get("location") or "",
        # The parser keeps the URL as written; the renderer only links an
        # absolute one, so a bare "linkedin.com/in/x" would vanish.
        "linkedin": _absolute_url(parsed.get("linkedin") or ""),
        "summary": summary,
        "skill_groups": groups,
        "experiences": [
            {**parsed["experiences"][e["index"]], "bullets": e["bullets"]} for e in roles
        ],
        "projects": [
            {**parsed["projects"][e["index"]], "bullets": e["bullets"]} for e in projects
        ],
        "education": parsed["education"],
        "certifications": certifications,
        "awards": parsed["awards"],
        "publications": parsed["publications"],
        "section_order": section_order,
        "section_titles": section_titles,
    }
    _normalise_punctuation(payload)

    # 7. Fit to the page: compile, measure, trim, repeat (fit.py).
    fitted = fit.fit_to_pages(copy.deepcopy(payload), target_pages, None, ladder="tailored")
    content = fitted["content"]
    from app.modules.resume_builder.services import _resume_text_from_payload  # services imports faang; avoid a cycle

    final_text = _resume_text_from_payload(content)

    # 8. Validate, and measure.
    # Same scorer and same analysis on both sides: comparable by construction.
    from app.modules.resume_analyzer.services import score_with_source

    before, score_source = score_with_source(resume_text, jd_text, analysis)
    after, _ = score_with_source(final_text, jd_text, analysis)

    validation = _validate(content, final_text, fitted, resume_text, matches, supported, forbidden,
                           accepted, reverted, removed_duplicates, target_pages)

    match_dicts = [_with_buried(m, original_bullets, entries) for m in matches]
    analysis_out = {
        "job_title": job_title or analysis.job_title,
        "company": company or "",
        "seniority": analysis.seniority,
        "hiring_intent": hiring_intent,
        "coverage": jd_match.coverage(matches),
        "counts": {level: sum(1 for m in matches if m.level == level) for level in ("exact", "related", "transferable", "missing")},
        "requirements": match_dicts,
        "strong_matches": [m.requirement.label for m in matches if m.level in ("exact", "related") and m.requirement.importance in ("critical", "high", "medium")],
        "transferable": [{"requirement": m.requirement.label, "via": m.via, "evidence": m.evidence} for m in matches if m.level == "transferable"],
        "missing": [{"requirement": m.requirement.label, "importance": m.requirement.importance, "kind": m.requirement.kind} for m in matches if m.level == "missing"],
        "keywords": [
            {"term": m.requirement.label, "importance": m.requirement.importance,
             "supported": m.level in ("exact", "related"), "on_resume": mentions(final_text, m.requirement.label)}
            for m in matches if m.requirement.kind == "skill"
        ],
        "buried": [d["requirement"] for d in match_dicts if d.get("buried")],
        "listed_not_shown": [m.requirement.label for m in matches if m.level == "exact" and not m.demonstrated and m.section == "skills" and m.requirement.importance in ("critical", "high")],
        "low_value_bullets": [b for e in entries for s, b in e["scored"] if s < 1][:8],
        "years_experience": years,
        "jd_analysis_source": analysis.source,
    }

    summary_changes = _summary_of_changes(
        accepted, reverted, summary, parsed.get("summary") or "", summary_note, notes, added_skills,
        dropped_skills, groups, removed_duplicates, fitted["adjustments"], analysis_out["missing"], reply is not None,
    )

    from app.modules.resume_builder import faang

    title_for_file = job_title or analysis.job_title
    filename = (
        faang.build_filename(payload["candidate_name"], title_for_file, company or "")
        if title_for_file else f"{'_'.join(reversed(faang.split_name(payload['candidate_name'])))}_RESUME.pdf"
    )
    return {
        "analysis": analysis_out,
        "tailoring": {
            "changes": summary_changes,
            "bullet_changes": changes,
            "ai": {
                "used": reply is not None,
                "provider": getattr(llm_client, "provider", None),
                "rewrites_accepted": accepted,
                "rewrites_reverted": reverted,
                "note": None if reply is not None else (
                    "The AI writer was unavailable, so your wording was kept as written; "
                    "everything else (ordering, skills, page fit, analysis) was still tailored."
                ),
            },
        },
        "resume": {
            "content": {k: v for k, v in content.items() if k not in ("section_titles",)},
            "section_titles": content.get("section_titles") or {},
            "text": final_text,
            "pdf_base64": base64.b64encode(fitted["pdf_bytes"]).decode("ascii"),
            "tex_source": fitted["tex"],
            "page_count": fitted["page_count"],
            "target_pages": target_pages,
            "fits": fitted["fits"],
            "adjustments": fitted["adjustments"],
            "design": design,
            "filename": filename,
        },
        "validation": validation,
        "scores": {
            "before": before,
            "after": after,
            "source": score_source,
            "change": outlook.score_change(before, after),
            # Coverage does not move with tailoring (nothing is added that the
            # resume did not already evidence), so the outlook changes only
            # through the ATS score.
            "outlook_before": outlook.shortlist_outlook(before, analysis_out["coverage"], match_dicts),
            "outlook_after": outlook.shortlist_outlook(after, analysis_out["coverage"], match_dicts),
        },
    }


def _absolute_url(url: str) -> str:
    return f"https://{url}" if url and not re.match(r"https?://", url, re.I) else url


def _stored_result(record) -> dict:
    import json

    try:
        return json.loads(record.result_json or "{}")
    except (TypeError, ValueError):
        return {}


_DUTIES_HEADING = re.compile(r"^\s*(responsibilities|what you.?ll do|what you will do|the role|you will|your impact|day to day)\b", re.I)
_LIST_ITEM = re.compile(r"^\s*[-•*·▪]\s+(.+)")


def _responsibilities(jd_text: str) -> list[str]:
    """The bullet list under a responsibilities heading, when the JD analysis
    (rules-only) has none."""
    duties: list[str] = []
    active = False
    for line in (jd_text or "").splitlines():
        if _DUTIES_HEADING.match(line):
            active = True
            continue
        if not active:
            continue
        if m := _LIST_ITEM.match(line):
            duties.append(m.group(1).strip())
        elif line.strip() and duties:
            break
    return duties[:8]


def _hiring_intent(analysis, matches, job_title, company, jd_text="") -> str:
    who = company or "This employer"
    role = job_title or analysis.job_title or "this role"
    level = f"{analysis.seniority} " if analysis.seniority not in ("unknown", "") else ""
    if level.strip().lower() in role.lower():
        level = ""
    article = "an" if (level or role)[:1].lower() in "aeiou" else "a"
    duties = analysis.responsibilities or _responsibilities(jd_text)
    work = " and ".join(d.rstrip(".")[:1].lower() + d.rstrip(".")[1:] for d in duties[:2])
    top = [m.requirement.label for m in matches if m.requirement.importance in ("critical", "high") and m.requirement.kind == "skill"][:4]
    parts = [f"{who} is hiring {article} {level}{role}" + (f" to {work}" if work else "") + "."]
    if top:
        parts.append(f"The strongest signals for this role are {', '.join(top)}.")
    return " ".join(parts)


def _with_buried(m: jd_match.Match, original_bullets: dict[str, list[str]], entries: list[dict]) -> dict:
    """Flag evidence the original resume hid: past the second bullet of its
    role, or in a role below the first two."""
    d = m.to_dict()
    d["buried"] = False
    if m.level in ("exact", "related") and m.demonstrated and m.requirement.importance != "low":
        for i, entry in enumerate(entries):
            bullets = original_bullets.get(entry["id"], [])
            if m.evidence in bullets:
                position = bullets.index(m.evidence)
                d["buried"] = position >= 2 or (entry["kind"] == "experience" and entry["index"] >= 2)
                break
    return d


def _normalise_punctuation(payload: dict) -> None:
    """One trailing-period convention across all bullets, the majority's."""
    lists = [e["bullets"] for e in payload["experiences"] + payload["projects"]]
    bullets = [b for bl in lists for b in bl]
    if not bullets:
        return
    with_period = sum(1 for b in bullets if b.rstrip().endswith("."))
    use_period = with_period * 2 >= len(bullets)
    for bl in lists:
        for i, b in enumerate(bl):
            b = _tidy(b).rstrip()
            if use_period and not b.endswith((".", "!", "?")):
                b += "."
            elif not use_period:
                b = b.rstrip(".")
            bl[i] = b


def _validate(content, final_text, fitted, resume_text, matches, supported, forbidden,
              accepted, reverted, removed_duplicates, target_pages) -> dict:
    checks: list[dict] = []

    def add(key, label, ok, detail, warn=False):
        checks.append({"key": key, "label": label, "status": "pass" if ok else ("warn" if warn else "fail"), "detail": detail})

    leaked = [t for t in forbidden if mentions(final_text, t) and not mentions(resume_text, t)]
    add("truthfulness", "No unsupported experience or skills", not leaked,
        (f"Every line is the candidate's own or a fact-checked rewrite of it. {accepted} rewrite(s) kept"
         + (f", {reverted} reverted to the original wording because they failed the fact checks." if reverted else "."))
        if not leaked else "Unsupported terms reached the resume: " + ", ".join(leaked))

    important = [m for m in matches if m.requirement.importance in ("critical", "high") and m.level in ("exact", "related")]
    shown = [m for m in important if m.requirement.kind != "skill" or mentions(final_text, m.requirement.label) or (m.via and mentions(final_text, m.via))]
    add("jd_alignment", "Most important requirements are visible", len(shown) == len(important),
        f"{len(shown)} of {len(important)} critical/high requirements the candidate meets appear on the page.", warn=True)

    on_page = [t for t in supported if mentions(final_text, t)]
    ratio = len(on_page) / len(supported) if supported else 1.0
    add("keywords", "Supported JD keywords included", ratio >= 0.8,
        f"{len(on_page)} of {len(supported)} supported keywords appear"
        + (f"; not on the page: {', '.join(t for t in supported if t not in on_page)}" if ratio < 1 else "") + ".", warn=True)

    readiness = layout_check.inspect_ats_parsing_readiness(final_text, fitted["pdf_bytes"])
    add("ats", "ATS-readable layout", bool(readiness.get("is_single_column", True)) and readiness["parsing_readiness_score"] >= 70,
        f"Single column, standard headings, no tables, graphics or icons in the body. Parsing readiness {readiness['parsing_readiness_score']}/100.", warn=True)

    bullets = [b for e in content.get("experiences", []) + content.get("projects", []) for b in e.get("bullets", [])]
    structures = [guards.structure(b) for b in bullets]
    verb_share = sum(s["action_verb"] for s in structures) / len(structures) if structures else 1.0
    quantified = sum(s["quantified_metric"] for s in structures)
    add("impact", "Accomplishment-oriented bullets", verb_share >= 0.7,
        f"{round(verb_share * 100)}% of bullets open with an action verb; {quantified} carry a metric from the original resume (none were added).", warn=True)

    tech_share = sum(s["technical_tool"] for s in structures) / len(structures) if structures else 1.0
    add("credibility", "Technically specific", tech_share >= 0.5,
        f"{round(tech_share * 100)}% of bullets name the technology or method used.", warn=True)

    add("duplication", "No repeated content", True,
        f"Removed {removed_duplicates} near-duplicate bullet(s)." if removed_duplicates else "No near-duplicate bullets found.")

    long_ones = [b for b in bullets if len(b) > 220]
    lower_start = [b for b in bullets if b[:1].islower()]
    add("grammar", "Consistent capitalization and punctuation", not lower_start,
        "Bullets were normalised to one capitalization and end-punctuation style"
        + (f"; {len(long_ones)} bullet(s) run past two lines." if long_ones else "."), warn=True)

    add("length", "Fits the page target", fitted["fits"],
        f"Compiled to {fitted['page_count']} page(s) on US Letter, target {target_pages}"
        + (" — the remaining content is all job-relevant, so nothing more was cut." if not fitted["fits"] else "."),
        warn=True)

    status = "fail" if any(c["status"] == "fail" for c in checks) else "warn" if any(c["status"] == "warn" for c in checks) else "pass"
    return {"status": status, "checks": checks}


def _summary_of_changes(accepted, reverted, summary, original_summary, summary_note, notes, added_skills,
                        dropped_skills, groups, removed_duplicates, adjustments, missing, ai_used) -> list[dict]:
    out: list[dict] = []

    def add(change, reason):
        out.append({"change": change, "reason": reason})

    if accepted:
        add(f"Rewrote {accepted} bullet(s) as action + technical work + technology + outcome",
            "Stronger, job-specific wording for the same work, using the posting's terms where the resume supports them.")
    if reverted:
        add(f"Kept the original wording of {reverted} bullet(s)",
            "The AI rewrite failed a fact check (a new number, a tool that entry never used, or an unsupported skill).")
    if summary and summary != original_summary:
        add("Wrote a summary targeted at this role" if not original_summary else "Retargeted the summary at this role",
            "Recruiters read the summary first; it now leads with the qualifications this employer weighs most.")
    elif summary_note:
        add("Kept your original summary", summary_note)
    add("Reordered bullets within each role by relevance to this job",
        "The evidence that matches the most important requirements is read first; experience stays in reverse-chronological order, which ATS parsers and recruiters expect.")
    for note in notes:
        add(note, "More room for the experience that matches this job.")
    if groups:
        add(f"Regrouped skills with {groups[0]['category']} first",
            "The skills this job asks for are the first thing a recruiter and an ATS see in that section.")
    if added_skills:
        add("Added to skills: " + ", ".join(added_skills), "Each is directly evidenced by your resume or confirmed by you.")
    if dropped_skills:
        add("Left out unrelated skills: " + ", ".join(dropped_skills[:10]), "They don't bear on this job and cost space on a one-page resume.")
    if removed_duplicates:
        add(f"Removed {removed_duplicates} near-duplicate bullet(s)", "Repeated evidence spends space without adding information.")
    for adjustment in adjustments:
        add(adjustment[:1].upper() + adjustment[1:], "Needed to fit the page target.")
    gaps = [m["requirement"] for m in missing if m["kind"] == "skill" and m["importance"] in ("critical", "high", "medium")]
    if gaps:
        add("Did not add: " + ", ".join(gaps[:8]),
            "Your resume shows no evidence of these. If you do have them, confirm them and re-run; otherwise they are genuine gaps to address.")
    if not ai_used:
        add("Kept your wording as written", "The AI writer was unavailable for this run.")
    return out
