"""
Feature engineering for the trained ATS scoring model (Phase 2).

Turns a (resume_text, job_description) pair into a fixed numeric feature vector
the Phase-3 regression model learns from. This is a PURE function — no I/O, no
network, no global state — so the exact same computation runs at training time
and at inference time in production, which rules out train/serve skew.

The features fall into three families:
  1. Keyword match  — what an ATS literally does: does the resume contain the
     skills/tech terms the job posting names.
  2. Text similarity — TF-IDF cosine, an overall "how alike is the language"
     signal that catches overlap keyword matching misses.
  3. Resume quality  — structural signals (length, quantified bullets, action
     verbs, standard sections) that reflect how well-built the resume is,
     independent of any single job.

Deliberately dependency-light: TF-IDF via scikit-learn (already needed for
Phase 3), no heavyweight embedding models. The keyword extractor is reused from
the production analyzer so the model scores against the same terms users see.
"""

import re

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.core.keywords import keyword_candidates

# Strong action verbs that signal results-oriented resume writing.
ACTION_VERBS = {
    "led", "built", "designed", "architected", "developed", "implemented", "created",
    "launched", "shipped", "drove", "owned", "managed", "delivered", "improved",
    "reduced", "increased", "optimized", "scaled", "automated", "engineered",
    "spearheaded", "established", "founded", "migrated", "deployed", "mentored",
}

SECTION_HEADERS = {
    "experience": re.compile(r"\b(experience|employment|work history)\b", re.IGNORECASE),
    "education": re.compile(r"\beducation\b", re.IGNORECASE),
    "skills": re.compile(r"\b(skills|technical skills|technologies)\b", re.IGNORECASE),
    "projects": re.compile(r"\bprojects\b", re.IGNORECASE),
}

# Ordered feature names — the training + inference code both rely on this order.
FEATURE_NAMES = [
    "keyword_overlap_ratio",
    "keyword_matched_count",
    "jd_keyword_count",
    "tfidf_cosine",
    "resume_word_count",
    "quantified_bullet_count",
    "action_verb_count",
    "section_header_count",
    "resume_jd_length_ratio",
    # ── Anti-gaming signals ───────────────────────────────────────────────
    # Added after measuring the model against constructed adversarial
    # documents: a job description pasted back beat a genuinely strong resume
    # on 99.8% of postings by a mean of 41.5 points, a keyword dump beat it on
    # 98.3%, and adding real quantified achievements COST the candidate points
    # on 86.7%. MAE was 6.5 and R2 0.79 throughout — the headline metrics
    # could not see any of it, because every training label came from a real
    # resume and the model had never been shown a document that games it.
    #
    # The nine features above are all either similarity-to-the-JD or raw
    # counts, and similarity is exactly what copying maximises. These five
    # measure the shape of the document itself, so copying and padding become
    # visible as something other than a perfect match.
    "verbatim_overlap",
    "keyword_density",
    "max_keyword_repetition",
    "lexical_diversity",
    "quantified_bullet_ratio",
]

# Long enough that a shared run is copying rather than coincidence. Job titles
# and stock phrases ("distributed systems at scale") are far shorter.
SHINGLE_SIZE = 8

_TOKEN_RE = re.compile(r"[a-z0-9+#.]+")


def _tfidf_cosine(resume_text: str, jd_text: str) -> float:
    """TF-IDF cosine similarity between the two documents, fit on just the pair
    (self-contained per call — no external corpus needed)."""
    docs = [resume_text, jd_text]
    try:
        matrix = TfidfVectorizer(stop_words="english").fit_transform(docs)
    except ValueError:
        # Raised when both docs are empty / all-stopwords → no shared vocabulary.
        return 0.0
    if matrix.shape[1] == 0:
        return 0.0
    return float(cosine_similarity(matrix[0], matrix[1])[0][0])


def _quantified_bullet_count(resume_text: str) -> int:
    """Lines that carry a concrete number, %, or $ — quantified impact."""
    count = 0
    for line in resume_text.splitlines():
        if re.search(r"\d+\s*%|\$\s*\d|\b\d[\d,\.]*\b", line):
            count += 1
    return count


def _action_verb_count(resume_text: str) -> int:
    """Lines starting with a strong action verb (after optional bullet marker)."""
    count = 0
    for line in resume_text.splitlines():
        stripped = re.sub(r"^\s*[•\-\*–•]\s*", "", line).strip()
        first = stripped.split(" ", 1)[0].lower().strip(".,:")
        if first in ACTION_VERBS:
            count += 1
    return count


def extract_features(resume_text: str, job_description: str) -> dict:
    """Pure function: (resume, JD) text -> ordered dict of numeric features.

    Returns every key in FEATURE_NAMES, always numeric, never raising — empty or
    degenerate input yields sensible zeros rather than an exception (important so
    a weird resume can't crash a live scan)."""
    resume_text = resume_text or ""
    job_description = job_description or ""

    jd_keywords = keyword_candidates(job_description)
    resume_lower = resume_text.lower()
    matched = [kw for kw in jd_keywords if kw.lower() in resume_lower]
    jd_keyword_count = len(jd_keywords)
    keyword_overlap_ratio = (len(matched) / jd_keyword_count) if jd_keyword_count else 0.0

    resume_words = len(resume_text.split())
    jd_words = len(job_description.split()) or 1

    return {
        "keyword_overlap_ratio": round(keyword_overlap_ratio, 4),
        "keyword_matched_count": len(matched),
        "jd_keyword_count": jd_keyword_count,
        "tfidf_cosine": round(_tfidf_cosine(resume_text, job_description), 4),
        "resume_word_count": resume_words,
        "quantified_bullet_count": _quantified_bullet_count(resume_text),
        "action_verb_count": _action_verb_count(resume_text),
        "section_header_count": sum(1 for rx in SECTION_HEADERS.values() if rx.search(resume_text)),
        "resume_jd_length_ratio": round(resume_words / jd_words, 4),
        **_anti_gaming_features(resume_text, job_description, jd_keywords),
    }


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _shingles(tokens: list[str], size: int = SHINGLE_SIZE) -> set[tuple[str, ...]]:
    if len(tokens) < size:
        return set()
    return {tuple(tokens[i : i + size]) for i in range(len(tokens) - size + 1)}


def _anti_gaming_features(resume_text: str, jd_text: str, jd_keywords: list[str]) -> dict:
    """Five signals that describe the document rather than its fit.

    Deliberately computed here rather than imported from
    resume_analyzer/integrity.py, which measures the same things for the UI.
    That module's thresholds exist to explain a verdict to a person and will
    be tuned for that; these feed a trained model, where any change silently
    invalidates the fitted weights. Same idea, separate lifecycles — the
    duplication is the point.
    """
    resume_tokens = _tokens(resume_text)
    jd_tokens = _tokens(jd_text)
    total = len(resume_tokens)

    if not total:
        return {
            "verbatim_overlap": 0.0,
            "keyword_density": 0.0,
            "max_keyword_repetition": 0.0,
            "lexical_diversity": 0.0,
            "quantified_bullet_ratio": 0.0,
        }

    # How much of the resume is the posting's own wording, in runs of eight.
    # A pasted JD approaches 1.0; an independently written resume sits near 0.
    resume_shingles = _shingles(resume_tokens)
    jd_shingles = _shingles(jd_tokens)
    verbatim = (
        len(resume_shingles & jd_shingles) / len(resume_shingles) if resume_shingles else 0.0
    )

    keyword_set = {kw.lower() for kw in jd_keywords}
    hits: dict[str, int] = {}
    for token in resume_tokens:
        if token in keyword_set:
            hits[token] = hits.get(token, 0) + 1

    # Normalised by length, so a long honest resume is not punished for
    # containing more of everything.
    density = sum(hits.values()) / total
    repetition = (max(hits.values()) / total) if hits else 0.0
    diversity = len(set(resume_tokens)) / total

    # The ratio the raw count should always have been. quantified_bullet_count
    # rewards a longer document; the share of bullets carrying a figure is what
    # actually distinguishes a resume that evidences its claims.
    bullets = [
        line
        for line in (resume_text or "").splitlines()
        if line.strip().startswith(("-", "•", "*", "–", "—")) and len(line.split()) > 3
    ]
    quantified = sum(1 for line in bullets if re.search(r"\d", line))
    quantified_ratio = (quantified / len(bullets)) if bullets else 0.0

    return {
        "verbatim_overlap": round(verbatim, 4),
        "keyword_density": round(density, 4),
        "max_keyword_repetition": round(repetition, 4),
        "lexical_diversity": round(diversity, 4),
        "quantified_bullet_ratio": round(quantified_ratio, 4),
    }


def features_to_vector(features: dict) -> list[float]:
    """Feature dict -> ordered list, matching FEATURE_NAMES (for the model matrix)."""
    return [float(features[name]) for name in FEATURE_NAMES]
