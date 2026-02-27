# Tasks

## V2 Recommended (Task Folder)

Authoritative location:

- `templates/coordination/tasks/task_folders/<task_id>/meta.json`

Mandatory files per task:

- `meta.json`
- `plan.md`
- `work.md`
- `test.md`
- `audit.md`
- `log.ndjson`

Minimal `meta.json` example:

```json
{
  "id": "task_demo_001",
  "state": "CREATED",
  "stage": "INTAKE",
  "owner": "planner-ops",
  "risk_level": "MEDIUM",
  "version": 1,
  "budget": {
    "max_token_cost": 50000,
    "max_execution_time_seconds": 3600
  },
  "created_at": "2026-02-13T00:00:00Z",
  "updated_at": "2026-02-13T00:00:00Z",
  "parents": [],
  "artifacts": []
}
```

## Legacy Compatibility

This flat table is retained only for compatibility/mirroring. Do not use it as source-of-truth.

| task_id | title | owner_role | status | priority | started_at | deadline | attempts | notes |
|---|---|---|---|---|---|---|---|---|
