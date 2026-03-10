# Entry Agent Decode Contract

This contract defines how the entry agent interprets orchestrator runtime signals.

The entry agent is a decoder:
- It reads structured runtime `meta`.
- It explains state and suggests safe next commands.
- It does not execute tasks.
- It does not invent planner semantics.

## Input Meta

The only trusted runtime signal surface for the entry agent is the explicit block below:

```text
BEGIN_ORCHESTRATE_AGENT_META
{ ...json... }
END_ORCHESTRATE_AGENT_META
```

The JSON payload uses `schema_version = "orchestrate-agent-meta-v1"`.

The entry agent must treat this block as the source of truth for:
- session lifecycle state
- current draft facts
- amendment queue state
- entry action route state
- planner replan state
- runtime guardrails
- recommended trigger commands

If the block is missing, the entry agent should fall back to generic orchestrate receptionist guidance and avoid claiming runtime-specific state.

## Interpretation Rules

### Session

- `session.conversation_status = "ACTIVE_DRAFTING"`:
  focus on clarifying goals, constraints, project id, and workspace details.
- `session.conversation_status = "SUMMARY_READY"`:
  explain that the intake is structured and ready for `/orchestrate run`.
- `session.conversation_status = "RUNNING"`:
  explain progress, amendments, or replan state. Do not imply direct execution control.
- `session.conversation_status = "CLOSED"`:
  explain that no active orchestrate intake is attached.

### Entry Action Route

- `action.route = "amend_existing_task"`:
  explain that updates are being interpreted as changes to the currently bound running task.
- `action.route = "intake_new_task"`:
  guide the user to fill missing configuration (`task_goal/project_id/workspace_root`) for a new intake flow.
  this route implies intake drafting context even if a historical running task exists.
- `action.route = "clarify_target"`:
  ask one closed clarification question first; do not imply planner-side updates happened.

- if `action.clarification_required = true`:
  prioritize clarification before recommending execution-oriented commands.

### Replan

- `replan.status = "queued"`:
  explain that planner-facing structured changes have been queued for absorption.
- `replan.status = "applied"`:
  explain that planner input state was updated and the runtime is following the declared worker policy.
- `replan.status = "resolved"`:
  explain that the explicit replan cycle has been resumed or cleared.

- `replan.impact = "soft"`:
  describe this as a low-impact update that should not interrupt normal execution.
- `replan.impact = "refresh_required"`:
  describe this as a medium-impact update that requires a revalidation pass before execution fully resumes.
- `replan.impact = "hard"`:
  describe this as a high-impact update that changed core execution intent and may block progress until explicitly resumed.

- `replan.worker_policy = "continue"`:
  explain that execution can continue normally.
- `replan.worker_policy = "revalidate_then_resume"`:
  explain that the next safe step is runtime revalidation, then execution resumes.
- `replan.worker_policy = "pause_and_require_replan"`:
  explain that execution is paused pending explicit replan recovery.

### Runtime Guard

- `runtime_guard.should_block_side_effects = true`:
  do not encourage direct side-effectful behavior.
  Limit guidance to explanation, clarification, and safe orchestrate commands.

## Action Guidance

- If `recommended_triggers.summary = true`, the agent may suggest `/orchestrate summary`.
- If `recommended_triggers.status = true` and `run.task_id` is present, the agent may suggest `/orchestrate status <task_id>`.
- If `recommended_triggers.resume_task_id` is non-null, the agent may suggest `/orchestrate resume <task_id>`.
- If `recommended_triggers.clarify = true`, the agent should ask for target clarification before further action.
- If all recommended triggers are absent, the agent should explain the current state without inventing a command recommendation.

The entry agent must never:
- choose single or multi mode
- rewrite planner semantics
- claim that raw user chat is sent directly to planner
- bypass orchestrate command boundaries
