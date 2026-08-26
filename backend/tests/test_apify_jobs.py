"""Apify LinkedIn provider: input contract and field mapping.

No network. SAMPLE_ITEM is a verbatim dataset item from a real run — the field
names here are observed, not documented, and the mapping tests exist because
guessing them cost money to discover.
"""

import pytest

from app.modules.job_market import apify_jobs

# Trimmed from an actual dataset item (run 10Bapw8CMbSZ0PRc3).
SAMPLE_ITEM = {
    "jobId": "4423604783",
    "jobTitle": "Software Developer 3",
    "companyName": "Oracle",
    "location": "Nashville, TN",
    "jobDescription": "Job Description\n\nAs a member of the software engineering division...",
    "jobUrl": "https://www.linkedin.com/jobs/view/software-developer-3-at-oracle-4423604783",
    "applyUrl": "https://oracle.com/careers/4423604783",
    "publishedAt": "2026-08-13T00:00:00.000Z",
    "contractType": "Full-time",
    "experienceLevel": "Mid-Senior level",
    "salaryInfo": ["$89200", "$209500"],
    "workType": "Engineering and Information Technology",
    "applicationsCount": "196",
}


class TestRunInput:
    def test_includes_locations(self):
        """Keyword-only input returns nothing: the actor exits SUCCEEDED with
        an empty dataset and still bills the start fee."""
        payload = apify_jobs.build_run_input("software engineer")
        assert payload["locations"]

    def test_keyword_is_singular_and_a_list(self):
        """The field is `keyword`, not `keywords`. With `required: None` the
        actor accepts the wrong key silently and scrapes unfiltered."""
        payload = apify_jobs.build_run_input("ai engineer")
        assert payload["keyword"] == ["ai engineer"]
        assert "keywords" not in payload

    def test_max_items_is_clamped_to_the_floor(self):
        """The actor rejects anything under 150 outright, so a caller asking
        for 25 would waste a round trip learning a fixed rule."""
        assert apify_jobs.build_run_input("x", max_items=25)["maxItems"] == 150

    def test_larger_max_items_is_respected(self):
        assert apify_jobs.build_run_input("x", max_items=400)["maxItems"] == 400

    def test_requests_apify_side_dedup(self):
        """Billing is per result, so deduping server-side is a cost lever."""
        assert apify_jobs.build_run_input("x")["saveOnlyUniqueItems"] is True


class TestNormalise:
    def test_maps_verified_field_names(self):
        row = apify_jobs.normalise_item(SAMPLE_ITEM, "software engineer")
        assert row["title"] == "Software Developer 3"
        assert row["company"] == "Oracle"
        assert row["location"] == "Nashville, TN"
        assert row["external_id"] == "4423604783"

    def test_description_comes_from_jobDescription(self):
        """The actor emits `jobDescription`; a mapper reading `description`
        gets None and every posting reaches Claude with no text."""
        assert apify_jobs.normalise_item(SAMPLE_ITEM, "q")["description"].startswith("Job Description")

    def test_prefers_apply_url_over_job_url(self):
        row = apify_jobs.normalise_item(SAMPLE_ITEM, "q")
        assert row["apply_url"] == SAMPLE_ITEM["applyUrl"]

    def test_falls_back_to_job_url(self):
        item = {**SAMPLE_ITEM, "applyUrl": ""}
        assert apify_jobs.normalise_item(item, "q")["apply_url"] == SAMPLE_ITEM["jobUrl"]

    def test_drops_rows_with_no_usable_link(self):
        """A card the user cannot act on is worse than one fewer result."""
        assert apify_jobs.normalise_item({**SAMPLE_ITEM, "applyUrl": "", "jobUrl": ""}, "q") is None

    def test_drops_rows_missing_title_or_company(self):
        assert apify_jobs.normalise_item({**SAMPLE_ITEM, "jobTitle": ""}, "q") is None
        assert apify_jobs.normalise_item({**SAMPLE_ITEM, "companyName": ""}, "q") is None

    def test_salary_range_from_list(self):
        assert apify_jobs.normalise_item(SAMPLE_ITEM, "q")["salary_range"] == "$89200 - $209500"

    def test_single_salary_value(self):
        assert apify_jobs.derive_salary({"salaryInfo": ["$120000"]}) == "$120000"

    def test_absent_salary(self):
        assert apify_jobs.derive_salary({}) is None
        assert apify_jobs.derive_salary({"salaryInfo": "not a list"}) is None

    def test_published_at_parsed(self):
        assert apify_jobs.normalise_item(SAMPLE_ITEM, "q")["posted_at"].year == 2026

    def test_unparseable_date_is_none_not_now(self):
        """Defaulting to now() would make a stale posting look fresh."""
        assert apify_jobs.parse_published_at("last tuesday") is None

    def test_normalise_items_filters_none(self):
        rows = apify_jobs.normalise_items([SAMPLE_ITEM, {"jobTitle": "x"}], "q")
        assert len(rows) == 1


class TestSourceSuppliedFields:
    """The actor states these, so Claude is never asked to infer them."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Mid-Senior level", "senior"),
            ("Entry level", "entry"),
            ("Internship", "entry"),
            ("Associate", "mid"),
            ("Director", "lead"),
            ("Executive", "lead"),
        ],
    )
    def test_experience_levels(self, raw, expected):
        assert apify_jobs.map_experience_level(raw) == expected

    @pytest.mark.parametrize(
        "raw,expected",
        [("Full-time", "full_time"), ("Part-time", "part_time"),
         ("Contract", "contract"), ("Internship", "internship")],
    )
    def test_contract_types(self, raw, expected):
        assert apify_jobs.map_employment_type(raw) == expected

    def test_unknown_level_is_none_not_mid(self):
        """A guessed level is indistinguishable from a stated one downstream."""
        assert apify_jobs.map_experience_level("Wizard") is None
        assert apify_jobs.map_experience_level(None) is None

    def test_unknown_contract_is_none(self):
        assert apify_jobs.map_employment_type("Freelance-ish") is None

    def test_row_carries_both_through(self):
        row = apify_jobs.normalise_item(SAMPLE_ITEM, "q")
        assert row["experience_level"] == "senior"
        assert row["employment_type"] == "full_time"


class TestWorkMode:
    def test_remote_from_location(self):
        assert apify_jobs.infer_work_mode({"location": "Remote, US"}) == "Remote"

    def test_hybrid_from_title(self):
        assert apify_jobs.infer_work_mode({"jobTitle": "Engineer (Hybrid)"}) == "Hybrid"

    def test_defaults_to_onsite(self):
        assert apify_jobs.infer_work_mode(SAMPLE_ITEM) == "On-site"

    def test_handles_empty(self):
        assert apify_jobs.infer_work_mode({}) == "On-site"


class TestSpendGuards:
    def test_no_token_means_not_configured(self, monkeypatch):
        monkeypatch.setattr(apify_jobs.settings, "APIFY_API_TOKEN", "")
        assert apify_jobs.is_configured() is False

    def test_search_refuses_without_a_token(self, monkeypatch):
        """The only thing between a missing token and a confusing SDK error."""
        monkeypatch.setattr(apify_jobs.settings, "APIFY_API_TOKEN", "")
        with pytest.raises(apify_jobs.ApifyUnavailable):
            apify_jobs.search("engineer")

    def test_per_run_charge_cap_is_set(self):
        """Apify enforces this server-side, so it holds even if our own input
        is wrong or the actor misbehaves."""
        assert apify_jobs.MAX_CHARGE_PER_RUN_USD == 1.00
