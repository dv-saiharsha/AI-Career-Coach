from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.dashboard import services
from app.schemas.dashboard import DashboardOverviewSchema

router = APIRouter()


@router.get("/overview", response_model=DashboardOverviewSchema)
def overview(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Fresh listings plus current Federal Register immigration documents.

    The news half hits an external API behind a one-hour cache, so a burst of
    dashboard loads costs one upstream request per hour, not one per user.
    """
    return services.overview(db, current_user.id)
