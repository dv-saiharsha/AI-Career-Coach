"""Voice Interview's speech-to-text step — Deepgram Nova-3, called once per
accepted recording.

This module's only job is turning audio into a plain transcript string plus
a few honestly-derived observations about how it was spoken. What happens
after a transcript is accepted is deliberately not this module's concern:
the accepted text enters the Interview Engine as ordinary `answer_text`,
identical to a typed answer, through the existing /evaluate endpoint. No
audio is ever written to disk or the database — bytes arrive in a request,
are sent to Deepgram, and are discarded once this function returns.
"""

import logging
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"

# Interjections Deepgram's own filler_words feature is documented to
# recognize ("uh" and "um") plus their common transcribed spellings.
# Deliberately not a broader list (e.g. "like", "you know") — those are
# ordinary words in plenty of legitimate sentences, and counting them as
# fillers would overstate a candidate's disfluency for the wrong reason.
FILLER_WORDS = {"uh", "um", "umm", "uhh", "mm", "mhmm", "hmm"}

# A gap this long between two spoken words reads as a real pause, not
# ordinary speaking cadence.
LONG_PAUSE_THRESHOLD_SECONDS = 2.5

MAX_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 1.5

# Retried: a timeout or a 5xx is Deepgram's transient trouble, not a
# property of this audio, so trying again is likely to succeed. A 4xx (bad
# or unsupported audio) fails the same way every time, so retrying it would
# only add latency to a request that was never going to succeed.
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class TranscriptionError(RuntimeError):
    """Message is written to be shown to the user directly."""


def available() -> bool:
    return bool(settings.DEEPGRAM_API_KEY)


def _post_with_retry(client: httpx.Client, audio_bytes: bytes, content_type: str) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.post(
                DEEPGRAM_URL,
                params={
                    "model": "nova-3",
                    "smart_format": "true",
                    "filler_words": "true",
                    "punctuate": "true",
                },
                headers={
                    "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
                    "Content-Type": content_type,
                },
                content=audio_bytes,
            )
        except httpx.TimeoutException as exc:
            last_exc = exc
            if attempt < MAX_ATTEMPTS:
                logger.warning("deepgram: timeout on attempt %s, retrying", attempt)
                time.sleep(RETRY_BACKOFF_SECONDS)
                continue
            break
        except httpx.TransportError as exc:
            last_exc = exc
            if attempt < MAX_ATTEMPTS:
                logger.warning("deepgram: transport error on attempt %s, retrying", attempt, exc_info=True)
                time.sleep(RETRY_BACKOFF_SECONDS)
                continue
            break

        if response.status_code in _RETRYABLE_STATUS and attempt < MAX_ATTEMPTS:
            logger.warning("deepgram: retryable status %s on attempt %s", response.status_code, attempt)
            time.sleep(RETRY_BACKOFF_SECONDS)
            continue
        return response

    raise TranscriptionError("Could not reach the transcription service. Please try again.") from last_exc


def _voice_metrics(alternative: dict, duration: float | None) -> dict:
    """Every field is computed independently and left out entirely if its
    inputs are missing or degenerate — an omitted metric, not a fabricated
    one. Filler-word count is our own deterministic match against
    Deepgram's returned word list (see FILLER_WORDS), not a vendor-supplied
    flag, since Deepgram surfaces fillers as ordinary word entries rather
    than a separately tagged field.
    """
    words = alternative.get("words") or []
    metrics: dict = {}

    if isinstance(duration, (int, float)) and duration > 0:
        metrics["speaking_duration_seconds"] = round(duration, 1)

    confidence = alternative.get("confidence")
    if isinstance(confidence, (int, float)):
        metrics["average_confidence"] = round(float(confidence), 3)

    if words and isinstance(duration, (int, float)) and duration > 0:
        metrics["speaking_rate_wpm"] = round(len(words) / (duration / 60.0), 1)

    timed_words = [
        w for w in words if isinstance(w.get("start"), (int, float)) and isinstance(w.get("end"), (int, float))
    ]
    if len(timed_words) >= 2:
        metrics["long_pause_count"] = sum(
            1
            for prev, nxt in zip(timed_words, timed_words[1:])
            if (nxt["start"] - prev["end"]) >= LONG_PAUSE_THRESHOLD_SECONDS
        )

    if words:
        metrics["filler_word_count"] = sum(
            1 for w in words if (w.get("word") or "").strip().lower() in FILLER_WORDS
        )

    return metrics


def transcribe(audio_bytes: bytes, content_type: str) -> dict:
    """Returns {"transcript": str, "voice_metrics": dict}.

    Raises TranscriptionError — with a message safe to show the user
    directly — if voice transcription isn't configured, Deepgram is
    unreachable after retries, or the recording contains no detectable
    speech. Never falls back to a fabricated transcript.
    """
    if not available():
        raise TranscriptionError("Voice transcription is not configured.")
    if not audio_bytes:
        raise TranscriptionError("No audio was recorded.")

    try:
        with httpx.Client(timeout=settings.DEEPGRAM_TIMEOUT_SECONDS) as client:
            response = _post_with_retry(client, audio_bytes, content_type)
    except TranscriptionError:
        raise
    except Exception as exc:
        logger.warning("deepgram: request failed", exc_info=True)
        raise TranscriptionError("Could not reach the transcription service. Please try again.") from exc

    if response.status_code != 200:
        logger.warning("deepgram: non-200 response %s: %s", response.status_code, response.text[:500])
        if response.status_code in (400, 415):
            raise TranscriptionError("That recording could not be transcribed — try re-recording.")
        raise TranscriptionError("The transcription service is temporarily unavailable. Please try again.")

    try:
        data = response.json()
        alternative = data["results"]["channels"][0]["alternatives"][0]
        transcript = (alternative.get("transcript") or "").strip()
        duration = (data.get("metadata") or {}).get("duration")
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        logger.warning("deepgram: unexpected response shape", exc_info=True)
        raise TranscriptionError("Could not read the transcription result. Please try again.") from exc

    if not transcript:
        raise TranscriptionError("No speech was detected in that recording — try re-recording.")

    return {"transcript": transcript, "voice_metrics": _voice_metrics(alternative, duration)}
