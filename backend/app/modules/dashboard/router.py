from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.dashboard import services
from app.modules.notifications.service import check_periodic
from app.schemas.dashboard import DashboardHomeSchema, DashboardOverviewSchema

router = APIRouter()


@router.get("/overview", response_model=DashboardOverviewSchema)
def overview(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Fresh listings plus current Federal Register immigration documents.

    The news half hits an external API behind a one-hour cache, so a burst of
    dashboard loads costs one upstream request per hour, not one per user.

    Kept as-is (Milestone 9 does not change it) — /news depends on this
    exact shape too. The Career Dashboard reads from /home below instead.
    """
    return services.overview(db, current_user.id)


@router.get("/home", response_model=DashboardHomeSchema)
def home(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """The Career Dashboard's one request — see dashboard/services.py's
    home() for exactly which existing engine produced each section.

    Also the Notification Engine's one opportunistic sweep point (see
    notifications/service.py's check_periodic) — every check inside it is
    dedupe-guarded, so running it on every dashboard visit is safe and
    stands in for a scheduler this project doesn't otherwise have.
    """
    data = services.home(db, current_user.id)
    check_periodic(db, current_user.id, background_tasks)
    return data
