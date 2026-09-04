"""Blocking work inside `async def` route handlers.

WHAT THIS IS ABOUT

FastAPI runs a `def` handler in a threadpool and an `async def` handler
directly on the event loop. Three handlers here are `async def` purely
because they need `await upload.read()`, and then call straight into
synchronous work — the blocking Anthropic client, PDF text extraction, the
scikit-learn model.

That combination stops the worker. Not the one request: every request. For
the five to fifteen seconds a resume analysis takes, nothing else on that
process is served — not a dashboard load, not a notification poll, not
another user's login. It is invisible with one user and is the first thing
to break under any concurrency at all.

The fix is to hand the blocking part to a threadpool, which is what FastAPI
would have done on its own for a `def` handler.

WHY THE TEST LOOKS LIKE THIS

A unit test cannot see this — the handler returns the right answer either
way. It only shows up as a second request that should be fast and is not, so
the test issues two requests concurrently through a real ASGI transport and
asserts the cheap one does not wait for the expensive one.

The stub uses time.sleep, deliberately. asyncio.sleep would yield the loop
and the test would pass against the broken code, proving nothing.
"""

import ast
import asyncio
import os
import time

import httpx
import pytest
from httpx import ASGITransport

from app.core.deps import AuthenticatedUser, get_current_user
from app.core.database import get_db
from app.main import app
from app.modules.resume_analyzer import router as resume_router

ALICE = "00000000-0000-0000-0000-00000000000a"

# Long enough to measure without making the suite slow.
BLOCK_SECONDS = 0.6


@pytest.fixture
def app_with_slow_analysis(monkeypatch):
    def blocking_analysis(*_args, **_kwargs):
        time.sleep(BLOCK_SECONDS)
        raise ValueError("stub: we only care about the timing, not the result")

    monkeypatch.setattr(resume_router, "analyze_resume_against_job", blocking_analysis)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=ALICE, email="a@x.com")
    app.dependency_overrides[get_db] = lambda: None
    yield app
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_a_scan_does_not_freeze_every_other_request(app_with_slow_analysis):
    """The whole point. While one upload is being analysed, an unrelated
    request must still be served.

    MEASURE FROM A FIXED CLOCK, NOT FROM WHEN THE REQUEST WAS ISSUED

    The first version of this test timed the cheap request from just before
    its own `await client.get(...)` and passed against the broken code with a
    reported wait of 0.002s. The reason is the whole bug in miniature: the
    `asyncio.sleep` before it could not fire either, so the request was not
    issued until 0.615s — after the block had already ended — and the two
    milliseconds measured were real but described nothing.

    So the clock starts once, outside both tasks, and the assertion is on
    when the cheap request *finished*, not on how long it took once it
    finally got to run.
    """
    transport = ASGITransport(app=app_with_slow_analysis)
    started_at = time.perf_counter()

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:

        async def slow_scan():
            await client.post(
                "/api/resume/analyze",
                files={"resume": ("r.txt", b"hello", "text/plain")},
                data={"job_description": "Backend role."},
            )

        async def cheap_request():
            # Scheduled early so the scan is definitely still running.
            await asyncio.sleep(BLOCK_SECONDS / 6)
            response = await client.get("/api/resume/model-info")
            return response.status_code, time.perf_counter() - started_at

        _, (status, finished_at) = await asyncio.gather(slow_scan(), cheap_request())

    assert status == 200
    assert finished_at < BLOCK_SECONDS / 2, (
        f"an unrelated request did not complete until {finished_at:.2f}s, with a "
        f"resume scan blocking for {BLOCK_SECONDS}s. The scan runs synchronously "
        "inside an `async def` handler, so it holds the event loop and every "
        "other request on this worker — including this one — waits for it. "
        "Run the blocking work in a threadpool."
    )


# ── The same rule, enforced structurally ────────────────────────────────────
#
# The timing test above covers /analyze. Two other handlers had the identical
# shape and a third will eventually be written, so the rule is also checked
# statically: an `async def` route handler may not call known-blocking work
# directly. A timing test per route would be three slow tests that still miss
# the fourth handler on the day someone adds it.

ROUTERS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "modules")

# Functions that do network or CPU work with no await in them. Extend this
# when a new one appears — that is the point of the list.
BLOCKING_CALLS = {
    "analyze_resume_against_job",
    "extract_text",
    "build_review",
    "transcribe",
    "complete_json",
    "complete_tool_json",
}


def _async_handlers():
    """(file, function node) for every `async def` decorated with @router.<verb>."""
    for dirpath, _, filenames in os.walk(ROUTERS):
        if "router.py" not in filenames:
            continue
        path = os.path.join(dirpath, "router.py")
        tree = ast.parse(open(path, encoding="utf-8").read())
        for node in tree.body:
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            if any(
                isinstance(d, ast.Call)
                and isinstance(d.func, ast.Attribute)
                and d.func.attr in ("get", "post", "put", "patch", "delete")
                for d in node.decorator_list
            ):
                yield os.path.relpath(path, os.path.dirname(ROUTERS)), node


def _unwrapped_blocking_calls(node):
    """Blocking calls not sitting inside a run_in_threadpool(...) argument."""
    wrapped = set()
    for child in ast.walk(node):
        if (
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id == "run_in_threadpool"
            and child.args
        ):
            target = child.args[0]
            wrapped.add(target.id if isinstance(target, ast.Name) else getattr(target, "attr", None))

    offenders = []
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        name = (
            child.func.id
            if isinstance(child.func, ast.Name)
            else getattr(child.func, "attr", None)
        )
        if name in BLOCKING_CALLS and name not in wrapped:
            offenders.append(name)
    return offenders


def test_no_async_handler_calls_blocking_work_directly():
    """An `async def` handler runs on the event loop. Anything slow and
    synchronous in it stops the whole worker, not just that request."""
    problems = []
    for path, node in _async_handlers():
        for name in _unwrapped_blocking_calls(node):
            problems.append(f"{path}:{node.lineno} {node.name}() calls {name}() directly")

    assert not problems, (
        "async route handlers calling blocking work on the event loop:\n  "
        + "\n  ".join(problems)
        + "\n\nWrap the call in `await run_in_threadpool(fn, ...)`, which is where "
        "FastAPI would have run it had the handler been a plain `def`."
    )
