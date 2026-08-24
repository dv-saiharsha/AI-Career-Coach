"""Offer persistence and total-compensation arithmetic.

Every function takes `user_id` and filters on it. That id always comes from a
verified Supabase JWT, never from a request body.

Totals are computed in Decimal and converted to float only at the response
boundary. Summing four money values as binary floats accumulates
representation error, and these totals are the numbers a candidate compares
competing offers on.
"""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.orm import Session

from app.models.offer import JobOffer


CENTS = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(str(value or 0))


def _round_cents(value: Decimal) -> Decimal:
    """ROUND_HALF_UP, not Python's default banker's rounding.

    Decimal defaults to ROUND_HALF_EVEN, which sends 0.125 to 0.12. Money is
    conventionally rounded half away from zero, and a comparison the user
    checks by hand should agree with what they get on a calculator.
    """
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def compute_net_adjusted(
    recurring: Decimal,
    tax_rate: Decimal | None,
    col_index: Decimal | None,
) -> tuple[Decimal, bool]:
    """Net recurring comp after the user's own tax rate and COL index.

        net = recurring x (1 - tax_rate) / col_index

    Both inputs are user-supplied and optional. Returns (value, is_adjusted);
    is_adjusted is False when neither was given, so the UI can say plainly
    that no adjustment was applied rather than implying the raw number was
    somehow verified.

    A tax_rate of exactly 0 still counts as adjusted — a user in a
    no-income-tax state entered that deliberately, and reporting it as
    "unadjusted" would discard a real answer.
    """
    adjusted = recurring
    is_adjusted = False

    if tax_rate is not None:
        adjusted = adjusted * (Decimal("1") - tax_rate)
        is_adjusted = True

    # Guard against divide-by-zero and nonsense indices: a col_index of 0 or
    # below has no meaning, so it's ignored rather than blowing up the request.
    if col_index is not None and col_index > 0:
        if col_index != Decimal("1"):
            is_adjusted = True
        adjusted = adjusted / col_index

    return _round_cents(adjusted), is_adjusted


def _serialize(record: JobOffer) -> dict:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    base = _money(record.base_salary)
    annual_bonus = _money(record.annual_bonus)
    signing_bonus = _money(record.signing_bonus)
    equity = _money(record.equity_value_annual)

    # Signing bonus lands in year one only. Kept out of `recurring_annual` so
    # a large one-off payment can't make a structurally weaker offer look
    # stronger than it is from year two onward.
    recurring = base + annual_bonus + equity
    first_year = recurring + signing_bonus

    tax_rate = Decimal(str(record.estimated_tax_rate)) if record.estimated_tax_rate is not None else None
    col_index = Decimal(str(record.col_index)) if record.col_index is not None else None
    net_adjusted, is_adjusted = compute_net_adjusted(recurring, tax_rate, col_index)

    return {
        "id": record.id,
        "company": record.company,
        "role_title": record.role_title,
        "application_id": record.application_id,
        "base_salary": float(base),
        "annual_bonus": float(annual_bonus),
        "signing_bonus": float(signing_bonus),
        "equity_value_annual": float(equity),
        "location": record.location,
        "is_remote": record.is_remote,
        "notes": record.notes,
        "total_first_year": float(_round_cents(first_year)),
        "recurring_annual": float(_round_cents(recurring)),
        "estimated_tax_rate": float(tax_rate) if tax_rate is not None else None,
        "col_index": float(col_index) if col_index is not None else None,
        "net_adjusted_comp": float(net_adjusted),
        # False means no adjustment was applied at all — the UI says so
        # explicitly rather than presenting the raw figure as "net".
        "is_adjusted": is_adjusted,
        "created_at": iso(record.created_at),
        "updated_at": iso(record.updated_at),
    }


def list_offers(db: Session, user_id: str) -> dict:
    records = (
        db.query(JobOffer)
        .filter(JobOffer.user_id == user_id)
        .order_by(JobOffer.created_at.desc().nullslast(), JobOffer.id.desc())
        .all()
    )
    return {"offers": [_serialize(r) for r in records], "count": len(records)}


def create_offer(db: Session, user_id: str, payload: dict) -> dict:
    record = JobOffer(user_id=user_id, **payload)
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize(record)


def _owned(db: Session, user_id: str, offer_id: int) -> JobOffer | None:
    """Ownership is part of the lookup, so a wrong user gets an
    indistinguishable 404 rather than a 403 confirming the row exists."""
    return (
        db.query(JobOffer)
        .filter(JobOffer.id == offer_id, JobOffer.user_id == user_id)
        .first()
    )


def update_offer(db: Session, user_id: str, offer_id: int, payload: dict) -> dict | None:
    record = _owned(db, user_id, offer_id)
    if not record:
        return None
    for field, value in payload.items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    return _serialize(record)


def delete_offer(db: Session, user_id: str, offer_id: int) -> bool:
    record = _owned(db, user_id, offer_id)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True
