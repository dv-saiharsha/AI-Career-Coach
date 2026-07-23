"""Unit tests for the ATS feature extractor (app/ml/features.py).

Pure function, so these need no mocking — just assert the numbers behave.
"""

from app.ml.features import FEATURE_NAMES, extract_features, features_to_vector

STRONG_RESUME = """Jane Rivera
Senior Backend Engineer

EXPERIENCE
Senior Backend Engineer, PayFlow (fintech) — 2019 to Present
- Built a Go payments ledger service handling 12,000 transactions per second.
- Designed idempotent REST APIs and migrated the datastore to PostgreSQL, cutting p99 latency by 40%.
- Led a team of 4 engineers and mentored 2 junior developers.

SKILLS
Go, PostgreSQL, Kafka, Kubernetes, REST API design, distributed systems

EDUCATION
B.S. Computer Science
"""

WEAK_RESUME = """Sam Poole
Graphic Designer

EXPERIENCE
Freelance Graphic Designer — 2020 to Present
- Created brand identities and marketing collateral for small businesses.
- Managed client relationships and delivered projects on schedule.

SKILLS
Adobe Photoshop, Illustrator, InDesign, typography, branding

EDUCATION
B.F.A. Visual Design
"""

BACKEND_JD = """Senior Backend Engineer — payments infrastructure. 6+ years building
high-reliability distributed systems. Deep expertise in Go, PostgreSQL, and Kafka.
Experience with idempotent API design for financial transactions and Kubernetes.
"""


def test_all_feature_keys_present_and_numeric():
    feats = extract_features(STRONG_RESUME, BACKEND_JD)
    assert set(feats.keys()) == set(FEATURE_NAMES)
    assert all(isinstance(v, (int, float)) for v in feats.values())
    assert len(features_to_vector(feats)) == len(FEATURE_NAMES)


def test_strong_match_scores_higher_than_weak_match():
    strong = extract_features(STRONG_RESUME, BACKEND_JD)
    weak = extract_features(WEAK_RESUME, BACKEND_JD)
    # A well-matched resume must beat an unrelated one on both keyword overlap
    # and overall text similarity — the two signals the model leans on most.
    assert strong["keyword_overlap_ratio"] > weak["keyword_overlap_ratio"]
    assert strong["tfidf_cosine"] > weak["tfidf_cosine"]


def test_strong_resume_structural_signals():
    feats = extract_features(STRONG_RESUME, BACKEND_JD)
    assert feats["quantified_bullet_count"] >= 2  # "12,000 tps", "40%"
    assert feats["action_verb_count"] >= 2        # Built, Designed, Led
    assert feats["section_header_count"] >= 3      # Experience, Skills, Education


def test_empty_resume_does_not_crash_and_returns_zeros():
    feats = extract_features("", BACKEND_JD)
    assert feats["keyword_overlap_ratio"] == 0.0
    assert feats["keyword_matched_count"] == 0
    assert feats["resume_word_count"] == 0
    assert feats["tfidf_cosine"] == 0.0


def test_jd_with_no_clear_keywords_degrades_gracefully():
    vague_jd = "We want a good person who is nice to work with and gets things done."
    feats = extract_features(STRONG_RESUME, vague_jd)
    # No extractable skill keywords → overlap ratio defaults to 0, no exception.
    assert feats["jd_keyword_count"] == 0
    assert feats["keyword_overlap_ratio"] == 0.0


def test_both_empty_is_safe():
    feats = extract_features("", "")
    assert feats["tfidf_cosine"] == 0.0
    assert feats["resume_jd_length_ratio"] == 0.0
