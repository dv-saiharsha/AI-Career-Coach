"""The golden set is internally valid, and agrees with the code on what the code decides.

These do not run the model. They check the hand-written files themselves: that
each parses as a JDAnalysis, that every quote is verbatim in its (cleaned) JD,
that either/or groups are well formed, that nothing forbidden is expected, and
that the fields the analyzer decides in code (level, years, title, optional vs
required) come out the way the annotator wrote them.
"""

import json
from pathlib import Path

import pytest

from app.core.taxonomy import canonical
from app.modules.job_market.enrichment import quote_in_text
from app.modules.jd_analyzer import cleaning, rules
from app.modules.jd_analyzer.schemas import JDAnalysis
from scripts.seed_job_descriptions import SEED_JOB_DESCRIPTIONS

FIXTURES = Path(__file__).parent / "fixtures" / "jd_golden"
SEED = {j["id"]: j["text"] for j in SEED_JOB_DESCRIPTIONS}
FILES = sorted(FIXTURES.glob("*.json"))


def load(path):
    doc = json.loads(path.read_text(encoding="utf-8"))
    text = doc["jd_text"] if doc.get("synthetic") else SEED[doc["jd_id"]]
    return doc, text, cleaning.clean_jd(text)


def test_there_are_six_and_exactly_one_is_synthetic():
    docs = [json.loads(p.read_text(encoding="utf-8")) for p in FILES]
    assert len(docs) == 6
    assert [d["jd_id"] for d in docs if d.get("synthetic")] == ["synthetic-engineering-manager"]
    assert "SYNTHETIC" in (FIXTURES / "README.md").read_text(encoding="utf-8")


def test_the_set_covers_an_entry_level_junior_mid_senior_and_manager_jd():
    levels = {json.loads(p.read_text(encoding="utf-8"))["expected"]["seniority"] for p in FILES}
    assert {"junior", "mid", "senior", "manager"} <= levels


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.stem)
class TestEachFixture:
    def test_expected_is_a_valid_analysis(self, path):
        doc, _, _ = load(path)
        analysis = JDAnalysis.model_validate({**doc["expected"], "source": "llm"})
        assert analysis.job_title and len(analysis.responsibilities) <= 10

    def test_every_quote_is_verbatim_in_the_cleaned_jd(self, path):
        doc, _, cleaned = load(path)
        e = doc["expected"]
        quotes = [s["evidence"] for s in e["required_skills"] + e["preferred_skills"]]
        quotes += [r["evidence"] for r in e["education"] + e["certifications"]]
        missing = [q for q in quotes if not quote_in_text(q, cleaned)]
        assert not missing, missing

    def test_names_are_canonical_and_unique_and_never_the_title(self, path):
        doc, _, _ = load(path)
        e = doc["expected"]
        names = [s["name"] for s in e["required_skills"] + e["preferred_skills"]]
        assert all(canonical(n) == n for n in names) and len(names) == len(set(names))
        assert not set(names) & rules.title_forms(e["job_title"])

    def test_alternative_groups_are_real_groups_with_one_shared_or_quote(self, path):
        doc, _, _ = load(path)
        e = doc["expected"]
        groups: dict[str, list[dict]] = {}
        for s in e["required_skills"] + e["preferred_skills"]:
            if s["alternative_group"]:
                groups.setdefault(s["alternative_group"], []).append(s)
        for label, members in groups.items():
            assert len(members) >= 2, label
            assert len({m["evidence"] for m in members}) == 1 and " or " in members[0]["evidence"], label

    def test_the_code_finds_the_same_groups_from_the_quotes(self, path):
        from app.modules.jd_analyzer.schemas import Skill

        doc, _, _ = load(path)
        skills = [Skill(**{**s, "alternative_group": None}) for s in doc["expected"]["required_skills"]]
        found = {frozenset(s.name for s in skills if s.alternative_group == g) for g in {s.alternative_group for s in rules.assign_alternative_groups(skills)} if g}
        expected_groups = {}
        for s in doc["expected"]["required_skills"]:
            if s["alternative_group"]:
                expected_groups.setdefault(s["alternative_group"], set()).add(s["name"])
        assert found == {frozenset(v) for v in expected_groups.values()}

    def test_nothing_forbidden_is_expected(self, path):
        doc, _, _ = load(path)
        e = doc["expected"]
        everything = {s["name"] for s in e["required_skills"] + e["preferred_skills"]} | set(e["tools_technologies"])
        everything |= {k["term"] for k in e["ats_keywords"]}
        assert not everything & set(doc["forbidden_skills"])

    def test_forbidden_skills_really_are_absent_from_the_jd(self, path):
        from app.core.skill_match import named_in

        doc, _, cleaned = load(path)
        present = [f for f in doc["forbidden_skills"] if f != "r" and named_in(cleaned, f)]
        assert not present, present

    def test_the_code_agrees_on_title_years_and_level(self, path):
        doc, _, cleaned = load(path)
        e = doc["expected"]
        assert rules.title_from_text(cleaned) == e["job_title"]
        years = rules.first_years(cleaned)
        assert years == e["min_years_experience"]
        assert rules.resolve_seniority(e["job_title"], cleaned, years) == (e["seniority"], e["seniority_source"])

    def test_the_wording_decides_every_required_flag(self, path):
        doc, _, cleaned = load(path)
        for item in doc["expected"]["education"] + doc["expected"]["certifications"]:
            # Offered the opposite flag, the wording must still win.
            assert rules.requirement_flag(cleaned, item["evidence"], not item["required"]) is item["required"], item

    def test_keyword_weights_follow_the_rule(self, path):
        doc, _, _ = load(path)
        allowed = {1.0, 0.8, 0.5, 0.4}
        assert {k["weight"] for k in doc["expected"]["ats_keywords"]} <= allowed


def test_the_synthetic_jd_cleans_down_to_the_job_itself():
    doc, raw, cleaned = load(FIXTURES / "synthetic-engineering-manager.json")
    assert "<" not in cleaned and "&amp;" not in cleaned
    for noise in ("401(k)", "dental", "PTO", "equity", "stipend", "equal opportunity", "accommodation", "discriminate"):
        assert noise.lower() not in cleaned.lower(), noise
    for kept in ("Kubernetes and Terraform", "AWS, GCP, or Azure", "Must hold the AWS Certified", "Nice to have"):
        assert kept in cleaned, kept


def test_seed_jds_are_untouched_by_cleaning():
    for path in FILES:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not doc.get("synthetic"):
            assert cleaning.clean_jd(SEED[doc["jd_id"]]) == SEED[doc["jd_id"]]
