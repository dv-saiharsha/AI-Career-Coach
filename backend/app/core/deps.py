import logging
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import AuthUnavailable, TokenRejected, verify_firebase_token

# HTTPBearer (not OAuth2PasswordBearer) since we only ever check for a
# Firebase-issued Bearer token — this backend doesn't run a login flow.
bearer_scheme = HTTPBearer(auto_error=False)


logger = logging.getLogger(__name__)

# User ids whose profile row this process has already ensured, so the common
# case costs a set lookup rather than a query on every request. Per process,
# not shared: a second process simply does one extra INSERT ... ON CONFLICT DO
# NOTHING the first time it sees the user. Bounded so an ever-growing user base
# cannot grow it without limit; clearing it only costs those extra no-ops.
_profile_ensured: set[str] = set()
_PROFILE_ENSURED_MAX = 50_000


def forget_profile_cache(user_id: str) -> None:
    """Make the next request from this user ensure their profile again.

    Called when an account is erased, so a stale entry cannot make this process
    believe a row exists that no longer does.
    """
    _profile_ensured.discard(user_id)


def _ensure_profile_once(db: Session, user_id: str, avatar_url: str | None = None) -> None:
    """Create the user's profile row the first time they are seen authenticated.

    The signup trigger that used to do this ran inside Supabase and is gone
    with it. Never raises: the profile is a convenience the read paths also
    guarantee (services.get_or_create_profile), and a database hiccup here must
    not turn a valid login into a 401/500.
    """
    if user_id in _profile_ensured:
        return
    try:
        from app.modules.user_profile.services import ensure_profile

        ensure_profile(db, user_id, avatar_url=avatar_url)
    except Exception:
        db.rollback()
        logger.warning("could not ensure profile for user %s", user_id, exc_info=True)
        return
    if len(_profile_ensured) >= _PROFILE_ENSURED_MAX:
        _profile_ensured.clear()
    _profile_ensured.add(user_id)


@dataclass
class AuthenticatedUser:
    """Claims-based identity from a verified Firebase token — no local
    `users` table to query; Firebase Authentication is authoritative.

    Only get_current_user constructs one for a real request, and it refuses
    unverified email addresses first, so holding an AuthenticatedUser means the
    address is verified."""

    id: str
    email: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials:
        raise credentials_error
    try:
        claims = verify_firebase_token(credentials.credentials)
    except TokenRejected as exc:
        raise credentials_error from exc
    except AuthUnavailable as exc:
        # Not "your token is bad": Firebase or Google could not be reached, so
        # the honest answer is a temporary failure, and clients must not treat
        # it as a reason to sign the person out.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is temporarily unavailable",
        ) from exc

    user_id = claims.get("sub")
    if not user_id:
        raise credentials_error
    if not claims.get("email_verified"):
        # Supabase refused to sign in an unconfirmed address; Firebase does not,
        # so the backend holds that line. Distinct from a 401 so a client can
        # show "verify your email" instead of treating the session as broken.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="email_not_verified")
    _ensure_profile_once(db, user_id, avatar_url=claims.get("picture"))
    return AuthenticatedUser(id=user_id, email=claims.get("email") or "")


def get_current_admin(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """Gates the admin crawl API (job_market/admin_router.py) against
    ADMIN_EMAILS, a comma-separated env allowlist — same pattern as
    ALLOWED_ORIGINS. There is no is_admin column anywhere in this backend;
    this is deliberately the same config-driven shape rather than a new one,
    and an empty ADMIN_EMAILS means nobody can reach it, which is the
    correct default until an operator sets one.
    """
    if current_user.email.strip().lower() not in settings.admin_emails_list:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
