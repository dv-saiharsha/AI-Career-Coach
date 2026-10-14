"""The structured result of analysing a job description.

`JDAnalysis` is what every scan, match and tailoring flow works from instead of
a flat keyword list. Its rules are enforced here, by pydantic, so a malformed
analysis cannot exist: a skill always carries a verbatim quote, a keyword weight
is always between 0 and 1, and there are never more than ten responsibilities.

What the JD does not state is never filled in: an unknown level is "unknown", an
absent years figure is None, and an absent list is empty.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Seniority = Literal["intern", "junior", "mid", "senior", "lead", "manager", "unknown"]

# Where `seniority` came from. "stated": the JD says it (a level word in the
# title or text). "years": no level word, so code mapped min_years_experience
# (0-2 junior, 3-5 mid, 6+ senior). "unknown": neither.
SenioritySource = Literal["stated", "years", "unknown"]

AnalysisSource = Literal["llm", "rules", "hybrid"]

MAX_RESPONSIBILITIES = 10


class Skill(BaseModel):
    """A skill the JD names.

    `name` is the taxonomy canonical form (core/taxonomy.canonical) so "Node.js"
    and "NodeJS" are one skill. `evidence` is a phrase copied word for word from
    the JD; a skill whose evidence is not in the JD is dropped, never kept.
    `alternative_group` is set when the JD offers alternatives joined by "or"
    ("Go, Java, or Python"): every alternative shares one group, and only one of
    them is needed.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    evidence: str = Field(min_length=1)
    alternative_group: str | None = None


class Requirement(BaseModel):
    """A degree or certification, and whether it is actually required.

    `required` is false for "or equivalent experience", "a plus", "preferred",
    "nice to have" and "not required". `evidence` is verbatim, like a skill's.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    required: bool
    evidence: str = Field(min_length=1)


class Keyword(BaseModel):
    """An ATS keyword and how much it matters, 0 to 1."""

    term: str = Field(min_length=1)
    weight: float = Field(ge=0.0, le=1.0)


class JDAnalysis(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    job_title: str = ""
    seniority: Seniority = "unknown"
    seniority_source: SenioritySource = "unknown"
    min_years_experience: int | None = Field(default=None, ge=0, le=60)
    required_skills: list[Skill] = Field(default_factory=list)
    preferred_skills: list[Skill] = Field(default_factory=list)
    tools_technologies: list[str] = Field(default_factory=list)
    education: list[Requirement] = Field(default_factory=list)
    certifications: list[Requirement] = Field(default_factory=list)
    # Short phrases, at most ten.
    responsibilities: list[str] = Field(default_factory=list, max_length=MAX_RESPONSIBILITIES)
    ats_keywords: list[Keyword] = Field(default_factory=list)
    source: AnalysisSource = "rules"

    @field_validator("seniority_source")
    @classmethod
    def _unknown_level_has_unknown_source(cls, value, info):
        # A level that is "unknown" cannot have been stated or derived.
        if info.data.get("seniority") == "unknown" and value != "unknown":
            raise ValueError("seniority is unknown, so seniority_source must be unknown")
        return value


class AnalyzeJDRequest(BaseModel):
    """POST /api/jd/analyze body."""

    job_description: str = Field(min_length=20, max_length=60000)


class AnalyzeJDResponse(BaseModel):
    """What the API returns: the analysis plus where it came from."""

    analysis: JDAnalysis
    cached: bool
    model: str | None = None
    job_listing_id: int | None = None
