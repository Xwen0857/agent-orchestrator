# Audit Log Schema (Append-Only)

每条日志记录建议字段：

- `entry_id`
- `timestamp`
- `agent_id`
- `operation_id`
- `task_id`
- `before_state`
- `after_state`
- `before_version`
- `after_version`
- `risk_tier`
- `decision`
- `approval_id` (optional)
- `freeze_state`
- `anomaly_flags`
- `cost_snapshot`
- `prev_hash`
- `entry_hash`
- `signature` (optional)

要求：
- 仅允许追加写入。
- `entry_hash = hash(core_fields + prev_hash)`。
- 任意修改历史记录都应导致链校验失败。
- 必须能回放“谁在何时把任务从什么状态推进到什么状态”。
