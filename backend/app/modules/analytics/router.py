from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.analytics import services
from app.schemas.analytics import AnalyticsSummarySchema

router = APIRouter()


@router.get("/summary", response_model=AnalyticsSummarySchema)
def get_summary(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Aggregates over the caller's own rows only.

    There is no per-user route to guard here: identity comes from the token,
    so there is no id in the path for a caller to swap for someone else's.
    Cross-user access isn't 404'd, it's unrepresentable.
    """
    return services.summary(db, current_user.id)
