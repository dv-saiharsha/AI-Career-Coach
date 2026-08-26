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
