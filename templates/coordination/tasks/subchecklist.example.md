# Subchecklist Example

This file is a format example only.

Operational subchecklist records are written outside the repository, by default to:

- `~/.openclaw-state/agent-orchestrator/tasks/subchecklists/`

If `AGENT_ORCHESTRATOR_STATE_DIR` is set to an absolute path, the runtime directory is:

- `$AGENT_ORCHESTRATOR_STATE_DIR/tasks/subchecklists/`

| subchecklist_id | checklist_item_id | title | status | verification_rule | notes |
|---|---|---|---|---|---|
| SCL-EXAMPLE-01 | CL-01 | Example subtask | READY | sample verification | example only |
