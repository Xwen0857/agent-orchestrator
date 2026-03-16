# `guard_workspace_changes.sh` Explain

## Purpose

Checks whether files changed under a task run root are allowed to be submitted, blocking protected runtime paths and unauthorized writes.

## Inputs And Outputs

Inputs:
- `--task-id`
- `--run-root`
- optional `--role`
- optional `--tasks-root`

Outputs:
- denial records in `commit_guard_denied.ndjson`
- JSON summary of allowed or denied changes

## Step-By-Step Flow

1. Parse args and load commit-guard/runtime policy settings.
2. Discover changed files, preferring git when the run root is inside the repo.
3. Restrict the checked surface to user submission paths (`workspace`, `delivery`, `artifacts`).
4. Drop ephemeral runtime/build artifacts from the candidate set.
5. Reject writes into protected runtime-managed paths (for example orchestrator namespace data).
6. Validate the remaining changes against either:
   - the generated role policy JSON, or
   - the fallback ACL script when the policy file is absent
7. Record each denial and emit the final JSON summary.

## Failure Modes And Safety Checks

- Returns early when commit guard is disabled.
- Deduplicates changed paths before policy evaluation.
- Separates orchestrator-managed runtime files from user delivery surfaces.
- Falls back to ACL checks if the generated role policy file is unavailable.

## Key Dependencies

- runtime config JSON
- `enforce_role_acl.sh`
- `role_permissions.effective.json`
- git (when available)

## Maintenance Notes

- Keep the scoped path filters and ephemeral path exclusions aligned with the actual run-root layout.
- If role policy schema changes, update the embedded Python matcher in lockstep.
