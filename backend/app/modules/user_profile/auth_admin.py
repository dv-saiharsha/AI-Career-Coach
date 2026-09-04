"""Removing the Supabase identity behind an account.

WHY THIS IS SEPARATE FROM privacy.py

privacy.py owns rows in this product's own database. The login itself lives
in Supabase, in a table this service does not and should not have a model
for, reachable only through Supabase's admin API with the service-role key.
Two different systems, two different failure modes, so two modules.

THE ORDER IS THE WHOLE DESIGN

Rows first, then the identity. Both orders can fail halfway and the two
halves are not equally bad:

  identity first, rows fail  -> the person can no longer authenticate, so
                                they can never retry, and nobody can reach
                                their remaining data on their behalf. It is
                                unrecoverable and silent.

  rows first, identity fails -> their data is gone and their login still
                                works. Recoverable: they can sign in and ask
                                again, and an operator can finish it.

The second is strictly better, so deletion runs in that order and the
endpoint reports honestly when the second half did not happen.

WHY A FAILURE HERE IS NOT AN EXCEPTION

Raising after the rows are already gone would tell the caller the request
failed, which is worse than a partial success reported as one — they would
reasonably conclude nothing had happened. The caller gets a flag instead and
decides what to say.
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Supabase's admin API. Deleting a user here revokes their refresh tokens, so
# the access token that authorised this very request stays valid only until
# it expires on its own — the session cannot be renewed.
_ADMIN_USERS_PATH = "/auth/v1/admin/users"
_TIMEOUT_SECONDS = 10.0


def can_delete_auth_user() -> bool:
    """Whether the service-role credentials needed for this are configured."""
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SECRET_API_KEY)


def delete_auth_user(user_id: str) -> bool:
    """Delete the Supabase identity. Returns whether it is now gone.

    Never raises. A caller reaching this point has already erased the user's
    data, and an exception at this stage would misreport that as a failed
    request.
    """
    if not can_delete_auth_user():
        # Local development and CI run without the service-role key. Say so
        # rather than pretending the identity was removed.
        logger.warning(
            "auth user %s not deleted: SUPABASE_URL/SUPABASE_SECRET_API_KEY not configured",
            user_id,
        )
        return False

    url = f"{settings.SUPABASE_URL.rstrip('/')}{_ADMIN_USERS_PATH}/{user_id}"
    headers = {
        "apikey": settings.SUPABASE_SECRET_API_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SECRET_API_KEY}",
    }

    try:
        response = httpx.delete(url, headers=headers, timeout=_TIMEOUT_SECONDS)
    except httpx.HTTPError:
        logger.exception("auth user %s could not be deleted: request failed", user_id)
        return False

    # 404 counts as success: the identity is not there, which is the state
    # this function exists to reach. Treating it as a failure would make a
    # retry after a partial deletion permanently report failure.
    if response.status_code == 404:
        logger.info("auth user %s was already absent", user_id)
        return True

    if response.status_code >= 400:
        # The body can contain Supabase's own error detail; the user id is
        # already in the message and nothing else about the person is logged.
        logger.error(
            "auth user %s could not be deleted: %s %s",
            user_id,
            response.status_code,
            response.text[:200],
        )
        return False

    return True
