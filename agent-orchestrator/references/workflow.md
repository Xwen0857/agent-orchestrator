# Workflow

1. 创建 task folder：`tasks/task_folders/<task_id>/` 并初始化 `meta.json` 为 `CREATED`。
2. planner 推进 `CREATED -> PLANNED -> ASSIGNED`，并记录 `plan.md`。
3. worker 推进 `ASSIGNED -> IN_PROGRESS -> TESTING`，并记录 `work.md`。
4. tester 推进 `TESTING -> APPROVED|REJECTED`，并记录 `test.md`。
5. audit 对高危动作触发 `BLOCKED_PENDING_APPROVAL`，审批通过后恢复执行。
6. orchestrator 在满足闭环条件时推进 `APPROVED -> CLOSED`，并更新 `audit.md`。
7. 全流程状态变化均追加写入 `log.ndjson`，支持审计回放。
