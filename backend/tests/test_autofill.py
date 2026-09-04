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


# A resume shaped exactly like the one that surfaced this bug: bullet
# characters lost in PDF extraction (a real, common failure — the glyph is
# not always present in the text stream), an employer line sitting ABOVE the
# date instead of beside it, a five-word name, and education written as one
# pipe-joined header line followed by a separate date line. Every one of
# these produced a wrong field before the fix; the resume that reached a
# real user had "Implemented secure user authentication..." as an employer.
MARKERLESS_RESUME = """Shiva Venkata Raj Chowdary Valluri
+1-(623) 275-6345 | shivavenkatarajchowdary@gmail.com

SUMMARY
Backend engineer with hands-on experience building distributed systems.

EXPERIENCE
Arizona State University
November 2024 - April 2026
Research Assistant - Arizona State University
Collaborated in an Agile/Scrum environment, participating in sprint planning and structured
code reviews to align data engineering deliverables with research milestones.
Deployed and managed data ingestion workflows on AWS using Docker and Kubernetes
orchestration, applying CI/CD practices to maintain reliable pipeline execution.
Microsoft
September 2021 - February 2022
Software Engineer - Microsoft
Implemented secure user authentication and middleware-based authorization controls,
applying secure coding practices to protect application data and restrict unauthorized access.
Developed and deployed a cloud-native web application on Microsoft Azure, provisioning and
configuring Virtual Machines to support scalable, reliable production infrastructure.

EDUCATION
Arizona State University, Tempe, AZ, USA | Master of Science, Information Technology | GPA: 4.0/4.0
2024 - 2026
Koneru Lakshmaiah University, Vijayawada, AP, India | Bachelor of Technology, Computer Science and Engineering | GPA: 9.0/10.0
2020 - 2024
"""


class TestBulletMarkersLostInPdfExtraction:
    """The actual bug: a PDF whose bullet glyphs did not survive extraction,
    so the old marker-only test read every bullet as a header line."""

    def test_the_company_is_the_employer_not_a_bullet(self):
        """This is the literal defect a real user hit: a bullet promoted to
        an employer name, printed on their generated resume."""
        roles = extract_experiences(MARKERLESS_RESUME)
        companies = [r["company"] for r in roles]
        assert companies == ["Arizona State University", "Microsoft"]
        assert not any(c.lower().startswith("implemented") for c in companies)
        assert not any(c.lower().startswith("collaborated") for c in companies)

    def test_the_title_is_the_role_not_the_school(self):
        roles = extract_experiences(MARKERLESS_RESUME)
        assert roles[0]["title"] == "Research Assistant"
        assert roles[1]["title"] == "Software Engineer"

    def test_no_bullets_are_dropped(self):
        """Every bullet fell into the header block and vanished entirely
        before the fix — 0 bullets on a role that has several."""
        roles = extract_experiences(MARKERLESS_RESUME)
        assert len(roles[0]["bullets"]) == 2
        assert len(roles[1]["bullets"]) == 2

    def test_a_hard_wrapped_bullet_is_rejoined_into_one(self):
        """The PDF wraps a long bullet across two lines with no marker on
        either. Both fragments must become a single bullet, not two."""
        roles = extract_experiences(MARKERLESS_RESUME)
        assert roles[0]["bullets"][0].startswith("Collaborated in an Agile/Scrum")
        assert "milestones." in roles[0]["bullets"][0]
        assert len(roles[0]["bullets"]) == 2, "a wrapped line became its own bullet"

    def test_marked_bullets_are_still_never_merged(self):
        """The guard against the regression this fix nearly introduced: a
        bullet that DOES carry an explicit marker, and has no full stop, must
        stay its own bullet rather than being fused with its neighbour."""
        roles = extract_experiences(RESUME)  # the marker-based fixture above
        assert len(roles[0]["bullets"]) == 2
        assert roles[0]["bullets"][0] != roles[0]["bullets"][0] + roles[0]["bullets"][1]

    def test_a_five_word_name_is_still_read_as_a_name(self):
        """The old range was two to four words. A candidate with five given
        and family names produced no name at all."""
        assert extract_contact(MARKERLESS_RESUME)["name"] == "Shiva Venkata Raj Chowdary Valluri"

    def test_a_role_title_is_never_mistaken_for_a_name(self):
        """The widened word-count range must not start matching job titles
        that happen to fit in six words."""
        text = "Senior Backend Software Engineer Manager Lead\njane@x.com\n"
        assert extract_contact(text)["name"] is None


WRAPPED_MARKED_BULLET_RESUME = """Venkata Sai Harshith Danda
Tempe, AZ | dandaharshith64@gmail.com

EXPERIENCE
HGS (Hinduja Global Solutions)
Jan 2022 - Dec 2023
Software Engineer
• Engineered and maintained backend RESTful microservices in Java and Spring Boot to automate customer case assignment, user
tracking, and service-level agreement (SLA) workflows.
• Developed interactive, reusable UI components using React.js, integrating backend services to streamline call-center agent workflows
and reduce case resolution time.

EDUCATION
Arizona State University
2026
"""


class TestMarkedBulletWrappedOntoAnUnmarkedLine:
    """The actual bug, found by running a real user's real resume and a real
    job description through the built pipeline end to end (predict_score,
    optimizer.plan, and a real fit.py/tectonic compile) rather than by
    reading the source: every bullet in that resume DOES carry a real "•",
    but each one word-wraps in the source PDF, and the continuation line
    carries no marker of its own.

    The old code treated any marked line as "unambiguous on its own" and
    pushed it straight to the output, bypassing the punctuation-based merge
    entirely — so the wrapped continuation became its own bullet, starting
    mid-sentence in lower case: "tracking, and service-level agreement (SLA)
    workflows." printed on the compiled PDF as if it were a second,
    standalone achievement.
    """

    def test_a_marked_bullet_absorbs_its_unmarked_continuation(self):
        roles = extract_experiences(WRAPPED_MARKED_BULLET_RESUME)
        bullets = roles[0]["bullets"]

        assert len(bullets) == 2, f"a wrapped continuation became its own bullet: {bullets!r}"
        assert bullets[0] == (
            "Engineered and maintained backend RESTful microservices in Java and "
            "Spring Boot to automate customer case assignment, user tracking, and "
            "service-level agreement (SLA) workflows."
        )
        assert not any(b.lower().startswith("tracking,") for b in bullets)
        assert not any(b.lower().startswith("and reduce") for b in bullets)


class TestEducationWithTheDateOnItsOwnLine:
    """A school block ending in a standalone date line, repeated per degree —
    common, and the layout _split_entries (built for experience) could not
    handle: the second entry's date closed the first one instead."""

    def test_two_degrees_are_not_merged_into_one(self):
        edu = extract_education(MARKERLESS_RESUME)
        assert len(edu) == 2, "the second school's name leaked into the first entry"

    def test_the_pipe_joined_header_is_split_by_content(self):
        """"School | Degree | GPA" on one line has no positional label for
        which segment is which — the institution is identified by a word
        like "University", not by being first or second."""
        edu = extract_education(MARKERLESS_RESUME)
        assert edu[0]["institution"] == "Arizona State University, Tempe, AZ, USA"
        assert edu[0]["degree"] == "Master of Science, Information Technology, GPA: 4.0/4.0"
        assert edu[1]["institution"] == "Koneru Lakshmaiah University, Vijayawada, AP, India"

    def test_a_gpa_past_the_field_length_cap_is_not_cut_off(self):
        """A combined "school | degree | GPA" line ran to 133 characters and
        the default 120-char field cap truncated it before the pipe-split
        ever ran, leaving the degree as "...GPA: 9." with the actual number
        gone."""
        edu = extract_education(MARKERLESS_RESUME)
        assert edu[1]["degree"].endswith("GPA: 9.0/10.0")

    def test_dates_are_captured_per_degree(self):
        edu = extract_education(MARKERLESS_RESUME)
        assert edu[0]["dates"] == "2024 - 2026"
        assert edu[1]["dates"] == "2020 - 2024"
