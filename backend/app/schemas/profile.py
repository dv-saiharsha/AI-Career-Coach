import re
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

# Strict on purpose: this string is later written into a CSS custom property
# on the client (see Settings > Appearance). Anything looser than a plain
# 6-digit hex — a named color, an rgb()/hsl() function, whitespace — is a
# wider surface for the value to be misused as more than a color than a hex
# code can be, and no legitimate picker input needs to be looser than this.
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# The onboarding contract: enough roles to make a useful feed, few enough that
# the selection stays deliberate. Enforced here as well as in the UI, because
# the UI's disabled button is a convenience and not a control — the endpoint is
# reachable directly.
MIN_TARGET_ROLES = 3
MAX_TARGET_ROLES = 5


BIO_MAX_CHARS = 2000


class ProfileSchema(BaseModel):
    onboarding_completed: bool
    target_roles: List[str]
    primary_resume_filename: Optional[str] = None
    primary_resume_analysis_id: Optional[int] = None
    # Career details edited on /profile.
    bio: Optional[str] = None
    current_title: Optional[str] = None
    seniority: Optional[str] = None
    primary_target_role: Optional[str] = None
    avatar_url: Optional[str] = None
    # NULL means "the default blue signal accent," not "no preference."
    accent_color: Optional[str] = None


class ProfileUpdateSchema(BaseModel):
    """Partial update. Every field is optional and `None` means "leave alone".

    Distinguishing "not sent" from "set to empty" matters here: the avatar
    delete flow needs to clear avatar_url, but a bio-only save must not wipe
    it as a side effect. Clearing is therefore expressed as an empty string,
    which normalise() turns into NULL, while an omitted field stays untouched.
    """

    bio: Optional[str] = Field(default=None, max_length=BIO_MAX_CHARS)
    current_title: Optional[str] = Field(default=None, max_length=120)
    seniority: Optional[str] = Field(default=None, max_length=60)
    primary_target_role: Optional[str] = Field(default=None, max_length=120)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)
    avatar_path: Optional[str] = Field(default=None, max_length=1024)
    # Empty string clears it back to the default blue, same convention as
    # avatar_url above — normalise() below turns "" into NULL.
    accent_color: Optional[str] = Field(default=None, max_length=7)
    # Written by the dashboard's resume reminder, which lands after onboarding
    # for users who skipped upload. Onboarding itself still goes through
    # /onboarding — this is the same pointer, set later.
    primary_resume_analysis_id: Optional[int] = None
    primary_resume_filename: Optional[str] = Field(default=None, max_length=512)

    # The roles that drive the job feed.
    #
    # This list was writable only at onboarding, so a user's interests were
    # fixed at the moment they signed up — the feed kept serving whatever they
    # picked in their first ninety seconds, with no way to change it short of
    # a database edit. Someone moving from backend to ML had no route back.
    #
    # Optional here, unlike in OnboardingRequestSchema where it is required:
    # a PATCH that does not mention roles must leave them alone rather than
    # clearing them. The length bounds only apply when it IS supplied.
    target_roles: Optional[List[str]] = Field(
        default=None, min_length=MIN_TARGET_ROLES, max_length=MAX_TARGET_ROLES
    )

    @field_validator("target_roles")
    @classmethod
    def clean_update_roles(cls, roles: Optional[List[str]]) -> Optional[List[str]]:
        """Same cleaning onboarding applies, so the two paths cannot disagree.

        Trim, drop blanks, de-duplicate case-insensitively. Without the dedupe
        ["Backend Engineer", "backend engineer"] satisfies the minimum while
        describing one role twice.
        """
        if roles is None:
            return None
        seen: set[str] = set()
        cleaned: List[str] = []
        for role in roles:
            trimmed = role.strip()
            if not trimmed or trimmed.lower() in seen:
                continue
            seen.add(trimmed.lower())
            cleaned.append(trimmed)
        if len(cleaned) < MIN_TARGET_ROLES:
            raise ValueError(
                f"Pick at least {MIN_TARGET_ROLES} distinct roles — the job feed is built from them."
            )
        return cleaned

    @field_validator("bio", "current_title", "seniority", "primary_target_role")
    @classmethod
    def strip_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip()

    @field_validator("accent_color")
    @classmethod
    def validate_accent_color(cls, value: Optional[str]) -> Optional[str]:
        # Empty string is the clear-to-default signal (see the field's
        # comment) and must pass through unchanged for normalise() to catch;
        # only a non-empty value has to look like a real hex color.
        if not value:
            return value
        if not _HEX_COLOR.match(value):
            raise ValueError("accent_color must be a 6-digit hex color, e.g. #7c5cff")
        return value.lower()


class OnboardingRequestSchema(BaseModel):
    target_roles: List[str] = Field(..., min_length=MIN_TARGET_ROLES, max_length=MAX_TARGET_ROLES)
    # Set when onboarding ran the resume through /api/resume/analyze first, so
    # the profile can point at the analysis it produced.
    primary_resume_analysis_id: Optional[int] = None
    primary_resume_filename: Optional[str] = None

    @field_validator("target_roles")
    @classmethod
    def clean_roles(cls, roles: List[str]) -> List[str]:
        """Trim, drop blanks, and de-duplicate case-insensitively.

        Without the dedupe, ["Backend Engineer", "backend engineer"] passes the
        minimum-3 check while describing two roles' worth of nothing.
        """
        seen: set[str] = set()
        cleaned: List[str] = []
        for role in roles:
            trimmed = role.strip()
            if not trimmed or trimmed.lower() in seen:
                continue
            seen.add(trimmed.lower())
            cleaned.append(trimmed)
        if len(cleaned) < MIN_TARGET_ROLES:
            raise ValueError(
                f"at least {MIN_TARGET_ROLES} distinct target roles are required"
            )
        return cleaned


class UserStatsSchema(BaseModel):
    resumes_analyzed: int
    interview_sessions: int
    # None rather than 0 when there is nothing to average: a brand-new user has
    # no average score, and rendering "0%" reads as a terrible result rather
    # than an absent one.
    avg_ats_score: Optional[float] = None
    latest_ats_score: Optional[float] = None
    latest_interview_score: Optional[float] = None


class ActivityItemSchema(BaseModel):
    id: int
    kind: str  # "resume" | "interview"
    title: str
    score: Optional[float] = None
    # Optional, not required: a row inserted before created_at had a
    # server_default could still have it NULL — see recent_activity's own
    # defensive sort for the same edge case.
    created_at: Optional[str] = None


class ActivityResponseSchema(BaseModel):
    items: List[ActivityItemSchema]
