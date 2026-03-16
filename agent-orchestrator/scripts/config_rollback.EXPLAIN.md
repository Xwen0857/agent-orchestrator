# Purpose

`config_rollback.sh` restores `current.md` from a versioned history file and records both the rollback target and the generated backup in audit metadata.

# Inputs and Outputs

- Inputs:
  - required target version id
  - optional actor
  - optional reason
- Outputs:
  - rewritten `current.md`
  - a rollback backup file in history
  - updated `current.pointer.json`
  - appended `ROLLBACK` audit event

# Step-By-Step Flow

1. Validate required arguments.
2. Create the history directory if needed.
3. Acquire the shared config lock file.
4. Confirm the target version exists.
5. Read the current pointer metadata when present.
6. If already on the target version, exit successfully without mutation.
7. Snapshot the current live config into a generated backup version id.
8. Copy the target version into `current.md`.
9. Compute checksums for the target and backup files.
10. Rewrite `current.pointer.json` with the new active version and rollback backup id.
11. Append a `ROLLBACK` event to `versions.ndjson`.

# Failure Modes and Safety Checks

- Rollback and snapshot serialize through the same lock file.
- The pre-rollback backup preserves a one-step recovery point before overwriting the live config.
- A no-op rollback exits cleanly when the requested target is already current.

# Key Dependencies

- `jq`
- `shasum`
- planner config files under `templates/coordination/planner/config`

# Maintenance Notes

- The pointer schema includes `rollback_backup_version_id`; any tooling that reads rollback metadata must stay compatible with that field.
