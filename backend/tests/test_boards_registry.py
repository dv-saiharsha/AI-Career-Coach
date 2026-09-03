"""The board registry, and its place in the sweep.

The registry's whole value is that every token in it was probed. These tests
guard the two ways that value gets lost: a dead token creeping back in, and
the free pass being reordered behind the paid one.
"""

import json

from app.modules.job_market import boards_registry, ingestion


class TestRegistry:
    def test_holds_a_useful_number_of_boards(self):
        assert boards_registry.board_count() >= 30

    def test_no_token_appears_in_both_live_and_dead(self):
        """The failure this guards is quiet.

        fetch_board swallows a 404 by design, so a dead token produces a sweep
        that looks like it ran and returns fewer roles than it should. If a
        token is ever moved to KNOWN_DEAD, it has to leave the live list too.
        """
        live = set(boards_registry.all_boards())
        dead = set(boards_registry.KNOWN_DEAD)
        assert not (live & dead), f"token listed as both live and dead: {live & dead}"

    def test_every_entry_is_a_provider_the_fetcher_understands(self):
        for provider, token in boards_registry.all_boards():
            assert provider in {"greenhouse", "lever"}
            assert token and token == token.strip().lower()

    def test_there_are_no_duplicates(self):
        boards = boards_registry.all_boards()
        assert len(boards) == len(set(boards))

    def test_the_dead_list_records_what_was_probed(self):
        """Kept deliberately, so nobody rediscovers that almost no
        developer-tools company is actually on Lever."""
        dead = dict(
            (token, provider) for provider, token in boards_registry.KNOWN_DEAD
        )
        assert dead.get("netflix") == "lever"
        assert dead.get("openai") == "greenhouse"


class TestSweepIntegration:
    def test_free_boards_are_collected_before_paid_apify(self, monkeypatch):
        """Ordering is the whole economic argument.

        Boards cost nothing, so every role they supply is one the paid pass
        never has to search for. Running them second would spend the budget
        first and then discover it was not needed.
        """
        order: list[str] = []

        def fake_board(provider, token, query_key="x", fetch=None):
            order.append("board")
            return []

        monkeypatch.setattr(ingestion.ats_boards, "fetch_board", fake_board)
        monkeypatch.setattr(
            ingestion.boards_registry, "all_boards", lambda: [("greenhouse", "stripe")]
        )

        report = ingestion.SweepReport(dry_run=False)
        ingestion._collect_boards(report)

        assert order == ["board"]
        assert report.boards_swept == 1

    def test_board_rows_dedupe_on_the_same_hash_apify_uses(self, monkeypatch):
        """A role posted to both a company board and LinkedIn is one job.

        Because boards run first, the surviving copy is the employer's own —
        whose apply URL goes to the real application form rather than an
        aggregator interstitial.
        """
        row = {
            "company": "Stripe",
            "title": "Backend Engineer",
            "location": "Dublin",
            "apply_url": "https://stripe.com/jobs/1",
            "source": "greenhouse",
            "skills": json.dumps([]),
        }
        monkeypatch.setattr(
            ingestion.ats_boards, "fetch_board", lambda *a, **k: [dict(row), dict(row)]
        )
        monkeypatch.setattr(
            ingestion.boards_registry, "all_boards", lambda: [("greenhouse", "stripe")]
        )

        report = ingestion.SweepReport(dry_run=False)
        collected = ingestion._collect_boards(report)

        assert len(collected) == 1, "the same role twice is one posting"
        assert report.board_postings == 1

    def test_a_dead_board_does_not_stop_the_sweep(self, monkeypatch):
        def half_dead(provider, token, query_key="x", fetch=None):
            if token == "dead":
                return []
            return [
                {
                    "company": "Stripe",
                    "title": "Backend Engineer",
                    "location": "Dublin",
                    "apply_url": "https://stripe.com/jobs/1",
                    "source": "greenhouse",
                    "skills": json.dumps([]),
                }
            ]

        monkeypatch.setattr(ingestion.ats_boards, "fetch_board", half_dead)
        monkeypatch.setattr(
            ingestion.boards_registry,
            "all_boards",
            lambda: [("greenhouse", "dead"), ("greenhouse", "stripe")],
        )

        report = ingestion.SweepReport(dry_run=False)
        collected = ingestion._collect_boards(report)
        assert len(collected) == 1
        assert report.boards_swept == 2

    def test_dry_run_reports_the_free_pass_without_issuing_requests(self, monkeypatch):
        """dry_run's contract is that nothing is fetched. Free is not exempt —
        these are somebody else's endpoints."""
        called = []
        monkeypatch.setattr(
            ingestion.ats_boards,
            "fetch_board",
            lambda *a, **k: called.append(1) or [],
        )

        report = ingestion.refresh_global_jobs(db=None, roles=["backend engineer"], dry_run=True)

        assert called == [], "a dry run must not touch the boards"
        assert report.boards_swept == boards_registry.board_count()
        assert any("no cost" in e for e in report.errors)
