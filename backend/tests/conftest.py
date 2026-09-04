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


@pytest.fixture(autouse=True)
def _deterministic_ats_score_when_no_model_is_trained(monkeypatch):
    """Give job-matching and resume-optimisation tests a real score to work
    with when app/ml/models/ats_model.joblib does not exist on this machine.

    That file is gitignored on purpose — a trained model is a build
    artifact, not source — so a fresh checkout (every CI run, and any
    contributor who has not run scripts/train_ats_model.py) genuinely lacks
    it. test_ml_inference.py and test_optimizer.py already handle this
    correctly by skipping outright: they exist specifically to test the real
    model's behaviour, and a fake score would test nothing.

    test_job_matching.py, test_optimize_plan_route.py and one test in
    test_application_tracker.py are different — their own docstrings say so
    ("predict_score has its own tests", "does not re-verify the plan's own
    guarantees"). They exist to test the ORCHESTRATION around a score —
    never fabricating a dimension that cannot run, overall_match reading the
    trained model's own number, the route resolving pasted text vs. a stored
    scan — logic that does not care whether the number came from a real
    model or a stand-in. They were calling the real predict_score anyway,
    which is why they passed on a machine that happens to have a trained
    model on disk and failed in CI, which never will: 6 of the 9 backend
    test failures this surfaced traced to this one gap.

    Guarded on the REAL model_available(), not applied unconditionally, so
    this has zero effect anywhere the real model is present — a developer
    with a trained model still exercises real predictions through these
    same tests, and this fixture only ever substitutes for something that
    would otherwise be entirely missing.

    Deterministic but not constant: a flat score would make every "which
    edit helps most" comparison in optimizer.py degenerate to zero
    difference, silently hiding a real bug in that ranking. Scoring by
    keyword overlap keeps "the JD's terms present in this text" meaningful
    without needing real model weights.
    """
    from app.ml import inference

    if inference.model_available():
        return

    def fake_predict_score(resume_text: str, job_description: str) -> int:
        jd_words = {w for w in job_description.lower().split() if len(w) > 3}
        if not jd_words:
            return 50
        resume_words = set(resume_text.lower().split())
        overlap = len(jd_words & resume_words) / len(jd_words)
        return round(max(5.0, min(95.0, overlap * 100)))

    for module_path in (
        "app.modules.job_market.matching",
        "app.modules.resume_builder.optimizer",
    ):
        module = __import__(module_path, fromlist=["_"])
        monkeypatch.setattr(module, "model_available", lambda: True)
        monkeypatch.setattr(module, "predict_score", fake_predict_score)
