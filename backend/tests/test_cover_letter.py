"""A cover letter is free prose, so most of these test what it refuses to say."""

from app.modules.cover_letter.services import build_filename, unsupported_figures
from app.modules.cover_letter.tex import contact_line, render_cover_letter_tex

RESUME = "Cut p99 latency 38% and saved $220K/yr across 40 services at Stripe since 2019"


def test_filename_matches_the_resume_convention():
    assert (
        build_filename("Venkata Sai Harshith Danda", "Senior Software Engineer", "Asseta")
        == "DANDA_VENKATA_COVER_LETTER_SENIOR_SOFTWARE_ENGINEER_ASSETA.pdf"
    )


def test_filename_uses_a_named_placeholder_rather_than_a_hole():
    """A letter signed "JOHN DOE" is worse than one that names the gap."""
    name = build_filename("", "DevOps Engineer", "Amazon Web Services")
    assert name == "LASTNAME_FIRSTNAME_COVER_LETTER_DEVOPS_ENGINEER_AMAZON_WEB_SERVICES.pdf"


def test_flags_a_figure_the_resume_does_not_contain():
    """The exact failure this guard exists for: a model rounding 38% up to 40%
    and inventing an uptime number, both of which the candidate would have to
    defend in an interview."""
    letter = "I cut latency by 40% and saved $220K annually, improving uptime to 99.9%"
    flagged = unsupported_figures(letter, RESUME)
    assert "40%" in flagged
    assert "99.9%" in flagged


def test_supported_figures_are_not_flagged():
    letter = "I cut p99 latency 38% and saved $220K/yr across 40 services."
    assert unsupported_figures(letter, RESUME) == []


def test_no_figures_means_nothing_to_flag():
    assert unsupported_figures("I would bring care and rigour to this team.", RESUME) == []


def test_tex_escapes_a_company_name_that_would_break_the_compile():
    source = render_cover_letter_tex(
        "Jane Doe", contact_line("jane@x.com"), "AT&T", "Engineer", ["Body text with 50% growth."]
    )
    # A bare & or % ends the compile with a LaTeX error the user cannot act on.
    assert r"AT\&T" in source
    assert r"50\%" in source


def test_tex_is_raw_so_begin_survives():
    """Without raw strings Python reads \begin as a backspace, and tectonic
    receives a control character followed by "egin{center}"."""
    source = render_cover_letter_tex("Jane Doe", contact_line("jane@x.com"), "Acme", "Engineer", ["Hi."])
    assert r"\begin{center}" in source
    assert r"\end{document}" in source
    assert chr(8) not in source


def test_salutation_is_not_a_guessed_name():
    source = render_cover_letter_tex("Jane Doe", contact_line("jane@x.com"), "Acme", "Engineer", ["Hi."])
    assert "Dear Hiring Team," in source


def test_contact_line_omits_what_is_missing():
    assert contact_line("jane@x.com") == "jane@x.com"
    assert r"$\cdot$" in contact_line("jane@x.com", "555-0100")
