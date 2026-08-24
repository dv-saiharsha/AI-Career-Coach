from typing import List, Optional

from pydantic import BaseModel, Field


class OfferCreateSchema(BaseModel):
    company: str = Field(min_length=1)
    role_title: str = Field(min_length=1)
    application_id: Optional[int] = None
    # ge=0 across the board: a negative salary or bonus is not a real offer,
    # and letting one through would silently drag a comparison total down.
    base_salary: float = Field(ge=0)
    annual_bonus: float = Field(default=0.0, ge=0)
    signing_bonus: float = Field(default=0.0, ge=0)
    equity_value_annual: float = Field(default=0.0, ge=0)
    location: Optional[str] = None
    is_remote: bool = False
    notes: Optional[str] = None
    # Effective combined rate as a fraction: 0.22 = 22%. Optional and never
    # inferred — None means "not supplied", which stays distinct from 0.0
    # ("no state income tax"), a real answer the user may deliberately enter.
    # le=1 because a rate above 100% would produce negative take-home.
    estimated_tax_rate: Optional[float] = Field(default=None, ge=0, le=1)
    # Relative cost of living: 1.15 = 15% more expensive. gt=0 rules out a
    # divide-by-zero at the schema boundary rather than in the arithmetic.
    col_index: Optional[float] = Field(default=None, gt=0)


class OfferUpdateSchema(BaseModel):
    """Partial. Omitted keys are left untouched server-side."""

    company: Optional[str] = None
    role_title: Optional[str] = None
    application_id: Optional[int] = None
    base_salary: Optional[float] = Field(default=None, ge=0)
    annual_bonus: Optional[float] = Field(default=None, ge=0)
    signing_bonus: Optional[float] = Field(default=None, ge=0)
    equity_value_annual: Optional[float] = Field(default=None, ge=0)
    location: Optional[str] = None
    is_remote: Optional[bool] = None
    notes: Optional[str] = None
    estimated_tax_rate: Optional[float] = Field(default=None, ge=0, le=1)
    col_index: Optional[float] = Field(default=None, gt=0)


class OfferSchema(BaseModel):
    id: int
    company: str
    role_title: str
    application_id: Optional[int] = None
    base_salary: float
    annual_bonus: float
    signing_bonus: float
    equity_value_annual: float
    location: Optional[str] = None
    is_remote: bool
    notes: Optional[str] = None

    # Computed server-side so every client shows the same arithmetic.
    #
    # first_year includes the signing bonus; recurring does not. Keeping them
    # apart is the point of the feature: a large signing bonus can make a
    # weaker offer look stronger in year one while being worth less every year
    # after, and a single blended "total comp" figure hides exactly that.
    total_first_year: float
    recurring_annual: float

    # Echoed back so the UI can show what was applied rather than restating
    # what the user typed into a form it may have since navigated away from.
    estimated_tax_rate: Optional[float] = None
    col_index: Optional[float] = None
    # recurring x (1 - tax) / col_index. Equals recurring_annual exactly when
    # neither adjustment was supplied.
    net_adjusted_comp: float
    # False when nothing was applied, so the UI can state that plainly instead
    # of presenting an unadjusted figure as though it were net.
    is_adjusted: bool

    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class OfferListSchema(BaseModel):
    offers: List[OfferSchema]
    count: int
