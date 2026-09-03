"""Per-vendor ATS compatibility.

The point of these tests is the distinction the module exists to protect: a
measured fact about the file, and a documented property of a parser, must not
be allowed to blur into a fabricated score. So they check that a vendor with
nothing measurable reports "not checked" rather than a clean bill, and that
the number shown is arithmetic over named checks rather than a black box.
"""

from app.modules.resume_analyzer import ats_vendors

CLEAN_READINESS = {
    "is_single_column": True,
    "detected_headers": ["Experience", "Education", "Skills"],
    "warnings": [],
    "extracted_characters": 2400,
}
CLEAN_GLYPHS = {"ok": True}
CLEAN_CONTACT = {"ok": True}


def test_a_clean_resume_parses_everywhere():
    result = ats_vendors.evaluate(CLEAN_READINESS, CLEAN_GLYPHS, CLEAN_CONTACT)
    assert all(v["verdict"] == "will parse cleanly" for v in result["vendors"])
    assert all(v["percent"] == 100 for v in result["vendors"])


def test_two_columns_breaks_the_old_systems_and_not_the_new_ones():
    """The whole reason for reporting per vendor rather than one number.

    A two-column layout is the classic Taleo failure and a non-event in
    Greenhouse. One overall score cannot say that; this can.
    """
    readiness = {**CLEAN_READINESS, "is_single_column": False}
    by_name = {
        v["name"]: v
        for v in ats_vendors.evaluate(readiness, CLEAN_GLYPHS, CLEAN_CONTACT)["vendors"]
    }

    assert by_name["Taleo"]["verdict"] == "will lose content"
    assert by_name["iCIMS"]["verdict"] == "will lose content"
    assert by_name["Greenhouse"]["verdict"] == "will parse cleanly"
    assert by_name["Lever"]["verdict"] == "will parse cleanly"


def test_corrupt_glyphs_break_every_system():
    """The one failure no parser survives, so no vendor should be exempt."""
    result = ats_vendors.evaluate(CLEAN_READINESS, {"ok": False}, CLEAN_CONTACT)
    assert all(v["verdict"] == "will lose content" for v in result["vendors"])


def test_missing_section_headings_hit_the_field_mappers():
    readiness = {**CLEAN_READINESS, "detected_headers": ["Education"]}
    by_name = {
        v["name"]: v
        for v in ats_vendors.evaluate(readiness, CLEAN_GLYPHS, CLEAN_CONTACT)["vendors"]
    }
    # These route content into fields using headings.
    assert by_name["Workday"]["verdict"] == "will lose content"
    assert by_name["SmartRecruiters"]["verdict"] == "will lose content"
    # Lever is not listed as heading-sensitive, so it should be unaffected.
    assert by_name["Lever"]["verdict"] == "will parse cleanly"


def test_an_unexaminable_file_reports_not_checked_rather_than_clean():
    """A DOCX has no page geometry. Silence is not a pass.

    This is the failure mode the module is guarding against: reporting a
    document nobody could inspect as compatible reads as a verified result.
    """
    blank = {
        "is_single_column": None,
        "detected_headers": [],
        "warnings": [],
        "extracted_characters": 0,
    }
    result = ats_vendors.evaluate(blank, {"ok": None}, {"ok": None})

    for vendor in result["vendors"]:
        assert vendor["verdict"] == "not checked"
        assert vendor["percent"] is None, "an unexamined file must not report a percentage"
        assert vendor["not_checked"], "it should say which checks could not run"


def test_the_percentage_is_arithmetic_over_named_checks():
    """Not a model output. passed/applicable must reconcile, and every failure
    must be named, so a user can audit the number rather than trust it."""
    readiness = {**CLEAN_READINESS, "is_single_column": False}
    for vendor in ats_vendors.evaluate(readiness, CLEAN_GLYPHS, CLEAN_CONTACT)["vendors"]:
        if vendor["percent"] is None:
            continue
        assert vendor["passed"] + len(vendor["failures"]) == vendor["applicable"]
        assert vendor["percent"] == round(vendor["passed"] / vendor["applicable"] * 100)
        for failure in vendor["failures"]:
            assert failure["label"], "every failure names the check in plain words"


def test_methodology_states_that_vendors_were_not_tested_directly():
    """The claim this module must never make is that it scored against the
    real parsers. If that sentence goes missing, the numbers start reading as
    something they are not."""
    result = ats_vendors.evaluate(CLEAN_READINESS, CLEAN_GLYPHS, CLEAN_CONTACT)
    assert "proprietary" in result["methodology"]
    assert "not on testing against the system itself" in result["methodology"]
