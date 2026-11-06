# 知识来源与用途分层

## 零号原则：先理解输入合同，再加载模块

执行顺序：

```text
QA ticket、PR Change Model 或 Goal Test Model + 目标环境
→ Requirement Atoms 或业务终点/cases
→ 路由命中的 QA Model
→ ticket checklist、PR 明确声明的合同 + 影响风险，或 goal journeys + 风险 cases
→ Browser 执行
```

Agent 不是先读取整个 QA Model 库再猜。Ticket 模式先理解本轮改动和 checklist；PR-only 模式先把 diff 转成受影响的用户旅程和候选机制；Goal 模式先理解用户要证明的业务目的和终点。QA Model 再把输入映射成 actions、facts、assertions、recovery 和 adjacent contracts。

当前 QA Models 仍包含 `pilot` 和 `draft` 模块。它们可以用于路由、准备观察事实和发现风险，但未审核的断言不能脱离 ticket 或用户确认，单独支撑 ProductFail。

## 按用途分层

来源之间不做统一排名。先判断当前需要解决什么问题，再使用对应来源。

| 用途 | 使用来源 | 边界 |
|---|---|---|
| 定义本轮改动的 Expected | 当前 QA ticket、评论中的确认、用户对当前 revision 的明确确认 | 不用旧模块覆盖 ticket 新行为 |
| PR-only 改动的本轮合同 | PR 描述或作者评论中明确、可观察且逐字快照的行为 `pr_spec` | 只适用于该 PR head；不得从 diff、提交信息或实现反推 Expected，不自动变为长期产品规则 |
| 定义 goal 测试范围 | 用户测试目的、明确行为要求、active QA-models | 目的定义范围；只有明确行为或 active assertion 定义 Expected |
| 路由和执行产品业务 | QA-models 的 index、Page Signals、Business Actions、Facts、Assertions、Recovery | `pilot/draft` 断言不能单独判 ProductFail |
| 设计风险 smoke | QA-Knowledge、product-memory 的高频风险和历史 Bug 模式 | 不扩大成固定完整回归 |
| 排除误判 | product-memory、模块的 non-bugs、环境能力说明 | 不反过来定义产品新规则 |
| 确认实现事实 | runtime observation、代码枚举/字段/错误码 | 代码不能证明实现就是正确预期 |
| 理解历史产品意图 | business_file | 不用于判 Pass/ProductFail 或冲突仲裁 |
| 判断规则时效 | version-history、目标 PR/SHA、模块 `last_reviewed/status` | 只确认适用性，不凭文件名判断权威性 |

## QA Ticket：范围信号 + 有限的验收合同

ticket 由研发撰写，描述的是「我改了什么」，不是测试工程师设计的 case。它在两件事上的可信度不同：

```text
碰了哪个 surface / entity / transition   研发可信 → 用作范围信号
改完应该是什么样                        研发视角的改动说明 → 只覆盖它明确写到的部分
```

因此 ticket 承担两个角色，不要混用：

**范围信号（主要用途）**：提取 surface、entity、state transition、副作用和关联 PR，用于路由 primary/adjacent 模块。ticket 圈定本轮碰了什么，模块决定碰了它该验什么。

**有限的验收合同**：当前 ticket 的 checklist 定义它声明要改变的行为。把每项拆成 Requirement Atom，并保留原文来源。

- ticket 明确的行为：Expected 来自 ticket 或用户确认；旧模块只辅助准备 actions 和 facts。
- **ticket 声明了范围，不等于声明了全部验收标准。** 研发通常只写 happy path，不写边界、非法迁移和「不该受影响的东西」。这些由命中模块的核心不变量、`boundaries` 和 `illegal` 补齐，**不因 ticket 没写而跳过**。
- ticket 没声明的邻接行为：可使用 `active` 模块断言作为 smoke。
- `pilot/draft` 模块只能生成候选 smoke；失败还需要 ticket、用户确认或其它当前有效证据才能判 ProductFail。
- “works correctly”“handles errors”等模糊句必须拆解或标为 ambiguous，不能由 Agent自由补全。

## Goal：本轮测试目的合同

没有 ticket 时，用户目的定义测试范围，不自动定义所有业务 Expected。使用 active QA-models assertion 规划主要 journey 和判断回归；pilot/draft 模块用于路由和采事实。完整规则见 [测试目的入口与自主 Case 规划](goal-driven-intake.md)。

## PR-only：从改动发现风险，不从代码发明规则

用户只给 PR 且没有 QA 单时，按 [PR 自主规划](pr-driven-intake.md) 保存 exact PR/base/head、原文行为声明、diff 和影响图。明确的 PR 作者声明仅作为该 head 的本轮验收合同；独立 reviewer 必须核对确实是作者表达的可观察要求及适用条件。PR diff、实现、改名、报错文案或测试文件只能提出 `code_observed` 的候选风险。无权威 Expected 时保留探索 Case 和实测事实，结果为 `Inconclusive` 等非决定性状态，不伪造 Pass/ProductFail。PR 文本与已确认规则冲突时先确认，不能择有利口径。

## QA Models：执行期产品接口

Agent 通过产品 index 和 Dashboard routing 选择 primary/adjacent modules，只加载命中的模块。

模块用于：

- 确认当前页面和 surface；
- 选择业务动作而不是机械点击；
- 定义需要观察的 Facts；
- 组织 ticket checklist 和邻接 smoke；
- 提供 action_unknown、异步、cleanup 和 non-bug 处理。

模块状态决定断言用途：

| Status | 用途 |
|---|---|
| `active` | 可作为未改动业务的回归 Expected，仍需核对 `applies_when` |
| `pilot` | 可路由、采事实、生成 smoke；不能单独判 ProductFail |
| `draft` | 只用于发现和提问，不能单独判 Pass/ProductFail |
| `needs-review` | 先处理冲突或 `model_gap` |
| `deprecated` | 仅历史追溯 |

成熟度是双向的。执行期只**记录**降级信号——断言被驳回、长期零引用、上游失效、持续 `Inconclusive`、反复 `requirement_conflict`——不在执行期改模块状态。降级条件和处理方式见 `QA-models/README.md` 的「降级：成熟度是双向的」。

模块中的状态名、错误码或字段若在实际产品中找不到，不要猜。记录 `model_gap`，改用可观察信号描述本轮事实。

## QA-Knowledge：怎么测和风险 Smoke

QA-Knowledge 提供测试方法、风险启发式、Bug 模式和证据要求。它用于选择与当前改动最相关的 smoke，不定义具体产品 Expected。

普通 ticket 在 checklist 之外默认最多增加两条 smoke：

1. 一条 primary module 核心不变量；
2. 一条最相关的 adjacent contract、历史 Bug 探针或 recovery。

选择项必须与 ticket 的 surface、entity、state transition 或副作用有明确关系。不能为了凑两条选择无关风险；只有一条真正相关时执行一条并说明。

**模块「待补测」不占这两条预算。**规划时读取命中模块（primary 与 adjacent）的「待补测」节：状态为 `未测` 且前置适用于本轮环境、角色和组织的条目加入 Case 计划，标 `pending-retest:<ID>`；前置不适用或本轮无法执行的，在任务模型写明「未纳入」及原因，不能静默跳过。执行并经独立复核后，Agent 把该条状态改为 `已测 <runId> <结论>`——这是记录事实，不是新增规则，不需要人审。

## Product Memory：哪里容易误判

重点读取高频风险、不能直接判 Bug、历史规则纠正和人工确认条目。它用于减少误报，并帮助选择风险 smoke。

没有明确来源和适用版本的 product-memory 条目不直接定义 Expected。

## 代码与 Runtime：事实而非规范

代码可以确认存在的状态、错误码、字段和实现入口；runtime observation 记录本轮真实行为。两者都不能单独定义“应该怎样”。

代码原因推断统一记录为 `code_observed` 或 speculation。不能因为代码如此实现，就把违反 ticket 的行为判为正确。

## Business File：历史意图

`business_file/` 已明显滞后，只用于理解最初设计和术语背景。不能用于判 Pass/ProductFail，也不能仲裁 ticket、模块或用户确认之间的冲突。

## 冲突与缺口

1. 先核对环境、版本、角色、组织、feature flag 和 `applies_when`。
2. **Ticket 描述了模块没有的新行为**（扩展，不是冲突）：以 ticket 为本轮 Expected，模块记补充候选。
3. **Ticket 与 `active` 模块断言直接矛盾**（ticket 说 A，已审核断言说 non-A）：记 `requirement_conflict`，停下来向用户确认，**不自动以 ticket 为准**。研发在 ticket 里写错一句话，不应推翻一条经过审核的断言。用户明确确认该变更后，才按新 Expected 执行并把原断言记为过期候选。
4. 未改动行为的来源冲突：记 Requirement conflict/Inconclusive，向用户确认，不用全局排序裁决。
4. 没有模块或必要 Fact：记 `model_gap`，执行最小范围探索；新理解只进入 QA 工作台。

任何情况下都不要修改预期去迁就实现。

## 沉淀权限

本轮观察先自动写入 version history 和受限的 QA 工作台知识候选。product-memory、QA-models 和 QA-Knowledge 长期内容必须经 PM/人工审核；`remote` 模式不要求回流，`local` 模式确认后自动写入使用者自己的本地 skill。

写入本轮 `QA_ROOT/qa-workbench.md` 前先读 `SKILL_DIR/QA-Knowledge/qa-workbench.md` 的「问题怎么写」和条目模板。分开写已观察事实、未决规则与本轮处理；每个 `需要确认的问题` 要点明具体行为、适用版本与条件、可选结论或所需证据，以及确认后会改变哪条断言或测试步骤。缺测试数据就写缺什么、谁提供、补测什么；没有未决规则时不建候选。候选经 PM/人工审核后，若 `pnpm install-mode:check` 返回 `local`，自动更新该用户 `sourceDir` 的知识文件；返回 `remote` 则只保留候选。是否回流团队 Git 仓库另由使用者决定。脚本过时排查已在 [Playwright action 与脚本沉淀](playwright-actions.md) 定义，不要把它包装成需要用户确认的产品规则。
