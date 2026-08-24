"""Screening-prep generation.

No live Claude calls: complete_tool_json is monkeypatched everywhere the LLM
path is exercised, so this suite is free to run in CI on every push.

The tests that matter most here are the honesty ones. The feature's whole
premise is that a candidate reads these answers out loud in a real screening
call, so an answer that asserts an achievement on their behalf isn't a cosmetic
flaw — it is coaching them to lie to an interviewer.
"""

import re

import pytest

from app.modules.interview_coach import services

PLACEHOLDER_RE = re.compile(r"\[[^\]]+\]")


class TestFallbackPrep:
    """The offline path knows nothing about the candidate, so every claim in
    it must be a placeholder rather than an assertion."""

    def test_returns_questions_without_llm(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python and Kubernetes required.")
        assert len(prep["screening_questions"]) >= 3

    def test_every_answer_template_has_placeholders(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python and Kubernetes required.")
        for question in prep["screening_questions"]:
            assert PLACEHOLDER_RE.search(question["answer_template"]), (
                f"{question['id']} asserts facts instead of asking for them"
            )

    def test_no_fabricated_metrics(self, monkeypatch):
        """Regression guard against the original spec's approach, which put
        invented figures ('reduced execution time by 35%') into the
        candidate's mouth as though they were real."""
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python required.")
        for question in prep["screening_questions"]:
            # A bare percentage or dollar figure outside a placeholder would be
            # a number the candidate never earned.
            outside_placeholders = PLACEHOLDER_RE.sub("", question["answer_template"])
            assert not re.search(r"\d+\s*%", outside_placeholders)
            assert "$" not in outside_placeholders

    def test_includes_a_gap_question(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Kubernetes required.")
        types = " ".join(q["type"].lower() for q in prep["screening_questions"])
        assert "gap" in types or "unfamiliar" in types

    def test_gap_answer_admits_the_gap(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Kubernetes required.")
        gap = next(q for q in prep["screening_questions"] if "gap" in q["type"].lower())
        assert "haven't" in gap["answer_template"].lower()

    def test_handles_empty_jd(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "", "")
        assert len(prep["screening_questions"]) >= 3
        for question in prep["screening_questions"]:
            assert question["question"].strip()

    def test_omits_company_phrase_when_blank(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        prep = services.generate_screening_prep("Backend Engineer", "", "Python required.")
        pitch = prep["screening_questions"][0]["question"]
        assert " at ." not in pitch and " at  " not in pitch


class TestLlmPrep:
    def test_uses_llm_result_when_available(self, monkeypatch):
        def fake(system, user, tool_name, schema, max_tokens=None):
            return {
                "screening_questions": [
                    {
                        "type": "Elevator pitch",
                        "question": "Tell me about yourself.",
                        "answer_template": "I'm a [role] at [company].",
                        "key_signal": "Concision.",
                        "what_to_avoid": "Rambling.",
                    }
                ]
            }

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python.")
        assert len(prep["screening_questions"]) == 1
        assert prep["screening_questions"][0]["question"] == "Tell me about yourself."

    def test_resume_text_reaches_the_prompt(self, monkeypatch):
        captured = {}

        def fake(system, user, tool_name, schema, max_tokens=None):
            captured["user"] = user
            return {"screening_questions": []}

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake)
        services.generate_screening_prep("Backend Engineer", "Acme", "Python.", "I built a payments API.")
        assert "I built a payments API." in captured["user"]

    def test_omits_resume_block_when_absent(self, monkeypatch):
        captured = {}

        def fake(system, user, tool_name, schema, max_tokens=None):
            captured["user"] = user
            return {"screening_questions": []}

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake)
        services.generate_screening_prep("Backend Engineer", "Acme", "Python.", None)
        assert "CANDIDATE'S RESUME" not in captured["user"]

    def test_llm_failure_falls_back_rather_than_erroring(self, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("simulated API failure")

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", boom)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python.")
        assert len(prep["screening_questions"]) >= 3

    def test_incomplete_llm_questions_are_dropped(self, monkeypatch):
        """A question with no answer template is unusable — better to fall
        back to the full scaffold than to render an empty card."""

        def fake(system, user, tool_name, schema, max_tokens=None):
            return {"screening_questions": [{"question": "Only a question, no template."}]}

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake)
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python.")
        assert all(q["answer_template"] for q in prep["screening_questions"])


class TestPrepShape:
    @pytest.fixture(autouse=True)
    def _offline(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)

    def test_ids_are_sequential_and_unique(self):
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python.")
        ids = [q["id"] for q in prep["screening_questions"]]
        assert ids == [f"q{i + 1}" for i in range(len(ids))]

    def test_tips_are_present(self):
        prep = services.generate_screening_prep("Backend Engineer", "Acme", "Python.")
        assert len(prep["general_interview_tips"]) == 3
        for tip in prep["general_interview_tips"]:
            assert tip["title"] and tip["rule"]
