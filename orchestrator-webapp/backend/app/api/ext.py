from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.deps import get_audit, get_event_bus, get_plugin_registry
from app.models import PLUGIN_API_VERSION, RegisterPluginRequest, Role, UserContext
from app.services.auth_service import require_role, resolve_user

router = APIRouter(prefix="/api/v1/ext", tags=["extensions"])


@router.get("/plugins")
def list_plugins(user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.viewer, Role.operator, Role.approver})
    svc = get_plugin_registry()
    return {"pluginApiVersion": PLUGIN_API_VERSION, "items": [p.model_dump() for p in svc.list_plugins()]}


@router.post("/plugins/register")
def register_plugin(req: RegisterPluginRequest, user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.operator, Role.approver})
    svc = get_plugin_registry()
    try:
        rec = svc.register(req.manifestPath)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    trace_id = f"trace_register_{rec.id}"
    get_event_bus().emit(
        event_type="extension.plugin.registered",
        actor=user.user_id,
        resource=f"plugin:{rec.id}",
        payload=rec.model_dump(),
        trace_id=trace_id,
        plugin_id=rec.id,
    )
    get_audit().record(
        actor=user.user_id,
        action="PLUGIN_REGISTER",
        resource=f"plugin:{rec.id}",
        status="OK",
        details=rec.model_dump(),
        trace_id=trace_id,
    )
    return rec.model_dump()


@router.post("/plugins/{plugin_id}/enable")
def enable_plugin(plugin_id: str, user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.operator, Role.approver})
    svc = get_plugin_registry()
    try:
        rec = svc.set_enabled(plugin_id, True)
    except KeyError:
        raise HTTPException(status_code=404, detail="plugin not found")
    return rec.model_dump()


@router.post("/plugins/{plugin_id}/disable")
def disable_plugin(plugin_id: str, reason: str = "disabled by operator", user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.operator, Role.approver})
    svc = get_plugin_registry()
    try:
        rec = svc.set_enabled(plugin_id, False, reason=reason)
    except KeyError:
        raise HTTPException(status_code=404, detail="plugin not found")
    return rec.model_dump()


@router.get("/capabilities")
def capabilities(user: UserContext = Depends(resolve_user)) -> dict:
    require_role(user, {Role.viewer, Role.operator, Role.approver})
    svc = get_plugin_registry()
    rows = []
    for rec, manifest in svc.get_enabled_manifests():
        rows.append(
            {
                "pluginId": rec.id,
                "name": manifest.name,
                "version": manifest.version,
                "capabilities": manifest.capabilities,
                "permissions": manifest.permissions,
            }
        )
    return {"items": rows}
