"""JSON-LD careers-page fallback. No network — these fetch someone else's
website, not a public API, and a test suite has no business hammering it."""

import json

from app.modules.job_market import jsonld_crawler

JOBPOSTING = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    "title": "Senior Mechanical Engineer",
    "description": "<p>Design propulsion hardware.</p>",
    "datePosted": "2026-08-01",
    "hiringOrganization": {"@type": "Organization", "name": "Acme Aerospace"},
    "jobLocation": {
        "@type": "Place",
        "address": {
            "@type": "PostalAddress",
            "addressLocality": "Austin",
            "addressRegion": "TX",
            "addressCountry": "US",
        },
    },
    "identifier": {"@type": "PropertyValue", "name": "Acme Aerospace", "value": "REQ-4821"},
    "url": "https://acme.example/careers/senior-mechanical-engineer",
    "baseSalary": {
        "@type": "MonetaryAmount",
        "currency": "USD",
        "value": {"@type": "QuantitativeValue", "minValue": 120000, "maxValue": 160000, "unitText": "YEAR"},
    },
}


def _page(*postings, extra_html: str = "") -> str:
    blocks = "".join(
        f'<script type="application/ld+json">{json.dumps(p)}</script>' for p in postings
    )
    return f"<html><head>{blocks}</head><body>{extra_html}</body></html>"


def _fetcher(responses: dict[str, tuple[int, str]]):
    """Maps a URL to (status, body); a robots.txt fetch is included by
    default unless the test overrides it."""

    def fetch(url):
        if url in responses:
            return responses[url]
        if url.endswith("/robots.txt"):
            return 404, ""
        raise AssertionError(f"unexpected fetch: {url}")

    return fetch


class TestExtraction:
    def test_normalises_a_single_jobposting_block(self):
        page = _page(JOBPOSTING)
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["source"] == "jsonld"
        assert row["title"] == "Senior Mechanical Engineer"
        assert row["company"] == "Acme Aerospace"
        assert row["location"] == "Austin, TX, US"
        assert row["apply_url"] == "https://acme.example/careers/senior-mechanical-engineer"
        assert row["posted_at"] is not None
        assert row["external_id"] == "jsonld:acme.example:REQ-4821"

    def test_html_description_is_stripped(self):
        page = _page(JOBPOSTING)
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert rows[0]["description"] == "Design propulsion hardware."

    def test_structured_salary_is_parsed(self):
        page = _page(JOBPOSTING)
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        row = rows[0]
        assert row["salary_min"] == 120000
        assert row["salary_max"] == 160000
        assert row["salary_currency"] == "USD"

    def test_telecommute_flag_beats_reading_the_address(self):
        remote_posting = {**JOBPOSTING, "jobLocationType": "TELECOMMUTE"}
        page = _page(remote_posting)
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert rows[0]["work_mode"] == "Remote"
        assert rows[0]["location"] == "Remote"

    def test_at_graph_wrapper_is_unwrapped(self):
        wrapped = {"@context": "https://schema.org/", "@graph": [JOBPOSTING, {"@type": "Organization"}]}
        page = (
            '<html><head><script type="application/ld+json">'
            + json.dumps(wrapped)
            + "</script></head><body></body></html>"
        )
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert len(rows) == 1
        assert rows[0]["title"] == "Senior Mechanical Engineer"

    def test_a_bare_list_of_jobpostings_is_handled(self):
        second = {**JOBPOSTING, "title": "Staff Mechanical Engineer", "url": "https://acme.example/careers/staff"}
        page = _page([JOBPOSTING, second])
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert {row["title"] for row in rows} == {"Senior Mechanical Engineer", "Staff Mechanical Engineer"}

    def test_non_jobposting_types_are_ignored(self):
        page = _page({"@type": "Organization", "name": "Acme Aerospace"})
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert rows == []

    def test_a_posting_with_no_url_is_dropped(self):
        """A generic fallback URL would point every posting on the page at
        the same link, which is worse than dropping the row."""
        page = _page({**JOBPOSTING, "url": ""})
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert rows == []

    def test_malformed_json_in_one_block_does_not_break_the_others(self):
        page = (
            '<html><head><script type="application/ld+json">{not json</script>'
            '<script type="application/ld+json">' + json.dumps(JOBPOSTING) + "</script></head></html>"
        )
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert len(rows) == 1


class TestFailureIsNotAnError:
    def test_a_disallowing_robots_txt_blocks_the_fetch(self):
        def fetch(url):
            if url == "https://acme.example/robots.txt":
                return 200, "User-agent: *\nDisallow: /careers"
            raise AssertionError("the page itself must not be fetched when robots.txt disallows it")

        rows = jsonld_crawler.fetch_jsonld_postings("https://acme.example/careers", fetch=fetch)
        assert rows == []

    def test_an_unrelated_robots_disallow_does_not_block_this_path(self):
        page = _page(JOBPOSTING)

        def fetch(url):
            if url == "https://acme.example/robots.txt":
                return 200, "User-agent: *\nDisallow: /admin"
            if url == "https://acme.example/careers":
                return 200, page
            raise AssertionError(f"unexpected fetch: {url}")

        rows = jsonld_crawler.fetch_jsonld_postings("https://acme.example/careers", fetch=fetch)
        assert len(rows) == 1

    def test_missing_robots_txt_does_not_block_the_fetch(self):
        page = _page(JOBPOSTING)
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (200, page)})
        )
        assert len(rows) == 1

    def test_transport_failure_returns_empty(self):
        def boom(url):
            raise OSError("connection reset")

        assert jsonld_crawler.fetch_jsonld_postings("https://acme.example/careers", fetch=boom) == []

    def test_404_returns_empty(self):
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers", fetch=_fetcher({"https://acme.example/careers": (404, "")})
        )
        assert rows == []

    def test_a_page_with_no_ldjson_returns_empty(self):
        rows = jsonld_crawler.fetch_jsonld_postings(
            "https://acme.example/careers",
            fetch=_fetcher({"https://acme.example/careers": (200, "<html><body>No jobs here</body></html>")}),
        )
        assert rows == []
