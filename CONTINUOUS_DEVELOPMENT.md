# Agent Orchestrator 持续开发技术规范

## 1. 文档定位

本文档用于后续持续开发时统一项目理解、架构边界、演进方向与开发风格。


## 2. 项目一句话定义

这是一个 local-first、role-explicit、contract-driven 的多代理编排系统。它不是单体 AI 助手，而是把需求 intake、planning、scheduling、delivery、testing、audit、governance、knowledge management 拆成独立职责，并通过状态机、模板、脚本、插件和 UI 组合成可审计执行流水线。

## 3. 系统目标

项目的核心目标不是“让一个 agent 更强”，而是将多个agent的编排协作的应用场景为针对方向：
- 让工作流显式化
- 让角色边界稳定化
- 让执行行为可基于角色及中间状态进行审计
- 让执行操作及结果经验化可复用
- 让知识及经验序列化并编码化
- 让运行基于本地线程稳定, 并在进一步开发中实现升级到容器和分布式
- 让系统可以在不中断架构的前提下持续演进

## 4. 总体架构

### 4.1 分层视图

1. 入口层
- `requirement-intake`
- OpenClaw `/orchestrate` 会话式入口
- receptionist / session / entry-agent decode contract

2. 规划层
- `planner-core`
- `planner-ops`
- LLM-first initial decomposition + rule fallback

3. 调度层
- `scheduler-ops`
- runner runtime
- scheduler kernel

4. 执行层
- `worker-delivery`
- `tester-ephemeral`

5. 治理层
- `audit-guard`
- `governance-config`

6. 知识层
- `knowledge-base`
- `keeper`

7. 交互与集成层
- `extensions/orchestrator-dashboard`
- `orchestrator-webapp`

### 4.2 主执行链路

当前主链路是：

`entry agent -> planner -> scheduler -> worker/tester -> audit`

更完整地说：

`conversation intake -> structured primary -> planner decision + split plan -> scheduler dispatch -> worker delivery -> tester validation -> audit gate -> release / rollback / resume`

## 5. 核心模块职责

### 5.1 requirement-intake

职责：
- 把自然语言需求规范化为 `primary.md`
- 管理 `DRAFT -> READY -> STARTED`
- 在启动前补齐 scope、constraints、acceptance criteria

限制：
- 未 `READY` 且未显式启动，不得进入拆解
- `STARTED` 之后核心需求字段冻结

### 5.2 planner-core

职责：
- 只做 planning，不做持续调度
- 负责第一层 initial meta decomposition
- 输出 `PlannerDecision` 和 `SplitPlan`
- 主原则是 `functional_decoupling`

限制：
- 不负责并发控制
- 不负责 worker/tester 执行
- 不负责长期心跳与轮询

关键设计：
- planner ingress 由 planner 管理
- LLM 是 primary planner，规则系统只是软约束和 fallback
- 依赖模型目前只是 planning hint，不是 scheduler DAG

### 5.3 planner-ops

职责：
- 把 `primary` 拆成 checklist / subchecklist / worker tasks
- 维护任务追溯链
- 负责 `CREATED -> PLANNED -> ASSIGNED`
- 管理 worker 生命周期和替换

限制：
- source of truth 是 `task_folders/<task_id>/meta.json`
- mirror 文件只能兼容，不得反向作为真实状态

### 5.4 scheduler-ops

职责：
- 控制 dispatch、retry、backoff、recovery、并发窗口
- 推进 `ASSIGNED -> IN_PROGRESS`
- 消费 planner 信号，但不改写 planner authority

限制：
- 不改需求语义
- 不写 split / amendment / topology authority

### 5.5 worker-delivery

职责：
- 基于任务边界实施交付
- 记录交付证据、change manifest、handoff
- 推进 `ASSIGNED -> IN_PROGRESS -> TESTING`

限制：
- 不得越权修改 planner config / audit policy
- 遇到歧义必须请求 clarification
- 必须先过 tester，再声明完成

### 5.6 tester-ephemeral

职责：
- 一次性验收实例
- 消费 handoff，输出结果

限制：
- 不可常驻复用

### 5.7 audit-guard

职责：
- 风险评估
- 审批冻结
- 审计日志落盘
- `approval.json` 放行

限制：
- 高风险默认阻断
- 审批链不可用时默认 `BLOCK`

### 5.8 governance-config

职责：
- planner/config 版本化
- 快照
- 审批变更
- 回滚

限制：
- 未审批不得改关键配置
- `STARTED` 后修改 primary 核心字段视为高风险

### 5.9 keeper

职责：
- 知识库去重
- 评分重算
- 容量治理
- 生成治理报告

限制：
- `keeper_enabled: true` 才生效

### 5.10 extensions/orchestrator-dashboard

职责：
- OpenClaw 插件
- 暴露 `/orchestrate`
- 启动 runner
- 提供 overview、events、configs、meta API
- 把契约、状态、planner 视图和运行时桥接起来

关键点：
- OpenClaw 是宿主，不是仓库内核
- 插件本地测试与宿主兼容性测试是分开的

### 5.11 orchestrator-webapp

职责：
- 作为独立 dashboard/configurator
- 提供 core/ext/events API
- 插件注册、能力发现、Webhook、RBAC

说明：
- 它像一个平台控制面，和 OpenClaw 插件路线并行

## 6. 关键事实源与契约

### 6.1 单一事实源

后续开发必须坚持：
- 任务真实状态唯一事实源：`templates/coordination/tasks/task_folders/<task_id>/meta.json`
- 状态迁移必须追加到 `log.ndjson`
- 兼容 markdown 任务文件只作为 mirror

### 6.2 契约优先

这个项目不是“代码先行、文档补写”，而是典型的 contract-first：
- 模板先定义边界
- schema 先定义字段
- 测试守住一致性
- 脚本和插件在契约之下运行

尤其要遵守这些边界：
- `orchestrate-planner-contract.ts` 只能放 types + re-exports
- `orchestrate-planner-split-plan-contract.ts` 只做 split-plan normalize/validate/fail-fast
- `orchestrate-planner-projection.ts` 是 planner 语义唯一投影入口
- `orchestrate-view-model.ts` 只做响应参数编排

### 6.3 状态机优先于临时逻辑

实现必须服从：
- `state-machine-v2`
- task folder spec
- event log schema
- approval schema

禁止通过零散脚本行为隐式定义新状态。

## 7. 既往对话/既往决策的工程化沉淀

虽然没有直接聊天文本，但从现有文档能明确看出你之前已经反复确认了这些方向：

### 7.1 你拒绝“万能 agent”

你持续把职责切碎：
- intake 不等于 planning
- planning 不等于 scheduling
- scheduling 不等于 delivery
- delivery 不等于 audit

这说明你的既往偏好是：
- 明确角色
- 降低隐式耦合
- 拒绝一层代理包办全流程

### 7.2 你更重视 authority 和 boundary，而不是功能堆叠

大量文档都在定义：
- 哪个模块能写什么
- 哪个文件是 authority
- 哪些字段冻结
- 哪些路径只读或禁止写

这说明你在既往讨论中反复强调：
- source of truth 必须唯一
- authority 不能漂移
- 运行时必须可追责

### 7.3 你已经从“流程描述”进入“运行时系统设计”

从 `v2-phase1` 到 `v2-phase4`，再到 OpenClaw orchestrator config，可以看出演进节奏：

1. 先固化 task-folder-v2 与状态机
2. 再补 event append / hash chain / snapshot sealing
3. 再补 clarification、KB、keeper
4. 再补 config snapshot / rollback / health
5. 再补 plugin runtime、session contracts、planner projection boundary

这说明你的项目已从“多 agent 想法”进入“工程运行时”阶段。

### 7.4 你在控制 planner 复杂度，而不是盲目上 DAG

`planner-core` 和 `planner_invariants` 很明确：
- 当前依赖模型只是 `component_semantic_linearized`
- 明确写着不是 scheduler DAG
- 只有出现真实消费者时才升级

这说明你的既往判断非常克制：
- 先做最小可验证依赖模型
- 拒绝超前设计
- 让未来复杂度由真实消费场景驱动

### 7.5 你偏好 fail-fast + fallback，而不是 silent recovery

从 planner projection 和各类脚本可以看出：
- contract mismatch 会生成 fallback
- clarification 必须显式阻塞
- 风险动作必须显式审批
- 高危策略缺失默认 block

说明你的开发哲学是：
- 能显式失败就不要隐式吞掉
- fallback 仅用于保形，不用于掩盖语义错误

### 7.6 你在做“双前端路线”

同时存在：
- OpenClaw plugin
- 独立 WebApp

这不是重复建设，更像两个不同落点：
- 一个是宿主内联工作流入口
- 一个是平台化控制台

### 7.7 你重视经验回流，但不允许经验层污染执行 authority

知识库、keeper、feedback、scoring 都已接入，但同时有严格限制：
- worker 在 keeper 开启时不能直接写 KB 正式条目
- 需要候选、审核、去重、重算

说明你希望：
- 保留经验资产
- 但经验层必须低权限、可治理

## 8. 当前最重要的架构原则

后续开发必须优先守住以下原则：

1. 先边界，后能力。
2. 先 authority，后便利性。
3. 先状态机，后脚本快捷逻辑。
4. 先契约和测试，后 UI 渲染。
5. 先最小可消费模型，后通用化扩展。
6. 先 fail-fast，后 fallback。
7. 先审计和审批，再放行高风险动作。
8. 先 role isolation，再谈智能化增强。

## 9. 持续开发技术规范

### 9.1 新功能落地顺序

新增能力时，推荐顺序固定为：

1. 定义 authority 与 owner
2. 定义 schema / contract / template
3. 定义状态迁移和事件记录
4. 定义脚本入口或 runtime adapter
5. 定义 projection / response 层
6. 补测试
7. 最后补 UI

### 9.2 允许新增的方向

- planner request/decision envelope 完善
- dependency hint 的真实消费者落地
- runner 从 local_threads 向 container/distributed 演进
- runtime consistency / health / rollback 继续增强
- webapp 与 plugin 的能力对齐
- keeper 的 candidate ingestion 和反馈闭环强化

### 9.3 不建议现在做的事情

- 过早把 planner hint 升级成完整 DAG
- 让 view-model 回流 planner 语义
- 让 scheduler 改 planner authority
- 让 worker 直接改 mirror/source 的边界失真
- 把 audit 逻辑塞进普通执行脚本
- 把 OpenClaw 宿主特性写死进核心层

### 9.4 测试要求

每次涉及以下内容时必须补测试：
- schema 变更
- split-plan 字段变更
- authority 文件路径变更
- 状态机转移变更
- planner projection 逻辑变更
- runtime contract 变更
- plugin command flow 变更

### 9.5 文档要求

每次改动涉及边界时，必须同步更新：
- 对应 `SKILL.md`
- 对应 `templates/coordination/**` 契约
- 相关 `EXPLAIN.md`
- 相关测试

## 10. 你的开发风格画像

基于仓库内容，你的典型开发风格可以概括为：

- 强架构意识，高于快速拼装
- 喜欢把模糊协作关系固化成 contract
- 对 source of truth 和 authority 非常敏感
- 偏向分层、分责、低耦合
- 不喜欢“看起来能跑但不可审计”的方案
- 能接受渐进式演进，但不接受无边界扩张
- 倾向把系统设计成未来可容器化、可分布式
- 明确把高风险动作纳入审批和日志链路
- 重视 fallback，但只接受受控 fallback
- 倾向于让测试守住边界，而不是靠口头约定

## 11. 后续开发通用 Prompt

下面这段 prompt 可以直接作为你后续持续开发时给 AI/代理的统一系统提示词使用。

```text
你正在参与一个名为 Agent Orchestrator 的多代理编排系统开发。这个项目不是单体 AI 助手，而是一个 contract-driven、state-machine-driven、role-explicit 的工程系统。

请始终遵守以下原则：

1. 先确认 authority，再设计实现。
2. 任务真实状态的唯一事实源是 task_folders/<task_id>/meta.json；任何兼容 markdown 文件都只是 mirror。
3. 任何状态变化都必须能够映射到明确状态机和事件日志，不允许隐式引入新状态。
4. intake、planner、scheduler、worker、tester、audit、governance、keeper 是不同职责，禁止跨层偷写 authority。
5. planner-core 负责 planning，不负责持续调度；scheduler-ops 负责调度，不负责改写 planner authority。
6. 当前 planner dependency model 只是 planning hint，不是 scheduler DAG。除非出现真实消费者，否则不要把它扩展成完整 DAG。
7. 所有新增能力必须先补 contract/schema/template，再写执行逻辑，再补测试和 UI。
8. 所有高风险行为必须显式经过 audit-guard 或治理审批链路，默认 fail-safe。
9. fallback 只能用于保底结构和兼容，不得掩盖语义错误或 authority 冲突。
10. 优先保持模块边界清晰、投影单向、依赖方向稳定，避免 view-model、runtime、scheduler 反向侵入 planner contract。

在具体实现时，请默认采用以下工作方式：

- 先阅读相关 SKILL.md、templates、contract、tests，再改代码。
- 先给出边界判断：这个功能归哪个模块负责，谁拥有写权限，谁只能消费。
- 如果涉及字段新增，必须同步检查 parse、validate、summary、projection、tests 是否都要更新。
- 如果涉及运行时信号，优先进入 runtime contract，而不是直接散落到 UI 或命令层。
- 如果涉及新脚本或新状态，必须说明它与现有状态机、审计链、审批链的关系。
- 如果实现会破坏现有 authority、路径边界或 contract 分层，直接否决并改为兼容方案。

输出偏好：

- 用工程化语言，少用空泛描述。
- 优先指出 boundary、authority、state transition、compatibility 风险。
- 给出最小可验证实现，不做无消费方的超前抽象。
- 如需演进，请明确“当前最小版本”和“未来升级条件”。
```

## 12. 推荐的后续迭代顺序

1. 统一 plugin 与 webapp 的 runtime contract 视图。
2. 把 planner request/decision/apply/replan 流程做成更完整的闭环文档与测试矩阵。
3. 为 container/distributed execution target 先补 contract 与 adapter stub，而不是直接实现复杂调度。
4. 强化 health / consistency / rollback 的 operator UX。
5. 把 knowledge-base 与 keeper 的候选提交流程进一步产品化。

## 13. 结论

你的项目已经不是“多 agent demo”，而是在向“可治理的 agent orchestration runtime”演进。后续所有开发都应该围绕四个关键词继续收敛：

- authority
- boundary
- auditability
- evolutionary architecture
