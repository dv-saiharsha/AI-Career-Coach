"""active_jobs.py — the /active-jb on-demand search source.

Fixture payloads below are trimmed real shapes from a live call against this
account's key (see the module docstring for exactly which fields were
verified live: title, organization, url, locations_derived, date_posted,
date_valid_through, ai_work_arrangement, ai_key_skills, description_text).
"""

import json

from app.modules.job_market import active_jobs


def _job(**overrides) -> dict:
    base = {
        "id": 111,
        "title": "Security Engineer",
        "organization": "Acme Corp",
        "url": "https://www.linkedin.com/jobs/view/security-engineer-at-acme-111",
        "date_posted": "2026-09-20T06:37:06.113",
        "date_valid_through": None,
        "locations_derived": ["United States"],
        "ai_work_arrangement": "Remote OK",
        "ai_key_skills": ["SIEM", "Incident response"],
        "description_text": "About the role...",
        "salary": None,
        "source": "linkedin",
    }
    base.update(overrides)
    return base


class TestNormalise:
    def test_maps_the_core_fields(self):
        rows = active_jobs.normalise([_job()], "security engineer")
        assert len(rows) == 1
        row = rows[0]
        assert row["title"] == "Security Engineer"
        assert row["company"] == "Acme Corp"
        assert row["apply_url"].startswith("https://www.linkedin.com/")
        assert row["query_key"] == "security engineer"
        assert row["external_id"] == "active_jobs:111"
        assert row["description"] == "About the role..."
        assert json.loads(row["skills"]) == ["SIEM", "Incident response"]

    def test_source_is_our_own_vendor_not_the_publisher_it_names(self):
        """The payload's own "source" field says "linkedin" — the stored row
        must say "active_jobs" (where WE read the bytes from), the same rule
        jsearch.py follows for its own aggregator vs. publisher distinction."""
        row = active_jobs.normalise([_job(source="linkedin")], "q")[0]
        assert row["source"] == "active_jobs"

    def test_drops_a_row_missing_title_company_or_url(self):
        assert active_jobs.normalise([_job(title="")], "q") == []
        assert active_jobs.normalise([_job(organization="")], "q") == []
        assert active_jobs.normalise([_job(url="")], "q") == []

    def test_drops_an_expired_posting(self):
        """Belt-and-braces: /active-jb's own name says it filters to open
        postings, but a stated expiry in the past is still checked."""
        expired = _job(date_valid_through="2020-01-01T00:00:00")
        assert active_jobs.normalise([expired], "q") == []

    def test_a_future_valid_through_date_is_kept(self):
        future = _job(date_valid_through="2999-01-01T00:00:00")
        assert len(active_jobs.normalise([future], "q")) == 1

    def test_drops_a_non_us_location(self):
        row = _job(locations_derived=["Brazil"])
        assert active_jobs.normalise([row], "q") == []

    def test_missing_locations_derived_falls_back_to_not_specified(self):
        row = active_jobs.normalise([_job(locations_derived=[])], "q")[0]
        assert row["location"] == "Not specified"

    def test_work_mode_prefers_the_ai_arrangement_field(self):
        remote = active_jobs.normalise([_job(ai_work_arrangement="Remote OK")], "q")[0]
        hybrid = active_jobs.normalise([_job(ai_work_arrangement="Hybrid, 2 days")], "q")[0]
        onsite = active_jobs.normalise([_job(ai_work_arrangement=None, locations_derived=["Austin, TX"])], "q")[0]
        assert remote["work_mode"] == "Remote"
        assert hybrid["work_mode"] == "Hybrid"
        assert onsite["work_mode"] == "On-site"

    def test_salary_is_verbatim_from_the_structured_field_only(self):
        """ai_salary_* is a model's inference from the description text, not
        a number the employer stated, so it must never surface as one."""
        no_structured_salary = _job(salary=None)
        row = active_jobs.normalise([no_structured_salary], "q")[0]
        assert row["salary_range"] is None

        with_salary = _job(salary={"min_amount": 120000, "max_amount": 150000, "currency": "USD"})
        row = active_jobs.normalise([with_salary], "q")[0]
        assert row["salary_range"] == "USD 120,000 - 150,000"


class TestSearchBudget:
    def test_skips_the_call_once_the_reserve_is_reached(self, monkeypatch):
        monkeypatch.setattr(active_jobs, "_remaining", active_jobs.RESERVE_REQUESTS)
        monkeypatch.setattr(active_jobs.settings, "RAPIDAPI_KEY", "test-key")

        def fail_if_called(url, headers):
            raise AssertionError("must not call out once the reserve is reached")

        assert active_jobs.search("security engineer", fetch=fail_if_called) == []

    def test_not_configured_short_circuits_without_a_network_call(self, monkeypatch):
        monkeypatch.setattr(active_jobs.settings, "RAPIDAPI_KEY", "")

        def fail_if_called(url, headers):
            raise AssertionError("must not call out when unconfigured")

        assert active_jobs.search("q", fetch=fail_if_called) == []

    def test_records_remaining_quota_from_the_response_headers(self, monkeypatch):
        monkeypatch.setattr(active_jobs, "_remaining", None)
        monkeypatch.setattr(active_jobs.settings, "RAPIDAPI_KEY", "test-key")

        payload = json.dumps([_job()])

        def fake_fetch(url, headers):
            return 200, payload, {"X-RateLimit-Requests-Remaining": "17"}

        rows = active_jobs.search("security engineer", fetch=fake_fetch)
        assert len(rows) == 1
        assert active_jobs.remaining_requests() == 17

    def test_a_non_200_returns_empty_without_raising(self, monkeypatch):
        monkeypatch.setattr(active_jobs, "_remaining", None)
        monkeypatch.setattr(active_jobs.settings, "RAPIDAPI_KEY", "test-key")

        def fake_fetch(url, headers):
            return 429, '{"message": "Too many requests"}', {}

        assert active_jobs.search("q", fetch=fake_fetch) == []

    def test_a_transport_failure_returns_empty_without_raising(self, monkeypatch):
        monkeypatch.setattr(active_jobs, "_remaining", None)
        monkeypatch.setattr(active_jobs.settings, "RAPIDAPI_KEY", "test-key")

        def raises(url, headers):
            raise TimeoutError("no route to host")

        assert active_jobs.search("q", fetch=raises) == []
