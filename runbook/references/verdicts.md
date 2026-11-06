# 判定与复现

## 结果类型

- `Pass`：前置成立，全部必要业务断言通过，持久证据完整，无未决规则冲突。
- `Product bug`：当前有效的权威预期被违反，证据明确，并排除环境、账号、数据和自动化问题。
- `Documentation drift`：实现与流程可用，但文档、文案、字段或步骤已过时；偏差未破坏明确业务契约。
- `Environment`：部署、配置、迁移、第三方服务、测试账号或权限阻止判断。
- `Automation failure`：Browser/Computer Use 工具、坐标误点、selector/locator、会话、脚本或证据采集失败。
- `UX observation`：可用但存在清晰度、效率或易错性问题，未违反已确认业务规则。
- `Requirement conflict`：同一版本的权威来源冲突且无法消解。
- `Inconclusive`：关键事实、业务终态、持久证据或规则不足。
- `Blocked`：存在具体外部依赖和明确恢复条件。
- `NotApplicable`：断言的 `applies_when` 前置在当前环境或版本下不成立。
- `SkippedByConstraint`：当前测试策略明确不提供某类外部权限或后台核验；单列披露，不冒充已测。

### NotApplicable 与 Blocked 的区别

| | 含义 | 覆盖率分母 |
|---|---|---|
| `Blocked` | 本该测，但被具体外部条件挡住，**有恢复条件** | 计入，单列 |
| `NotApplicable` | 这条断言在当前环境/版本下**本来就不适用** | **剔除**，单列 |
| `SkippedByConstraint` | 断言适用，但当前策略明确排除第三方后台或其它外部能力 | 计入原计划并单列，不计为执行或明确结论 |

典型场景：模块里保留着历史遗留功能的断言，但环境里已经不存在能触发它的数据。这类断言永远测不到，既不是阻塞也不是失败。

有了 `NotApplicable`，历史包袱型断言不需要人工逐条清理，agent 会自己绕开，同时保持覆盖率诚实。

**不能静默跳过。**每条 NotApplicable 都要写明前置是什么、为什么不成立。

---

## 产品失败门槛

判 Product bug 前逐项核对：

1. 规则来源适用于当前环境、版本、角色、组织和 feature flag；
2. 账号、组织和测试数据符合前置条件；
3. Browser 动作确实发生在目标 UI 路径；
4. 实际业务状态违反必要断言，而不只是等待中或展示延迟；
5. Browser/locator/坐标动作/网络故障没有伪造失败；若由 Playwright 脚本暴露，已经对照部署 SHA 对应的产品源码完成 `script_drift` 核验并在必要修正后重跑；若由 Computer Use 暴露，已用重新观察、结构化事实或确定性 Playwright 动作排除误点和视觉误判；
6. 必要时用只读事实排除缓存、并发变更、旧实体或错误关联；
7. 命中模块的「不能直接判 Bug」一节已逐条核对；
8. 证据足以让另一位测试者理解预期与实际。

**页面报错不是自动化失败的充分条件；selector 超时也不是产品失败的充分条件。**保留原始事实，再分类。

PR-only 的 `pr_spec` 仅在 PR 描述/作者评论有明确可观察的原文、该文本快照与目标 head SHA 一致、前置适用且无现行规则冲突时定义本轮 Expected。它能检验该 PR 是否兑现作者明确声明的行为，不能据此自动升级长期产品规则。仅从 diff/代码推断的行为或模糊宣传文字不能判 Pass/ProductFail；没有可用规则时如实记录 `Inconclusive` 与待确认问题。

`script_drift` 是 `Automation failure` 的子类，不是 Product bug。产品源码只用于判断路由、可访问名称、DOM/组件状态、接口字段或 feature flag 是否使脚本过时，不能用来改写 ticket 或 QA-models 给出的 Expected。完整顺序见 [Playwright action 与脚本沉淀](playwright-actions.md)。

### 归因边界

测试环境是 staging 基线快照加上本次改动。**只要现象已经满足 Product bug 判定门槛，就提 Bug，不需要区分由当前 PR 引入还是 staging 基线已经存在**——两者都要修。

QA 的交付物是**复现条件和 Bug 证据**，不是「这是谁的锅」。不要为了判断归属而额外做 staging 对照实验。

这条只免除「当前 PR 还是 staging 引入」的归因，不免除「是不是产品问题」——上面 8 条门槛照样要过。环境、部署、账号或 Browser 故障不能套用这条规则。

---

## 断言来源的时效性

```
ticket 声明要改的行为  → 验收标准只能来自 QA 单
                          模块在这块是过期的，不能用模块断言判 fail

ticket 没声明改的行为  → active 模块断言可作为回归 Expected
                          pilot/draft 模块只生成 smoke 候选，不能单独判 ProductFail

PR-only 明确写出的行为 → 逐字快照的 pr_spec 只在对应 head 定义本轮 Expected
PR-only 代码推断的行为 → 只产生风险候选；缺权威 Expected 时不判 Pass/ProductFail
```

理由：模块描述的是测试合同，但成熟度不同。ticket 声明要改的部分以本轮 QA 单为准；未改动部分只有已审核的 active 合同才能单独定义回归 Expected。

规则冲突时先核对部署、时间、feature flag 和适用角色；无法消解时使用 `Requirement conflict` 或 `Inconclusive`，**不要修改预期迁就实现**。

---

## 证据

证据引用需要真实存在并脱敏。记录 capturedAt、目标页面/对象、证据类型、它支持哪条断言。

**不得保存**密码、OTP、token、卡号/CVC、完整 checkout URL、第三方账号凭据或其它敏感信息。实体 ID 在报告中脱敏。

关键业务断言优先使用**多表面证据**：UI 可见状态 + 交易/实体/任务的只读事实。

视觉判断适合验证可读性和布局，**不替代金额、状态和关联关系的确定性比较**。

---

## 复现

复现记录包含：环境/build（含部署 SHA）、浏览器、角色/组织、前置状态、测试数据、最小步骤、首次失败点、预期、实际、证据、实体、清理状态、排除项。

复现状态：

- `observed_once`
- `reproduced`
- `not_reproduced`
- `not_attempted_due_to_risk`
- `blocked`
- `unknown`

**真正的 `reproduced` 要求从已知初始状态重新执行关键路径**，并由独立证据再次命中同一业务断言。刷新后仍看到同一失败对象只说明问题持续存在，不等于复现。

安全且不会重复资金或破坏性后果时，受控复现一次。支付、投放、生成、邀请、删除等高副作用场景**不为了提高复现次数自动重做**——一次强证据仍可成 Bug，复现状态如实记录为 `observed_once` 或 `not_attempted_due_to_risk`。

---

## 覆盖与报告

分别报告：

- **执行覆盖**：实际发生 Browser/工具执行事件的适用目标
- **明确结论覆盖**：得到 Pass 或 Product bug 的适用目标
- **明确结论通过率**：Pass / (Pass + Product bug)

规则：

- `Inconclusive` 可以算已执行，**不能算明确结论**
- `NotApplicable` **从分母剔除**并单列
- `Blocked`、`NotRun`、用户跳过分别列出

**不能从分母里静默删除任何一项来美化结果。**
