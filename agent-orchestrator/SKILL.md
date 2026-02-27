---
name: agent-orchestrator
description: 用于运行 planner-worker-tester-audit 协同流程的入口 skill。用户要求调度多 agent、创建或替换 worker、临时 tester 验证、审计拦截与审批放行时使用。
---

# Agent Orchestrator

## V2 基线（强制优先）
1. 自本版本起，任务执行的唯一事实源为 `templates/coordination/tasks/task_folders/<task_id>/meta.json`。
2. 状态推进必须遵循 `agent-orchestrator/references/state-machine-v2.md`，禁止使用未定义状态跳转。
3. 每次状态变化必须追加写入 `templates/coordination/tasks/task_folders/<task_id>/log.ndjson`，字段遵循 `agent-orchestrator/references/event-log-schema.md`。
4. 任务目录结构必须遵循 `agent-orchestrator/references/task-folder-spec.md`，并优先复用 `templates/coordination/tasks/task_folders/_task_id_` 模板。
5. 并发写入必须执行 `.lock` + `meta.version` 校验 + 原子替换（临时文件后 `rename`）。
6. 旧路径 `templates/coordination/tasks/worker_tasks` 与 `templates/coordination/tasks/*.md` 为兼容视图，不得作为状态主写入目标。

## 核心职责
1. 作为总调度入口，串联 requirement-intake、planner、worker、tester、audit、governance 六类能力。
2. 根据任务目标与风险等级规划执行顺序，推进任务从分配到验收闭环。
3. 在高风险操作前触发 audit-guard 门禁，并根据审批结果决定放行或阻断。
4. 在关键配置变更前后触发 governance-config 快照与回滚点管理。
5. 对外输出统一的执行汇总、异常列表、审批项与下一步建议。
6. 可选调用 keeper 执行知识库治理（去重整并建议、权重重算、容量巡检）。

## 输入文件相对路径
1. orchestrator 入口请求路径：用户请求上下文（会话输入）。
2. 入口需求路径：`templates/coordination/planner/primary.md`。
3. planner 配置路径：`templates/coordination/planner/config/current.md`。
4. planner 属性路径：`templates/coordination/planner/properties.md`。
5. 风险策略定义路径：`audit-guard/references/policy-schema.md`。
6. 审批模板路径：`audit-guard/references/approval-ticket-template.md`。

## 输出文件相对路径
1. 审批单输出路径：`templates/coordination/audit/approvals/<approval_id>.md`。
2. 审计报告输出路径：`templates/coordination/audit/reports/<YYYYMMDD-HH>.md`。
3. 任务分配输出路径（新）：`templates/coordination/tasks/worker_tasks/<worker_id>_tasks.md`。
4. 任务分配输出路径（兼容）：`templates/coordination/tasks/<worker_id>_tasks.md`。
5. worker 状态输出路径：`templates/coordination/workers/<worker_id>_worker.md`。
6. tester 结果读取与汇总路径：`templates/coordination/testers/<run_id>/result.md`。
7. orchestrator 汇总输出路径：`templates/coordination/orchestrator/<YYYYMMDD-HH>.md`。
8. dashboard 输出路径：`templates/coordination/orchestrator/dashboard.md`、`templates/coordination/orchestrator/dashboard.json`。

## 读取文件相对路径
1. 读取 `templates/coordination/planner/config/current.md` 获取当前编排配置。
2. 读取 `templates/coordination/planner/properties.md` 获取执行属性与约束。
3. 读取 `templates/coordination/tasks/worker_tasks` 下任务文件获取全局进度。
4. 读取 `templates/coordination/tasks` 下兼容任务文件补齐旧流程数据。
5. 读取 `templates/coordination/workers` 下 worker 文件获取状态与能力信息。
6. 读取 `templates/coordination/testers` 下测试结果文件驱动验收决策。
7. 读取 `templates/coordination/audit/approvals` 与 `templates/coordination/audit/reports` 获取审批与审计结果。

## 编排执行流程
1. 初始化阶段：加载配置、读取策略、校验依赖文件是否可用。
2. 入口阶段：调用 requirement-intake 标准化需求并写入 `primary.md`。
3. 启动治理阶段：当 `primary.status` 由 `READY` 进入 `STARTED` 时，必须调用 governance-config 记录冻结与审计。
4. 规划阶段：调用 planner-ops 进行任务拆解、分派、worker 生命周期调度。
5. 交付阶段：调用 worker-delivery 执行实现并产出交付记录。
6. 验收阶段：调用 tester-ephemeral 对交付结果执行一次性验收。
7. 风险门禁阶段：涉及高风险动作时调用 audit-guard，按 `ALLOW/MONITOR/BLOCK/BLOCK_PENDING_APPROVAL` 决策处理。
8. 治理阶段：配置变更与回滚场景调用 governance-config 执行快照、审批、回滚管理。
9. 汇总阶段：向 master 输出执行摘要、阻塞项、审批项、建议动作。
10. 看板阶段：调用 `agent-orchestrator/scripts/dashboard_summary.sh` 生成全局 dashboard。
11. keeper 阶段（可选）：当 `keeper_enabled=true` 时调用 `keeper/scripts/keeper_run.sh` 生成治理报告。

## Phase 1 运行脚本
1. `agent-orchestrator/scripts/dashboard_summary.sh`：生成 Active/Pending/Health 看板。
2. `agent-orchestrator/scripts/transition_task_state.sh`：执行带锁、版本校验、幂等键、原子写的状态迁移。
3. `agent-orchestrator/scripts/health_check.sh`：检查 stale task、孤儿锁、缺失工件。
4. `agent-orchestrator/scripts/validate_approval.sh`：校验 `approval.json` 是否可用于解锁。
5. `agent-orchestrator/scripts/auto_recovery.sh`：自动释放陈旧锁并将 stale `IN_PROGRESS` 转为 `BLOCKED_SYSTEM_ERROR`。

## Phase 2 运行脚本
1. `agent-orchestrator/scripts/append_task_event.sh`：在不改状态的前提下追加不可变审计事件。
2. `agent-orchestrator/scripts/verify_task_log_chain.sh`：校验 `log.ndjson` 哈希链完整性。
3. `agent-orchestrator/scripts/seal_task_snapshot.sh`：生成任务快照哈希并写入审计事件。

## Phase 3 运行脚本
1. `agent-orchestrator/scripts/request_clarification.sh`：写入 `clarification_request.md` 并将任务置为 `BLOCKED_AWAITING_CLARIFICATION`。
2. `agent-orchestrator/scripts/respond_clarification.sh`：写入澄清答复并自动恢复到 `IN_PROGRESS`。
3. `agent-orchestrator/scripts/kb_add_entry.sh`：新增知识库条目。
4. `agent-orchestrator/scripts/kb_search.sh`：按关键词检索知识库条目。
5. `agent-orchestrator/scripts/task_link_kb.sh`：把命中条目回链到 `meta.json.knowledge_refs`。
6. `agent-orchestrator/scripts/kb_record_feedback.sh`：记录自纠/人工纠偏反馈事件。
7. `agent-orchestrator/scripts/kb_recompute_scores.sh`：按反馈重算 `score/status`。
8. `agent-orchestrator/scripts/kb_ranked_search.sh`：按“关键词命中 + 权重”联合排序检索。
9. `agent-orchestrator/scripts/kb_submit_candidate.sh`：将知识候选提交到 keeper inbox（不直接写 KB）。

## Phase 4 运行脚本
1. `agent-orchestrator/scripts/config_snapshot.sh`：将当前配置快照为版本并更新 version pointer。
2. `agent-orchestrator/scripts/config_rollback.sh`：按版本回滚 `current.md` 并记录回滚审计日志。
3. `agent-orchestrator/scripts/system_health_check.sh`：汇总 task/config/keeper 三类健康状态并输出报告。

## 强制约束
1. 未获 master 批准不得执行 Tier 1/Tier 2 高风险动作。
2. 高危策略缺失、审批链路不可用或规则解析失败时，默认 `BLOCK`。
3. tester 为一次性实例，结果回传后立即终止，不得常驻复用。
4. 任何关键决策必须落审计记录，且可追溯到审批单或风险评估结果。
5. 任一子流程失败时必须停止向后推进并返回明确 blocker。
6. 未完成 `READY -> STARTED` 的治理记录前，不得进入 planner-ops 拆解阶段。

## 异常与回退策略
1. planner 调度失败：记录原因并降级为人工确认模式。
2. worker 交付失败：回传失败证据并触发重试或替换 worker。
3. tester 验收失败：保留 `failure_code` 与 `fixes`，回流 worker 修复。
4. audit 拦截触发：冻结动作并生成审批单，等待 master 决策。
5. governance 回滚触发：恢复到最近稳定快照并生成回滚审计记录。

## 路径描述
1. 入口需求路径：`templates/coordination/planner/primary.md`。
2. planner 配置路径：`templates/coordination/planner/config`。
3. planner 属性路径：`templates/coordination/planner/properties.md`。
4. 任务与 worker 路径（新）：`templates/coordination/tasks/worker_tasks`、`templates/coordination/workers`。
5. 任务路径（兼容）：`templates/coordination/tasks`。
6. tester 路径：`templates/coordination/testers`。
7. 审计路径：`templates/coordination/audit/approvals`、`templates/coordination/audit/reports`。
8. 编排汇总路径：`templates/coordination/orchestrator`。

## 命名示例
1. `worker_id` 示例：`1700000000_a1b2c`。
2. `run_id` 示例：`run_20260212_153000`。
3. `approval_id` 示例：`APR-20260212-153500`。
4. 审计报告示例：`20260212-16.md`。
5. 任务文件示例：`1700000000_a1b2c_tasks.md`。

## 输出文件命名规则
1. 审批单命名为 `<approval_id>.md`。
2. 审计报告命名为 `<YYYYMMDD-HH>.md`。
3. worker 任务文件命名为 `<worker_id>_tasks.md`。
4. worker 状态文件命名为 `<worker_id>_worker.md`。
5. tester 单次验收目录命名为 `<run_id>`。

## 输出文件生命周期
1. 审批单文件：按事件生成并长期保留，不覆盖历史记录。
2. 审计报告文件：每小时滚动生成，保留完整链路证据。
3. worker 任务文件：任务状态变化时更新，保持最新执行状态。
4. worker 状态文件：worker 生命周期变化时更新。
5. orchestrator 汇总结果：每轮编排结束生成一次，并作为下一轮输入参考。

## 输出内容格式
1. orchestrator 执行汇总内容格式：
```| timestamp | orchestration_id | status | active_workers | pending_approvals | blockers | next_actions |
|---|---|---|---|---|---|---|
```
2. 审批项摘要内容格式：
```| timestamp | approval_id | risk_tier | operation | decision | approver | notes |
|---|---|---|---|---|---|---|
```
3. 阻塞项摘要内容格式：
```| timestamp | source_stage | blocker_code | impact | owner | resolution_hint |
|---|---|---|---|---|---|
```
4. 子流程状态快照内容格式：
```| timestamp | planner_status | worker_status | tester_status | audit_status | governance_status |
|---|---|---|---|---|---|
```
