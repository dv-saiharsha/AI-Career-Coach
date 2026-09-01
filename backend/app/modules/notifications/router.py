from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.notifications import service
from app.schemas.notification import NotificationListSchema, NotificationSchema

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
