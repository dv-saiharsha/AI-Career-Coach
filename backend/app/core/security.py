import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError

from app.core.config import settings

# Supabase now recommends asymmetric signing keys (JWKS) over the legacy
# shared HS256 secret (see Settings -> JWT in the Supabase dashboard — new
# projects default to signing keys; older projects may still be on the
# legacy secret only, which has no usable JWKS entry). We try JWKS first
# and fall back to the shared secret so this works either way without
# needing to know in advance which mode a given project is in.
_EXPECTED_AUDIENCE = "authenticated"
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def verify_supabase_token(token: str) -> dict:
    """Validates a Supabase-issued access token and returns its claims
    (sub = user UUID, email, ...). Raises jwt.PyJWTError subclasses on
    failure — PyJWKClientError (no matching/reachable JWKS key) included."""
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=["RS256", "ES256"], audience=_EXPECTED_AUDIENCE)
    except PyJWKClientError:
        if not settings.SUPABASE_JWT_SECRET:
            raise
        return jwt.decode(token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"], audience=_EXPECTED_AUDIENCE)
