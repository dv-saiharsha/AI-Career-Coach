from typing import List

from pydantic import BaseModel


class KeywordFrequency(BaseModel):
    keyword: str
    present: bool
    frequency: int


class AnalysisResultSchema(BaseModel):
    id: int
    ats_score: float
    missing_skills: List[str]
    matched_skills: List[str]
    extracted_skills: List[str]
    keyword_analysis: List[KeywordFrequency]
    suggestions: List[str]
    created_at: str


class ResumeHistoryItemSchema(BaseModel):
    id: int
    resume_filename: str
    ats_score: float
    created_at: str


class GenerateResumeRequestSchema(BaseModel):
    full_name: str
    skills_to_add: List[str] = []
