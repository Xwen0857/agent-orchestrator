"""Backend settings that resolve repo-relative data and config paths."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Resolved path configuration for the backend service graph."""

    repo_root: Path
    dashboard_json: Path
    health_json: Path
    planner_current_md: Path
    planner_properties_md: Path
    audit_policy_json: Path
    config_history_ndjson: Path
    extensions_registry_json: Path
    events_ndjson: Path
    webhooks_json: Path
    webhook_deadletter_ndjson: Path
    audit_ndjson: Path
    config_lock: Path
    snapshot_script: Path
    rollback_script: Path


def load_settings() -> Settings:
    """Build the default settings object from the repository layout."""
    repo_root = Path(__file__).resolve().parents[3]
    data_root = repo_root / "orchestrator-webapp" / "backend" / "data"
    return Settings(
        repo_root=repo_root,
        dashboard_json=repo_root / "templates/coordination/orchestrator/dashboard.json",
        health_json=repo_root / "templates/coordination/orchestrator/system-health.json",
        planner_current_md=repo_root / "templates/coordination/planner/config/current.md",
        planner_properties_md=repo_root / "templates/coordination/planner/properties.md",
        audit_policy_json=repo_root / "templates/coordination/audit/policy/current.json",
        config_history_ndjson=repo_root / "templates/coordination/planner/config/history/versions.ndjson",
        extensions_registry_json=repo_root / "extensions/registry.json",
        events_ndjson=data_root / "events.ndjson",
        webhooks_json=data_root / "webhooks.json",
        webhook_deadletter_ndjson=data_root / "webhook_deadletter.ndjson",
        audit_ndjson=data_root / "audit.ndjson",
        config_lock=data_root / ".config.commit.lock",
        snapshot_script=repo_root / "agent-orchestrator/scripts/config_snapshot.sh",
        rollback_script=repo_root / "agent-orchestrator/scripts/config_rollback.sh",
    )
