"""Quick Tailor: a finished resume, fitted to an exact page count.

The claim being tested is "one page", and it is a claim about a compiled
PDF, not about a template. A test that renders LaTeX and checks the source
looks short would pass for a document that comes out at three pages, so
these compile with the real toolchain and count the real pages.

They are skipped rather than failed where tectonic is absent, because a
missing binary on a contributor's machine is not a broken resume builder.

The second thing tested is the promise fit.py makes about *not* writing for
the candidate. Trimming to a page is selection; padding to reach two is
fabrication, and the difference is the whole reason this feature is
allowed to exist in a codebase whose tailor module opens by saying it
deliberately does not write the resume for you.
"""

import pytest

from app.modules.resume_builder import fit, latex

pytestmark = pytest.mark.skipif(
    not latex.tectonic_available(), reason="tectonic not installed on this machine"
)


def _role(title: str, bullets: int, word: str = "Built and shipped services") -> dict:
    return {
        "title": title,
        "company": f"{title} Corp",
        "dates": "2020 - 2023",
        "bullets": [f"{word} number {i} using Python, Kubernetes and Postgres." for i in range(bullets)],
    }


def _resume(roles: int, bullets_per_role: int) -> dict:
    return {
        "candidate_name": "Jane Doe",
        "email": "jane@example.com",
        "phone": "+1 555 010 1234",
        "location": "Seattle, WA",
        "linkedin": "https://linkedin.com/in/janedoe",
        "summary": "Backend engineer with a decade of distributed systems work. " * 3,
        "technical_skills": ["Python", "Go", "Kubernetes", "Postgres", "Kafka", "AWS"],
        "tools_skills": ["Datadog", "Terraform", "Jenkins", "Git"],
        "experiences": [_role(f"Engineer {i}", bullets_per_role) for i in range(roles)],
        "education": [{"degree": "BS Computer Science", "institution": "State University", "dates": "2013"}],
    }


class TestItActuallyFits:
    def test_a_long_resume_is_brought_down_to_one_page(self):
        """Nine roles with six bullets each is several pages of LaTeX. The
        whole point is that it comes back as one."""
        result = fit.fit_to_pages(_resume(roles=9, bullets_per_role=6), target_pages=1)

        assert result["page_count"] == 1, (
            f"asked for one page, got {result['page_count']} "
            f"after adjustments: {result['adjustments']}"
        )
        assert result["fits"] is True
        assert result["adjustments"], "it fitted without recording what it cut"

    def test_a_short_resume_is_left_alone(self):
        """Nothing to trim means nothing trimmed — the ladder must not fire
        on a resume that already fits."""
        result = fit.fit_to_pages(_resume(roles=2, bullets_per_role=2), target_pages=1)

        assert result["page_count"] == 1
        assert result["adjustments"] == []

    def test_two_pages_keeps_more_of_the_candidates_history(self):
        """The experienced path. Same input, looser target, and the result
        must genuinely retain more — otherwise the two-page option is a
        label on the same document."""
        source = _resume(roles=9, bullets_per_role=6)
        one = fit.fit_to_pages({**source, "experiences": [dict(e) for e in source["experiences"]]}, 1)
        two = fit.fit_to_pages({**source, "experiences": [dict(e) for e in source["experiences"]]}, 2)

        assert two["page_count"] <= 2
        one_bullets = sum(len(e["bullets"]) for e in one["content"]["experiences"])
        two_bullets = sum(len(e["bullets"]) for e in two["content"]["experiences"])
        assert two_bullets > one_bullets, (
            f"two-page kept {two_bullets} bullets against one-page's {one_bullets} — "
            "the longer format is not actually carrying more"
        )


class TestItNeverWritesForTheCandidate:
    def test_no_bullet_text_is_invented_or_altered(self):
        """Every line in the output must be a line that went in. Trimming and
        reordering are allowed; a new sentence is not."""
        source = _resume(roles=6, bullets_per_role=5)
        original = {b for e in source["experiences"] for b in e["bullets"]}

        result = fit.fit_to_pages(source, target_pages=1)
        produced = {b for e in result["content"]["experiences"] for b in e["bullets"]}

        assert produced <= original, f"invented or altered bullets: {produced - original}"

    def test_a_thin_resume_is_not_padded_to_reach_two_pages(self):
        """The failure mode this feature could easily have. Asking for two
        pages from a candidate with one page of history must return one page,
        not a page of filler."""
        result = fit.fit_to_pages(_resume(roles=2, bullets_per_role=2), target_pages=2)

        assert result["page_count"] == 1, "content was padded to reach the requested length"
        assert result["adjustments"] == []


class TestItStaysHonestWhenItCannotWin:
    def test_it_reports_the_real_page_count_rather_than_the_requested_one(self, monkeypatch):
        """If the ladder runs out, the caller is told. A `fits` that is always
        True would make the field useless exactly when it matters."""
        monkeypatch.setattr(latex, "count_pdf_pages", lambda _pdf: 4)

        result = fit.fit_to_pages(_resume(roles=4, bullets_per_role=4), target_pages=1)

        assert result["page_count"] == 4
        assert result["fits"] is False

    def test_it_never_cuts_below_two_roles(self):
        """A resume trimmed to a single job is not a shorter resume, it is a
        different candidate."""
        monkeypatch_free = _resume(roles=5, bullets_per_role=8)
        result = fit.fit_to_pages(monkeypatch_free, target_pages=1)
        assert len(result["content"]["experiences"]) >= fit.MIN_ROLES


def test_the_most_job_relevant_bullets_survive_the_trim():
    """Trimming cuts from the end, so relevance ordering is what decides
    which of the candidate's own lines make the page."""
    source = _resume(roles=3, bullets_per_role=6)
    source["experiences"][0]["bullets"][-1] = "Scaled Kubernetes clusters running Kafka at high throughput."

    result = fit.fit_to_pages(source, target_pages=1, jd_keywords={"kubernetes", "kafka"})

    kept = result["content"]["experiences"][0]["bullets"]
    assert any("Kubernetes clusters running Kafka" in b for b in kept), (
        "the most job-relevant bullet was trimmed while less relevant ones survived"
    )


class TestTheTwoPageOptionIsARealDifference:
    """Before the density knob existed, asking for two pages returned a
    byte-identical document for any candidate whose content fit on one — the
    option was a label. Caught by running it end to end, not by a unit test,
    which is why this one exists now."""

    def test_the_longer_format_is_typographically_different(self):
        source = _resume(roles=3, bullets_per_role=3)
        one = fit.fit_to_pages({**source, "experiences": [dict(e) for e in source["experiences"]]}, 1)
        two = fit.fit_to_pages({**source, "experiences": [dict(e) for e in source["experiences"]]}, 2)

        assert one["density"] == "compact"
        assert two["density"] == "regular"
        assert one["tex"] != two["tex"], "both lengths produced the same document"
        assert "10pt" in one["tex"] and "11pt" in two["tex"]

    def test_the_content_is_the_same_words_either_way(self):
        """The difference must be layout only. If the longer format carried
        text the shorter one did not, something wrote for the candidate."""
        source = _resume(roles=3, bullets_per_role=3)
        one = fit.fit_to_pages({**source, "experiences": [dict(e) for e in source["experiences"]]}, 1)
        two = fit.fit_to_pages({**source, "experiences": [dict(e) for e in source["experiences"]]}, 2)

        one_bullets = {b for e in one["content"]["experiences"] for b in e["bullets"]}
        two_bullets = {b for e in two["content"]["experiences"] for b in e["bullets"]}
        assert one_bullets == two_bullets


def test_the_filename_does_not_invent_a_role_from_prose():
    """A first pass mined the job description's opening line for a role and
    produced DOE_JANE_RESUME_SENIOR_BACKEND_ENGINEER_KUBE_COMPANY.pdf —
    truncated mid-word, with a literal COMPANY placeholder left in."""
    from app.modules.resume_builder.services import _faang_filename

    assert _faang_filename("Jane Doe") == "DOE_JANE_RESUME.pdf"
    assert "COMPANY" not in _faang_filename("Jane Doe")
