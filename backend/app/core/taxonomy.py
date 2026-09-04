"""Technical skill taxonomy: alias resolution, implied parents, and domains.

Why this exists: keyword matching in app/core/keywords.py is literal substring
matching. A resume listing PyTorch and CUDA against a JD asking for "Deep
Learning" reports Deep Learning as MISSING — a false negative the candidate
sees and cannot act on, because they already have the skill.

Three mechanisms, in increasing order of inference:

  1. Alias resolution   "Node.js" / "NodeJS" / "node js" -> one canonical node.
                        Lossless: these are the same thing spelled differently.
  2. Implied parents    PyTorch implies deep learning, which implies machine
                        learning. Transitive, and credited at less than 1.0
                        because implication is evidence, not proof.
  3. Domain grouping    Skills carry a domain so a gap can be reported as
                        "3 of 5 Cloud Infrastructure skills missing" rather
                        than as an unordered bag of words.

IMPORTANT: nothing here is imported by app/ml/features.py. That module's
feature computation is frozen — the trained model was fit on its exact output,
so changing how it matches keywords would create train/serve skew. This
taxonomy improves what the analyzer *reports* and powers the quality
diagnostics; the model's inputs are untouched.
"""

import re

# ── Alias resolution ─────────────────────────────────────────────────────
# Written as {alias: canonical}. Canonical forms are lowercase and are what
# every other table in this module keys on.
CANONICAL_ALIASES: dict[str, str] = {
    # Cloud
    "amazon web services": "aws",
    "aws cloud": "aws",
    "google cloud platform": "gcp",
    "google cloud": "gcp",
    "microsoft azure": "azure",
    "azure cloud": "azure",
    # JS ecosystem
    "react.js": "react",
    "reactjs": "react",
    "react js": "react",
    "node.js": "node",
    "nodejs": "node",
    "node js": "node",
    "vue.js": "vue",
    "vuejs": "vue",
    "next.js": "nextjs",
    "typescript": "typescript",
    "ts": "typescript",
    "js": "javascript",
    # Python ecosystem
    "fast-api": "fastapi",
    "fast api": "fastapi",
    "scikit learn": "scikit-learn",
    "sklearn": "scikit-learn",
    "py torch": "pytorch",
    "torch": "pytorch",
    "tensor flow": "tensorflow",
    "tf": "tensorflow",
    # Data / infra
    "postgres": "postgresql",
    "postgre sql": "postgresql",
    "k8s": "kubernetes",
    "k8": "kubernetes",
    "ci/cd": "cicd",
    "ci cd": "cicd",
    "continuous integration": "cicd",
    "rest api": "rest apis",
    "restful apis": "rest apis",
    "restful api": "rest apis",
    "graph ql": "graphql",
    # ML / AI
    "ml": "machine learning",
    "dl": "deep learning",
    "nlp": "natural language processing",
    "llms": "llm",
    "large language models": "llm",
    "large language model": "llm",
    "cv": "computer vision",
    # Power systems — the domain that motivated this module. A general
    # embedding model has no idea PSCAD and PowerWorld are the same activity.
    "load flow": "power flow analysis",
    "power flow": "power flow analysis",
    "load flow analysis": "power flow analysis",
    "facts": "flexible ac transmission systems",
    "hvdc": "high voltage direct current",
    "power world": "powerworld",
    "etap": "etap",
}

# ── Implied parents ──────────────────────────────────────────────────────
# {canonical_skill: [parents]}. Resolved transitively by implied_skills(), so
# pytorch -> deep learning -> machine learning needs only one hop declared per
# level. Keep edges factual: a parent must be genuinely entailed by the child,
# not merely correlated with it. "Uses Docker" does not entail "knows AWS".
IMPLIED_PARENTS: dict[str, list[str]] = {
    "pytorch": ["deep learning", "python"],
    "tensorflow": ["deep learning", "python"],
    "keras": ["deep learning", "python"],
    "deep learning": ["machine learning"],
    "scikit-learn": ["machine learning", "python"],
    "machine learning": ["data science"],
    "natural language processing": ["machine learning"],
    "computer vision": ["deep learning"],
    "llm": ["natural language processing"],
    "pandas": ["python", "data analysis"],
    "numpy": ["python"],
    "fastapi": ["python", "rest apis", "backend development"],
    "django": ["python", "backend development"],
    "flask": ["python", "backend development"],
    "react": ["javascript", "frontend development"],
    "vue": ["javascript", "frontend development"],
    "nextjs": ["react", "frontend development"],
    "typescript": ["javascript"],
    "node": ["javascript", "backend development"],
    "docker": ["containerization", "devops"],
    "kubernetes": ["containerization", "orchestration", "devops"],
    "terraform": ["infrastructure as code", "devops"],
    "cicd": ["devops"],
    "aws": ["cloud infrastructure"],
    "gcp": ["cloud infrastructure"],
    "azure": ["cloud infrastructure"],
    "postgresql": ["sql", "databases"],
    "mysql": ["sql", "databases"],
    "mongodb": ["databases", "nosql"],
    "redis": ["databases", "caching"],
    "spark": ["distributed systems", "big data"],
    "kafka": ["distributed systems", "event streaming"],
    "power flow analysis": ["power systems", "grid modeling"],
    "pscad": ["power systems", "power system simulation"],
    "powerworld": ["power systems", "power system simulation"],
    "etap": ["power systems", "power system simulation"],
    "high voltage direct current": ["power systems", "transmission"],
    "flexible ac transmission systems": ["power systems", "transmission"],
}

# Credit for a skill the candidate never wrote down but demonstrably implies.
# Below 1.0 on purpose: listing PyTorch is strong evidence of deep learning
# knowledge, but a recruiter searching the literal phrase still won't find it,
# so the candidate should be nudged to state it.
IMPLIED_CREDIT = 0.85

# Each additional hop is weaker: pytorch -> deep learning is near-certain,
# pytorch -> ... -> data science much less so.
IMPLIED_DECAY = 0.9

# ── Domains ──────────────────────────────────────────────────────────────
DOMAINS: dict[str, str] = {}


def _register_domain(domain: str, skills: list[str]) -> None:
    for skill in skills:
        DOMAINS[skill] = domain


_register_domain("AI/ML Engineering", [
    "pytorch", "tensorflow", "keras", "deep learning", "machine learning",
    "scikit-learn", "natural language processing", "computer vision", "llm",
    "data science", "mlops",
])
_register_domain("Cloud Infrastructure", [
    "aws", "gcp", "azure", "cloud infrastructure", "docker", "kubernetes",
    "terraform", "containerization", "orchestration", "devops", "cicd",
    "infrastructure as code",
])
_register_domain("Backend Engineering", [
    "python", "fastapi", "django", "flask", "node", "rest apis", "graphql",
    "backend development", "microservices",
])
_register_domain("Frontend Engineering", [
    "react", "vue", "nextjs", "javascript", "typescript", "frontend development",
    "css", "html",
])
_register_domain("Data Engineering", [
    "sql", "postgresql", "mysql", "mongodb", "redis", "databases", "nosql",
    "spark", "kafka", "big data", "distributed systems", "data analysis",
    "pandas", "numpy", "caching", "event streaming",
])
_register_domain("Power Systems", [
    "power systems", "power flow analysis", "grid modeling", "pscad",
    "powerworld", "etap", "power system simulation", "transmission",
    "high voltage direct current", "flexible ac transmission systems",
])

_NON_ALNUM = re.compile(r"[^a-z0-9+#]+")


def canonical(term: str) -> str:
    """Resolve a raw term to its canonical node.

    Matches on a punctuation-stripped form as well as the literal one, so
    "Node.js", "node js" and "NodeJS" all land on the same node without every
    spelling needing its own alias entry.
    """
    cleaned = (term or "").strip().lower()
    if not cleaned:
        return ""
    if cleaned in CANONICAL_ALIASES:
        return CANONICAL_ALIASES[cleaned]

    # "node.js" -> "nodejs", "ci/cd" -> "cicd": collapse separators entirely.
    collapsed = _NON_ALNUM.sub("", cleaned)
    if collapsed in CANONICAL_ALIASES:
        return CANONICAL_ALIASES[collapsed]

    # "node.js" -> "node js": separators to spaces, which is how the multi-word
    # aliases above are written.
    spaced = _NON_ALNUM.sub(" ", cleaned).strip()
    if spaced in CANONICAL_ALIASES:
        return CANONICAL_ALIASES[spaced]

    return spaced or cleaned


def implied_skills(skill: str, _seen: set[str] | None = None, _depth: int = 0) -> dict[str, float]:
    """Skills entailed by `skill`, mapped to their credit weight.

    Excludes the skill itself — the caller already has that at full credit.
    Cycle-safe via _seen, so a mistaken A->B->A edge in the table degrades to a
    missing entry rather than infinite recursion.
    """
    seen = _seen if _seen is not None else {canonical(skill)}
    node = canonical(skill)
    credit = IMPLIED_CREDIT * (IMPLIED_DECAY**_depth)

    result: dict[str, float] = {}
    for parent in IMPLIED_PARENTS.get(node, []):
        if parent in seen:
            continue
        seen.add(parent)
        # max(): a parent reachable by two paths keeps its strongest evidence.
        result[parent] = max(result.get(parent, 0.0), credit)
        for ancestor, ancestor_credit in implied_skills(parent, seen, _depth + 1).items():
            result[ancestor] = max(result.get(ancestor, 0.0), ancestor_credit)
    return result


def expand_skills(skills: list[str]) -> dict[str, float]:
    """Canonical skills the candidate holds, mapped to credit.

    Explicit skills score 1.0. Implied ones score less, and an explicitly
    stated skill always beats the same skill arrived at by implication.
    """
    expanded: dict[str, float] = {}
    for raw in skills:
        node = canonical(raw)
        if not node:
            continue
        expanded[node] = 1.0
    for raw in skills:
        for implied, credit in implied_skills(raw).items():
            if expanded.get(implied, 0.0) < credit:
                expanded[implied] = credit
    return expanded


# Every multi-word skill the taxonomy knows, longest first so "power flow
# analysis" is matched before the shorter "power flow" inside it.
#
# This exists because app/core/keywords.py extracts single tokens only: a JD
# asking for "Deep Learning" yields the candidates "Deep" and "Learning",
# neither of which is a taxonomy node. Without phrase detection the headline
# case — PyTorch implying deep learning — silently never fires.
_MULTIWORD_TERMS: list[str] = sorted(
    {
        term
        for term in (
            list(CANONICAL_ALIASES.keys())
            + list(CANONICAL_ALIASES.values())
            + list(IMPLIED_PARENTS.keys())
            + [parent for parents in IMPLIED_PARENTS.values() for parent in parents]
            + list(DOMAINS.keys())
        )
        if " " in term
    },
    key=len,
    reverse=True,
)

_MULTIWORD_RE = re.compile(
    r"\b(" + "|".join(re.escape(term) for term in _MULTIWORD_TERMS) + r")\b",
    re.IGNORECASE,
)


def detect_phrases(text: str) -> list[str]:
    """Canonical multi-word skills present in free text.

    Order-preserving and de-duplicated, so callers can append these to
    single-token candidates without reshuffling what the user sees.
    """
    found: list[str] = []
    seen: set[str] = set()
    for match in _MULTIWORD_RE.finditer(text or ""):
        node = canonical(match.group(0))
        if node and node not in seen:
            seen.add(node)
            found.append(node)
    return found


def skill_candidates(text: str) -> list[str]:
    """Skill terms in free text: single tokens plus multi-word phrases.

    The one place that combines the two, so every caller agrees on what counts
    as a keyword. Fragments of a detected phrase are dropped — otherwise
    "Deep Learning" surfaces three times ("deep learning", "Deep", "Learning")
    and the fragments get reported as gaps the phrase already covered.

    NOT used by app/ml/features.py, which keeps its own literal single-token
    matching: the trained model was fit on that exact computation.
    """
    from app.core.keywords import keyword_candidates

    single_tokens = keyword_candidates(text)
    phrases = detect_phrases(text)
    fragments = {word for phrase in phrases for word in phrase.split()}
    known = {canonical(token) for token in single_tokens}

    candidates = [t for t in single_tokens if t.lower() not in fragments]
    candidates += [p for p in phrases if p not in known]
    return candidates


def skill_candidates_from_posting(jd_text: str) -> list[str]:
    """skill_candidates, but for a job posting specifically — never a resume.

    Strips a leading "About Us"-shaped preamble first (see
    keywords._requirements_text): a real Cloudflare posting opened with
    company-history and press-mention paragraphs, and keyword_candidates has
    no way to tell "Fortune", "Magazine", "World's Most Innovative Companies"
    apart from a real skill name — both are capitalised words mid-sentence.
    That preamble only exists in postings, so this must only ever be called
    with jd_text, never resume_text — skill_candidates itself is still what
    every resume-text call site uses.
    """
    from app.core.keywords import _requirements_text

    return skill_candidates(_requirements_text(jd_text))


def domain_of(skill: str) -> str | None:
    return DOMAINS.get(canonical(skill))


def group_by_domain(skills: list[str]) -> dict[str, list[str]]:
    """Bucket skills by domain. Anything unmapped lands in 'Other' rather than
    being dropped — a skill we don't have a domain for is still a real skill."""
    grouped: dict[str, list[str]] = {}
    for skill in skills:
        grouped.setdefault(domain_of(skill) or "Other", []).append(skill)
    return grouped
