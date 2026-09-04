"""What the user sees when Claude is unreachable.

This was found live rather than theorised: the Anthropic account ran out of
credits, every LLM-backed route began raising anthropic.BadRequestError, and
the cover-letter route — which catches RuntimeError for the missing-key case
— let it through as a bare 500.

The root cause is that llm_client.available is a config check
(`self._client is not None`), so a key that is present but unusable reads as
"available" right up until the call fails. That is not worth replacing with a
health check (which costs a request and goes stale); what matters is that the
failure, whenever it happens, reaches the user as something true.

A 500 says "we are broken". These failures are mostly "not right now", and
the difference decides whether someone retries or leaves.
"""

import anthropic
import httpx
import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.main import app

# A route that fails the way the real ones do. Registered once, driven by a
# module-level exception so each test can pick the failure it wants.
_boom: Exception | None = None
_probe = APIRouter()


@_probe.get("/api/_test/llm")
def _explode():
    assert _boom is not None
    raise _boom


app.include_router(_probe)


def _api_error(cls, status: int, message: str) -> anthropic.APIStatusError:
    """Build a real SDK exception, not a stand-in.

    The handler branches on the SDK's own class hierarchy, so a fake would
    prove nothing about whether the branches match reality.
    """
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, json={"error": {"message": message}})
    return cls(message, response=response, body=None)


@pytest.fixture
def client():
    # raise_server_exceptions=False so the app's handler runs instead of the
    # test client re-raising, which is what a real client would experience.
    return TestClient(app, raise_server_exceptions=False)


def _run(client, exc: Exception):
    global _boom
    _boom = exc
    try:
        return client.get("/api/_test/llm")
    finally:
        _boom = None


class TestTheUserGetsSomethingTrue:
    def test_a_billing_or_auth_failure_is_503_not_500(self, client):
        """The exact live failure. BadRequestError is not RuntimeError, so
        the cover-letter route's handler missed it and FastAPI returned a
        bare 500."""
        response = _run(client, _api_error(anthropic.BadRequestError, 400, "credit balance is too low"))

        assert response.status_code == 503, "a billing failure still reads as a server bug"
        assert "temporarily unavailable" in response.json()["detail"]

    def test_rate_limiting_is_429_because_waiting_actually_helps(self, client):
        """Distinct from 503 on purpose: this one is worth retrying, and the
        status code is how a client knows that without parsing prose."""
        response = _run(client, _api_error(anthropic.RateLimitError, 429, "rate limit"))

        assert response.status_code == 429
        assert "in a minute" in response.json()["detail"]

    def test_an_unreachable_api_is_503(self, client):
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        response = _run(client, anthropic.APIConnectionError(request=request))

        assert response.status_code == 503
        assert "Couldn't reach" in response.json()["detail"]


class TestNothingLeaksToTheClient:
    def test_the_billing_message_never_reaches_the_user(self, client):
        """Anthropic's own error text can name the account and its billing
        state. It belongs in the log, not in a response body a browser can
        read."""
        response = _run(
            client,
            _api_error(anthropic.BadRequestError, 400, "Your credit balance is too low"),
        )

        body = response.text.lower()
        for leak in ("credit", "balance", "billing", "anthropic", "api key"):
            assert leak not in body, f"the response body leaked {leak!r}"

    def test_the_operator_still_gets_the_real_reason(self, client, caplog):
        with caplog.at_level("ERROR"):
            _run(client, _api_error(anthropic.BadRequestError, 400, "credit balance is too low"))

        logged = caplog.text
        assert "LLM call failed" in logged
        assert "BadRequestError" in logged, "the log does not say what actually broke"


def test_non_llm_failures_are_untouched(client):
    """The handler must not widen into a catch-all. An ordinary bug is still
    a 500 — dressing it up as 'temporarily unavailable' would tell the user
    to retry something that will never work."""
    response = _run(client, ValueError("an ordinary bug"))

    assert response.status_code == 500
    assert response.json()["detail"] == "Internal server error"
