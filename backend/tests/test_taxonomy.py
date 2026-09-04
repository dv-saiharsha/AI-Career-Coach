"""Skill taxonomy: alias resolution, implied parents, domain grouping."""

from app.core.taxonomy import (
    IMPLIED_CREDIT,
    canonical,
    detect_phrases,
    domain_of,
    expand_skills,
    group_by_domain,
    implied_skills,
    skill_candidates_from_posting,
)


class TestCanonical:
    def test_resolves_declared_alias(self):
        assert canonical("Amazon Web Services") == "aws"

    def test_punctuation_variants_collapse_to_one_node(self):
        """Node.js / NodeJS / node js are the same skill spelled three ways —
        the point of canonicalisation is that they stop being three."""
        assert canonical("Node.js") == canonical("NodeJS") == canonical("node js") == "node"

    def test_case_insensitive(self):
        assert canonical("PYTORCH") == canonical("PyTorch") == "pytorch"

    def test_slash_forms(self):
        assert canonical("CI/CD") == "cicd"

    def test_unknown_term_passes_through_normalised(self):
        assert canonical("  Rust  ") == "rust"

    def test_empty_is_safe(self):
        assert canonical("") == ""
        assert canonical(None) == ""

    def test_power_systems_synonyms(self):
        assert canonical("load flow") == canonical("power flow") == "power flow analysis"


class TestImpliedSkills:
    def test_pytorch_implies_deep_learning(self):
        assert "deep learning" in implied_skills("PyTorch")

    def test_implication_is_transitive(self):
        """pytorch -> deep learning -> machine learning, with only the two
        direct edges declared."""
        implied = implied_skills("PyTorch")
        assert "machine learning" in implied

    def test_distant_ancestors_score_lower(self):
        implied = implied_skills("PyTorch")
        assert implied["machine learning"] < implied["deep learning"]

    def test_direct_parent_uses_base_credit(self):
        assert implied_skills("PyTorch")["deep learning"] == IMPLIED_CREDIT

    def test_does_not_include_itself(self):
        assert "pytorch" not in implied_skills("PyTorch")

    def test_unknown_skill_implies_nothing(self):
        assert implied_skills("Underwater Basket Weaving") == {}

    def test_cycles_do_not_recurse_forever(self, monkeypatch):
        from app.core import taxonomy

        monkeypatch.setitem(taxonomy.IMPLIED_PARENTS, "alpha", ["beta"])
        monkeypatch.setitem(taxonomy.IMPLIED_PARENTS, "beta", ["alpha"])
        result = implied_skills("alpha")  # must terminate
        assert "beta" in result


class TestExpandSkills:
    def test_explicit_skills_score_full_credit(self):
        assert expand_skills(["PyTorch"])["pytorch"] == 1.0

    def test_implied_skills_score_less_than_explicit(self):
        expanded = expand_skills(["PyTorch"])
        assert expanded["deep learning"] < expanded["pytorch"]

    def test_explicit_beats_implied_for_same_skill(self):
        """Listing both PyTorch and Deep Learning must credit deep learning at
        1.0 — the implication shouldn't downgrade a stated skill."""
        expanded = expand_skills(["PyTorch", "Deep Learning"])
        assert expanded["deep learning"] == 1.0

    def test_aliases_merge(self):
        expanded = expand_skills(["Node.js", "NodeJS"])
        assert expanded["node"] == 1.0

    def test_empty_input(self):
        assert expand_skills([]) == {}


class TestDetectPhrases:
    """Multi-word skills are invisible to the single-token extractor in
    app/core/keywords.py, so without phrase detection the headline case —
    PyTorch implying deep learning — never fires at all."""

    def test_finds_multiword_skill(self):
        assert "deep learning" in detect_phrases("We need Deep Learning experience.")

    def test_case_insensitive(self):
        assert "deep learning" in detect_phrases("DEEP LEARNING required")

    def test_prefers_longest_match(self):
        """'power flow analysis' contains 'power flow' — matching the shorter
        one first would lose the more specific node."""
        assert "power flow analysis" in detect_phrases("Experience with power flow analysis.")

    def test_resolves_alias_phrases(self):
        assert "power flow analysis" in detect_phrases("Familiar with load flow studies")

    def test_deduplicates(self):
        assert detect_phrases("deep learning and deep learning").count("deep learning") == 1

    def test_no_false_positive_on_unrelated_text(self):
        assert detect_phrases("We value teamwork and communication.") == []

    def test_empty_input(self):
        assert detect_phrases("") == []
        assert detect_phrases(None) == []


class TestAnalyzerIntegration:
    def test_pytorch_resume_matches_deep_learning_jd(self):
        """The stated verification: a resume listing PyTorch must be credited
        for a JD requiring Deep Learning."""
        from app.modules.resume_analyzer.services import _rule_based_analysis

        result = _rule_based_analysis(
            "Skills\nPyTorch, CUDA", "Seeking Deep Learning experience."
        )
        implied = [k["keyword"] for k in result["keyword_analysis"] if k.get("implied")]
        assert "deep learning" in implied

    def test_phrase_fragments_are_not_reported_separately(self):
        """'Deep' and 'Learning' must not appear as their own missing
        keywords — telling the user to add a skill just credited to them."""
        from app.modules.resume_analyzer.services import _rule_based_analysis

        result = _rule_based_analysis("Skills\nPyTorch", "Deep Learning required.")
        keywords = {k["keyword"].lower() for k in result["keyword_analysis"]}
        assert "deep" not in keywords and "learning" not in keywords

    def test_model_features_stay_literal(self):
        """The trained model was fit on app/ml/features.py's literal matching.
        Taxonomy must not leak into it, or every input drifts from training."""
        from app.core.keywords import keyword_candidates
        from app.ml.features import extract_features

        resume, jd = "Skills\nPyTorch", "Deep Learning required."
        features = extract_features(resume, jd)
        literal = [k for k in keyword_candidates(jd) if k.lower() in resume.lower()]
        assert features["keyword_matched_count"] == len(literal)


class TestDomains:
    def test_known_skill_has_domain(self):
        assert domain_of("PyTorch") == "AI/ML Engineering"

    def test_alias_resolves_to_domain(self):
        assert domain_of("Amazon Web Services") == "Cloud Infrastructure"

    def test_power_systems_domain(self):
        assert domain_of("PSCAD") == "Power Systems"

    def test_unknown_skill_has_no_domain(self):
        assert domain_of("Underwater Basket Weaving") is None

    def test_grouping_buckets_by_domain(self):
        grouped = group_by_domain(["PyTorch", "AWS", "Docker"])
        assert "PyTorch" in grouped["AI/ML Engineering"]
        assert set(grouped["Cloud Infrastructure"]) == {"AWS", "Docker"}

    def test_unmapped_skills_land_in_other_not_dropped(self):
        grouped = group_by_domain(["PyTorch", "Underwater Basket Weaving"])
        assert grouped["Other"] == ["Underwater Basket Weaving"]


MARKETING_PREAMBLE_POSTING = """About Us

At Cloudflare, we are on a mission to help build a better Internet. Cloudflare
was named to Entrepreneur Magazine's Top Company Cultures list and ranked
among the World's Most Innovative Companies by Fast Company.

We are looking for a thoughtful Trust and Safety Investigator.

Requirements:

Demonstrate working knowledge of DNS and how the Internet works.

You have worked with lawyers and Legal teams on document production requests.
"""


class TestSkillCandidatesFromPosting:
    """Found running a real Cloudflare posting through skill_candidates: its
    "About Us" preamble is full of capitalized mid-sentence words a real
    skill name looks exactly like ("Fortune", "Magazine", "World's Most
    Innovative Companies"), and the proper-noun heuristic in keyword_
    candidates can't tell them apart by shape. skill_candidates_from_posting
    drops everything before the posting's own "Requirements"/
    "Responsibilities" heading first, since that is unambiguously the
    substantive part.
    """

    def test_marketing_boilerplate_is_excluded(self):
        candidates = skill_candidates_from_posting(MARKETING_PREAMBLE_POSTING)
        lowered = {c.lower() for c in candidates}
        for junk in ("fortune", "magazine", "cultures", "world", "most", "innovative", "companies"):
            assert junk not in lowered, f"{junk!r} is marketing noise, not a requirement"

    def test_real_requirements_still_come_through(self):
        candidates = skill_candidates_from_posting(MARKETING_PREAMBLE_POSTING)
        assert "DNS" in candidates
        assert "Legal" in candidates

    def test_a_posting_with_no_requirements_heading_is_unaffected(self):
        """No heading to anchor on — falls back to reading everything, same
        as plain skill_candidates, rather than guessing where to cut."""
        from app.core.taxonomy import skill_candidates

        jd = "Senior Backend Engineer. We need Python, Kubernetes, and AWS experience."
        assert skill_candidates_from_posting(jd) == skill_candidates(jd)
