# <PR / Goal Run> · <测试范围> 测试报告

> PR 模式一个 PR 一份报告；Goal 模式一个测试范围一份报告；同范围重复运行汇总为一份 Run Matrix。本文件是报告源文件和发布失败兜底；Agent QA 正式交付使用 artifact.cafe `Hellyeah / PR Releases & QA` 中的 workspace URL。部署首页按本文 Markdown 层级展示，所有 Case 展开：每条 Case 的截图（含中间状态）由打包器按证据清单插入本段，所有执行视频集中附在报告最后；不提供 Trace 或 Playwright 原生报告。

## 整体结论

**只允许：通过 / 不通过。** 只有全部必要 case 为 Pass 才写通过；ProductFail、Blocked、Inconclusive、NotRun 或必要证据缺失均写不通过。

一两句话说清楚：本轮验了什么、结论是什么、有没有阻塞后续发布的问题。

## 风险相关 Smoke

> 放在整体结论之后、Case 总览之前。普通 ticket 最多两条：一条 primary module 核心不变量，一条 adjacent contract / 历史 Bug / recovery。

| Smoke | 来源与关联风险 | 结论 | 说明 |
|---|---|---|---|
| | | Pass / ProductFail / Inconclusive / NotApplicable | |

未执行的写明原因。

## Run Matrix（多环境或 repeat 时）

| Shard | 环境 / SHA | Repetition | 账号 / 组织别名 | 结论 | 首次失败点 |
|---|---|---|---|---|---|
| | | | | Pass / ProductFail / Blocked | |

单次运行省略本节。

## Case 结果总览

| # | Case（功能点） | 角色 | 结论 | 关联 checklist | Bug 草稿 |
|---|---|---|---|---|---|
| 1 | | user / admin | Pass | QA-____ | — |
| 2 | | | ProductFail | QA-____ | bug-01 |

---

## 失败的 Case

> 每条都必须有：复现条件、最小复现步骤、关键断言、预期与实际的来源、排除项。截图（至少失败点一张）由打包器按证据清单插入本段，视频附在报告最后；不在 Markdown 中手写本地截图或视频路径。

### Case N · <功能点名称>

- **结论**：ProductFail / Inconclusive / Blocked
- **对应 Bug 草稿**：`bug-drafts/bug-0N-____.md`

**复现条件**

- 环境 / 部署 SHA：
- 角色 / 组织：
- 前置状态：
- 测试数据：

**最小复现步骤**

1. ____ → 观察到 ____
2. ____ → 观察到 ____
3. **失败点**：____

**关键断言**

- ✗ `MODULE-00N`：预期 ____ → 实际 ____
- ✓ `MODULE-00N`：____（同一 Case 中仍成立的断言也列出）

**预期 vs 实际**

| | 内容 | 来源 |
|---|---|---|
| 预期 | | QA 单 / 模块断言 ID |
| 实际 | | UI 观察 / 后台只读事实 |

**复现状态**：observed_once / reproduced / not_reproduced / not_attempted_due_to_risk / blocked / unknown

**已排除的非产品原因**

- [ ] 规则适用于当前环境、版本、角色、组织
- [ ] 账号、组织、测试数据满足前置
- [ ] 动作确实发生在目标 UI 路径
- [ ] 不是异步等待中或展示延迟
- [ ] 不是 Browser / locator / 网络故障
- [ ] 命中模块的「不能直接判 Bug」已逐条核对

**影响**：谁会遇到、多严重、有没有绕过方式。

**疑似原因**（可选，**必须标注为推测**）

---

## 成功的 Case

> 放在失败/阻塞 Case 后，全部展开。每条写关键断言；截图（基线、中间状态、业务终点）由打包器按证据清单插入，视频附在报告最后。

### Case N · <功能点名称> — Pass

**基线**：动作前读到的状态（余额、交易数、实体状态、active org 等）。没有基线就无法证明增量。

| 步骤 | 观察事实 |
|---|---|
| ____ | ____（写读到的具体值与状态迁移，例如 `$0.00 → $1.50`；不写「正常」「成功」） |
| ____ | ____ |
| ____ | ____ |

**关键断言**

- ✓ `MODULE-001`：____（写读到的具体值，例如 `$0.00 → $1.50`）
- ✓ `MODULE-00N`：____

- **结论**：Pass
- **业务终点**：达到的持久化状态
- **关键事实**：`product_expected` vs `runtime_observed`
- **覆盖的 checklist / goal**：____

---

## 未覆盖与阻塞

| 目标 | 状态 | 原因 | 恢复条件 | 能否轻量人工协作覆盖 |
|---|---|---|---|---|
| | Blocked / NotRun / NotApplicable / SkippedByConstraint | | | |

**`NotApplicable` 逐条写明前置是什么、为什么不成立。**

明确写出没测的维度：Console、网络、性能、资金、第三方后台。第三方后台统一标记 `SkippedByConstraint`；不能写成“无错误”或“已验证”。

## 数据与收尾

| 对象 | 类型 | 当前状态 | 副作用是否越出 sandbox | 清理结果 |
|---|---|---|---|---|
| | | | 是 / 否 | 已清理 / 不需要 / **遗留** |

- 仍在运行的任务：
- 资金占用：
- `action_unknown` 及其核验结果：
- **Residual entity 与人工下一步**：

## 覆盖统计

- 执行覆盖：__ / __
- 明确结论覆盖：__ / __
- 明确结论通过率：Pass / (Pass + ProductFail) = __
- Inconclusive：__ ｜ Blocked：__ ｜ NotRun：__ ｜ SkippedByConstraint：__ ｜ Skipped：__ ｜ **NotApplicable（不计入分母）：__**

| 主类型 | 去重设计 | 实际适用 | 到业务终点 | 可判定 | 尚缺的独立失效机制 / 前置 |
|---|---:|---:|---:|---:|---|
| Happy | __ | __ | __ | __ | __ |
| Negative | __ | __ | __ | __ | __ |
| Edge | __ | __ | __ | __ | __ |

- Action 命中：__ / __ 个可复用业务意图；`not_reusable` 单列 __；新任务或回归：__；本轮耗时：__。缺少合规日志时写“未测量”，不补算或借用其它运行的 fixture hit。
- 初版 Case 漏项：自主发现候选 __、人工/独立复核候选 __、已确认 __、驳回/重复 __、本轮补测 __、仍开放 __。无事先独立盲审时 `planRecall` 写“未测量”，不能写 100%。
- 尚未独立裁定：事前盲审但初版遗漏的机制 __；自主/执行/checker/人工未分类的发现 __。未裁定时不得宣称 QA 通过。
- PR changed-file 分类：总数 __、映射到业务变更 __、明确排除 __；若未验证精确 base/head diff，写“未验证”，不声称 PR 影响覆盖完整。
- 下一轮优先改进：最高成本的未命中意图 __；有权威预期但尚未执行的独立负向/边界机制 __。只与同一旅程、相近前置的历史运行比较。

> 不得从分母里静默删除任何一项来美化结果。

## 计划漏项与修正

> 只写已确认的独立机制和会影响本轮结论的候选；未确认候选不算产品失败。初版计划不因后补 Case 回写。

| 漏项机制 | 发现来源 | 独立裁定 | 本轮补测与证据 | 下轮验证/待确认条件 |
|---|---|---|---|---|
| | 自主 / 执行中 / checker / 人工 / 后续 Bug | 确认 / 候选 / 驳回 / 重复 | | |

有“必须验收但尚未补测”的确认漏项时，整体结论只能为“不通过”；报告仍可诚实发布，不能宣称 QA 验收完成。

## 续跑入口

- 最后确认状态：
- 未知副作用：
- 下一项安全动作：
- 所需外部条件：
- 回归重点：

## 环境与范围

> 整块放在报告尾部、交付状态之前。

- 模式：ticket / pr / goal / repeat
- PR-only 来源：PR URL ____；diff base ____ / head ____；明确行为快照 ____；仅代码推断的探索 __ 条
- Feature（PR）或 Goal Run：____
- 关联 QA 单：
- 关联 PR（全部）：
- Sandbox：Dashboard ____ / Admin ____ / API ____
- **部署 SHA**：____（与 PR head 一致：是 / 否）
- 角色 / 组织：
- 浏览器：
- 执行器：Playwright / E2B Computer Use / mixed
- 时间：
- 规则来源：命中模块 ____ ；其它依据 ____

## 交付状态

- 独立复核与发布决议保存在本轮 `run-state/checker-review.json`；发布前须通过最终 gate
- Artifact 目标：`Hellyeah / PR Releases & QA`；visibility 要求：workspace
- Artifact URL、版本、在线验收和发布失败原因由发布后单独的 `run-state/delivery.json` 记录；不回写已复核的本报告
- 本地报告：`result/____.md`
- Version history：updated / pending
- QA 工作台登记：__ 条（其中知识候选 __ 条，≤3）
- Bug 草稿：none / pending review / approved / created

## QA review list

> 固定放在报告最后，发布后默认折叠。给 QA reviewer 复核本轮运行质量用，不是产品结论；数值与本轮 `run-metrics.json` 一致。

- **覆盖**：计划 __ / 执行 __；NotApplicable __；Blocked __；model_gap __（逐条列出 gap）
- **速度**：耗时 __s；shard __；Computer Use __ 步；action hit __ / miss __（命中率 __）；有效 hit __（剔除返回过时事实的 hit）
- **未命中原因**：no_action __ / not_found __ / drifted __ / precondition __；逐条列意图名
- **正确性**：Inconclusive __；requirement_conflict __；script_drift __；action_unknown __；Expected 来源 module __ / ticket __ / user __ / inferred __
- **疑似漂移的 action 及处理状态**：逐个列 Action（失败分类 / locator），每个只能是下面三种状态之一，**不写成已有结果**：
  - **未处理**：本报告发布时还没动手修，写明会在哪一步修、对应缺口 `<gapId>`；
  - **已修复**：已改并在 E2B 通过 `action:drift verify`（健康 healthy），附验证记录文件，写明验证覆盖到哪些页面状态、哪些没验证到；
  - **未修复（有具体原因）**：产品页面暂时拿不到测试数据、需要不可撤回操作等，附缺口 `<gapId>` 和证据文件。「有人说别修」「时间不够」不算原因；不得把派单措辞或环境限制写成「按用户要求」。
  无漂移则写「无」。内容必须与 `run-state/drift-repair.jsonl` 一致；报告发布后修复状态变了，在下一版报告里更新，不改已发布的版本。
- **知识沉淀**：QA 工作台登记 __ 条；自动入库 __；仅留档 __
- **Bug**：每条草稿的判定依据（断言 ID 或 AC 编号）与 linear_id
- **实验标记**：`experiment` 字段（无则写「无」）
- **漏测登记**：执行中发现的遗漏与独立裁定状态；是否做过人工盲审 / 独立 reviewer
- **人工改判**：交付后 QA 负责人改判的 Case（从什么改成什么、原因类别），与 run-metrics `human_overrides` 一致；无则写「无」
- **逐 Case 复核**：模式 incremental / whole；一次 upheld __ 条；修正后通过 __ 条（逐条列 Case 与原因，如「Case 3：缺中间状态截图 → 补截图后 r2 upheld」）；最后一条 Case 结束到 gate 通过 __s（`run-metrics.json` 的 `review`）
- **版本记录**：version-history 是否已追加
