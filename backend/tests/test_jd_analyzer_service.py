"""The JD analyzer service: what it asks the model, and everything it checks.

The model is a scripted fake. Nothing here reaches a real one.
"""

import hashlib
import logging

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.llm import LLMProviderError
from app.core.taxonomy import skill_candidates
from app.models import company, job  # noqa: F401 - registered so create_all can build job_listings' foreign key
from app.models.jd_analysis import JDAnalysisRecord
from app.modules.jd_analyzer import cleaning, service
from app.modules.jd_analyzer.schemas import JDAnalysis, Keyword, Requirement, Skill

JD = (
    "Senior Backend Engineer — payments. 6+ years of experience. Deep expertise in at least one of "
    "Go, Java, or Python. Experience with PostgreSQL or MySQL. Nice to have: Kubernetes. "
    "Bachelor's degree in Computer Science or equivalent experience. "
    "Must hold the AWS Certified Solutions Architect certification. "
    "You'll lead the redesign of the ledger service."
)


def skill(name, evidence=None, group=None):
    return {"name": name, "evidence": evidence or name, "alternative_group": group}


def reply(**overrides):
    base = {
        "job_title": "Senior Backend Engineer",
        "seniority": "senior",
        "min_years_experience": 6,
        "required_skills": [
            skill("Go", "Go, Java, or Python", "language"),
            skill("Java", "Go, Java, or Python", "language"),
            skill("Python", "Go, Java, or Python", "language"),
            skill("PostgreSQL", "PostgreSQL or MySQL", "database"),
            skill("MySQL", "PostgreSQL or MySQL", "database"),
        ],
        "preferred_skills": [skill("Kubernetes")],
        "tools_technologies": ["Go", "Java", "Python", "PostgreSQL", "MySQL", "Kubernetes", "AWS"],
        "education": [
            {"name": "Bachelor's degree in Computer Science", "required": True,
             "evidence": "Bachelor's degree in Computer Science or equivalent experience"}
        ],
        "certifications": [
            {"name": "AWS Certified Solutions Architect", "required": True,
             "evidence": "Must hold the AWS Certified Solutions Architect certification"}
        ],
        "responsibilities": ["lead the redesign of the ledger service"],
    }
    base.update(overrides)
    return base


class FakeLLM:
    """Stands in for llm_client. `replies` are returned in order (an exception
    instance is raised instead); the last one repeats."""

    provider = "ollama"
    model = "llama3.1"

    def __init__(self):
        self.available = True
        self.replies = [reply()]
        self.calls: list[dict] = []
        # The second "what did you miss" call is answered and logged on its own.
        self.missed_reply: dict | Exception = {"required_skills": [], "preferred_skills": [], "tools_technologies": []}
        self.missed_calls: list[dict] = []

    def complete_tool_json(self, system, user, tool_name, schema, max_tokens=1500):
        if tool_name == service.MISSED_TOOL_NAME:
            self.missed_calls.append({"system": system, "user": user, "schema": schema})
            if isinstance(self.missed_reply, Exception):
                raise self.missed_reply
            return self.missed_reply
        self.calls.append({"system": system, "user": user, "tool": tool_name, "schema": schema, "max_tokens": max_tokens})
        index = min(len(self.calls) - 1, len(self.replies) - 1)
        item = self.replies[index]
        if isinstance(item, Exception):
            raise item
        return item

    def complete_json(self, *a, **k):
        raise AssertionError("the JD analyzer must never use complete_json")


@pytest.fixture
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(service, "llm_client", fake)
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


# --- what is asked ----------------------------------------------------------


class TestTheCall:
    def test_one_schema_constrained_call_with_the_tool_name_and_an_output_budget(self, llm):
        service.analyze(JD)
        assert len(llm.calls) == 1
        call = llm.calls[0]
        assert call["tool"] == service.TOOL_NAME
        assert call["schema"] is service.LLM_SCHEMA
        assert call["max_tokens"] == service.MAX_OUTPUT_TOKENS
        assert call["user"].startswith("JOB POSTING:\n") and "Senior Backend Engineer" in call["user"]

    def test_the_model_sees_the_cleaned_text_not_the_markup_or_boilerplate(self, llm):
        html = "<h2>Data Engineer</h2><p>Python required.</p><h3>Benefits</h3><ul><li>Free lunch</li></ul><p>We are an equal opportunity employer.</p>"
        service.analyze(html)
        sent = llm.calls[0]["user"]
        assert "<" not in sent and "Free lunch" not in sent and "equal opportunity" not in sent
        assert "Python required." in sent

    def test_the_schema_asks_for_every_field(self):
        assert set(service.LLM_SCHEMA["required"]) == set(service.LLM_SCHEMA["properties"])

    def test_the_prompt_forbids_inventing_and_asks_for_the_shortest_exact_quote(self):
        assert "report only what its text states" in service.SYSTEM_PROMPT
        assert "SHORTEST exact phrase" in service.SYSTEM_PROMPT

    def test_complete_json_is_never_used(self, llm):
        service.analyze(JD)  # FakeLLM.complete_json raises if touched

    def test_max_chars_per_call_follows_the_context_window(self, monkeypatch):
        monkeypatch.setattr(service.settings, "OLLAMA_NUM_CTX", 8192)
        small = service.max_chars_per_call()
        monkeypatch.setattr(service.settings, "OLLAMA_NUM_CTX", 16384)
        assert service.max_chars_per_call() > small >= 4000


# --- the happy path ---------------------------------------------------------


class TestAnalysis:
    def test_a_valid_reply_becomes_a_checked_analysis(self, llm):
        a = service.analyze(JD)
        assert a.source == "llm"
        assert a.job_title == "Senior Backend Engineer"
        assert (a.seniority, a.seniority_source) == ("senior", "stated")
        assert a.min_years_experience == 6
        assert [s.name for s in a.required_skills] == ["go", "java", "python", "postgresql", "mysql"]
        assert [s.name for s in a.preferred_skills] == ["kubernetes"]
        assert a.responsibilities == ["lead the redesign of the ledger service"]
        assert {k.term for k in a.ats_keywords} >= {"go", "python", "kubernetes", "backend engineer"}

    def test_names_are_canonical_and_evidence_is_kept_as_quoted(self, llm):
        llm.replies = [reply(required_skills=[skill("PostgreSQL", "PostgreSQL or MySQL"), skill("MySQL", "PostgreSQL or MySQL")], preferred_skills=[])]
        a = service.analyze(JD)
        assert [s.evidence for s in a.required_skills] == ["PostgreSQL or MySQL", "PostgreSQL or MySQL"]

    def test_education_and_certifications_get_their_required_flag_from_the_wording(self, llm):
        a = service.analyze(JD)
        assert [(e.name, e.required) for e in a.education] == [("Bachelor's degree in Computer Science", False)]
        assert [(c.name, c.required) for c in a.certifications] == [("AWS Certified Solutions Architect", True)]

    def test_a_requirement_whose_quote_is_not_in_the_posting_is_dropped(self, llm):
        llm.replies = [reply(certifications=[{"name": "PMP", "required": True, "evidence": "PMP certification required"}])]
        a, report = service.analyze_with_report(JD)
        assert "PMP" not in [c.name for c in a.certifications]
        assert any("PMP" in d for d in report.dropped_by_evidence)
        # The certification the posting really names is back-filled from the pattern rules.
        assert [c.name for c in a.certifications] == ["AWS Certified Solutions Architect"]

    def test_the_analysis_validates_as_a_JDAnalysis(self, llm):
        a = service.analyze(JD)
        assert JDAnalysis.model_validate(a.model_dump()) == a


# --- checking what the model said ------------------------------------------


class TestChecks:
    def test_a_skill_whose_quote_is_not_in_the_posting_is_dropped_and_reported(self, llm):
        llm.replies = [reply(required_skills=[skill("Rust", "Rust expertise"), skill("Python", "Go, Java, or Python")], preferred_skills=[])]
        a, report = service.analyze_with_report(JD)
        assert [s.name for s in a.required_skills] == ["python"]
        assert any("rust" in d and "not in the posting" in d for d in report.dropped_by_evidence)

    def test_a_real_quote_that_does_not_name_the_skill_is_dropped(self, llm):
        llm.replies = [reply(required_skills=[skill("Docker", "Bachelor's degree in Computer Science")], preferred_skills=[])]
        a, report = service.analyze_with_report(JD)
        assert a.required_skills == []
        assert any("does not name it" in d for d in report.dropped_by_evidence)

    def test_the_job_title_is_never_a_skill(self, llm):
        llm.replies = [reply(
            required_skills=[skill("Backend Engineer", "Backend Engineer"), skill("Senior Backend Engineer", "Senior Backend Engineer"), skill("Python", "Go, Java, or Python")],
            preferred_skills=[], tools_technologies=["Backend Engineer", "Python"],
        )]
        a, report = service.analyze_with_report(JD)
        names = [s.name for s in a.required_skills + a.preferred_skills]
        assert "python" in [s.name for s in a.required_skills]
        assert "backend engineer" not in names and "senior backend engineer" not in names
        assert "backend engineer" not in a.tools_technologies
        assert "backend engineer" in report.title_leaks

    def test_a_tool_the_posting_never_names_is_dropped(self, llm):
        llm.replies = [reply(tools_technologies=["Python", "Terraform"])]
        a, report = service.analyze_with_report(JD)
        assert a.tools_technologies == ["python"] and report.unsupported_tools == ["terraform"]

    def test_a_skill_in_both_lists_is_required_only(self, llm):
        llm.replies = [reply(required_skills=[skill("Python", "Go, Java, or Python")], preferred_skills=[skill("Python", "Go, Java, or Python")])]
        a = service.analyze(JD)
        assert [s.name for s in a.required_skills] == ["python"] and a.preferred_skills == []

    def test_a_required_skill_whose_sentence_says_it_is_a_plus_is_preferred(self, llm):
        llm.replies = [reply(required_skills=[skill("Kubernetes"), skill("Python", "Go, Java, or Python")], preferred_skills=[])]
        a = service.analyze(JD)
        assert [s.name for s in a.required_skills] == ["python"]
        assert "kubernetes" in [s.name for s in a.preferred_skills]

    def test_duplicates_are_removed(self, llm):
        llm.replies = [reply(required_skills=[skill("Python", "Go, Java, or Python")] * 3, preferred_skills=[])]
        assert [s.name for s in service.analyze(JD).required_skills] == ["python"]

    def test_responsibilities_are_trimmed_deduplicated_and_capped(self, llm):
        long = "x " * 150
        llm.replies = [reply(responsibilities=["  lead the redesign  ", "Lead the redesign", "", long] + [f"duty {i}" for i in range(15)])]
        r = service.analyze(JD).responsibilities
        assert r[0] == "lead the redesign" and len(r) == 10 and long.strip() not in r


class TestSeniorityAndYears:
    def test_a_stated_level_beats_the_models(self, llm):
        llm.replies = [reply(seniority="junior")]
        a = service.analyze(JD)
        assert (a.seniority, a.seniority_source) == ("senior", "stated")

    def test_no_level_word_maps_the_years(self, llm):
        text = "AI Engineer — applied AI team. 3-4 years of experience with LLM APIs. Strong Python skills."
        llm.replies = [reply(job_title="AI Engineer", seniority="unknown", min_years_experience=3, required_skills=[skill("Python", "Python")], preferred_skills=[], tools_technologies=["Python"], education=[], certifications=[], responsibilities=[])]
        a = service.analyze(text)
        assert (a.seniority, a.seniority_source) == ("mid", "years") and a.min_years_experience == 3

    def test_entry_level_and_staff_map_in_code(self, llm):
        llm.replies = [reply(job_title="Software Engineer", seniority="unknown", min_years_experience=None, required_skills=[], preferred_skills=[], tools_technologies=[], education=[], certifications=[], responsibilities=[])]
        assert service.analyze("Software Engineer. This is an entry level role.").seniority == "junior"
        service.clear_cache()
        assert service.analyze("Staff Engineer. Own the platform architecture for our team.").seniority == "lead"

    def test_nothing_stated_is_unknown(self, llm):
        llm.replies = [reply(job_title="Engineer", seniority="senior", min_years_experience=None, required_skills=[], preferred_skills=[], tools_technologies=[], education=[], certifications=[], responsibilities=[])]
        a = service.analyze("Engineer. Join our friendly team and build things people love.")
        assert (a.seniority, a.seniority_source, a.min_years_experience) == ("unknown", "unknown", None)

    def test_a_years_figure_the_text_does_not_contain_is_replaced(self, llm):
        llm.replies = [reply(min_years_experience=12)]
        assert service.analyze(JD).min_years_experience == 6

    def test_a_missing_years_figure_is_read_from_the_text(self, llm):
        llm.replies = [reply(min_years_experience=None)]
        assert service.analyze(JD).min_years_experience == 6

    def test_a_title_the_text_does_not_contain_is_replaced(self, llm):
        llm.replies = [reply(job_title="Principal Wizard")]
        assert service.analyze(JD).job_title == "Senior Backend Engineer"


class TestAlternativeGroups:
    def test_groups_are_assigned_in_code_even_if_the_model_gave_none(self, llm):
        llm.replies = [reply(required_skills=[skill(n, "Go, Java, or Python") for n in ("Go", "Java", "Python")], preferred_skills=[])]
        groups = {s.name: s.alternative_group for s in service.analyze(JD).required_skills}
        assert len(set(groups.values())) == 1 and next(iter(groups.values())).startswith("any-of:")

    def test_the_models_label_is_kept_for_a_real_group(self, llm):
        groups = {s.name: s.alternative_group for s in service.analyze(JD).required_skills}
        assert groups["go"] == groups["java"] == groups["python"] == "language"
        assert groups["postgresql"] == groups["mysql"] == "database"

    def test_a_label_on_a_skill_that_has_no_alternatives_is_cleared(self, llm):
        llm.replies = [reply(required_skills=[skill("Python", "Go, Java, or Python", "language"), skill("PostgreSQL", "PostgreSQL or MySQL", "database")], preferred_skills=[])]
        groups = {s.name: s.alternative_group for s in service.analyze(JD).required_skills}
        assert groups == {"python": None, "postgresql": None}  # each is alone: the other alternatives were not reported


class TestValidators:
    def test_generic_names_and_soft_skills_are_rejected_and_reported(self, llm):
        text = "Software Engineer. Strong communication skills. Python required. Any language or framework you like."
        llm.replies = [reply(
            job_title="Software Engineer", seniority="unknown", min_years_experience=None,
            required_skills=[skill("language", "language"), skill("framework", "framework"), skill("Python", "Python")],
            preferred_skills=[skill("communication skills", "communication skills")],
            tools_technologies=[], education=[], certifications=[], responsibilities=[],
        )]
        a, report = service.analyze_with_report(text)
        assert [s.name for s in a.required_skills] == ["python"]
        assert "communication skills" not in [s.name for s in a.preferred_skills]
        assert {"language (generic name)", "framework (generic name)", "communication skills (soft skill)"} <= set(report.rejected)
        assert not any("language" in d for d in report.dropped_by_evidence)  # rejected, not an evidence failure

    def test_an_education_item_must_be_about_a_degree(self, llm):
        text = "Junior Engineer. CS fundamentals are required. A Bachelor's degree is a plus."
        llm.replies = [reply(
            job_title="Junior Engineer", seniority="junior", min_years_experience=None, required_skills=[], preferred_skills=[],
            tools_technologies=[], certifications=[], responsibilities=[],
            education=[
                {"name": "CS fundamentals", "required": True, "evidence": "CS fundamentals"},
                {"name": "Bachelor's degree", "required": True, "evidence": "A Bachelor's degree is a plus"},
            ],
        )]
        a, report = service.analyze_with_report(text)
        assert [(e.name, e.required) for e in a.education] == [("Bachelor's degree", False)]
        assert "CS fundamentals (not a degree)" in report.rejected

    def test_a_certification_must_look_like_one(self, llm):
        text = "Security Engineer. Security certifications (Security+, or coursework) are a plus but not required."
        llm.replies = [reply(
            job_title="Security Engineer", seniority="unknown", min_years_experience=None, required_skills=[], preferred_skills=[],
            tools_technologies=[], education=[], responsibilities=[],
            certifications=[
                {"name": "Security+", "required": False, "evidence": "Security certifications (Security+, or coursework) are a plus but not required"},
                {"name": "coursework", "required": False, "evidence": "or coursework"},
            ],
        )]
        a, report = service.analyze_with_report(text)
        assert [(c.name, c.required) for c in a.certifications] == [("Security+", False)]
        assert "coursework (not a certification)" in report.rejected

    def test_a_certification_the_model_missed_is_back_filled_with_the_wording_deciding_required(self, llm):
        text = "Platform Engineer. Must hold the AWS Certified Solutions Architect certification. Certified Kubernetes Administrator (CKA) is a plus."
        llm.replies = [reply(
            job_title="Platform Engineer", seniority="unknown", min_years_experience=None, required_skills=[], preferred_skills=[skill("CKA")],
            tools_technologies=[], education=[], certifications=[], responsibilities=[],
        )]
        a, report = service.analyze_with_report(text)
        assert {c.name: c.required for c in a.certifications} == {
            "AWS Certified Solutions Architect": True, "Certified Kubernetes Administrator": False,
        }
        assert a.source == "hybrid" and any("certification: " in r for r in report.rule_additions)

    def test_a_certification_the_model_already_has_is_not_added_twice(self, llm):
        a = service.analyze(JD)  # the reply already lists the AWS certification
        assert [c.name for c in a.certifications] == ["AWS Certified Solutions Architect"]


class TestTrimmedNames:
    def test_a_trailing_tools_or_pipelines_is_trimmed_and_rag_is_canonical(self, llm):
        text = "Security Engineer. Familiarity with static analysis tools. Experience with RAG pipelines. Experience building data pipelines."
        llm.replies = [reply(
            job_title="Security Engineer", seniority="unknown", min_years_experience=None,
            required_skills=[skill("static analysis tools"), skill("RAG pipelines", "RAG pipelines"), skill("data pipelines")],
            preferred_skills=[], tools_technologies=["static analysis tools"], education=[], certifications=[], responsibilities=[],
        )]
        a = service.analyze(text)
        names = [s.name for s in a.required_skills]
        assert names == ["static analysis", "retrieval augmented generation", "data pipelines"]
        assert a.required_skills[0].evidence == "static analysis tools"  # the quote stays as written
        assert a.tools_technologies == ["static analysis"]


class TestRulesBackstop:
    def test_a_term_the_rules_find_goes_where_its_sentence_wording_puts_it(self, llm):
        llm.replies = [reply(tools_technologies=["Python"])]  # AWS is in the posting; the model left it out
        a, report = service.analyze_with_report(JD)
        # "Must hold the AWS Certified ..." is requirement wording.
        assert a.source == "hybrid" and report.rule_additions == ["aws (required)"]
        added = next(s for s in a.required_skills if s.name == "aws")
        assert added.evidence == "AWS"

    def test_nothing_missed_means_source_llm(self, llm):
        assert service.analyze(JD).source == "llm"

    def test_a_skill_the_model_called_a_tool_is_not_promoted_by_the_rules(self, llm):
        llm.replies = [reply()]  # tools include "AWS"
        assert "aws" not in [s.name for s in service.analyze(JD).preferred_skills]


# --- when the model fails ---------------------------------------------------


class TestConceptMerge:
    TEXT = (
        "Backend Engineer. Strong understanding of distributed systems and message queues. "
        "Experience with Python. Familiarity with load balancing is a plus. We value code review."
    )

    def _reply(self):
        return reply(
            job_title="Backend Engineer", seniority="unknown", min_years_experience=None,
            required_skills=[skill("Python")], preferred_skills=[], tools_technologies=["Python"],
            education=[], certifications=[], responsibilities=[],
        )

    def test_concepts_the_model_missed_are_added_by_the_wording_of_their_sentence(self, llm):
        llm.replies = [self._reply()]
        a, report = service.analyze_with_report(self.TEXT)
        required = {s.name for s in a.required_skills}
        preferred = {s.name for s in a.preferred_skills}
        assert {"distributed systems", "message queues"} <= required  # "Strong understanding of"
        assert "load balancing" in preferred  # "is a plus"
        assert "code review" in preferred  # neither wording: preferred
        assert a.source == "hybrid"
        assert "distributed systems (required)" in report.rule_additions

    def test_rule_found_quotes_are_verbatim(self, llm):
        from app.modules.job_market.enrichment import quote_in_text

        llm.replies = [self._reply()]
        a = service.analyze(self.TEXT)
        assert all(quote_in_text(s.evidence, self.TEXT) for s in a.required_skills + a.preferred_skills)

    def test_a_concept_the_model_already_has_is_not_added_twice(self, llm):
        r = self._reply()
        r["required_skills"].append(skill("distributed systems"))
        llm.replies = [r]
        a = service.analyze(self.TEXT)
        names = [s.name for s in a.required_skills + a.preferred_skills]
        assert names.count("distributed systems") == 1


class TestEnvironmentOnlyInTheAnalysis:
    def test_a_platform_named_only_as_where_the_work_runs_becomes_a_tool(self, llm):
        text = "Senior Data Scientist. Strong Python. You'll own deployment on AWS SageMaker."
        llm.replies = [reply(
            job_title="Senior Data Scientist", seniority="senior", min_years_experience=None,
            required_skills=[skill("Python"), skill("AWS SageMaker")], preferred_skills=[],
            tools_technologies=["Python"], education=[], certifications=[], responsibilities=[],
        )]
        a, report = service.analyze_with_report(text)
        assert "aws sagemaker" not in [s.name for s in a.required_skills + a.preferred_skills]
        assert "aws sagemaker" in a.tools_technologies and report.moved_to_tools == ["aws sagemaker"]

    def test_a_concept_stays_a_skill(self, llm):
        text = "Data Scientist. Strong model monitoring in production deployment on our platform."
        llm.replies = [reply(
            job_title="Data Scientist", seniority="unknown", min_years_experience=None,
            required_skills=[skill("model monitoring")], preferred_skills=[], tools_technologies=[],
            education=[], certifications=[], responsibilities=[],
        )]
        assert "model monitoring" in [s.name for s in service.analyze(text).required_skills]


class TestFallback:
    def test_a_provider_failure_gives_the_rules_analysis_and_is_not_cached(self, llm):
        llm.replies = [LLMProviderError("Ollama is down", "unreachable")]
        a, report = service.analyze_with_report(JD)
        assert a.source == "rules" and "unreachable" not in "" and "Ollama is down" in report.llm_error
        service.analyze(JD)
        assert len(llm.calls) == 2  # the model is tried again, not remembered as failed

    def test_an_invalid_reply_is_re_asked_with_the_problem_named(self, llm):
        llm.replies = [{"job_title": "X"}, reply()]
        a, report = service.analyze_with_report(JD)
        assert a.source == "llm" and report.attempts == 2
        assert "rejected" in llm.calls[1]["user"] and "seniority" in llm.calls[1]["user"]
        assert "rejected" not in llm.calls[0]["user"]

    def test_still_invalid_after_the_retries_falls_back_to_rules(self, llm, monkeypatch):
        monkeypatch.setattr(service.settings, "OLLAMA_MAX_RETRIES", 2)
        llm.replies = [{"job_title": "X"}]
        a, report = service.analyze_with_report(JD)
        assert a.source == "rules" and len(llm.calls) == 3 and "invalid reply" in report.llm_error

    def test_a_reply_that_is_valid_json_but_not_an_analysis_is_not_read_as_an_empty_one(self, llm):
        llm.replies = [{"is_resume": True, "matched_skills": [], "suggestions": []}]  # a resume scan's shape
        assert service.analyze(JD).source == "rules"

    def test_an_unexpected_exception_is_logged_and_never_raised(self, llm, caplog):
        llm.replies = [TypeError("a bug in a fake")]
        with caplog.at_level(logging.WARNING, logger="app.modules.jd_analyzer.service"):
            a, report = service.analyze_with_report(JD)
        assert a.source == "rules" and report.llm_error and any("jd analysis" in r.getMessage() for r in caplog.records)

    def test_no_model_means_the_rules_analysis_without_a_call(self, llm):
        llm.available = False
        a, report = service.analyze_with_report(JD)
        assert a.source == "rules" and llm.calls == [] and report.llm_error == "no model available"

    def test_the_rules_analysis_still_reads_the_posting(self, llm):
        llm.available = False
        a = service.analyze(JD)
        assert a.job_title == "Senior Backend Engineer" and a.seniority == "senior" and a.min_years_experience == 6

    def test_a_posting_too_short_to_analyse_is_not_sent(self, llm):
        service.analyze("Engineer")
        assert llm.calls == []


# --- long postings ----------------------------------------------------------


class TestSplitting:
    def test_a_posting_over_the_window_is_split_and_the_answers_merged(self, llm, monkeypatch):
        monkeypatch.setattr(service, "max_chars_per_call", lambda: 140)
        text = (
            "Senior Backend Engineer\n"
            "Requirements: Python and PostgreSQL experience with distributed services.\n"
            "Nice to have: Kubernetes knowledge for the platform team here.\n"
            "6+ years of experience building payment systems."
        )
        llm.replies = [
            reply(required_skills=[skill("Python")], preferred_skills=[], tools_technologies=["Python"], education=[], certifications=[], responsibilities=[]),
            reply(job_title="", seniority="unknown", min_years_experience=None, required_skills=[skill("PostgreSQL")], preferred_skills=[], tools_technologies=[], education=[], certifications=[], responsibilities=[]),
            reply(job_title="", seniority="unknown", min_years_experience=None, required_skills=[], preferred_skills=[skill("Kubernetes")], tools_technologies=[], education=[], certifications=[], responsibilities=[]),
            reply(job_title="", seniority="unknown", min_years_experience=6, required_skills=[], preferred_skills=[], tools_technologies=[], education=[], certifications=[], responsibilities=[]),
        ]
        a, report = service.analyze_with_report(text)
        assert report.chunks == len(llm.calls) >= 2
        assert {"python", "postgresql"} <= {s.name for s in a.required_skills}
        assert "kubernetes" in {s.name for s in a.preferred_skills}
        assert a.job_title == "Senior Backend Engineer" and a.min_years_experience == 6
        # Each call saw only its own part of the posting.
        assert all(len(c["user"]) < len(text) + 20 for c in llm.calls)


# --- cache ------------------------------------------------------------------


class TestCache:
    def test_the_same_cleaned_text_is_analysed_once(self, llm):
        service.analyze(JD)
        second, report = service.analyze_with_report("<p>" + JD + "</p>")  # markup cleans away: same text
        assert len(llm.calls) == 1 and report.cached == "memory" and second.source == "llm"

    def test_different_text_is_analysed_again(self, llm):
        service.analyze(JD)
        service.analyze(JD + " Also: Terraform.")
        assert len(llm.calls) == 2

    def test_use_cache_false_bypasses_it(self, llm):
        service.analyze(JD)
        service.analyze_with_report(JD, use_cache=False)
        assert len(llm.calls) == 2

    def test_a_cached_result_is_a_copy(self, llm):
        service.analyze(JD).required_skills.clear()
        assert service.analyze(JD).required_skills

    def test_the_key_is_the_sha256_of_the_cleaned_text(self):
        assert service.jd_hash(cleaning.clean_jd(JD)) == hashlib.sha256(cleaning.clean_jd(JD).encode()).hexdigest()

    def test_memory_is_bounded(self, llm, monkeypatch):
        monkeypatch.setattr(service, "MEMORY_CACHE_SIZE", 2)
        for i in range(3):
            service.analyze(f"{JD} Variant {i}.")
        assert len(service._memory) == 2


class TestDatabaseCache:
    def test_an_analysis_is_stored_and_found_again_after_memory_is_gone(self, llm, db):
        service.analyze(JD, db=db)
        row = db.query(JDAnalysisRecord).one()
        assert row.jd_hash == service.jd_hash(cleaning.clean_jd(JD))
        assert (row.source, row.model, row.analyzer_version) == ("llm", "llama3.1", service.ANALYZER_VERSION)
        assert row.analysis["job_title"] == "Senior Backend Engineer"

        service.clear_cache()
        again, report = service.analyze_with_report(JD, db=db)
        assert report.cached == "db" and len(llm.calls) == 1 and again.source == "llm"
        assert db.query(JDAnalysisRecord).count() == 1

    def test_a_rules_row_is_never_served(self, llm, db):
        db.add(JDAnalysisRecord(jd_hash=service.jd_hash(cleaning.clean_jd(JD)), analysis=JDAnalysis().model_dump(mode="json"), source="rules", analyzer_version=service.ANALYZER_VERSION))
        db.commit()
        service.analyze(JD, db=db)
        assert len(llm.calls) == 1

    def test_a_rules_result_is_not_stored(self, llm, db):
        llm.available = False
        service.analyze(JD, db=db)
        assert db.query(JDAnalysisRecord).count() == 0

    def test_an_older_analyzer_version_is_not_served(self, llm, db):
        service.analyze(JD, db=db)
        db.query(JDAnalysisRecord).update({"analyzer_version": service.ANALYZER_VERSION - 1})
        db.commit()
        service.clear_cache()
        service.analyze(JD, db=db)
        assert len(llm.calls) == 2

    def test_a_listing_id_links_the_row_and_a_second_listing_gets_its_own(self, llm, db):
        service.analyze(JD, db=db, job_listing_id=7)
        service.analyze(JD, db=db, job_listing_id=7)
        service.analyze(JD, db=db, job_listing_id=8)
        assert sorted(r.job_listing_id for r in db.query(JDAnalysisRecord)) == [7, 8]
        assert len(llm.calls) == 1

    def test_a_stored_row_that_no_longer_validates_is_re_analysed(self, llm, db):
        db.add(JDAnalysisRecord(jd_hash=service.jd_hash(cleaning.clean_jd(JD)), analysis={"seniority": "wizard"}, source="llm", analyzer_version=service.ANALYZER_VERSION))
        db.commit()
        assert service.analyze(JD, db=db).source == "llm" and len(llm.calls) == 1


# --- the older keyword list, derived ---------------------------------------


class TestKeywords:
    def test_with_a_rules_only_analysis_the_callers_own_function_gives_the_list(self, llm):
        llm.available = False
        assert service.keywords_for(JD, skill_candidates) == skill_candidates(JD)
        assert service.keywords_for(JD, lambda t: ["custom"]) == ["custom"]

    def test_with_a_model_analysis_it_is_required_then_preferred_then_tools(self, llm):
        keywords = service.keywords_for(JD)
        assert keywords[:5] == ["Go", "Java", "Python", "PostgreSQL", "MySQL"]
        assert keywords.index("Kubernetes") > keywords.index("MySQL")
        assert "aws" in keywords  # a named tool that is not a skill still joins the list

    def test_a_term_is_shown_as_the_posting_wrote_it(self, llm):
        text = "Platform Engineer. Strong CI/CD pipelines experience with Node.js services."
        llm.replies = [reply(job_title="Platform Engineer", seniority="unknown", min_years_experience=None, required_skills=[skill("CI/CD"), skill("Node.js")], preferred_skills=[], tools_technologies=[], education=[], certifications=[], responsibilities=[])]
        assert service.keywords_for(text)[:2] == ["CI/CD", "Node.js"]

    def test_peek_never_calls_the_model(self, llm):
        assert service.peek(JD) is None
        assert service.keywords_peek(JD, lambda t: ["fallback"]) == ["fallback"]
        assert llm.calls == []

    def test_peek_uses_an_analysis_that_exists(self, llm):
        service.analyze(JD)
        assert service.peek(JD).job_title == "Senior Backend Engineer"
        assert service.keywords_peek(JD, lambda t: ["fallback"])[0] == "Go"
        assert len(llm.calls) == 1

    def test_peek_finds_a_stored_analysis_in_the_database(self, llm, db):
        service.analyze(JD, db=db)
        service.clear_cache()
        assert service.peek(JD, db=db) is not None and len(llm.calls) == 1

    def test_an_empty_posting_falls_back_without_analysing(self, llm):
        assert service.keywords_for("", lambda t: ["f"]) == ["f"] and llm.calls == []

    def test_structured_summary(self, llm):
        summary = service.structured_summary(service.analyze(JD))
        assert "Title: Senior Backend Engineer" in summary and "Level: senior" in summary
        assert "Minimum years of experience: 6" in summary and "Required: go, java" in summary
        assert "AWS Certified Solutions Architect (required)" in summary


# --- the schema's own rules -------------------------------------------------


class TestSchema:
    def test_responsibilities_are_capped_at_ten(self):
        with pytest.raises(ValidationError):
            JDAnalysis(responsibilities=["x"] * 11)

    def test_keyword_weights_are_between_zero_and_one(self):
        with pytest.raises(ValidationError):
            Keyword(term="a", weight=1.5)
        with pytest.raises(ValidationError):
            Keyword(term="a", weight=-0.1)

    def test_a_skill_needs_a_name_and_a_quote(self):
        with pytest.raises(ValidationError):
            Skill(name="python", evidence="")
        with pytest.raises(ValidationError):
            Skill(name="", evidence="Python")

    def test_a_requirement_carries_the_flag_and_a_quote(self):
        with pytest.raises(ValidationError):
            Requirement(name="PMP", evidence="PMP")  # required is not optional

    def test_an_unknown_level_cannot_claim_a_source(self):
        with pytest.raises(ValidationError):
            JDAnalysis(seniority="unknown", seniority_source="stated")
        assert JDAnalysis(seniority="mid", seniority_source="years").seniority == "mid"

    def test_levels_and_sources_are_closed_sets(self):
        for bad in ({"seniority": "wizard"}, {"source": "magic"}, {"seniority_source": "guess"}):
            with pytest.raises(ValidationError):
                JDAnalysis(**bad)

    def test_min_years_is_not_negative(self):
        with pytest.raises(ValidationError):
            JDAnalysis(min_years_experience=-1)


# --- the second "what did you miss" call ------------------------------------


class TestSecondCall:
    def test_it_is_shown_the_posting_and_what_was_found(self, llm):
        service.analyze(JD)
        assert len(llm.missed_calls) == 1
        call = llm.missed_calls[0]
        assert call["system"] == service.MISSED_PROMPT and call["schema"] is service.MISSED_SCHEMA
        assert call["user"].startswith("JOB POSTING:\n") and "ALREADY FOUND (do not repeat): " in call["user"]
        assert "postgresql" in call["user"] and "kubernetes" in call["user"]

    def test_what_it_adds_goes_through_the_same_checks(self, llm):
        llm.missed_reply = {
            "required_skills": [
                skill("ledger service design", "redesign of the ledger service"),  # quote not verbatim
                skill("Rust"),  # not in the posting
                skill("Senior Backend Engineer"),  # the title
                skill("communication"),  # a soft skill
                skill("Python", "Go, Java, or Python"),  # already found
            ],
            "preferred_skills": [],
            "tools_technologies": ["Terraform"],  # not in the posting
        }
        analysis, report = service.analyze_with_report(JD, use_cache=False)
        names = {s.name for s in analysis.required_skills + analysis.preferred_skills} | set(analysis.tools_technologies)
        assert not {"rust", "terraform", "communication", "senior backend engineer", "ledger service design"} & names
        assert report.second_call_added == []
        assert analysis.ats_keywords  # still a whole analysis

    def test_a_real_miss_is_added(self, llm):
        # "ledger service" is in the posting, and neither the first answer nor the rules found it.
        llm.missed_reply = {"required_skills": [skill("ledger service")], "preferred_skills": [], "tools_technologies": []}
        analysis, report = service.analyze_with_report(JD, use_cache=False)
        assert "ledger service" in {s.name for s in analysis.required_skills}
        assert report.second_call_added == ["ledger service"]
        assert report.attempts == 1 and report.second_call_attempts == 1

    def test_a_miss_is_placed_by_the_jd_not_by_the_model(self, llm):
        text = "Data Engineer. Requirements:\nSQL and Airflow\nNice to have:\nExperience with dbt\n"
        llm.replies = [reply(job_title="Data Engineer", required_skills=[skill("SQL")], preferred_skills=[],
                             tools_technologies=["SQL"], education=[], certifications=[])]
        llm.missed_reply = {"required_skills": [skill("dbt")], "preferred_skills": [], "tools_technologies": []}
        analysis, _ = service.analyze_with_report(text, use_cache=False)
        assert "dbt" in {s.name for s in analysis.preferred_skills}

    def test_a_failed_second_call_keeps_the_first_answer(self, llm):
        llm.missed_reply = LLMProviderError("timed out", kind="timeout")
        analysis, report = service.analyze_with_report(JD, use_cache=False)
        assert analysis.source in ("llm", "hybrid")
        assert report.second_call_error and report.llm_error is None
        assert {"go", "java", "python"} <= {s.name for s in analysis.required_skills}

    def test_it_never_runs_on_a_cache_hit(self, llm):
        service.analyze(JD)
        service.analyze(JD)
        assert len(llm.calls) == 1 and len(llm.missed_calls) == 1


# --- a crawled listing's text ------------------------------------------------


class TestListingText:
    def test_the_title_goes_first(self):
        assert service.listing_text("Software Engineer, New Grad", "We build things.") == (
            "Software Engineer, New Grad\n\nWe build things."
        )

    def test_a_description_that_opens_with_the_title_is_left_alone(self):
        body = "Software Engineer, New Grad\n\nWe build things."
        assert service.listing_text("Software Engineer,  New Grad", body) == body
        html = "<h2>Data Engineer</h2><p>Python required.</p>"
        assert service.listing_text("Data Engineer", html) == html

    def test_no_title_means_the_description_alone(self):
        assert service.listing_text(None, "We build things.") == "We build things."
        assert service.listing_text("  ", "We build things.") == "We build things."

    def test_a_level_word_in_the_title_is_stated_and_beats_the_years(self, llm):
        llm.replies = [reply(job_title="Software Engineer, New Grad", seniority="unknown", min_years_experience=None)]
        text = service.listing_text("Software Engineer, New Grad", "You have 3+ years of Python. " + JD.split(". ", 1)[1])
        analysis = service.analyze(text)
        assert (analysis.job_title, analysis.seniority, analysis.seniority_source) == (
            "Software Engineer, New Grad", "junior", "stated",
        )


class TestSecondCallFilter:
    def test_field_words_categories_and_domains_from_the_second_call_are_dropped(self, llm):
        text = JD + " We serve the payments industry and fintech customers with cloud software."
        llm.missed_reply = {
            "required_skills": [skill("cloud"), skill("software"), skill("fintech"), skill("payments industry"), skill("payments")],
            "preferred_skills": [skill("AI", "ledger")],
            "tools_technologies": ["fintech"],
        }
        analysis, report = service.analyze_with_report(text, use_cache=False)
        names = {s.name for s in analysis.required_skills + analysis.preferred_skills} | set(analysis.tools_technologies)
        assert not {"cloud", "software", "fintech", "payments industry", "payments", "ai"} & names
        assert any("(second call: category or domain)" in r for r in report.rejected)

    @pytest.mark.parametrize("name,dropped", [
        ("cloud", True), ("AI", True), ("data", True), ("tools", True), ("hr tech", True), ("fintech", True),
        ("healthcare", True), ("retail industry", True), ("customer support", True),
        ("cloud security", False), ("data modeling", False), ("Kubernetes", False), ("machine learning", False),
        ("SaaS", False), ("A/B testing", False),
    ])
    def test_the_categories(self, name, dropped):
        from app.modules.jd_analyzer import rules

        assert rules.is_category_or_domain(name) is dropped


# --- replies cut off at the output cap ---------------------------------------


class TestTruncation:
    def test_a_cut_off_first_call_falls_back_to_rules_without_re_asking(self, llm):
        llm.replies = [LLMProviderError("cut off", kind="truncated")]
        analysis, report = service.analyze_with_report(JD, use_cache=False)
        assert analysis.source == "rules" and len(llm.calls) == 1 and llm.missed_calls == []
        assert "cut off" in report.llm_error

    def test_a_cut_off_second_call_keeps_the_first_answer(self, llm):
        llm.missed_reply = LLMProviderError("cut off", kind="truncated")
        analysis, report = service.analyze_with_report(JD, use_cache=False)
        assert analysis.source in ("llm", "hybrid") and report.llm_error is None
        assert "cut off" in report.second_call_error and len(llm.missed_calls) == 1

    def test_a_cut_off_chunk_is_left_out_and_the_others_kept(self, llm, monkeypatch):
        monkeypatch.setattr(service, "max_chars_per_call", lambda: 4000)
        long_jd = JD + "\n\n" + ("Our team builds payment systems for merchants worldwide. " * 120)
        assert len(cleaning.split_sections(cleaning.clean_jd(long_jd), 4000)) == 2
        llm.replies = [reply(), LLMProviderError("cut off", kind="truncated")]
        analysis, report = service.analyze_with_report(long_jd, use_cache=False)
        assert analysis.source in ("llm", "hybrid") and report.llm_error is None
        assert {"go", "java", "python"} <= {s.name for s in analysis.required_skills}

    def test_other_failures_still_fall_back_as_before(self, llm):
        llm.replies = [LLMProviderError("down", kind="unreachable")]
        analysis, _ = service.analyze_with_report(JD, use_cache=False)
        assert analysis.source == "rules"


class TestHeadingRule:
    def test_a_heading_proposed_as_a_skill_is_dropped(self, llm):
        text = JD + "\n\nOUR VALUES\n\nTrust and craft.\n"
        llm.replies = [reply(preferred_skills=[skill("Kubernetes"), skill("our values", "OUR VALUES")])]
        analysis, report = service.analyze_with_report(text, use_cache=False)
        assert "our values" not in {s.name for s in analysis.required_skills + analysis.preferred_skills}
        assert "our values (a heading)" in report.rejected


class TestRequiredOnlyFromRequirements:
    TEXT = (
        "Backend Engineer\n\nWhat you'll do\n\n- Build services with Kafka and Python\n\n"
        "Requirements:\n\n- 3+ years of Python\n- Strong SQL\n"
    )

    def test_a_skill_named_only_in_the_duties_is_preferred_not_dropped(self, llm):
        llm.replies = [reply(job_title="Backend Engineer", seniority="unknown", min_years_experience=3,
                             required_skills=[skill("Kafka"), skill("Python"), skill("SQL")], preferred_skills=[],
                             tools_technologies=["Kafka", "Python", "SQL"], education=[], certifications=[])]
        analysis, report = service.analyze_with_report(self.TEXT, use_cache=False)
        assert {"python", "sql"} <= {s.name for s in analysis.required_skills}
        assert "kafka" in {s.name for s in analysis.preferred_skills}
        assert "kafka" in report.moved_to_preferred

    def test_without_a_recognised_section_nothing_moves(self, llm):
        analysis, report = service.analyze_with_report(JD, use_cache=False)
        assert report.moved_to_preferred == [] and {"go", "java", "python"} <= {s.name for s in analysis.required_skills}


class TestToolsInTheRequirements:
    TEXT = (
        "Security Engineer\n\nWhat you'll do\n\n- Own cloud security on Datadog dashboards\n\n"
        "Requirements:\n\n- Deep hands-on experience securing a cloud provider (AWS, Kubernetes, Terraform)\n"
        "- Vault is a plus\n"
    )

    def test_a_tool_named_in_the_requirements_becomes_a_required_skill(self, llm):
        llm.replies = [reply(job_title="Security Engineer", seniority="unknown", min_years_experience=None,
                             required_skills=[], preferred_skills=[],
                             tools_technologies=["AWS", "Kubernetes", "Terraform", "Datadog", "Vault"],
                             education=[], certifications=[])]
        analysis, report = service.analyze_with_report(self.TEXT, use_cache=False)
        required = {s.name: s.evidence for s in analysis.required_skills}
        assert {"aws", "kubernetes", "terraform"} <= set(required) and required["aws"] == "AWS"
        assert "datadog" not in required  # named only in the duties
        assert "vault" not in required    # its own clause says "a plus"
        assert set(report.tools_promoted) >= {"aws", "kubernetes", "terraform"}


class TestFocusedCall:
    TEXT = (
        "Backend Engineer\n\nWhat you'll do\n\n- Build services\n\n"
        "Requirements:\n\n- 3+ years of Python\n- Strong SQL and dbt\n"
    )

    def test_off_by_default_the_second_call_runs(self, llm):
        service.analyze_with_report(self.TEXT, use_cache=False)
        assert len(llm.calls) == 1 and len(llm.missed_calls) == 1

    def test_on_it_asks_on_the_requirements_section_only_instead_of_the_second_call(self, llm, monkeypatch):
        monkeypatch.setattr(service.settings, "JD_FOCUSED_CALL", True)
        llm.replies = [
            reply(job_title="Backend Engineer", seniority="unknown", min_years_experience=3,
                  required_skills=[skill("Python")], preferred_skills=[], tools_technologies=["Python"],
                  education=[], certifications=[]),
            reply(job_title="Backend Engineer", seniority="unknown", min_years_experience=3,
                  required_skills=[skill("SQL"), skill("dbt")], preferred_skills=[], tools_technologies=[],
                  education=[], certifications=[]),
        ]
        analysis, report = service.analyze_with_report(self.TEXT, use_cache=False)
        assert len(llm.calls) == 2 and llm.missed_calls == []
        assert llm.calls[1]["user"].startswith("JOB POSTING:\nRequirements:") and "Build services" not in llm.calls[1]["user"]
        assert {"python", "sql", "dbt"} <= {s.name for s in analysis.required_skills}
        assert "dbt" in report.focused_added and report.attempts == 1  # SQL the rules already found

    def test_a_failed_focused_call_keeps_the_first_answer(self, llm, monkeypatch):
        monkeypatch.setattr(service.settings, "JD_FOCUSED_CALL", True)
        llm.replies = [reply(), LLMProviderError("cut off", kind="truncated")]
        analysis, report = service.analyze_with_report(self.TEXT, use_cache=False)
        assert analysis.source in ("llm", "hybrid") and "cut off" in report.focused_call_error
        assert report.llm_error is None

    def test_no_requirements_section_no_focused_call(self, llm, monkeypatch):
        monkeypatch.setattr(service.settings, "JD_FOCUSED_CALL", True)
        service.analyze_with_report(JD, use_cache=False)
        assert len(llm.calls) == 1 and llm.missed_calls == []


class TestAnalyzerModel:
    def test_the_analyzer_model_is_sent_only_when_set(self, llm, monkeypatch):
        seen = []
        original = llm.complete_tool_json

        def spy(*args, **kwargs):
            seen.append(kwargs.get("model"))
            return original(*args, **{k: v for k, v in kwargs.items() if k != "model"})

        monkeypatch.setattr(llm, "complete_tool_json", spy)
        service.analyze_with_report(JD, use_cache=False)
        monkeypatch.setattr(service.settings, "LLM_PROVIDER", "ollama")
        monkeypatch.setattr(service.settings, "OLLAMA_ANALYZER_MODEL", "qwen2.5:14b")
        service.analyze_with_report(JD, use_cache=False)
        assert seen[0] is None and seen[-1] == "qwen2.5:14b"

    def test_the_cache_key_names_the_configuration(self, monkeypatch):
        plain = service._cache_key("abc")
        monkeypatch.setattr(service.settings, "LLM_PROVIDER", "ollama")
        monkeypatch.setattr(service.settings, "OLLAMA_ANALYZER_MODEL", "qwen2.5:14b")
        assert service._cache_key("abc") != plain and "qwen2.5:14b" in service._cache_key("abc")
        monkeypatch.setattr(service.settings, "JD_FOCUSED_CALL", True)
        assert service._cache_key("abc").endswith(":focused")
