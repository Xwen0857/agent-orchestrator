# `orchestrate-path.ts` Explain

## Purpose

`orchestrate-path.ts` manages the persisted project-to-workspace mapping used by `/orchestrate path` and `/orchestrate run`. It keeps path resolution deterministic and prevents workspace roots from escaping the configured projects directory.

## Inputs And Outputs

Inputs:

- free-form `path` subcommand payload strings
- persisted JSON path-state content
- explicit run flags (`projectIdFromFlag`, `workspaceRootFromFlag`)
- repository root plus configured relative projects root

Outputs:

- normalized `PathState`
- parsed key/value flags plus remaining positional tokens
- an effective workspace config for a run, including the source of that decision

## Step-By-Step Flow

1. `parseKvFlags` tokenizes a payload and captures only simple `--key value` pairs.
2. `normalizePathState` converts arbitrary JSON into a valid `PathState`, dropping invalid project ids and incomplete entries.
3. `validateWorkspaceRootRelative` rejects empty, absolute, or parent-traversing workspace roots.
4. `resolveWorkspaceUnderProjects` resolves the candidate workspace against the absolute projects root and throws if it escapes the root after normalization.
5. `resolveWorkspaceConfigForRun` applies the workspace precedence chain:
   - explicit run flags
   - stored project default from path state
   - generated runtime default under `<project>/runs/<taskId>/workspace`

## Failure Modes And Safety Checks

- `--workspace-root` without `--project-id` is rejected.
- Invalid project ids are rejected before any path lookup.
- Persisted defaults are ignored if they no longer pass validation.
- Absolute path resolution is always checked against the projects root boundary before a flag or saved value is accepted.

## Key Dependencies

- Node `path`
- persisted path state file managed by the wider plugin runtime

## Maintenance Notes

- If the path state schema changes, update `buildEmptyPathState` and `normalizePathState` together.
- If new CLI flag forms are added, update `parseKvFlags` only if the payload format stays intentionally simple.
- Any relaxation of path validation must preserve the root-containment check in `resolveWorkspaceUnderProjects`.
