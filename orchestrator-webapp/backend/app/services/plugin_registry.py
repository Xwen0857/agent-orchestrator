"""Persistent plugin registration management for the backend.

This module resolves manifests, enforces compatibility checks, and updates the
backend registry file that tracks installed plugins and enablement state.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.models import PLUGIN_API_VERSION, PluginManifest, RegisteredPlugin
from app.services.file_store import read_json, write_json_atomic
from app.services.plugin_runtime import PluginRuntime


class PluginRegistryService:
    """Load, validate, register, and toggle plugins in the registry store."""

    def __init__(self, registry_path: Path, runtime: PluginRuntime) -> None:
        self.registry_path = registry_path
        self.runtime = runtime

    def _load_registry(self) -> dict:
        """Load the registry file with a stable default shape when it does not exist yet."""
        return read_json(
            self.registry_path,
            default={
                "coreApiVersion": "1.0.0",
                "pluginApiVersion": PLUGIN_API_VERSION,
                "compatibility": {"supportedMajor": 1, "supportedMinorRange": [0, 1]},
                "plugins": [],
            },
        )

    def list_plugins(self) -> list[RegisteredPlugin]:
        """Return all registered plugins as validated models."""
        data = self._load_registry()
        return [RegisteredPlugin.model_validate(p) for p in data.get("plugins", [])]

    def get_manifest(self, manifest_path: str) -> PluginManifest:
        """Resolve and validate one plugin manifest from an absolute or repo-relative path."""
        path = Path(manifest_path)
        if not path.is_absolute():
            if not path.exists():
                path = (self.runtime.repo_root / manifest_path).resolve()
        raw = read_json(path)
        return PluginManifest.model_validate(raw)

    def register(self, manifest_path: str) -> RegisteredPlugin:
        """Register or replace one plugin record after manifest compatibility validation."""
        manifest = self.get_manifest(manifest_path)
        compatible, msg = self.runtime.check_compat(manifest)
        if not compatible:
            raise ValueError(msg)

        registry = self._load_registry()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        plugins = registry.get("plugins", [])
        kept = [p for p in plugins if p.get("id") != manifest.id]
        resolved_path = str(Path(manifest_path).resolve() if Path(manifest_path).exists() else (self.runtime.repo_root / manifest_path).resolve())
        record = {
            "id": manifest.id,
            "manifestPath": resolved_path,
            "enabled": True,
            "installedAt": now,
            "disabledReason": None,
        }
        kept.append(record)
        registry["plugins"] = kept
        write_json_atomic(self.registry_path, registry)
        return RegisteredPlugin.model_validate(record)

    def set_enabled(self, plugin_id: str, enabled: bool, reason: str | None = None) -> RegisteredPlugin:
        """Enable or disable one registered plugin and persist the updated registry."""
        registry = self._load_registry()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        found: dict | None = None
        for item in registry.get("plugins", []):
            if item.get("id") == plugin_id:
                item["enabled"] = enabled
                item["disabledReason"] = None if enabled else (reason or "disabled by operator")
                item["updatedAt"] = now
                found = item
                break
        if found is None:
            raise KeyError(plugin_id)
        write_json_atomic(self.registry_path, registry)
        return RegisteredPlugin.model_validate(found)

    def get_enabled_manifests(self) -> list[tuple[RegisteredPlugin, PluginManifest]]:
        """Return enabled plugin records paired with manifests that still pass compatibility checks."""
        result: list[tuple[RegisteredPlugin, PluginManifest]] = []
        for rec in self.list_plugins():
            if not rec.enabled:
                continue
            manifest = self.get_manifest(rec.manifestPath)
            compatible, _ = self.runtime.check_compat(manifest)
            if compatible:
                result.append((rec, manifest))
        return result
