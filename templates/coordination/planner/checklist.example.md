# Planner Checklist Example

This file is a format example only.

Operational planner checklist records are written outside the repository, by default to:

- `~/.openclaw-state/agent-orchestrator/planner/checklist.md`

If `AGENT_ORCHESTRATOR_STATE_DIR` is set to an absolute path, the runtime checklist is written to:

- `$AGENT_ORCHESTRATOR_STATE_DIR/planner/checklist.md`

| checklist_item_id | title | owner_role | status | depends_on | acceptance | notes |
|---|---|---|---|---|---|---|
| CL-01 | Example milestone | planner | TODO |  | sample acceptance | example only |
| CL-02 | Example handoff | planner | TODO | CL-01 | subchecklist complete | example only |
