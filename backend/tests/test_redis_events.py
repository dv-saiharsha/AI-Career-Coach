"""Redis-backed SSE fan-out.

Uses fakeredis rather than a live server so CI needs no Redis, but exercises
the real RedisEventManager code path — the pub/sub semantics being verified
(channel isolation, cross-instance delivery) are Redis's, not a stub's.

What this cannot prove: delivery across genuinely separate OS processes. Two
manager instances sharing one fakeredis is the right shape — neither can see
the other's memory, only the channel — but a real deployment should still be
smoke-tested against a real Redis before relying on it.
"""

import asyncio

import pytest

from app.core.events import (
    InProcessEventManager,
    RedisEventManager,
    build_event_manager,
    channel_for,
)

pytest.importorskip("fakeredis")

USER = "00000000-0000-0000-0000-00000000000a"
OTHER = "00000000-0000-0000-0000-00000000000b"


def _manager(shared) -> RedisEventManager:
    """A RedisEventManager bound to a shared fake server, bypassing __init__
    so no real connection URL is needed."""
    manager = RedisEventManager.__new__(RedisEventManager)
    manager._redis = shared
    manager._counts = {}
    return manager


@pytest.fixture
def shared_redis():
    import fakeredis.aioredis

    return fakeredis.aioredis.FakeRedis(decode_responses=True)


class TestChannels:
    def test_channel_is_namespaced_per_user(self):
        assert channel_for(USER) != channel_for(OTHER)
        assert USER in channel_for(USER)

    def test_channel_is_prefixed(self):
        """Namespaced so this can share a Redis with a cache or queue."""
        assert channel_for(USER).startswith("applycenter:sse:user:")


class TestCrossWorkerDelivery:
    @pytest.mark.asyncio
    async def test_publish_on_one_manager_reaches_a_subscriber_on_another(self, shared_redis):
        """The whole point of the Redis backend: two workers share no memory,
        only the channel."""
        worker_a, worker_b = _manager(shared_redis), _manager(shared_redis)

        handle = worker_b.subscribe(USER)
        stream = worker_b.listen(USER, handle).__aiter__()
        pending = asyncio.create_task(stream.__anext__())
        await asyncio.sleep(0.3)

        delivered = await worker_a.publish(USER, "pipeline_update", {"id": 7})
        assert delivered == 1

        event = await asyncio.wait_for(pending, timeout=5)
        assert event == {"type": "pipeline_update", "data": {"id": 7}}

    @pytest.mark.asyncio
    async def test_other_users_do_not_receive_it(self, shared_redis):
        worker_a, worker_b = _manager(shared_redis), _manager(shared_redis)

        handle = worker_b.subscribe(OTHER)
        stream = worker_b.listen(OTHER, handle).__aiter__()
        pending = asyncio.create_task(stream.__anext__())
        await asyncio.sleep(0.3)

        await worker_a.publish(USER, "pipeline_update", {"id": 7})
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(pending, timeout=1.5)
        pending.cancel()

    @pytest.mark.asyncio
    async def test_publish_with_no_subscribers_returns_zero(self, shared_redis):
        assert await _manager(shared_redis).publish(USER, "x", {}) == 0

    @pytest.mark.asyncio
    async def test_publish_failure_does_not_raise(self, shared_redis):
        """A live-update nicety must never fail the request that triggered it."""
        manager = _manager(shared_redis)

        class Broken:
            async def publish(self, *a):
                raise ConnectionError("redis down")

        manager._redis = Broken()
        assert await manager.publish(USER, "x", {}) == 0


class TestBackendSelection:
    def test_falls_back_without_redis_url(self, monkeypatch):
        """CI and local dev have no Redis; a hard dependency would mean the
        API refuses to start over a feature most requests never touch."""
        monkeypatch.setattr("app.core.events.settings.REDIS_URL", "", raising=False)
        assert isinstance(build_event_manager(), InProcessEventManager)

    def test_falls_back_when_redis_client_cannot_be_built(self, monkeypatch):
        """Losing cross-worker events degrades a feature; failing to start
        takes down the whole API."""
        monkeypatch.setattr("app.core.events.settings.REDIS_URL", "redis://bad", raising=False)
        monkeypatch.setattr(
            "app.core.events.RedisEventManager.__init__",
            lambda self, url: (_ for _ in ()).throw(RuntimeError("no redis")),
        )
        assert isinstance(build_event_manager(), InProcessEventManager)

    def test_backend_is_labelled(self):
        """So an operator can tell from a log line which fan-out is live."""
        assert InProcessEventManager().backend == "in-process"
        assert RedisEventManager.backend == "redis"


class TestInProcessStillWorks:
    @pytest.mark.asyncio
    async def test_publish_and_listen(self):
        manager = InProcessEventManager()
        handle = manager.subscribe(USER)
        assert await manager.publish(USER, "job_match", {"id": 1}) == 1
        stream = manager.listen(USER, handle).__aiter__()
        assert await asyncio.wait_for(stream.__anext__(), timeout=2) == {
            "type": "job_match",
            "data": {"id": 1},
        }

    @pytest.mark.asyncio
    async def test_still_bounded(self):
        """The queue cap is what stops a dead client leaking memory."""
        from app.core.events import MAX_QUEUED_EVENTS

        manager = InProcessEventManager()
        handle = manager.subscribe(USER)
        for i in range(MAX_QUEUED_EVENTS + 20):
            await manager.publish(USER, "spam", {"i": i})
        assert handle.qsize() == MAX_QUEUED_EVENTS
