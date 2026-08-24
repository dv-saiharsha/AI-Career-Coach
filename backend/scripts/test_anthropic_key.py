"""End-to-end check that the configured Anthropic key drives the real AI pipeline.

    node scripts/backend.mjs scripts/test_anthropic_key.py

Deliberately exercises app.core.llm rather than a standalone Anthropic client:
a bare client.messages.create() proves the key authenticates but proves nothing
about the path resume_analyzer and interview_coach actually take. The four
stages below mirror that path in order of increasing specificity, so a failure
localises to a layer instead of just saying "the key is bad".

Reads settings (and therefore backend/.env) instead of os.getenv, because the
key lives in .env and never in the ambient environment on a dev machine — a
plain os.getenv check reports "key missing" on a correctly configured setup.

Exit code is 0 only if every stage passes, so this is safe to gate CI on.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import anthropic  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.llm import llm_client, parse_json_response  # noqa: E402

# Sonnet 5 list price, USD per million tokens. Only used for the run-cost
# readout at the end — this is a smoke test, not a billing source of truth.
INPUT_PER_MTOK = 3.00
OUTPUT_PER_MTOK = 15.00

# Generous relative to what these prompts need. Adaptive thinking is on by
# default on Sonnet 5 and max_tokens bounds thinking + visible text together,
# so a tight cap can truncate the answer before any text block is emitted.
MAX_TOKENS = 1024

PROBE_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string"},
        "module": {"type": "string"},
        "org_connected": {"type": "boolean"},
    },
    "required": ["status", "module", "org_connected"],
}

usage_totals = {"input": 0, "output": 0}
results: list[tuple[str, bool, str]] = []


def record(name: str, passed: bool, detail: str) -> None:
    results.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}: {detail}")


def add_usage(response) -> None:
    usage_totals["input"] += response.usage.input_tokens
    usage_totals["output"] += response.usage.output_tokens


def stage_config() -> bool:
    """Config is loaded and the key is present and well-formed."""
    print("\n[1/4] Configuration")
    key = settings.ANTHROPIC_API_KEY

    if not key:
        record("key present", False, "ANTHROPIC_API_KEY is empty in backend/.env")
        return False
    # Only the fixed prefix is shown. The trailing characters are omitted on
    # purpose: this output ends up in CI logs and terminal scrollback.
    record("key present", True, f"{key[:14]}... ({len(key)} chars)")

    if not key.startswith("sk-ant-"):
        record("key format", False, "does not start with sk-ant- - check for a stray quote or whitespace")
        return False
    record("key format", True, "sk-ant- prefix")

    record("model configured", True, settings.ANTHROPIC_MODEL)
    record("sdk version", True, f"anthropic=={anthropic.__version__}")

    if not llm_client.available:
        record("client wired", False, "llm_client.available is False - settings did not reach ClaudeClient")
        return False
    record("client wired", True, "app.core.llm.llm_client is live")
    return True


def stage_auth() -> bool:
    """The key authenticates against the configured model."""
    print("\n[2/4] Authentication")
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    started = time.monotonic()
    try:
        response = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
        )
    except anthropic.AuthenticationError as exc:
        record("authenticate", False, f"key rejected (401): {exc}")
        return False
    except anthropic.NotFoundError as exc:
        record(
            "authenticate",
            False,
            f"model '{settings.ANTHROPIC_MODEL}' not found (404) - likely retired or misspelled: {exc}",
        )
        return False
    except anthropic.PermissionDeniedError as exc:
        record("authenticate", False, f"key lacks access to this model (403): {exc}")
        return False
    except anthropic.APIError as exc:
        record("authenticate", False, f"{type(exc).__name__}: {exc}")
        return False

    add_usage(response)
    elapsed = time.monotonic() - started
    record("authenticate", True, f"{response.model} responded in {elapsed:.2f}s")

    # Worth asserting explicitly: the pinned SDK (0.39.0) predates Sonnet 5's
    # thinking blocks. If it mis-parses the response envelope this is where it
    # surfaces, rather than as a confusing empty string inside a resume report.
    block_types = sorted({block.type for block in response.content})
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        record("sdk parses response", False, f"no text block returned; blocks={block_types}")
        return False
    record("sdk parses response", True, f"blocks={block_types}, text={text[:40]!r}")
    return True


def stage_tool_json() -> bool:
    """The schema-enforced path (complete_tool_json) returns valid structure.

    This is the path both live modules prefer, so it is the one that matters.
    """
    print("\n[3/4] Structured extraction - complete_tool_json (production path)")
    try:
        parsed = llm_client.complete_tool_json(
            system="You are the Zenith AI engine test harness.",
            user=(
                "Verify the connection. Report status 'ok', module "
                "'API Verification', and org_connected true."
            ),
            tool_name="connection_probe",
            input_schema=PROBE_SCHEMA,
            max_tokens=MAX_TOKENS,
        )
    except anthropic.APIError as exc:
        record("tool schema call", False, f"{type(exc).__name__}: {exc}")
        return False
    except ValueError as exc:
        record("tool schema call", False, f"no tool_use block returned: {exc}")
        return False

    record("tool schema call", True, json.dumps(parsed))

    missing = [k for k in PROBE_SCHEMA["required"] if k not in parsed]
    if missing:
        record("schema conformance", False, f"missing keys: {missing}")
        return False
    record("schema conformance", True, "all required keys present and typed")

    if parsed.get("status") != "ok":
        record("payload value", False, f"status was {parsed.get('status')!r}, expected 'ok'")
        return False
    record("payload value", True, "status == 'ok'")
    return True


def stage_raw_json() -> bool:
    """The legacy path (complete_json + parse_json_response) still works.

    Kept because callers not yet migrated to a tool schema still use it. A
    failure here is not fatal to the key — it is a signal to finish migrating.
    """
    print("\n[4/4] Structured extraction - complete_json (legacy path)")
    try:
        raw = llm_client.complete_json(
            system="You are the Zenith AI engine test harness. Return valid raw JSON only.",
            user='Return this JSON object exactly: {"status": "ok", "module": "API Verification", "org_connected": true}',
            max_tokens=MAX_TOKENS,
        )
    except anthropic.APIError as exc:
        record("raw json call", False, f"{type(exc).__name__}: {exc}")
        return False

    record("raw json call", True, f"{len(raw)} chars returned")

    try:
        parsed = parse_json_response(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        record("raw json parse", False, f"{exc} - this is the ~48% failure mode noted in llm.py")
        return False

    record("raw json parse", True, json.dumps(parsed))
    return True


def main() -> None:
    print("=" * 68)
    print("ZENITH - ANTHROPIC API KEY INTEGRATION TEST")
    print("=" * 68)

    if not stage_config():
        summarise()
    if not stage_auth():
        summarise()
    stage_tool_json()
    stage_raw_json()
    summarise()


def summarise() -> None:
    failed = [name for name, passed, _ in results if not passed]
    cost = (
        usage_totals["input"] / 1_000_000 * INPUT_PER_MTOK
        + usage_totals["output"] / 1_000_000 * OUTPUT_PER_MTOK
    )

    print("\n" + "=" * 68)
    # Stages 3 and 4 are excluded: ClaudeClient returns parsed payloads, not
    # the response envelope, so their usage is not reachable from here.
    print(
        f"Tokens (auth probe only): {usage_totals['input']} in / "
        f"{usage_totals['output']} out  (~${cost:.4f} at list price)"
    )
    if failed:
        print(f"RESULT: FAILED - {len(failed)} of {len(results)} checks did not pass")
        for name in failed:
            print(f"  - {name}")
        print("=" * 68)
        sys.exit(1)

    print(f"RESULT: PASSED - all {len(results)} checks green. Key is live on the Zenith pipeline.")
    print("=" * 68)
    sys.exit(0)


if __name__ == "__main__":
    main()
