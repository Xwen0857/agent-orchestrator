---
name: tester-ephemeral
description: 根据某个 worker 的交接任务创建一次性 tester，执行本次测试并回传结果后销毁。
---

# Tester Ephemeral

## V2 基线（强制优先）
1. tester-ephemeral 必须从 `templates/coordination/tasks/task_folders/<task_id>/meta.json` 读取任务上下文，且仅在 `TESTING` 状态执行验收。
2. 验收结果仅允许推进为 `APPROVED` 或 `REJECTED`，并强制追加事件到 `log.ndjson`。
3. `result.md/result.json` 必须回链 `task_id` 与 `operation_id`，确保可审计与幂等重放。
4. 若验证过程命中高风险测试动作，必须先交由 audit-guard 决策后再继续。

## 核心职责
1. 根据 worker 交接任务执行一次性测试，不参与长期状态维护。
2. 输出标准化测试结果，供 planner 与 worker 进行验收或修复决策。
3. 对失败项提供可执行修复建议，缩短反馈闭环。
4. 结果回传后立即终止 tester 实例，避免状态污染。

## 输入文件相对路径
1. 测试任务文件路径：`templates/coordination/testers/<run_id>/task.md`。
2. worker 任务运行文件路径（新）：`$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks/<worker_id>_tasks.md`（默认 `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks/<worker_id>_tasks.md`）。
3. worker 任务文件路径（兼容）：`templates/coordination/tasks/<worker_id>_tasks.md`。
4. worker 状态文件路径：`templates/coordination/workers/<worker_id>_worker.md`。
5. 执行接口定义路径：项目根目录 `interface.json`。
6. planner 生效配置路径：`templates/coordination/planner/config/current.md`。

## 输出文件相对路径
1. 测试结果文件路径：`templates/coordination/testers/<run_id>/result.md`。
2. 测试结果结构化文件路径：`templates/coordination/testers/<run_id>/result.json`。
3. tester 日志摘要路径：`templates/coordination/testers/tester_logs/<worker_id>_test_logs.md`。
4. worker 任务回写运行路径（新）：`$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks/<worker_id>_tasks.md`。
5. worker 任务兼容镜像路径（只读）：`templates/coordination/tasks/<worker_id>_tasks.md`。

## 读取文件相对路径
1. 读取 `templates/coordination/testers/<run_id>/task.md` 获取测试范围、命令和通过标准。
2. 优先读取运行态 `worker_tasks/<worker_id>_tasks.md`（默认 `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks/<worker_id>_tasks.md`）获取当前任务状态与尝试次数。
3. 若新路径文件不存在，则回退读取 `templates/coordination/tasks/<worker_id>_tasks.md`。
4. 读取 `templates/coordination/workers/<worker_id>_worker.md` 获取 worker 上下文。
5. 读取 `interface.json` 获取接口或契约约束。
6. 读取 `templates/coordination/planner/config/current.md` 获取当前编排测试策略。

## 生命周期流程
1. 接收 `run_id` 与 worker 交接任务，初始化一次性 tester。
2. 按 `task.md` 中 `commands` 和 `pass_criteria` 执行测试。
3. 生成 `result.md` 与 `result.json`，写入状态、失败码、证据与修复建议。
4. 回写 worker 任务状态（PASS/FAIL）并记录 tester 日志摘要。
5. 将结果回传 orchestrator/planner 后终止 tester。

## 测试模式定义
1. `smoke`：验证最小可运行路径，确保交付产物可启动、可执行或可访问。
2. `functional`：验证本次任务声明的功能点与验收标准。
3. `regression`：验证受影响模块未出现已知行为回退。
4. `contract`：验证接口输入输出、数据结构、字段约束与兼容性。
5. `security`：执行基础安全检查（高危命令、敏感暴露、明显注入风险）。

## 测试模式触发矩阵
1. 默认最小集：`smoke + functional`。
2. 当改动涉及共享模块、公共库或跨任务复用代码时：追加 `regression`。
3. 当改动涉及接口、协议、数据结构或输出格式时：强制 `contract`。
4. 当任务被标记为高风险、涉及权限边界或安全相关改动时：追加 `security`。
5. 当 planner 或 audit-guard 明确指定模式时：以指定模式为准，并保留默认最小集。

## LLM执行边界
1. LLM 不得自行跳过触发矩阵要求的测试模式。
2. LLM 负责在已选模式内生成具体 `commands`、`pass_criteria`、边界用例和执行顺序。
3. 若模式与任务上下文冲突，必须先记录 blocker 并回传 planner 决策，不得私自降级。
4. 若执行成本过高，可调整样本规模，但不得取消模式本身。

## 测试约束
1. tester 仅执行 `task.md` 授权范围内测试命令，不进行额外变更。
2. 测试失败必须附带可复现证据（命令、关键输出、失败上下文）。
3. 测试结论必须使用标准状态值：`PASS` 或 `FAIL`。
4. failure_code 必须使用标准枚举：`BUILD_FAIL`、`TEST_FAIL`、`SECURITY_FAIL`、`CONTRACT_BREAK`。
5. 若测试依赖缺失导致无法判定，状态标记 `FAIL` 并在 `fixes` 给出补齐建议。
6. `tasks` 兼容镜像文件由 planner-ops 统一同步，tester-ephemeral 不直接写入 mirror。

## 异常与回退策略
1. `task.md` 缺失关键字段时立即终止并返回结构化错误。
2. 测试命令执行超时时，记录超时证据并返回 `FAIL`。
3. 结果写入失败时，重试一次；仍失败则上报 planner 介入。
4. 若检测到高风险测试动作，先交由 audit-guard 门禁判定。

## 路径描述
1. tester 单次运行目录：`templates/coordination/testers/<run_id>`。
2. tester 日志目录：`templates/coordination/testers/tester_logs`。
3. worker 任务运行目录（新）：`$AGENT_ORCHESTRATOR_STATE_DIR/tasks/worker_tasks`（默认 `~/.openclaw-state/agent-orchestrator/tasks/worker_tasks`）。
4. worker 任务目录（兼容）：`templates/coordination/tasks`。
5. worker 状态目录：`templates/coordination/workers`。
6. planner 配置路径：`templates/coordination/planner/config/current.md`。

## 命名示例
1. `run_id` 示例：`run_20260212_153000`。
2. 测试任务文件示例：`templates/coordination/testers/run_20260212_153000/task.md`。
3. 测试结果文件示例：`templates/coordination/testers/run_20260212_153000/result.md`。
4. 测试结果 JSON 示例：`templates/coordination/testers/run_20260212_153000/result.json`。
5. tester 日志示例：`1700000000_a1b2c_test_logs.md`。

## 输出文件命名规则
1. 单次验收目录命名为 `<run_id>`。
2. 单次验收任务文件固定命名为 `task.md`。
3. 单次验收结果文件固定命名为 `result.md`。
4. 结构化结果文件固定命名为 `result.json`。
5. tester 日志文件命名为 `<worker_id>_test_logs.md`。

## 输出文件生命周期
1. `result.md`：每个 `run_id` 仅写入一次，生成后不覆盖。
2. `result.json`：与 `result.md` 同步生成，作为机器可读结果留存。
3. `<worker_id>_test_logs.md`：每次测试后追加，滚动保留最近12次测试记录。
4. `task.md`：测试完成后仅保留只读快照，用于追溯。

## 输出文件内容格式
1. `templates/coordination/testers/<run_id>/task.md` 文件内容格式：
```run_id:
worker_id:
commit_sha:
scope:
commands:
pass_criteria:
```
2. `templates/coordination/testers/<run_id>/result.md` 文件内容格式：
```run_id:
status: PASS
failure_code:
evidence:
fixes:
```
3. `templates/coordination/testers/<run_id>/result.json` 文件内容格式：
```json
{
  "run_id": "run_20260212_153000",
  "status": "PASS",
  "failure_code": "",
  "evidence": [],
  "fixes": []
}
```
4. `templates/coordination/testers/tester_logs/<worker_id>_test_logs.md` 文件内容格式：
```| timestamp | run_id | worker_id | status | failure_code | summary | next_action |
|---|---|---|---|---|---|---|
```

## 权限声明（用于自动ACL生成）
- allowed_read_paths: `templates/coordination/testers`, `templates/coordination/tasks/task_folders`, `templates/coordination/workers`, `interface.json`, `runtime/workdomains`
- allowed_write_paths: `templates/coordination/testers`, `templates/coordination/tasks/task_folders`
- forbidden_paths: `projects`, `templates/coordination/planner/config`, `templates/coordination/audit/policy`, `runtime/workdomains`
