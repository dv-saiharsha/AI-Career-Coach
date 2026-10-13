"""Profile photos in a private Cloud Storage bucket.

HOW A PHOTO GETS FROM A BROWSER TO THE BUCKET

  1. POST /user/avatar/upload-url  -> a signed POST policy for exactly one object,
     avatars/<uid>/<random>.<ext>, that only accepts one content type and at most
     AVATAR_MAX_BYTES. The browser posts the file straight to Cloud Storage; the file
     never passes through this API.
  2. POST /user/avatar/confirm     -> the API looks at the object that actually landed
     (it belongs to the caller, has an allowed type and size), records its path on the
     profile, and deletes the caller's older photos.
  3. Reads: the bucket is private, so the profile carries a short-lived signed URL,
     generated on demand and cached in this process for most of its lifetime.

WHY THE BROWSER IS NOT TRUSTED

The policy limits what Cloud Storage accepts, but the confirm step re-checks the
stored object anyway and removes it if it does not pass, and only this module writes
profiles.avatar_path. The PATCH /user/profile endpoint ignores that field: if it did,
anyone could point it at another person's object and be handed a signed link to it.

HOW URLS ARE SIGNED

A runtime account has no private key to sign with. google-cloud-storage instead asks
the IAM Credentials signBlob API to sign on behalf of AVATAR_SIGNER_SERVICE_ACCOUNT,
using an access token for that account. On Cloud Run the process already runs as it.
On a developer's machine AVATAR_IMPERSONATE_SIGNER makes this module impersonate it
(the developer's own login cannot sign).
"""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from datetime import timedelta
from typing import Any

import google.auth
import google.auth.transport.requests
from google.auth import impersonated_credentials
from google.cloud import storage

from app.core.config import settings

logger = logging.getLogger(__name__)

# Content type -> the only extension that may accompany it.
ALLOWED_TYPES: dict[str, str] = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

UPLOAD_TTL = timedelta(minutes=10)
READ_TTL = timedelta(hours=1)
# A cached read URL is dropped before it expires, so nobody is handed one that is
# about to stop working.
READ_CACHE_SECONDS = 50 * 60

_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
# A path segment built from a user id must not be able to escape its own folder.
_SAFE_UID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class AvatarRejected(Exception):
    """The request or the uploaded object is not acceptable (the caller answers 4xx)."""


class AvatarUnavailable(Exception):
    """Cloud Storage or its signing could not be reached or is not configured (503)."""


_lock = threading.Lock()
_credentials_obj: Any = None
_client_obj: storage.Client | None = None
_read_cache: dict[str, tuple[float, str]] = {}


def is_configured() -> bool:
    return bool(settings.AVATAR_BUCKET and settings.AVATAR_SIGNER_SERVICE_ACCOUNT)


def _credentials() -> Any:
    """Credentials whose access token can be used to sign as the signer account."""
    global _credentials_obj
    with _lock:
        if _credentials_obj is None:
            base, _ = google.auth.default(scopes=[_SCOPE])
            if settings.AVATAR_IMPERSONATE_SIGNER:
                base = impersonated_credentials.Credentials(
                    source_credentials=base,
                    target_principal=settings.AVATAR_SIGNER_SERVICE_ACCOUNT,
                    target_scopes=[_SCOPE],
                    lifetime=3600,
                )
            _credentials_obj = base
        if not _credentials_obj.valid:
            _credentials_obj.refresh(google.auth.transport.requests.Request())
        return _credentials_obj


def _client() -> storage.Client:
    global _client_obj
    credentials = _credentials()
    with _lock:
        if _client_obj is None:
            _client_obj = storage.Client(
                project=settings.FIREBASE_PROJECT_ID or None, credentials=credentials
            )
        return _client_obj


def _require_configured() -> None:
    if not is_configured():
        raise AvatarUnavailable("Profile photos are not configured.")


def _folder(user_id: str) -> str:
    if not _SAFE_UID.match(user_id):
        raise AvatarRejected("This account cannot have a profile photo.")
    return f"avatars/{user_id}/"


def create_upload(user_id: str, content_type: str) -> dict[str, Any]:
    """A signed POST policy the browser can use to upload one photo directly."""
    _require_configured()
    if content_type not in ALLOWED_TYPES:
        raise AvatarRejected("Choose a JPEG, PNG or WebP image.")
    path = f"{_folder(user_id)}{uuid.uuid4().hex}.{ALLOWED_TYPES[content_type]}"
    try:
        credentials = _credentials()
        policy = _client().generate_signed_post_policy_v4(
            settings.AVATAR_BUCKET,
            path,
            expiration=UPLOAD_TTL,
            # A fresh list each call: the library appends to it.
            conditions=[["content-length-range", 1, settings.AVATAR_MAX_BYTES]],
            fields={"Content-Type": content_type},
            service_account_email=settings.AVATAR_SIGNER_SERVICE_ACCOUNT,
            access_token=credentials.token,
        )
    except AvatarRejected:
        raise
    except Exception as exc:
        logger.warning("could not sign an avatar upload", exc_info=True)
        raise AvatarUnavailable("Could not prepare the upload.") from exc
    return {
        "url": policy["url"],
        "fields": policy["fields"],
        "path": path,
        "max_bytes": settings.AVATAR_MAX_BYTES,
        "expires_in": int(UPLOAD_TTL.total_seconds()),
    }


def confirm_upload(user_id: str, path: str) -> None:
    """Check the object that actually landed; remove it if it is not acceptable."""
    _require_configured()
    folder = _folder(user_id)
    # Exactly one level under the caller's own folder, nothing that climbs out of it.
    if not path.startswith(folder) or "/" in path[len(folder):] or ".." in path:
        raise AvatarRejected("That upload does not belong to this account.")
    try:
        bucket = _client().bucket(settings.AVATAR_BUCKET)
        blob = bucket.get_blob(path)
    except Exception as exc:
        logger.warning("could not look up an uploaded avatar", exc_info=True)
        raise AvatarUnavailable("Could not check the upload.") from exc
    if blob is None:
        raise AvatarRejected("The upload was not found. Please try again.")

    extension = path.rsplit(".", 1)[-1]
    valid = (
        blob.content_type in ALLOWED_TYPES
        and ALLOWED_TYPES[blob.content_type] == extension
        and blob.size is not None
        and 0 < blob.size <= settings.AVATAR_MAX_BYTES
    )
    if not valid:
        # Whatever got through the policy, it is not a photo we accept: do not keep it.
        try:
            blob.delete()
        except Exception:
            logger.warning("could not remove a rejected avatar upload", exc_info=True)
        raise AvatarRejected("That file is not an acceptable photo.")


def purge(user_id: str, keep: str | None = None) -> bool:
    """Delete every photo this user has except `keep`. Returns whether it all worked.

    Best effort: used to tidy up after a replacement and to erase an account, where a
    storage hiccup must be reported but must not undo anything already done.
    """
    if not is_configured():
        return True
    try:
        folder = _folder(user_id)
        ok = True
        for blob in _client().list_blobs(settings.AVATAR_BUCKET, prefix=folder):
            if blob.name == keep:
                continue
            try:
                blob.delete()
            except Exception:
                ok = False
                logger.warning("could not delete an avatar object", exc_info=True)
        _forget_reads(user_id)
        return ok
    except Exception:
        logger.warning("could not list avatar objects for deletion", exc_info=True)
        return False


def _forget_reads(user_id: str) -> None:
    prefix = f"avatars/{user_id}/"
    with _lock:
        for path in [p for p in _read_cache if p.startswith(prefix)]:
            del _read_cache[path]


def read_url(path: str) -> str:
    """A short-lived signed URL for one stored photo, cached for most of its life."""
    _require_configured()
    now = time.time()
    with _lock:
        hit = _read_cache.get(path)
        if hit and hit[0] > now:
            return hit[1]
    try:
        credentials = _credentials()
        url = (
            _client()
            .bucket(settings.AVATAR_BUCKET)
            .blob(path)
            .generate_signed_url(
                version="v4",
                expiration=READ_TTL,
                method="GET",
                service_account_email=settings.AVATAR_SIGNER_SERVICE_ACCOUNT,
                access_token=credentials.token,
            )
        )
    except Exception as exc:
        logger.warning("could not sign an avatar read URL", exc_info=True)
        raise AvatarUnavailable("Could not load the photo.") from exc
    with _lock:
        _read_cache[path] = (now + READ_CACHE_SECONDS, url)
    return url


def display_url(avatar_path: str | None, fallback_url: str | None) -> str | None:
    """What the profile should show: the stored photo if there is one, else the provider's.

    Never raises: a storage problem costs the photo, not the whole profile.
    """
    if avatar_path and is_configured():
        try:
            return read_url(avatar_path)
        except AvatarUnavailable:
            return fallback_url
    return fallback_url
