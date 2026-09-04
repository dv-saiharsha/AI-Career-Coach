"""Job Matching Engine — pure-function tests, no network, no LLM. Pins the
engine's honesty guarantees (never fabricate a dimension that can't run)
and the cross-feed priority-ranking behavior, which is the one part of
this module that isn't a thin wrapper around something already tested
elsewhere (predict_score has its own tests; taxonomy has its own tests)."""

import pytest

from app.modules.job_market.matching import (
    MatchContext,
    attach_matches,
    build_job_match,
    score_resume_match,
    score_skills_match,
)


@pytest.fixture(autouse=True)
def _scoring_model(monkeypatch):
    from app.modules.job_market import matching

    monkeypatch.setattr(matching, "model_available", lambda: True)
    monkeypatch.setattr(matching, "predict_score", lambda resume_text, job_description: 72.0)


RESUME = """Venkata Danda
Phoenix, AZ | venkata@example.com

EXPERIENCE
Senior Software Engineer, Stripe   Jan 2022 - Present
- Cut p99 checkout latency 38% by replacing a synchronous fraud call with a queue
- Led migration of 40 services to Kubernetes, reducing spend $220K/yr

EDUCATION
M.S. Computer Science  2019

TECHNICAL SKILLS
Python, Kubernetes, PostgreSQL, Docker
"""

JOB_WITH_EVERYTHING = {
    "description": "We need a Senior Software Engineer with Python, Kubernetes, Terraform and CI/CD experience.",
    "skills": ["Python", "Kubernetes", "Terraform", "GraphQL"],
}

JOB_NO_DESCRIPTION = {"description": None, "skills": ["Python", "Terraform"]}
JOB_NO_SKILLS = {"description": "A role requiring various skills.", "skills": []}
JOB_NOTHING = {"description": None, "skills": []}


def _context() -> MatchContext:
    from app.core.taxonomy import expand_skills, skill_candidates

    return MatchContext(resume_text=RESUME, skill_set=expand_skills(skill_candidates(RESUME)))


def test_resume_match_none_without_a_description():
    assert score_resume_match(_context(), JOB_NO_DESCRIPTION) is None


def test_skills_match_none_without_listed_skills():
    assert score_skills_match(_context(), JOB_NO_SKILLS) is None


def test_skills_match_partitions_matching_and_missing_correctly():
    result = score_skills_match(_context(), JOB_WITH_EVERYTHING)
    assert set(result["matchingSkills"]) == {"Python", "Kubernetes"}
    assert set(result["missingSkills"]) == {"Terraform", "GraphQL"}
    assert result["score"] == 50.0  # 2 of 4 listed skills


def test_overall_match_is_resume_match_score_not_a_blend():
    """Explicit product decision: overall_match is the trained model's own
    number, never averaged with Skills Match — each stays inspectable on
    its own."""
    context = _context()
    result = build_job_match(context, JOB_WITH_EVERYTHING)
    assert result["overallMatch"] == result["resumeMatch"]["score"]


def test_no_dimensions_available_produces_null_overall_not_zero():
    context = _context()
    result = build_job_match(context, JOB_NOTHING)
    assert result["overallMatch"] is None
    assert result["resumeMatch"] is None
    assert result["skillsMatch"] is None
    assert "Not enough information" in result["explanation"]


def test_explanation_names_the_real_matched_and_missing_counts():
    context = _context()
    result = build_job_match(context, JOB_WITH_EVERYTHING)
    assert "2 of 4" in result["explanation"]


def test_priority_skills_ranked_by_cross_feed_frequency():
    """Terraform is missing from both jobs below; GraphQL only from one.
    Terraform must rank first for both listings once the whole feed is
    known — a single job can't see this on its own."""
    jobs = [
        {"id": "1", "description": "needs Python and Terraform", "skills": ["Python", "Terraform"]},
        {"id": "2", "description": "needs Terraform and GraphQL", "skills": ["Terraform", "GraphQL"]},
    ]
    result = attach_matches(jobs, RESUME)
    for job in result:
        priority = job["match"]["skillsMatch"]["prioritySkills"]
        assert priority[0] == "Terraform"


def test_attach_matches_mutates_and_returns_the_same_semantics_for_every_job():
    jobs = [dict(JOB_WITH_EVERYTHING, id="1"), dict(JOB_NOTHING, id="2")]
    result = attach_matches(jobs, RESUME)
    assert result[0]["match"]["overallMatch"] is not None
    assert result[1]["match"]["overallMatch"] is None


def test_band_vocabulary_matches_the_shared_rubric_bands():
    """Job Matching must use the exact same band words Resume Review and
    ScoreRing already standardised on — not a fourth vocabulary."""
    from app.modules.resume_analyzer.rubric import band as rubric_band

    context = _context()
    result = build_job_match(context, JOB_WITH_EVERYTHING)
    assert result["band"] in {"EXCELLENT", "STRONG", "GOOD", "NEEDS WORK", "WEAK"}
    assert result["band"] == rubric_band(result["resumeMatch"]["score"])
