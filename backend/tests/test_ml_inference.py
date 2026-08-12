"""Phase 6 — confirms predict_score() is deterministic and bounded, the two
properties that actually matter for a score users will see and compare across
repeated scans of the same resume."""

import pytest

from app.ml.inference import model_available, predict_score

pytestmark = pytest.mark.skipif(not model_available(), reason="no trained model on disk yet")

STRONG_RESUME = """
Jane Doe
Backend Engineer with 5 years of experience in Python, FastAPI, PostgreSQL, and Docker.
EXPERIENCE
Senior Backend Engineer, Acme Corp
- Built and scaled REST APIs serving 2M requests/day using Python and FastAPI
- Reduced query latency 40% by optimizing PostgreSQL indexes
SKILLS
Python, FastAPI, PostgreSQL, Docker, Kubernetes, AWS
"""

BACKEND_JD = """
Backend Engineer — you'll build REST APIs in Python (FastAPI or Flask), work with
PostgreSQL, and deploy services with Docker and Kubernetes on AWS.
"""

UNRELATED_RESUME = "A short note about gardening tips and favorite recipes."


def test_predict_score_is_deterministic():
    a = predict_score(STRONG_RESUME, BACKEND_JD)
    b = predict_score(STRONG_RESUME, BACKEND_JD)
    assert a == b


def test_predict_score_is_bounded_0_to_100():
    for resume, jd in [(STRONG_RESUME, BACKEND_JD), (UNRELATED_RESUME, BACKEND_JD), ("", "")]:
        score = predict_score(resume, jd)
        assert isinstance(score, int)
        assert 0 <= score <= 100


def test_strong_match_scores_higher_than_unrelated():
    strong = predict_score(STRONG_RESUME, BACKEND_JD)
    unrelated = predict_score(UNRELATED_RESUME, BACKEND_JD)
    assert strong > unrelated
