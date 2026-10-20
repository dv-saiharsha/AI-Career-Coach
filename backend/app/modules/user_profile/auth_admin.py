"""Removing the Firebase identity behind an account.

WHY THIS IS SEPARATE FROM privacy.py

privacy.py owns rows in this product's own database. The login itself lives in
Firebase Authentication, reachable only through its Admin API with the service
account's credentials. Two different systems, two different failure modes, so
two modules.

THE ORDER IS THE WHOLE DESIGN

Rows first, then the identity. Both orders can fail halfway and the two halves
are not equally bad:

  identity first, rows fail  -> the person can no longer authenticate, so they
                                can never retry, and nobody can reach their
                                remaining data on their behalf. It is
                                unrecoverable and silent.

  rows first, identity fails -> their data is gone and their login still works.
                                Recoverable: they can sign in and ask again, and
                                an operator can finish it.

The second is strictly better, so deletion runs in that order and the endpoint
reports honestly when the second half did not happen.

THE GAP BETWEEN THE TWO HALVES

Between "rows erased" and "identity deleted" the person's token is still valid.
A request already in flight (another tab polling, a mobile app resuming) would
pass authentication and quietly recreate a profile or notifications for someone
who has just been erased. The caller therefore blocks the user in this process
(core/security.block_user) BEFORE erasing anything, and unblocks only if the
erasure itself fails so they can retry.

WHY A FAILURE HERE IS NOT AN EXCEPTION

Raising after the rows are already gone would tell the caller the request
failed, which is worse than a partial success reported as one: they would
reasonably conclude nothing had happened. The caller gets a flag instead and
decides what to say.
"""

from __future__ import annotations

import logging

from firebase_admin import auth as firebase_auth

from app.core import security
from app.core.config import settings

logger = logging.getLogger(__name__)


def can_delete_auth_user() -> bool:
    """Whether Firebase is configured at all. Credentials are resolved when used."""
    return bool(settings.FIREBASE_PROJECT_ID)


def delete_auth_user(user_id: str) -> bool:
    """Delete the Firebase user. Returns whether it is now gone.

    Never raises. A caller reaching this point has already erased the user's
    data, and an exception at this stage would misreport that as a failed
    request. A user who does not exist counts as deleted: that is the state the
    caller wants, whoever got it there.
    """
    if not can_delete_auth_user():
        # Local development and CI run without a Firebase project. Say so
        # rather than pretending the identity was removed.
        logger.warning("auth user %s not deleted: FIREBASE_PROJECT_ID not configured", user_id)
        return False

    try:
        firebase_auth.delete_user(user_id, app=security.firebase_app())
        return True
    except firebase_auth.UserNotFoundError:
        return True
    except Exception:
        logger.error("could not delete auth user %s", user_id, exc_info=True)
        return False
