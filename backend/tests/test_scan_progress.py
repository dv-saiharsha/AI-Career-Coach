"""Real scan stages, reported from a worker thread.

The narration this replaces was timer-driven and said so in its own
docstring: /analyze was one atomic call with nothing incremental to report.
It now reports each real step as it begins, which makes two things testable
that a timer never could be — that the stages match what the code actually
does, and that they arrive while the scan is still running rather than all
at once at the end.

The failure this file mostly guards is the opposite one. Progress is a
courtesy, and the ways it can fail (Redis down, a closed tab, no running
loop) must never take a resume scan with them.
"""

import asyncio
import time

import pytest

from app.modules.resume_analyzer import progress, services


class TestStagesMatchTheCode:
    def test_declared_stages_are_the_ones_actually_emitted(self, monkeypatch):
        """SCAN_STAGES is what the client renders its checklist from. If the
        pipeline emits something else, the client shows a stage that never
        completes."""
        monkeypatch.setattr(services, "extract_text", lambda *_: "Jane Doe\nPython engineer\n" * 40)
        monkeypatch.setattr(services, "looks_like_resume", lambda _text: True)
        monkeypatch.setattr(services.llm_client, "_client", None)
        monkeypatch.setattr(services, "_rule_based_analysis", lambda *_: {"ats_score": 60})
        monkeypatch.setattr(services, "build_diagnostics", lambda *_a, **_k: {})

        seen: list[str] = []
        services.analyze_resume_against_job("cv.pdf", b"bytes", "Backend role", seen.append)

        assert seen, "no stages were reported at all"
        assert set(seen) <= set(services.SCAN_STAGES), (
            f"emitted a stage not in SCAN_STAGES: {set(seen) - set(services.SCAN_STAGES)}"
        )
        # Order matters — the checklist ticks down, it does not jump around.
        assert seen == sorted(seen, key=services.SCAN_STAGES.index)

    def test_the_fallback_path_keeps_reporting(self, monkeypatch):
        """When the LLM call fails, rule-based scoring finishes the scan. If
        stages stopped there the client would sit on 'analyzing' until the
        response landed — the exact frozen-spinner this replaced."""
        monkeypatch.setattr(services, "extract_text", lambda *_: "Jane Doe\nPython engineer\n" * 40)
        monkeypatch.setattr(services, "looks_like_resume", lambda _text: True)
        monkeypatch.setattr(services.llm_client, "_client", object())
        monkeypatch.setattr(
            services, "_llm_analysis", lambda *_: (_ for _ in ()).throw(RuntimeError("api down"))
        )
        monkeypatch.setattr(services, "_rule_based_analysis", lambda *_: {"ats_score": 60})
        monkeypatch.setattr(services, "build_diagnostics", lambda *_a, **_k: {})

        seen: list[str] = []
        result = services.analyze_resume_against_job("cv.pdf", b"bytes", "Backend role", seen.append)

        assert result["_source"] == "rules"
        assert "diagnostics" in seen, "stages stopped once the LLM path failed"


class TestProgressNeverBreaksAScan:
    def test_a_publisher_that_raises_does_not_fail_the_scan(self, monkeypatch):
        async def exploding_publish(*_args, **_kwargs):
            raise RuntimeError("redis is gone")

        monkeypatch.setattr(progress.event_manager, "publish", exploding_publish)

        async def run():
            on_stage = progress.stage_publisher("user-1", "scan-1")
            # Called from a worker thread, which is where it really runs.
            return await asyncio.to_thread(lambda: [on_stage(s) for s in services.SCAN_STAGES])

        asyncio.run(run())  # must not raise

    def test_no_scan_id_means_no_publishing(self, monkeypatch):
        """A client that does not correlate events should not pay for them on
        the request that is already the slow one."""
        published = []

        async def record(*args, **kwargs):
            published.append(args)

        monkeypatch.setattr(progress.event_manager, "publish", record)

        async def run():
            on_stage = progress.stage_publisher("user-1", None)
            on_stage("extracting")

        asyncio.run(run())
        assert published == []

    def test_built_off_the_loop_it_degrades_instead_of_raising(self):
        """There is no loop to bridge to from a sync context. Progress is
        unavailable; nothing throws."""
        on_stage = progress.stage_publisher("user-1", "scan-1")
        on_stage("extracting")  # must not raise


class TestStagesArriveDuringTheScan:
    def test_events_are_published_before_the_scan_returns(self, monkeypatch):
        """The whole point. A stage list delivered when the response lands is
        the frozen spinner with extra steps.

        The scan is stalled mid-flight and the published events are read while
        it is still running.
        """
        published: list[tuple[str, dict]] = []

        async def record(_user_id, event_type, payload):
            published.append((event_type, payload))
            return 1

        monkeypatch.setattr(progress.event_manager, "publish", record)

        release = asyncio.Event()

        def slow_extract(*_args):
            # Block the worker thread until the test lets it go.
            while not release.is_set():
                time.sleep(0.01)
            return "Jane Doe\nPython engineer\n" * 40

        monkeypatch.setattr(services, "extract_text", slow_extract)
        monkeypatch.setattr(services, "looks_like_resume", lambda _t: True)
        monkeypatch.setattr(services.llm_client, "_client", None)
        monkeypatch.setattr(services, "_rule_based_analysis", lambda *_: {"ats_score": 60})
        monkeypatch.setattr(services, "build_diagnostics", lambda *_a, **_k: {})

        async def run():
            on_stage = progress.stage_publisher("user-1", "scan-1")
            scan = asyncio.create_task(
                asyncio.to_thread(
                    services.analyze_resume_against_job, "cv.pdf", b"x", "Backend", on_stage
                )
            )
            # Give the thread time to emit "extracting" and then stall in it.
            await asyncio.sleep(0.1)
            mid_flight = list(published)
            release.set()
            await scan
            return mid_flight

        mid_flight = asyncio.run(run())

        assert mid_flight, "nothing was published while the scan was still running"
        assert mid_flight[0][1]["stage"] == "extracting"
        assert mid_flight[0][1]["scan_id"] == "scan-1"


def test_stage_events_carry_the_scan_id_so_two_tabs_do_not_collide(monkeypatch):
    published: list[dict] = []

    async def record(_user_id, _event_type, payload):
        published.append(payload)
        return 1

    monkeypatch.setattr(progress.event_manager, "publish", record)

    async def run():
        a = progress.stage_publisher("user-1", "tab-a")
        b = progress.stage_publisher("user-1", "tab-b")
        await asyncio.to_thread(a, "extracting")
        await asyncio.to_thread(b, "analyzing")
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert {p["scan_id"] for p in published} == {"tab-a", "tab-b"}


@pytest.mark.parametrize("stage", services.SCAN_STAGES)
def test_every_declared_stage_is_reachable_in_the_pipeline_source(stage):
    """A name in SCAN_STAGES that the pipeline never emits is a checklist row
    that hangs forever."""
    import inspect

    source = inspect.getsource(services.analyze_resume_against_job)
    assert f'stage("{stage}")' in source, f"{stage} is declared but never emitted"
