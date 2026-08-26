"""Event manager fan-out and the SSE wire format.

The overflow tests are the ones that matter: an unbounded queue behind a
client that stopped reading is a memory leak, and awaiting a full queue would
let one stalled browser tab block the request handler doing the publishing.
"""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.core.events import MAX_QUEUED_EVENTS, InProcessEventManager
from app.main import app
from app.modules.events.router import event_stream, format_sse

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"


@pytest.fixture
def manager():
    return InProcessEventManager()


class TestSubscription:
    def test_subscribe_returns_a_queue(self, manager):
        assert isinstance(manager.subscribe(USER_A), asyncio.Queue)

    def test_tracks_connection_count(self, manager):
        manager.subscribe(USER_A)
        manager.subscribe(USER_A)
        assert manager.connection_count(USER_A) == 2

    def test_unsubscribe_removes_queue(self, manager):
        queue = manager.subscribe(USER_A)
        manager.unsubscribe(USER_A, queue)
        assert manager.connection_count(USER_A) == 0

    def test_unsubscribe_is_idempotent(self, manager):
        """Teardown can run twice when a stream errors partway through;
        the second call must be a no-op, not a KeyError."""
        queue = manager.subscribe(USER_A)
        manager.unsubscribe(USER_A, queue)
        manager.unsubscribe(USER_A, queue)  # must not raise

    def test_unsubscribe_unknown_user_is_safe(self, manager):
        manager.unsubscribe("nobody", asyncio.Queue())

    def test_empty_user_entry_is_cleaned_up(self, manager):
        """Otherwise the dict grows a permanent key per user who ever
        connected, which is a slow leak in a long-running process."""
        queue = manager.subscribe(USER_A)
        manager.unsubscribe(USER_A, queue)
        assert manager.total_connections == 0
        assert USER_A not in manager._subscribers


class TestPublish:
    @pytest.mark.asyncio
    async def test_delivers_to_subscriber(self, manager):
        queue = manager.subscribe(USER_A)
        assert await manager.publish(USER_A, "job_match", {"id": 1}) == 1
        assert queue.get_nowait() == {"type": "job_match", "data": {"id": 1}}

    @pytest.mark.asyncio

    async def test_fans_out_to_every_connection(self, manager):
        """One user with the app open in two tabs must see both update."""
        first = manager.subscribe(USER_A)
        second = manager.subscribe(USER_A)
        assert await manager.publish(USER_A, "ping", {}) == 2
        assert first.qsize() == 1 and second.qsize() == 1

    @pytest.mark.asyncio

    async def test_does_not_leak_across_users(self, manager):
        queue_a = manager.subscribe(USER_A)
        manager.subscribe(USER_B)
        await manager.publish(USER_B, "pipeline_update", {"id": 7})
        assert queue_a.empty()

    @pytest.mark.asyncio

    async def test_publish_with_no_subscribers_is_a_noop(self, manager):
        assert await manager.publish(USER_A, "job_match", {}) == 0


class TestOverflow:
    @pytest.mark.asyncio
    async def test_queue_is_bounded(self, manager):
        """An unbounded queue behind a client that stopped reading is a
        memory leak that only shows up in production."""
        queue = manager.subscribe(USER_A)
        for i in range(MAX_QUEUED_EVENTS + 20):
            await manager.publish(USER_A, "spam", {"i": i})
        assert queue.qsize() == MAX_QUEUED_EVENTS

    @pytest.mark.asyncio

    async def test_publish_never_blocks_on_a_full_queue(self, manager):
        """The point of put_nowait: awaiting a full queue would stall the
        publisher — a request handler — on one slow consumer."""
        manager.subscribe(USER_A)
        for i in range(MAX_QUEUED_EVENTS + 5):
            await manager.publish(USER_A, "spam", {"i": i})  # returns, doesn't hang

    @pytest.mark.asyncio

    async def test_oldest_event_is_dropped_not_newest(self, manager):
        """On overflow the freshest state is what's worth keeping."""
        queue = manager.subscribe(USER_A)
        for i in range(MAX_QUEUED_EVENTS + 1):
            await manager.publish(USER_A, "spam", {"i": i})
        first = queue.get_nowait()
        assert first["data"]["i"] == 1, "event 0 should have been evicted"


class TestSseFraming:
    def test_frame_shape(self):
        assert format_sse("ping", {"a": 1}) == 'event: ping\ndata: {"a": 1}\n\n'

    def test_ends_with_blank_line(self):
        """A frame without the terminating blank line is never dispatched by
        the client — it just sits in the parser buffer."""
        assert format_sse("x", {}).endswith("\n\n")

    def test_newlines_in_payload_cannot_split_the_frame(self):
        """A raw newline in data would terminate the frame early and produce
        two malformed events. json.dumps escapes it to \\n."""
        frame = format_sse("note", {"text": "line1\nline2"})
        assert frame.count("\n\n") == 1
        assert "\\n" in frame

    def test_data_is_json_even_for_strings(self):
        """So the client can JSON.parse() unconditionally."""
        frame = format_sse("ping", "keep-alive")
        payload = frame.split("data: ")[1].strip()
        assert json.loads(payload) == "keep-alive"


class FakeRequest:
    """Minimal stand-in for Starlette's Request.

    TestClient has no real socket, so its `is_disconnected()` never returns
    True and the stream loop spins forever. This reports connected for a set
    number of polls and then disconnects, which is what makes the generator
    terminate deterministically.
    """

    def __init__(self, polls_before_disconnect: int = 1):
        self._remaining = polls_before_disconnect

    async def is_disconnected(self) -> bool:
        if self._remaining <= 0:
            return True
        self._remaining -= 1
        return False


async def drain(generator) -> list[str]:
    return [frame async for frame in generator]


def parse_events(frames: list[str]) -> list[str]:
    return [f.split("event: ")[1].splitlines()[0] for f in frames]


class TestEventStream:
    @pytest.mark.asyncio
    async def test_announces_connection_first(self):
        """Without this frame an idle stream is indistinguishable from a hung
        request — the client has no way to know it connected."""
        manager_queue: asyncio.Queue = asyncio.Queue()
        frames = await drain(event_stream(FakeRequest(0), USER_A, manager_queue))
        assert parse_events(frames)[0] == "connected"

    @pytest.mark.asyncio
    async def test_delivers_a_published_event(self):
        queue: asyncio.Queue = asyncio.Queue()
        queue.put_nowait({"type": "job_match", "data": {"id": 7}})
        frames = await drain(event_stream(FakeRequest(1), USER_A, queue))
        assert parse_events(frames) == ["connected", "job_match"]
        assert '"id": 7' in frames[1]

    @pytest.mark.asyncio
    async def test_emits_heartbeat_when_idle(self, monkeypatch):
        """Proxies close idle connections; without periodic bytes the client
        sees a silent death rather than a live stream."""
        monkeypatch.setattr("app.modules.events.router.HEARTBEAT_SECONDS", 0.01)
        frames = await drain(event_stream(FakeRequest(1), USER_A, asyncio.Queue()))
        assert parse_events(frames) == ["connected", "ping"]

    @pytest.mark.asyncio
    async def test_unsubscribes_on_disconnect(self):
        """A leaked queue per dropped connection means every later publish
        fans out to subscribers nobody reads."""
        from app.core.events import event_manager

        queue = event_manager.subscribe(USER_B)
        assert event_manager.connection_count(USER_B) == 1
        await drain(event_stream(FakeRequest(0), USER_B, queue))
        assert event_manager.connection_count(USER_B) == 0

    @pytest.mark.asyncio
    async def test_unsubscribes_even_when_cancelled(self):
        """Cancellation is the normal path when a browser tab closes, so
        cleanup must not depend on a graceful exit."""
        from app.core.events import event_manager

        queue = event_manager.subscribe(USER_B)
        generator = event_stream(FakeRequest(999), USER_B, queue)
        await generator.__anext__()  # connected frame
        await generator.aclose()  # throws GeneratorExit inside
        assert event_manager.connection_count(USER_B) == 0


class TestStreamEndpoint:
    def test_requires_authentication(self):
        assert TestClient(app).get("/api/events/stream").status_code == 401
