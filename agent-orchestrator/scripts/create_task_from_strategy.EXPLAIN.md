# Purpose

`create_task_from_strategy.sh` converts a validated planner strategy JSON into a new concrete task directory based on the task template scaffold.

# Inputs and Outputs

- Inputs:
  - required strategy JSON
  - optional tasks root
  - optional template directory
- Outputs:
  - new task directory under the tasks root
  - `meta.json`
  - empty `log.ndjson`
  - copied `<task_id>.strategy.json`
  - templated task artifacts copied from the task template

# Step-By-Step Flow

1. Validate the input files and directories.
2. Parse required strategy fields with `jq`.
3. Validate:
   - required fields are present
   - `risk_level` is in the allowed set
   - `task_id` uses the expected prefix/pattern
   - budget values are numeric
   - optional workspace fields are safe and constrained
4. Create the task directory and refuse to proceed if it already exists.
5. Resolve absolute paths and ensure the new task stays under the intended tasks root.
6. Copy the template scaffold into the new task directory.
7. Generate `meta.json` with initial state, budget, artifact inventory, and optional workspace fields.
8. Create `log.ndjson`.
9. Copy the source strategy into the task folder.
10. Patch `plan.md` so the template’s goal placeholder becomes the strategy goal.

# Failure Modes and Safety Checks

- The script blocks absolute or parent-traversing `workspace.workspace_root` values.
- The out-of-root check prevents accidental directory creation outside the tasks tree.
- Existing task ids are never overwritten.

# Key Dependencies

- `jq`
- task template directory under `templates/coordination/tasks/task_folders/_task_id_`

# Maintenance Notes

- The generated `meta.json` schema must stay aligned with downstream state-transition and dashboard scripts.
- If the task template structure changes, update the artifact list and the `plan.md` goal replacement logic together.
