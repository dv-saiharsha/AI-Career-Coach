"""ATS detection against a company's careers page. No network — this reads
someone else's website, not a public API, and a test suite has no business
hammering it."""

from app.modules.job_market import company_detection


def _allow_robots(monkeypatch):
    monkeypatch.setattr(company_detection.jsonld_crawler, "_robots_allow", lambda url, fetch: True)


class TestFindAtsLink:
    def test_finds_a_greenhouse_link(self):
        html = '<a href="https://job-boards.greenhouse.io/acme">Careers</a>'
        assert company_detection.find_ats_link(html) == ("greenhouse", "acme")

    def test_finds_a_recruitee_subdomain(self):
        html = '<iframe src="https://acme.recruitee.com/embed"></iframe>'
        assert company_detection.find_ats_link(html) == ("recruitee", "acme")

    def test_ignores_a_workable_job_detail_link(self):
        """apply.workable.com/j/<shortcode> is a job link, not the account
        slug — a naive capture would mistake "j" itself for the slug."""
        html = '<a href="https://apply.workable.com/j/ABC123/apply">Apply</a>'
        assert company_detection.find_ats_link(html) is None

    def test_finds_a_workable_account_slug(self):
        html = '<div data-account="acme"></div><script src="https://apply.workable.com/acme/widget.js">'
        assert company_detection.find_ats_link(html) == ("workable", "acme")

    def test_returns_none_for_an_unrelated_page(self):
        assert company_detection.find_ats_link("<html><body>No jobs here</body></html>") is None


class TestDetectOne:
    def test_no_careers_url_is_manual_review(self, monkeypatch):
        row, message = company_detection.detect_one({"name": "Acme", "careers_url": ""})
        assert row["ats_type"] == "manual_review"
        assert "no careers_url" in message

    def test_robots_disallow_is_manual_review(self, monkeypatch):
        monkeypatch.setattr(company_detection.jsonld_crawler, "_robots_allow", lambda url, fetch: False)
        row, message = company_detection.detect_one({"name": "Acme", "careers_url": "https://acme.example/careers"})
        assert row["ats_type"] == "manual_review"
        assert "robots.txt" in message

    def test_a_matched_and_confirmed_link_wins(self, monkeypatch):
        _allow_robots(monkeypatch)
        html = '<a href="https://job-boards.greenhouse.io/acme">Careers</a>'
        row, message = company_detection.detect_one(
            {"name": "Acme", "careers_url": "https://acme.example/careers"},
            fetch=lambda url: (200, html),
            probe=lambda provider, token: [{"title": "Engineer"}],
        )
        assert row["ats_type"] == "greenhouse"
        assert row["ats_slug"] == "acme"
        assert "1 roles" in message

    def test_a_matched_but_dead_link_falls_through(self, monkeypatch):
        """The regex found a link, but probing it returned nothing — matches
        boards_registry.py's own "a token is a guess until it returns jobs"
        discipline, so this must not accept the guess."""
        _allow_robots(monkeypatch)
        html = '<a href="https://job-boards.greenhouse.io/acme">Careers</a>'
        row, message = company_detection.detect_one(
            {"name": "Acme", "careers_url": "https://acme.example/careers"},
            fetch=lambda url: (200, html),
            probe=lambda provider, token: [],
            jsonld_extract=lambda body: [],
        )
        assert row["ats_type"] == "manual_review"

    def test_falls_back_to_jsonld_when_no_ats_link_matches(self, monkeypatch):
        _allow_robots(monkeypatch)
        row, message = company_detection.detect_one(
            {"name": "Acme", "careers_url": "https://acme.example/careers"},
            fetch=lambda url: (200, "<html>no ats links here</html>"),
            jsonld_extract=lambda body: [{"@type": "JobPosting"}],
        )
        assert row["ats_type"] == "jsonld"

    def test_neither_ats_nor_jsonld_is_manual_review(self, monkeypatch):
        _allow_robots(monkeypatch)
        row, message = company_detection.detect_one(
            {"name": "Acme", "careers_url": "https://acme.example/careers"},
            fetch=lambda url: (200, "<html>nothing here</html>"),
            jsonld_extract=lambda body: [],
        )
        assert row["ats_type"] == "manual_review"

    def test_a_non_200_status_is_manual_review(self, monkeypatch):
        _allow_robots(monkeypatch)
        row, message = company_detection.detect_one(
            {"name": "Acme", "careers_url": "https://acme.example/careers"},
            fetch=lambda url: (404, ""),
        )
        assert row["ats_type"] == "manual_review"
        assert "404" in message

    def test_transport_failure_is_manual_review_not_an_exception(self, monkeypatch):
        _allow_robots(monkeypatch)

        def boom(url):
            raise OSError("connection reset")

        row, message = company_detection.detect_one(
            {"name": "Acme", "careers_url": "https://acme.example/careers"}, fetch=boom
        )
        assert row["ats_type"] == "manual_review"
        assert "unreachable" in message

    def test_does_not_mutate_the_caller_s_row(self, monkeypatch):
        _allow_robots(monkeypatch)
        original = {"name": "Acme", "careers_url": "https://acme.example/careers", "ats_type": ""}
        company_detection.detect_one(
            original, fetch=lambda url: (200, "<html></html>"), jsonld_extract=lambda body: []
        )
        assert original["ats_type"] == ""
