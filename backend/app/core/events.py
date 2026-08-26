"""Pub/sub for Server-Sent Events, with an optional Redis backend.

Two implementations behind one interface:

  InProcessEventManager — a dict of asyncio.Queues on the local heap. Correct
    and dependency-free, but a broadcast only reaches clients connected to
    *this* process. Run uvicorn with --workers 2 and a user on worker A never
    sees an event published by worker B.

  RedisEventManager — the same interface over Redis pub/sub, so any worker can
    publish and every worker's subscribers receive it. This is what makes
    horizontal scale-out correct rather than merely faster.

Which one is active depends on whether REDIS_URL is set. That fallback is
deliberate: local dev and CI have no Redis, and a hard dependency would mean
the whole app fails to start over a feature most requests never touch.

Publishing is async on both. Redis publish is inherently async, and having one
sync and one async implementation of the same method would make every call
site depend on which backend happened to be configured.
"""

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)

# Bounded on purpose. An unbounded queue is a memory leak wearing a disguise:
# a client that stops reading (laptop asleep, tab throttled, half-open socket)
# would otherwise accumulate every event published for that user until the
# process dies. At the cap the oldest event is dropped instead.
MAX_QUEUED_EVENTS = 50

# How long a stream waits before emitting a keep-alive. Proxies and load
# balancers commonly close idle connections around 60s, so this stays well
# under that.
HEARTBEAT_SECONDS = 15

# Redis channel per user. Namespaced so this can share a Redis instance with
# a cache or a queue without colliding.
CHANNEL_PREFIX = "applycenter:sse:user:"


def channel_for(user_id: str) -> str:
    return f"{CHANNEL_PREFIX}{user_id}"


class EventManager(Protocol):
    """What the SSE router depends on. Both backends satisfy it."""

    def subscribe(self, user_id: str) -> Any: ...
    def unsubscribe(self, user_id: str, handle: Any) -> None: ...
    async def publish(self, user_id: str, event_type: str, payload: dict) -> int: ...


class InProcessEventManager:
    """Fan-out to the queues subscribed for a given user id, in this process."""

    backend = "in-process"

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, user_id: str) -> asyncio.Queue:
        """Not async: creating a queue and appending to a list never awaits,
        and marking it async would imply a suspension point that doesn't
        exist. asyncio has no preemption between awaits, so no lock is needed
        to mutate these structures from within one event loop."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUED_EVENTS)
        self._subscribers.setdefault(user_id, []).append(queue)
        return queue

    def unsubscribe(self, user_id: str, handle: asyncio.Queue) -> None:
        """Idempotent — a stream that errors partway through teardown may call
        this twice, and a double-unsubscribe should be a no-op."""
        queues = self._subscribers.get(user_id)
        if not queues:
            return
        if handle in queues:
            queues.remove(handle)
        if not queues:
            del self._subscribers[user_id]

    async def publish(self, user_id: str, event_type: str, payload: dict) -> int:
        """Deliver to that user's live streams in this process.

        put_nowait, not await put: awaiting a full queue blocks the *publisher*
        until a consumer drains it, so one stalled browser tab could hang the
        handler that published the event.
        """
        queues = self._subscribers.get(user_id)
        if not queues:
            return 0

        event = {"type": event_type, "data": payload}
        delivered = 0
        for queue in queues:
            try:
                queue.put_nowait(event)
                delivered += 1
            except asyncio.QueueFull:
                # Drop the oldest to make room: for live updates the newest
                # state is what's worth keeping, and the client re-syncs from
                # the API on reconnect anyway.
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                    delivered += 1
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    logger.warning("dropping event %s for user %s: queue full", event_type, user_id)
        return delivered

    async def listen(self, user_id: str, handle: asyncio.Queue) -> AsyncIterator[dict]:
        """Yield events for one subscriber until cancelled."""
        while True:
            yield await handle.get()

    def connection_count(self, user_id: str) -> int:
        return len(self._subscribers.get(user_id, []))

    @property
    def total_connections(self) -> int:
        return sum(len(queues) for queues in self._subscribers.values())


class RedisEventManager:
    """Same interface over Redis pub/sub, so publishes cross process boundaries.

    Each subscriber gets its own PubSub object rather than sharing one: Redis
    pub/sub has no per-consumer cursor, so a shared subscription would deliver
    each message to whichever reader happened to poll first, and two browser
    tabs for the same user would each see half their events.
    """

    backend = "redis"

    def __init__(self, url: str) -> None:
        from redis.asyncio import Redis

        # decode_responses so payloads come back as str and json.loads works
        # without a manual .decode() at every call site.
        self._redis = Redis.from_url(url, decode_responses=True)
        self._counts: dict[str, int] = {}

    def subscribe(self, user_id: str):
        """Returns an unstarted PubSub. Subscribing to the channel is awaited
        in `listen`, because this is called from sync context and connecting
        here would need an event loop that may not be running yet."""
        pubsub = self._redis.pubsub()
        self._counts[user_id] = self._counts.get(user_id, 0) + 1
        return pubsub

    def unsubscribe(self, user_id: str, handle) -> None:
        """Best-effort. The channel unsubscribe and connection close happen in
        `listen`'s finally block, where there is a running loop to await them;
        this only keeps the local count honest."""
        remaining = self._counts.get(user_id, 0) - 1
        if remaining > 0:
            self._counts[user_id] = remaining
        else:
            self._counts.pop(user_id, None)

    async def publish(self, user_id: str, event_type: str, payload: dict) -> int:
        """PUBLISH to the user's channel. Returns how many Redis subscribers
        received it — across every worker, not just this one."""
        message = json.dumps({"type": event_type, "data": payload})
        try:
            return int(await self._redis.publish(channel_for(user_id), message))
        except Exception:
            # A publish failure must not fail the request that triggered it:
            # the event is a live-update nicety, the request is the product.
            logger.warning("redis publish failed for %s", user_id, exc_info=True)
            return 0

    async def listen(self, user_id: str, handle) -> AsyncIterator[dict]:
        """Yield events off the channel until cancelled."""
        channel = channel_for(user_id)
        await handle.subscribe(channel)
        try:
            while True:
                # timeout, not a poll-plus-sleep: get_message already blocks up
                # to `timeout`, so an extra asyncio.sleep would only add latency
                # to every delivery while burning wakeups when idle.
                message = await handle.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message is None:
                    continue
                if message.get("type") != "message":
                    continue
                try:
                    yield json.loads(message["data"])
                except (ValueError, TypeError):
                    # A malformed payload from another worker costs that one
                    # event, not the whole stream.
                    logger.warning("redis: undecodable SSE payload on %s", channel)
        finally:
            try:
                await handle.unsubscribe(channel)
                await handle.aclose()
            except Exception:
                logger.debug("redis: pubsub teardown failed", exc_info=True)

    def connection_count(self, user_id: str) -> int:
        """Local only. Redis knows the global count; this process knows its own."""
        return self._counts.get(user_id, 0)

    @property
    def total_connections(self) -> int:
        return sum(self._counts.values())


def build_event_manager() -> EventManager:
    """Redis when REDIS_URL is set, in-process otherwise.

    Failure to construct the Redis client falls back rather than crashing:
    losing cross-worker events degrades a feature, while failing to start
    takes down the whole API.
    """
    url = getattr(settings, "REDIS_URL", "") or ""
    if not url:
        logger.info("SSE: no REDIS_URL — using in-process fan-out (single worker only)")
        return InProcessEventManager()
    try:
        manager = RedisEventManager(url)
        logger.info("SSE: using Redis pub/sub fan-out")
        return manager
    except Exception:
        logger.warning("SSE: Redis unavailable, falling back to in-process", exc_info=True)
        return InProcessEventManager()


event_manager: EventManager = build_event_manager()
