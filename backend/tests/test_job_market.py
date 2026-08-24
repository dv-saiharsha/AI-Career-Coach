"""Job feed tests — no network, no spend.

The fixture below mirrors khadinakbar/google-jobs-scraper's documented output
schema. Only five fields are guaranteed non-null (job_title, is_remote,
search_query, source_url, scraped_at), so the sparse item is not an edge case
being padded out — it is the shape the actor says to expect, and the one most
likely to slip through as a silent data bug.
"""

import json

import pytest

from app.modules.job_market import apify, services

# A full item and a minimal one carrying only the guaranteed fields.
FIXTURE_ITEMS = [
    {
        "job_title": "Senior Machine Learning Engineer",
        "company_name": "Anthropic",
        "location": "San Francisco, CA",
        "is_remote": False,
        "employment_type": "Full-time",
        "salary_range": "$250K - $350K a year",
        "salary_min": 250000,
        "salary_max": 350000,
        "salary_period": "year",
        "date_posted": "2026-08-10T00:00:00Z",
        "job_description": (
            "We are hiring an ML Engineer. You will work with PyTorch and Kubernetes "
            "on large-scale training. Experience with Python and CI/CD required. "
            "Familiarity with Ray or Spark is a plus."
        ),
        "highlights": {"Qualifications": ["5+ years with PyTorch", "Strong SQL"]},
        "apply_link": "https://example.com/apply/1",
        "via_platform": "LinkedIn",
        "search_query": "ml engineer",
        "source_url": "https://example.com/job/1",
        "scraped_at": "2026-08-12T06:00:00Z",
    },
    {
        # Everything nullable is null — the documented worst case.
        "job_title": "Remote Data Scientist",
        "is_remote": True,
        "search_query": "data scientist",
        "source_url": "https://example.com/job/2",
        "scraped_at": "2026-08-12T06:00:00Z",
        "company_name": None,
        "location": None,
        "salary_range": None,
        "salary_min": None,
        "salary_max": None,
        "date_posted": None,
        "job_description": None,
        "apply_link": None,
    },
]


class TestNormaliseQuery:
    def test_strips_seniority_and_punctuation(self):
        assert services.normalise_query("Senior ML Engineer!") == "ml engineer"

    def test_collapses_to_same_cache_key(self):
        """The whole point: near-identical searches must not bill twice."""
        variants = ["ML Engineer", "  ml   engineer ", "Staff ML Engineer", "Sr. ML Engineer"]
        keys = {services.normalise_query(v) for v in variants}
        assert keys == {"ml engineer"}


class TestWorkMode:
    def test_is_remote_flag_wins(self):
        assert apify.infer_work_mode({"is_remote": True, "location": "NYC"}) == "Remote"

    def test_hybrid_detected_from_text(self):
        raw = {"is_remote": False, "location": "Austin, TX (Hybrid)"}
        assert apify.infer_work_mode(raw) == "Hybrid"

    def test_defaults_to_onsite(self):
        assert apify.infer_work_mode({"is_remote": False, "location": "Austin, TX"}) == "On-site"

    def test_handles_all_nulls(self):
        assert apify.infer_work_mode({"is_remote": False}) == "On-site"


class TestSalary:
    def test_prefers_preformatted_range(self):
        assert apify.derive_salary({"salary_range": "$100K - $120K"}) == "$100K - $120K"

    def test_rebuilds_from_parts(self):
        raw = {"salary_min": 100000, "salary_max": 120000, "salary_period": "year"}
        assert apify.derive_salary(raw) == "$100,000 - $120,000/year"

    def test_single_bound(self):
        assert apify.derive_salary({"salary_min": 90000}) == "$90,000"

    def test_none_when_absent(self):
        assert apify.derive_salary({"salary_min": None, "salary_max": None}) is None


class TestNormaliseItem:
    def test_maps_full_item(self):
        row = apify.normalise_item(FIXTURE_ITEMS[0], "ml engineer")
        assert row is not None
        assert row["title"] == "Senior Machine Learning Engineer"
        assert row["company"] == "Anthropic"
        assert row["work_mode"] == "On-site"
        assert row["apply_url"] == "https://example.com/apply/1"
        skills = json.loads(row["skills"])
        assert "PyTorch" in skills
        assert len(skills) <= apify.MAX_SKILLS

    def test_sparse_item_survives(self):
        """A null-heavy row is still a row we paid for — it must not be dropped."""
        row = apify.normalise_item(FIXTURE_ITEMS[1], "data scientist")
        assert row is not None
        assert row["company"] == "Company not listed"
        assert row["location"] == "Location not specified"
        assert row["work_mode"] == "Remote"
        assert row["salary_range"] is None
        assert json.loads(row["skills"]) == []

    def test_falls_back_to_source_url_when_apply_link_null(self):
        row = apify.normalise_item(FIXTURE_ITEMS[1], "data scientist")
        assert row["apply_url"] == "https://example.com/job/2"

    def test_drops_item_with_no_title(self):
        assert apify.normalise_item({"source_url": "https://x.com/1"}, "q") is None

    def test_drops_item_with_no_url(self):
        assert apify.normalise_item({"job_title": "Engineer"}, "q") is None

    @pytest.mark.parametrize("value", ["3 days ago", "", None, "not-a-date"])
    def test_unparseable_date_becomes_none(self, value):
        """Relative strings must not be fabricated into timestamps."""
        assert apify.parse_posted_at({"date_posted": value}) is None

    def test_iso_date_parsed(self):
        parsed = apify.parse_posted_at({"date_posted": "2026-08-10T00:00:00Z"})
        assert parsed is not None and parsed.year == 2026


class TestNormaliseItems:
    def test_dedupes_on_apply_url(self):
        dupes = [FIXTURE_ITEMS[0], dict(FIXTURE_ITEMS[0])]
        assert len(apify.normalise_items(dupes, "ml engineer")) == 1

    def test_skips_unusable_rows(self):
        items = [*FIXTURE_ITEMS, {"is_remote": True}]
        assert len(apify.normalise_items(items, "q")) == 2


class TestNoSpendWithoutToken:
    def test_run_actor_refuses_without_token(self, monkeypatch):
        """The guard that keeps a tokenless environment from ever calling out."""
        monkeypatch.setattr(apify.settings, "APIFY_API_TOKEN", "")
        assert apify.is_configured() is False
        with pytest.raises(apify.ApifyUnavailable):
            apify.run_actor("ml engineer", 10)


class TestClientContract:
    """Pin the kwargs run_actor passes against the installed apify-client.

    Written after shipping `timeout_secs`, which does not exist on this
    version: every warm-role run raised TypeError at call time. That failed
    safe (nothing billed), but the same mistake on a kwarg the client silently
    accepts and ignores — a cap, say — would fail *open* and bill. An SDK
    upgrade renaming any of these should break here, not in production.
    """

    REQUIRED_KWARGS = (
        "run_input",
        "max_items",             # billable-result ceiling
        "max_total_charge_usd",  # hard spend ceiling
        "run_timeout",
        "wait_duration",
        "logger",
    )

    # Attributes read off the Run object returned by call(). Run is a pydantic
    # model, not a dict — `run.get("defaultDatasetId")` raised AttributeError
    # *after* the actor had already run and billed, so the charge bought
    # nothing. Reading the result is post-payment code: it has to be right.
    REQUIRED_RUN_FIELDS = ("default_dataset_id", "status", "usage_total_usd")

    def test_call_accepts_every_kwarg_we_pass(self):
        import inspect

        from apify_client import ApifyClient

        params = inspect.signature(ApifyClient("dummy-token").actor("u/n").call).parameters
        missing = [kw for kw in self.REQUIRED_KWARGS if kw not in params]
        assert not missing, f"apify-client no longer accepts: {missing}"

    def test_run_model_exposes_fields_we_read(self):
        from apify_client._models import Run

        missing = [f for f in self.REQUIRED_RUN_FIELDS if f not in Run.model_fields]
        assert not missing, f"Run model no longer exposes: {missing}"

    def test_dataset_page_exposes_items(self):
        """`.items` is how we get the rows we paid for."""
        import dataclasses
        import inspect

        from apify_client import ApifyClient

        client = ApifyClient("dummy-token").dataset("id")
        page_cls = vars(inspect.getmodule(type(client)))["DatasetItemsPage"]
        assert "items" in {f.name for f in dataclasses.fields(page_cls)}


@pytest.fixture
def db_session():
    """In-memory database. StaticPool so every connection sees the same
    file-less database — the default pool would hand out a fresh empty one."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.core.database import Base

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


class TestWarmFeedNeverEmpty:
    """Regression: the default grid hard-filtered on TTL, so once the nightly
    refresh lapsed it returned nothing while a full cache sat in the table —
    the page showed "no matching openings" on top of 140 usable listings.
    """

    def _add(self, db, query_key, hours_old, title="Engineer"):
        from datetime import datetime, timedelta, timezone

        from app.models.job import JobListing

        row = JobListing(
            query_key=query_key,
            external_id=f"{query_key}-{hours_old}-{title}",
            title=title,
            company="Acme",
            location="Remote",
            work_mode="Remote",
            apply_url="https://example.com/job",
            fetched_at=datetime.now(timezone.utc) - timedelta(hours=hours_old),
        )
        db.add(row)
        db.commit()
        return row

    def test_stale_rows_are_served_rather_than_nothing(self, db_session):
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "software engineer", hours_old=500)
        rows, last_updated = _warm_feed(db_session, None)
        assert len(rows) == 1
        # Age is reported so the UI can say the feed is old, which beats
        # showing an empty grid.
        assert last_updated is not None

    def test_fresh_rows_outrank_stale(self, db_session):
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "software engineer", hours_old=500, title="Old")
        self._add(db_session, "software engineer", hours_old=1, title="New")
        rows, _ = _warm_feed(db_session, None)
        assert rows[0].title == "New"

    def test_target_roles_lead_the_feed(self, db_session):
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "software engineer", hours_old=1, title="Generic")
        self._add(db_session, "devops engineer", hours_old=1, title="Wanted")
        rows, _ = _warm_feed(db_session, ["DevOps Engineer"])
        assert rows[0].title == "Wanted"

    def test_target_role_outside_warm_roles_is_included(self, db_session):
        """A role cached from a past search but never warmed must still reach
        the default grid — otherwise the nightly refresh list silently caps
        which roles a profile can ever see.

        Uses a non-software role deliberately: WARM_ROLES covers software
        titles, so an electrical or construction profile is exactly the case
        that would otherwise get someone else's feed.
        """
        from app.modules.job_market.services import WARM_ROLES, _warm_feed

        assert "electrical engineer" not in WARM_ROLES
        self._add(db_session, "electrical engineer", hours_old=1, title="Wanted")
        rows, _ = _warm_feed(db_session, ["Electrical Engineer"])
        assert [r.title for r in rows] == ["Wanted"]

    def test_roles_are_normalised_before_matching(self, db_session):
        """'Senior DevOps Engineer ' must hit the 'devops engineer' key."""
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "devops engineer", hours_old=1, title="Wanted")
        rows, _ = _warm_feed(db_session, ["Senior DevOps Engineer "])
        assert rows and rows[0].title == "Wanted"

    def test_warm_roles_backfill_a_narrow_profile(self, db_session):
        """A one-role profile still gets a full page rather than a thin one."""
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "devops engineer", hours_old=1, title="Wanted")
        self._add(db_session, "software engineer", hours_old=1, title="Backfill")
        rows, _ = _warm_feed(db_session, ["DevOps Engineer"])
        assert {r.title for r in rows} == {"Wanted", "Backfill"}

    def test_first_screen_mixes_roles(self, db_session):
        """Straight sorting groups one role together, so a three-role profile
        opened on ten cards of a single role."""
        from app.modules.job_market.services import _warm_feed

        for role in ("ai engineer", "product manager", "devops engineer"):
            for n in range(5):
                self._add(db_session, role, hours_old=1, title=f"{role}-{n}")
        rows, _ = _warm_feed(db_session, ["AI Engineer", "Product Manager", "DevOps Engineer"])
        assert len({r.query_key for r in rows[:3]}) == 3

    def test_interleave_loses_no_rows(self, db_session):
        from app.modules.job_market.services import _warm_feed

        for role in ("ai engineer", "product manager"):
            for n in range(4):
                self._add(db_session, role, hours_old=1, title=f"{role}-{n}")
        rows, _ = _warm_feed(db_session, ["AI Engineer"])
        assert len(rows) == 8

    def test_empty_cache_still_returns_empty(self, db_session):
        from app.modules.job_market.services import _warm_feed

        rows, last_updated = _warm_feed(db_session, ["AI Engineer"])
        assert rows == [] and last_updated is None

    def test_no_target_roles_falls_back_to_warm_roles(self, db_session):
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "software engineer", hours_old=1, title="Generic")
        rows, _ = _warm_feed(db_session, [])
        assert len(rows) == 1
