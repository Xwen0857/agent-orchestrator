# Dashboard Summary

Generated at: 2026-02-27T07:37:47Z

## Active Pipelines

| task_id | state | stage | owner | risk_level | token% | time% | updated_at |
|---|---|---|---|---|---|---|---|
| task_once_created_auto_052809 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T07:31:40Z |
| task_once_created_auto_052809_c001 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T07:11:40Z |
| task_once_created_auto_052809_c002 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T07:26:40Z |
| task_once_created_auto_052809_c003 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T06:31:30Z |
| task_once_created_auto_052809_c004 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T06:42:40Z |
| task_once_created_auto_052809_c005 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T07:31:30Z |
| task_once_created_auto_052809_c006 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T07:29:41Z |
| task_planner_entry_multi_052809 | CREATED | INTAKE | planner-core | HIGH | 0 | 0 | 2026-02-27T07:37:42Z |
| task_planner_entry_multi_052809_c001 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T05:31:18Z |
| task_planner_entry_multi_052809_c002 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T05:31:33Z |
| task_planner_entry_multi_052809_c003 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T05:31:39Z |
| task_planner_entry_multi_052809_c004 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T05:31:41Z |
| task_planner_entry_multi_052809_c005 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T05:31:53Z |
| task_planner_entry_multi_052809_c006 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | HIGH | 0 | 0 | 2026-02-27T05:31:59Z |
| task_planner_entry_verify_052703 | BLOCKED_AWAITING_CLARIFICATION | DELIVERY | worker-delivery | MEDIUM | 0 | 0 | 2026-02-27T05:27:31Z |
| task_planner_split_live_032705 | BLOCKED_PENDING_APPROVAL | DELIVERY | audit-guard | HIGH | 0 | 0 | 2026-02-27T03:30:07Z |

## Pending Actions

| task_id | action | owner | approval_id | reason |
|---|---|---|---|---|
| task_once_created_auto_052809 | ANSWER_CLARIFICATION | requester |  | orchestrator: blocked child in aggregate flow |
| task_once_created_auto_052809_c001 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_once_created_auto_052809_c002 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_once_created_auto_052809_c003 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_once_created_auto_052809_c004 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_once_created_auto_052809_c005 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_once_created_auto_052809_c006 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_multi_052809_c001 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_multi_052809_c002 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_multi_052809_c003 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_multi_052809_c004 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_multi_052809_c005 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_multi_052809_c006 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_entry_verify_052703 | ANSWER_CLARIFICATION | requester |  | orchestrator: worker unsupported goal, requires clarification |
| task_planner_split_live_032705 | WAIT_APPROVAL | master |  | orchestrator: aggregate staging failed |

## System Health

- open_tasks: 16
- blocked_tasks: 15
- stale_locks: 
- stale_in_progress: 


## Keeper

- status: OK
- report: templates/coordination/orchestrator/keeper-report.md
