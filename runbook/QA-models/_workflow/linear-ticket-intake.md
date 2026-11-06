# Linear Ticket Intake

把 Linear 工单转换为 Browser Use 可执行的 Ticket Task Model。目标是理解“产品改了什么、用户怎样触发、什么事实证明正确”，避免从 ticket 文本直接跳到点击操作。

## 1. 收集工单图

读取并保存：

- QA ticket 正文、状态、负责人、标签和评论；
- parent、sub-issues、related/blocks/blockedBy；
- 开发 ticket、Bug、设计/附件；
- 精确 PR URL、目标 branch、commit/deployment；
- 评论中的环境、账号、feature flag 和补充验收口径。

区分原始事实与 Agent 推断。标题相似、作者相同或时间接近只能发现候选，不能证明 ticket/PR 关系。

## 2. 识别工单类型

一个 ticket 可以命中多个类型：

- `new_capability`：新增用户能力或页面。
- `behavior_change`：已有业务规则/状态改变。
- `bug_fix`：修复明确现象，需要复现旧问题和验证回归。
- `ui_refactor`：业务合同不变，重点验证可达性和不变量。
- `integration`：跨 Stripe、Clerk、X-Ray、平台或 webhook。
- `data_contract`：字段、状态、schema、迁移或缓存变化。
- `observability`：日志、trace、审计、错误分类和诊断。
- `release_regression`：版本级关键链路回归。

类型影响测试重点，但不自动定义范围。

## 3. 建立 Change Model

从 ticket 提取：

| Field | Question |
|---|---|
| Actor | 哪个角色、组织和权限执行？ |
| Surface | Dashboard 哪个页面、弹窗、导航或第三方嵌入？ |
| Trigger | 用户做什么或系统发生什么？ |
| Entity | 哪个业务对象被读取或修改？ |
| Current/Before | 修复前或旧行为是什么？ |
| Expected/After | 本次希望行为是什么？ |
| State transition | 业务状态如何变化？ |
| Inputs | 哪些数据、边界值和已有状态影响结果？ |
| Side effects | 是否创建实体、付款、投放、邀请或发送消息？ |
| Observability | UI、console、network、API、后台如何证明？ |
| Non-goals | 工单明确不处理什么？ |

工单没有说明的字段写 `unknown`，不由 Agent补成产品规则。

## 4. 提取验收原子

将自然语言验收标准拆为一条条可观察的 Requirement Atom：

```yaml
id: TICKET-AC-01
statement: Embedded payments panel renders without invalid appearance warnings
applies_when:
  environment: staging
  stripe_state: connected
expected_facts:
  panel_visible: true
  matching_console_warning_count: 0
source: Linear QA-942 / Regression Target + Expected Result
authority: ticket
```

一条 atom 只能表达一个可判断结果。诸如“works correctly”“handles errors”必须拆解或标为 ambiguous。

## 5. 路由产品模块

使用 `SKILL_DIR/QA-models/<product>/index.md` 和 Dashboard 路由表：

- `primary_modules`：直接拥有改动行为和核心断言。
- `adjacent_modules`：共享身份、数据、状态或副作用，需要保护接口契约。
- `model_gaps`：没有模块、Fact、Action 或 Assertion 能表达的行为。

不要因模块名字相似强行路由。发现 gap 时建立本轮临时 atom，并生成模块候选；它在审核前不是永久断言。

## 6. 生成测试任务

具体推导按 [Case 设计：七个生成器](../../references/case-design.md) 逐个执行，每条任务记录 `generator`。任务来源分五类：

1. `acceptance`：ticket 明确验收原子；
2. `module_invariant`：primary module 的核心不变量；
3. `adjacent_contract`：相邻模块接口和跨 surface 一致性；
4. `historical_risk`：与改动触发条件相关的已确认 Bug 模式；
5. `recovery`：失败、刷新、重试、异步、cleanup 和 action_unknown。

每个任务引用稳定 assertion/action/fact ID；模块缺口任务使用 `TEMP-*`，并明确来源和只在本 run 有效。

## 7. 控制范围

测试范围不是模块全部断言的并集。按以下顺序选择：

- ticket 直接验收全部覆盖；
- 改动可能破坏的 primary module 不变量；
- 只有数据/状态接口受影响的 adjacent contracts；
- 触发条件与改动吻合的历史风险；
- 一项最有价值的异常/恢复路径。

记录 excluded assertions 及原因，防止后续误报“全模块已回归”。

## 8. 排序和分流

执行顺序：read-only smoke → 前置/身份 → happy path → 核心状态/持久化 → 异常/边界 → 跨模块 → cleanup。

高副作用任务延后到前置和 readiness 已通过后。同一 shard 内的具体先后、冲突与不可逆状态，按任务的 `data.requires/produces/mutates` 套用 [同一 shard 内 Case 排序](../../references/workflow.md#同一-shard-内-case-排序)。每项标记：

- `AIIndependent`
- `UserLightCollaboration`
- `UserLed`
- `Blocked`

需要用户协作的任务先准备可观察实体、搜索值和明确步骤。

## 9. 就绪门槛

开始 Browser 写操作前至少确认：

- primary surface、环境和角色；
- 至少一个可执行 acceptance task；
- 关键 expected facts 有 ticket 或适用模块来源；
- 副作用和 cleanup 已识别；
- 未知项不会让 Agent 在错误组织/环境写入。

不满足时仍可执行安全只读发现，但不能把探索结果冒充正式验收。
