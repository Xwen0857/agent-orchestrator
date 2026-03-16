# Purpose

`config_snapshot.sh` versions the current planner config by copying `current.md` into history, then updates pointer metadata and append-only audit history.

# Inputs and Outputs

- Inputs:
  - required `version_id`
  - optional actor
  - optional reason
- Outputs:
  - a new history file in `templates/coordination/planner/config/history/`
  - an updated `current.pointer.json`
  - a new `versions.ndjson` audit event

# Step-By-Step Flow

1. Validate required arguments.
2. Create the history directory if needed.
3. Acquire the shared config lock file using `noclobber`.
4. Validate that `current.md` exists, the version id matches the allowed pattern, and the target history file does not already exist.
5. Copy `current.md` into the new versioned history file.
6. Compute the new file checksum.
7. Read the prior `current_version_id` from the pointer if it exists.
8. Rewrite `current.pointer.json` with the new current and previous version ids.
9. Append a `SNAPSHOT` event to `versions.ndjson`.

# Failure Modes and Safety Checks

- The lock file prevents concurrent snapshot/rollback mutations.
- Version ids are restricted to a safe filename subset.
- Existing version files are never overwritten.

# Key Dependencies

- `jq`
- `shasum`
- planner config files under `templates/coordination/planner/config`

# Maintenance Notes

- `config_rollback.sh` shares the same lock and pointer schema. Keep the two scripts aligned when pointer fields change.
