from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.applications import services
from app.schemas.application import (
    ApplicationCreateSchema,
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


@router.patch("/{application_id}", response_model=ApplicationSchema)
def update_application(
    application_id: int,
    payload: ApplicationUpdateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    # exclude_unset, not exclude_none: it distinguishes "field omitted" from
    # "field explicitly set to null", so clearing notes to null still works
    # while a status-only patch leaves notes untouched.
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    record = services.update_application(db, current_user.id, application_id, updates)
    if not record:
        raise HTTPException(status_code=404, detail="Application not found")
    return record


@router.patch("/{application_id}/status", response_model=ApplicationSchema)
def update_status(
    application_id: int,
    payload: ApplicationStatusUpdateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Dedicated route for the board's most common action — moving a card."""
    record = services.update_application(
        db, current_user.id, application_id, {"status": payload.status}
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
