"""Diagnostics attached to a scan, and taxonomy reconciliation on both paths.

The load-bearing guarantee here is that none of this touches ats_score. The
trained model's prediction is what users see; diagnostics only explain it.
"""

import pytest

from app.modules.resume_analyzer import services
from app.schemas.resume import AnalysisResultSchema, KeywordFrequency

RESUME = """Jane Doe

Experience
ML Engineer, Acme 2023-Present
- Reduced training time by 40% using PyTorch and CUDA
- Responsible for the data pipeline

Technical Skills
PyTorch, CUDA, Docker
"""


class TestImpliedFieldSurvivesSerialization:
    def test_keyword_frequency_carries_implied(self):
        """Regression: `implied` was set in services but absent from the
        schema, so pydantic silently dropped it and the frontend never saw
        which matches were inferred rather than stated."""
        model = KeywordFrequency(keyword="deep learning", present=True, frequency=0, implied=True)
        assert model.model_dump()["implied"] is True

    def test_implied_defaults_false(self):
        model = KeywordFrequency(keyword="python", present=True, frequency=3)
        assert model.implied is False


class TestReconcileImplied:
    """The LLM path builds its own skill lists. Without reconciliation the
    taxonomy would only ever apply to the rule-based fallback — and Claude is
    normally configured, so the false negative would survive in production."""

    def test_implied_skill_moves_out_of_missing(self):
        result = services._reconcile_implied(
            RESUME,
            {
                "missing_skills": ["deep learning", "Kubernetes"],
                "matched_skills": ["PyTorch"],
                "keyword_analysis": [
                    {"keyword": "deep learning", "present": False, "frequency": 0},
                    {"keyword": "Kubernetes", "present": False, "frequency": 0},
                ],
                "suggestions": [],
            },
        )
        assert "deep learning" not in result["missing_skills"]
        assert "deep learning" in result["matched_skills"]

    def test_genuinely_absent_skill_stays_missing(self):
        result = services._reconcile_implied(
            RESUME,
            {"missing_skills": ["Kubernetes"], "matched_skills": [], "keyword_analysis": [], "suggestions": []},
        )
        assert result["missing_skills"] == ["Kubernetes"]

    def test_implied_keyword_is_flagged_not_silently_merged(self):
        """An implied match still needs stating — a recruiter's literal
        keyword search won't find it."""
        result = services._reconcile_implied(
            RESUME,
            {
                "missing_skills": ["deep learning"],
                "matched_skills": [],
                "keyword_analysis": [{"keyword": "deep learning", "present": False, "frequency": 0}],
                "suggestions": [],
            },
        )
        entry = result["keyword_analysis"][0]
        assert entry["present"] is True and entry["implied"] is True

    def test_adds_a_distinct_suggestion(self):
        result = services._reconcile_implied(
            RESUME,
            {
                "missing_skills": ["deep learning"],
                "matched_skills": [],
                "keyword_analysis": [],
                "suggestions": [],
            },
        )
        assert any("explicitly" in s for s in result["suggestions"])

    def test_no_implied_skills_returns_result_unchanged(self):
        payload = {
            "missing_skills": ["Kubernetes"],
            "matched_skills": [],
            "keyword_analysis": [],
            "suggestions": [],
        }
        assert services._reconcile_implied(RESUME, payload) is payload

    def test_empty_missing_list_is_safe(self):
        result = services._reconcile_implied(RESUME, {"missing_skills": [], "matched_skills": []})
        assert result["missing_skills"] == []


class TestBuildDiagnostics:
    def _result(self):
        return {
            "ats_score": 71.0,
            "missing_skills": ["Kubernetes", "AWS"],
            "matched_skills": ["PyTorch"],
            "keyword_analysis": [
                {"keyword": "deep learning", "present": True, "frequency": 0, "implied": True}
            ],
            "suggestions": [],
        }

    def test_carries_no_score_of_its_own(self):
        """Diagnostics must never contain a competing score — two numbers
        claiming to rate the same resume is exactly the ambiguity the trained
        model is meant to resolve."""
        diagnostics = services.build_diagnostics(RESUME, "Need Kubernetes.", self._result())
        assert not any("ats" in key or key == "score" for key in diagnostics)

    def test_does_not_mutate_ats_score(self):
        result = self._result()
        services.build_diagnostics(RESUME, "Need Kubernetes.", result)
        assert result["ats_score"] == 71.0

    def test_reports_bullet_impact_on_a_0_100_scale(self):
        diagnostics = services.build_diagnostics(RESUME, "Need Kubernetes.", self._result())
        assert 0.0 <= diagnostics["bullet_impact_rating"] <= 100.0

    def test_surfaces_implied_skills(self):
        diagnostics = services.build_diagnostics(RESUME, "Need Kubernetes.", self._result())
        assert diagnostics["implied_skills"] == ["deep learning"]

    def test_groups_gaps_by_domain(self):
        diagnostics = services.build_diagnostics(RESUME, "Need Kubernetes.", self._result())
        assert "Cloud Infrastructure" in diagnostics["domain_gaps"]

    def test_extracts_bullets_from_raw_resume_text(self):
        diagnostics = services.build_diagnostics(RESUME, "Need Kubernetes.", self._result())
        assert diagnostics["bullet_feedback"], "expected the '- ' lines to be graded"

    def test_empty_resume_is_safe(self):
        diagnostics = services.build_diagnostics("", "", {"missing_skills": [], "matched_skills": []})
        assert diagnostics["bullet_impact_rating"] == 0.0


class TestImpactRatingFloor:
    def test_worthless_bullet_scores_zero_not_fifty(self):
        """A bullet with no verb, no metric and no method has demonstrated
        nothing. Reporting that as 50% would read like a passing grade."""
        from app.modules.resume_analyzer.quality import evaluate_bullet

        assert evaluate_bullet("Responsible for stuff")["impact_rating"] == 0.0

    def test_full_xyz_bullet_scores_100(self):
        from app.modules.resume_analyzer.quality import evaluate_bullet

        result = evaluate_bullet("Reduced latency by 40% using Redis caching")
        assert result["impact_rating"] == 100.0

    def test_rating_rises_with_quantification(self):
        from app.modules.resume_analyzer.quality import evaluate_bullets

        before = evaluate_bullets(["Increased throughput"])
        after = evaluate_bullets(["Increased throughput by 35% using Kafka"])
        assert after["impact_rating"] > before["impact_rating"]


class TestAnalysisResultSchema:
    def test_diagnostics_optional_for_older_stored_scans(self):
        """History reads deserialize rows written before diagnostics existed;
        a required field would 500 on every one of them."""
        model = AnalysisResultSchema(
            id=1, ats_score=70.0, missing_skills=[], matched_skills=[],
            extracted_skills=[], keyword_analysis=[], suggestions=[],
            created_at="2026-01-01T00:00:00",
        )
        assert model.diagnostics is None


@pytest.mark.parametrize("llm_available", [True, False])
def test_diagnostics_attached_on_both_paths(monkeypatch, llm_available):
    """Whichever path runs, the response carries diagnostics — otherwise the
    UI renders them only when Claude happens to be down."""
    monkeypatch.setattr(services.llm_client, "_client", object() if llm_available else None)
    if llm_available:
        monkeypatch.setattr(
            services.llm_client,
            "complete_tool_json",
            lambda *a, **k: {
                "is_resume": True,
                "matched_skills": ["PyTorch"],
                "missing_skills": ["deep learning"],
                "extracted_skills": ["PyTorch"],
                "keyword_analysis": [],
                "suggestions": [],
            },
        )
    monkeypatch.setattr(services, "extract_text", lambda filename, content: RESUME)

    result = services.analyze_resume_against_job("r.pdf", b"", "Need deep learning and Kubernetes.")
    assert "diagnostics" in result
    assert 0.0 <= result["diagnostics"]["bullet_impact_rating"] <= 100.0
    # Taxonomy reconciliation must apply on the LLM path too.
    if llm_available:
        assert "deep learning" not in result["missing_skills"]
