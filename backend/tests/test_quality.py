"""Bullet impact, section-context weighting, and recency decay."""

from datetime import date

import pytest

from app.modules.resume_analyzer import quality


class TestEvaluateBullet:
    def test_full_xyz_bullet_scores_three(self):
        result = quality.evaluate_bullet(
            "Reduced p95 latency by 40% using Redis caching and connection pooling"
        )
        assert result["grade"] == 3
        assert result["has_strong_verb"] and result["has_metric"] and result["has_tool_context"]

    def test_weak_opener_flagged(self):
        result = quality.evaluate_bullet("Responsible for maintaining the backend services")
        assert result["has_weak_opener"] is True
        assert result["has_strong_verb"] is False
        assert any("responsible" in s.lower() for s in result["suggestions"])

    def test_missing_metric_produces_actionable_suggestion(self):
        result = quality.evaluate_bullet("Built a caching layer using Redis")
        assert result["has_metric"] is False
        assert any("figure" in s or "number" in s for s in result["suggestions"])

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Reduced costs by 40%", True),
            ("Saved $2M annually", True),
            ("Cut latency to 200ms", True),
            ("Improved throughput 3x", True),
            ("Grew from 40 to 95 users", True),
            ("Served 10,000 requests", True),
        ],
    )
    def test_metric_forms_detected(self, text, expected):
        assert quality.evaluate_bullet(text)["has_metric"] is expected

    def test_bare_small_numbers_are_not_metrics(self):
        """'5 years' and 'Python 3' are numbers that measure no impact —
        counting them would inflate the quantified ratio with noise."""
        assert quality.evaluate_bullet("Used Python 3 for 5 years")["has_metric"] is False

    def test_bullet_marker_stripped_before_verb_check(self):
        assert quality.evaluate_bullet("• Built the ingestion pipeline")["has_strong_verb"] is True

    def test_empty_bullet_is_safe(self):
        result = quality.evaluate_bullet("")
        assert result["grade"] == 0


class TestEvaluateBullets:
    def test_empty_list(self):
        report = quality.evaluate_bullets([])
        assert report["bullet_count"] == 0
        assert report["quantified_ratio"] == 0.0

    def test_ratios_computed(self):
        report = quality.evaluate_bullets([
            "Reduced latency by 40% using Redis",
            "Responsible for the backend",
        ])
        assert report["bullet_count"] == 2
        assert report["quantified_ratio"] == 50.0
        assert report["weak_opener_count"] == 1

    def test_adding_metrics_raises_the_grade(self):
        """The stated verification: quantifying a bullet must measurably
        improve its evaluation."""
        before = quality.evaluate_bullets(["Increased throughput"])
        after = quality.evaluate_bullets(["Increased throughput by 35% using Kafka partitioning"])
        assert after["average_grade"] > before["average_grade"]
        assert after["quantified_ratio"] > before["quantified_ratio"]

    def test_weakest_bullets_listed_first(self):
        report = quality.evaluate_bullets([
            "Reduced latency by 40% using Redis",
            "Responsible for stuff",
        ])
        assert report["bullets"][0]["grade"] <= report["bullets"][-1]["grade"]


RESUME = """John Doe

Experience
Senior Engineer, Acme 2022-Present
• Reduced latency by 40% using Redis

Technical Skills
Python, Redis, Kubernetes, Kubernetes, Kubernetes, Kubernetes, Kubernetes

Education
BS Computer Science, Java
"""


class TestSplitSections:
    def test_recognises_headings(self):
        sections = quality.split_sections(RESUME)
        assert "experience" in sections
        assert "skills" in sections
        assert "education" in sections

    def test_content_lands_in_the_right_section(self):
        sections = quality.split_sections(RESUME)
        assert "Redis" in sections["experience"]
        assert "Java" in sections["education"]

    def test_preamble_before_any_heading_goes_to_other(self):
        assert "John Doe" in quality.split_sections(RESUME)["other"]

    def test_long_line_containing_heading_word_is_not_a_heading(self):
        """A sentence mentioning 'experience' mid-paragraph must not open a
        new section, or everything after it is misfiled."""
        text = "Summary\nI have extensive experience building distributed systems at scale.\n"
        sections = quality.split_sections(text)
        assert "experience" not in sections


class TestSkillContext:
    def test_experience_outweighs_skills_list(self):
        experience_weight = quality.skill_context(RESUME, "Redis")["weight"]
        education_weight = quality.skill_context(RESUME, "Java")["weight"]
        assert experience_weight > education_weight

    def test_skill_in_multiple_sections_takes_the_best(self):
        """Redis appears in both experience and the skills list — the weaker
        mention must not dilute the stronger evidence."""
        context = quality.skill_context(RESUME, "Redis")
        assert set(context["sections"]) >= {"experience", "skills"}
        assert context["weight"] == quality.SECTION_WEIGHTS["experience"]

    def test_absent_skill_reports_not_found(self):
        context = quality.skill_context(RESUME, "Fortran")
        assert context["found"] is False and context["weight"] == 0.0

    def test_keyword_stuffing_penalised(self):
        """Kubernetes appears 5x in the skills list and never in experience."""
        context = quality.skill_context(RESUME, "Kubernetes")
        assert context["stuffed"] is True
        assert context["weight"] < quality.SECTION_WEIGHTS["skills"]

    def test_repetition_with_real_evidence_is_not_stuffing(self):
        text = "Experience\n" + "• Built with Redis\n" * 6
        assert quality.skill_context(text, "Redis")["stuffed"] is False


TODAY = date(2026, 1, 1)


class TestRecency:
    def test_present_resolves_to_current_year(self):
        assert quality.parse_end_year("2022 - Present", TODAY) == 2026

    def test_end_year_from_range(self):
        assert quality.parse_end_year("2018 - 2021", TODAY) == 2021

    def test_unparseable_returns_none(self):
        assert quality.parse_end_year("last summer", TODAY) is None

    def test_current_role_gets_full_credit(self):
        assert quality.recency_credit(2026, TODAY) == 1.0

    def test_recent_role_slightly_discounted(self):
        credit = quality.recency_credit(2025, TODAY)
        assert 0.8 < credit < 1.0

    def test_stale_skill_decays(self):
        """The stated verification: a skill from 4 years ago must score below
        the same skill in the current role."""
        assert quality.recency_credit(2022, TODAY) < quality.recency_credit(2026, TODAY)

    def test_decay_is_monotonic(self):
        credits = [quality.recency_credit(y, TODAY) for y in (2026, 2025, 2024, 2023, 2022)]
        assert credits == sorted(credits, reverse=True)

    def test_never_decays_below_floor(self):
        assert quality.recency_credit(1995, TODAY) == quality.RECENCY_FLOOR

    def test_unknown_date_is_not_penalised(self):
        """We can't tell 'old' from 'unusually formatted' — docking a resume
        for its date format would be wrong."""
        assert quality.recency_credit(None, TODAY) == 1.0

    def test_evaluate_recency_over_roles(self):
        results = quality.evaluate_recency(
            [
                {"title": "Senior", "company": "Acme", "dates": "2023 - Present", "bullets": []},
                {"title": "Junior", "company": "Old Co", "dates": "2018 - 2020", "bullets": []},
            ],
            TODAY,
        )
        assert results[0]["recency_credit"] > results[1]["recency_credit"]

    def test_empty_experience_list(self):
        assert quality.evaluate_recency([], TODAY) == []
