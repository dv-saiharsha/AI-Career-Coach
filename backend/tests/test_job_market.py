"""Job feed tests — no network, no spend.

The fixture below mirrors khadinakbar/google-jobs-scraper's documented output
schema. Only five fields are guaranteed non-null (job_title, is_remote,
search_query, source_url, scraped_at), so the sparse item is not an edge case
being padded out — it is the shape the actor says to expect, and the one most
likely to slip through as a silent data bug.
"""


import pytest


# A full item and a minimal one carrying only the guaranteed fields.


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

    def _add(self, db, query_key, hours_old, title="Engineer", posted_hours=1):
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
            posted_at=(
                None if posted_hours is None
                else datetime.now(timezone.utc) - timedelta(hours=posted_hours)
            ),
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

    def test_ordered_by_when_the_job_was_posted(self, db_session):
        """Ordering is on posted_at, not fetched_at. Every row from one sweep
        shares a fetched_at, so sorting on it leaves the grid in arbitrary
        order while looking sorted."""
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "software engineer", hours_old=1, title="Posted 3d ago", posted_hours=72)
        self._add(db_session, "software engineer", hours_old=1, title="Posted 1h ago", posted_hours=1)
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["Posted 1h ago", "Posted 3d ago"]

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

        assert "quantum hardware engineer" not in WARM_ROLES
        self._add(db_session, "quantum hardware engineer", hours_old=1, title="Wanted")
        rows, _ = _warm_feed(db_session, ["Quantum Hardware Engineer"])
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

    def test_postings_older_than_the_cap_are_suppressed(self, db_session):
        """An expired listing wastes an application, so age excludes rather
        than demotes — and the cap applies to every read path, not just this
        one."""
        from app.core.config import settings
        from app.modules.job_market.services import _warm_feed

        over = (settings.JOB_MAX_AGE_DAYS + 3) * 24
        self._add(db_session, "software engineer", hours_old=1, title="Too old", posted_hours=over)
        self._add(db_session, "software engineer", hours_old=1, title="Recent", posted_hours=12)
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["Recent"]

    def test_undated_postings_are_kept(self, db_session):
        """A missing date is unknown age, not old age — dropping these would
        silently hide every posting whose source omitted one."""
        from app.modules.job_market.services import _warm_feed

        self._add(db_session, "software engineer", hours_old=1, title="No date", posted_hours=None)
        rows, _ = _warm_feed(db_session, None)
        assert [r.title for r in rows] == ["No date"]

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
