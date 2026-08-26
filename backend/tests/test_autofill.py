"""Autofill is heuristic, so these tests are mostly about what it refuses to do.

A wrong value here lands on a real resume and a user will not re-check a field
that looks filled. Guessing is therefore worse than leaving a blank, and most
of what follows pins that down.
"""

from app.modules.resume_builder.autofill import (
    build_autofill,
    extract_contact,
    extract_education,
    extract_experiences,
    extract_summary,
)

RESUME = """Venkata Sai Harshith Danda
Phoenix, AZ | (480) 555-0142 | venkata@example.com | linkedin.com/in/vshd

PROFESSIONAL SUMMARY
Backend engineer with five years building payment infrastructure at scale.

WORK EXPERIENCE
Senior Software Engineer, Stripe                        Jan 2022 - Present
- Cut p99 checkout latency 38% by replacing a synchronous fraud call with a queue
- Led migration of 40 services to Kubernetes, reducing spend $220K/yr
Software Engineer, Acme Corp                            Jun 2019 - Dec 2021
- Built an internal metrics pipeline processing 2B events daily

EDUCATION
M.S. Computer Science
Arizona State University                                2019

TECHNICAL SKILLS
Python, Go, Kubernetes, PostgreSQL
"""


def test_contact_fields_are_exact():
    c = extract_contact(RESUME)
    assert c["email"] == "venkata@example.com"
    assert c["phone"] == "(480) 555-0142"
    assert c["linkedin"] == "linkedin.com/in/vshd"
    assert c["name"] == "Venkata Sai Harshith Danda"


def test_location_does_not_swallow_the_name_line():
    r"""\s matched newlines, so the city ran back into the name above it and
    the location came out as "Venkata Sai Harshith Danda Phoenix, AZ"."""
    assert extract_contact(RESUME)["location"] == "Phoenix, AZ"


def test_title_and_company_split_when_on_one_line():
    roles = extract_experiences(RESUME)
    assert roles[0]["title"] == "Senior Software Engineer"
    assert roles[0]["company"] == "Stripe"


def test_splits_on_the_word_at():
    text = "EXPERIENCE\nStaff Engineer at Google    2020 - 2023\n- Did a thing\n"
    role = extract_experiences(text)[0]
    assert role["title"] == "Staff Engineer"
    assert role["company"] == "Google"


def test_bullets_keep_their_role():
    roles = extract_experiences(RESUME)
    assert len(roles) == 2
    assert len(roles[0]["bullets"]) == 2
    assert len(roles[1]["bullets"]) == 1
    assert roles[0]["bullets"][0].startswith("Cut p99")


def test_dates_are_captured_per_role():
    roles = extract_experiences(RESUME)
    assert roles[0]["dates"] == "Jan 2022 - Present"
    assert roles[1]["dates"] == "Jun 2019 - Dec 2021"


def test_education_reads_a_bare_year():
    edu = extract_education(RESUME)
    assert len(edu) == 1
    assert edu[0]["degree"] == "M.S. Computer Science"
    assert edu[0]["institution"] == "Arizona State University"
    assert edu[0]["dates"] == "2019"


def test_summary_needs_a_heading():
    assert extract_summary(RESUME).startswith("Backend engineer")
    # Prose near the top of a resume with no SUMMARY heading is an address
    # block or a skills line far more often than it is a summary.
    assert extract_summary("Jane Doe\nSome prose about nothing in particular.\n") is None


def test_phone_is_not_scavenged_from_bullet_metrics():
    """A loose phone pattern matches "1,500,000 requests" and date ranges. The
    search is confined to the header for exactly that reason."""
    text = "Jane Doe\njane@x.com\n\nEXPERIENCE\nEngineer  2019 - 2023\n- Scaled to 5551234567 requests\n"
    assert extract_contact(text)["phone"] is None


def test_unparseable_resume_returns_blanks_not_guesses():
    result = build_autofill("just some text with no structure at all")
    assert result["experiences"] == []
    assert result["education"] == []
    assert result["email"] is None
    assert result["phone"] is None
    assert result["summary"] is None


def test_empty_input_does_not_raise():
    result = build_autofill("")
    assert result["parsed_experience_count"] == 0
    assert result["confident_fields"] == []


def test_confident_lists_only_unambiguous_matches():
    """The name is positional and the roles are order-dependent, so neither is
    ever reported as confident — the UI marks them for review."""
    confident = build_autofill(RESUME)["confident_fields"]
    assert set(confident) == {"email", "phone", "linkedin", "summary"}
    assert "name" not in confident
    assert "experiences" not in confident


def test_counts_let_the_ui_distinguish_empty_from_untried():
    result = build_autofill(RESUME)
    assert result["parsed_experience_count"] == 2
    assert result["parsed_education_count"] == 1
