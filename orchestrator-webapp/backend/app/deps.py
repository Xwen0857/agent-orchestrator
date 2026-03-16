"""Cached dependency constructors for the backend service graph."""
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
    """Load and memoize application settings."""
    return load_settings()


@lru_cache(maxsize=1)
def get_runtime() -> PluginRuntime:
    """Build and memoize the shared plugin runtime service."""
    settings = get_settings()
    return PluginRuntime(settings.repo_root)


@lru_cache(maxsize=1)
def get_plugin_registry() -> PluginRegistryService:
    """Build and memoize the plugin registry service."""
    settings = get_settings()
    return PluginRegistryService(settings.extensions_registry_json, get_runtime())


@lru_cache(maxsize=1)
def get_webhooks() -> WebhookService:
    """Build and memoize the webhook service."""
    s = get_settings()
    return WebhookService(s.webhooks_json, s.webhook_deadletter_ndjson)


@lru_cache(maxsize=1)
def get_event_bus() -> EventBus:
    """Build and memoize the event bus."""
    s = get_settings()
    return EventBus(s.events_ndjson, get_webhooks())


@lru_cache(maxsize=1)
def get_audit() -> AuditService:
    """Build and memoize the audit service."""
    s = get_settings()
    return AuditService(s.audit_ndjson)


@lru_cache(maxsize=1)
def get_config_service() -> ConfigService:
    """Build and memoize the config service with the full backend dependency graph."""
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
