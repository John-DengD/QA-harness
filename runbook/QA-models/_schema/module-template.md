---
id: product.module
type: module
product: product-name
surfaces: [web]
status: pilot
version: 1
last_reviewed: YYYY-MM-DD
related_modules: []
---

# Module Name（模块中文名）

标题固定为“English name（中文名）”。`type` 取 `module`、`index`、`routing`;`index` 与 `routing` 不是 module,没有 `status`。可选字段 `agent_testable`:写 `false` 表示该模块不是 agent 执行目标。

## 业务目标与边界

模块为用户提供什么结果；明确不属于本模块的能力。

## Ticket 路由信号

- 关键词、页面、API、实体、状态、错误码和 PR 路径。
- 选择本模块为 primary 或 adjacent 的条件。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| MOD-S01 | path / URL / ticket(需要说明适用范围时,写在后面,以“— 适用:”引出) | authority / timeline / risk / observation / user-confirmed | current / candidate / superseded |

- Ref 格式 `<模块前缀>-S<两位序号>`,同一模块只用一个前缀,从 `S01` 连续编号。
- Role 只能是 `observation`、`risk`、`authority`、`user-confirmed`、`timeline` 五种。同时具备两种性质时取较保守的一种(`risk` 不能单独作为 Expected 出处,`user-confirmed` 可以),并把原来的说法写进 Status。
- 外部材料放在 `sources/` 下,Source 列写相对 Runbook 根的路径;代码引用写“仓库 + 路径”,在 Status 里写读取日期;不记 commit SHA。没有文件的口头裁定先写成 `sources/rulings/` 下的小文件再引用。

## 状态模型

列业务状态、含义、合法入口和终态。未知或未确认状态明确标注。

**非法迁移**：哪些状态下哪些操作应被拒绝、拒绝时的可观察结果（Case 设计 G3 的输入）。没有确认的写「未确认」，不猜。

## 前置条件

列角色、组织、环境、数据、权限和外部依赖，以及验证方法。

## Browser 观察点

列用户可见入口、关键页面状态和跨 surface 只读核验点。这里描述业务语义，不保存脆弱 selector。

## Page Signals

| Surface | URL pattern | Required visible anchors | Optional anchors | Wrong-page signals |
|---|---|---|---|---|

Page Signals 用于确认 Agent 是否在正确页面。不要只依赖 URL，也不要保存坐标。

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|

动作 ID 表达业务意图，不绑定一次性的 selector。Browser Use 根据当前页面重新定位控件。

## Facts

| ID | Meaning | Source surface | Shape | Freshness |
|---|---|---|---|---|

断言只比较已定义 Fact。无法采集必要 Fact 时使用 Inconclusive/Blocked，不让模型用猜测补值。

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|

常用 Type：`visible`、`exact`、`state_transition`、`amount_delta`、`cross_surface`、`eventual`、`negative`、`visual`、`manual`。

## 副作用与恢复

（精简模块可把本节、「Bug 判断知识」和「模型回流」合并为一节 `## 副作用、Bug 判断与回流`;同一个模块只用其中一种写法。）

列 read/reversible/side_effect/high_impact 动作、未知动作核验和 cleanup。

## Bug 判断知识

### 高置信 Bug

列满足哪些规则、事实和排除项后可以判 Bug。

### 风险或待确认

列需要其它 surface、后台或人工证据的情况。

### 不能直接判 Bug

列常见误判和合法降级。

## 历史风险与回归探针

只保留仍可能复发且有来源的风险；每项说明触发条件和证据要求。

## 待补测

人已确认要测、但还没有一次真实执行证明的检查。路由命中本模块的 run 在规划时必须读这一节，把前置适用的条目加入计划。

| ID | 要验证什么 | 前置与做法 | 来源 | 状态 |
|---|---|---|---|---|

- `要验证什么` 引用本模块断言 ID，或写清 Expected 及其权威出处；没有权威 Expected 的只是风险，不进这一节。
- `状态` 只有两种：`未测`；`已测 <runId> <结论>`。只有经过独立复核、到达业务终点、有本 Case 视频的执行才能改为已测；结论是 ProductFail 也算已测，缺陷照常按 Bug 处理。
- 已测条目在下一次模块审阅时删除，需要长期回归的转入「历史风险与回归探针」。

## 不可测与不设计

规划时已知到不了、或人已裁定不测的检查。路由命中本模块的 run 在规划时读这一节：命中的条目**不排执行、不尝试**，直接按「处理」栏在计划里记状态，原因与恢复条件照抄进报告。

| ID | 检查内容 | 处理 | 原因与恢复条件 | 来源 |
|---|---|---|---|---|

- `处理` 三选一：`Blocked`（本环境到不了，写恢复条件，仍计入分母）、`NotApplicable`（前置状态在产品里根本不存在，写依据，剔除分母单列）、`SkippedByConstraint`（人明确决定不测，写出处）。
- 来源必须是人的裁定或已确认的环境事实（含日期）；不能是 Agent 自己判断“太麻烦”。条件改变（例如有了受控重启窗口）时由人审阅后删除条目。

## 已知缺口

列来源时效、尚未验证的断言、缺失环境或待产品确认事项。

## 模型回流

列本轮可登记到 QA 工作台的候选规则、page signal、action、fact 或断言，以及升级为 active 所需证据。
