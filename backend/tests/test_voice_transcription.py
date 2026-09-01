"""Milestone 7 — Voice Interview's speech-to-text step.

Every test drives voice.transcribe() through a real httpx.Client wired to
httpx.MockTransport, so the actual request-building code (query params,
headers, retry loop) runs — not just the top-level function signature.
No live network, no real Deepgram key needed.
"""

import httpx
import pytest

from app.core.config import settings
from app.modules.interview_coach import voice


def _response(status_code: int, json_body: dict | None = None, text: str = "") -> httpx.Response:
    if json_body is not None:
        return httpx.Response(status_code, json=json_body)
    return httpx.Response(status_code, text=text)


def _install_transport(monkeypatch, handler):
    """Patches httpx.Client so voice.py's own `with httpx.Client(...)` picks
    up a MockTransport instead of opening a real socket."""
    real_client_cls = httpx.Client

    def fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client_cls(*args, **kwargs)

    monkeypatch.setattr(voice.httpx, "Client", fake_client)


DEEPGRAM_OK_BODY = {
    "metadata": {"duration": 12.0},
    "results": {
        "channels": [
            {
                "alternatives": [
                    {
                        "transcript": "so um I built a caching layer",
                        "confidence": 0.94,
                        "words": [
                            {"word": "so", "start": 0.0, "end": 0.2, "confidence": 0.9},
                            {"word": "um", "start": 0.2, "end": 0.4, "confidence": 0.8},
                            {"word": "i", "start": 4.0, "end": 4.1, "confidence": 0.95},
                            {"word": "built", "start": 4.1, "end": 4.4, "confidence": 0.97},
                            {"word": "a", "start": 4.4, "end": 4.5, "confidence": 0.9},
                            {"word": "caching", "start": 4.5, "end": 5.0, "confidence": 0.9},
                            {"word": "layer", "start": 5.0, "end": 5.3, "confidence": 0.9},
                        ],
                    }
                ]
            }
        ]
    },
}


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "test-key")
    yield


def test_available_reflects_configured_key(monkeypatch):
    assert voice.available() is True
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "")
    assert voice.available() is False


def test_transcribe_raises_immediately_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "DEEPGRAM_API_KEY", "")
    with pytest.raises(voice.TranscriptionError, match="not configured"):
        voice.transcribe(b"fake-audio-bytes", "audio/webm")


def test_transcribe_rejects_empty_audio():
    with pytest.raises(voice.TranscriptionError, match="No audio"):
        voice.transcribe(b"", "audio/webm")


def test_successful_transcription_returns_transcript_and_metrics(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["Authorization"] == "Token test-key"
        assert "filler_words=true" in str(request.url)
        assert "model=nova-3" in str(request.url)
        return _response(200, DEEPGRAM_OK_BODY)

    _install_transport(monkeypatch, handler)

    result = voice.transcribe(b"fake-audio-bytes", "audio/webm")

    assert len(calls) == 1
    assert result["transcript"] == "so um I built a caching layer"
    metrics = result["voice_metrics"]
    assert metrics["speaking_duration_seconds"] == 12.0
    assert metrics["average_confidence"] == 0.94
    assert metrics["speaking_rate_wpm"] == pytest.approx(7 / (12.0 / 60.0), abs=0.1)
    assert metrics["filler_word_count"] == 1  # only "um"
    # The 0.4s -> 4.0s gap (3.6s) clears the 2.5s long-pause threshold.
    assert metrics["long_pause_count"] == 1


def test_missing_confidence_and_duration_are_omitted_not_fabricated(monkeypatch):
    body = {
        "metadata": {},  # no duration
        "results": {"channels": [{"alternatives": [{"transcript": "hello there", "words": []}]}]},
    }
    _install_transport(monkeypatch, lambda req: _response(200, body))

    result = voice.transcribe(b"fake-audio-bytes", "audio/webm")

    assert result["transcript"] == "hello there"
    assert result["voice_metrics"] == {}  # nothing fabricated when inputs are missing


def test_no_speech_detected_raises(monkeypatch):
    body = {
        "metadata": {"duration": 3.0},
        "results": {"channels": [{"alternatives": [{"transcript": "", "confidence": 0.0, "words": []}]}]},
    }
    _install_transport(monkeypatch, lambda req: _response(200, body))

    with pytest.raises(voice.TranscriptionError, match="No speech was detected"):
        voice.transcribe(b"fake-audio-bytes", "audio/webm")


def test_retries_on_transient_5xx_then_succeeds(monkeypatch):
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            return _response(503, text="service unavailable")
        return _response(200, DEEPGRAM_OK_BODY)

    _install_transport(monkeypatch, handler)
    monkeypatch.setattr(voice, "RETRY_BACKOFF_SECONDS", 0)  # don't slow the test suite down

    result = voice.transcribe(b"fake-audio-bytes", "audio/webm")

    assert attempts["count"] == 2
    assert result["transcript"] == "so um I built a caching layer"


def test_does_not_retry_a_4xx_bad_request(monkeypatch):
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        return _response(400, text="unsupported audio")

    _install_transport(monkeypatch, handler)
    monkeypatch.setattr(voice, "RETRY_BACKOFF_SECONDS", 0)

    with pytest.raises(voice.TranscriptionError, match="could not be transcribed"):
        voice.transcribe(b"fake-audio-bytes", "audio/webm")

    assert attempts["count"] == 1  # no wasted retry on a request that will never succeed


def test_exhausting_retries_on_persistent_5xx_raises_clear_error(monkeypatch):
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        return _response(500, text="internal error")

    _install_transport(monkeypatch, handler)
    monkeypatch.setattr(voice, "RETRY_BACKOFF_SECONDS", 0)

    with pytest.raises(voice.TranscriptionError, match="temporarily unavailable"):
        voice.transcribe(b"fake-audio-bytes", "audio/webm")

    assert attempts["count"] == voice.MAX_ATTEMPTS


def test_timeout_is_retried_then_raises(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    _install_transport(monkeypatch, handler)
    monkeypatch.setattr(voice, "RETRY_BACKOFF_SECONDS", 0)

    with pytest.raises(voice.TranscriptionError, match="Could not reach"):
        voice.transcribe(b"fake-audio-bytes", "audio/webm")


def test_malformed_response_shape_raises_clear_error(monkeypatch):
    _install_transport(monkeypatch, lambda req: _response(200, {"unexpected": "shape"}))

    with pytest.raises(voice.TranscriptionError, match="Could not read"):
        voice.transcribe(b"fake-audio-bytes", "audio/webm")


def test_no_long_pause_counted_for_ordinary_cadence():
    alternative = {
        "confidence": 0.9,
        "words": [
            {"word": "hello", "start": 0.0, "end": 0.3, "confidence": 0.9},
            {"word": "world", "start": 0.4, "end": 0.7, "confidence": 0.9},  # 0.1s gap
        ],
    }
    metrics = voice._voice_metrics(alternative, duration=1.0)
    assert metrics["long_pause_count"] == 0
