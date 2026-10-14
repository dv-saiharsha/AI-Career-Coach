"""The deterministic half of the JD analyzer: cleaning, and the judgements made in
code (seniority, years, optional-or-required, either/or groups, keyword weights).

No model is involved anywhere in this file.
"""

import pytest

from app.modules.jd_analyzer import cleaning, rules
from app.modules.jd_analyzer.schemas import JDAnalysis, Skill

# --- cleaning ---------------------------------------------------------------

HTML_JD = """<h2>Platform Engineer</h2>
<p>We build tools for developers &amp; operators.&nbsp;You will own the pipeline.</p>
<h3>Requirements</h3>
<ul>
<li>Strong Kubernetes experience</li>
<li>Experience with Terraform</li>
</ul>
<h3>Benefits</h3>
<ul>
<li>401(k) with company match</li>
<li>Unlimited PTO</li>
</ul>
<h3>Nice to have</h3>
<ul><li>Experience with Go</li></ul>
<p>Acme is an equal opportunity employer. We do not discriminate on the basis of race or religion.
If you need a reasonable accommodation, email us.</p>
"""


class TestCleaning:
    def test_strips_tags_and_decodes_entities(self):
        out = cleaning.clean_jd(HTML_JD)
        assert "<" not in out and "&amp;" not in out and "&nbsp;" not in out
        assert "developers & operators" in out

    def test_removes_a_benefits_block_up_to_the_next_heading(self):
        out = cleaning.clean_jd(HTML_JD)
        assert "401(k)" not in out and "PTO" not in out and "Benefits" not in out
        # What follows the block is kept.
        assert "Nice to have" in out and "Experience with Go" in out

    def test_removes_a_multi_sentence_eeo_statement(self):
        out = cleaning.clean_jd(HTML_JD)
        for phrase in ("equal opportunity", "discriminate", "accommodation"):
            assert phrase not in out.lower()

    def test_keeps_the_requirements(self):
        out = cleaning.clean_jd(HTML_JD)
        assert "Strong Kubernetes experience" in out and "Experience with Terraform" in out

    def test_a_benefits_line_on_one_line_is_dropped(self):
        out = cleaning.clean_jd("Backend Engineer\nPython required.\nBenefits: dental, vision, 401k\nApply today")
        assert "dental" not in out and "Python required." in out and "Apply today" in out

    def test_a_benefits_block_ends_at_a_line_of_real_prose(self):
        prose = "This role reports to the VP of Engineering and works closely with product and design teams every day. " * 2
        out = cleaning.clean_jd(f"Benefits\nFree lunch\nGym stipend\n{prose}")
        assert "Free lunch" not in out and "reports to the VP" in out

    def test_eeo_in_the_middle_of_a_plain_paragraph_cuts_from_that_sentence(self):
        out = cleaning.clean_jd("Python required. Acme is an equal opportunity employer. We hire everyone.")
        assert out == "Python required."

    def test_plain_text_without_markup_or_boilerplate_is_unchanged(self):
        text = "Junior Data Scientist — fintech. 1-2 years experience with Python, pandas. Nice to have: Looker."
        assert cleaning.clean_jd(text) == text

    def test_is_deterministic(self):
        assert cleaning.clean_jd(HTML_JD) == cleaning.clean_jd(HTML_JD)

    def test_empty_and_none(self):
        assert cleaning.clean_jd(None) == "" and cleaning.clean_jd("") == ""

    def test_does_not_truncate_a_long_posting(self):
        long = "Python experience required. " * 1500  # ~42k characters
        assert len(cleaning.clean_jd(long)) > 40000


class TestSplitSections:
    def test_text_within_the_limit_is_one_chunk(self):
        assert cleaning.split_sections("short text", 100) == ["short text"]

    def test_splits_between_lines_and_never_exceeds_the_limit(self):
        text = "\n".join(f"Line number {i} describing a requirement." for i in range(40))
        chunks = cleaning.split_sections(text, 200)
        assert len(chunks) > 1
        assert all(len(c) <= 200 for c in chunks)
        assert "\n".join(chunks).replace("\n", " ").split() == text.replace("\n", " ").split()

    def test_a_long_single_line_splits_between_sentences(self):
        text = " ".join(f"Sentence {i} is here." for i in range(50))
        chunks = cleaning.split_sections(text, 120)
        assert all(len(c) <= 120 for c in chunks)
        assert all(c.rstrip().endswith(".") for c in chunks)

    def test_a_sentence_longer_than_the_limit_is_cut_at_a_space(self):
        chunks = cleaning.split_sections("word " * 100, 60)
        assert all(len(c) <= 60 for c in chunks) and all(not c.endswith("wor") for c in chunks)


# --- seniority ---------------------------------------------------------------


class TestSeniority:
    @pytest.mark.parametrize(
        "raw,level",
        [
            ("entry level", "junior"), ("Entry-Level", "junior"), ("new grad", "junior"),
            ("Graduate", "junior"), ("JUNIOR", "junior"), ("staff", "lead"), ("Principal", "lead"),
            ("senior", "senior"), ("Sr.", "senior"), ("mid-level", "mid"), ("Intermediate", "mid"),
            ("manager", "manager"), ("intern", "intern"), ("wizard", "unknown"), ("", "unknown"), (None, "unknown"),
        ],
    )
    def test_normalize_level(self, raw, level):
        assert rules.normalize_level(raw) == level

    @pytest.mark.parametrize(
        "title,level",
        [
            ("Junior Software Engineer", "junior"), ("Senior Backend Engineer", "senior"),
            ("Staff Engineer", "lead"), ("Principal Scientist", "lead"), ("Engineering Manager", "manager"),
            ("Senior Engineering Manager", "manager"), ("Data Scientist", "unknown"),
            ("Software Engineering Intern", "intern"), ("New Grad Software Engineer", "junior"),
        ],
    )
    def test_level_stated_in_the_title(self, title, level):
        assert rules.stated_level(title, "") == level

    def test_a_level_word_inside_another_word_is_not_a_level(self):
        assert rules.stated_level("Seniority Analyst", "") == "unknown"  # "senior" inside "seniority"

    def test_unambiguous_phrases_in_the_text_state_a_level(self):
        assert rules.stated_level("Software Engineer", "This is an entry-level position.") == "junior"
        assert rules.stated_level("Software Engineer", "New grad friendly.") == "junior"

    def test_senior_engineers_in_the_body_do_not_make_the_job_senior(self):
        text = "Backend Engineer. You'll work alongside two senior engineers."
        assert rules.stated_level("Backend Engineer", text) == "unknown"

    @pytest.mark.parametrize("years,level", [(0, "junior"), (2, "junior"), (3, "mid"), (5, "mid"), (6, "senior"), (12, "senior"), (None, "unknown")])
    def test_years_map_to_a_level(self, years, level):
        assert rules.years_to_level(years) == level

    def test_stated_beats_years_and_says_so(self):
        assert rules.resolve_seniority("Senior Data Scientist", "6+ years", 1) == ("senior", "stated")

    def test_years_fill_in_only_when_no_level_word_is_stated(self):
        assert rules.resolve_seniority("AI Engineer", "3-4 years", 3) == ("mid", "years")

    def test_neither_is_unknown_never_a_guess(self):
        assert rules.resolve_seniority("Engineer", "Join our team.", None) == ("unknown", "unknown")

    def test_a_model_level_is_trusted_only_if_the_text_contains_a_word_for_it(self):
        assert rules.resolve_seniority("Engineer", "We need a principal-level thinker.", None, "lead") == ("lead", "stated")
        assert rules.resolve_seniority("Engineer", "Join our team.", None, "senior") == ("unknown", "unknown")

    def test_a_wrong_model_level_loses_to_the_title(self):
        assert rules.resolve_seniority("Junior Engineer", "", None, "senior") == ("junior", "stated")


# --- years -----------------------------------------------------------------


class TestYears:
    @pytest.mark.parametrize(
        "text,first",
        [
            ("0-2 years of experience", 0), ("3-4 years of experience, with at least 1 year of X", 3),
            ("6+ years building systems", 6), ("8+ years including 3+ years managing", 8),
            ("5+ years of engineering, including 2+ years of LLM work", 5), ("1 year of experience", 1),
            ("3 to 5 years", 3), ("No experience figure stated.", None),
        ],
    )
    def test_first_years_is_the_overall_figure(self, text, first):
        assert rules.first_years(text) == first

    def test_years_mentioned_lists_every_figure_once(self):
        assert rules.years_mentioned("3-5 years, plus 1 year of Go and 2+ years of SQL") == [3, 5, 1, 2]

    def test_a_models_figure_is_kept_only_if_the_text_states_it(self):
        assert rules.resolve_years(5, "3-5 years") == 5  # a stated figure, even if not the first
        assert rules.resolve_years(9, "3-5 years") == 3  # never a number the text does not contain
        assert rules.resolve_years(None, "6+ years") == 6
        assert rules.resolve_years(4, "No figures.") is None


# --- title ------------------------------------------------------------------


class TestTitle:
    def test_cut_at_a_dash(self):
        assert rules.title_from_text("Junior Data Scientist — early-stage fintech startup. You'll help.") == "Junior Data Scientist"

    def test_first_line_of_a_multiline_posting(self):
        assert rules.title_from_text("Engineering Manager, Platform\n\nWe build tools.") == "Engineering Manager, Platform"

    def test_a_long_first_sentence_becomes_a_short_head(self):
        text = "We are looking for a talented engineer to join our growing team and help us ship great software every week."
        assert len(rules.title_from_text(text).split()) <= 8

    def test_title_forms_cover_the_level_free_form_and_company_suffix(self):
        forms = rules.title_forms("Senior Backend Engineer")
        assert "senior backend engineer" in forms and "backend engineer" in forms
        assert "data scientist" in rules.title_forms("Junior Data Scientist — fintech")


# --- optional or required ---------------------------------------------------

TEXT = (
    "Requirements\n"
    "Experience with Python.\n"
    "Familiarity with HIPAA is a plus.\n"
    "Bachelor's degree in CS or equivalent practical experience.\n"
    "Must hold the PMP certification.\n"
    "Security certifications (Security+, or coursework) are a plus but not required.\n"
    "Nice to have\n"
    "Experience with Go\n"
)


class TestOptional:
    def test_a_plus_sentence_is_optional(self):
        assert rules.is_optional(TEXT, "Familiarity with HIPAA") is True

    def test_a_plain_requirement_is_not(self):
        assert rules.is_optional(TEXT, "Experience with Python") is False

    def test_or_equivalent_is_optional(self):
        assert rules.is_optional(TEXT, "Bachelor's degree in CS") is True

    def test_a_must_sentence_is_not_optional(self):
        assert rules.is_optional(TEXT, "Must hold the PMP certification") is False

    def test_not_required_is_optional_even_though_it_says_required(self):
        assert rules.is_optional(TEXT, "Security certifications (Security+, or coursework)") is True

    def test_a_nice_to_have_section_makes_its_lines_optional(self):
        assert rules.is_optional(TEXT, "Experience with Go") is True

    def test_requirement_flag_follows_the_wording_over_the_model(self):
        assert rules.requirement_flag(TEXT, "Must hold the PMP certification", False) is True
        assert rules.requirement_flag(TEXT, "Familiarity with HIPAA is a plus", True) is False

    def test_requirement_flag_falls_back_to_the_model_when_the_text_says_neither(self):
        assert rules.requirement_flag("Valid CISSP held.", "Valid CISSP held", True) is True
        assert rules.requirement_flag("Valid CISSP held.", "Valid CISSP held", False) is False


# --- either/or groups -------------------------------------------------------

NAMES = ["go", "java", "python", "postgresql", "mysql", "kubernetes", "terraform", "fastapi", "xgboost", "lightgbm", "aws", "gcp", "azure"]


class TestAlternatives:
    @pytest.mark.parametrize(
        "evidence,expected",
        [
            ("Go, Java, or Python", [{"go", "java", "python"}]),
            ("PostgreSQL or MySQL", [{"postgresql", "mysql"}]),
            ("either XGBoost or LightGBM", [{"xgboost", "lightgbm"}]),
            ("AWS, GCP, or Azure", [{"aws", "gcp", "azure"}]),
            ("Kubernetes and Terraform in production or staging", []),
            ("FastAPI or a similar framework", []),
            ("Python and Go", []),
            ("REST and/or GraphQL", []),
        ],
    )
    def test_find_alternative_sets(self, evidence, expected):
        assert rules.find_alternative_sets(evidence, NAMES) == expected

    def test_assigns_one_group_to_every_member_even_if_the_model_did_not(self):
        skills = [Skill(name=n, evidence="Go, Java, or Python") for n in ("go", "java", "python")] + [
            Skill(name="postgresql", evidence="PostgreSQL")
        ]
        out = rules.assign_alternative_groups(skills)
        groups = {s.name: s.alternative_group for s in out}
        assert groups["go"] == groups["java"] == groups["python"] and groups["go"].startswith("any-of:")
        assert groups["postgresql"] is None

    def test_the_models_label_is_kept_for_a_real_group(self):
        skills = [
            Skill(name="go", evidence="Go, Java, or Python", alternative_group="Language"),
            Skill(name="java", evidence="Go, Java, or Python"),
            Skill(name="python", evidence="Go, Java, or Python"),
        ]
        assert {s.alternative_group for s in rules.assign_alternative_groups(skills)} == {"language"}

    def test_a_model_label_on_a_lone_skill_is_cleared(self):
        out = rules.assign_alternative_groups([Skill(name="python", evidence="Python", alternative_group="language")])
        assert out[0].alternative_group is None

    def test_two_groups_stay_separate(self):
        skills = [Skill(name=n, evidence="Go or Java") for n in ("go", "java")] + [
            Skill(name=n, evidence="PostgreSQL or MySQL") for n in ("postgresql", "mysql")
        ]
        out = rules.assign_alternative_groups(skills)
        labels = {s.name: s.alternative_group for s in out}
        assert labels["go"] == labels["java"] != labels["postgresql"] == labels["mysql"]


# --- keywords ---------------------------------------------------------------


class TestKeywords:
    def test_weights_follow_the_rule(self):
        analysis = JDAnalysis(
            job_title="Senior Backend Engineer",
            required_skills=[Skill(name="python", evidence="Python")],
            preferred_skills=[Skill(name="go", evidence="Go")],
            tools_technologies=["python", "docker"],
            certifications=[],
        )
        weights = {k.term: k.weight for k in rules.build_keywords(analysis)}
        assert weights["python"] == 1.0  # required beats the tool mention
        assert weights["backend engineer"] == 0.8  # the title, without its level word
        assert weights["go"] == 0.5
        assert weights["docker"] == 0.4

    def test_certification_weight_follows_required(self):
        from app.modules.jd_analyzer.schemas import Requirement

        analysis = JDAnalysis(
            certifications=[
                Requirement(name="PMP", required=True, evidence="PMP"),
                Requirement(name="CKA", required=False, evidence="CKA"),
            ]
        )
        weights = {k.term: k.weight for k in rules.build_keywords(analysis)}
        assert weights["pmp"] == 1.0 and weights["cka"] == 0.5


# --- the rules-only analysis ------------------------------------------------


class TestRulesAnalysis:
    JD = (
        "Junior Data Scientist — fintech startup. 1-2 years experience with Python, pandas, scikit-learn. "
        "Comfortable writing SQL queries. Nice to have: experience with Docker. "
        "You'll work closely with product and engineering to turn ad-hoc analysis into pipelines. "
        "Bachelor's degree in Statistics or equivalent experience. Security+ is a plus."
    )

    def test_reads_what_the_text_states(self):
        a = rules.rules_analysis(self.JD)
        assert a.source == "rules"
        assert a.job_title == "Junior Data Scientist"
        assert (a.seniority, a.seniority_source) == ("junior", "stated")
        assert a.min_years_experience == 1

    def test_finds_technology_terms_and_never_the_title(self):
        a = rules.rules_analysis(self.JD)
        names = {s.name for s in a.required_skills + a.preferred_skills}
        assert {"python", "sql"} <= names
        assert "data scientist" not in names and "junior" not in names

    def test_optional_wording_puts_a_term_in_preferred(self):
        a = rules.rules_analysis(self.JD)
        assert "docker" in {s.name for s in a.preferred_skills}
        assert "docker" not in {s.name for s in a.required_skills}
        assert "python" not in {s.name for s in a.preferred_skills}

    def test_degree_or_equivalent_is_not_required_and_the_cert_is_a_plus(self):
        a = rules.rules_analysis(self.JD)
        assert [(e.name, e.required) for e in a.education] == [("Bachelor's degree in Statistics", False)]
        assert [(c.name, c.required) for c in a.certifications] == [("Security+", False)]

    def test_you_will_sentences_become_responsibilities(self):
        assert any("work closely with product" in r for r in rules.rules_analysis(self.JD).responsibilities)

    def test_every_evidence_quote_is_in_the_text(self):
        from app.modules.job_market.enrichment import quote_in_text

        a = rules.rules_analysis(self.JD)
        for item in a.required_skills + a.preferred_skills + a.education + a.certifications:
            assert quote_in_text(item.evidence, self.JD), item

    def test_slash_joined_words_are_not_skills(self):
        a = rules.rules_analysis("Data Analyst. Needs A/B testing, and/or online/offline metrics, matplotlib/seaborn.")
        names = {s.name for s in a.required_skills + a.preferred_skills}
        assert not names & {"a b", "and or", "online offline", "matplotlib seaborn"}

    def test_empty_text_is_an_empty_analysis_not_an_error(self):
        a = rules.rules_analysis("")
        assert a.job_title == "" and a.required_skills == [] and a.seniority == "unknown"
