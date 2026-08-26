"""Ingestion worker: dedup, enrichment parsing, and spend guards.

No network and no API calls anywhere in this file. The batch client is
monkeypatched; Apify is monkeypatched. A test suite for a module whose whole
purpose is spending money must not be able to spend any.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.job import JobListing
from app.modules.job_market import enrichment, ingestion


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def add_listing(db, digest, enriched=True, hours_old=1):
    row = JobListing(
        content_hash=digest, query_key="ai engineer", external_id=digest,
        title="Engineer", company="Acme", location="Remote", work_mode="Remote",
        apply_url="https://example.com/j",
        fetched_at=datetime.now(timezone.utc) - timedelta(hours=hours_old),
        enriched_at=datetime.now(timezone.utc) if enriched else None,
    )
    db.add(row)
    db.commit()
    return row


class TestContentHash:
    def test_stable_across_calls(self):
        assert ingestion.content_hash("Acme", "Engineer", "Remote") == ingestion.content_hash(
            "Acme", "Engineer", "Remote"
        )

    def test_normalises_case_and_whitespace(self):
        """The actor returns the same employer with inconsistent casing across
        responses; without normalising, one posting becomes two rows and gets
        enriched twice."""
        assert ingestion.content_hash(" ACME ", "Engineer", "Remote") == ingestion.content_hash(
            "acme", "engineer", "remote"
        )

    def test_different_companies_differ(self):
        assert ingestion.content_hash("Acme", "Engineer", "Remote") != ingestion.content_hash(
            "Globex", "Engineer", "Remote"
        )

    def test_is_identity_not_content(self):
        """A re-listed req with an edited description must hash the same, or
        every sweep re-pays to enrich it."""
        assert ingestion.content_hash("Acme", "Engineer", "Remote") == ingestion.content_hash(
            "Acme", "Engineer", "Remote"
        )

    def test_empty_fields_are_safe(self):
        assert len(ingestion.content_hash("", "", "")) == 32


class TestDedupBeforeEnrichment:
    """The cost lever. Enriching first and deduping at upsert re-pays Claude
    for everything already stored."""

    def test_already_enriched_postings_are_skipped(self, db):
        digest = ingestion.content_hash("Acme", "Engineer", "Remote")
        add_listing(db, digest, enriched=True)
        pending = ingestion._unenriched(db, {digest: {"title": "Engineer"}})
        assert pending == {}

    def test_stored_but_unenriched_postings_are_retried(self, db):
        """A posting stored during a sweep where Claude was unavailable must
        still get enriched next time."""
        digest = ingestion.content_hash("Acme", "Engineer", "Remote")
        add_listing(db, digest, enriched=False)
        pending = ingestion._unenriched(db, {digest: {"title": "Engineer"}})
        assert digest in pending

    def test_unknown_postings_pass_through(self, db):
        pending = ingestion._unenriched(db, {"deadbeef" * 4: {"title": "New"}})
        assert len(pending) == 1

    def test_empty_input(self, db):
        assert ingestion._unenriched(db, {}) == {}


class TestEnrichmentParsing:
    def _message(self, payload):
        return SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", input=payload)],
            usage=SimpleNamespace(input_tokens=900, output_tokens=200),
        )

    def test_parses_tool_payload(self):
        result = enrichment.parse_enrichment(
            self._message({
                "h1b_sponsorship": "explicitly_sponsored",
                "h1b_evidence": "We sponsor H-1B visas.",
                "experience_level": "senior", "employment_type": "full_time",
                "core_skills": ["Python"], "summary": "A role.",
            })
        )
        assert result["h1b_sponsorship"] == "explicitly_sponsored"
        assert result["experience_level"] == "senior"

    def test_unrecognised_sponsorship_value_falls_to_unmentioned(self):
        """An out-of-enum value must never be stored as a sponsorship claim —
        and the evidence is cleared with it, so no quote survives to support a
        classification that was discarded."""
        result = enrichment.parse_enrichment(
            self._message({"h1b_sponsorship": "probably", "h1b_evidence": "maybe", "core_skills": []})
        )
        assert result["h1b_sponsorship"] == "unmentioned"
        assert result["h1b_evidence"] == ""

    @pytest.mark.parametrize("value", ["", "null", "none", "unknown"])
    def test_placeholder_levels_become_none(self, value):
        """A model returning the string 'null' must not be stored as a real
        experience level."""
        result = enrichment.parse_enrichment(
            self._message({"h1b_sponsorship": "unmentioned", "experience_level": value, "core_skills": []})
        )
        assert result["experience_level"] is None

    def test_no_tool_block_returns_unenriched(self):
        message = SimpleNamespace(content=[SimpleNamespace(type="text", text="sorry")], usage=None)
        assert enrichment.parse_enrichment(message) == enrichment.UNENRICHED

    def test_malformed_message_does_not_raise(self):
        """One bad response in a sweep of hundreds costs that job its
        metadata, not the whole run after tokens are already spent."""
        assert enrichment.parse_enrichment(object()) == enrichment.UNENRICHED

    def test_unenriched_default_asserts_nothing(self):
        """A failed enrichment must be indistinguishable from a posting that
        said nothing — never a guessed 'mid'."""
        assert enrichment.UNENRICHED["experience_level"] is None
        assert enrichment.UNENRICHED["employment_type"] is None
        assert enrichment.UNENRICHED["h1b_sponsorship"] == "unmentioned"

    def test_non_list_skills_are_dropped(self):
        result = enrichment.parse_enrichment(
            self._message({"h1b_sponsorship": "unmentioned", "core_skills": "Python"})
        )
        assert result["core_skills"] == []


class TestEnrichmentRequest:
    def test_uses_haiku_not_the_app_wide_model(self):
        """Bulk classification on the app-wide model is the difference between
        this feature being viable and not."""
        assert enrichment.enrichment_model() == "claude-haiku-4-5"

    def test_forces_the_tool_call(self):
        params = enrichment.build_request_params("Engineer", "Acme", "desc")
        assert params["tool_choice"] == {"type": "tool", "name": enrichment.ENRICHMENT_TOOL_NAME}

    def test_truncates_long_descriptions(self):
        params = enrichment.build_request_params("Engineer", "Acme", "x" * 99_000)
        assert len(params["messages"][0]["content"]) < enrichment.MAX_DESCRIPTION_CHARS + 200

    def test_schema_has_no_will_sponsor_value(self):
        """The schema must not offer a value that reads as a promise about
        what an employer will actually do."""
        assert set(enrichment.ENRICHMENT_SCHEMA["properties"]["h1b_sponsorship"]["enum"]) == {
            "explicitly_sponsored", "no_sponsorship", "unmentioned",
        }


class TestSpendGuards:
    def test_dry_run_is_the_default(self, db):
        import inspect

        assert inspect.signature(ingestion.refresh_global_jobs).parameters["dry_run"].default is True

    def test_dry_run_issues_no_requests(self, db, monkeypatch):
        def fail(*a, **k):
            raise AssertionError("dry run must not call Apify")

        monkeypatch.setattr(ingestion.apify_jobs, "search", fail)
        report = ingestion.refresh_global_jobs(db)
        assert report.dry_run is True
        assert report.postings_seen == 0
        assert any("DRY RUN" in e for e in report.errors)

    def test_dry_run_reports_what_it_would_spend(self, db):
        report = ingestion.refresh_global_jobs(db, roles=["a", "b", "c"])
        # Roles are listed as what *would* be swept; no run happens.
        assert len(report.roles_searched) == 3
        assert report.runs_completed == 0
        assert report.apify_cost_usd == 0.0

    def test_live_run_without_key_fetches_nothing(self, db, monkeypatch):
        monkeypatch.setattr(ingestion.apify_jobs, "is_configured", lambda: False)
        report = ingestion.refresh_global_jobs(db, dry_run=False)
        assert report.postings_seen == 0
        assert any("APIFY_API_TOKEN" in e for e in report.errors)

    def test_cost_uses_measured_tokens(self):
        report = ingestion.SweepReport(input_tokens=1_000_000, output_tokens=1_000_000)
        # Haiku at $1/$5 per MTok, halved by the Batch API.
        assert report.claude_cost_usd() == 3.0

    def test_total_cost_includes_apify(self):
        """The Apify half is what the API billed, not a projection."""
        report = ingestion.SweepReport(apify_cost_usd=1.14, input_tokens=1_000_000)
        assert report.total_cost_usd() == 1.64

    def test_sweep_ceiling_stops_the_loop(self, db, monkeypatch):
        """max_total_charge_usd is per RUN; without this a nine-role sweep
        under a $1 per-run cap could still reach $9."""
        monkeypatch.setattr(ingestion, "MAX_SWEEP_COST_USD", 0.30)
        monkeypatch.setattr(
            ingestion.apify_jobs, "search",
            lambda role, locations=None: SimpleNamespace(
                items=[], cost_usd=0.127, run_id="r", status="SUCCEEDED"),
        )
        monkeypatch.setattr(ingestion.apify_jobs, "normalise_items", lambda i, r: [])
        report = ingestion.SweepReport(dry_run=False)
        ingestion._collect(db, ["a", "b", "c", "d", "e"], report)
        assert report.stopped_on_budget is True
        assert report.runs_completed == 3  # stops once accumulated cost passes 0.30
        assert report.apify_cost_usd < 0.50

    def test_cost_is_zero_for_an_unpriced_model(self, monkeypatch):
        """Better to report nothing than a figure from a stale rate table."""
        monkeypatch.setattr(enrichment, "enrichment_model", lambda: "some-other-model")
        assert ingestion.SweepReport(input_tokens=1_000_000).claude_cost_usd() == 0.0


class TestSweepFlow:
    def test_skips_batch_entirely_when_nothing_is_new(self, db, monkeypatch):
        """The end-to-end version of the dedup lever: a re-run over postings
        already held must not create a batch at all."""
        digest = ingestion.content_hash("Acme", "Engineer", "Remote")
        add_listing(db, digest, enriched=True)

        monkeypatch.setattr(ingestion.apify_jobs, "is_configured", lambda: True)
        monkeypatch.setattr(
            ingestion.apify_jobs, "search",
            lambda role, locations=None: SimpleNamespace(items=[{"raw": 1}], cost_usd=0.127, run_id="r1", status="SUCCEEDED"),
        )
        monkeypatch.setattr(
            ingestion.apify_jobs, "normalise_items",
            lambda items, role: [{
                "query_key": role, "external_id": "x", "title": "Engineer", "company": "Acme",
                "location": "Remote", "work_mode": "Remote", "apply_url": "https://e.com/j",
                "description": "d", "skills": "[]", "posted_at": None,
            }],
        )

        def fail(*a, **k):
            raise AssertionError("must not create a batch when nothing is new")

        monkeypatch.setattr(ingestion, "_enrich", fail)
        report = ingestion.refresh_global_jobs(db, roles=["ai engineer"], dry_run=False)
        assert report.already_known == 1
        assert report.newly_enriched == 0

    def test_quota_exhaustion_keeps_earlier_results(self, db, monkeypatch):
        """A mid-sweep quota failure must not discard roles already paid for."""
        calls = {"n": 0}

        def flaky(role, locations=None):
            calls["n"] += 1
            if calls["n"] > 1:
                raise ingestion.apify_jobs.ApifyUnavailable("actor failed")
            return SimpleNamespace(items=[{}], cost_usd=0.127, run_id="r1", status="SUCCEEDED")

        monkeypatch.setattr(ingestion.apify_jobs, "search", flaky)
        monkeypatch.setattr(
            ingestion.apify_jobs, "normalise_items",
            lambda items, role: [{"title": "T", "company": "C", "location": "L"}],
        )
        report = ingestion.SweepReport(dry_run=False)
        candidates = ingestion._collect(db, ["a", "b", "c"], report)
        assert len(candidates) == 1
        assert report.runs_completed == 1
        assert len(report.errors) == 2

    def test_same_posting_under_two_roles_enriched_once(self, db, monkeypatch):
        monkeypatch.setattr(
            ingestion.apify_jobs, "search",
            lambda role, locations=None: SimpleNamespace(items=[{}], cost_usd=0.127, run_id="r1", status="SUCCEEDED"),
        )
        monkeypatch.setattr(
            ingestion.apify_jobs, "normalise_items",
            lambda items, role: [{"title": "Engineer", "company": "Acme", "location": "Remote"}],
        )
        report = ingestion.SweepReport(dry_run=False)
        candidates = ingestion._collect(db, ["ai engineer", "ml engineer"], report)
        assert report.postings_seen == 2
        assert len(candidates) == 1


class TestEvidenceOnlyAccompaniesAVerdict:
    """Regression: two live rows came back `unmentioned` carrying a quote.

    A quote rendered under a "not mentioned" label reads as a finding the
    classification explicitly declined to make — the worst outcome for a field
    people use to decide whether to apply.
    """

    def _message(self, payload):
        return SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", input=payload)],
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        )

    def test_unmentioned_never_keeps_a_quote(self):
        result = enrichment.parse_enrichment(
            self._message({
                "h1b_sponsorship": "unmentioned",
                "h1b_evidence": "Candidates must meet work authorization requirements.",
                "core_skills": [],
            })
        )
        assert result["h1b_sponsorship"] == "unmentioned"
        assert result["h1b_evidence"] == ""

    def test_a_real_verdict_keeps_its_quote(self):
        result = enrichment.parse_enrichment(
            self._message({
                "h1b_sponsorship": "no_sponsorship",
                "h1b_evidence": "We are unable to sponsor visas.",
                "core_skills": [],
            })
        )
        assert result["h1b_evidence"] == "We are unable to sponsor visas."
