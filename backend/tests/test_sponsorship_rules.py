"""The free, rule-based sponsorship read that stands in for Claude while
there is no budget to run real enrichment.

Every test in TestConfirmedCorpusBugs pins a defect this module actually
produced when run against the live database of unenriched postings — not a
hypothetical. Two were the dangerous direction (a job that does NOT sponsor,
or has nothing to do with visas at all, reported as
"explicitly_sponsored") and one silently zeroed out the entire positive
path. All three were found by running the classifier against real rows and
reading the evidence strings, not by reasoning about the regex.
"""

from app.modules.job_market.sponsorship_rules import classify_sponsorship


class TestConfirmedCorpusBugs:
    def test_a_qualifier_word_before_sponsorship_is_not_missed(self):
        """"No immigration sponsorship is available" was classified
        EXPLICITLY_SPONSORED — the exact opposite of what it says — because
        the negative pattern required "no" to sit directly against
        "sponsorship" and the word "immigration" in between broke it."""
        label, evidence = classify_sponsorship(
            "No immigration sponsorship is available for this position."
        )
        assert label == "no_sponsorship"
        assert "No immigration sponsorship" in evidence

    def test_sponsoring_a_clearance_process_is_not_visa_sponsorship(self):
        """A real posting: "Elastic will sponsor the process where
        required" — about SECURITY CLEARANCE sponsorship, with zero bearing
        on visas. The bare verb "sponsor" needs a visa-shaped object nearby
        or it fires on anything a company offers to sponsor."""
        text = (
            "Some of these engagements require national security screening or "
            "clearance; eligibility to obtain one in your country of employment "
            "is a strong advantage, and Elastic will sponsor the process where required."
        )
        label, evidence = classify_sponsorship(text)
        assert label == "unmentioned"
        assert evidence == ""

    def test_the_positive_verb_pattern_actually_matches_real_text(self):
        """The fix for the clearance false-positive above introduced a
        second bug: the mandatory word-boundary right after "sponsor" left
        no whitespace token able to cross the real space before "visas", so
        "do sponsor visas" — the single most common positive phrasing in the
        corpus — stopped matching anything at all. The match count on the
        full unenriched table went from hundreds to one and that is what
        caught it, not a read of the pattern."""
        label, evidence = classify_sponsorship("Visa sponsorship: We do sponsor visas!")
        assert label == "explicitly_sponsored"
        assert evidence == "Visa sponsorship: We do sponsor visas!"


class TestExplicitPositives:
    def test_will_sponsor_a_visa(self):
        assert classify_sponsorship("We will sponsor a work visa for this role.")[0] == (
            "explicitly_sponsored"
        )

    def test_sponsorship_is_available(self):
        assert classify_sponsorship("Visa sponsorship is available for this position.")[0] == (
            "explicitly_sponsored"
        )

    def test_h1b_sponsorship_available(self):
        assert classify_sponsorship("H-1B sponsorship is available for the right candidate.")[0] == (
            "explicitly_sponsored"
        )

    def test_open_to_sponsoring(self):
        assert classify_sponsorship("We are open to sponsoring qualified candidates.")[0] == (
            "explicitly_sponsored"
        )


class TestExplicitNegatives:
    def test_does_not_sponsor(self):
        assert classify_sponsorship("This role does not sponsor employment visas.")[0] == (
            "no_sponsorship"
        )

    def test_unable_to_sponsor(self):
        assert classify_sponsorship("We are unable to sponsor work visas at this time.")[0] == (
            "no_sponsorship"
        )

    def test_must_be_authorized_without_sponsorship(self):
        text = "Candidates must be authorized to work in the US without sponsorship."
        assert classify_sponsorship(text)[0] == "no_sponsorship"

    def test_no_sponsorship_available(self):
        assert classify_sponsorship("No visa sponsorship available.")[0] == "no_sponsorship"


class TestConservativeByDesign:
    """The whole point of this module: recall is sacrificed for precision.
    A wrong classification in the positive direction costs someone a wasted
    screening call, so anything short of an explicit statement stays
    unmentioned — the same rubric the LLM prompt states for the real
    enrichment path."""

    def test_a_mere_mention_of_visas_is_not_a_classification(self):
        text = "Candidates on a visa are welcome to apply; details discussed at interview."
        assert classify_sponsorship(text)[0] == "unmentioned"

    def test_work_authorization_alone_is_not_a_negative(self):
        """Requiring work authorization language without addressing
        sponsorship at all must not be read as a refusal to sponsor."""
        text = "Must have current work authorization for the United States."
        assert classify_sponsorship(text)[0] == "unmentioned"

    def test_empty_description(self):
        assert classify_sponsorship("")[0] == "unmentioned"
        assert classify_sponsorship(None)[0] == "unmentioned"

    def test_ordinary_posting_with_no_sponsorship_language(self):
        text = "We are looking for a backend engineer with 5 years of Python experience."
        label, evidence = classify_sponsorship(text)
        assert label == "unmentioned"
        assert evidence == ""

    def test_negative_patterns_are_checked_before_positive_ones(self):
        """"We are not able to sponsor" contains the word "sponsor" and
        would satisfy a loosely-written positive check if negatives were not
        tried first."""
        assert classify_sponsorship("We are not able to sponsor visas for this role.")[0] == (
            "no_sponsorship"
        )
