from fastapi import APIRouter, Depends

from app.core.deps import AuthenticatedUser, get_current_user

router = APIRouter()


@router.get("/me")
def me(current_user: AuthenticatedUser = Depends(get_current_user)):
    """Sanity-check endpoint — confirms a Supabase-issued token verifies
    correctly against this backend. Signup/login/verification/reset all
    happen client-side via the Supabase SDK now, not through this API."""
    return {"id": current_user.id, "email": current_user.email}
