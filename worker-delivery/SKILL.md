---
name: worker-delivery
description: 负责按 planner 指令完成代码或文档交付，提交结构化执行结果并进入 tester 验收。
---

# Worker Delivery

## V2 基线（强制优先）
1. worker-delivery 进入任务前必须读取 `templates/coordination/tasks/task_folders/<task_id>/meta.json`，并确认状态为 `ASSIGNED` 或 `IN_PROGRESS`。
2. worker 负责 `ASSIGNED -> IN_PROGRESS -> TESTING` 的推进；每次推进必须记录到 `log.ndjson`。
3. 执行中累计消耗必须写入 `meta.consumption` 并同步事件日志；超过预算 80% 记录 `WARN_BUDGET`，达到 100% 必须转 `BLOCKED_PENDING_APPROVAL`。
4. 发生歧义时必须写 `clarification_request.md` 并将状态置为 `BLOCKED_AWAITING_CLARIFICATION`，不得静默等待。
5. 运行态 `worker_tasks/<worker_id>_tasks.md` 位于仓外状态目录；`templates/coordination/tasks/<worker_id>_tasks.md` 仅作兼容镜像，不作为真实状态读写依据。
6. worker 开工前应执行知识库检索并将命中条目回链到 `meta.knowledge_refs`。
7. 当 `keeper_enabled=true` 时，worker 不得直接写入 `knowledge-base/entries`，新增经验必须先提交候选到 keeper 队列；当 `keeper_enabled=false` 时可按旧路径直接写入。

## 核心职责
1. 根据 `task_id` 与 worker 指令完成实现，确保交付范围不越界。
2. 产出可复现的交付记录：改动清单、关键命令、结果摘要与风险说明。
3. 在交付后生成 tester 交接材料，触发临时 tester 验收。
4. 在验收前不得声明完成；验收失败时按反馈进行修复并重新交接。
5. 持续更新 worker 执行状态，保证 planner 能够读取到最新进度。

## 输入文件相对路径
1. `interface.json` 文件路径：项目根目录 `interface.json`。
2. worker 初始化/指令文件路径：`templates/coordination/workers/<worker_id>_worker.md`。
3. worker 任务运行文件路径（新）：`$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks/<worker_id>_tasks.md`（默认 `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks/<worker_id>_tasks.md`）。
4. worker 任务文件路径（兼容）：`templates/coordination/tasks/<worker_id>_tasks.md`。
5. planner 当前配置路径：`templates/coordination/planner/config/current.md`。
6. planner 属性配置路径：`templates/coordination/planner/properties.md`。

## 输出文件相对路径
1. worker 交付日志文件路径：`templates/coordination/workers/<worker_id>_delivery.md`。
2. worker 改动清单文件路径：`templates/coordination/workers/<worker_id>_change_manifest.md`。
3. tester 交接任务文件路径：`templates/coordination/testers/<run_id>/task.md`。
4. tester 交接摘要文件路径：`templates/coordination/testers/tester_logs/<worker_id>_handoff.md`。
5. worker 任务状态回写运行路径（新）：`$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks/<worker_id>_tasks.md`。
6. worker 任务兼容镜像路径（只读）：`templates/coordination/tasks/<worker_id>_tasks.md`。

## 读取文件相对路径
1. 读取运行态 `worker_tasks/<worker_id>_tasks.md`（默认 `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks/<worker_id>_tasks.md`）获取待办任务、优先级和截止时间。
2. 若新路径文件不存在，则回退读取 `templates/coordination/tasks/<worker_id>_tasks.md`。
3. 读取 `templates/coordination/workers/<worker_id>_worker.md` 获取 worker 角色和能力约束。
4. 读取 `templates/coordination/planner/config/current.md` 获取当前生效配置。
5. 读取 `templates/coordination/planner/properties.md` 获取执行属性和限制项。
6. 读取 `templates/coordination/testers/<run_id>/result.md` 获取验收结果并驱动修复闭环。

## worker交付流程
1. 读取输入文件并确认本次 `task_id` 的目标、范围、完成标准。
2. 执行实现并记录关键步骤：改动文件、关键命令、关键输出。
3. 本地自测并记录结果：通过项、失败项、已知风险与临时规避方案。
4. 生成交付日志与改动清单，回写 `tasks` 文件中对应任务状态。
5. 生成 tester 任务文件 `templates/coordination/testers/<run_id>/task.md`，写入测试范围与通过标准。
6. 生成 tester 交接摘要并通知进入 tester 验收。
7. 若 tester 返回 `FAIL`，依据 `result.md` 的 `failure_code` 和 `fixes` 修复后重新执行第 3-6 步。

## 交付约束
1. 仅允许修改任务授权范围内的代码和文档路径。
2. 未通过 tester 验收前，任务状态不得标记为 `DONE`。
3. 必须保留可追溯证据：命令、关键输出、改动清单、风险说明。
4. 禁止跳过配置约束；若与 `current.md` 冲突，必须先上报 blocker。
5. 高风险操作必须先通过 audit-guard 审批后执行。
6. `tasks` 兼容镜像文件由 planner-ops 统一同步，worker-delivery 不直接写入 mirror。

## 阻塞与异常处理
1. 发现需求不明确、依赖缺失或权限不足时，立即在交付日志记录 blocker。
2. blocker 需包含：影响范围、复现条件、建议处理方式、是否需要 planner 介入。
3. tester 连续两次 `FAIL` 时，必须追加根因分析并回传 planner 决策。
4. 若出现安全或合规风险，立即停止交付并按 audit-guard 流程上报。

## 路径描述
1. worker 输入任务运行路径（新）：`$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks`（默认 `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks`）。
2. worker 输入任务路径（兼容）：`templates/coordination/tasks`。
3. worker 输入状态路径：`templates/coordination/workers`。
4. tester 任务与结果路径：`templates/coordination/testers/<run_id>`。
5. tester 交接日志路径：`templates/coordination/testers/tester_logs`。
6. planner 配置路径：`templates/coordination/planner/config/current.md`。

## 命名示例
1. `worker_id` 示例：`1700000000_a1b2c`。
2. `run_id` 示例：`run_20260212_153000`。
3. worker 交付日志示例：`1700000000_a1b2c_delivery.md`。
4. worker 改动清单示例：`1700000000_a1b2c_change_manifest.md`。
5. tester 交接摘要示例：`1700000000_a1b2c_handoff.md`。

## 输出文件命名规则
1. worker 交付日志命名为 `<worker_id>_delivery.md`。
2. worker 改动清单命名为 `<worker_id>_change_manifest.md`。
3. tester 交接摘要命名为 `<worker_id>_handoff.md`。
4. tester 单次验收目录命名为 `<run_id>`，目录内固定文件为 `task.md` 与 `result.md`。

## 输出文件生命周期
1. `<worker_id>_delivery.md`：每次交付后追加更新，滚动保留最近12次交付记录。
2. `<worker_id>_change_manifest.md`：每次交付后覆盖更新为当前任务最新改动集。
3. `<worker_id>_handoff.md`：每次提交 tester 前更新，滚动保留最近12次交接记录。
4. `<worker_id>_tasks.md`：每次任务状态变化后更新，保持与实际执行一致。

## 输出文件内容格式
1. `<worker_id>_delivery.md` 文件内容格式：
```| timestamp | task_id | worker_id | status | summary | self_test | risks | blockers |
|---|---|---|---|---|---|---|---|
```
2. `<worker_id>_change_manifest.md` 文件内容格式：
```| timestamp | file_path | change_type | related_task_id | notes |
|---|---|---|---|---|
```
3. `templates/coordination/testers/<run_id>/task.md` 文件内容格式：
```run_id:
worker_id:
commit_sha:
scope:
commands:
pass_criteria:
```
4. `<worker_id>_handoff.md` 文件内容格式：
```| timestamp | run_id | task_id | handoff_summary | known_risks | next_action |
|---|---|---|---|---|---|
```
5. `<worker_id>_tasks.md` 至少包含：`task_id`、`status`、`attempts`、`notes`，并与 planner 任务状态保持一致。

## 权限声明（用于自动ACL生成）
- allowed_read_paths: `templates/coordination/tasks/task_folders`, `templates/coordination/workers`, `templates/coordination/planner`, `runtime/workdomains`
- allowed_write_paths: `templates/coordination/tasks/task_folders`, `templates/coordination/testers`, `runtime/workdomains`
- forbidden_paths: `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks`, `templates/coordination/planner/config`, `templates/coordination/audit/policy`
