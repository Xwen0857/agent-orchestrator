# Legacy Task Compatibility

For compatibility with older skills, planner may mirror per-worker task files to:
- templates/coordination/tasks/<worker_id>_tasks.md

The authoritative source of truth in V2 is:
- templates/coordination/tasks/task_folders/<task_id>/meta.json
- templates/coordination/tasks/task_folders/<task_id>/log.ndjson

Legacy hierarchy remains available as mirrors:
- templates/coordination/planner/primary.md
- templates/coordination/planner/checklist.md
- templates/coordination/tasks/subchecklists/
- templates/coordination/tasks/worker_tasks/
