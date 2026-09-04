"""Job feed tests — no network, no spend."""


import pytest


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


class TestJobSourceDefault:
    """The default value of JOB_SOURCE, not an overridden one.

    Regression: it was "apify" — stale from before Apify was removed in
    favour of employer boards plus this budgeted aggregator — and
    _source()/_fetch() in services.py only ever recognised "jsearch". Nothing
    in the live .env sets JOB_SOURCE explicitly, so every on-demand search
    (any role outside the pre-warmed set) raised SourceUnavailable on the
    Settings object's own default, in whichever environment never happened to
    override it. Testing the Settings default directly, not a value passed
    into the function under test, is the point: overriding JOB_SOURCE in the
    test setup would make this pass while the real bug — what ships when
    nobody sets it — stayed broken.
    """

    def test_the_default_is_a_source_the_code_actually_recognises(self):
        from app.core.config import Settings

        default_source = Settings.model_fields["JOB_SOURCE"].default
        assert default_source == "jsearch", (
            f"JOB_SOURCE defaults to {default_source!r}, which "
            "_fetch()/_source_configured() do not recognise — every caller "
            "that never overrides it hits SourceUnavailable on this exact "
            "default"
        )

    def test_the_unconfigured_default_does_not_raise_unknown_source(self, monkeypatch):
        """End-to-end version of the same assertion: drive it through the
        real function with settings exactly as a fresh checkout would load
        them, not a mocked-in value chosen to make the test pass."""
        from app.core.config import Settings, settings
        from app.modules.job_market import jsearch, services

        # Read off the model rather than hardcoded "jsearch" here too, so
        # this stays pinned to whatever config.py actually declares as the
        # default rather than to what this test expects it to be.
        live_default = Settings.model_fields["JOB_SOURCE"].default
        monkeypatch.setattr(settings, "JOB_SOURCE", live_default)
        monkeypatch.setattr(jsearch, "is_configured", lambda: False)

        with pytest.raises(services.SourceUnavailable) as exc_info:
            services._fetch("backend engineer", limit=10)

        # It must fail because the API key genuinely isn't set in this test —
        # not because JOB_SOURCE itself was unrecognised, which is the
        # failure mode the original bug produced regardless of whether a key
        # was configured.
        assert "unknown JOB_SOURCE" not in str(exc_info.value)
        assert "RAPIDAPI_KEY" in str(exc_info.value)


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
