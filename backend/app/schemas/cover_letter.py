from typing import List, Optional

from pydantic import BaseModel


class GenerateCoverLetterRequestSchema(BaseModel):
    # Integers, matching the primary keys. The listing and the scan are both
    # Integer PKs, so a string id would 422 before reaching the query.
    job_id: int
    analysis_id: int
    # The backend has no name: AuthenticatedUser carries id and email only,
    # and the display name lives in Supabase user_metadata, which the client
    # holds. Sent from there rather than defaulted to a placeholder — a letter
    # signed "JOHN DOE" is worse than one that fails to generate.
    full_name: str = ""
    phone: str = ""
    linkedin: str = ""
    # professional | confident | concise. Anything else falls back to
    # professional rather than 422-ing, since tone is cosmetic.
    tone: str = "professional"


class CoverLetterSchema(BaseModel):
    """A generated letter, its PDF, and what could not be verified about it."""

    job_id: int
    analysis_id: int
    job_title: str
    company: str
    tone: str
    # LASTNAME_FIRSTNAME_COVER_LETTER_ROLE_COMPANY.pdf
    download_filename: str
    paragraphs: List[str] = []
    # Short resume quotes the model says each claim rests on. Shown so the
    # candidate can check the letter against their own document.
    grounded_in: List[str] = []
    # Figures asserted in the letter that do not appear in the resume. A
    # report, not a rejection: a resume saying "38%" and a letter saying
    # "nearly 40%" flags here, and the candidate is the right person to judge
    # that. An empty list means no unmatched figures were found — not that
    # the letter has been verified true.
    unsupported_claims: List[str] = []
    # base64. There is no file hosting in this deployment, so a URL would have
    # to be invented; the client builds a blob URL for preview and download.
    pdf_base64: Optional[str] = None
