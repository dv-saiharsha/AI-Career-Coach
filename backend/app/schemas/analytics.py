from typing import Dict, List, Optional

from pydantic import BaseModel


class AtsHistoryPointSchema(BaseModel):
    id: int
    date: Optional[str] = None
    score: float
    label: str


class QuantifiedHistoryPointSchema(BaseModel):
    id: int
    date: Optional[str] = None
    label: str
    quantified_ratio: float
    impact_rating: float


class FunnelSchema(BaseModel):
    # Cards currently sitting at each stage.
    by_stage: Dict[str, int]
    total_tracked: int
    # "Reached at least this stage" — see services.pipeline_funnel for why
    # these necessarily differ from by_stage.
    reached_applied: int
    reached_interviewing: int
    reached_offer: int
    # None, not 0.0, when nothing has been applied to yet: "0%" reads as
    # failure where no data should simply read as no data.
    interview_rate: Optional[float] = None
    offer_rate: Optional[float] = None


class AnalyticsSummarySchema(BaseModel):
    ats_history: List[AtsHistoryPointSchema]
    quantified_history: List[QuantifiedHistoryPointSchema]
    funnel: FunnelSchema
    scan_count: int
    best_score: Optional[float] = None
    latest_score: Optional[float] = None
    score_delta: Optional[float] = None
