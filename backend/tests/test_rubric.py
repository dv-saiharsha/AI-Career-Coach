"""The rubric's job is to be inspectable, so these tests pin the arithmetic
and — more importantly — what it refuses to score."""

import pytest

from app.modules.resume_analyzer import rubric
from app.modules.resume_analyzer.parse_checks import build_checks

RESUME = """Venkata Danda
Phoenix, AZ | (480) 555-0142 | venkata@example.com

EXPERIENCE
Senior Software Engineer, Stripe   Jan 2022 - Present
- Cut p99 checkout latency 38% by replacing a synchronous fraud call with a queue
- Led migration of 40 services to Kubernetes, reducing spend $220K/yr

EDUCATION
M.S. Computer Science  2019

TECHNICAL SKILLS
Python, Kubernetes, PostgreSQL, Docker
"""

JD = "We need a Senior Software Engineer with Python, Kubernetes, Terraform and CI/CD experience."


def test_weights_sum_to_one_hundred():
    """The rubric total is presented out of 100, so the weights must be."""
    assert sum(rubric.WEIGHTS.values()) == 100


def test_ratios_are_percentages_not_fractions():
    """evaluate_bullets already returns 0-100. Multiplying by 100 here produced
    a quantified-impact score of 10000 and a rubric total of 1741."""
    assert rubric.quantified_impact(RESUME) == 100.0
    assert 0 <= rubric.readability(RESUME) <= 100


def test_total_is_in_range():
    result = rubric.build_breakdown(RESUME, JD, "Senior Software Engineer")
    assert 0 <= result["rubric_total"] <= 100
    assert result["weight_applied"] == 100
    assert result["skipped"] == []


def test_missing_title_drops_its_weight_rather_than_scoring_zero():
    """A check that could not run is not a failure. Scoring it zero would
    report the resume as worse for a reason unrelated to the resume."""
    result = rubric.build_breakdown(RESUME, JD, None)
    assert result["weight_applied"] == 100 - rubric.WEIGHTS["title_alignment"]
    assert "Title alignment" in result["skipped"]
    scored = rubric.build_breakdown(RESUME, JD, "Senior Software Engineer")
    # Dropping a perfect-scoring metric lowers the average; scoring it zero
    # would lower it far more. This pins the difference.
    assert result["rubric_total"] < scored["rubric_total"]
    assert result["rubric_total"] > 50


def test_metric_with_no_inputs_is_none_not_zero():
    assert rubric.hard_skill_match(RESUME, "") is None
    assert rubric.quantified_impact("no bullets here") is None
    assert rubric.recency("EXPERIENCE\nsome role with no dates") is None


def test_every_metric_is_reported_even_when_skipped():
    """The UI renders a row per metric; a skipped one must still appear, as
    'not checked' rather than vanishing from the list."""
    result = rubric.build_breakdown(RESUME, JD, None)
    assert len(result["metrics"]) == len(rubric.WEIGHTS)
    skipped = [m for m in result["metrics"] if m["score"] is None]
    assert [m["band"] for m in skipped] == ["NOT CHECKED"]


@pytest.mark.parametrize(
    "score,expected",
    [(95, "EXCELLENT"), (75, "STRONG"), (60, "GOOD"), (40, "NEEDS WORK"), (10, "WEAK"), (None, "NOT CHECKED")],
)
def test_bands(score, expected):
    assert rubric.band(score) == expected


def test_empty_resume_does_not_raise():
    result = rubric.build_breakdown("", "", None)
    assert result["weight_applied"] < 100


# ── Parse checks ─────────────────────────────────────────────────────────

def test_parse_checks_cover_the_named_properties():
    checks = build_checks(RESUME)
    assert {c["key"] for c in checks} == {
        "text_layer", "headings", "single_column",
        "no_repeated_edges", "name_found", "contact_found",
        "contact_placement", "glyph_integrity", "reverse_chronological",
    }


def test_every_check_names_what_it_tested_and_why():
    """Each card has to stand on its own: a bare Pass with no statement of
    what was measured is the vendor-verdict problem in a different shape."""
    for check in build_checks(RESUME):
        assert check["detail"].strip()
        assert check["why"].strip()


def test_column_check_is_none_without_a_pdf():
    """Text alone cannot distinguish two columns from wide spacing. Reporting
    a pass here would be a claim with no evidence behind it."""
    column = next(c for c in build_checks(RESUME) if c["key"] == "single_column")
    assert column["passed"] is None
    assert "No PDF" in column["detail"]


def test_checks_read_real_contact_details():
    checks = {c["key"]: c for c in build_checks(RESUME)}
    assert checks["name_found"]["passed"] is True
    assert "Venkata Danda" in checks["name_found"]["detail"]
    assert checks["contact_found"]["passed"] is True
    assert "venkata@example.com" in checks["contact_found"]["detail"]


def test_checks_fail_honestly_on_an_empty_document():
    checks = {c["key"]: c for c in build_checks("")}
    assert checks["text_layer"]["passed"] is False
    assert checks["headings"]["passed"] is False
    assert checks["contact_found"]["passed"] is False
    # Still not claimable either way without the file.
    assert checks["single_column"]["passed"] is None


def test_glyph_check_catches_unmapped_fonts():
    """A font embedded without a unicode map extracts as (cid:72) rather than
    "H". The page looks perfect on screen, so nothing warns the candidate."""
    from app.modules.resume_analyzer.layout_check import check_glyph_integrity

    corrupted = "(cid:72)(cid:101)(cid:108)(cid:108)(cid:111) " * 30
    result = check_glyph_integrity(corrupted)
    assert result["ok"] is False
    assert "cid" in result["reason"]


def test_glyph_check_passes_clean_text():
    from app.modules.resume_analyzer.layout_check import check_glyph_integrity

    assert check_glyph_integrity(RESUME)["ok"] is True


def test_glyph_check_is_none_on_empty_text():
    """Nothing extracted means nothing to assess — distinct from corrupted."""
    from app.modules.resume_analyzer.layout_check import check_glyph_integrity

    assert check_glyph_integrity("")["ok"] is None


def test_contact_placement_needs_the_pdf():
    from app.modules.resume_analyzer.layout_check import check_contact_placement

    result = check_contact_placement(None, ["a@b.com"])
    assert result["ok"] is None
    assert "No PDF" in result["reason"]


def test_reverse_chronological_is_checked_not_assumed():
    checks = {c["key"]: c for c in build_checks(RESUME)}
    # RESUME has a single role, so there is no order to check and reporting a
    # pass would dress up "nothing to check" as a result.
    assert checks["reverse_chronological"]["passed"] is None


def test_reverse_chronological_flags_an_out_of_order_history():
    text = (
        "EXPERIENCE\n"
        "Junior Engineer, Acme   Jan 2015 - Dec 2017\n"
        "- Did an early thing that took a while to finish properly\n"
        "Senior Engineer, Stripe   Jan 2020 - Dec 2023\n"
        "- Did a later thing that took a while to finish properly\n"
    )
    checks = {c["key"]: c for c in build_checks(text)}
    assert checks["reverse_chronological"]["passed"] is False


def test_all_nine_checks_render():
    """The UI renders a card per check; none may silently disappear."""
    assert len(build_checks(RESUME)) == 9
