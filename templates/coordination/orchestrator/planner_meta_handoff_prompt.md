# Planner Meta Pipeline Handoff Prompt

Last updated: 2026-03-06
Scope: planner-core / receptionist ingress / replan runtime coordination

## Copy-Paste Prompt For Next Session

你是该仓库的工程协作代理。请基于以下前情提要继续进行规划与方案设计，不要先做大规模重构，先对齐边界与实施顺序。

### 1. 已确认的架构定位（必须遵守）

- `planner-core` 是 planning/decision 单元，不是 scheduler。
- `planner-core` 负责：
  - 规划输入建模（request/decomposition/refinement）
  - split-plan 契约化与 fail-fast 校验
  - 规划语义投影（projection）
- `planner-core` 不负责：
  - DAG 并发调度执行
  - 运行时释放门控
  - scheduler 级拓扑控制
- 当前依赖模式固定为 `component_semantic_linearized`，定位为 planning hint，不是完整调度 DAG。

### 2. 当前 core 接收 Meta 的方式

- 入口为 `planner_entry.sh --task-dir`。
- 不是单独吃一份“meta协议包”，而是合并 `task-local strategy + meta`。
- 关键来源：
  - `meta.json`：`id`、`parent_task_id` 等身份信息
  - `strategy.summary_input`：`task_goal/constraints/deliverables/notes`
  - `strategy.budget/workspace`
  - runtime isolation / execution target
- request 权威语义为 `request_authority = task_local_strategy_meta`。

### 3. 当前“反复增补 Meta”处理机制（已实现）

- 入口端增补先进入 amendment queue。
- 入口端将增补写入 append-only log，并编译单一 `effective_patch`。
- `planner_apply_amendment_batch.sh` 主消费 `planner-effective-patch-v2`，将其应用到 strategy/meta。
- `planner-amendment-batch-v1` 若存在，仅作为兼容/审计 breadcrumb，不是 planner 权威输入。
- 应用后写入 replan 状态机字段：
  - `planner_replan.status=queued`
  - `planner_replan.impact`
  - `planner_replan.worker_policy`
  - `planner_replan.latest_effective_patch_path`
  - `planner_replan.latest_amendment_batch_path`
  - `runtime_replan.consume_status=pending_consume` 由 consume 桥接层投影
- `orchestrate_once.sh` 每个 tick 会优先消费 `queued` replan，再决定是否继续常规执行。
- 策略分支：
  - `continue` -> `ready`
  - `revalidate_then_resume` -> `awaiting_revalidation` 后置 `ready`
  - `pause_and_require_replan` -> `paused` + `BLOCKED_AWAITING_CLARIFICATION`

### 4. 本 session 的关键判断（已达成）

- core 侧当前阶段可视为“基本收敛”，进入维护状态。
- core 契约层继续 `fail-fast`，不做坏数据自动修复。
- DAG 执行治理不应进入 core，应落在 `scheduler-ops / observer`。
- 若做 DAG，应先有明确消费者（ops/observer/replan/UI），再反推 core 产物。

### 5. 关于 Meta 增补模型的目标方案（讨论结论）

采用“日志 + 压缩快照”混合模型，而不是纯拼贴：

- 保留 append-only 多批次日志，保证实时性和审计可追溯。
- 维护单一 `effective_patch`（压缩快照），planner 仅消费这一份；`batch-v1` 不再是权威输入。
- 用版本水位控制消费一致性：
  - `head_version`
  - `applying_version`
  - `consumed_version`
- 防饥饿机制：
  - `max_wait_ms` 到点放行
  - `max_batch_count` 到阈值放行
- 去重必须是语义归并，不是 JSON 拼贴：
  - `task_goal`：last-write-wins + 历史保留
  - `constraints/deliverables`：集合并去重
  - `budget/workspace`：合法值覆盖 + 校验
  - `notes`：主题折叠

### 6. Agent 解码模式下的职责边界（已达成）

- 入口 Agent 可读日志（MCP 只读上下文）做“第一步语义预去重”。
- 但最终权威去重与状态推进必须由 TS/脚本确定性层执行。
- 必须保留证据字段，如 `dedupe_basis`、来源版本、冲突集。
- 禁止让 Agent 直接修改队列水位或消费状态。

### 7. 下一阶段 plan 任务创建要求

- 不要直接改 scheduler 行为。
- 先做“Meta pipeline 治理计划”，目标是：
  - 单一可消费 `effective_patch`
  - 版本水位一致性
  - 防饥饿
  - 冲突治理
  - 可审计回放
- 计划中需要明确：
  - API/类型变更（batch log、snapshot、watermark）
  - 失败模式（冲突、过期、并发覆盖）
  - 测试矩阵（高频增补、乱序到达、重复补丁、长时间饥饿）
  - rollout 步骤（observe -> enforce）

### 8. 当前基线状态（用于计划前提）

- `planner-contract-lane`：通过
- `typecheck`：通过
- `full-plugin-regression`：通过
- core 已完成维护加固：
  - boundary tests
  - dependency config schema + consistency tests
  - summary 对账增强
  - legacy-v0 迁移守护
  - split-plan extract 轻量 observability hook

请在下一步输出一份“Meta Pipeline 治理计划”，并遵守以上边界，不要把 DAG 执行逻辑塞回 planner-core。
