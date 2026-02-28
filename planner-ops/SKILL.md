---
name: planner-ops
description: 负责任务需求接入、任务拆解、分配、进度监控、worker 生命周期管理（创建、弃用、替换）与超时治理。
---

# Planner Ops

## V2 基线（强制优先）
1. planner-ops 必须在 `templates/coordination/tasks/task_folders/<task_id>/meta.json` 上进行状态推进，禁止通过 `*_tasks.md` 推断真实状态。
2. `CREATED -> PLANNED -> ASSIGNED` 为 planner 主负责链路，转移时必须校验 `meta.version` 并追加事件日志。
3. 所有分配动作必须生成 `operation_id`（幂等键）；重试时复用同一 `operation_id`，不得重复生效。
4. 每次任务分配都必须落地 `plan.md` 追溯字段（`primary_id/checklist_item_id/subchecklist_id`）并在 `meta.artifacts` 中声明。
5. `templates/coordination/tasks/worker_tasks` 继续维护为兼容镜像，但以 task folder 为上游源。

## 核心职责
1. 接收并维护用户原始需求入口文件 `primary.md`。
2. 在接收到启动指令后，将 `primary` 拆解为 `checklist`。
3. 将 `checklist` 拆解为可执行 `subchecklist`，并建立追溯关系。
4. 将 `subchecklist` 进一步拆解并分配为 worker 可直接执行的任务文件。
5. 维护任务状态机、worker 生命周期、替换映射与替换日志。
6. 读取 tester 验收结果，驱动重试、替换或任务收敛。

## 输入文件相对路径
1. primary 需求入口文件路径：`templates/coordination/planner/primary.md`。
2. checklist 运行记录路径：`$AGENT_ORCHESTRATOR_STATE_DIR/planner/checklist.md`（若未设置，则默认 `~/.openclaw-state/agent-orchestrator/planner/checklist.md`）。
3. checklist 示例模板路径：`templates/coordination/planner/checklist.example.md`。
4. subchecklist 目录路径：`templates/coordination/tasks/subchecklists`。
5. worker 任务目录路径：`templates/coordination/tasks/worker_tasks`。
6. 兼容 worker 任务路径（旧）：`templates/coordination/tasks/<worker_id>_tasks.md`。

## 输出文件相对路径
1. checklist 运行记录路径：`$AGENT_ORCHESTRATOR_STATE_DIR/planner/checklist.md`（默认 `~/.openclaw-state/agent-orchestrator/planner/checklist.md`）。
2. subchecklist 文件路径：`templates/coordination/tasks/subchecklists/<subchecklist_id>.md`。
3. worker 任务文件路径：`templates/coordination/tasks/worker_tasks/<worker_id>_tasks.md`。
4. worker 状态文件路径：`templates/coordination/workers/<worker_id>_worker.md`。
5. worker 生命周期文件路径：`templates/coordination/worker_lifecycle/<worker_id>_lifecycle.md`。
6. 替换日志路径：`templates/coordination/replacement_log.md`。
7. 替换映射路径：`templates/coordination/worker_replacement_mapping.md`。

## 读取文件相对路径
1. 读取 `templates/coordination/planner/primary.md` 判断需求是否完整、是否可启动。
2. 读取运行态 checklist（默认 `~/.openclaw-state/agent-orchestrator/planner/checklist.md`）获取阶段目标和验收项；格式参考 `templates/coordination/planner/checklist.example.md`。
3. 读取 `templates/coordination/tasks/subchecklists` 获取可分配的任务子项。
4. 读取 `templates/coordination/tasks/worker_tasks` 与旧路径 `templates/coordination/tasks/*.md` 获取执行进度。
5. 读取 `templates/coordination/testers/tester_logs/<worker_id>_test_logs.md` 获取验收反馈。

## primary接入与启动门禁
1. `primary.md` 是唯一需求入口（Single Source of Truth），在启动前仅允许在此处更新需求。
2. `primary.md` 至少包含：需求描述、范围、约束、验收标准、优先级、启动状态。
3. 启动状态必须从 `DRAFT -> READY -> STARTED` 单向推进。
4. 未达到 `READY` 或未收到显式启动指令时，不得生成 checklist/subchecklist/worker tasks。
5. 启动后应冻结 primary 的核心需求字段，仅允许追加澄清信息。

## 分解流程（Primary -> Checklist -> Subchecklist -> Worker Tasks）
1. 第一步：将 `primary.md` 拆解为运行态 checklist（阶段目标与里程碑，仓库内仅保留 `checklist.example.md` 作为示例）。
2. 第二步：将每个 checklist 项拆成 `subchecklist` 文件，确保每项可独立验证。
3. 第三步：将 subchecklist 拆成 worker 可执行任务，写入 `worker_tasks/<worker_id>_tasks.md`。
4. 第四步：为每个 worker task 标注 `primary_id`、`checklist_item_id`、`subchecklist_id` 追溯链。
5. 第五步：任务派发后同步生成旧路径镜像 `tasks/<worker_id>_tasks.md`（兼容旧技能）。

## 单一事实源与兼容策略
1. `templates/coordination/tasks/task_folders/<task_id>/meta.json` 是任务执行的唯一事实源（source of truth）。
2. `templates/coordination/tasks/<worker_id>_tasks.md` 是兼容镜像（mirror），不得作为主写入目标。
3. mirror 仅由 planner-ops 同步维护，worker-delivery 与 tester-ephemeral 不直接写入 mirror。
4. 写入顺序必须是“先更新 source，再同步 mirror”；同步失败需记录 blocker。
5. 读取顺序必须是“先读 source，缺失时再读 mirror”。
6. 若 source 与 mirror 冲突，以 source 为准并触发一次一致性修复。

## worker管理方式
1. 创建 worker 时，生成唯一 `worker_id` 并记录初始状态。
2. 按优先级、依赖关系、容量上限分配 worker 任务。
3. 根据 tester 结果和任务进度动态调整分配与替换策略。
4. 生命周期事件（创建、替换、退役）必须写入 `<worker_id>_lifecycle.md`。
5. 替换事件必须同步写入 `replacement_log.md` 与 `worker_replacement_mapping.md`。

## worker替换及弃用条件
1. 执行超时：单任务执行时长超过 1 小时。
2. 质量不达标：最近窗口 tester 达标率低于 50%。
3. 阶段完成：worker 完成绑定阶段任务后按策略退役。

## 监控和调整策略
1. 每 10 分钟轮询 worker tasks 进度并回写状态。
2. 每 30 分钟汇总 worker 表现并评估是否触发替换。
3. 每 30 分钟读取 tester 日志并更新任务分配策略。
4. 每 3 小时审视 checklist/subchecklist 结构，必要时重平衡任务拆分。

## 路径描述
1. 需求入口路径：`templates/coordination/planner/primary.md`。
2. 规划清单运行路径：`$AGENT_ORCHESTRATOR_STATE_DIR/planner/checklist.md`（默认 `~/.openclaw-state/agent-orchestrator/planner/checklist.md`）；示例模板：`templates/coordination/planner/checklist.example.md`。
3. 子任务清单路径：`templates/coordination/tasks/subchecklists`。
4. worker 任务路径：`templates/coordination/tasks/worker_tasks`。
5. 兼容 worker 任务路径：`templates/coordination/tasks`。

## 命名示例
1. `primary_id` 示例：`primary_20260212_150000`。
2. `checklist_item_id` 示例：`CL-01`。
3. `subchecklist_id` 示例：`SCL-01-03`。
4. `worker_id` 示例：`1700000000_a1b2c`。
5. worker 任务示例：`1700000000_a1b2c_tasks.md`。

## 输出文件命名规则
1. subchecklist 文件命名为 `<subchecklist_id>.md`。
2. worker 任务文件命名为 `<worker_id>_tasks.md`。
3. worker 生命周期文件命名为 `<worker_id>_lifecycle.md`。
4. worker 状态文件命名为 `<worker_id>_worker.md`。
5. 替换日志固定命名为 `replacement_log.md`。
6. 替换映射固定命名为 `worker_replacement_mapping.md`。

## 输出文件生命周期
1. `primary.md`：需求启动前持续编辑，启动后核心字段冻结。
2. 运行态 checklist：每轮规划更新，滚动保留最近12次主要调整；该文件不纳入工程仓库。
3. `subchecklists/*.md`：按阶段更新，阶段关闭后转为只读。
4. `worker_tasks/*.md`：任务状态变化时更新，保持最新执行状态。
5. `replacement_log.md` 与 `worker_replacement_mapping.md`：替换事件触发时追加更新。

## 输出文件内容格式
1. `templates/coordination/planner/primary.md` 文件内容格式：
```| primary_id | title | scope | constraints | acceptance_criteria | priority | status | start_signal |
|---|---|---|---|---|---|---|---|
```
2. `templates/coordination/planner/checklist.example.md` 示例内容格式：
```| checklist_item_id | title | owner_role | status | depends_on | acceptance | notes |
|---|---|---|---|---|---|---|
```
3. `templates/coordination/tasks/subchecklists/<subchecklist_id>.md` 文件内容格式：
```| subchecklist_id | checklist_item_id | title | status | verification_rule | notes |
|---|---|---|---|---|---|
```
4. `templates/coordination/tasks/worker_tasks/<worker_id>_tasks.md` 文件内容格式：
```| task_id | primary_id | checklist_item_id | subchecklist_id | title | owner_role | status | priority | attempts | notes |
|---|---|---|---|---|---|---|---|---|---|
```
5. `templates/coordination/workers/<worker_id>_worker.md` 文件内容格式：
```| timestamp | worker_task | owner_role | status | performance_metrics | notes |
|---|---|---|---|---|---|
```
6. `templates/coordination/worker_lifecycle/<worker_id>_lifecycle.md` 文件内容格式：
```| timestamp | worker_task | owner_role | lifecycle_event | status | notes |
|---|---|---|---|---|---|
```
7. `templates/coordination/replacement_log.md` 文件内容格式：
```| timestamp | replaced_worker_id | replacement_reason | new_worker_id | notes |
|---|---|---|---|---|
```
8. `templates/coordination/worker_replacement_mapping.md` 文件内容格式：
```| timestamp | replaced_worker_id | new_worker_id | replacement_reason | notes |
|---|---|---|---|---|
```

## 权限声明（用于自动ACL生成）
- allowed_read_paths: `templates/coordination/planner`, `templates/coordination/tasks/subchecklists`, `templates/coordination/tasks/worker_tasks`, `templates/coordination/workers`, `templates/coordination/worker_lifecycle`, `templates/coordination/tasks/task_folders`, `runtime/workdomains`, `projects`, `~/.openclaw-state/agent-orchestrator/planner`
- allowed_write_paths: `templates/coordination/planner`, `templates/coordination/tasks/subchecklists`, `templates/coordination/tasks/worker_tasks`, `templates/coordination/workers`, `templates/coordination/worker_lifecycle`, `templates/coordination/tasks/task_folders`, `runtime/workdomains`, `~/.openclaw-state/agent-orchestrator/planner`
- forbidden_paths: `templates/coordination/security/acl_denied.ndjson`
