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
    """Quantifying previously-unquantified bullets must raise the score.

    This test used to assert the opposite, and was right to: the model
    penalised quantified achievements, and optimizer.py's guidance was written
    around that defect. It also said that if it ever started failing, the model
    had been retrained and the guidance should be revisited rather than left
    stale. That is exactly what happened.

    The retrained model — five anti-gaming features plus 360 constructed
    counter-examples, see scripts/train_ats_model.py — reverses it.
    quantified_bullet_ratio is now the single heaviest feature at 0.275, where
    the raw count it replaced carried 0.046. Measured across 60 postings by
    scripts/evaluate_ats_model.py: stripping the figures out of a resume and
    putting them back rewards the quantified version 100% of the time, by a
    mean of 13.7 points.

    Kept pointing the other way rather than deleted, because the direction is
    the thing worth guarding. A future retrain that reintroduces the penalty
    should fail here.
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

    assert predict_score(with_metrics, JD) > predict_score(without, JD), (
        "The model has started penalising quantified achievements again. That was a "
        "real defect once — see this test's docstring and optimizer.py — and a retrain "
        "has reintroduced it. Check scripts/evaluate_ats_model.py before shipping."
    )


def test_plan_reports_when_the_score_stops_being_meaningful() -> None:
    """Above ~85 the number is not evidence: a keyword dump reaches 86."""
    assert optimizer.MEANINGLESS_ABOVE == 85
    result = optimizer.plan(WEAK_PRESENTATION, JD)
    assert result["beyond_meaningful"] == (result["projected_score"] > 85)


# ── Google X-Y-Z bullet quantification ──────────────────────────────────────
# "Achieved [outcome], measured by [a real number], by [doing this]". Coaching
# cannot supply the number — only the candidate has it — so this edit is
# requires_review, same as adopt_jd_vocabulary, and applying it for a
# speculative score must be a no-op rather than a fabricated delta.

MIXED_QUANTIFICATION_EXPERIENCE = (
    "Acme Corp (2020 - 2025)\n"
    "- Reduced checkout latency by 34% by rewriting the payment path in Go\n"
    "- Owned the on-call rotation and mentored two junior engineers on distributed systems\n"
    "- Migrated the legacy monolith to a set of Kubernetes-native microservices\n"
    "- Go\n"
)

ISOLATED_JD = "Senior Backend Engineer. We need Python, Kubernetes, and distributed systems experience."

QUANTIFY_ONLY_RESUME = (
    "Senior Backend Engineer\n"
    "Skills\nPython, Kubernetes, distributed systems\n"
    "Experience\n"
    "Acme Corp (2020 - 2025)\n"
    "- Owned the on-call rotation and mentored two junior engineers on distributed systems "
    "using Python and Kubernetes\n"
    "- Migrated the legacy monolith to a set of Kubernetes-native microservices written in Python\n"
)


def test_unquantified_achievement_bullets_flags_only_missing_metrics() -> None:
    flagged = optimizer._unquantified_achievement_bullets(MIXED_QUANTIFICATION_EXPERIENCE)

    assert (
        "Owned the on-call rotation and mentored two junior engineers on distributed systems"
        in flagged
    )
    assert "Migrated the legacy monolith to a set of Kubernetes-native microservices" in flagged
    assert not any("34%" in line for line in flagged), "the quantified bullet must not be flagged"
    assert not any(line.startswith("Acme Corp") for line in flagged), (
        "a company/date header is not an achievement"
    )
    assert "Go" not in flagged, "too short to be a real achievement line"


def test_unquantified_achievement_bullets_caps_at_five() -> None:
    experience = "\n".join(
        "- Led a cross functional initiative to modernize the platform end to end"
        for _ in range(10)
    )
    flagged = optimizer._unquantified_achievement_bullets(experience)
    assert len(flagged) == optimizer._MAX_FLAGGED_BULLETS


def test_quantify_bullets_edit_is_proposed_for_unquantified_achievements() -> None:
    edits = optimizer.find_honest_edits(QUANTIFY_ONLY_RESUME, ISOLATED_JD)
    quantify_edits = [e for e in edits if e["edit"] == "quantify_bullets_xyz"]

    assert len(quantify_edits) == 1
    edit = quantify_edits[0]
    assert edit["requires_review"] is True
    assert "Migrated the legacy monolith to a set of Kubernetes-native microservices written in Python" in edit["adds"]
    assert "Achieved" in edit["rationale"] and "measured by" in edit["rationale"]


def test_quantify_bullets_apply_is_a_no_op() -> None:
    edit = {
        "edit": "quantify_bullets_xyz",
        "adds": ["Owned the on-call rotation and mentored two junior engineers"],
    }
    assert optimizer._apply(WEAK_PRESENTATION, edit) == WEAK_PRESENTATION


def test_quantify_bullets_is_excluded_from_the_projection_without_moving_it() -> None:
    """Applying this edit must not change the score at all, in either direction.

    Unlike adopt_jd_vocabulary (which changes the text it scores, just doesn't
    count the delta), quantify_bullets_xyz has nothing to insert — so its
    potential_score must equal the score of the resume as it stood immediately
    before this edit, not a different number arrived at by duplicating the
    flagged bullets.
    """
    result = optimizer.plan(QUANTIFY_ONLY_RESUME, ISOLATED_JD)
    quantify_edits = [e for e in result["edits"] if e["edit"] == "quantify_bullets_xyz"]
    assert quantify_edits, "this resume has unquantified achievements; the edit should be proposed"

    edit = quantify_edits[0]
    assert edit["applied"] is False
    # Nothing else was proposed for this deliberately isolated resume/JD pair,
    # so the score immediately before this edit is simply the baseline.
    assert edit["potential_score"] == result["baseline_score"]


def test_target_title_declines_a_boilerplate_opener() -> None:
    """Found by running this module against a live Cloudflare posting.

    Its first line is "About Us" — align_title offered that back as the
    resume's target headline. rubric.title_alignment's own docstring already
    states the rule this violated: guessing a title out of the JD body is
    worse than declining to score.
    """
    jd = (
        "About Us\n\n"
        "At Cloudflare, we are on a mission to help build a better Internet. "
        "Today the company runs one of the world's largest networks."
    )
    assert optimizer._target_title(jd) is None

    edits = optimizer.find_honest_edits(WEAK_PRESENTATION, jd)
    assert not any(e["edit"] == "align_title" for e in edits), (
        "no edit should propose a boilerplate section header as a job title"
    )


def test_target_title_still_recognises_a_real_title() -> None:
    assert optimizer._target_title("Senior Backend Engineer\n\nWe need Python.") == (
        "Senior Backend Engineer"
    )


def test_target_title_declines_a_long_sentence() -> None:
    jd = "We are looking for a talented engineer to join our growing platform team this year."
    assert optimizer._target_title(jd) is None


def test_quantify_bullets_reason_is_not_the_jd_vocabulary_reason() -> None:
    """plan()'s requires_review reason must describe THIS edit's situation.

    The sentence written for adopt_jd_vocabulary — "these are terms the
    posting uses for work your resume does not describe" — is false here:
    these bullets DO describe real work the candidate did, they are only
    missing a number. Reusing it verbatim would tell the candidate the wrong
    thing about their own edit.
    """
    result = optimizer.plan(QUANTIFY_ONLY_RESUME, ISOLATED_JD)
    quantify_edits = [e for e in result["edits"] if e["edit"] == "quantify_bullets_xyz"]
    assert quantify_edits

    reason = quantify_edits[0]["reason"]
    assert "only you know which you actually did" not in reason
    assert "real number" in reason
