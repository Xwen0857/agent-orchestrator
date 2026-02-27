from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_event_bus, get_webhooks
from app.models import CreateWebhookSubscriptionRequest, Role, UserContext
from app.services.auth_service import require_role, resolve_user

router = APIRouter(prefix="/api/v1/events", tags=["events"])


@router.get("")
def list_events(
    event_type: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    user: UserContext = Depends(resolve_user),
) -> dict:
    require_role(user, {Role.viewer, Role.operator, Role.approver})
    bus = get_event_bus()
    return {"items": [e.model_dump() for e in bus.list_events(limit=limit, event_type=event_type)]}


@router.post("/replay/{event_id}")
def replay_event(event_id: str, user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.operator, Role.approver})
    bus = get_event_bus()
    events = bus.list_events(limit=5000)
    target = next((e for e in events if e.event_id == event_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="event not found")
    bus.webhook_service.deliver(target)
    return {"replayed": True, "eventId": event_id}


@router.get("/subscriptions")
def list_subscriptions(user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.viewer, Role.operator, Role.approver})
    svc = get_webhooks()
    return {"items": [x.model_dump() for x in svc.list()]}


@router.post("/subscriptions")
def create_subscription(req: CreateWebhookSubscriptionRequest, user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.operator, Role.approver})
    svc = get_webhooks()
    created = svc.create(req)
    return created.model_dump()
