"""The JD analyzer's API, and where it is wired into the scan and tailoring flows.

The model is a scripted fake: tests/test_jd_analyzer_service.py covers what the
analyzer does with a reply; this file covers who asks, and what they do with it.
"""

import json

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.keywords import keyword_candidates
from app.core.ratelimit import reset_rate_limits
from app.core.taxonomy import skill_candidates
from app.main import app
from app.models.company import Company  # noqa: F401 — registers job_listings.company_id's FK target
from app.models.jd_analysis import JDAnalysisRecord
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.modules.jd_analyzer import service
from app.modules.resume_analyzer import services as scan_services
from app.modules.resume_builder import faang
from app.modules.resume_builder import services as builder_services
from app.modules.resume_builder import tailor

ALICE = "00000000-0000-0000-0000-00000000000a"

JD = (
    "Senior Backend Engineer — payments. 6+ years of experience. Deep expertise in at least one of "
    "Go, Java, or Python. Experience with PostgreSQL or MySQL. Nice to have: Kubernetes. "
    "You'll lead the redesign of the ledger service."
)

RESUME = """Ada Lovelace
ada@example.com | (415) 555-0142

EXPERIENCE
Senior Software Engineer, Analytical Engines Inc.  2021 - Present
- Designed a PostgreSQL billing service handling 2M requests per day.
- Built Python data pipelines processing 500 GB per day.

EDUCATION
B.S. Computer Science, University of London, 2018

SKILLS
Python, PostgreSQL
"""


def skill(name, evidence=None, group=None):
    return {"name": name, "evidence": evidence or name, "alternative_group": group}


JD_REPLY = {
    "job_title": "Senior Backend Engineer", "seniority": "senior", "min_years_experience": 6,
    "required_skills": [
        skill("Go", "Go, Java, or Python", "language"), skill("Java", "Go, Java, or Python", "language"),
        skill("Python", "Go, Java, or Python", "language"),
        skill("PostgreSQL", "PostgreSQL or MySQL", "database"), skill("MySQL", "PostgreSQL or MySQL", "database"),
    ],
    "preferred_skills": [skill("Kubernetes")],
    "tools_technologies": ["Go", "Java", "Python", "PostgreSQL", "MySQL", "Kubernetes"],
    "education": [], "certifications": [], "responsibilities": ["lead the redesign of the ledger service"],
}
SCAN_REPLY = {
    "is_resume": True, "matched_skills": ["Python", "PostgreSQL"], "missing_skills": ["Go", "Kubernetes"],
    "extracted_skills": ["Python", "PostgreSQL"], "keyword_analysis": [], "suggestions": [],
}
BULLETS_REPLY = {"suggestions": []}


class Router:
    """A fake model that answers by tool name and records the order of calls."""

    provider = "ollama"
    model = "llama3.1"

    def __init__(self):
        self.available = True
        self.calls: list[dict] = []
        self.missed_calls: list[str] = []
        self.answers = {
            service.TOOL_NAME: JD_REPLY,
            "submit_analysis": SCAN_REPLY,
            "submit_bullet_suggestions": BULLETS_REPLY,
        }

    def complete_tool_json(self, system, user, tool_name, schema, max_tokens=1500):
        if tool_name == service.MISSED_TOOL_NAME:
            # The analyzer's own second call; these tests are about the flows around it.
            self.missed_calls.append(user)
            return {"required_skills": [], "preferred_skills": [], "tools_technologies": []}
        self.calls.append({"tool": tool_name, "user": user})
        answer = self.answers[tool_name]
        if isinstance(answer, Exception):
            raise answer
        return dict(answer)

    def complete_json(self, *a, **k):
        raise AssertionError("complete_json must not be used")

    @property
    def tools(self):
        return [c["tool"] for c in self.calls]


@pytest.fixture
def model(monkeypatch):
    fake = Router()
    for module in (service, scan_services, builder_services):
        monkeypatch.setattr(module, "llm_client", fake)
    service.clear_cache()
    yield fake
    service.clear_cache()


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=ALICE, email="a@x.com")
    reset_rate_limits()
    yield TestClient(app)
    app.dependency_overrides.clear()
    reset_rate_limits()


def add_job(db, description=JD):
    row = JobListing(
        query_key="backend", external_id="j1", title="Backend Engineer", company="Acme", location="Remote",
        work_mode="Remote", apply_url="https://example.com/j", description=description,
    )
    db.add(row)
    db.commit()
    return row


def add_scan(db, text=RESUME):
    row = ResumeAnalysis(
        user_id=ALICE, resume_filename="r.pdf", job_description="old jd", ats_score=61.0,
        result_json=json.dumps({"matched_skills": [], "extracted_skills": []}), resume_text=text,
    )
    db.add(row)
    db.commit()
    return row


def resume_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    for i, line in enumerate(RESUME.splitlines()):
        page.insert_text((50, 60 + 14 * i), line, fontsize=10)
    return doc.tobytes()


# --- POST /api/jd/analyze ---------------------------------------------------


class TestAnalyzeEndpoint:
    def test_analyses_a_pasted_description(self, client, model, db):
        response = client.post("/api/jd/analyze", json={"job_description": JD})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["analysis"]["job_title"] == "Senior Backend Engineer"
        assert body["analysis"]["seniority"] == "senior" and body["analysis"]["seniority_source"] == "stated"
        assert body["analysis"]["required_skills"][0]["name"] == "go"
        assert body["cached"] is False and body["model"] == "llama3.1" and body["job_listing_id"] is None
        assert db.query(JDAnalysisRecord).count() == 1

    def test_the_second_request_is_a_cache_hit(self, client, model):
        client.post("/api/jd/analyze", json={"job_description": JD})
        second = client.post("/api/jd/analyze", json={"job_description": JD}).json()
        assert second["cached"] is True and len(model.calls) == 1

    def test_without_a_model_it_still_answers_from_the_rules(self, client, model):
        model.available = False
        body = client.post("/api/jd/analyze", json={"job_description": JD}).json()
        assert body["analysis"]["source"] == "rules" and body["analysis"]["job_title"] == "Senior Backend Engineer"

    @pytest.mark.parametrize("text", ["", "too short", "x" * 60001])
    def test_rejects_text_that_is_too_short_or_too_long(self, client, model, text):
        assert client.post("/api/jd/analyze", json={"job_description": text}).status_code == 422

    def test_is_rate_limited(self, client, model):
        codes = [client.post("/api/jd/analyze", json={"job_description": JD}).status_code for _ in range(31)]
        assert codes[:30] == [200] * 30 and codes[30] == 429

    def test_requires_sign_in(self, db):
        app.dependency_overrides[get_db] = lambda: db
        try:
            assert TestClient(app).post("/api/jd/analyze", json={"job_description": JD}).status_code in (401, 403)
        finally:
            app.dependency_overrides.clear()


# --- GET /api/jd/analyze/{job_listing_id} -----------------------------------


class TestAnalyzeListing:
    def test_analyses_a_listing_and_links_the_row(self, client, model, db):
        job = add_job(db)
        body = client.get(f"/api/jd/analyze/{job.id}").json()
        assert body["job_listing_id"] == job.id and body["analysis"]["job_title"] == "Senior Backend Engineer"
        assert db.query(JDAnalysisRecord).one().job_listing_id == job.id

    def test_a_repeat_is_cached(self, client, model, db):
        job = add_job(db)
        client.get(f"/api/jd/analyze/{job.id}")
        assert client.get(f"/api/jd/analyze/{job.id}").json()["cached"] is True and len(model.calls) == 1

    def test_unknown_listing_is_404(self, client, model):
        assert client.get("/api/jd/analyze/999").status_code == 404

    def test_a_listing_with_no_description_is_422(self, client, model, db):
        job = add_job(db, description="   ")
        assert client.get(f"/api/jd/analyze/{job.id}").status_code == 422

    def test_is_rate_limited(self, client, model, db):
        job = add_job(db)
        codes = [client.get(f"/api/jd/analyze/{job.id}").status_code for _ in range(31)]
        assert codes[30] == 429


# --- the scan flow ----------------------------------------------------------


class TestScanFlow:
    def _scan(self):
        return scan_services.analyze_resume_against_job("ada.pdf", resume_pdf(), JD)

    def test_the_job_is_analysed_before_the_resume_is_scanned(self, model, monkeypatch):
        monkeypatch.setattr(scan_services, "model_available", lambda: False)
        self._scan()
        assert model.tools[:2] == [service.TOOL_NAME, "submit_analysis"]

    def test_the_scan_prompt_carries_the_structured_summary(self, model, monkeypatch):
        monkeypatch.setattr(scan_services, "model_available", lambda: False)
        self._scan()
        prompt = model.calls[1]["user"]
        assert "STRUCTURED SUMMARY OF THE JOB" in prompt and "Required: go, java, python" in prompt

    def test_the_result_carries_the_analysis(self, model, monkeypatch):
        monkeypatch.setattr(scan_services, "model_available", lambda: False)
        result = self._scan()
        assert result["jd_analysis"]["job_title"] == "Senior Backend Engineer"
        assert result["jd_analysis"]["source"] in ("llm", "hybrid")

    def test_when_the_scan_model_fails_the_rule_path_still_uses_the_analysis(self, model, monkeypatch):
        from app.core.llm import LLMProviderError

        monkeypatch.setattr(scan_services, "model_available", lambda: False)
        model.answers["submit_analysis"] = LLMProviderError("down", "unreachable")
        result = self._scan()
        assert result["_source"] == "rules" and result["jd_analysis"]["source"] in ("llm", "hybrid")
        keywords = [k["keyword"] for k in result["keyword_analysis"]]
        assert "Go" in keywords and "Kubernetes" in keywords  # from the analysis, in its order
        assert model.tools.count(service.TOOL_NAME) == 1  # analysed once, reused by the fallback

    def test_with_no_model_the_scan_is_exactly_what_it_was_before(self, model, monkeypatch):
        model.available = False
        monkeypatch.setattr(scan_services, "model_available", lambda: False)
        result = self._scan()
        before = scan_services._rule_based_analysis(RESUME, JD)  # the old call, no analysis
        assert result["jd_analysis"]["source"] == "rules"
        assert result["keyword_analysis"] == before["keyword_analysis"]
        assert result["matched_skills"] == before["matched_skills"] and result["missing_skills"] == before["missing_skills"]

    def test_a_rules_only_analysis_hands_back_the_callers_own_keyword_list(self, model):
        model.available = False
        analysis = service.analyze(JD)
        assert scan_services.jd_service.keywords_from(analysis, JD, skill_candidates) == skill_candidates(JD)

    def test_the_api_response_includes_the_analysis(self, model, client, db, monkeypatch):
        monkeypatch.setattr(scan_services, "model_available", lambda: False)
        response = client.post(
            "/api/resume/analyze",
            files={"resume": ("ada.pdf", resume_pdf(), "application/pdf")},
            data={"job_description": JD},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["jd_analysis"]["job_title"] == "Senior Backend Engineer"
        stored = json.loads(db.query(ResumeAnalysis).one().result_json)
        assert stored["jd_analysis"]["seniority"] == "senior"

    def test_a_scan_stored_before_the_analyzer_existed_still_deserialises(self):
        from app.schemas.resume import AnalysisResultSchema

        old = AnalysisResultSchema(
            id=1, ats_score=50.0, missing_skills=[], matched_skills=[], extracted_skills=[],
            keyword_analysis=[], suggestions=[], created_at="2026-09-01T00:00:00",
        )
        assert old.jd_analysis is None


# --- the tailoring flows ----------------------------------------------------


class TestTailoringFlows:
    def test_stage_fixes_analyses_the_job_first_and_works_from_it(self, model):
        out = builder_services.stage_fixes(RESUME, JD, experiences=None)
        assert model.tools == [service.TOOL_NAME]
        # Derived from the analysis (required, then preferred): Go and Java are missing, Python is not.
        assert out["missing_keywords"][:3] == ["Go", "Java", "MySQL"] and "Python" not in out["missing_keywords"]

    def test_with_no_model_stage_fixes_is_exactly_what_it_was(self, model):
        model.available = False
        out = builder_services.stage_fixes(RESUME, JD, experiences=None)
        expected = [k for k in keyword_candidates(JD) if k.lower() not in RESUME.lower()]
        assert out["missing_keywords"] == expected[:15] and model.calls == []

    def test_the_rewrite_prompt_carries_the_summary_and_comes_after_the_analysis(self, model):
        experiences = [{"title": "Engineer", "company": "X", "dates": "2021", "bullets": ["Built Python data pipelines processing 500 GB per day."]}]
        builder_services.stage_fixes(RESUME, JD, experiences=experiences)
        assert model.tools == [service.TOOL_NAME, "submit_bullet_suggestions"]
        assert "STRUCTURED SUMMARY OF THE JOB" in model.calls[1]["user"]

    def test_handoff_and_preview_pass_their_session_so_the_analysis_is_stored(self, model, db, monkeypatch):
        job, scan = add_job(db), add_scan(db)
        monkeypatch.setattr(builder_services, "model_available", lambda: False)
        monkeypatch.setattr(tailor, "model_available", lambda: False)
        monkeypatch.setattr(faang, "model_available", lambda: False)
        tailor.build_handoff(db, ALICE, job.id, scan.id)
        assert db.query(JDAnalysisRecord).count() == 1
        service.clear_cache()
        faang.build_preview(db, ALICE, job.id, scan.id, "Ada Lovelace", include_rewrites=False)
        assert model.tools.count(service.TOOL_NAME) == 1  # the second flow found the stored analysis

    def test_the_free_reports_never_call_the_model_and_use_an_existing_analysis(self, model):
        builder_services.quality_report(RESUME, JD, [])
        assert model.calls == []  # nothing analysed, nothing asked
        service.analyze(JD)  # a previous step analysed it
        before = len(model.calls)
        report = builder_services.quality_report(RESUME, JD, [])
        assert len(model.calls) == before
        assert "Go" in [c["skill"] for c in report["skill_contexts"]]  # the analysis's list

    def test_quick_tailor_keywords_do_not_call_the_model(self, model):
        assert service.keywords_peek(JD, skill_candidates) == skill_candidates(JD)
        assert model.calls == []


def test_the_modules_that_must_stay_free_do_not_import_the_model_calling_path():
    """quality_report and quick_tailor use keywords_peek; only the paths that
    already run the model (scan, stage_fixes) use keywords_for / analyze."""
    import inspect

    source = inspect.getsource(builder_services.quality_report) + inspect.getsource(builder_services.quick_tailor)
    assert "keywords_peek" in source
    assert "jd_service.analyze(" not in source and "keywords_for(" not in source
