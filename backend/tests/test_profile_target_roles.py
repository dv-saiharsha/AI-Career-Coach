"""Editing the roles that drive the job feed, after onboarding.

target_roles was writable only through /onboarding, so a user's interests were
fixed in the first ninety seconds of their account's life. The feed kept
serving whatever they picked then, and someone moving from backend to ML had
no route back short of a database edit.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.profile import Profile
from app.modules.user_profile import services

ALICE = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add(
        Profile(
            user_id=ALICE,
            onboarding_completed=True,
            target_roles=json.dumps(["Backend Engineer", "Platform Engineer", "SRE"]),
            bio="Original bio",
        )
    )
    session.commit()
    yield session
    session.close()


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=ALICE, email="a@x.com"
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_roles_can_be_changed_after_onboarding(client, db_session):
    response = client.patch(
        "/api/user/profile",
        json={"target_roles": ["ML Engineer", "Research Engineer", "Applied Scientist"]},
    )
    assert response.status_code == 200, response.text

    profile = db_session.query(Profile).filter(Profile.user_id == ALICE).one()
    assert services.read_target_roles(profile) == [
        "ML Engineer",
        "Research Engineer",
        "Applied Scientist",
    ]


def test_stored_as_real_json_not_a_python_repr(client, db_session):
    """The column is JSON-encoded Text, and update_profile setattrs raw values.

    A list passed straight through stores "['ML Engineer']" with single
    quotes, which read_target_roles cannot decode — leaving the user with an
    empty job feed and no error raised anywhere to explain it.
    """
    client.patch(
        "/api/user/profile",
        json={"target_roles": ["ML Engineer", "Research Engineer", "Applied Scientist"]},
    )
    profile = db_session.query(Profile).filter(Profile.user_id == ALICE).one()

    assert json.loads(profile.target_roles) == [
        "ML Engineer",
        "Research Engineer",
        "Applied Scientist",
    ]


def test_a_patch_that_omits_roles_leaves_them_alone(client, db_session):
    """PATCH semantics. Editing a bio must not wipe the job feed."""
    before = services.read_target_roles(
        db_session.query(Profile).filter(Profile.user_id == ALICE).one()
    )

    response = client.patch("/api/user/profile", json={"bio": "Updated bio"})
    assert response.status_code == 200

    profile = db_session.query(Profile).filter(Profile.user_id == ALICE).one()
    assert services.read_target_roles(profile) == before
    assert profile.bio == "Updated bio"


def test_duplicates_are_collapsed_before_the_minimum_is_checked(client):
    """Otherwise ["Backend", "backend", "BACKEND"] passes a three-role
    minimum while describing one interest."""
    response = client.patch(
        "/api/user/profile",
        json={"target_roles": ["Backend Engineer", "backend engineer", "BACKEND ENGINEER"]},
    )
    assert response.status_code == 422


def test_too_few_roles_is_rejected_with_a_reason(client):
    response = client.patch("/api/user/profile", json={"target_roles": ["Only One"]})
    assert response.status_code == 422


def test_whitespace_is_trimmed(client, db_session):
    client.patch(
        "/api/user/profile",
        json={"target_roles": ["  ML Engineer  ", "Research Engineer", "Applied Scientist"]},
    )
    profile = db_session.query(Profile).filter(Profile.user_id == ALICE).one()
    assert services.read_target_roles(profile)[0] == "ML Engineer"
