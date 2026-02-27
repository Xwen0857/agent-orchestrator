from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends

from app.deps import get_config_service, get_event_bus, get_settings
from app.models import (
    CommitDraftRequest,
    CommitDraftResponse,
    CurrentConfigResponse,
    OverviewResponse,
    Role,
    RollbackRequest,
    UserContext,
    ValidateDraftRequest,
    ValidateDraftResponse,
)
from app.services.auth_service import require_role, resolve_user
from app.services.file_store import read_json

router = APIRouter(prefix="/api/v1/core", tags=["core"])


@router.get("/overview", response_model=OverviewResponse)
def overview(_user: UserContext = Depends(resolve_user)) -> OverviewResponse:
    s = get_settings()
    return OverviewResponse(
        dashboard=read_json(s.dashboard_json, default={}),
        systemHealth=read_json(s.health_json, default={}),
    )


@router.get("/configs/current", response_model=CurrentConfigResponse)
def current_configs(_user: UserContext = Depends(resolve_user)) -> CurrentConfigResponse:
    svc = get_config_service()
    return svc.read_current()


@router.post("/configs/validate", response_model=ValidateDraftResponse)
def validate_configs(req: ValidateDraftRequest, user: UserContext = Depends(resolve_user)) -> ValidateDraftResponse:
    require_role(user, {Role.operator, Role.approver})
    svc = get_config_service()
    return svc.validate(req, user, f"trace_{uuid4().hex}")


@router.post("/configs/commit", response_model=CommitDraftResponse)
def commit_configs(req: CommitDraftRequest, user: UserContext = Depends(resolve_user)) -> CommitDraftResponse:
    require_role(user, {Role.operator, Role.approver})
    svc = get_config_service()
    return svc.commit(req, user)


@router.post("/configs/rollback")
def rollback_configs(req: RollbackRequest, user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.operator, Role.approver})
    svc = get_config_service()
    return svc.rollback(req.targetVersionId, req.reason, user)


@router.get("/configs/history")
def config_history(_user: UserContext = Depends(resolve_user)) -> dict:
    svc = get_config_service()
    return {"items": svc.history()}


@router.get("/auth/me")
def me(user: UserContext = Depends(resolve_user)) -> UserContext:
    return user


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}
