"""Verifying Firebase ID tokens.

WHAT IS CHECKED, AND WHY check_revoked IS ON

firebase_admin's verify_id_token checks signature, expiry and audience locally
and, by default, nothing else: a token is a stateless JWT, so a user who has
been deleted or disabled keeps a perfectly valid token until it expires an
hour later. For an account-erasure feature that is not acceptable, so every
verification here asks Firebase's backend as well (check_revoked=True). Read
from the installed SDK's source, that check calls get_user(uid), which means:

  * a revoked token                -> RevokedIdTokenError   (an InvalidIdTokenError)
  * a DISABLED user                -> UserDisabledError     (NOT an InvalidIdTokenError)
  * a DELETED user                 -> UserNotFoundError     (NOT an InvalidIdTokenError)
  * Google's keys unreachable      -> CertificateFetchError (an outage, not a bad token)

Catching only the "invalid token" family would let a deleted user's token raise
an unhandled error, so each case is mapped explicitly: the first three reject
the request (401), an outage is reported as 503 so a Google or network blip
does not sign everybody out.

COST, AND THE CACHE

check_revoked costs an extra round trip to Firebase on every verification. A
successful check is therefore remembered for CACHE_SECONDS (and never past the
token's own expiry). The price is that a user deleted or disabled elsewhere
stays accepted for up to that long; erasure through this application closes
the gap immediately with forget_user / block_user below.

BLOCKING IS PER PROCESS, ON PURPOSE

block_user is an in-memory set. It exists for one window: after an account's
rows are erased and before Firebase has deleted the login, a request already in
flight would otherwise pass authentication and quietly recreate rows for a
person who has just been erased. The deployment runs a single API instance, so
a per-process set covers it exactly. Past one instance, Firebase's own deletion
(and check_revoked) is the shared truth and this set only narrows the window
within each instance.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time

import firebase_admin
from firebase_admin import auth as firebase_auth

from app.core.config import settings

logger = logging.getLogger(__name__)

CACHE_SECONDS = 60
_CACHE_MAX = 10_000


class TokenRejected(Exception):
    """The token is not acceptable: malformed, expired, revoked, or its user is
    deleted or disabled. The caller answers 401."""


class AuthUnavailable(Exception):
    """Verification could not be completed (Google's keys or Firebase's backend
    unreachable, or the service is not configured). The caller answers 503."""


_app: firebase_admin.App | None = None
_app_lock = threading.Lock()
_cache: dict[str, tuple[float, str, dict]] = {}  # token digest -> (valid until, uid, claims)
_blocked: set[str] = set()
_state_lock = threading.Lock()


def _firebase_app() -> firebase_admin.App:
    """The SDK app, created on first use so importing this module needs no credentials."""
    global _app
    if _app is None:
        with _app_lock:
            if _app is None:
                if not settings.FIREBASE_PROJECT_ID:
                    raise AuthUnavailable("FIREBASE_PROJECT_ID is not configured")
                _app = firebase_admin.initialize_app(
                    options={"projectId": settings.FIREBASE_PROJECT_ID}, name="applycenter"
                )
    return _app


def firebase_app() -> firebase_admin.App:
    """For callers that talk to Firebase directly (auth_admin)."""
    return _firebase_app()


def _normalise(decoded: dict) -> dict:
    """The few claims the application uses, under stable names."""
    return {
        "sub": decoded["uid"],
        "email": decoded.get("email"),
        "email_verified": bool(decoded.get("email_verified")),
        "name": decoded.get("name"),
        "picture": decoded.get("picture"),
        "sign_in_provider": (decoded.get("firebase") or {}).get("sign_in_provider"),
    }


def verify_firebase_token(token: str) -> dict:
    """Validate a Firebase ID token and return its normalised claims.

    Raises TokenRejected (-> 401) or AuthUnavailable (-> 503); never anything else.
    """
    digest = hashlib.sha256(token.encode()).hexdigest()
    now = time.time()
    with _state_lock:
        hit = _cache.get(digest)
        if hit and hit[0] > now:
            if hit[1] in _blocked:
                raise TokenRejected("user is blocked")
            return hit[2]

    try:
        decoded = firebase_auth.verify_id_token(token, app=_firebase_app(), check_revoked=True)
    except AuthUnavailable:
        raise
    except (
        firebase_auth.InvalidIdTokenError,  # includes ExpiredIdTokenError and RevokedIdTokenError
        firebase_auth.UserDisabledError,
        firebase_auth.UserNotFoundError,
        ValueError,  # the SDK's answer to an empty or non-string token
    ) as exc:
        raise TokenRejected(type(exc).__name__) from exc
    except firebase_auth.CertificateFetchError as exc:
        logger.warning("could not fetch Google's signing keys: %s", exc)
        raise AuthUnavailable("could not fetch signing keys") from exc
    except Exception as exc:  # any other SDK or network failure: fail closed, but as an outage
        logger.warning("token verification could not complete", exc_info=True)
        raise AuthUnavailable(type(exc).__name__) from exc

    claims = _normalise(decoded)
    with _state_lock:
        if claims["sub"] in _blocked:
            raise TokenRejected("user is blocked")
        if len(_cache) >= _CACHE_MAX:
            _cache.clear()
        valid_until = min(now + CACHE_SECONDS, float(decoded.get("exp", now)))
        _cache[digest] = (valid_until, claims["sub"], claims)
    return claims


def forget_user(uid: str) -> None:
    """Drop every cached verification for this user."""
    with _state_lock:
        for digest in [d for d, (_, u, _c) in _cache.items() if u == uid]:
            del _cache[digest]


def block_user(uid: str) -> None:
    """Refuse this user's tokens in this process, starting now."""
    # Deliberately unbounded: clearing the set would silently un-block erased
    # users, and an erasure is a rare event that costs one short string here.
    with _state_lock:
        _blocked.add(uid)
    forget_user(uid)


def unblock_user(uid: str) -> None:
    with _state_lock:
        _blocked.discard(uid)


def is_blocked(uid: str) -> bool:
    with _state_lock:
        return uid in _blocked
