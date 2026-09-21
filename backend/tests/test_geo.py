"""geo.is_non_us_location — the blocklist behind the job feed's US-only rule.

Regression: employers' own Greenhouse/Lever/Ashby boards (ats_boards.py) list
every office's openings with no country filter of their own, so a US-focused
feed showed Brazil and India postings from multinational companies alongside
the US ones. This is the predicate that both ingestion (skip on the way in)
and the feed (skip on the way out) now share.
"""

from app.modules.job_market import geo


class TestExplicitNonUsSignalsAreExcluded:
    def test_country_name_in_the_location(self):
        assert geo.is_non_us_location("São Paulo, Brazil") is True

    def test_region_tag_used_instead_of_a_country(self):
        assert geo.is_non_us_location("Remote (EMEA)") is True

    def test_well_known_foreign_city_with_no_country_suffix(self):
        assert geo.is_non_us_location("Bangalore") is True

    def test_uk_abbreviation_with_word_boundaries(self):
        assert geo.is_non_us_location("London, UK") is True

    def test_case_insensitive(self):
        assert geo.is_non_us_location("TORONTO, CANADA") is True


class TestAmbiguousOrUsSignalsAreKept:
    """Absence of a US marker is not evidence of a non-US one — see the
    module docstring. Only an explicit foreign signal excludes a row."""

    def test_plain_us_city_and_state(self):
        assert geo.is_non_us_location("San Francisco, CA") is False

    def test_bare_remote_with_no_region(self):
        assert geo.is_non_us_location("Remote") is False

    def test_not_specified(self):
        assert geo.is_non_us_location("Not specified") is False

    def test_blank_string(self):
        assert geo.is_non_us_location("") is False

    def test_none(self):
        assert geo.is_non_us_location(None) is False

    def test_uk_is_not_matched_as_a_bare_substring(self):
        """Milwaukee must survive — "uk" appearing mid-word is not the UK."""
        assert geo.is_non_us_location("Milwaukee, WI") is False

    def test_us_state_abbreviation_that_collides_with_a_country_code_style(self):
        """CA is California here, not a Canada code — no bare 2-letter code
        is ever treated as a country signal, precisely to avoid this."""
        assert geo.is_non_us_location("Los Angeles, CA") is False
