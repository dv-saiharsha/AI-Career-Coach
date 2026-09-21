"""Fix-staging and honest re-scoring.

No live Claude calls here — complete_tool_json is monkeypatched where a
bullet-rewrite call would otherwise fire, so running this suite (including in
CI, on every push) never spends real API budget. The scoring tests use the
real trained model on disk rather than mocking it, since ml_available checks
that it exists (test_ml_inference.py's precedent): a fake predict_score would
only prove the test harness works, not that scoring is real.
"""

import pytest

from app.ml.inference import model_available
from app.modules.resume_builder import services

pytestmark_model = pytest.mark.skipif(not model_available(), reason="no trained model on disk yet")


class TestStageFixesMissingKeywords:
    def test_finds_keywords_absent_from_resume(self):
        result = services.stage_fixes(
            resume_text="I build web apps with JavaScript.",
            jd_text="Looking for a Python engineer with Kubernetes and AWS experience.",
            experiences=None,
        )
        missing_lower = [k.lower() for k in result["missing_keywords"]]
        assert "python" in missing_lower
        assert "kubernetes" in missing_lower

    def test_excludes_keywords_already_present(self):
        result = services.stage_fixes(
            resume_text="I am a Python engineer experienced with AWS and Kubernetes.",
            jd_text="Looking for a Python engineer with Kubernetes and AWS experience.",
            experiences=None,
        )
        missing_lower = [k.lower() for k in result["missing_keywords"]]
        assert "python" not in missing_lower
        assert "kubernetes" not in missing_lower

    def test_no_experiences_means_no_llm_call(self, monkeypatch):
        """Omitting experiences must never trigger a Claude call — this is
        the free path, and it should stay free regardless of whether an API
        key happens to be configured."""

        def fail_if_called(*args, **kwargs):
            raise AssertionError("complete_tool_json should not be called when experiences is None")

        monkeypatch.setattr(services.llm_client, "complete_tool_json", fail_if_called)
        result = services.stage_fixes("some resume text", "some jd text", experiences=None)
        assert result["bullet_suggestions"] == []


class TestStageFixesBulletSuggestions:
    def test_calls_llm_when_experiences_and_bullets_given(self, monkeypatch):
        captured = {}

        def fake_complete_tool_json(system, user, tool_name, schema):
            captured["called"] = True
            captured["user_prompt"] = user
            return {
                "suggestions": [
                    {
                        "experience_index": 0,
                        "original": "Worked on backend stuff",
                        "suggested": "Rebuilt the backend API layer",
                        "reason": "Leads with the action instead of the assignment.",
                    }
                ]
            }

        # `available` is a read-only property (`self._client is not None`) —
        # patch the underlying attribute it reads, not the property itself.
        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake_complete_tool_json)

        result = services.stage_fixes(
            resume_text="Worked on backend stuff.",
            jd_text="Seeking a backend engineer to improve API latency.",
            experiences=[{"title": "Engineer", "company": "Acme", "dates": "2022", "bullets": ["Worked on backend stuff"]}],
        )

        assert captured.get("called") is True
        assert len(result["bullet_suggestions"]) == 1
        assert result["bullet_suggestions"][0]["reason"]

    def test_fabricated_suggestion_is_dropped_before_the_user_sees_it(self, monkeypatch):
        """A rewrite that invents a metric never reaches the response.

        This fixture used to be the one above: "Worked on backend stuff" came
        back as "Rebuilt the backend API layer, cutting p95 latency 35%", and
        the test asserted it was returned. The 35% is invented — nothing in the
        original bullet or the resume carries it — so it is exactly the claim a
        candidate would then have to defend in an interview.

        The prompt has always forbidden that. Nothing checked until guards.py.
        """

        def fake_complete_tool_json(system, user, tool_name, schema):
            return {
                "suggestions": [
                    {
                        "experience_index": 0,
                        "original": "Worked on backend stuff",
                        "suggested": "Rebuilt the backend API layer, cutting p95 latency 35%",
                        "reason": "Adds a quantified outcome and matches JD language.",
                    },
                    {
                        "experience_index": 0,
                        "original": "Helped with deployments",
                        "suggested": "Automated deployments using Kubernetes and Argo CD",
                        "reason": "Names the tooling.",
                    },
                ]
            }

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake_complete_tool_json)

        result = services.stage_fixes(
            resume_text="Worked on backend stuff. Helped with deployments.",
            jd_text="Seeking a backend engineer to improve API latency.",
            experiences=[
                {
                    "title": "Engineer",
                    "company": "Acme",
                    "dates": "2022",
                    "bullets": ["Worked on backend stuff", "Helped with deployments"],
                }
            ],
        )

        # Both fabricate: one a figure, one a stack the resume never mentions.
        assert result["bullet_suggestions"] == []
        assert all(
            "35%" not in (item.get("suggested") or "")
            for item in result["bullet_suggestions"]
        )

    def test_llm_unavailable_returns_no_suggestions_not_an_error(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        result = services.stage_fixes(
            resume_text="Some resume.",
            jd_text="Some JD.",
            experiences=[{"title": "Engineer", "company": "Acme", "dates": "2022", "bullets": ["Did stuff"]}],
        )
        assert result["bullet_suggestions"] == []

    def test_llm_failure_degrades_gracefully(self, monkeypatch):
        """A Claude error (rate limit, timeout, malformed tool response)
        must not fail the whole staging request — same fall-through
        posture as resume_analyzer/services.py."""

        def raise_error(*args, **kwargs):
            raise RuntimeError("simulated API failure")

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", raise_error)

        result = services.stage_fixes(
            resume_text="Some resume.",
            jd_text="Some JD.",
            experiences=[{"title": "Engineer", "company": "Acme", "dates": "2022", "bullets": ["Did stuff"]}],
        )
        assert result["bullet_suggestions"] == []
        assert "missing_keywords" in result


@pytest.mark.skipif(not model_available(), reason="no trained model on disk yet")
class TestCompileAndScoreUsesRealModel:
    """The score in the response must come from the same trained model that
    scores every other resume in the product — not a fabricated formula
    with hand-picked weights."""

    def _payload(self, jd_text: str, bullets: list[str]) -> dict:
        return {
            "job_description": jd_text,
            "candidate_name": "Jane Doe",
            "location": "Austin, TX",
            "email": "jane@example.com",
            "phone": "",
            "linkedin": "",
            "summary": "Backend engineer.",
            "technical_skills": ["Python", "Kubernetes", "AWS"],
            "tools_skills": [],
            "experiences": [
                {"title": "Engineer", "company": "Acme", "dates": "2022-2024", "bullets": bullets}
            ],
            "education": [],
        }

    def test_score_matches_direct_model_call(self, monkeypatch):
        """compile_and_score's ats_score must equal calling predict_score
        directly on the same flattened text — proving there's no separate
        formula recomputing a different number."""
        from app.ml.inference import predict_score

        if not services.latex.tectonic_available():
            pytest.skip("tectonic not installed")

        payload = self._payload(
            "Seeking a Python engineer with Kubernetes and AWS experience.",
            ["Reduced infra costs by 30% using Kubernetes and AWS"],
        )
        result = services.compile_and_score(payload)

        resume_text = services._resume_text_from_payload(payload)
        expected = predict_score(resume_text, payload["job_description"])
        assert result["ats_score"] == expected

    def test_semantic_match_is_a_real_computed_number_not_constant(self):
        """A well-matched resume and a poorly-matched one against the same
        JD must produce different semantic_match values — proof it's an
        actual computed similarity, not a hardcoded stand-in."""
        if not services.latex.tectonic_available():
            pytest.skip("tectonic not installed")

        jd = "Seeking a Python engineer with Kubernetes, Docker, and AWS experience."
        good = self._payload(jd, ["Built Kubernetes and AWS infrastructure using Python and Docker"])
        bad = self._payload(jd, ["Painted houses over the summer"])

        good_result = services.compile_and_score(good)
        bad_result = services.compile_and_score(bad)

        assert good_result["semantic_match"] > bad_result["semantic_match"]

    def test_returns_single_page_pdf(self):
        if not services.latex.tectonic_available():
            pytest.skip("tectonic not installed")
        payload = self._payload("Some JD.", ["A bullet."])
        result = services.compile_and_score(payload)
        assert result["page_count"] == 1
        assert len(result["pdf_base64"]) > 100


class TestStoredScanLayoutDiagnostics:
    """The stored-scan route reads the original upload from
    resume_file_bytes — a column on the row, not a path on disk or an object
    key — so there is no missing-file case, only a NULL one on older scans.
    """

    def _pdf(self, two_column: bool) -> bytes:
        import fitz

        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 50), "Jane Doe", fontsize=11)
        page.insert_text((50, 75), "Professional Experience", fontsize=12)
        y = 95
        for _ in range(20):
            if two_column:
                page.insert_text((50, y), "Engineered services using PyTorch", fontsize=9)
                page.insert_text((330, y), "Reduced latency by 40% with Redis", fontsize=9)
            else:
                page.insert_text((50, y), "Engineered services using PyTorch and cut latency", fontsize=9)
            y += 14
        page.insert_text((50, y + 10), "Education", fontsize=12)
        data = doc.tobytes()
        doc.close()
        return data

    TEXT = (
        "Jane Doe\n\nProfessional Experience\n"
        + "- Engineered services using PyTorch and cut latency 40%\n" * 6
        + "\nEducation\nBS Computer Science\n"
    )

    def test_stored_pdf_yields_a_column_verdict(self):
        from app.modules.resume_builder import services

        report = services.quality_report(self.TEXT, "Need PyTorch.", None, self._pdf(True))
        assert report["parsing_readiness"]["is_single_column"] is False

    def test_single_column_stored_pdf(self):
        from app.modules.resume_builder import services

        report = services.quality_report(self.TEXT, "Need PyTorch.", None, self._pdf(False))
        assert report["parsing_readiness"]["is_single_column"] is True

    def test_missing_pdf_keeps_text_signal(self):
        """A legacy row with resume_file_bytes NULL must still get header and
        extractability feedback — withholding valid text-based diagnostics
        because coordinates are unavailable would discard real signal."""
        from app.modules.resume_builder import services

        readiness = services.quality_report(self.TEXT, "Need PyTorch.", None, None)["parsing_readiness"]
        assert readiness["is_single_column"] is None
        assert readiness["column_check_skipped_reason"] == "No PDF stored for this scan"
        assert readiness["detected_headers"], "text-based header detection must still run"
        assert readiness["readiness_score"] > 0

    def test_warnings_stay_structured(self):
        from app.modules.resume_builder import services

        readiness = services.quality_report(self.TEXT, "Need PyTorch.", None, self._pdf(True))[
            "parsing_readiness"
        ]
        assert all({"severity", "issue", "detail"} <= set(w) for w in readiness["formatting_warnings"])


class TestQuickTailorAppliesAcceptedContent:
    """accepted_skills and bullet_overrides are the caller's own prior
    choices (typically a tailor-preview's state_explicitly/missing_keywords
    and bullet_suggestions) — quick_tailor only places them, it never decides
    them. fit.fit_to_pages and predict_score are monkeypatched: this class is
    about what goes INTO the compile payload, not about real compilation or
    real scoring — see this file's own docstring on why scoring tests use the
    real model elsewhere and mocking it here would be the wrong thing there,
    but is the right thing for a test that isn't about scoring at all.
    """

    def _record(self, matched_skills=None, extracted_skills=None):
        import json
        from types import SimpleNamespace

        return SimpleNamespace(
            resume_text="irrelevant — build_autofill is monkeypatched below",
            result_json=json.dumps(
                {"matched_skills": matched_skills or [], "extracted_skills": extracted_skills or []}
            ),
        )

    def _patch(self, monkeypatch, experiences):
        captured = {}

        monkeypatch.setattr(
            services.autofill,
            "build_autofill",
            lambda text: {
                "name": "Jane Doe", "email": "", "phone": "", "location": "", "linkedin": "",
                "summary": "", "experiences": experiences, "education": [],
            },
        )

        def fake_fit_to_pages(data, target_pages, jd_keywords=None, density=None):
            captured["data"] = data
            return {
                "tex": "\\documentclass{article}", "pdf_bytes": b"%PDF-1.4 fake",
                "page_count": 1, "fits": True, "adjustments": [], "content": data,
            }

        monkeypatch.setattr(services.fit, "fit_to_pages", fake_fit_to_pages)
        monkeypatch.setattr(services, "predict_score", lambda text, jd: 70)
        return captured

    def test_accepted_skill_is_added(self, monkeypatch):
        captured = self._patch(monkeypatch, experiences=[])
        record = self._record(matched_skills=["Python"])

        services.quick_tailor(record, "Jane Doe", "jd text", 1, accepted_skills=["Kubernetes"])

        assert "Kubernetes" in captured["data"]["technical_skills"]

    def test_accepted_skill_already_present_is_not_duplicated(self, monkeypatch):
        captured = self._patch(monkeypatch, experiences=[])
        record = self._record(matched_skills=["Python"])

        services.quick_tailor(record, "Jane Doe", "jd text", 1, accepted_skills=["python"])

        assert captured["data"]["technical_skills"].count("Python") == 1

    def test_bullet_override_replaces_matching_text(self, monkeypatch):
        experiences = [
            {"title": "Engineer", "company": "Acme", "dates": "2020-2023",
             "bullets": ["Built things.", "Fixed bugs."]},
        ]
        captured = self._patch(monkeypatch, experiences=experiences)
        record = self._record()

        services.quick_tailor(
            record, "Jane Doe", "jd text", 1,
            bullet_overrides=[
                {"experience_index": 0, "original": "Built things.",
                 "suggested": "Built distributed systems serving 1M requests/day."},
            ],
        )

        bullets = captured["data"]["experiences"][0]["bullets"]
        assert "Built distributed systems serving 1M requests/day." in bullets
        assert "Built things." not in bullets

    def test_bullet_override_skipped_when_text_no_longer_matches(self, monkeypatch):
        """The source resume can change between when a suggestion was
        generated and when it's applied. Applying it to the wrong line would
        be worse than silently dropping a stale one."""
        experiences = [
            {"title": "Engineer", "company": "Acme", "dates": "2020-2023", "bullets": ["Built things."]},
        ]
        captured = self._patch(monkeypatch, experiences=experiences)
        record = self._record()

        services.quick_tailor(
            record, "Jane Doe", "jd text", 1,
            bullet_overrides=[
                {"experience_index": 0, "original": "Some stale suggestion",
                 "suggested": "Should never appear."},
            ],
        )

        assert captured["data"]["experiences"][0]["bullets"] == ["Built things."]

    def test_bullet_override_with_out_of_range_index_is_ignored(self, monkeypatch):
        captured = self._patch(monkeypatch, experiences=[])
        record = self._record()

        services.quick_tailor(
            record, "Jane Doe", "jd text", 1,
            bullet_overrides=[
                {"experience_index": 5, "original": "x", "suggested": "y"},
            ],
        )

        assert captured["data"]["experiences"] == []


class TestQuickTailorScoreWithoutATrainedModel:
    """A fresh clone has no app/ml/models/ats_model.joblib — it's gitignored,
    same as every other environment described in this file's docstring. Before
    this test existed, quick_tailor called predict_score unconditionally and
    crashed with an unhandled RuntimeError the first time someone actually
    exercised this endpoint without a trained model on disk — every other
    scoring call site in this module (faang.build_preview) already guards on
    model_available() and reports None instead. This locks that fix in."""

    def _record(self):
        import json
        from types import SimpleNamespace

        return SimpleNamespace(
            resume_text="irrelevant — build_autofill is monkeypatched below",
            result_json=json.dumps({"matched_skills": [], "extracted_skills": []}),
        )

    def _patch_autofill_and_fit(self, monkeypatch):
        monkeypatch.setattr(
            services.autofill, "build_autofill",
            lambda text: {
                "name": "Jane Doe", "email": "", "phone": "", "location": "", "linkedin": "",
                "summary": "", "experiences": [], "education": [],
            },
        )
        monkeypatch.setattr(
            services.fit, "fit_to_pages",
            lambda data, target_pages, jd_keywords=None, density=None: {
                "tex": "\\documentclass{article}", "pdf_bytes": b"%PDF-1.4 fake",
                "page_count": 1, "fits": True, "adjustments": [], "content": data,
            },
        )

    def test_no_model_gives_none_rather_than_crashing(self, monkeypatch):
        self._patch_autofill_and_fit(monkeypatch)
        monkeypatch.setattr(services, "model_available", lambda: False)

        def fail_if_called(*a, **k):
            raise AssertionError("predict_score must not be called when no model is on disk")

        monkeypatch.setattr(services, "predict_score", fail_if_called)

        result = services.quick_tailor(self._record(), "Jane Doe", "jd text", 1)
        assert result["ats_score"] is None

    def test_model_available_still_scores(self, monkeypatch):
        self._patch_autofill_and_fit(monkeypatch)
        monkeypatch.setattr(services, "model_available", lambda: True)
        monkeypatch.setattr(services, "predict_score", lambda text, jd: 77)

        result = services.quick_tailor(self._record(), "Jane Doe", "jd text", 1)
        assert result["ats_score"] == 77
