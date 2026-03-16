# Purpose

`dashboard_summary.sh` scans task folders, derives a normalized status snapshot, and publishes both JSON and Markdown dashboard views.

# Inputs and Outputs

- Inputs:
  - task root directory (defaults to `templates/coordination/tasks/task_folders`)
  - markdown output path
  - json output path
  - optional keeper report JSON at `templates/coordination/orchestrator/keeper-report.json`
- Outputs:
  - dashboard JSON with active pipelines, pending actions, and system health
  - dashboard Markdown for operator-facing review

# Step-By-Step Flow

1. Create output directories and temp files.
2. Walk each `meta.json` file under the task tree, skipping the `_task_id_` template folder.
3. For each task, enrich the metadata with:
   - source task directory
   - lock presence
   - a validated approval id when `approval.json` still passes `validate_approval.sh`
4. If no task lines were collected, emit an empty but schema-stable JSON payload.
5. Otherwise, aggregate open tasks with `jq` into:
   - `active_pipelines`
   - `pending_actions`
   - `system_health`
6. Render the JSON into Markdown tables and summary bullets.
7. Append keeper status when the optional keeper report exists.
8. Atomically rename the temp files into the final JSON and Markdown outputs.

# Failure Modes and Safety Checks

- Approval ids are only surfaced when `validate_approval.sh` succeeds; expired or malformed approvals are treated as absent.
- Empty task trees still produce a valid dashboard payload instead of failing.
- Temp files are cleaned via `trap` and final outputs are only replaced with `mv`, which avoids partially written dashboards.

# Key Dependencies

- `jq`
- `find`
- `agent-orchestrator/scripts/validate_approval.sh`
- optional keeper report JSON produced by keeper automation

# Maintenance Notes

- The JSON shape is consumed by the Markdown renderer in the same script; keep both sections aligned if fields change.
- Pending action rules are policy logic. Any new blocked state or approval rule should update both the `jq` aggregation and operator expectations.
