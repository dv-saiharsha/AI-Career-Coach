"""Free ATS board ingestion.

Every test injects its own fetcher. Nothing here touches the network — these
are somebody else's free endpoints and a test suite has no business hammering
them on every run, quite apart from the tests then failing whenever Greenhouse
is having a bad afternoon.
"""

import json
from urllib.parse import parse_qs, urlsplit

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

# Trimmed from a real, live response captured while building this adapter
# (apply.workable.com/api/v1/widget/accounts/huggingface?details=true).
WORKABLE_PAYLOAD = {
    "name": "Hugging Face",
    "jobs": [
        {
            "title": "Senior Storage Engineer",
            "shortcode": "F4C096B22E",
            "code": "",
            "employment_type": "Full-time",
            "telecommuting": True,
            "department": "Product",
            "url": "https://apply.workable.com/j/F4C096B22E",
            "application_url": "https://apply.workable.com/j/F4C096B22E/apply",
            "published_on": "2026-07-30",
            "country": "France",
            "city": "Paris",
            "state": "Île-de-France",
            "description": "<p>Build storage systems.</p><p>Rust and Python.</p>",
            "salary": {"salary_from": 90000, "salary_to": 120000, "salary_currency": "eur"},
        }
    ],
}

# Trimmed from a real, live response captured while building this adapter
# (api.smartrecruiters.com/v1/companies/Vitol/postings).
SMARTRECRUITERS_PAYLOAD = {
    "totalFound": 1,
    "content": [
        {
            "id": "744000152342599",
            "name": "Governance, Risk & Compliance Officer",
            "company": {"identifier": "Vitol", "name": "Vitol"},
            "location": {
                "city": "Geneva",
                "region": "GE",
                "country": "ch",
                "remote": False,
                "hybrid": False,
                "fullLocation": "Geneva, GE, Switzerland",
            },
            "department": {"id": "1736387", "label": "Technology"},
            "releasedDate": "2026-09-29T07:22:15.874Z",
        }
    ],
}

# Trimmed from a real, live response captured while building this adapter
# (recruitaero.recruitee.com/api/offers/).
RECRUITEE_PAYLOAD = {
    "offers": [
        {
            "id": 2608967,
            "title": "Head of Propulsion Engineering",
            "company_name": "RecruitAERO Corporation",
            "location": "Atlanta, Georgia, United States",
            "remote": False,
            "hybrid": False,
            "on_site": True,
            "department": None,
            "description": "<p>Lead propulsion engineering.</p>",
            "requirements": "<p>12+ years of gas turbine experience.</p>",
            "careers_apply_url": "https://recruitaero.recruitee.com/o/head-of-propulsion-engineering/c/new",
            "careers_url": "https://recruitaero.recruitee.com/o/head-of-propulsion-engineering",
            "published_at": "2026-05-21 16:05:31 UTC",
            "salary": {"min": None, "max": None, "period": None, "currency": None},
        }
    ],
}


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


class TestWorkable:
    def test_normalises_and_records_its_source(self):
        rows = ats_boards.fetch_board(
            "workable", "huggingface", fetch=_fetcher(body=json.dumps(WORKABLE_PAYLOAD))
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["source"] == "workable"
        assert row["title"] == "Senior Storage Engineer"
        assert row["company"] == "Hugging Face"
        assert row["department"] == "Product"
        assert row["apply_url"] == "https://apply.workable.com/j/F4C096B22E/apply"
        assert row["posted_at"] is not None

    def test_telecommuting_flag_beats_reading_the_location_string(self):
        rows = ats_boards.fetch_board(
            "workable", "huggingface", fetch=_fetcher(body=json.dumps(WORKABLE_PAYLOAD))
        )
        # "Paris, Île-de-France, France" says nothing about remote; the
        # structured telecommuting flag says it is.
        assert rows[0]["work_mode"] == "Remote"

    def test_structured_salary_is_parsed(self):
        rows = ats_boards.fetch_board(
            "workable", "huggingface", fetch=_fetcher(body=json.dumps(WORKABLE_PAYLOAD))
        )
        row = rows[0]
        assert row["salary_min"] == 90000
        assert row["salary_max"] == 120000
        assert row["salary_currency"] == "EUR"
        assert "90,000" in row["salary_range"] and "120,000" in row["salary_range"]

    def test_a_job_with_no_shortcode_is_dropped(self):
        payload = {"name": "X", "jobs": [{"title": "Engineer", "url": "https://x.com/1"}]}
        rows = ats_boards.fetch_board("workable", "x", fetch=_fetcher(body=json.dumps(payload)))
        assert rows == []


class TestSmartRecruiters:
    def test_normalises_and_records_its_source(self):
        rows = ats_boards.fetch_board(
            "smartrecruiters", "Vitol", fetch=_fetcher(body=json.dumps(SMARTRECRUITERS_PAYLOAD))
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["source"] == "smartrecruiters"
        assert row["company"] == "Vitol"
        assert row["location"] == "Geneva, GE, Switzerland"
        assert row["department"] == "Technology"
        assert row["posted_at"] is not None

    def test_apply_url_is_synthesized_without_a_detail_fetch(self):
        """The list endpoint carries no postingUrl/applyUrl — those only
        exist behind a per-posting detail call this adapter deliberately
        does not make (see normalise_smartrecruiters' docstring). Confirmed
        live that SmartRecruiters' own routing resolves the bare id with no
        SEO slug suffix."""
        rows = ats_boards.fetch_board(
            "smartrecruiters", "Vitol", fetch=_fetcher(body=json.dumps(SMARTRECRUITERS_PAYLOAD))
        )
        assert rows[0]["apply_url"] == "https://jobs.smartrecruiters.com/Vitol/744000152342599"

    def test_a_posting_with_no_id_or_name_is_dropped(self):
        payload = {"content": [{"company": {"identifier": "x"}}]}
        rows = ats_boards.fetch_board(
            "smartrecruiters", "x", fetch=_fetcher(body=json.dumps(payload))
        )
        assert rows == []


class TestRecruitee:
    def test_normalises_and_records_its_source(self):
        rows = ats_boards.fetch_board(
            "recruitee", "recruitaero", fetch=_fetcher(body=json.dumps(RECRUITEE_PAYLOAD))
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["source"] == "recruitee"
        assert row["title"] == "Head of Propulsion Engineering"
        assert row["company"] == "RecruitAERO Corporation"
        assert row["apply_url"].endswith("/c/new")
        assert row["posted_at"] is not None

    def test_three_explicit_flags_beat_reading_the_location_string(self):
        """Recruitee is the one board of the six that states remote/hybrid/
        on-site as booleans rather than one flag plus a guess."""
        rows = ats_boards.fetch_board(
            "recruitee", "recruitaero", fetch=_fetcher(body=json.dumps(RECRUITEE_PAYLOAD))
        )
        assert rows[0]["work_mode"] == "On-site"

    def test_description_and_requirements_are_joined(self):
        rows = ats_boards.fetch_board(
            "recruitee", "recruitaero", fetch=_fetcher(body=json.dumps(RECRUITEE_PAYLOAD))
        )
        description = rows[0]["description"]
        assert "Lead propulsion engineering." in description
        assert "12+ years of gas turbine experience." in description

    def test_a_null_salary_produces_no_salary_range(self):
        rows = ats_boards.fetch_board(
            "recruitee", "recruitaero", fetch=_fetcher(body=json.dumps(RECRUITEE_PAYLOAD))
        )
        assert rows[0]["salary_range"] is None

    def test_an_offer_with_no_apply_url_is_dropped(self):
        payload = {"offers": [{"id": 1, "title": "Engineer"}]}
        rows = ats_boards.fetch_board("recruitee", "x", fetch=_fetcher(body=json.dumps(payload)))
        assert rows == []


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


class TestWorkday:
    def test_fetches_us_pages_and_normalises_the_shared_shape(self):
        board = "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
        initial = {
            "facets": [
                {
                    "facetParameter": "locationMainGroup",
                    "values": [
                        {
                            "facetParameter": "locationHierarchy1",
                            "values": [{"descriptor": "United States", "id": "us-id"}],
                        }
                    ],
                }
            ]
        }
        page = {
            "total": 1,
            "jobPostings": [
                {
                    "title": "Software Engineer",
                    "externalPath": "/job/California-Santa-Clara/Software-Engineer_JR123",
                    "locationsText": "Santa Clara, CA",
                    "postedOn": "Posted Today",
                    "bulletFields": ["JR123"],
                }
            ],
        }
        requests = []

        def fetch(url, body):
            requests.append((url, body))
            return 200, json.dumps(initial if len(requests) == 1 else page)

        rows = ats_boards.fetch_board("workday", board, fetch=fetch, display_name="NVIDIA")

        assert len(requests) == 2
        assert requests[1][1]["appliedFacets"] == {"locationHierarchy1": ["us-id"]}
        assert requests[1][1]["limit"] == 20
        assert len(rows) == 1
        assert rows[0]["company"] == "NVIDIA"
        assert rows[0]["source"] == "workday"
        assert rows[0]["external_id"] == "workday:nvidia:JR123"
        assert rows[0]["apply_url"] == (
            "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/California-Santa-Clara/Software-Engineer_JR123"
        )
        assert rows[0]["description"] is None
        assert rows[0]["posted_at"] is not None

    def test_continues_pagination_when_later_pages_report_zero_total(self):
        board = "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
        initial = {
            "facets": [
                {
                    "facetParameter": "locationHierarchy1",
                    "values": [{"descriptor": "United States", "id": "us-id"}],
                }
            ]
        }

        def postings(start, count):
            return [
                {
                    "title": f"Engineer {index}",
                    "externalPath": f"/job/US/Engineer_{index}",
                    "locationsText": "United States",
                    "bulletFields": [f"JR{index}"],
                }
                for index in range(start, start + count)
            ]

        pages = [
            {"total": 41, "jobPostings": postings(0, 20)},
            {"total": 0, "jobPostings": postings(20, 20)},
            {"total": 0, "jobPostings": postings(40, 1)},
        ]
        requests = []

        def fetch(url, body):
            requests.append(body)
            if len(requests) == 1:
                return 200, json.dumps(initial)
            return 200, json.dumps(pages[len(requests) - 2])

        rows = ats_boards.fetch_board("workday", board, fetch=fetch)

        assert [request["offset"] for request in requests[1:]] == [0, 20, 40]
        assert len(rows) == 41

    def test_fetches_a_board_without_a_country_facet_unfiltered(self):
        # Intel, Cisco, Capital One...: only a city-level "locations" facet.
        # The crawler's geo filter drops the non-U.S. rows afterwards.
        page = {
            "total": 1,
            "jobPostings": [
                {"title": "Engineer", "externalPath": "/job/US-OR-Hillsboro/Engineer_JR1", "locationsText": "US, Oregon, Hillsboro"}
            ],
        }
        requests = []

        def fetch(url, body):
            requests.append(body)
            return 200, json.dumps({"facets": [{"facetParameter": "locations", "values": []}]} if len(requests) == 1 else page)

        rows = ats_boards.fetch_board("workday", "intel.wd1.myworkdayjobs.com/External", fetch=fetch)

        assert requests[1]["appliedFacets"] == {}
        assert [row["apply_url"] for row in rows] == [
            "https://intel.wd1.myworkdayjobs.com/External/job/US-OR-Hillsboro/Engineer_JR1"
        ]

    def test_recognises_tenant_named_country_facets(self):
        for facet_parameter in ("Location_Country", "Country_and_Jurisdiction", "CF_-_REC_-_Country_from_Job_Posting_Location"):
            facets = [{"facetParameter": facet_parameter, "values": [{"descriptor": "United States of America", "id": "us"}]}]
            assert ats_boards._workday_us_facet(facets) == (facet_parameter, "us")

    def test_stops_at_the_page_cap(self, monkeypatch):
        monkeypatch.setattr(ats_boards, "WORKDAY_MAX_PAGES", 2)
        requests = []

        def fetch(url, body):
            requests.append(body)
            if len(requests) == 1:
                return 200, json.dumps({"facets": []})
            offset = body["offset"]
            postings = [{"title": f"Role {n}", "externalPath": f"/job/US/Role_{n}"} for n in range(offset, offset + 20)]
            return 200, json.dumps({"total": 500, "jobPostings": postings})

        rows = ats_boards.fetch_board("workday", "cvshealth.wd1.myworkdayjobs.com/CVS_Health_Careers", fetch=fetch)

        assert len(requests) == 3
        assert len(rows) == 40

    def test_uses_country_facet_when_board_does_not_have_hierarchy_facet(self):
        board = "motorolasolutions.wd5.myworkdayjobs.com/Careers"
        initial = {
            "facets": [
                {
                    "facetParameter": "locationMainGroup",
                    "values": [
                        {
                            "facetParameter": "locationCountry",
                            "values": [{"descriptor": "United States", "id": "us-country-id"}],
                        }
                    ],
                }
            ]
        }
        page = {"total": 0, "jobPostings": []}
        requests = []

        def fetch(url, body):
            requests.append(body)
            return 200, json.dumps(initial if len(requests) == 1 else page)

        rows = ats_boards.fetch_board("workday", board, fetch=fetch)

        assert rows == []
        assert requests[1]["appliedFacets"] == {"locationCountry": ["us-country-id"]}

    def test_fetches_description_and_accepts_only_same_host_apply_url(self):
        board = "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
        response = {
            "jobPostingInfo": {
                "jobDescription": "<p>Build cloud systems.</p>",
                "externalUrl": (
                    "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/Engineer_JR1"
                ),
            }
        }
        requested = []

        def fetch(url):
            requested.append(url)
            return 200, json.dumps(response)

        description, apply_url = ats_boards.fetch_workday_detail(
            board, "https://nvidia.wd5.myworkdayjobs.com/job/US/Engineer_JR1", fetch=fetch
        )

        assert "Build cloud systems." in description
        assert "<p>" not in description
        assert apply_url == response["jobPostingInfo"]["externalUrl"]
        assert requested[0].endswith("/job/Engineer_JR1")

    def test_rejects_an_external_apply_host(self):
        board = "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
        response = {
            "jobPostingInfo": {
                "jobDescription": "Role details.",
                "externalUrl": "https://apply-redirect.example.test/role",
            }
        }
        description, apply_url = ats_boards.fetch_workday_detail(
            board,
            "https://nvidia.wd5.myworkdayjobs.com/job/US/Engineer_JR1",
            fetch=lambda url: (200, json.dumps(response)),
        )

        assert description == "Role details."
        assert apply_url is None


class TestAmazonJobs:
    def test_only_explicit_us_postings_are_normalised(self):
        rows = ats_boards.normalise_amazon(
            [
                {
                    "id_icims": "123",
                    "title": "Site Reliability Engineer",
                    "company_name": "Amazon",
                    "country_code": "USA",
                    "location": "US, WA, Seattle",
                    "locations": [json.dumps({"type": "REMOTE"})],
                    "job_path": "/en/jobs/123/site-reliability-engineer",
                    "url_next_step": "https://account.amazon.com/jobs/123/apply",
                    "description": "<p>Keep systems reliable.</p>",
                    "posted_date": "October 17, 2026",
                },
                {
                    "id_icims": "456",
                    "title": "Engineer",
                    "country_code": "GBR",
                    "location": "GB, London",
                    "job_path": "/en/jobs/456/engineer",
                },
            ],
            "amazon_jobs:amazon",
        )

        assert len(rows) == 1
        assert rows[0]["external_id"] == "amazon:123"
        assert rows[0]["work_mode"] == "Remote"
        assert rows[0]["description"] == "Keep systems reliable."
        assert rows[0]["apply_url"] == "https://www.amazon.jobs/en/jobs/123/site-reliability-engineer"
        assert rows[0]["company"] == "Amazon"
        assert rows[0]["posted_at"] is not None

    def test_deduplicates_the_same_job_across_role_queries(self):
        payload = {
            "hits": 1,
            "jobs": [
                {
                    "id_icims": "123",
                    "title": "Software Engineer",
                    "country_code": "USA",
                    "location": "US, WA, Seattle",
                    "job_path": "/en/jobs/123/software-engineer",
                }
            ],
        }
        calls = []

        def fetch(url):
            calls.append(url)
            return 200, json.dumps(payload)

        rows = ats_boards.fetch_amazon_board("amazon_jobs:amazon", fetch=fetch, max_pages=1)

        assert len(calls) == len(ats_boards.PUBLIC_ROLE_QUERIES)
        assert len(rows) == 1
        assert rows[0]["external_id"] == "amazon:123"


class TestMicrosoftJobs:
    def test_search_keeps_only_us_jobs(self):
        payload = {
            "data": {
                "count": 1,
                "positions": [
                    {
                        "id": 123,
                        "displayJobId": "200123",
                        "name": "Site Reliability Engineer",
                        "locations": ["United States, Washington, Redmond"],
                        "positionUrl": "/careers/job/123",
                        "postedTs": 1792220400,
                        "workLocationOption": "remote",
                    },
                    {
                        "id": 456,
                        "name": "Engineer",
                        "locations": ["India, Hyderabad"],
                        "positionUrl": "/careers/job/456",
                    },
                ],
            }
        }
        calls = []

        def fetch(url):
            calls.append(url)
            return 200, json.dumps(payload)

        rows = ats_boards.fetch_microsoft_board("microsoft_jobs:microsoft", fetch=fetch, max_pages=1)

        assert len(calls) == 1
        assert len(rows) == 1
        assert rows[0]["external_id"] == "microsoft:200123"
        assert rows[0]["location"] == "United States, Washington, Redmond"
        assert rows[0]["work_mode"] == "Remote"
        assert rows[0]["apply_url"] == "https://apply.careers.microsoft.com/careers/job/123"

    def test_pages_through_the_whole_us_board_unfiltered(self):
        def position(n):
            return {
                "id": n,
                "displayJobId": str(n),
                "name": f"Role {n}",
                "locations": ["United States, Washington, Redmond"],
                "positionUrl": f"/careers/job/{n}",
            }

        pages = {0: [position(n) for n in range(10)], 10: [position(n) for n in range(10, 15)]}
        calls = []

        def fetch(url):
            calls.append(url)
            start = int(parse_qs(urlsplit(url).query)["start"][0])
            return 200, json.dumps({"data": {"count": 15, "positions": pages[start]}})

        rows = ats_boards.fetch_microsoft_board("microsoft_jobs:microsoft", fetch=fetch)

        assert len(calls) == 2
        assert all(parse_qs(urlsplit(url).query).get("query") in (None, [""]) for url in calls)
        assert len(rows) == 15

    def test_detail_fetch_reads_the_matching_job_posting_description(self):
        html = (
            '<script type="application/ld+json">'
            '{"@context":"https://schema.org","@type":"JobPosting",'
            '"title":"Software Engineer","description":"<p>Build software.</p>"}'
            "</script>"
        )

        description = ats_boards.fetch_microsoft_detail(
            "https://apply.careers.microsoft.com/careers/job/123",
            "Software Engineer",
            fetch=lambda url: (200, html),
        )

        assert description == "Build software."
