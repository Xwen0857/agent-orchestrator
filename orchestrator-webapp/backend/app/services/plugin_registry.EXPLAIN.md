# `plugin_registry.py` Explain

## Purpose

Persists plugin registration state, resolves manifests, and enforces compatibility before plugins are enabled in the backend.

## Inputs And Outputs

Inputs:
- registry file path
- plugin runtime service
- manifest path arguments

Outputs:
- validated `RegisteredPlugin` models
- updated registry JSON on disk

## Step-By-Step Flow

1. Load the registry file with a stable default structure when missing.
2. Resolve manifests from absolute paths or repo-relative paths.
3. Validate manifest compatibility through `PluginRuntime`.
4. Register plugins by replacing any existing record with the same id.
5. Toggle plugin enablement by mutating the stored record and persisting it atomically.
6. Return enabled plugin records paired with manifests that still pass compatibility checks.

## Failure Modes And Safety Checks

- Raises on incompatible manifests before mutating the registry.
- Raises `KeyError` when attempting to toggle a plugin that is not registered.
- Uses atomic JSON writes for registry persistence.
- Re-checks compatibility when returning enabled manifests, so stale registry entries do not silently load incompatible plugins.

## Key Dependencies

- `PluginRuntime`
- `read_json`
- `write_json_atomic`
- `RegisteredPlugin`
- `PluginManifest`

## Maintenance Notes

- Keep the registry default shape stable because operators and other services may rely on it.
- If manifest path resolution rules change, update both registration and manifest-loading paths together.
