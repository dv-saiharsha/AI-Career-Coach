from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.applications import services
from app.schemas.application import (
    ActivityItemSchema,
    ApplicationCreateSchema,
    ApplicationDetailSchema,
    ApplicationSchema,
    ApplicationStatusUpdateSchema,
    ApplicationUpdateSchema,
    PipelineSchema,
)

router = APIRouter()


@router.get("/pipeline", response_model=PipelineSchema)
def get_pipeline(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return services.get_pipeline(db, current_user.id)


@router.get("/activity", response_model=list[ActivityItemSchema])
def get_activity(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Powers the Timeline view — every status change across the whole
    pipeline, newest first. Declared ahead of /{application_id} so "activity"
    is never swallowed as an id."""
    return services.get_activity_feed(db, current_user.id)


@router.post("", response_model=ApplicationSchema, status_code=201)
def create_application(
    payload: ApplicationCreateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    # user_id comes from the verified token, never the payload — the schema
    # has no user_id field at all, so a caller cannot file an application
    # against someone else's account.
    return services.create_application(db, current_user.id, payload.model_dump())


@router.get("/{application_id}", response_model=ApplicationDetailSchema)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """The detail drawer's one request: status history plus whatever the
    Resume, Job Matching, and Interview engines already know that's
    relevant to this application — see services.get_application_detail."""
    detail = services.get_application_detail(db, current_user.id, application_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Application not found")
    return detail


@router.patch("/{application_id}", response_model=ApplicationSchema)
def update_application(
    application_id: int,
    payload: ApplicationUpdateSchema,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    # exclude_unset, not exclude_none: it distinguishes "field omitted" from
    # "field explicitly set to null", so clearing notes to null still works
    # while a status-only patch leaves notes untouched.
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    record = services.update_application(db, current_user.id, application_id, updates, background_tasks)
    if not record:
        raise HTTPException(status_code=404, detail="Application not found")
    return record


@router.patch("/{application_id}/status", response_model=ApplicationSchema)
def update_status(
    application_id: int,
    payload: ApplicationStatusUpdateSchema,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Dedicated route for the board's most common action — moving a card."""
    record = services.update_application(
        db, current_user.id, application_id, {"status": payload.status}, background_tasks
    )
    if not record:
        raise HTTPException(status_code=404, detail="Application not found")
    return record


@router.delete("/{application_id}", status_code=204)
def delete_application(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    if not services.delete_application(db, current_user.id, application_id):
        raise HTTPException(status_code=404, detail="Application not found")
