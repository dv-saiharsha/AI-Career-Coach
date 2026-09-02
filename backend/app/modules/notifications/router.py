from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.notifications import service
from app.models.user_device import UserDevice
from app.schemas.notification import (
    DeviceSchema,
    NotificationListSchema,
    NotificationSchema,
    RegisterDeviceRequest,
)

router = APIRouter()


@router.get("", response_model=NotificationListSchema)
def list_notifications(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    notifications = service.list_notifications(db, current_user.id, include_archived=include_archived)
    return {
        "notifications": notifications,
        "unread_count": service.unread_count(db, current_user.id),
    }


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return {"unread_count": service.unread_count(db, current_user.id)}


@router.post("/{notification_id}/read", response_model=NotificationSchema)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    row = service.mark_read(db, current_user.id, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    return row


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    updated = service.mark_all_read(db, current_user.id)
    return {"updated": updated}


@router.post("/{notification_id}/archive", response_model=NotificationSchema)
def archive_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    row = service.archive(db, current_user.id, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    return row


# ── Devices ───────────────────────────────────────────────────────────────
#
# Mounted under the existing /api/notifications prefix rather than a new
# /api/v1 one: every other module in this app is /api/<module>, and a single
# versioned island would mean two conventions and a client that has to know
# which endpoints live where.


@router.post("/devices", response_model=DeviceSchema, status_code=201)
def register_device(
    payload: RegisterDeviceRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Register this install's push token, or move it to the current user.

    The token is the natural key. When one that already exists arrives under a
    different user the row is reassigned rather than duplicated — a phone
    that changes hands, or a shared device where someone else signs in, must
    stop delivering the previous user's notifications. Duplicating instead
    would send every notification twice and leak one user's activity to
    another.
    """
    token = payload.expo_push_token.strip()

    # Expo's own format. Checked because a token from the wrong SDK, or a
    # placeholder string from a misconfigured build, otherwise sits in the
    # table silently failing every send.
    if not (token.startswith("ExponentPushToken[") and token.endswith("]")):
        raise HTTPException(
            status_code=400,
            detail="That does not look like an Expo push token.",
        )

    device = db.query(UserDevice).filter(UserDevice.expo_push_token == token).first()

    if device:
        device.user_id = current_user.id
        device.platform = payload.platform
    else:
        device = UserDevice(
            user_id=current_user.id, expo_push_token=token, platform=payload.platform
        )
        db.add(device)

    db.commit()
    db.refresh(device)
    return device


@router.delete("/devices/{token}", status_code=204)
def unregister_device(
    token: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Drop this install's token on sign-out.

    Scoped to the caller: a token can only be removed by the user it is
    currently registered to, so knowing someone else's token is not enough to
    silence their notifications.

    Returns 204 whether or not a row existed. Sign-out is not a place to fail
    — a client retrying a delete for a token already gone should see success,
    not a 404 it has to special-case.
    """
    db.query(UserDevice).filter(
        UserDevice.expo_push_token == token,
        UserDevice.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
