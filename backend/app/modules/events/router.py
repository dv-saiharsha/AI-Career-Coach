"""Server-Sent Events stream.

Framed by hand over StreamingResponse rather than pulling in sse-starlette.
The wire format is four lines of text ("event:", "data:", blank), the
disconnect handling is the `finally` below, and adding a pinned dependency to
avoid writing them would be a poor trade — especially since the exact
heartbeat and teardown behaviour matters here and is easier to reason about
inline than to configure.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.core.deps import AuthenticatedUser, get_current_user
from app.core.events import HEARTBEAT_SECONDS, event_manager

logger = logging.getLogger(__name__)

router = APIRouter()


def format_sse(event_type: str, data: object) -> str:
    """One SSE frame.

    `data` is JSON-encoded even for strings so the client can call
    JSON.parse() unconditionally. json.dumps also guarantees no raw newline
    survives into the payload — a bare "\\n" would terminate the frame early
    and split one event into two malformed ones.
    """
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


async def event_stream(request: Request, user_id: str, handle):
    """The stream body, module-level so it can be driven directly in tests.

    Left as a closure this was untestable: an endpoint that only terminates on
    a real socket disconnect cannot be exercised through TestClient, which has
    no socket and whose `is_disconnected()` therefore never returns True — the
    loop just spins forever.
    """
    # listen() is what abstracts the backend: a queue drain in-process, a
    # Redis channel read otherwise. The router never learns which.
    events = event_manager.listen(user_id, handle).__aiter__()
    try:
        # Emitted immediately so the client can distinguish "connected" from
        # "still waiting for the first byte" — without it a stream with no
        # traffic is indistinguishable from a hung request.
        yield format_sse("connected", {"user_id": user_id})

        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(events.__anext__(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                # Keep-alive. Without periodic bytes, proxies close idle
                # connections and the client sees a silent death.
                yield format_sse("ping", {})
                continue
            except StopAsyncIteration:
                break
            yield format_sse(event["type"], event["data"])
    except asyncio.CancelledError:
        # Normal on client disconnect — re-raised so the server can finish
        # cancelling rather than swallowing it as an error.
        raise
    finally:
        # Runs on every exit path, including cancellation. Skipping it would
        # leak a queue per dropped connection, and every later publish would
        # fan out to subscribers nobody is reading.
        event_manager.unsubscribe(user_id, handle)


@router.get("/stream")
async def stream(
    request: Request,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Long-lived event stream for the authenticated user.

    Auth is the ordinary Bearer dependency, which means the browser's native
    EventSource cannot consume this: its constructor takes no headers. The
    frontend uses a fetch-based reader instead (lib/realtimeStream.ts). The
    alternative — accepting the JWT as a query parameter — would write a
    full-account-access token into access logs, browser history, and Referer
    headers, which is not worth the convenience.
    """
    handle = event_manager.subscribe(current_user.id)
    return StreamingResponse(
        event_stream(request, current_user.id, handle),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Tells nginx not to buffer; without it a proxy may hold the
            # response until the (never-arriving) end of the stream.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
