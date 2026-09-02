"""The honest-edit planner, and the two measurements it is built around.

Both of those measurements are surprising enough that someone will eventually
try to "fix" this module by making it maximise the score. These tests are
where that attempt fails.
"""

import pytest

from app.ml.inference import model_available, predict_score
from app.modules.resume_builder import optimizer

pytestmark = pytest.mark.skipif(
    not model_available(), reason="no trained model on disk; nothing to score against"
)

JD = (
    "Senior Backend Engineer. We need Python, Go, Kubernetes, Docker, PostgreSQL, Redis, "
    "Kafka, Terraform, AWS, gRPC, microservices, distributed systems, CI/CD, observability. "
    "You will design scalable services, mentor engineers, and own reliability at scale."
)

WEAK_PRESENTATION = """Harshith R
harshith@example.com
Work History
Acme Corp (2020 - 2025)
- Built and owned the payments system in Python
- Improved performance on the critical path by moving it to Go
- Migrated the services to Kubernetes and Docker
- Designed the PostgreSQL schema behind the ledger
Beta Inc (2018 - 2020)
- Developed internal tooling and automated the release process
Education
B.S. Computer Science, Stanford University, 2018"""

KEYWORD_DUMP = (
    "Python Go Kubernetes Docker PostgreSQL Redis Kafka Terraform AWS gRPC microservices "
    "distributed systems CI/CD observability scalable services mentor reliability "
) * 30


def test_plan_improves_a_weakly_presented_resume() -> None:
    result = optimizer.plan(WEAK_PRESENTATION, JD)
    assert result["available"]
    assert result["projected_score"] > result["baseline_score"]
    assert result["edits"], "a weak resume should have edits available"


def test_proposed_skills_are_the_candidate_s_own() -> None:
    """The skills line may only name things this resume already evidences.

    An earlier version fell back to skill_candidates(resume_text) when nothing
    matched the posting, which returns employer names and past participles —
    producing a skills line reading "Acme, Beta, Built, Corp, Designed".
    """
    result = optimizer.plan(WEAK_PRESENTATION, JD)
    skills_edits = [
        edit
        for edit in result["edits"]
        if edit["edit"] in ("add_skills_section", "surface_implied_skills")
    ]
    assert skills_edits, "this resume has no skills section, so one should be proposed"

    resume_lower = WEAK_PRESENTATION.lower()
    for term in skills_edits[0]["adds"]:
        assert term.lower() in resume_lower, (
            f"{term!r} was proposed as a skill but appears nowhere in the resume"
        )

    for junk in ("acme", "beta", "corp", "built", "designed", "developed"):
        assert junk not in {t.lower() for t in skills_edits[0]["adds"]}


def test_review_required_edits_are_excluded_from_the_projection() -> None:
    """Unconfirmed vocabulary must not inflate the projected score.

    adopt_jd_vocabulary proposes the posting's terms for work the resume does
    not describe. Counting it would project a number built on claims nobody has
    verified — a fabricated bullet reached by arithmetic.
    """
    result = optimizer.plan(WEAK_PRESENTATION, JD)
    review_edits = [edit for edit in result["edits"] if edit.get("requires_review")]

    for edit in review_edits:
        assert edit["applied"] is False
        assert "potential_score" in edit
        assert edit["reason"]

    # The projection must be reproducible from the applied edits alone.
    applied = [edit for edit in result["edits"] if edit.get("applied")]
    if applied:
        assert result["projected_score"] == applied[-1]["score_after"]


def test_a_stuffed_resume_is_refused_rather_than_optimised() -> None:
    result = optimizer.plan(KEYWORD_DUMP, JD)
    assert result["available"] is False
    assert result["edits"] == []
    assert "repetition" in result["reason"]


def test_nothing_in_the_plan_removes_content() -> None:
    """The rule that keeps this from giving catastrophic advice.

    Deleting a candidate's quantified achievements raises their score by 11
    points against this model. An optimiser permitted to remove would find
    that, and it would be true, and it would be the worst advice this product
    could give.
    """
    result = optimizer.plan(WEAK_PRESENTATION, JD)
    for edit in result["edits"]:
        applied = optimizer._apply(WEAK_PRESENTATION, edit)
        # Every original line survives, whatever the edit did.
        for line in WEAK_PRESENTATION.splitlines():
            if line.strip():
                assert line.strip() in applied, f"{edit['edit']} dropped: {line.strip()!r}"


def test_quantifying_impact_lowers_this_model_s_score() -> None:
    """The measurement the module's guardrails exist for.

    If this ever starts passing in the other direction the model has been
    retrained, and optimizer.py's central caution — that the score penalises
    the most repeated resume advice there is — should be revisited rather than
    left as a stale warning.
    """
    without = (
        "Senior Backend Engineer\n"
        "Skills\nPython, Go, Kubernetes, Docker, PostgreSQL, Terraform, AWS, Kafka, Redis, gRPC, CI/CD\n"
        "Experience\nAcme Corp (2020 - 2025)\n"
        "- Built and owned the payments system in Python\n"
        "- Improved performance on the critical path by moving it to Go\n"
        "- Migrated the services to Kubernetes and Docker"
    )
    with_metrics = (
        "Senior Backend Engineer\n"
        "Skills\nPython, Go, Kubernetes, Docker, PostgreSQL, Terraform, AWS, Kafka, Redis, gRPC, CI/CD\n"
        "Experience\nAcme Corp (2020 - 2025)\n"
        "- Built and owned the payments system in Python, handling 500k transactions daily\n"
        "- Reduced p99 latency 34% by moving the critical path to Go\n"
        "- Migrated 12 services to Kubernetes and Docker, cutting deploy time from 40 to 8 minutes"
    )

    assert predict_score(with_metrics, JD) < predict_score(without, JD), (
        "The model no longer penalises quantified achievements — revisit optimizer.py's "
        "guidance, which is written around the fact that it does."
    )


def test_plan_reports_when_the_score_stops_being_meaningful() -> None:
    """Above ~85 the number is not evidence: a keyword dump reaches 86."""
    assert optimizer.MEANINGLESS_ABOVE == 85
    result = optimizer.plan(WEAK_PRESENTATION, JD)
    assert result["beyond_meaningful"] == (result["projected_score"] > 85)
