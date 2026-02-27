from __future__ import annotations

from fastapi import Header, HTTPException

from app.models import Role, UserContext


ROLE_HEADER_MAP = {
    "viewer": Role.viewer,
    "operator": Role.operator,
    "approver": Role.approver,
}


def resolve_user(
    x_user: str | None = Header(default=None),
    x_email: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
) -> UserContext:
    user_id = (x_user or "anonymous").strip()
    email = (x_email or f"{user_id}@local").strip()
    role_key = (x_role or "viewer").strip().lower()
    if role_key not in ROLE_HEADER_MAP:
        raise HTTPException(status_code=400, detail="invalid role header")
    return UserContext(user_id=user_id, email=email, role=ROLE_HEADER_MAP[role_key])


def require_role(user: UserContext, allowed: set[Role]) -> None:
    if user.role not in allowed:
        raise HTTPException(status_code=403, detail="insufficient role")
