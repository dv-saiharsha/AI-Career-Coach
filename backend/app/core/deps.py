from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import verify_supabase_token

# HTTPBearer (not OAuth2PasswordBearer) since we only ever check for a
# Supabase-issued Bearer token now — this backend doesn't run a login flow.
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthenticatedUser:
    """Claims-based identity from a verified Supabase token — no local
    `users` table to query; Supabase's own auth.users is authoritative."""

    id: str
    email: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials:
        raise credentials_error
    try:
        claims = verify_supabase_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise credentials_error from exc

    user_id = claims.get("sub")
    email = claims.get("email")
    if not user_id:
        raise credentials_error
    return AuthenticatedUser(id=user_id, email=email or "")
