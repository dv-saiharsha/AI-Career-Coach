"""Tailor Resume — resume_builder/smart_tailor.py, jd_match.py and the
section parsing and rendering they rely on.

The LLM is never called: the client is switched off for every test, and the
rewrite step is replaced with a canned reply where a test needs one. The
compile is real (tectonic), and those tests are skipped where it is absent,
the same rule as test_quick_tailor.py.
"""

import json
import types

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.llm import llm_client
from app.core.ratelimit import reset_rate_limits
from app.main import app
from app.models.company import Company  # noqa: F401 — registers job_listings.company_id's FK target
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.modules.jd_analyzer import service as jd_service
from app.modules.jd_analyzer.schemas import JDAnalysis, Requirement as JDRequirement, Skill
from app.modules.resume_builder import autofill, faang, jd_match, latex, services, smart_tailor

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"

needs_tectonic = pytest.mark.skipif(not latex.tectonic_available(), reason="tectonic not installed on this machine")

RESUME = """Priya Raman
Tempe, AZ | priya.raman@example.com | (480) 555-0142 | linkedin.com/in/priyaraman
SUMMARY
Computer science graduate student who builds backend services and data pipelines.
EDUCATION
Arizona State University | Master of Science in Computer Science | GPA: 3.9
2024 - 2026
SKILLS
Languages: Python, Java, SQL, JavaScript
Frameworks: FastAPI, Spring Boot, React
Databases: PostgreSQL, MySQL
Cloud/Tools: AWS, Docker, Git, GitHub Actions
EXPERIENCE
Software Engineering Intern
Acme Logistics Inc
May 2025 - Aug 2025
• Worked on backend APIs for the shipment tracking service using Java and Spring Boot.
• Wrote unit tests with JUnit and helped raise coverage from 52% to 81%.
• Built a Docker-based local environment that cut new-developer setup time from 2 days to 3 hours.
Research Assistant
Arizona State University
Jan 2025 - May 2025
• Cleaned and analyzed sensor datasets with Python and pandas.
• Helped with lab website updates.
PROJECTS
Campus Ride Share | Python, FastAPI, PostgreSQL
• Designed a REST API with FastAPI and PostgreSQL serving ride matching for 300 student users.
• Deployed the service on AWS EC2 with a GitHub Actions CI pipeline.
Recipe Finder | React, MySQL
• Made a React web app to search recipes stored in MySQL.
AWARDS
Dean's List, Fall 2024
CERTIFICATIONS
AWS Certified Cloud Practitioner
"""

JD = """Software Engineer I, Backend
We are hiring a backend engineer to build and scale the APIs behind shipment tracking.
Responsibilities
- Design, build and maintain RESTful APIs in Java and Spring Boot
- Process event data with Kafka and PostgreSQL
- Deploy services on GCP using Docker and Kubernetes
Requirements
- Bachelor's or Master's degree in Computer Science or a related field
- Proficiency in Java or Python
- Experience building REST APIs
- Familiarity with SQL and relational databases
Nice to have
- Kafka
- Kubernetes
"""


def _analysis() -> JDAnalysis:
    def skill(name, evidence, group=None):
        return Skill(name=name, evidence=evidence, alternative_group=group)

    return JDAnalysis(
        job_title="Software Engineer I, Backend",
        seniority="junior",
        seniority_source="stated",
        required_skills=[
            skill("java", "Java", "any-of:java/python"),
            skill("python", "Python", "any-of:java/python"),
            skill("rest apis", "REST APIs"),
            skill("sql", "SQL"),
            skill("relational databases", "relational databases"),
        ],
        preferred_skills=[skill("kafka", "Kafka"), skill("kubernetes", "Kubernetes"), skill("gcp", "GCP")],
        tools_technologies=["spring boot", "postgresql", "docker"],
        education=[JDRequirement(
            name="Bachelor's or Master's degree in Computer Science", required=True,
            evidence="Bachelor's or Master's degree in Computer Science or a related field",
        )],
        responsibilities=["Design, build and maintain RESTful APIs in Java and Spring Boot"],
        source="hybrid",
    )


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    """No model is ever reached: the JD analysis is a fixed one and the
    rewrite call returns None unless a test supplies a reply."""
    monkeypatch.setattr(llm_client, "_client", None)
    monkeypatch.setattr(jd_service, "analyze", lambda text, db=None, job_listing_id=None: _analysis())
    jd_service.clear_cache()


def _record(text=RESUME):
    return types.SimpleNamespace(resume_text=text, result_json="{}")


def _reply(bullets: dict[str, str], summary="", intent="They need a backend engineer for shipment APIs."):
    return {"hiring_intent": intent, "summary": summary, "bullets": [{"id": k, "text": v} for k, v in bullets.items()]}


# ── parsing ───────────────────────────────────────────────────────────────


class TestSectionParsing:
    def test_projects_skills_certifications_and_awards_are_parsed(self):
        parsed = autofill.build_autofill(RESUME)
        assert [p["name"] for p in parsed["projects"]] == ["Campus Ride Share", "Recipe Finder"]
        assert parsed["projects"][0]["tech"] == "Python, FastAPI, PostgreSQL"
        assert len(parsed["projects"][0]["bullets"]) == 2
        assert parsed["skill_groups"][0] == {"category": "Languages", "items": ["Python", "Java", "SQL", "JavaScript"]}
        assert parsed["certifications"] == ["AWS Certified Cloud Practitioner"]
        assert parsed["awards"] == ["Dean's List, Fall 2024"]

    def test_awards_heading_ends_the_projects_section(self):
        """Before AWARDS was a section, "Dean's List" was read as a project."""
        parsed = autofill.build_autofill(RESUME)
        assert all("Dean" not in p["name"] for p in parsed["projects"])

    def test_resume_without_new_sections_parses_as_before(self):
        parsed = autofill.build_autofill("Jane Doe\nEXPERIENCE\nEngineer\nAcme Inc\n2020 - 2022\n• Built a thing with Python.\n")
        assert parsed["projects"] == [] and parsed["skill_groups"] == [] and parsed["certifications"] == []
        assert parsed["experiences"][0]["bullets"] == ["Built a thing with Python."]


# ── rendering ─────────────────────────────────────────────────────────────


class TestRendering:
    def test_new_sections_render_and_escape(self):
        tex = latex.render_resume_tex({
            "candidate_name": "Jane",
            "skill_groups": [{"category": "Languages", "items": ["C#", "C++"]}],
            "projects": [{"name": "R&D Tool", "tech": "Python", "dates": "2024", "bullets": ["Cut cost 50%."]}],
            "certifications": ["AWS Certified"],
        })
        assert "\\textbf{Languages:} C\\#, C++" in tex
        assert "R\\&D Tool" in tex and "Cut cost 50\\%." in tex
        assert "\\section{Projects}" in tex and "\\section{Certifications}" in tex

    def test_section_order_and_titles_are_honoured_and_nothing_is_dropped(self):
        tex = latex.render_resume_tex({
            "candidate_name": "Jane", "summary": "Hi.",
            "education": [{"degree": "BS", "institution": "U", "dates": "2020"}],
            "experiences": [{"title": "Eng", "company": "A", "dates": "2021", "bullets": ["Did x."]}],
            "section_order": ["education", "experience"],
            "section_titles": {"experience": "Work History"},
        })
        assert tex.index("\\section{Education}") < tex.index("\\section{Work History}")
        # Summary was left out of the order; it still renders, at the end.
        assert "\\section{Professional Summary}" in tex

    def test_legacy_payload_renders_the_four_sections_in_the_old_order(self):
        tex = latex.render_resume_tex({
            "candidate_name": "Jane", "summary": "S.", "technical_skills": ["Go"],
            "experiences": [{"title": "Eng", "company": "A", "dates": "2021", "bullets": ["x"]}],
            "education": [{"degree": "BS", "institution": "U", "dates": "2020"}],
        })
        positions = [tex.index(s) for s in ("Professional Summary", "Core Skills", "\\section{Experience}", "\\section{Education}")]
        assert positions == sorted(positions)
        assert "Projects" not in tex


# ── matching ──────────────────────────────────────────────────────────────


def _matches(resume=RESUME, confirmed=None):
    parsed = autofill.build_autofill(resume)
    reqs = jd_match.build_requirements(_analysis(), JD, "Software Engineer I, Backend")
    ev = jd_match.index_resume(resume, parsed, confirmed)
    return {m.requirement.key: m for m in jd_match.match_requirements(reqs, ev, jd_match.years_of_experience(parsed["experiences"]))}


class TestMatching:
    def test_four_match_levels(self):
        m = _matches()
        assert m["java"].level == "exact" and m["java"].demonstrated
        assert m["relational databases"].level == "related" and m["relational databases"].via
        assert m["gcp"].level == "transferable" and m["gcp"].via == "aws"
        assert m["kafka"].level == "missing" and m["kubernetes"].level == "missing"

    def test_importance_ranks_required_and_repeated_terms_first(self):
        m = _matches()
        # Java is required and named three times; Kafka is preferred.
        assert m["java"].requirement.importance == "critical"
        assert m["kafka"].requirement.importance in ("medium", "low")

    def test_education_level_is_compared(self):
        m = _matches()
        edu = next(v for k, v in m.items() if k.startswith("education:"))
        assert edu.level == "exact"

    def test_transferable_and_missing_terms_are_forbidden_supported_ones_are_not(self):
        matches = list(_matches().values())
        forbidden = jd_match.forbidden_terms(matches, RESUME)
        assert {"Kafka", "Kubernetes", "GCP"} <= set(forbidden)
        assert "Java" in jd_match.supported_terms(matches)

    def test_a_confirmed_skill_counts_as_exact(self):
        m = _matches(confirmed=["Kafka"])
        assert m["kafka"].level == "exact" and m["kafka"].section == "confirmed"

    def test_term_matching_tolerates_spelling_but_not_substrings(self):
        assert jd_match.mentions("Built a REST API in Go", "REST APIs")
        assert jd_match.mentions("Set up CI/CD", "cicd")
        assert not jd_match.mentions("Used JavaScript daily", "Java")

    def test_years_of_experience_counts_overlaps_once(self):
        years = jd_match.years_of_experience([
            {"dates": "Jan 2020 - Dec 2021"}, {"dates": "Jan 2021 - Dec 2021"},
        ])
        assert years == 2.0


# ── the fact checks ──────────────────────────────────────────────────────


class TestChecks:
    entry = "Software Engineering Intern at Acme\nWorked on backend APIs using Java and Spring Boot.\nWrote unit tests with JUnit."

    def _check(self, original, rewritten, forbidden=("Kafka",)):
        return smart_tailor.check_bullet(original, rewritten, smart_tailor._license(self.entry), list(forbidden))

    def test_faithful_rewrite_passes(self):
        assert self._check(
            "Worked on backend APIs using Java and Spring Boot.",
            "Developed backend APIs using Java and Spring Boot for shipment tracking.",
        ) == []

    def test_invented_metric_is_rejected(self):
        problems = self._check("Worked on backend APIs using Java.", "Developed backend APIs in Java serving 2M requests a day.")
        assert any("figures" in p for p in problems)

    def test_dropped_metric_is_rejected(self):
        problems = self._check("Raised coverage from 52% to 81% with JUnit.", "Raised test coverage with JUnit.")
        assert any("drops figures" in p for p in problems)

    def test_tool_from_another_entry_is_rejected(self):
        """PostgreSQL is on the resume, but not in this role."""
        problems = self._check("Worked on backend APIs using Java.", "Developed backend APIs using Java and PostgreSQL.")
        assert any("PostgreSQL".lower() in p.lower() for p in problems)

    def test_unsupported_jd_skill_is_rejected(self):
        problems = self._check("Worked on backend APIs using Java.", "Developed Kafka-backed backend APIs using Java.")
        assert any("Kafka" in p for p in problems)

    def test_summary_checks(self):
        lic = smart_tailor._license(RESUME)
        ok = smart_tailor.check_summary("Backend-focused Software Engineer I candidate building Java and Spring Boot APIs.", lic, RESUME, ["Kafka"], 0.6)
        assert ok == []
        assert smart_tailor.check_summary("Seeking a role where I can grow.", lic, RESUME, [], None)
        assert smart_tailor.check_summary("Engineer with Kafka experience.", lic, RESUME, ["Kafka"], None)
        assert smart_tailor.check_summary("Engineer with 7 years of experience.", lic, RESUME, [], 0.6)


# ── the pipeline ─────────────────────────────────────────────────────────


@needs_tectonic
class TestPipeline:
    def test_without_the_llm_resume_is_still_tailored_and_says_so(self):
        out = smart_tailor.tailor(_record(), JD, job_title="Software Engineer I, Backend", company="Acme Freight")
        assert out["tailoring"]["ai"]["used"] is False and out["tailoring"]["ai"]["note"]
        assert out["resume"]["page_count"] == 1 and out["resume"]["fits"]
        assert out["resume"]["pdf_base64"]
        # Original wording kept.
        assert "Worked on backend APIs for the shipment tracking service using Java and Spring Boot." in out["resume"]["text"]
        # Projects, certifications and awards survive tailoring.
        assert "Campus Ride Share" in out["resume"]["text"]
        assert "AWS Certified Cloud Practitioner" in out["resume"]["text"]
        assert out["resume"]["filename"].startswith("RAMAN_PRIYA_RESUME_")

    def test_missing_and_transferable_skills_never_reach_the_resume(self):
        out = smart_tailor.tailor(_record(), JD, job_title="Software Engineer I, Backend")
        text = out["resume"]["text"]
        for term in ("Kafka", "Kubernetes", "GCP"):
            assert not jd_match.mentions(text, term)
        assert {m["requirement"] for m in out["analysis"]["missing"]} >= {"Kafka", "Kubernetes"}
        truth = next(c for c in out["validation"]["checks"] if c["key"] == "truthfulness")
        assert truth["status"] == "pass"

    def test_related_requirement_is_added_to_skills_with_its_evidence(self):
        out = smart_tailor.tailor(_record(), JD, job_title="Software Engineer I, Backend")
        items = [i for g in out["resume"]["content"]["skill_groups"] for i in g["items"]]
        assert "Relational Databases" in items
        assert any("shown by" in c["change"] for c in out["tailoring"]["changes"])

    def test_faithful_rewrites_apply_and_fabricated_ones_revert(self, monkeypatch):
        monkeypatch.setattr(smart_tailor, "_call_rewrite", lambda s, u: _reply({
            "E1.1": "Developed backend APIs for the shipment tracking service using Java and Spring Boot.",
            # Invents a number.
            "E1.2": "Wrote unit tests with JUnit for 40 services, raising coverage from 52% to 81%.",
            # Claims Kafka, which the resume does not show.
            "E2.1": "Built Kafka pipelines to clean and analyze sensor datasets with Python and pandas.",
        }, summary="Backend engineer building Java and Spring Boot APIs, with REST API and PostgreSQL project work."))
        out = smart_tailor.tailor(_record(), JD, job_title="Software Engineer I, Backend")
        text = out["resume"]["text"]
        assert "Developed backend APIs for the shipment tracking service" in text
        assert "40 services" not in text and "Kafka" not in text
        assert "Wrote unit tests with JUnit and helped raise coverage from 52% to 81%." in text
        statuses = {c["original"][:12]: c["status"] for c in out["tailoring"]["bullet_changes"]}
        assert statuses["Worked on bac"[:12]] == "rewritten"
        assert statuses["Wrote unit t"] == "reverted" and statuses["Cleaned and "] == "reverted"
        assert out["tailoring"]["ai"]["rewrites_accepted"] == 1 and out["tailoring"]["ai"]["rewrites_reverted"] == 2
        assert out["resume"]["content"]["summary"].startswith("Backend engineer")

    def test_fabricated_summary_falls_back_to_the_original(self, monkeypatch):
        monkeypatch.setattr(smart_tailor, "_call_rewrite", lambda s, u: _reply({}, summary="Engineer with 5 years of Kafka experience."))
        out = smart_tailor.tailor(_record(), JD)
        assert out["resume"]["content"]["summary"] == "Computer science graduate student who builds backend services and data pipelines."

    def test_echoed_prompt_tags_are_stripped(self, monkeypatch):
        monkeypatch.setattr(smart_tailor, "_call_rewrite", lambda s, u: _reply({
            "E1.1": "[REWRITE] Developed backend APIs for the shipment tracking service using Java and Spring Boot.",
        }))
        out = smart_tailor.tailor(_record(), JD)
        assert "[REWRITE]" not in out["resume"]["text"]
        assert out["tailoring"]["ai"]["rewrites_accepted"] == 1

    def test_original_design_keeps_the_candidates_section_order(self):
        out = smart_tailor.tailor(_record(), JD, design="original")
        order = out["resume"]["content"]["section_order"]
        assert order[:4] == ["summary", "education", "skills", "experience"]
        assert out["resume"]["section_titles"]["skills"] == "Skills"

    def test_long_resume_is_fit_to_one_page_by_trimming_not_shrinking(self):
        roles = "\n".join(
            f"Software Engineer\nCompany {i} Inc\nJan {2010 + i} - Dec {2010 + i}\n" + "\n".join(
                f"• Built service {i}-{j} in Java and Spring Boot handling order processing for the retail platform team."
                for j in range(7)
            )
            for i in range(8)
        )
        resume = RESUME.replace("EXPERIENCE\n", "EXPERIENCE\n" + roles + "\n", 1)
        out = smart_tailor.tailor(_record(resume), JD)
        assert out["resume"]["page_count"] == 1
        assert out["resume"]["adjustments"] or any("Compressed" in c["change"] for c in out["tailoring"]["changes"])

    def test_inputs_that_cannot_be_tailored_are_explained(self):
        with pytest.raises(smart_tailor.TailorInputError, match="too short"):
            smart_tailor.tailor(_record(), "Java dev")
        with pytest.raises(smart_tailor.TailorInputError, match="couldn't read"):
            smart_tailor.tailor(_record("Jane"), JD)
        with pytest.raises(smart_tailor.TailorInputError, match="Experience, Projects or Education"):
            smart_tailor.tailor(_record("Jane Doe\n" + "lorem ipsum dolor sit amet " * 20), JD)


# ── the route ─────────────────────────────────────────────────────────────


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


def _scan(db, user_id=ALICE, text=RESUME):
    row = ResumeAnalysis(
        user_id=user_id, resume_filename="r.pdf", job_description="old jd", ats_score=60.0,
        result_json=json.dumps({"matched_skills": [], "extracted_skills": []}), resume_text=text,
    )
    db.add(row)
    db.commit()
    return row


def _job(db):
    row = JobListing(
        query_key="backend", external_id="j1", title="Software Engineer I, Backend", company="Acme Freight",
        location="Remote", work_mode="Remote", apply_url="https://example.com/j", description=JD,
    )
    db.add(row)
    db.commit()
    return row


class TestRoute:
    def test_someone_elses_scan_is_404(self, client, db):
        scan = _scan(db, user_id=BOB)
        r = client.post(f"/api/resume-builder/smart-tailor/{scan.id}", json={"job_description": JD})
        assert r.status_code == 404

    def test_no_job_is_422(self, client, db):
        scan = _scan(db)
        r = client.post(f"/api/resume-builder/smart-tailor/{scan.id}", json={})
        assert r.status_code == 422

    def test_short_jd_is_a_readable_422(self, client, db):
        scan = _scan(db)
        r = client.post(f"/api/resume-builder/smart-tailor/{scan.id}", json={"job_description": "Java dev wanted"})
        assert r.status_code == 422 and "too short" in r.json()["detail"]

    def test_unknown_job_is_404(self, client, db):
        scan = _scan(db)
        r = client.post(f"/api/resume-builder/smart-tailor/{scan.id}", json={"job_id": 999})
        assert r.status_code == 404

    @needs_tectonic
    def test_pasted_jd_end_to_end_and_the_scan_is_untouched(self, client, db):
        scan = _scan(db)
        r = client.post(
            f"/api/resume-builder/smart-tailor/{scan.id}",
            json={"job_description": JD, "job_title": "Backend Engineer", "company": "Acme", "design": "faang"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) >= {"analysis", "tailoring", "resume", "validation", "scores"}
        assert body["analysis"]["counts"]["missing"] >= 2
        db.refresh(scan)
        assert scan.resume_text == RESUME

    def test_listing_result_is_cached_unless_skills_were_confirmed(self, client, db, monkeypatch):
        scan, job = _scan(db), _job(db)
        calls = {"n": 0}
        real = smart_tailor.tailor

        def counting(*a, **k):
            calls["n"] += 1
            return real(*a, **k)

        if not latex.tectonic_available():
            pytest.skip("tectonic not installed on this machine")
        monkeypatch.setattr(smart_tailor, "tailor", counting)
        url = f"/api/resume-builder/smart-tailor/{scan.id}"
        first = client.post(url, json={"job_id": job.id})
        second = client.post(url, json={"job_id": job.id})
        assert first.status_code == second.status_code == 200
        assert calls["n"] == 1 and second.json()["from_cache"] is True
        client.post(url, json={"job_id": job.id, "confirmed_skills": ["Kafka"]})
        assert calls["n"] == 2


class TestResumeMatchRoute:
    def test_returns_targeted_score_and_requirement_evidence(self, client, db, monkeypatch):
        from app.modules.resume_analyzer import services as analyzer

        scan = _scan(db)
        monkeypatch.setattr(analyzer, "model_available", lambda: True)
        monkeypatch.setattr(analyzer, "predict_score", lambda _resume, _jd: 73.5)
        monkeypatch.setattr(services, "quality_report", lambda *_args, **_kwargs: {"parsing_readiness": None})

        response = client.post(
            f"/api/resume-builder/match/{scan.id}",
            json={"job_description": JD, "job_title": "Backend Engineer", "company": "Acme"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["score"] == 73.5
        assert body["score_available"] is True
        assert body["score_source"] == "model"
        assert body["score_label"] == "ATS score from the trained scoring model"
        assert body["matched_requirements"]
        assert body["missing_requirements"]

    def test_without_the_model_the_score_is_the_labelled_keyword_coverage(self, client, db, monkeypatch):
        """No trained model: the same keyword-coverage score a scan shows,
        labelled as such, never a blank and never a made-up model figure."""
        from app.modules.resume_analyzer import services as analyzer

        scan = _scan(db)
        monkeypatch.setattr(analyzer, "model_available", lambda: False)
        monkeypatch.setattr(services, "quality_report", lambda *_args, **_kwargs: {"parsing_readiness": None})

        response = client.post(
            f"/api/resume-builder/match/{scan.id}",
            json={"job_description": JD, "job_title": "Backend Engineer"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["score_source"] == "keyword_fallback"
        assert 0 <= body["score"] <= 100 and body["score_available"] is True
        assert body["score_label"].startswith("Keyword match score")

    def test_another_users_resume_is_not_analyzable(self, client, db):
        scan = _scan(db, user_id=BOB)
        response = client.post(
            f"/api/resume-builder/match/{scan.id}",
            json={"job_description": JD, "job_title": "Backend Engineer"},
        )
        assert response.status_code == 404


class TestSavedTailoredResumeRoutes:
    def test_saves_reviewed_copy_and_leaves_original_scan_unchanged(self, client, db, monkeypatch):
        from app.modules.resume_builder import saved

        scan = _scan(db)
        original_text = scan.resume_text
        content = {
            "candidate_name": "Priya Raman",
            "summary": "Edited summary reviewed by the candidate.",
            "experiences": [{
                "title": "Software Engineer Intern",
                "company": "Acme Logistics Inc",
                "dates": "2025",
                "bullets": ["Built verified backend APIs."],
            }],
        }

        def compile_reviewed(received, description, title, company, target_pages, jd_analysis=None):
            assert received["summary"] == content["summary"]
            assert description == JD.strip()
            assert title == "Backend Engineer"
            return {
                "content": received,
                "resume_text": "Reviewed tailored resume",
                "pdf_bytes": b"%PDF-1.7 reviewed",
                "page_count": 1,
                "fits": True,
                "adjustments": [],
                "filename": "RAMAN_PRIYA_RESUME_BACKEND_ENGINEER_ACME.pdf",
                "score": 78.0,
                "score_source": "model",
            }

        monkeypatch.setattr(saved, "compile_reviewed_resume", compile_reviewed)
        from app.modules.resume_analyzer import services as analyzer

        monkeypatch.setattr(analyzer, "model_available", lambda: True)
        monkeypatch.setattr(analyzer, "predict_score", lambda resume, _jd: 61.0 if resume == original_text else 78.0)

        response = client.post("/api/resume-builder/saved-tailored", json={
            "source_analysis_id": scan.id,
            "job_title": "Backend Engineer",
            "company": "Acme",
            "job_description": JD,
            "content": content,
        })

        assert response.status_code == 200, response.text
        saved = response.json()
        assert saved["score_before"] == 61.0
        assert saved["score_after"] == 78.0
        assert saved["score_change"] == {"delta": 17.0, "direction": "improved"}
        assert saved["score_source"] == "model"
        assert saved["download_url"].endswith(f"/{saved['id']}/file")
        db.refresh(scan)
        assert scan.resume_text == original_text

        download = client.get(f"/api/resume-builder/saved-tailored/{saved['id']}/file")
        assert download.status_code == 200
        assert download.content == b"%PDF-1.7 reviewed"

    def test_saved_copy_is_isolated_by_firebase_user_id(self, client, db):
        from app.models.tailored_resume import TailoredResume

        row = TailoredResume(
            user_id=BOB,
            job_title="Backend Engineer",
            job_description=JD,
            resume_filename="private.pdf",
            resume_text="Private resume",
            resume_content="{}",
            pdf_bytes=b"%PDF-private",
        )
        db.add(row)
        db.commit()

        assert client.get(f"/api/resume-builder/saved-tailored/{row.id}/file").status_code == 404
        assert client.delete(f"/api/resume-builder/saved-tailored/{row.id}").status_code == 404


# ── the old preview path's rewrites ───────────────────────────────────────


def test_preview_with_rewrites_hands_stage_fixes_the_parsed_roles(db, monkeypatch):
    """include_rewrites used to pass experiences=[], which stage_fixes reads
    as "no bullets", so no rewrite was ever requested."""
    scan, job = _scan(db), _job(db)
    seen = {}

    def spy(resume_text, jd_text, experiences, **kwargs):
        seen["experiences"] = experiences
        return {"missing_keywords": [], "bullet_suggestions": []}

    monkeypatch.setattr(services, "stage_fixes", spy)
    faang.build_preview(db, ALICE, job.id, scan.id, "Priya Raman", include_rewrites=True)
    assert seen["experiences"] and seen["experiences"][0]["bullets"]


# ── outlook and score change ─────────────────────────────────────────────

from app.modules.resume_builder import outlook  # noqa: E402


class TestOutlook:
    def _rows(self, critical_missing=False):
        rows = [{"requirement": "Java", "importance": "critical", "match": "exact"}]
        if critical_missing:
            rows.append({"requirement": "Kubernetes", "importance": "critical", "match": "missing"})
        return rows

    def test_score_change_directions(self):
        assert outlook.score_change(60, 72)["direction"] == "improved"
        assert outlook.score_change(60, 60.4)["direction"] == "unchanged"
        assert outlook.score_change(60, 55)["direction"] == "declined"
        assert outlook.score_change(None, 70) is None

    def test_band_uses_coverage_when_no_score(self):
        result = outlook.shortlist_outlook(None, 85, self._rows())
        assert result["band"] == "strong" and result["basis"] == "coverage_only"

    def test_missing_critical_caps_the_band(self):
        result = outlook.shortlist_outlook(95, 95, self._rows(critical_missing=True))
        assert result["band"] == "possible"
        assert any("Missing critical" in d for d in result["drivers"])

    def test_never_states_a_probability(self):
        result = outlook.shortlist_outlook(70, 70, self._rows())
        assert "%" not in result["label"] and "chance" not in result["label"].lower()


@needs_tectonic
def test_tailor_reports_change_and_outlook(monkeypatch):
    out = smart_tailor.tailor(_record(), JD)
    scores = out["scores"]
    assert scores["outlook_before"]["band"] in {"strong", "competitive", "possible", "long_shot"}
    # Always a real before/after, model or not, and it says which.
    assert scores["source"] in {"model", "keyword_fallback"}
    assert scores["before"] is not None and scores["after"] is not None
    assert scores["change"]["direction"] in {"improved", "unchanged", "declined"}


@needs_tectonic
def test_without_the_model_tailoring_scores_by_keyword_coverage(monkeypatch):
    from app.modules.resume_analyzer import services as analyzer

    monkeypatch.setattr(analyzer, "model_available", lambda: False)
    out = smart_tailor.tailor(_record(), JD)
    assert out["scores"]["source"] == "keyword_fallback"
    # Supported JD terms placed on the page (e.g. "Relational Databases" from
    # PostgreSQL) can only raise coverage; nothing unsupported is added.
    assert out["scores"]["after"] >= out["scores"]["before"]


# ── match, preview and saved copies ──────────────────────────────────────


def _content():
    parsed = autofill.build_autofill(RESUME)
    return {
        "candidate_name": "Priya Raman", "email": parsed["email"], "summary": "Backend engineer.",
        "skill_groups": parsed["skill_groups"],
        "experiences": parsed["experiences"], "projects": parsed["projects"],
        "education": parsed["education"], "certifications": parsed["certifications"],
    }


class TestMatchAndSavedRoutes:
    def test_match_returns_requirements_and_outlook(self, client, db):
        scan = _scan(db)
        r = client.post(f"/api/resume-builder/match/{scan.id}", json={"job_description": JD, "job_title": "Backend Engineer"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outlook"]["band"] and body["missing_requirements"]
        assert all(m["match"] == "missing" for m in body["missing_requirements"])

    def test_match_on_someone_elses_scan_is_404(self, client, db):
        scan = _scan(db, user_id=BOB)
        r = client.post(f"/api/resume-builder/match/{scan.id}", json={"job_description": JD, "job_title": "X"})
        assert r.status_code == 404

    @needs_tectonic
    def test_preview_compiles_the_edits_and_saves_nothing(self, client, db):
        from app.models.tailored_resume import TailoredResume

        scan = _scan(db)
        content = _content()
        content["experiences"][0]["bullets"] = list(reversed(content["experiences"][0]["bullets"]))
        r = client.post("/api/resume-builder/preview-reviewed", json={
            "source_analysis_id": scan.id, "job_description": JD, "job_title": "Backend Engineer", "content": content,
        })
        assert r.status_code == 200, r.text
        assert r.json()["pdf_base64"] and r.json()["page_count"] >= 1
        assert db.query(TailoredResume).count() == 0

    @needs_tectonic
    def test_save_list_download_delete_and_ownership(self, client, db):
        from app.models.tailored_resume import TailoredResume

        scan = _scan(db)
        content = _content()
        # The order the candidate chose while editing is the order saved.
        content["experiences"][0]["bullets"] = list(reversed(content["experiences"][0]["bullets"]))
        r = client.post("/api/resume-builder/saved-tailored", json={
            "source_analysis_id": scan.id, "job_description": JD, "job_title": "Backend Engineer",
            "company": "Acme", "content": content,
        })
        assert r.status_code == 200, r.text
        saved_id = r.json()["id"]
        stored = db.get(TailoredResume, saved_id).resume_text
        first, last = content["experiences"][0]["bullets"][0], content["experiences"][0]["bullets"][-1]
        assert stored.index(first) < stored.index(last)
        assert [row["id"] for row in client.get("/api/resume-builder/saved-tailored").json()] == [saved_id]
        pdf = client.get(f"/api/resume-builder/saved-tailored/{saved_id}/file")
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        # The source scan is a separate row and is untouched.
        db.refresh(scan)
        assert scan.resume_text == RESUME

        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=BOB, email="b@x.com")
        assert client.get(f"/api/resume-builder/saved-tailored/{saved_id}/file").status_code == 404
        assert client.delete(f"/api/resume-builder/saved-tailored/{saved_id}").status_code == 404
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=ALICE, email="a@x.com")
        assert client.delete(f"/api/resume-builder/saved-tailored/{saved_id}").status_code == 204
        assert client.get("/api/resume-builder/saved-tailored").json() == []

    def test_saving_against_someone_elses_scan_is_404(self, client, db):
        scan = _scan(db, user_id=BOB)
        r = client.post("/api/resume-builder/saved-tailored", json={
            "source_analysis_id": scan.id, "job_description": JD, "job_title": "X", "content": _content(),
        })
        assert r.status_code == 404


def test_autofill_route_returns_the_new_sections(client, db):
    scan = _scan(db)
    body = client.get(f"/api/resume-builder/autofill/{scan.id}").json()
    assert [p["name"] for p in body["projects"]] == ["Campus Ride Share", "Recipe Finder"]
    assert body["skill_groups"][0]["category"] == "Languages"
    assert body["certifications"] == ["AWS Certified Cloud Practitioner"]
