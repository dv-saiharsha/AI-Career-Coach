from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class JobOffer(Base):
    __tablename__ = "job_offers"

    id = Column(Integer, primary_key=True, index=True)

    # auth.users(id), matching every other user-owned table. Enforced at the
    # DB level in the migration, not as a SQLAlchemy ForeignKey — auth lives
    # in a schema this app doesn't model.
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )

    # Integer, not UUID: job_applications.id is an Integer primary key, and a
    # UUID column here could never satisfy that foreign key.
    # SET NULL rather than CASCADE — deleting the pipeline card shouldn't
    # destroy the offer, which is the more valuable record of the two.
    application_id = Column(
        Integer, ForeignKey("job_applications.id", ondelete="SET NULL"), nullable=True
    )

    company = Column(String, nullable=False)
    role_title = Column(String, nullable=False)

    # Numeric, not Float. Money in binary floating point accumulates
    # representation error across additions, and these values are summed into
    # a total the user compares offers on.
    base_salary = Column(Numeric(12, 2), nullable=False, server_default="0")
    annual_bonus = Column(Numeric(12, 2), nullable=False, server_default="0")
    signing_bonus = Column(Numeric(12, 2), nullable=False, server_default="0")
    equity_value_annual = Column(Numeric(12, 2), nullable=False, server_default="0")

    # User-entered, both optional. Nothing is inferred: an effective tax rate
    # depends on filing status, deductions, and state/local rules this app has
    # no knowledge of, and a guessed multiplier applied to a real offer would
    # be worse than none at all.
    #
    # NULL tax_rate means "not supplied" and is distinct from 0.0, which is a
    # real answer for a no-income-tax state.
    estimated_tax_rate = Column(Numeric(5, 4), nullable=True)
    # Relative cost of living: 1.10 = 10% more expensive than the baseline the
    # user is comparing against. NULL and 1.00 both mean "no adjustment".
    col_index = Column(Numeric(6, 4), nullable=True)

    location = Column(String, nullable=True)
    is_remote = Column(Boolean, nullable=False, default=False, server_default="false")
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
