"""location_priority — calibrated against the ~13,800 real rows in this
database (2,366 distinct location strings) before being written, not guessed
at from a handful of examples. See job_market/location.py's own docstring for
why three tiers rather than two: a bare "Remote"/"Hybrid" is not evidence a
job is foreign, and folding it into the non-US tier would bury real US
remote roles alongside actually-foreign ones.
"""

from app.modules.job_market.location import location_priority


class TestUSLocations:
    def test_state_abbreviation(self):
        assert location_priority("New York, NY") == 0
        assert location_priority("San Francisco, CA") == 0

    def test_named_outright(self):
        assert location_priority("United States") == 0
        assert location_priority("Remote - USA") == 0
        assert location_priority("Remote - United States") == 0

    def test_state_name_without_abbreviation(self):
        assert location_priority("Seattle, Washington") == 0
        assert location_priority("Mountain View, California") == 0

    def test_bare_major_city_with_no_state_or_country(self):
        """138 rows in the real data are exactly this shape."""
        assert location_priority("San Francisco") == 0
        assert location_priority("New York City") == 0
        assert location_priority("Chicago") == 0

    def test_washington_dc(self):
        assert location_priority("Washington, D.C.") == 0
        assert location_priority("Washington, DC") == 0

    def test_multi_location_string_naming_the_us_anywhere(self):
        """Real example: also names Canada, but a US option exists — that
        is enough to lead with it rather than demote the whole row."""
        assert (
            location_priority(
                "San Francisco, CA, New York, NY, Portland, OR, "
                "or Remote within Canada or United States"
            )
            == 0
        )

    def test_bare_state_code_without_a_comma(self):
        """Real example: "Remote - CA", "CA Remote (BC & ON only)"."""
        assert location_priority("Remote - CA") == 0


class TestNonUSLocations:
    def test_named_country(self):
        assert location_priority("Singapore") == 2
        assert location_priority("Toronto, Canada") == 2

    def test_country_only_named_via_city(self):
        assert location_priority("Cork") == 2
        assert location_priority("Bengaluru, India") == 2
        assert location_priority("London, UK") == 2

    def test_uk_home_nations(self):
        """Real examples: Salford/Bromley/Coventry/Cambridge, England etc. —
        one shared marker covers all of them rather than naming each city."""
        assert location_priority("Salford, England") == 2
        assert location_priority("Cardiff, Wales") == 2


class TestAmbiguousLocations:
    """No usable country signal — must stay neutral, not get pushed into
    either tier 0 or tier 2."""

    def test_remote_alone(self):
        assert location_priority("Remote") == 1
        assert location_priority("Hybrid") == 1
        assert location_priority("Distributed") == 1

    def test_blank(self):
        assert location_priority("") == 1
        assert location_priority(None) == 1

    def test_placeholder_values(self):
        assert location_priority("N/A") == 1
