# Legacy Task Compatibility

For compatibility with older skills, planner may mirror per-worker task files to:
- templates/coordination/tasks/<worker_id>_tasks.md

The authoritative source of truth in V2 is:
- templates/coordination/tasks/task_folders/<task_id>/meta.json
- templates/coordination/tasks/task_folders/<task_id>/log.ndjson

Legacy runtime artifacts now live outside the repo:
- ~/.openclaw-state/agent-orchestrator/planner/primary.md (format example: templates/coordination/planner/primary.example.md)
- ~/.openclaw-state/agent-orchestrator/planner/checklist.md (format example: templates/coordination/planner/checklist.example.md)
- ~/.openclaw-state/agent-orchestrator/tasks/subchecklists/ (format example: templates/coordination/tasks/subchecklist.example.md)
- ~/.openclaw-state/agent-orchestrator/tasks/worker_tasks/ (format example: templates/coordination/tasks/worker-task.example.md)
