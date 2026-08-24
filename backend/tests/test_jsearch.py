"""JSearch normalisation tests — no network, no quota spent.

The fixture is a real item from a live /search response, trimmed. That matters:
the published docs describe job_city/job_state/job_country as the location
fields, and in practice all three come back null for remote roles while
job_location carries the value. A fixture written from the docs would have
tested a shape the API does not actually return.
"""

import json

import pytest

from app.modules.job_market import jsearch

# Real remote listing: granular location fields null, job_location populated,
# every salary field null, job_highlights an empty dict.
REMOTE_ITEM = {
    "job_id": "OGRxMU5rNXZlTDdTYkRYU0FBQUFBQT09",
    "job_title": "Principal AI & Machine Learning Engineer - U.S. Based Remote",
    "employer_name": "Common App",
    "job_city": None,
    "job_state": None,
    "job_country": None,
    "job_location": "Anywhere",
    "job_is_remote": True,
    "job_employment_type": "Full-time",
    "job_apply_link": "https://www.linkedin.com/jobs/view/principal-ai-ml-engineer",
    "job_google_link": "https://www.google.com/search?q=jobs",
    "apply_options": [{"apply_link": "https://www.linkedin.com/jobs/view/x"}],
    "job_description": (
        "About Us\n\nWe are hiring a Principal Engineer. You will work with Python, "
        "PyTorch and Kubernetes on large-scale training pipelines. Experience with "
        "AWS and CI/CD required. Familiarity with Terraform is a plus."
    ),
    "job_highlights": {},
    "job_min_salary": None,
    "job_max_salary": None,
    "job_salary": None,
    "job_salary_period": None,
    "job_salary_string": None,
    "job_posted_at": "6 days ago",
    "job_posted_at_datetime_utc": "2026-08-07T00:00:00.000Z",
    "job_posted_at_timestamp": 1786060800,
    "job_publisher": "LinkedIn",
}

ONSITE_ITEM = {
    "job_id": "abc123",
    "job_title": "Backend Engineer",
    "employer_name": "Stripe",
    "job_city": "Seattle",
    "job_state": "WA",
    "job_country": "US",
    "job_location": None,
    "job_is_remote": False,
    "job_apply_link": "https://stripe.com/jobs/1",
    "job_min_salary": 180000,
    "job_max_salary": 240000,
    "job_salary_period": "YEAR",
    "job_highlights": {
        "Qualifications": ["5+ years with Go", "Strong PostgreSQL"],
        "Benefits": ["Dental insurance", "401k matching"],
    },
    "job_description": "Backend role.",
    "job_posted_at_datetime_utc": None,
    "job_posted_at_timestamp": 1786060800,
}


class TestDeriveLocation:
    def test_prefers_job_location(self):
        assert jsearch.derive_location(REMOTE_ITEM) == "Anywhere"

    def test_falls_back_to_city_state_country(self):
        assert jsearch.derive_location(ONSITE_ITEM) == "Seattle, WA, US"

    def test_never_returns_employment_type_as_a_location(self):
        """Regression: building from city+country alone leaves an empty string
        for remote roles, and falling through to job_employment_type renders
        'Full-time' in the location slot as if it were a place."""
        raw = {"job_city": None, "job_country": None, "job_employment_type": "Full-time"}
        assert jsearch.derive_location(raw) == "Location not specified"

    def test_all_missing(self):
        assert jsearch.derive_location({}) == "Location not specified"


class TestWorkMode:
    def test_remote_flag_wins(self):
        assert jsearch.infer_work_mode(REMOTE_ITEM) == "Remote"

    def test_onsite_default(self):
        assert jsearch.infer_work_mode(ONSITE_ITEM) == "On-site"

    def test_hybrid_from_text(self):
        raw = {"job_is_remote": False, "job_location": "Austin, TX - Hybrid"}
        assert jsearch.infer_work_mode(raw) == "Hybrid"


class TestSalary:
    def test_all_null_returns_none(self):
        """The common real case — most JSearch listings carry no salary."""
        assert jsearch.derive_salary(REMOTE_ITEM) is None

    def test_builds_range_from_numbers(self):
        assert jsearch.derive_salary(ONSITE_ITEM) == "$180,000 - $240,000/year"

    def test_prefers_preformatted_string(self):
        raw = {"job_salary_string": "$100K - $120K a year", "job_min_salary": 1}
        assert jsearch.derive_salary(raw) == "$100K - $120K a year"

    def test_single_bound(self):
        assert jsearch.derive_salary({"job_min_salary": 90000}) == "$90,000"


class TestSkills:
    def test_extracts_from_description_when_highlights_empty(self):
        skills = jsearch.derive_skills(REMOTE_ITEM)
        assert "PyTorch" in skills
        assert len(skills) <= jsearch.MAX_SKILLS

    def test_excludes_benefits_from_highlights(self):
        """Dental insurance and 401k are not skills."""
        skills = jsearch.derive_skills(ONSITE_ITEM)
        joined = " ".join(skills).lower()
        assert "dental" not in joined
        assert "401k" not in joined

    def test_empty_when_no_text(self):
        assert jsearch.derive_skills({}) == []

    def test_excludes_employer_name(self):
        """Regression: live data produced ['Booz', 'Allen', ...] as skills."""
        raw = {
            "employer_name": "Booz Allen Hamilton",
            "job_title": "AI Engineer",
            "job_description": (
                "Booz Allen Hamilton is hiring. Booz Allen engineers build with "
                "PyTorch and Kubernetes across Booz Allen programs."
            ),
        }
        skills = [s.lower() for s in jsearch.derive_skills(raw)]
        assert "booz" not in skills
        assert "allen" not in skills
        assert "hamilton" not in skills

    def test_excludes_posting_boilerplate(self):
        raw = {
            "employer_name": "SpaceX",
            "job_title": "AI Engineer",
            "job_description": (
                "Requires Top Secret clearance. Minimum qualifications listed. "
                "You will use Python and Terraform on our Platform Infrastructure."
            ),
        }
        skills = [s.lower() for s in jsearch.derive_skills(raw)]
        for noise in ("top", "secret", "minimum", "platform", "infrastructure", "spacex"):
            assert noise not in skills


class TestPostedAt:
    def test_parses_iso(self):
        parsed = jsearch.parse_posted_at(REMOTE_ITEM)
        assert parsed is not None and parsed.year == 2026

    def test_falls_back_to_timestamp(self):
        parsed = jsearch.parse_posted_at(ONSITE_ITEM)
        assert parsed is not None and parsed.tzinfo is not None

    def test_ignores_relative_string(self):
        """job_posted_at is prose ('6 days ago') and must never be parsed."""
        assert jsearch.parse_posted_at({"job_posted_at": "6 days ago"}) is None

    def test_none_when_absent(self):
        assert jsearch.parse_posted_at({}) is None


class TestApplyUrl:
    def test_prefers_direct_link(self):
        assert jsearch.derive_apply_url(REMOTE_ITEM).endswith("principal-ai-ml-engineer")

    def test_falls_back_to_apply_options(self):
        raw = {"apply_options": [{"apply_link": "https://x.com/a"}]}
        assert jsearch.derive_apply_url(raw) == "https://x.com/a"

    def test_falls_back_to_google_link(self):
        assert jsearch.derive_apply_url({"job_google_link": "https://g.co/j"}) == "https://g.co/j"

    def test_returns_none_rather_than_hash(self):
        """A '#' fallback renders an Apply button that goes nowhere."""
        assert jsearch.derive_apply_url({}) is None


class TestNormalise:
    def test_maps_remote_item(self):
        row = jsearch.normalise_item(REMOTE_ITEM, "ml engineer")
        assert row is not None
        assert row["company"] == "Common App"
        assert row["location"] == "Anywhere"
        assert row["work_mode"] == "Remote"
        assert row["salary_range"] is None
        assert row["external_id"] == REMOTE_ITEM["job_id"]
        assert json.loads(row["skills"])

    def test_drops_item_with_no_apply_destination(self):
        assert jsearch.normalise_item({"job_title": "Engineer"}, "q") is None

    def test_drops_item_with_no_title(self):
        assert jsearch.normalise_item({"job_apply_link": "https://x.com"}, "q") is None

    def test_dedupes_on_job_id(self):
        """JSearch aggregates publishers, so one role can appear twice with
        different apply links but the same job_id."""
        second = dict(REMOTE_ITEM, job_apply_link="https://indeed.com/other")
        rows = jsearch.normalise_items([REMOTE_ITEM, second], "ml engineer")
        assert len(rows) == 1

    def test_keeps_distinct_jobs(self):
        rows = jsearch.normalise_items([REMOTE_ITEM, ONSITE_ITEM], "q")
        assert len(rows) == 2


class TestNoQuotaSpendWithoutKey:
    def test_search_refuses_without_key(self, monkeypatch):
        monkeypatch.setattr(jsearch.settings, "RAPIDAPI_KEY", "")
        assert jsearch.is_configured() is False
        with pytest.raises(jsearch.JSearchUnavailable):
            jsearch.search("ml engineer")
