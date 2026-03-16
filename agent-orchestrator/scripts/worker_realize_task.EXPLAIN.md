# Purpose

`worker_realize_task.sh` is a deterministic worker that converts a supported strategy into a concrete delivery bundle and task evidence.

# Inputs and Outputs

- Inputs:
  - task directory with `meta.json`
  - strategy file named after the task id (`<task_id>.strategy.json`)
  - optional `amendments.md`
- Outputs on success:
  - files under `delivery/`
  - appended entries in `work.md`
  - appended prepared test command in `test.md`
- Outputs on unsupported tasks:
  - a blocker entry appended to `work.md`

# Step-By-Step Flow

1. Validate the task directory, metadata, and strategy file.
2. Read the task goal and normalize it for lightweight pattern matching.
3. Create the `delivery/` directory.
4. Read the latest amendment note when present so the generated evidence can reference it.
5. Check whether the goal matches the hard-coded WebSocket calculator template.
6. If it matches:
   - write the Python implementation
   - write unit tests
   - write a runbook
   - append worker evidence
   - append a test command if it is not already present
7. If it does not match:
   - append a blocker entry to `work.md`
   - exit non-zero

# Failure Modes and Safety Checks

- Unsupported goals fail explicitly instead of generating a partial or misleading delivery.
- `append_test_command` avoids duplicating the same test command across repeated worker runs.
- The script rewrites a fixed artifact set for the supported template, which keeps output deterministic.

# Key Dependencies

- `jq`
- task-local `meta.json`, strategy file, `work.md`, `test.md`

# Maintenance Notes

- Supported goal detection is intentionally narrow. If a new deterministic template is added, update both the matcher and the generated evidence text.
- The embedded delivery artifacts are part of this script’s contract; changing them changes downstream tester expectations.
