"""Discovering employer boards from a public company index.

The directory feed carries no job descriptions, so it is used for one fact
per company — which ATS this employer publishes on — and the roles come from
the employer's own board API. These tests pin the parts of that split that
are easy to get wrong and quiet when they are.

Everything here injects its own fetchers. Discovery reaches two external
services and a test that touched either would be slow, flaky, and rude.
"""

import json

import pytest

from app.modules.job_market import ats_boards, board_discovery, boards_registry


class TestReadingTheATSOutOfAnApplyLink:
    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://boards.greenhouse.io/anduril/jobs/123", ("greenhouse", "anduril")),
            ("https://job-boards.greenhouse.io/xai/jobs/9", ("greenhouse", "xai")),
            # Greenhouse's EU host is a different domain for the same boards.
            ("https://job-boards.eu.greenhouse.io/deepl/jobs/1", ("greenhouse", "deepl")),
            ("https://jobs.lever.co/shieldai/abc-def", ("lever", "shieldai")),
            ("https://jobs.ashbyhq.com/openai/1234", ("ashby", "openai")),
            # A dot is legal in an Ashby token and must survive.
            ("https://jobs.ashbyhq.com/mistral.ai/77", ("ashby", "mistral.ai")),
            ("https://JOBS.ASHBYHQ.COM/Cohere/1", ("ashby", "cohere")),
        ],
    )
    def test_recognises_the_three_providers_we_can_actually_fetch(self, url, expected):
        assert board_discovery.extract_token(url) == expected

    @pytest.mark.parametrize(
        "url",
        [
            "https://nvidia.wd5.myworkdayjobs.com/en-US/nvidia/job/x",
            "https://www.amazon.jobs/en/jobs/123",
            "https://www.databricks.com/company/careers/x",
            "https://wayve.firststage.co/role/1",
            "",
            None,
        ],
    )
    def test_ignores_links_with_no_public_board_api_behind_them(self, url):
        """These are real jobs and deliberately not candidates. A token we
        cannot fetch from is a registry row that costs a request per sweep
        and returns nothing."""
        assert board_discovery.extract_token(url) is None


class TestChoosingCandidates:
    def _rows(self, *urls):
        return [{"apply_url": u, "company": "Some Co"} for u in urls]

    def test_boards_already_in_the_registry_are_not_proposed_again(self):
        known_provider, known_token = boards_registry.all_boards()[0]
        host = {
            "greenhouse": f"https://boards.greenhouse.io/{known_token}/jobs/1",
            "lever": f"https://jobs.lever.co/{known_token}/x",
            "ashby": f"https://jobs.ashbyhq.com/{known_token}/x",
        }[known_provider]

        found = board_discovery.find_candidates(self._rows(host))
        assert found == []

    def test_one_board_yields_one_candidate_not_one_per_role(self):
        rows = self._rows(*[f"https://boards.greenhouse.io/acme/jobs/{i}" for i in range(50)])
        found = board_discovery.find_candidates(rows)
        assert len(found) == 1
        assert found[0].token == "acme"

    def test_known_dead_is_matched_per_provider_not_per_token(self):
        """The finding that made this whole thing worth building.

        OpenAI is in KNOWN_DEAD for Greenhouse and has 768 live roles on
        Ashby. Skipping on the token alone would hide exactly the boards this
        script exists to surface.
        """
        assert ("greenhouse", "openai") in boards_registry.KNOWN_DEAD

        found = board_discovery.find_candidates(
            self._rows(
                "https://boards.greenhouse.io/openai/jobs/1",
                "https://jobs.ashbyhq.com/openai/2",
            )
        )

        assert [(c.provider, c.token) for c in found] == [("ashby", "openai")]

    def test_the_company_name_is_carried_over_from_the_feed(self):
        """Ashby's own API returns no company name, so this is the only place
        the real one is available."""
        rows = [{"apply_url": "https://jobs.ashbyhq.com/mistral.ai/1", "company": "Mistral AI"}]
        assert board_discovery.find_candidates(rows)[0].company == "Mistral AI"


class TestProbingBeforeProposing:
    def test_a_board_that_does_not_answer_is_not_proposed(self):
        """boards_registry.py's own rule: a token is a guess until it returns
        jobs. A dead one costs a request every sweep and shrinks the feed."""
        candidates = [
            board_discovery.Candidate("greenhouse", "alive", "Alive Co"),
            board_discovery.Candidate("greenhouse", "gone", "Gone Co"),
        ]

        def fetch(url):
            if "alive" in url:
                return 200, json.dumps({"jobs": [{"id": 1, "title": "Engineer", "absolute_url": "https://x/1"}]})
            return 404, "not found"

        board_discovery.probe(candidates, fetch=fetch)

        assert [c.live for c in candidates] == [True, False]
        assert candidates[0].role_count == 1

    def test_discovery_never_edits_the_registry(self):
        """A run that wrote to the file would be the unchecked guess the
        registry warns against, only faster."""
        before = boards_registry.all_boards()

        def get(url):
            return json.dumps(
                {"jobs": [{"apply_url": "https://boards.greenhouse.io/brandnew/jobs/1", "company": "New"}]}
            )

        def fetch(url):
            return 200, json.dumps({"jobs": [{"id": 1, "title": "X", "absolute_url": "https://x/1"}]})

        report = board_discovery.discover(max_pages=1, get=get, fetch=fetch)

        assert report.live, "the fixture should have produced a live candidate"
        assert boards_registry.all_boards() == before


class TestTheDirectoryFeedIsSomebodyElsesService:
    def test_a_failed_page_keeps_what_was_already_collected(self):
        calls = {"n": 0}

        def get(url):
            calls["n"] += 1
            if calls["n"] == 1:
                return json.dumps({"jobs": [{"apply_url": "https://x", "company": "A"}] * 200})
            raise TimeoutError("their service went away")

        rows, errors = board_discovery.fetch_directory(max_pages=5, get=get)

        assert len(rows) == 200, "a mid-run failure threw away the pages that worked"
        assert errors and "TimeoutError" in errors[0]

    def test_a_short_page_ends_the_run(self):
        """The end of the feed, not a reason to keep asking for more."""
        calls = {"n": 0}

        def get(url):
            calls["n"] += 1
            return json.dumps({"jobs": [{"apply_url": "https://x", "company": "A"}] * 3})

        board_discovery.fetch_directory(max_pages=10, get=get)
        assert calls["n"] == 1


class TestAshbyNormalisation:
    def _payload(self, **overrides):
        job = {
            "id": "abc",
            "title": "ML Engineer",
            "applyUrl": "https://jobs.ashbyhq.com/openai/abc/application",
            "location": "San Francisco",
            "isRemote": False,
            "isListed": True,
            "descriptionPlain": "Build things.",
            "publishedAt": "2026-09-01T00:00:00Z",
        }
        job.update(overrides)
        return {"jobs": [job]}

    def test_unlisted_postings_are_dropped(self):
        """A posting can sit in the API after the employer has unpublished
        it. Importing those shows applicants roles that were taken down."""
        rows = ats_boards.normalise_ashby(self._payload(isListed=False), "openai", "k")
        assert rows == []

    def test_the_display_name_is_used_instead_of_the_token(self):
        """Ashby returns no company name anywhere, so without this users see
        "mistral.ai" as an employer."""
        rows = ats_boards.normalise_ashby(
            self._payload(), "mistral.ai", "k", display_name="Mistral AI"
        )
        assert rows[0]["company"] == "Mistral AI"

    def test_it_falls_back_to_the_token_rather_than_blank(self):
        rows = ats_boards.normalise_ashby(self._payload(), "openai", "k")
        assert rows[0]["company"] == "openai"

    def test_remote_is_taken_from_the_flag_not_guessed_from_the_location(self):
        rows = ats_boards.normalise_ashby(
            self._payload(isRemote=True, location="San Francisco"), "x", "k"
        )
        assert rows[0]["work_mode"] == "Remote"

    def test_structured_pay_becomes_a_readable_range(self):
        payload = self._payload(
            compensation={
                "compensationTiers": [
                    {
                        "components": [
                            {
                                "compensationType": "Salary",
                                "minValue": 257000,
                                "maxValue": 335000,
                                "currencyCode": "USD",
                            }
                        ]
                    }
                ]
            }
        )
        rows = ats_boards.normalise_ashby(payload, "openai", "k")
        assert rows[0]["salary_range"] == "USD 257,000 - 335,000"

    def test_a_half_open_range_is_not_rendered_as_a_dangling_dash(self):
        """The UI renders whatever it is given, and "USD 200,000 -" is worse
        than saying nothing."""
        payload = self._payload(
            compensation={
                "compensationTiers": [
                    {
                        "components": [
                            {
                                "compensationType": "Salary",
                                "minValue": 200000,
                                "maxValue": None,
                                "currencyCode": "USD",
                            }
                        ]
                    }
                ]
            }
        )
        assert ats_boards.normalise_ashby(payload, "x", "k")[0]["salary_range"] == "USD 200,000+"

    def test_equity_only_compensation_is_not_reported_as_salary(self):
        payload = self._payload(
            compensation={
                "compensationTiers": [
                    {"components": [{"compensationType": "Equity", "minValue": 1, "maxValue": 2}]}
                ]
            }
        )
        assert ats_boards.normalise_ashby(payload, "x", "k")[0]["salary_range"] is None

    def test_rows_match_the_shape_the_other_providers_produce(self):
        """The sweep upserts all three providers through one path, so a
        missing key is an ingestion failure, not a fetch one."""
        greenhouse = ats_boards.normalise_greenhouse(
            {"jobs": [{"id": 1, "title": "T", "absolute_url": "https://x/1"}]}, "b", "k"
        )
        ashby = ats_boards.normalise_ashby(self._payload(), "b", "k")
        assert set(ashby[0]) == set(greenhouse[0])
        assert ashby[0]["source"] == "ashby"
        assert ashby[0]["external_id"].startswith("ashby:")


def test_an_unknown_provider_is_refused_rather_than_fetched_as_lever():
    """fetch_board used to treat anything that was not Greenhouse as Lever,
    so a typo would have quietly requested a Lever board of that name."""
    called = []

    def fetch(url):
        called.append(url)
        return 200, "[]"

    assert ats_boards.fetch_board("workday", "nvidia", fetch=fetch) == []
    assert called == [], "an unknown provider still issued a request"
