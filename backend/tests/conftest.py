"""Shared test fixtures."""

import pytest

from app.modules.job_market import services


@pytest.fixture(autouse=True)
def _clear_job_feed_cache():
    """Drop the process-local job feed cache around every test.

    The cache is keyed by role set, not by database, so without this one
    test's feed is served to the next — which is exactly the cross-test
    bleed that made three warm-feed tests fail once caching landed.
    """
    services.clear_feed_cache()
    yield
    services.clear_feed_cache()


@pytest.fixture(autouse=True)
def _no_real_ats_board_requests(monkeypatch):
    """No test may reach out to a real ATS board.

    ingestion._collect_boards fetches employers' Greenhouse and Lever boards,
    and it does so without injecting a fetcher — so the moment it was wired
    into the sweep, four tests in test_ingestion.py started making live
    network calls. The suite went from ~24s to 61s and one test failed for a
    reason that had nothing to do with what it was testing.

    Those are somebody else's free endpoints. A test suite has no business
    hammering them on every run, quite apart from the tests then failing
    whenever Greenhouse has a bad afternoon, or passing only when the machine
    running them is online.

    Patched at _default_fetch rather than at fetch_board, so that
    test_ats_boards.py — which injects its own fetcher to exercise the real
    parsing and normalisation — is untouched. Anything that does NOT inject
    one gets a non-200 here, which fetch_board already treats as "this board
    is not available", so callers take their normal empty path rather than
    seeing an exception they would have to learn about.
    """
    from app.modules.job_market import ats_boards

    def refuse(url: str) -> tuple[int, str]:
        return 599, ""

    monkeypatch.setattr(ats_boards, "_default_fetch", refuse)
