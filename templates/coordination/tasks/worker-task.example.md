# Worker Task Example

This file is a format example only.

Operational worker task records are written outside the repository, by default to:

- `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks/`

If `AGENT_ORCHESTRATOR_STATE_DIR` is set to an absolute path, the runtime directory is:

- `$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks/`

| task_id | primary_id | checklist_item_id | subchecklist_id | title | owner_role | status | priority | attempts | notes |
|---|---|---|---|---|---|---|---|---|---|
| task_example_001 | primary_example_001 | CL-01 | SCL-EXAMPLE-01 | Example worker task | worker-delivery | ASSIGNED | P1 | 0 | example only |
