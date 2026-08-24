from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.offers import services
from app.schemas.offer import (
    OfferCreateSchema,
    OfferListSchema,
    OfferSchema,
    OfferUpdateSchema,
)

router = APIRouter()


@router.get("", response_model=OfferListSchema)
def list_offers(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return services.list_offers(db, current_user.id)


@router.post("", response_model=OfferSchema, status_code=201)
def create_offer(
    payload: OfferCreateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    # user_id comes from the verified token; the schema has no such field, so
    # a caller cannot file an offer against another account.
    return services.create_offer(db, current_user.id, payload.model_dump())


@router.patch("/{offer_id}", response_model=OfferSchema)
def update_offer(
    offer_id: int,
    payload: OfferUpdateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    # exclude_unset distinguishes "omitted" from "explicitly null", so a
    # notes-only patch can't zero out the salary fields.
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    record = services.update_offer(db, current_user.id, offer_id, updates)
    if not record:
        raise HTTPException(status_code=404, detail="Offer not found")
    return record


@router.delete("/{offer_id}", status_code=204)
def delete_offer(
    offer_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    if not services.delete_offer(db, current_user.id, offer_id):
        raise HTTPException(status_code=404, detail="Offer not found")
