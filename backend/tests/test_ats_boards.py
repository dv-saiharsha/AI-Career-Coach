"""Free ATS board ingestion.

Every test injects its own fetcher. Nothing here touches the network — these
are somebody else's free endpoints and a test suite has no business hammering
them on every run, quite apart from the tests then failing whenever Greenhouse
is having a bad afternoon.
"""

import json

from app.modules.job_market import ats_boards

GREENHOUSE_PAYLOAD = {
    "jobs": [
        {
            "id": 8172487,
            "title": "Abuse Investigator",
            "company_name": "Stripe",
            "location": {"name": "Dublin"},
            "absolute_url": "https://stripe.com/jobs/search?gh_jid=8172487",
            "first_published": "2026-08-30T09:00:00-04:00",
            "updated_at": "2026-09-03T13:30:34-04:00",
            # Double-encoded exactly as the real API returns it.
            "content": "&lt;p&gt;Build &lt;strong&gt;payments&lt;/strong&gt; systems.&lt;/p&gt;&lt;p&gt;Python and Go.&lt;/p&gt;",
        }
    ]
}

LEVER_PAYLOAD = [
    {
        "id": "abc-123",
        "text": "Senior Backend Engineer",
        "hostedUrl": "https://jobs.lever.co/palantir/abc-123",
        "applyUrl": "https://jobs.lever.co/palantir/abc-123/apply",
        "categories": {"location": "London, UK", "workplaceType": "hybrid"},
        "descriptionPlain": "Design distributed systems.",
        "additionalPlain": "Kubernetes and Go.",
        "createdAt": 1787000000000,
    }
]


def _fetcher(status=200, body=""):
    return lambda url: (status, body)


class TestGreenhouse:
    def test_normalises_to_the_shape_ingestion_expects(self):
        rows = ats_boards.fetch_board(
            "greenhouse", "stripe", fetch=_fetcher(body=json.dumps(GREENHOUSE_PAYLOAD))
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["title"] == "Abuse Investigator"
        assert row["company"] == "Stripe"
        assert row["location"] == "Dublin"
        assert row["apply_url"].startswith("https://stripe.com/jobs")
        assert row["posted_at"] is not None
        # Same keys apify_jobs produces, so ingestion needs no special case.
        for key in ("query_key", "external_id", "work_mode", "skills", "description"):
            assert key in row

    def test_the_source_is_recorded_not_inferred(self):
        """The whole reason this source is worth having.

        A posting fetched from boards-api.greenhouse.io is a Greenhouse
        posting because that is where the bytes came from. The existing feed
        cannot know this — 2,536 of ~2,570 of its apply URLs are linkedin.com.
        """
        rows = ats_boards.fetch_board(
            "greenhouse", "stripe", fetch=_fetcher(body=json.dumps(GREENHOUSE_PAYLOAD))
        )
        assert rows[0]["source"] == "greenhouse"

    def test_double_encoded_html_is_fully_unwrapped(self):
        """Greenhouse returns HTML-escaped HTML. Unescaping once leaves tags.

        If only one layer comes off, the stored description contains visible
        markup — and the matcher reads that markup as resume vocabulary.
        """
        rows = ats_boards.fetch_board(
            "greenhouse", "stripe", fetch=_fetcher(body=json.dumps(GREENHOUSE_PAYLOAD))
        )
        description = rows[0]["description"]
        assert "Build payments systems." in description
        assert "<" not in description and "&lt;" not in description
        # Paragraph breaks survive, so two paragraphs do not become one sentence.
        assert "Python and Go." in description

    def test_blank_line_runs_are_collapsed(self):
        """The gap that reached the UI.

        Tag stripping leaves a newline per </p>, </li> and <br>, and the
        "blank" lines between them usually hold a single leftover space — so
        a newline-run regex never matches them. Measured on the stored feed
        before this was fixed: 33 such runs per description on average, up to
        50, each rendering as a visible paragraph break in the drawer.
        """
        payload = {
            "jobs": [
                {
                    "id": 1,
                    "title": "Engineer",
                    "absolute_url": "https://x.com/1",
                    "location": {"name": "Remote"},
                    "content": "&lt;p&gt;One&lt;/p&gt;&lt;p&gt; &lt;/p&gt;&lt;p&gt; &lt;/p&gt;&lt;p&gt; &lt;/p&gt;&lt;p&gt;Two&lt;/p&gt;",
                }
            ]
        }
        rows = ats_boards.fetch_board("greenhouse", "x", fetch=_fetcher(body=json.dumps(payload)))
        description = rows[0]["description"]
        assert "One" in description and "Two" in description
        assert "\n\n\n" not in description, "more than one blank line survived"
        assert description == description.strip()

    def test_a_job_with_no_url_or_title_is_dropped(self):
        payload = {"jobs": [{"id": 1, "title": "", "absolute_url": ""}]}
        rows = ats_boards.fetch_board("greenhouse", "x", fetch=_fetcher(body=json.dumps(payload)))
        assert rows == []


class TestLever:
    def test_normalises_and_records_its_source(self):
        rows = ats_boards.fetch_board(
            "lever", "palantir", fetch=_fetcher(body=json.dumps(LEVER_PAYLOAD))
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["source"] == "lever"
        assert row["title"] == "Senior Backend Engineer"
        assert row["location"] == "London, UK"
        assert row["posted_at"] is not None

    def test_structured_workplace_type_beats_reading_the_location_string(self):
        """Lever carries workplaceType, so guessing from text would be worse."""
        rows = ats_boards.fetch_board(
            "lever", "palantir", fetch=_fetcher(body=json.dumps(LEVER_PAYLOAD))
        )
        # "London, UK" says nothing about remote; the structured field says hybrid.
        assert rows[0]["work_mode"] == "Hybrid"

    def test_the_two_description_fields_are_joined(self):
        rows = ats_boards.fetch_board(
            "lever", "palantir", fetch=_fetcher(body=json.dumps(LEVER_PAYLOAD))
        )
        assert "Design distributed systems." in rows[0]["description"]
        assert "Kubernetes and Go." in rows[0]["description"]


class TestFailureIsNotAnError:
    """A sweep runs over dozens of boards. One bad company must not end it."""

    def test_404_means_this_company_does_not_use_this_ats(self):
        assert ats_boards.fetch_board("lever", "netflix", fetch=_fetcher(status=404)) == []

    def test_transport_failure_returns_empty(self):
        def boom(url):
            raise OSError("connection reset")

        assert ats_boards.fetch_board("greenhouse", "x", fetch=boom) == []

    def test_non_json_returns_empty(self):
        assert ats_boards.fetch_board("greenhouse", "x", fetch=_fetcher(body="<html>nope")) == []

    def test_one_dead_board_does_not_stop_the_others(self):
        def selective(url):
            if "dead" in url:
                raise OSError("down")
            return 200, json.dumps(GREENHOUSE_PAYLOAD)

        rows = ats_boards.fetch_boards(
            [("greenhouse", "dead"), ("greenhouse", "stripe")], fetch=selective
        )
        assert len(rows) == 1, "the reachable board's roles should still come through"


def test_work_mode_defaults_to_onsite_rather_than_guessing_remote():
    """A posting wrongly labelled Remote wastes an application. One wrongly
    labelled On-site costs a candidate a click they were going to make."""
    assert ats_boards._work_mode("Dublin") == "On-site"
    assert ats_boards._work_mode("Remote - US") == "Remote"
    assert ats_boards._work_mode("Hybrid, London") == "Hybrid"
    assert ats_boards._work_mode("") == "On-site"
