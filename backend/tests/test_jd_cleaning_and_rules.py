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


class TestClauses:
    SENTENCE = "Solid understanding of REST API design and relational databases (PostgreSQL preferred)."

    def test_a_parenthetical_marker_covers_only_the_parenthetical(self):
        assert rules.is_optional(self.SENTENCE, "PostgreSQL") is True
        assert rules.is_optional(self.SENTENCE, "REST API design") is False
        assert rules.is_optional(self.SENTENCE, "relational databases") is False

    def test_clauses_innermost_first(self):
        assert rules.clauses_around(self.SENTENCE, "PostgreSQL") == [
            "PostgreSQL preferred", "Solid understanding of REST API design and relational databases",
        ]
        assert rules.clauses_around(self.SENTENCE, "REST API design") == [
            "Solid understanding of REST API design and relational databases",
        ]

    def test_an_outer_marker_covers_the_items_in_its_parenthetical(self):
        text = "Familiarity with compliance frameworks (SOC 2, HIPAA) is a plus."
        assert rules.is_optional(text, "HIPAA") is True
        assert rules.is_optional(text, "compliance frameworks") is True
        # The rule-found wording has a bare "plus", so "a strong plus" covers them too.
        text = "Familiarity with compliance frameworks (SOC 2, HIPAA) is a strong plus."
        assert rules.classify_rule_skill(text, "HIPAA") == "preferred"

    def test_a_list_is_one_clause(self):
        assert rules.is_optional("Experience with Python, Go, or Rust is a plus.", "Python") is True

    def test_separate_clauses_are_scoped_separately(self):
        text = "Python is required; Go is a plus."
        assert rules.is_optional(text, "Python") is False
        assert rules.is_optional(text, "Go") is True
        text = "Strong experience with Kafka, but Flink is nice to have."
        assert rules.classify_rule_skill(text, "Kafka") == "required"
        assert rules.classify_rule_skill(text, "Flink") == "preferred"

    def test_a_plus_but_not_required_is_still_optional(self):
        text = "Exposure to Docker is a plus but not required — we'll teach you."
        assert rules.is_optional(text, "Docker") is True


SECTIONED = (
    "About the role\n"
    "You will work with Kafka every day.\n"
    "What you'll need\n"
    "Python and SQL\n"
    "Terraform is a plus\n"
    "Preferred qualifications:\n"
    "Experience with Rust\n"
)


class TestSections:
    def test_section_kinds(self):
        assert rules.section_kind(SECTIONED, "Kafka") is None
        assert rules.section_kind(SECTIONED, "Python and SQL") == "required"
        assert rules.section_kind(SECTIONED, "Experience with Rust") == "optional"
        assert rules.section_kind("Python and SQL", "Python") is None

    def test_a_requirements_section_makes_a_skill_required_over_the_model(self):
        assert rules.skill_bucket(SECTIONED, "Python and SQL", "preferred") == "required"

    def test_its_own_optional_wording_still_wins_inside_a_requirements_section(self):
        assert rules.skill_bucket(SECTIONED, "Terraform", "required") == "preferred"

    def test_an_optional_section_makes_a_skill_preferred(self):
        assert rules.skill_bucket(SECTIONED, "Experience with Rust", "required") == "preferred"

    def test_no_section_keeps_the_default(self):
        assert rules.skill_bucket(SECTIONED, "Kafka", "required") == "required"
        assert rules.skill_bucket(SECTIONED, "Kafka", "preferred") == "preferred"

    def test_a_requirements_section_line_with_an_optional_parenthetical(self):
        text = "Requirements:\nREST API design and relational databases (PostgreSQL preferred)\n"
        assert rules.skill_bucket(text, "relational databases", "required") == "required"
        assert rules.skill_bucket(text, "PostgreSQL", "required") == "preferred"

    def test_rule_found_skills_follow_the_section(self):
        # No requirement wording on the line, but it sits under "What you'll need".
        assert rules.classify_rule_skill(SECTIONED, "SQL") == "required"
        assert rules.classify_rule_skill(SECTIONED, "Rust") == "preferred"


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


class TestGroupsPerList:
    def test_two_lists_the_model_gave_one_label_each_get_their_own_group(self):
        skills = (
            [Skill(name=n, evidence="Go, Java, or Python", alternative_group="language") for n in ("go", "java", "python")]
            + [Skill(name=n, evidence="Kafka, SQS, or RabbitMQ", alternative_group="language") for n in ("kafka", "sqs", "rabbitmq")]
        )
        labels = {s.name: s.alternative_group for s in rules.assign_alternative_groups(skills)}
        assert labels["go"] == labels["java"] == labels["python"]
        assert labels["kafka"] == labels["sqs"] == labels["rabbitmq"]
        assert labels["go"] != labels["kafka"]

    def test_a_label_that_belongs_to_one_list_is_kept(self):
        skills = [Skill(name=n, evidence="Go, Java, or Python", alternative_group="language") for n in ("go", "java", "python")] + [
            Skill(name=n, evidence="Kafka or SQS", alternative_group="queue") for n in ("kafka", "sqs")
        ]
        labels = {s.name: s.alternative_group for s in rules.assign_alternative_groups(skills)}
        assert labels["go"] == "language" and labels["kafka"] == "queue"

    def test_the_list_is_read_from_the_whole_sentence_around_the_quote(self):
        text = "Production experience with a major cloud: AWS, GCP, or Azure."
        skills = [
            Skill(name="aws", evidence="AWS"),  # the model quoted only this much
            Skill(name="gcp", evidence="GCP, or Azure"),
            Skill(name="azure", evidence="GCP, or Azure"),
        ]
        out = rules.assign_alternative_groups(skills, text)
        assert len({s.alternative_group for s in out}) == 1 and out[0].alternative_group is not None

    def test_without_the_text_only_the_quote_is_read(self):
        skills = [Skill(name="aws", evidence="AWS"), Skill(name="gcp", evidence="GCP, or Azure"), Skill(name="azure", evidence="GCP, or Azure")]
        groups = {s.name: s.alternative_group for s in rules.assign_alternative_groups(skills)}
        assert groups["aws"] is None and groups["gcp"] == groups["azure"] is not None

    def test_skills_in_different_sentences_are_not_grouped(self):
        text = "Experience with Python. Knowledge of Go or Java is useful."
        skills = [Skill(name="python", evidence="Python"), Skill(name="go", evidence="Go or Java"), Skill(name="java", evidence="Go or Java")]
        groups = {s.name: s.alternative_group for s in rules.assign_alternative_groups(skills, text)}
        assert groups["python"] is None and groups["go"] == groups["java"] is not None

    def test_lead_in_words_before_the_first_item_do_not_pull_in_a_neighbouring_skill(self):
        names = ["message queues", "kafka", "sqs", "rabbitmq"]
        assert rules.find_alternative_sets("Experience with message queues (Kafka, SQS, or RabbitMQ)", names) == [
            {"kafka", "sqs", "rabbitmq"}
        ]

    def test_two_lists_in_one_sentence_stay_two_sets(self):
        text = "Experience with PostgreSQL or MySQL at scale and with Kafka, SQS, or RabbitMQ."
        sets = rules.find_alternative_sets(text, ["postgresql", "mysql", "kafka", "sqs", "rabbitmq"])
        assert {frozenset(x) for x in sets} == {frozenset({"postgresql", "mysql"}), frozenset({"kafka", "sqs", "rabbitmq"})}

    def test_an_or_binds_only_the_items_after_the_and(self):
        names = ["python", "scikit-learn", "xgboost", "lightgbm"]
        text = "Deep expertise in Python, scikit-learn, and either XGBoost or LightGBM."
        assert rules.find_alternative_sets(text, names) == [{"xgboost", "lightgbm"}]

    def test_the_same_list_in_the_sentence_gives_the_same_group(self):
        text = "Deep expertise in Python, scikit-learn, and either XGBoost or LightGBM."
        skills = [Skill(name="python", evidence="Python"), Skill(name="scikit-learn", evidence="scikit-learn")] + [
            Skill(name=n, evidence="either XGBoost or LightGBM", alternative_group="machine learning library") for n in ("xgboost", "lightgbm")
        ]
        groups = {s.name: s.alternative_group for s in rules.assign_alternative_groups(skills, text)}
        assert groups["python"] is None and groups["scikit-learn"] is None
        assert groups["xgboost"] == groups["lightgbm"] == "machine learning library"

    def test_named_at_end(self):
        from app.core.skill_match import named_at_end

        assert named_at_end("experience with message queues (Kafka", "kafka")
        assert not named_at_end("experience with message queues (Kafka", "message queues")
        assert named_at_end("either XGBoost", "xgboost") and named_at_end("k8s", "kubernetes")
        assert not named_at_end("Go beyond", "go")


class TestValidators:
    @pytest.mark.parametrize("name", ["language", "Frameworks", "tools", "programming language", "data", "fundamentals"])
    def test_generic_names(self, name):
        assert rules.is_generic_name(name)

    @pytest.mark.parametrize("name", ["python", "data structures", "data pipelines", "cs fundamentals", "design patterns"])
    def test_real_skills_are_not_generic(self, name):
        assert not rules.is_generic_name(name)

    @pytest.mark.parametrize(
        "name", ["communication skills", "Teamwork", "problem-solving", "attention to detail", "eagerness to learn", "mentoring"]
    )
    def test_soft_skills(self, name):
        assert rules.is_soft_skill(name)

    def test_technical_skills_are_not_soft(self):
        assert not rules.is_soft_skill("code review") and not rules.is_soft_skill("system design")

    @pytest.mark.parametrize("name", ["Bachelor's degree in Computer Science", "BS in CS", "Master's", "PhD", "High school diploma", "MBA"])
    def test_degree_names(self, name):
        assert rules.education_name_ok(name)

    @pytest.mark.parametrize("name", ["CS fundamentals", "coursework", "Python", "data structures"])
    def test_not_degree_names(self, name):
        assert not rules.education_name_ok(name)

    @pytest.mark.parametrize(
        "name", ["Security+", "AWS Certified Solutions Architect", "Certified Kubernetes Administrator (CKA)", "PMP", "CISSP", "Professional license"]
    )
    def test_certification_names(self, name):
        assert rules.certification_name_ok(name)

    @pytest.mark.parametrize("name", ["coursework", "Python", "Bachelor's degree"])
    def test_not_certification_names(self, name):
        assert not rules.certification_name_ok(name)

    def test_same_requirement_name(self):
        assert rules.same_requirement_name("AWS Certified Solutions Architect", "AWS Certified Solutions Architect certification")
        assert rules.same_requirement_name("Certified Kubernetes Administrator (CKA)", "Certified Kubernetes Administrator")
        assert not rules.same_requirement_name("Security+", "AWS Certified Solutions Architect")

    def test_backfill_adds_only_what_is_missing(self):
        from app.modules.jd_analyzer.schemas import Requirement

        text = "Must hold the PMP certification. Certified Scrum Master is a plus."
        have = [Requirement(name="PMP", required=True, evidence="Must hold the PMP certification")]
        added = rules.backfill_certifications(text, have)
        assert [(c.name, c.required) for c in added] == [("Certified Scrum Master", False)]


class TestTrimAndAlias:
    @pytest.mark.parametrize(
        "name,trimmed",
        [
            ("static analysis tools", "static analysis"), ("rag pipelines", "retrieval augmented generation"),
            ("penetration testing concepts", "penetration testing"), ("basic concepts", "basic concepts"),
            ("ci cd pipelines", "cicd"), ("ml frameworks", "machine learning"), ("etl pipeline", "etl pipeline"),
            ("data pipelines", "data pipelines"), ("build tools", "build tools"), ("tools", "tools"),
            ("python", "python"), ("deployment frameworks", "deployment frameworks"),
            ("hugging face ecosystem", "hugging face"), ("mern stack", "mern stack"), ("tech stack", "tech stack"),
            ("python ecosystems", "python"),
        ],
    )
    def test_trim_generic_suffix(self, name, trimmed):
        assert rules.trim_generic_suffix(name) == trimmed

    def test_the_trim_list(self):
        assert rules.TRAILING_GENERIC == ("ecosystem", "stack", "tools", "frameworks", "concepts", "pipelines")

    def test_rag_is_retrieval_augmented_generation(self):
        from app.core.taxonomy import canonical

        assert canonical("RAG") == canonical("retrieval-augmented generation") == "retrieval augmented generation"


class TestConceptVocabulary:
    def test_the_vocabulary_has_at_least_150_terms_and_no_duplicates(self):
        from app.core.concepts import CONCEPTS

        assert len(CONCEPTS) >= 150 and len(set(CONCEPTS)) == len(CONCEPTS)

    def test_it_holds_no_everyday_single_words(self):
        from app.core.concepts import CONCEPTS

        assert not {"testing", "security", "design", "transactions", "data", "communication"} & set(CONCEPTS)

    def test_matches_any_case_hyphen_or_plural_as_written(self):
        found = rules.concept_matches("Experience with Fine Tuning, unit-testing and Distributed Systems.")
        assert {"Fine Tuning", "unit-testing", "Distributed Systems"} <= set(found)

    def test_a_longer_term_wins_over_the_shorter_one_inside_it(self):
        found = rules.concept_matches("Solid access-control design.")
        assert found == ["access-control design"]

    def test_only_whole_words_match(self):
        assert rules.concept_matches("We use preprocessing-heavy redesigns.") == []


class TestRuleClassification:
    @pytest.mark.parametrize(
        "sentence,bucket",
        [
            ("Must know distributed systems.", "required"),
            ("Distributed systems experience is required.", "required"),
            ("You have shipped distributed systems.", "required"),
            ("Experience with distributed systems.", "required"),
            ("Proficiency in distributed systems.", "required"),
            ("Strong distributed systems background.", "required"),
            ("6+ years of experience in distributed systems.", "required"),
            ("6+ years of experience building distributed systems.", "required"),
            ("Track record of distributed systems work.", "required"),
            ("Deep expertise in distributed systems.", "required"),
            ("Distributed systems is a plus.", "preferred"),
            ("Nice to have: distributed systems.", "preferred"),
            ("Bonus: distributed systems.", "preferred"),
            ("Distributed systems preferred.", "preferred"),
            ("Distributed systems knowledge is not required.", "preferred"),
            ("Strong distributed systems skills are a strong plus.", "preferred"),
            ("We build distributed systems.", "preferred"),
        ],
    )
    def test_the_wording_of_the_sentence_decides(self, sentence, bucket):
        assert rules.classify_rule_skill(sentence, "distributed systems") == bucket

    def test_rule_found_skills_skip_what_is_already_there_or_covered(self):
        text = "Strong understanding of high reliability distributed systems and unit testing."
        found = dict(rules.rule_found_skills(text, exclude={"high reliability distributed systems"}))
        assert "distributed systems" not in found and "unit testing" in found


class TestEnvironmentOnly:
    @pytest.mark.parametrize(
        "name,text,expected",
        [
            ("aws sagemaker", "You'll own the lifecycle to production deployment on AWS SageMaker.", True),
            ("heroku", "The app is hosted on Heroku today.", True),
            ("gke", "Services running in GKE.", True),
            ("aws sagemaker", "Experience with AWS SageMaker is required.", False),
            ("sagemaker", "Strong SageMaker skills. Models are deployed on SageMaker.", False),  # one mention is a requirement
            ("snowflake", "Experience with a cloud data warehouse (Snowflake, BigQuery, or Redshift).", False),
            ("model monitoring", "Production deployment on model monitoring.", False),  # a concept is never moved
            ("aws sagemaker", "We like SageMaker.", False),  # mentioned, but not as where work runs
            ("aws sagemaker", "Nothing about it here.", False),
        ],
    )
    def test_environment_only(self, name, text, expected):
        assert rules.environment_only(name, text) is expected


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


class TestMultiTokenNames:
    TEXT = "Experience with SOC 2 and ISO 27001, PCI DSS, C++ and C#. Cloud: AWS GCP. 5 years of SQL. Experience with AWS 3+ years."

    def test_names_kept_whole(self):
        names = [n for n, _, _ in rules.multi_token_names(self.TEXT)]
        assert names == ["SOC 2", "ISO 27001", "PCI DSS", "C++", "C#"]

    def test_known_acronyms_are_not_joined_and_counts_are_not_standards(self):
        assert rules.multi_token_names("Cloud: AWS GCP.") == []
        assert rules.multi_token_names("Experience with AWS 3+ years.") == []
        assert rules.multi_token_names("SQL 3 years minimum.") == []

    def test_a_fragment_becomes_the_whole_name(self):
        assert rules.full_name(self.TEXT, "soc") == "soc 2"
        assert rules.full_name(self.TEXT, "pci") == "pci dss"
        assert rules.full_name("SOC 2 audits; SOC reports.", "soc") == "soc"  # also named alone
        assert rules.full_name(self.TEXT, "aws") == "aws"

    def test_rule_candidates_have_no_fragments(self):
        found = dict(rules.rule_found_skills(self.TEXT, exclude=set()))
        assert {"soc 2", "iso 27001", "pci dss", "c++", "c#"} <= set(found)
        assert not {"soc", "iso", "pci", "dss", "c"} & set(found)
