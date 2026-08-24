"""Salary parsing, benchmarks, roadmap, and counter-offer drafting.

No live Claude calls — the LLM is monkeypatched wherever the roadmap would
reach for it, so this suite is free to run on every push.

The salary tests carry the most weight: these numbers are what a user repeats
to an employer, so a misparse is not a cosmetic bug.
"""

import pytest

from app.modules.career import services
from app.modules.career.salary import parse_salary_range, summarise


class TestParseSalaryRange:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("126K-196K a year", (126_000, 196_000)),
            ("126K–196K a year", (126_000, 196_000)),  # en-dash, the form JSearch actually returns
            ("164,939-181,185 a year", (164_939, 181_185)),
            ("175K a year", (175_000, 175_000)),
            ("120K to 200K a year", (120_000, 200_000)),
            ("$150,000 - $180,000", (150_000, 180_000)),
        ],
    )
    def test_annual_forms(self, raw, expected):
        assert parse_salary_range(raw) == expected

    def test_hourly_is_annualised(self):
        # 2080 = 40h x 52wk
        assert parse_salary_range("$60 - $80 an hour") == (124_800, 166_400)

    def test_monthly_is_annualised(self):
        assert parse_salary_range("$8,000 a month") == (96_000, 96_000)

    @pytest.mark.parametrize("raw", ["", None, "garbage", "competitive salary", "2024"])
    def test_unparseable_returns_none(self, raw):
        assert parse_salary_range(raw) is None

    def test_401k_is_not_a_salary(self):
        """Regression: '401k' parses as $401,000, which sits inside the
        plausible band, so the numeric bounds alone do not catch it. Left
        unhandled it would drag a median upward with a benefits mention."""
        assert parse_salary_range("401k") is None
        assert parse_salary_range("401(k) match") is None

    def test_implausible_values_rejected(self):
        assert parse_salary_range("$5 a year") is None
        assert parse_salary_range("$50,000,000 a year") is None

    def test_low_high_ordering_is_normalised(self):
        low, high = parse_salary_range("200K-120K a year")
        assert low < high


class TestSummarise:
    def test_returns_none_when_nothing_parses(self):
        """The caller must be able to say 'no data'. An empty band rendered as
        a finding would be worse than admitting the gap."""
        assert summarise(["garbage", None, ""]) is None

    def test_single_posting(self):
        summary = summarise(["150K a year"])
        assert summary["sample_size"] == 1
        assert summary["median"] == 150_000

    def test_uses_midpoints_not_both_ends(self):
        """One posting describes one job. Folding its low and high in as two
        observations would double-count it and widen the spread."""
        summary = summarise(["100K-200K a year"])
        assert summary["sample_size"] == 1
        assert summary["median"] == 150_000

    def test_percentiles_ordered(self):
        summary = summarise([f"{n}K a year" for n in range(100, 200, 10)])
        assert summary["low"] <= summary["p25"] <= summary["median"] <= summary["p75"] <= summary["high"]

    def test_drops_unparseable_from_sample(self):
        summary = summarise(["150K a year", "garbage", None])
        assert summary["sample_size"] == 1


class TestCounterOfferEmail:
    def test_cites_benchmark_only_with_real_data(self):
        benchmark = {"sample_size": 12, "median": 150_000, "p75": 175_000}
        email = services.counter_offer_email("Backend Engineer", "Acme", "$140,000", "$165,000", benchmark)
        assert "$150,000" in email
        assert "$165,000" in email

    def test_asks_for_evidence_when_no_data(self):
        """Regression: the original template asserted 'based on market
        benchmarks' unconditionally, including when no benchmark existed."""
        benchmark = {"sample_size": 0, "median": None, "p75": None}
        email = services.counter_offer_email("Backend Engineer", "Acme", "$140,000", "$165,000", benchmark)
        assert "Cite your evidence" in email
        assert "market benchmarks" not in email.lower()

    def test_small_sample_is_not_cited(self):
        benchmark = {"sample_size": 2, "median": 150_000, "p75": 175_000}
        email = services.counter_offer_email("Backend Engineer", "Acme", "", "$165,000", benchmark)
        assert "$150,000" not in email

    def test_never_asserts_candidate_background(self):
        """The original claimed 'my specialized background in cloud
        architecture' for every user regardless of their actual history."""
        email = services.counter_offer_email("Backend Engineer", "Acme", "", "$165,000", None)
        assert "cloud architecture" not in email.lower()
        assert "[" in email  # the rationale is a placeholder, not a claim

    def test_handles_blank_inputs(self):
        email = services.counter_offer_email("", "", "", "", None)
        assert "[Role]" in email and "[Company]" in email
        assert "[your target figure]" in email


class TestCareerRoadmap:
    def test_fallback_when_llm_unavailable(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        result = services.career_roadmap("Backend Engineer", "Staff Engineer")
        assert len(result["milestones"]) >= 3
        assert result["tailored"] is False

    def test_fallback_claims_no_skills_it_cannot_know(self, monkeypatch):
        """With no LLM and no scan there is no basis for saying the candidate
        already holds anything — so it says nothing."""
        monkeypatch.setattr(services.llm_client, "_client", None)
        result = services.career_roadmap("Backend Engineer", "Staff Engineer")
        assert all(not m["have_skills"] for m in result["milestones"])

    def test_uses_llm_when_available(self, monkeypatch):
        def fake(system, user, tool_name, schema, max_tokens=None):
            return {
                "milestones": [
                    {
                        "title": "Senior Engineer",
                        "summary": "Wider ownership.",
                        "typical_duration": "12-18 months",
                        "have_skills": ["Python"],
                        "gap_skills": ["Distributed systems"],
                    }
                ]
            }

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake)
        result = services.career_roadmap("Backend Engineer", "Staff Engineer")
        assert result["tailored"] is True
        assert result["milestones"][0]["title"] == "Senior Engineer"

    def test_resume_skills_reach_the_prompt(self, monkeypatch):
        captured = {}

        def fake(system, user, tool_name, schema, max_tokens=None):
            captured["user"] = user
            return {"milestones": [{"title": "X"}]}

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", fake)
        services.career_roadmap("Backend Engineer", "Staff", None, ["Python"], ["Kubernetes"])
        assert "Python" in captured["user"]
        assert "Kubernetes" in captured["user"]

    def test_llm_failure_falls_back(self, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("simulated failure")

        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(services.llm_client, "complete_tool_json", boom)
        result = services.career_roadmap("Backend Engineer", "Staff Engineer")
        assert result["tailored"] is False
        assert len(result["milestones"]) >= 3

    def test_milestone_ids_assigned(self, monkeypatch):
        monkeypatch.setattr(services.llm_client, "_client", None)
        result = services.career_roadmap("Backend Engineer", "Staff Engineer")
        ids = [m["id"] for m in result["milestones"]]
        assert ids == [f"m{i + 1}" for i in range(len(ids))]
