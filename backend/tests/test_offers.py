"""Offer comparison: total-comp arithmetic, ownership isolation, validation."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"


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


def as_user(client, user_id):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=user_id, email=f"{user_id}@example.com"
    )
    return client


# The spec's worked example: base 150k, signing 10k, bonus 15k, equity 20k.
SPEC_OFFER = {
    "company": "Acme",
    "role_title": "Senior Engineer",
    "base_salary": 150000,
    "annual_bonus": 15000,
    "signing_bonus": 10000,
    "equity_value_annual": 20000,
}


class TestTotalCompensation:
    def test_first_year_total_matches_worked_example(self, client):
        """150k + 15k + 10k + 20k = 195k."""
        response = client.post("/api/offers", json=SPEC_OFFER)
        assert response.status_code == 201
        assert response.json()["total_first_year"] == 195000.0

    def test_recurring_excludes_signing_bonus(self, client):
        """195k - 10k signing = 185k every year after the first. Keeping these
        apart is the point: a big signing bonus can make a structurally weaker
        offer look stronger in year one."""
        assert client.post("/api/offers", json=SPEC_OFFER).json()["recurring_annual"] == 185000.0

    def test_missing_components_default_to_zero(self, client):
        response = client.post(
            "/api/offers", json={"company": "A", "role_title": "R", "base_salary": 100000}
        )
        body = response.json()
        assert body["total_first_year"] == 100000.0
        assert body["recurring_annual"] == 100000.0

    def test_cents_do_not_drift(self, client):
        """Money is stored as NUMERIC and summed as Decimal — three .10 values
        added as binary floats would not land exactly on the expected total."""
        response = client.post(
            "/api/offers",
            json={
                "company": "A", "role_title": "R",
                "base_salary": 100000.10, "annual_bonus": 0.10,
                "signing_bonus": 0.10, "equity_value_annual": 0,
            },
        )
        assert response.json()["total_first_year"] == 100000.30

    def test_zero_offer_is_valid(self, client):
        response = client.post(
            "/api/offers", json={"company": "A", "role_title": "R", "base_salary": 0}
        )
        assert response.status_code == 201
        assert response.json()["total_first_year"] == 0.0


class TestTaxAndColAdjustment:
    """Both inputs are user-entered. Nothing is inferred or looked up."""

    def test_worked_example_to_the_cent(self, client):
        """160000 x (1 - 0.20) / 1.10 = 116363.6363... -> 116363.64."""
        response = client.post(
            "/api/offers",
            json={
                "company": "A", "role_title": "R", "base_salary": 160000,
                "estimated_tax_rate": 0.20, "col_index": 1.10,
            },
        )
        body = response.json()
        assert body["net_adjusted_comp"] == 116363.64
        assert body["is_adjusted"] is True

    def test_unadjusted_matches_recurring_exactly(self, client):
        body = client.post(
            "/api/offers", json={"company": "A", "role_title": "R", "base_salary": 160000}
        ).json()
        assert body["net_adjusted_comp"] == body["recurring_annual"] == 160000.0
        assert body["is_adjusted"] is False

    def test_zero_tax_rate_is_a_real_answer_not_absence(self, client):
        """A no-income-tax state is a deliberate 0, distinct from unsupplied —
        so it must still count as adjusted."""
        body = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 160000, "estimated_tax_rate": 0},
        ).json()
        assert body["net_adjusted_comp"] == 160000.0
        assert body["is_adjusted"] is True

    def test_col_index_of_one_is_not_an_adjustment(self, client):
        body = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 100000, "col_index": 1.0},
        ).json()
        assert body["net_adjusted_comp"] == 100000.0
        assert body["is_adjusted"] is False

    def test_tax_only(self, client):
        body = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 200000, "estimated_tax_rate": 0.25},
        ).json()
        assert body["net_adjusted_comp"] == 150000.0

    def test_col_only(self, client):
        body = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 110000, "col_index": 1.10},
        ).json()
        assert body["net_adjusted_comp"] == 100000.0

    def test_adjustment_applies_to_recurring_not_first_year(self, client):
        """The signing bonus is one-off, so it must stay out of the number
        used to compare long-term value."""
        body = client.post(
            "/api/offers",
            json={
                "company": "A", "role_title": "R", "base_salary": 100000,
                "signing_bonus": 50000, "estimated_tax_rate": 0.20,
            },
        ).json()
        assert body["net_adjusted_comp"] == 80000.0
        assert body["total_first_year"] == 150000.0

    def test_col_index_zero_rejected_at_schema(self, client):
        """gt=0 rules out the divide-by-zero before it reaches arithmetic."""
        response = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 100000, "col_index": 0},
        )
        assert response.status_code == 422

    def test_tax_rate_above_one_rejected(self, client):
        """A rate over 100% would yield negative take-home."""
        response = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 100000, "estimated_tax_rate": 1.5},
        )
        assert response.status_code == 422

    def test_negative_tax_rate_rejected(self, client):
        response = client.post(
            "/api/offers",
            json={"company": "A", "role_title": "R", "base_salary": 100000, "estimated_tax_rate": -0.1},
        )
        assert response.status_code == 422

    def test_rounding_is_half_up_not_bankers(self, client):
        """Decimal defaults to ROUND_HALF_EVEN, which would send .125 down to
        .12; money rounds half away from zero so hand-checking agrees."""
        from decimal import Decimal

        from app.modules.offers.services import compute_net_adjusted

        value, _ = compute_net_adjusted(Decimal("0.125"), None, None)
        assert value == Decimal("0.13")


class TestValidation:
    def test_negative_salary_rejected(self, client):
        """A negative figure isn't a real offer and would silently drag a
        comparison total down."""
        response = client.post(
            "/api/offers", json={**SPEC_OFFER, "base_salary": -1000}
        )
        assert response.status_code == 422

    def test_negative_bonus_rejected(self, client):
        assert client.post("/api/offers", json={**SPEC_OFFER, "signing_bonus": -1}).status_code == 422

    def test_company_required(self, client):
        assert client.post("/api/offers", json={"role_title": "R", "base_salary": 1}).status_code == 422

    def test_blank_company_rejected(self, client):
        assert client.post("/api/offers", json={**SPEC_OFFER, "company": ""}).status_code == 422


class TestListAndUpdate:
    def test_lists_own_offers_with_count(self, client):
        client.post("/api/offers", json=SPEC_OFFER)
        client.post("/api/offers", json={**SPEC_OFFER, "company": "Globex"})
        body = client.get("/api/offers").json()
        assert body["count"] == 2
        assert {o["company"] for o in body["offers"]} == {"Acme", "Globex"}

    def test_empty_list(self, client):
        assert client.get("/api/offers").json() == {"offers": [], "count": 0}

    def test_patch_recomputes_totals(self, client):
        offer_id = client.post("/api/offers", json=SPEC_OFFER).json()["id"]
        response = client.patch(f"/api/offers/{offer_id}", json={"base_salary": 160000})
        assert response.json()["total_first_year"] == 205000.0

    def test_notes_only_patch_preserves_salary(self, client):
        offer_id = client.post("/api/offers", json=SPEC_OFFER).json()["id"]
        response = client.patch(f"/api/offers/{offer_id}", json={"notes": "Verbal only"})
        assert response.json()["base_salary"] == 150000.0
        assert response.json()["notes"] == "Verbal only"

    def test_empty_patch_rejected(self, client):
        offer_id = client.post("/api/offers", json=SPEC_OFFER).json()["id"]
        assert client.patch(f"/api/offers/{offer_id}", json={}).status_code == 400

    def test_patch_missing_offer_404(self, client):
        assert client.patch("/api/offers/999999", json={"notes": "x"}).status_code == 404


class TestOwnershipIsolation:
    def test_list_excludes_other_users(self, client):
        client.post("/api/offers", json=SPEC_OFFER)
        as_user(client, USER_B)
        assert client.get("/api/offers").json()["count"] == 0

    def test_cannot_patch_another_users_offer(self, client):
        offer_id = client.post("/api/offers", json=SPEC_OFFER).json()["id"]
        as_user(client, USER_B)
        # 404, not 403 — a 403 would confirm the row exists.
        assert client.patch(f"/api/offers/{offer_id}", json={"base_salary": 1}).status_code == 404

    def test_cannot_delete_another_users_offer(self, client):
        offer_id = client.post("/api/offers", json=SPEC_OFFER).json()["id"]
        as_user(client, USER_B)
        assert client.delete(f"/api/offers/{offer_id}").status_code == 404
        as_user(client, USER_A)
        assert client.get("/api/offers").json()["count"] == 1

    def test_caller_cannot_set_user_id(self, client):
        client.post("/api/offers", json={**SPEC_OFFER, "user_id": USER_B})
        as_user(client, USER_B)
        assert client.get("/api/offers").json()["count"] == 0


class TestDelete:
    def test_deletes_own_offer(self, client):
        offer_id = client.post("/api/offers", json=SPEC_OFFER).json()["id"]
        assert client.delete(f"/api/offers/{offer_id}").status_code == 204
        assert client.get("/api/offers").json()["count"] == 0

    def test_missing_returns_404(self, client):
        assert client.delete("/api/offers/999999").status_code == 404


def test_unauthenticated_rejected(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        anon = TestClient(app)
        assert anon.get("/api/offers").status_code == 401
        assert anon.post("/api/offers", json=SPEC_OFFER).status_code == 401
    finally:
        app.dependency_overrides.clear()
