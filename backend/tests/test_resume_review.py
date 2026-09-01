"""Resume Review composes existing analysers; these tests pin the
composition — mode selection, Health's job-independence, and Job Match's
identity with the stored model score — not the underlying arithmetic,
which test_rubric.py already covers."""

from app.modules.resume_analyzer import review

RESUME = """Venkata Danda
Phoenix, AZ | (480) 555-0142 | venkata@example.com

EXPERIENCE
Senior Software Engineer, Stripe   Jan 2022 - Present
- Cut p99 checkout latency 38% by replacing a synchronous fraud call with a queue
- Led migration of 40 services to Kubernetes, reducing spend $220K/yr

EDUCATION
M.S. Computer Science  2019

TECHNICAL SKILLS
Python, Kubernetes, PostgreSQL, Docker
"""

JD = "We need a Senior Software Engineer with Python, Kubernetes, Terraform and CI/CD experience."

STORED_RESULT = {
    "matched_skills": ["Python", "Kubernetes"],
    "missing_skills": ["Terraform"],
    "keyword_analysis": [
        {"keyword": "Python", "present": True, "frequency": 2},
        {"keyword": "Terraform", "present": False, "frequency": 1},
    ],
}


def test_general_mode_has_no_job_match():
    result = review.build_review(RESUME, "")
    assert result["mode"] == review.MODE_GENERAL
    assert result["job_match"] is None


def test_job_specific_mode_requires_a_score_to_report_job_match():
    """A JD alone isn't enough — job_match is the model's own number, and
    with none supplied there is nothing to report under that name."""
    result = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=None)
    assert result["mode"] == review.MODE_JOB_SPECIFIC
    assert result["job_match"] is None


def test_job_match_is_the_stored_model_score_verbatim():
    result = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=82.4)
    assert result["job_match"]["score"] == 82.4
    assert result["job_match"]["source"] == "trained_model"


def test_health_excludes_job_relative_metrics_in_both_modes():
    """The point of Decision 2: the same resume's Health must not move
    depending on whether a JD happens to be present."""
    general = review.build_review(RESUME, "")
    specific = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=90.0)
    assert general["resume_health"]["score"] == specific["resume_health"]["score"]

    health_keys = {c["key"] for c in general["categories"]} & set(review.HEALTH_KEYS)
    assert health_keys == set(review.HEALTH_KEYS)


def test_job_only_categories_absent_in_general_mode():
    result = review.build_review(RESUME, "")
    keys = {c["key"] for c in result["categories"]}
    assert not keys & set(review.JOB_KEYS)


def test_job_only_categories_present_in_job_specific_mode():
    result = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=82.4)
    keys = {c["key"] for c in result["categories"]}
    assert set(review.JOB_KEYS) <= keys


def test_grammar_is_declared_but_unavailable():
    """Phase 1 ships no grammar check. It must still appear — a category the
    user can see is missing is honest; a silently absent one is not."""
    result = review.build_review(RESUME, "")
    grammar = next(c for c in result["categories"] if c["key"] == "grammar")
    assert grammar["available"] is False
    assert grammar["score"] is None


def test_health_weight_applied_matches_health_keys_only():
    from app.modules.resume_analyzer.rubric import WEIGHTS

    result = review.build_review(RESUME, "")
    expected_max = sum(WEIGHTS[k] for k in review.HEALTH_KEYS)
    assert result["resume_health"]["weight_applied"] <= expected_max


def test_no_bullets_skips_rather_than_scores_zero():
    no_bullets = "Just a name and nothing else, no headings, no bullets at all here."
    result = review.build_review(no_bullets, "")
    by_key = {c["key"]: c for c in result["categories"]}
    assert by_key["quantified_impact"]["available"] is False
    assert by_key["quantified_impact"]["score"] is None


def test_reason_strings_are_populated_for_every_category():
    """Every category needs something a user can argue with, not just a
    number — this is the whole point of `reason` existing separately from
    `explanation`."""
    result = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=82.4)
    for category in result["categories"]:
        assert category["reason"], f"{category['key']} has an empty reason"


def test_next_actions_offer_job_specific_review_only_in_general_mode():
    general = review.build_review(RESUME, "")
    specific = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=82.4)
    assert any(a["key"] == "job_specific_review" for a in general["next_actions"])
    assert not any(a["key"] == "job_specific_review" for a in specific["next_actions"])
    assert any(a["key"] == "tailor_resume" for a in specific["next_actions"])


def test_generated_by_is_deterministic_in_phase_one():
    result = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=82.4)
    assert result["generated_by"] == "deterministic"


def test_tailor_resume_action_never_points_at_the_bare_tailor_route():
    """/resume/tailor requires ?job=<job_listings id>, which a job-specific
    review never has — the description here was pasted, not selected from a
    listing. Regression guard for a dead-end link that shipped once already."""
    result = review.build_review(RESUME, JD, stored_result=STORED_RESULT, model_score=82.4)
    tailor_action = next(a for a in result["next_actions"] if a["key"] == "tailor_resume")
    assert tailor_action["href"] != "/resume/tailor"
    assert tailor_action["href"] == "/jobs"
