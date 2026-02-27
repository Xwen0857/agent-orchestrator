from __future__ import annotations

from functools import lru_cache

from app.services.audit_service import AuditService
from app.services.config_service import ConfigService
from app.services.event_bus import EventBus
from app.services.plugin_registry import PluginRegistryService
from app.services.plugin_runtime import PluginRuntime
from app.services.webhook_service import WebhookService
from app.settings import load_settings


@lru_cache(maxsize=1)
def get_settings():
    return load_settings()


@lru_cache(maxsize=1)
def get_runtime() -> PluginRuntime:
    settings = get_settings()
    return PluginRuntime(settings.repo_root)


@lru_cache(maxsize=1)
def get_plugin_registry() -> PluginRegistryService:
    settings = get_settings()
    return PluginRegistryService(settings.extensions_registry_json, get_runtime())


@lru_cache(maxsize=1)
def get_webhooks() -> WebhookService:
    s = get_settings()
    return WebhookService(s.webhooks_json, s.webhook_deadletter_ndjson)


@lru_cache(maxsize=1)
def get_event_bus() -> EventBus:
    s = get_settings()
    return EventBus(s.events_ndjson, get_webhooks())


@lru_cache(maxsize=1)
def get_audit() -> AuditService:
    s = get_settings()
    return AuditService(s.audit_ndjson)


@lru_cache(maxsize=1)
def get_config_service() -> ConfigService:
    s = get_settings()
    return ConfigService(
        planner_current_md=s.planner_current_md,
        planner_properties_md=s.planner_properties_md,
        audit_policy_json=s.audit_policy_json,
        history_ndjson=s.config_history_ndjson,
        lock_path=s.config_lock,
        snapshot_script=s.snapshot_script,
        rollback_script=s.rollback_script,
        plugin_registry=get_plugin_registry(),
        runtime=get_runtime(),
        event_bus=get_event_bus(),
        audit=get_audit(),
    )
