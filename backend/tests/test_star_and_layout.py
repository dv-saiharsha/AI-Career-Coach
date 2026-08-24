"""STAR evaluation, reverse questions, and ATS layout readiness."""

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.modules.interview_coach.reverse_questions import generate_reverse_questions
from app.modules.interview_coach.star_bank import evaluate_star_story
from app.modules.resume_analyzer.layout_check import (
    detect_columns,
    find_headers,
    inspect_ats_parsing_readiness,
)

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"

STRONG = {
    "situation": "Our checkout service was timing out during peak traffic and losing orders every evening.",
    "task": "I owned reliability for the payments path and had to stop the timeouts before the holiday peak.",
    "action": (
        "I profiled the request path, found an N+1 query in the cart loader, and rebuilt it as a "
        "single batched fetch. I then designed a Redis cache in front of the pricing service and "
        "migrated the hottest endpoints onto it behind a feature flag."
    ),
    "result": "Reduced p95 latency by 40% and cut failed checkouts from 3% to under 0.2% within two weeks.",
}


class TestStarEvaluation:
    def test_complete_story_scores_full_marks(self):
        result = evaluate_star_story(**STRONG)
        assert result["score"] == 100.0
        assert result["has_quantified_result"] and result["has_strong_verbs"]

    def test_empty_story_scores_zero_not_forty(self):
        """A blank story has demonstrated nothing. A 40-point base would tell
        the candidate an empty answer was nearly halfway acceptable."""
        result = evaluate_star_story("", "", "", "")
        assert result["score"] == 0.0

    def test_result_without_a_figure_loses_its_component(self):
        story = {**STRONG, "result": "Things got a lot better and everyone was very happy with it."}
        result = evaluate_star_story(**story)
        assert result["has_quantified_result"] is False
        assert result["score"] == 75.0
        assert any("figure" in f for f in result["feedback"])

    def test_short_action_loses_its_component(self):
        story = {**STRONG, "action": "I fixed it."}
        assert evaluate_star_story(**story)["has_action"] is False

    def test_long_action_without_a_real_verb_still_fails(self):
        """Thirty words of 'I was involved in the project' describes nothing."""
        story = {
            **STRONG,
            "action": " ".join(["I was involved in the project and participated in meetings"] * 4),
        }
        result = evaluate_star_story(**story)
        assert result["has_action"] is False
        assert result["has_strong_verbs"] is False

    def test_verbs_detected_beyond_the_first_word(self):
        """A STAR Action is several sentences, so the meaningful verb is
        rarely the opening token — unlike a resume bullet."""
        result = evaluate_star_story(**STRONG)
        assert "designed" in result["strong_verbs"]

    def test_passive_phrasing_is_called_out(self):
        story = {**STRONG, "action": STRONG["action"] + " I was responsible for the rollout."}
        assert "responsible" in evaluate_star_story(**story)["weak_phrases"]

    def test_feedback_is_actionable_when_perfect(self):
        assert evaluate_star_story(**STRONG)["feedback"] == [
            "Complete STAR structure with a measurable outcome."
        ]

    def test_word_counts_reported(self):
        counts = evaluate_star_story(**STRONG)["word_counts"]
        assert counts["action"] > counts["task"]

    @pytest.mark.parametrize(
        "result_text",
        ["Cut costs by 40% overall for the org", "Saved $2M annually across the org",
         "Dropped latency to 200ms at p99 for users", "Improved throughput 3x for the pipeline"],
    )
    def test_metric_forms_recognised(self, result_text):
        assert evaluate_star_story(**{**STRONG, "result": result_text})["has_quantified_result"]


JD = "Seeking an engineer with deep learning and Kubernetes experience to scale our platform."


class TestReverseQuestions:
    def test_returns_three_to_five(self):
        questions = generate_reverse_questions("ML Engineer", "Acme", JD)
        assert 3 <= len(questions) <= 5

    def test_is_deterministic(self):
        """set() iteration order varies with PYTHONHASHSEED, so a naive
        list(set(words))[:4] yields different questions on every process —
        the same JD would produce different output with no explanation."""
        first = generate_reverse_questions("ML Engineer", "Acme", JD)
        second = generate_reverse_questions("ML Engineer", "Acme", JD)
        assert first == second

    def test_no_stopwords_leak_into_questions(self):
        """Uppercasing tokens and subtracting a lowercase stopword set removes
        nothing, which puts 'trade-offs around FOR' in a question."""
        text = " ".join(str(q["question"]) for q in generate_reverse_questions("Eng", "Acme", JD))
        for stopword in (" FOR ", " WITH ", " THE ", " AND ", " USING "):
            assert stopword not in text

    def test_uses_a_term_from_the_job_description(self):
        text = " ".join(q["question"] for q in generate_reverse_questions("ML Engineer", "Acme", JD))
        assert "deep learning" in text.lower() or "kubernetes" in text.lower()

    def test_company_name_appears(self):
        text = " ".join(q["question"] for q in generate_reverse_questions("Eng", "Globex", JD))
        assert "Globex" in text

    def test_empty_jd_still_returns_usable_questions(self):
        questions = generate_reverse_questions("Engineer", "Acme", "")
        assert len(questions) >= 3
        assert all(q["question"] and q["purpose"] for q in questions)

    def test_every_question_explains_its_purpose(self):
        for question in generate_reverse_questions("ML Engineer", "Acme", JD):
            assert question["purpose"]

    def test_blank_inputs_do_not_produce_dangling_text(self):
        text = " ".join(q["question"] for q in generate_reverse_questions("", "", ""))
        assert "  " not in text and " ." not in text


def build_pdf(two_column: bool) -> bytes:
    document = fitz.open()
    page = document.new_page()
    y = 60
    for _ in range(22):
        if two_column:
            page.insert_text((50, y), "Engineered scalable backend services", fontsize=9)
            page.insert_text((330, y), "Optimized query latency and caching", fontsize=9)
        else:
            page.insert_text((50, y), "Engineered scalable backend services and cut latency", fontsize=9)
        y += 16
    data = document.tobytes()
    document.close()
    return data


class TestColumnDetection:
    def test_single_column_is_not_flagged(self):
        """The false positive that matters: counting short lines can't tell a
        two-column layout from a resume listing one skill per line."""
        assert detect_columns(build_pdf(False))["multi_column_pages"] == []

    def test_two_column_is_detected(self):
        assert detect_columns(build_pdf(True))["multi_column_pages"] == [1]

    def test_unopenable_bytes_report_not_checked(self):
        """An unverified pass is worse than an honest gap."""
        result = detect_columns(b"not a pdf")
        assert result["checked"] is False and result["reason"]


class TestHeaderDetection:
    def test_finds_standard_headers(self):
        assert "experience" in find_headers(["EXPERIENCE", "Some body text here"])

    def test_professional_experience_is_standard(self):
        """A minimal header set would flag this common, perfectly good
        heading as non-standard."""
        assert find_headers(["Professional Experience"]) == ["professional experience"]

    def test_trailing_punctuation_tolerated(self):
        assert find_headers(["Technical Skills:"]) == ["technical skills"]

    def test_long_line_is_not_a_header(self):
        assert find_headers(["I have extensive experience building distributed systems"]) == []


class TestParsingReadiness:
    def _text(self, pdf: bytes) -> str:
        with fitz.open(stream=pdf, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)

    def test_clean_resume_scores_high(self):
        text = (
            "Jane Doe\n\nProfessional Experience\n"
            + "Engineered scalable services and reduced latency by 40 percent. " * 12
            + "\n\nEducation\nBS Computer Science\n\nTechnical Skills\nPython, Go\n"
        )
        result = inspect_ats_parsing_readiness(text, build_pdf(False))
        assert result["parsing_readiness_score"] >= 90
        assert result["is_single_column"] is True

    def test_two_column_pdf_is_penalised(self):
        pdf = build_pdf(True)
        result = inspect_ats_parsing_readiness(self._text(pdf), pdf)
        assert result["is_single_column"] is False
        assert any("Multi-column" in w["issue"] for w in result["warnings"])

    def test_image_only_pdf_flagged_critical(self):
        result = inspect_ats_parsing_readiness("", b"")
        assert any(w["severity"] == "critical" for w in result["warnings"])

    def test_column_state_is_none_without_pdf_bytes(self):
        """Three-valued on purpose: reporting an unchecked document as
        single-column would be a claim with no evidence behind it."""
        text = "Professional Experience\n" + ("Did work. " * 60) + "\nEducation\nBS\n"
        result = inspect_ats_parsing_readiness(text, None)
        assert result["is_single_column"] is None
        assert result["column_check_skipped_reason"]

    def test_score_never_negative(self):
        """Deductions can exceed 100 when everything is wrong at once."""
        assert inspect_ats_parsing_readiness("", b"bad")["parsing_readiness_score"] >= 0.0

    def test_repeated_phrase_on_one_page_is_not_a_running_header(self):
        """Regression: counting repeats in flat text can't tell a running
        header from a phrase reused across bullets on a single page. Flagging
        the second is a false warning on a perfectly good resume."""
        pdf = build_pdf(False)  # same line 22 times, one page
        result = inspect_ats_parsing_readiness(self._text(pdf), pdf)
        assert not any("header or footer" in w["issue"].lower() for w in result["warnings"])

    def test_single_page_never_reports_a_running_header(self):
        """A one-page resume has no running header by definition."""
        from app.modules.resume_analyzer.layout_check import _repeated_edge_lines

        assert _repeated_edge_lines(build_pdf(False)) == []

    def test_running_header_across_pages_is_detected(self):
        document = fitz.open()
        for _ in range(3):
            page = document.new_page()
            page.insert_text((50, 30), "Jane Doe - Curriculum Vitae", fontsize=9)
            y = 120
            for _ in range(20):
                page.insert_text((50, y), "Engineered scalable backend services", fontsize=9)
                y += 16
        pdf = document.tobytes()
        document.close()

        from app.modules.resume_analyzer.layout_check import _repeated_edge_lines

        assert "Jane Doe - Curriculum Vitae" in _repeated_edge_lines(pdf)

    def test_warnings_carry_actionable_detail(self):
        for warning in inspect_ats_parsing_readiness("", b"")["warnings"]:
            assert warning["detail"] and warning["severity"] and warning["issue"]


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=USER_A, email="a@example.com"
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


class TestStoryEndpoints:
    def test_create_and_list(self, client):
        created = client.post("/api/interview/stories", json={"title": "Checkout fix", **STRONG})
        assert created.status_code == 201
        assert created.json()["evaluation"]["score"] == 100.0
        assert client.get("/api/interview/stories").json()["count"] == 1

    def test_partial_story_can_be_saved(self, client):
        """The bank has to work for drafting, which is when people use it."""
        response = client.post("/api/interview/stories", json={"title": "Draft"})
        assert response.status_code == 201
        assert response.json()["evaluation"]["score"] == 0.0

    def test_title_is_required(self, client):
        assert client.post("/api/interview/stories", json={"situation": "x"}).status_code == 422

    def test_patch_leaves_omitted_fields_untouched(self, client):
        story_id = client.post(
            "/api/interview/stories", json={"title": "T", **STRONG}
        ).json()["id"]
        patched = client.patch(f"/api/interview/stories/{story_id}", json={"title": "Renamed"})
        assert patched.json()["title"] == "Renamed"
        assert patched.json()["result"] == STRONG["result"]

    def test_delete(self, client):
        story_id = client.post("/api/interview/stories", json={"title": "T"}).json()["id"]
        assert client.delete(f"/api/interview/stories/{story_id}").status_code == 204
        assert client.get("/api/interview/stories").json()["count"] == 0

    def test_another_users_story_is_404_not_403(self, client, db_session):
        """403 would confirm the row exists."""
        from app.models.story import StarStory

        other = StarStory(user_id=USER_B, title="Theirs")
        db_session.add(other)
        db_session.commit()
        assert client.patch(f"/api/interview/stories/{other.id}", json={"title": "x"}).status_code == 404
        assert client.delete(f"/api/interview/stories/{other.id}").status_code == 404

    def test_list_excludes_other_users(self, client, db_session):
        from app.models.story import StarStory

        db_session.add(StarStory(user_id=USER_B, title="Theirs"))
        db_session.commit()
        assert client.get("/api/interview/stories").json()["count"] == 0

    def test_evaluate_without_saving(self, client):
        response = client.post("/api/interview/stories/evaluate", json=STRONG)
        assert response.json()["score"] == 100.0
        assert client.get("/api/interview/stories").json()["count"] == 0

    def test_reverse_questions_endpoint(self, client):
        response = client.post(
            "/api/interview/reverse-questions",
            json={"job_title": "ML Engineer", "company": "Acme", "jd_text": JD},
        )
        assert response.status_code == 200
        assert len(response.json()["questions"]) >= 3


def test_story_endpoints_require_auth():
    assert TestClient(app).get("/api/interview/stories").status_code == 401
