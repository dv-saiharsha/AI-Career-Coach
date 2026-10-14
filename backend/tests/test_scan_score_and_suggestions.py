"""A scan's ats_score always says where it came from, and its advice never
contradicts its own findings.

Found by running a real scan on Ollama with no scoring model installed:

  * ats_score came back 0.0 for a resume covering six of seven required
    skills. The LLM path passed 0.0 as its no-model fallback, where the
    rule-based path passed the keyword ratio.
  * The advice said "Consider adding experience with Kubernetes" in the same
    response that listed Kubernetes as matched, and told the candidate to
    "state Kubernetes explicitly — your other skills imply it" about a
    resume that wrote Kubernetes in its skills line.

Every test here drives analyze_resume_against_job with the LLM call replaced
by a fake and the model-file check forced either way; nothing reaches a real
model.
"""

import pytest

from app.modules.resume_analyzer import services

RESUME = """Ada Lovelace
ada@example.com | (415) 555-0142

SUMMARY
Backend engineer with 6 years building Python services on AWS.

EXPERIENCE
Senior Software Engineer, Analytical Engines Inc.  2021 - Present
- Designed a PostgreSQL billing service handling 2M requests per day on AWS ECS.
- Led migration of 12 services to Kubernetes, cutting deploy time from 40 to 8 minutes.
- Built Python data pipelines processing 500 GB per day with Airflow.

EDUCATION
B.S. Computer Science, University of London, 2018

SKILLS
Python, PostgreSQL, AWS, Docker, Kubernetes, Airflow, REST APIs
"""

JD = (
    "Senior Backend Engineer. Required: Python, PostgreSQL, AWS, REST APIs, Kubernetes. "
    "Nice to have: Terraform, Airflow."
)


@pytest.fixture
def scan(monkeypatch):
    """scan(llm=<dict|None>, model=<score|None>) -> the scan result.

    llm: what the fake model returns (None = no LLM, so the rule-based path).
    model: a number means a trained model is installed and predicts that;
           None means no model file.
    """

    def run(llm=None, model=None):
        monkeypatch.setattr(services, "extract_text", lambda filename, content: RESUME)
        monkeypatch.setattr(services.llm_client, "_client", object() if llm is not None else None)
        if llm is not None:
            monkeypatch.setattr(services.llm_client, "complete_tool_json", lambda *a, **k: dict(llm))
        monkeypatch.setattr(services, "model_available", lambda: model is not None)
        monkeypatch.setattr(services, "predict_score", lambda *a, **k: model)
        return services.analyze_resume_against_job("ada.pdf", b"%PDF-", JD)

    return run


def llm_reply(**overrides):
    reply = {
        "is_resume": True,
        "matched_skills": ["Python", "PostgreSQL", "AWS"],
        "missing_skills": ["Terraform"],
        "extracted_skills": ["Python", "PostgreSQL", "AWS", "Docker"],
        "keyword_analysis": [],
        "suggestions": [],
    }
    reply.update(overrides)
    return reply


# --- the score and where it came from ---------------------------------------


class TestScoreSource:
    def test_llm_path_with_a_model_reports_the_model_score(self, scan):
        result = scan(llm=llm_reply(), model=77)
        assert result["_source"] == "llm"
        assert result["score_source"] == "model"
        assert result["ats_score"] == 77.0

    def test_llm_path_without_a_model_falls_back_to_the_keyword_ratio_not_zero(self, scan):
        # 3 matched, 1 missing -> 75.0. This was 0.0.
        result = scan(llm=llm_reply(), model=None)
        assert result["_source"] == "llm"
        assert result["score_source"] == "keyword_fallback"
        assert result["ats_score"] == 75.0

    def test_rule_path_with_a_model_reports_the_model_score(self, scan):
        result = scan(llm=None, model=61)
        assert result["_source"] == "rules"
        assert result["score_source"] == "model"
        assert result["ats_score"] == 61.0

    def test_rule_path_without_a_model_reports_the_keyword_ratio(self, scan):
        result = scan(llm=None, model=None)
        assert result["_source"] == "rules"
        assert result["score_source"] == "keyword_fallback"
        assert 0 < result["ats_score"] <= 100

    def test_the_two_paths_agree_on_the_fallback_formula(self):
        assert services._keyword_ratio(["a", "b", "c"], ["d"]) == 75.0
        assert services._keyword_ratio([], []) == 0.0  # no keywords at all: 0, never a ZeroDivisionError

    def test_the_fallback_ratio_is_taken_after_reconciling_not_before(self, scan):
        # The model calls Kubernetes and Airflow missing; the resume plainly
        # writes both, so they move to matched and the ratio must follow:
        # 5 matched / 0 missing, not the 3 / 2 the model reported.
        result = scan(
            llm=llm_reply(
                matched_skills=["Python", "PostgreSQL", "AWS"], missing_skills=["Kubernetes", "Airflow"]
            ),
            model=None,
        )
        assert result["missing_skills"] == []
        assert result["ats_score"] == 100.0

    def test_a_model_score_is_not_recomputed_by_reconciling(self, scan):
        result = scan(llm=llm_reply(missing_skills=["Kubernetes"]), model=42)
        assert result["score_source"] == "model" and result["ats_score"] == 42.0

    def test_score_source_is_in_the_api_response_and_the_stored_scan(self, monkeypatch):
        import json

        import fitz
        from fastapi.testclient import TestClient
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.core.database import Base, get_db
        from app.core.deps import AuthenticatedUser, get_current_user
        from app.main import app
        from app.models.resume import ResumeAnalysis

        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        db = sessionmaker(bind=engine)()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id="u1", email="u1@example.com")
        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", lambda *a, **k: llm_reply())
        monkeypatch.setattr(services, "model_available", lambda: False)

        doc = fitz.open()
        page = doc.new_page()
        for i, line in enumerate(RESUME.splitlines()):
            page.insert_text((50, 60 + 14 * i), line, fontsize=10)
        try:
            response = TestClient(app).post(
                "/api/resume/analyze",
                files={"resume": ("ada.pdf", doc.tobytes(), "application/pdf")},
                data={"job_description": JD},
            )
            stored = db.query(ResumeAnalysis).one()
        finally:
            app.dependency_overrides.clear()
            db.close()

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["score_source"] == "keyword_fallback"
        assert body["ats_score"] > 0  # the 0.0 this fixes
        assert json.loads(stored.result_json)["score_source"] == "keyword_fallback"

    def test_a_scan_stored_before_the_field_existed_still_deserialises(self):
        from app.schemas.resume import AnalysisResultSchema

        old = AnalysisResultSchema(
            id=1, ats_score=50.0, missing_skills=[], matched_skills=[], extracted_skills=[],
            keyword_analysis=[], suggestions=[], created_at="2026-09-01T00:00:00",
        )
        assert old.score_source is None


# --- suggestions never contradict the matched skills ------------------------


class TestSuggestionsDoNotContradictMatches:
    def test_the_kubernetes_case(self, scan):
        # The model reported Kubernetes as missing, advised adding it, and the
        # resume writes it in two places. Reconciling moves it to matched; the
        # advice to add it must not survive.
        result = scan(
            llm=llm_reply(
                matched_skills=["Python", "AWS"],
                missing_skills=["Kubernetes", "Terraform"],
                suggestions=[
                    "Consider adding experience with Kubernetes to your resume.",
                    "Add Terraform to your skills section.",
                    "Quantify the impact of your most recent role.",
                ],
            ),
            model=None,
        )
        assert "Kubernetes" in result["matched_skills"]
        assert not any("kubernetes" in s.lower() for s in result["suggestions"])
        # Still-missing skills and general advice are untouched.
        assert "Add Terraform to your skills section." in result["suggestions"]
        assert "Quantify the impact of your most recent role." in result["suggestions"]

    def test_a_suggestion_naming_a_matched_skill_is_dropped_whatever_its_case(self, scan):
        result = scan(
            llm=llm_reply(
                matched_skills=["Python", "AWS", "Kubernetes"],
                suggestions=["Highlight your PYTHON work in the summary.", "Mention more about kubernetes."],
            ),
            model=None,
        )
        assert result["suggestions"] == []

    def test_aliases_count_as_the_same_skill(self, scan):
        # Matched as "Kubernetes"; advised about "k8s". Matched as "AWS";
        # advised about "Amazon Web Services".
        result = scan(
            llm=llm_reply(
                matched_skills=["Kubernetes", "AWS", "PostgreSQL"],
                suggestions=[
                    "Spell out k8s experience.",
                    "Add Amazon Web Services certifications.",
                    "Postgres tuning would help.",
                    "Add a link to your portfolio.",
                ],
            ),
            model=None,
        )
        assert result["suggestions"] == ["Add a link to your portfolio."]

    def test_a_skill_name_inside_a_longer_word_does_not_count(self, scan):
        result = scan(
            llm=llm_reply(matched_skills=["AWS"], suggestions=["Add more drawsheets of your work."]),
            model=None,
        )
        assert result["suggestions"] == ["Add more drawsheets of your work."]

    def test_a_skill_that_is_also_an_english_word_only_counts_mid_sentence_as_written(self, scan):
        result = scan(
            llm=llm_reply(
                matched_skills=["Go"],
                suggestions=[
                    "Go beyond the job title and describe outcomes.",  # sentence-initial: the word, not the language
                    "Why not go further on the results?",  # lower case: the word
                    "Show more Go projects.",  # mid-sentence, as written: the language
                ],
            ),
            model=None,
        )
        assert result["suggestions"] == [
            "Go beyond the job title and describe outcomes.",
            "Why not go further on the results?",
        ]

    def test_nothing_is_dropped_when_nothing_matched(self):
        suggestions = ["Add Python.", "Add AWS."]
        assert services._drop_suggestions_naming_matched_skills(suggestions, []) == suggestions

    def test_the_prompt_also_tells_the_model_not_to(self):
        assert "Never suggest adding a skill that already appears" in services.SYSTEM_PROMPT


class TestReconcileTellsLiteralFromImplied:
    def test_a_skill_the_resume_writes_gets_no_state_it_explicitly_advice(self, scan):
        result = scan(llm=llm_reply(missing_skills=["Kubernetes"]), model=None)
        assert "Kubernetes" in result["matched_skills"]
        assert not any("explicitly" in s for s in result["suggestions"])

    def test_a_skill_the_resume_only_implies_still_gets_it(self, scan, monkeypatch):
        # Resume writes PyTorch; the job asks for "deep learning".
        monkeypatch.setattr(
            services, "extract_text", lambda f, c: RESUME.replace("Docker", "PyTorch")
        )
        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(
            services.llm_client,
            "complete_tool_json",
            lambda *a, **k: llm_reply(missing_skills=["deep learning"], matched_skills=["Python"]),
        )
        monkeypatch.setattr(services, "model_available", lambda: False)

        result = services.analyze_resume_against_job("ada.pdf", b"%PDF-", JD)

        assert "deep learning" in result["matched_skills"]
        assert any('State "deep learning" explicitly' in s for s in result["suggestions"])
        item = next(i for i in result["keyword_analysis"] if i["keyword"] == "deep learning") if result["keyword_analysis"] else None
        assert item is None or item["implied"] is True

    def test_literal_keywords_are_marked_present_and_not_implied(self):
        result = services._reconcile_implied(
            RESUME,
            {
                "matched_skills": [],
                "missing_skills": ["Kubernetes"],
                "keyword_analysis": [{"keyword": "Kubernetes", "present": False, "frequency": 0}],
                "suggestions": [],
            },
        )
        item = result["keyword_analysis"][0]
        assert item["present"] is True and item["implied"] is False and item["frequency"] >= 1
        assert result["suggestions"] == []
