"""In-process pub/sub for Server-Sent Events.

SCOPE — read before relying on this in production:

This holds subscriber queues in a plain dict on the Python heap, so a
broadcast only reaches clients connected to *this* process. Run uvicorn with
--workers 2 (or two containers behind a load balancer) and a user connected to
worker A will never see an event published by worker B. That is a real
limitation, not a theoretical one, and it is why nothing here pretends to be a
message bus.

It is the right shape for a single-process deployment, which is what Zenith
runs today. Crossing the process boundary needs an external broker (Redis
pub/sub, Postgres LISTEN/NOTIFY); the EventManager interface is deliberately
narrow — publish/subscribe/unsubscribe — so that swap is contained to this
file.
"""

import asyncio
import logging
from typing import Any

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


class EventManager:
    """Fan-out to the queues subscribed for a given user id."""

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

    def unsubscribe(self, user_id: str, queue: asyncio.Queue) -> None:
        """Idempotent — a stream that errors partway through teardown may call
        this twice, and a double-unsubscribe should be a no-op rather than a
        KeyError."""
        queues = self._subscribers.get(user_id)
        if not queues:
            return
        if queue in queues:
            queues.remove(queue)
        if not queues:
            del self._subscribers[user_id]

    def publish(self, user_id: str, event_type: str, payload: dict[str, Any]) -> int:
        """Fan an event out to that user's live streams. Returns how many
        queues accepted it.

        Synchronous and non-blocking by design. `await queue.put()` on a full
        queue blocks the *publisher* until a consumer drains it — meaning one
        stalled browser tab could hang the request handler that published the
        event. put_nowait + drop keeps a slow consumer's problem contained to
        that consumer.
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
                # state is the one worth keeping, and the client re-syncs from
                # the API on reconnect anyway.
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                    delivered += 1
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    logger.warning("dropping event %s for user %s: queue full", event_type, user_id)
        return delivered

    def connection_count(self, user_id: str) -> int:
        return len(self._subscribers.get(user_id, []))

    @property
    def total_connections(self) -> int:
        return sum(len(queues) for queues in self._subscribers.values())


event_manager = EventManager()
