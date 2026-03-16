# `ensure_workspace_contract.sh` Explain

## Purpose

Creates the per-task workspace and run-root contract, including runtime isolation profiles, baseline dependency/convention files, and workspace manifest refresh.

## Inputs And Outputs

Inputs:
- task directory
- optional execution profile
- runtime config JSON
- task metadata

Outputs:
- workspace and run-root directory tree
- runtime profile JSON
- dependency/convention/env spec files
- refreshed workspace manifest

## Step-By-Step Flow

1. Validate task metadata and derive the default project/run/workspace paths.
2. Apply `workspace_root_hint` if present, while enforcing that it stays inside the projects root.
3. Create the expected workspace and run-root subdirectories.
4. If runtime isolation is enabled:
   - materialize orchestrator and project namespace directories
   - create orchestrator/project runtime metadata files
   - write the combined runtime profile JSON consumed by the sandbox wrapper
   - optionally mark orchestrator-managed paths read-only
5. Seed dependency, conventions, and env spec files when missing.
6. Refresh the workspace manifest through the dedicated refresh script.

## Failure Modes And Safety Checks

- Rejects missing task ids or invalid workspace hints.
- Rejects hints that escape the configured projects root.
- Keeps orchestrator namespace paths distinct from project-writable paths.
- Uses config-driven namespace names instead of hardcoding layout assumptions.

## Key Dependencies

- task `meta.json`
- runtime config JSON
- `workspace_refresh_manifest.sh`

## Maintenance Notes

- This script owns the runtime layout contract used by sandboxing and workspace-change auditing.
- Any changes to namespace env vars or profile schema must stay aligned with `launch_agent_sandbox.sh`.
