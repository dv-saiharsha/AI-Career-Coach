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
]


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
    }


def features_to_vector(features: dict) -> list[float]:
    """Feature dict -> ordered list, matching FEATURE_NAMES (for the model matrix)."""
    return [float(features[name]) for name in FEATURE_NAMES]
