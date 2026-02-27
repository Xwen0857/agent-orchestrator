---
name: audit-guard
description: 提供多级风险评估、动态威胁检测与主审批网关，用于治理 Agent 的高风险操作；命中高危时拦截、冻结并等待 master 批准后放行。
---

# Audit Guard

## V2 基线（强制优先）
1. 命中需审批规则时，统一将任务状态写为 `BLOCKED_PENDING_APPROVAL`（替代旧名 `BLOCKED_PENDING_MASTER_APPROVAL`）。
2. gate 决策必须同时写入：
 - `templates/coordination/tasks/task_folders/<task_id>/audit.md`
 - `templates/coordination/tasks/task_folders/<task_id>/log.ndjson`
3. 放行条件是 `templates/coordination/tasks/task_folders/<task_id>/approval.json` 存在且有效；未满足前不得恢复执行。
4. 审计日志字段以 `agent-orchestrator/references/event-log-schema.md` 与 `audit-guard/references/audit-log-schema.md` 的交集为最低要求，必须包含哈希链字段。

## 何时使用
- planner 将要执行可能高风险的操作。
- 需要对操作进行风险分级、冻结审批、审计留痕。
- 需要紧急越权（break-glass）并保留完整证据。

## 输入
- `operation_request`：拟执行动作、参数、目标对象、执行人、来源任务。
- `runtime_context`：当前系统状态、近 1h 行为统计、token/cost、并发负载。
- `policy_config`：风险规则、审批策略、SLA、越权开关。

## 输出
- `gate_decision`：`ALLOW` | `MONITOR` | `BLOCK` | `BLOCK_PENDING_APPROVAL`.
- `risk_assessment`：风险等级、命中规则、影响面、预演结果。
- `approval_ticket`（若需）：提交 master 的审批单。
- `audit_log_entry`：不可篡改日志记录。

## 风险分级

### Tier 1: CRITICAL (必须人工审批)
- 系统级破坏或不可逆影响（例如：`sudo`、生产数据库结构/数据直接变更）。
- 安全边界变更（权限边界、白名单、密钥暴露）。
- 代码库强制历史覆盖（例如：`git push --force`）。
- 网络暴露高风险行为（公网暴露本地服务）。

默认动作：`BLOCK_PENDING_APPROVAL`。

### Tier 2: HIGH (策略驱动审批)
- 破坏性文件操作（例如：`rm`）。
- 大范围状态回滚（例如：`git reset --hard`）。
- 明显的成本放大（并发或资源规格骤增）。
- 未知模块调用、未知 Bash 指令执行。
- 可疑注入模式命中。

默认动作：`BLOCK_PENDING_APPROVAL`；仅在明确白名单策略下可降为 `MONITOR`。

### Tier 3: MONITORED (记录 + 阈值告警)
- 短时高频 API 调用。
- 配置参数批量变更。
- 测试标准放宽。

默认动作：`MONITOR`；超过阈值升级为 Tier 2。

## 动态行为分析规则
1. **频率异常**：同类高风险动作在 `window_minutes` 内超过阈值。
2. **序列异常**：出现高危链路（如“放宽测试 -> 提高并发 -> 强制回滚”）。
3. **基线偏移**：当前 token/cost 或失败率显著偏离近 24h 基线。
4. **上下文冲突**：动作意图与任务目标不一致（例如文档任务触发数据库变更）。

## 门禁工作流
1. 检测与评估：匹配静态规则 + 动态行为分析。
2. 冻结与打包：命中 Tier 1/2 时冻结动作，生成决策上下文包。
3. 状态变更：`BLOCKED_PENDING_MASTER_APPROVAL`。
4. 通知 master：提交审批单。
5. 执行决策：
- 批准：发放一次性许可并放行。
- 拒绝：终止动作，保留冻结记录。
6. 全程记录：写入 append-only 审计日志。

## 审批 SLA 与超时
- `approval_sla_minutes` 默认 30。
- 超时策略默认 `DENY_AND_KEEP_FROZEN`。
- 超时后必须发送升级告警并等待 master 明确处置。

## 紧急越权 (Break-Glass)
- 仅用于无法及时审批且业务必须继续的极端场景。
- 触发前必须生成系统快照并记录触发原因。
- 每 4 小时最多 1 次。
- 需要至少 2 名管理员授权（或全管理员一致）。
- 放行范围仅限指定操作与时效窗口。
- 使用本身视为严重安全事件并强制告警。

## 实施约束
- 不允许在无审批票据时执行 Tier 1/2 动作。
- 任何放行都必须绑定 `approval_id` 与失效时间。
- 审计日志必须使用哈希链字段（`prev_hash`, `entry_hash`）。

## 执行步骤
1. 加载 `references/policy-schema.md` 并校验规则结构。
2. 对请求执行风险评估并生成 `risk_assessment`。
3. 若需审批，按 `references/approval-ticket-template.md` 生成票据。
4. 记录 `audit_log_entry`，字段遵循 `references/audit-log-schema.md`。
5. 按审批结果更新状态并结束本次门禁。

## Phase 2 脚本入口
1. `audit-guard/scripts/evaluate_gate.sh`：执行强制门禁，命中触发器时阻断并生成审批单。
2. `templates/coordination/audit/policy/current.json`：当前生效策略。
3. `references/gate-required-triggers.md`：必须审批触发条件定义。
4. `audit-guard/scripts/grant_approval.sh`：审批通过后写入 `approval.json`，作为解锁唯一凭据。
5. `audit-guard/scripts/record_kb_feedback.sh`：将 auditor 对纠偏质量的评估回写到 KB 反馈日志。

## 权限声明（用于自动ACL生成）
- allowed_read_paths: `templates/coordination/audit`, `templates/coordination/tasks/task_folders`, `templates/coordination/orchestrator`, `templates/coordination/security`, `projects`, `runtime/workdomains`
- allowed_write_paths: `templates/coordination/audit`, `templates/coordination/tasks/task_folders`, `templates/coordination/security`
- forbidden_paths: `templates/coordination/tasks/worker_tasks`
