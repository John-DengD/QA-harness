---
id: hellyeah.campaign-launch
product: hellyeah
surfaces: [customer-dashboard, admin-dashboard, api, google-ads, meta]
status: pilot
version: 1
last_reviewed: 2026-10-20
related_modules: [hellyeah.auth-organization, hellyeah.wallet-payment]
---

# Campaign Launch

## 业务目标与边界

用户提交可投放 campaign 后，系统在明确组织和预算下完成资金处理、内部审核、广告账户分配和平台创建，并且只有通过必要人工 gate 后才进入真实 active。模块区分 Google 与 Meta 两条审核路径。

## Ticket 路由信号

`campaign launch`、`submit`、`funding`、`pending_internal_review`、`approve`、`reject`、`ad account assignment`、`creating`、`paused`、`active`、`reserved budget`、`launch readiness`、`preflight`。

## 来源

| Ref | Source | Role | Applies to | Status |
|---|---|---|---|---|
| LAUNCH-SRC-001 | `sources/hellyeah/business_file/managed-ads/campaign-lifecycle.md` | observation | Campaign states/transitions | historical snapshot, synced 2026-08-05 |
| LAUNCH-SRC-002 | `sources/hellyeah/business_file/managed-ads/launch-flow.md` | observation | Preflight and platform creation | historical snapshot, synced 2026-08-05 |
| LAUNCH-SRC-003 | `sources/hellyeah/business_file/shared/payments/spend-gating.md` | observation | Spend and debit gates | historical snapshot, synced 2026-08-05 |
| LAUNCH-SRC-004 | `sources/hellyeah/product-memory.md` | risk | Campaign judgment and exclusions | current guidance |
| LAUNCH-SRC-005 | `sources/qa-knowledge/domains/campaign.md` | risk | Historical campaign risks | contains rules requiring source recheck |
| LAUNCH-SRC-006 | `sources/qa-knowledge/domains/admin-review.md` | risk | Review gate risks | current guidance |

## 状态模型

状态枚举以代码为准：`packages/shared/src/constants/managed-ads.ts` 的 `CAMPAIGN_STATUSES`（13 个，2026-09-20 核对）。

### Google path

```
draft → funding → pending_internal_review → approved → creating → active
```

submit 时即完成 wallet debit，**无平台资源、无 ad account**。**一次 admin approve** 即推进到底：分配账户 → 建 Google setup（不产生第二次 debit）→ **自动激活到 `active`**。

**没有第二道人工门。**唯一的失败分支是账户池无可用号，此时激活被延后（API 返回 `autoActivated=false` + `activationDeferredReason`）。

### Meta path（两阶段人工）

```
draft → funding → account_binding → pending_internal_review → approved → creating → active
```

绑定广告账户和审核广告内容是**两个人的活，所以是两个状态**：

- `account_binding`：客户没有已绑定的 Meta 广告账户时停在这里，**等 admin 人工绑号**。已有绑定账户的直接跳到内容审核。
- `pending_internal_review`：审广告内容。

⚠️ **这两个状态在用户侧都显示为 "pending"，客户看不出区别。**测试时要区分必须从 Admin 侧或只读 API 读实际状态，不能只看 User Dashboard 文案。

### 全部状态

| 状态 | 含义 |
|---|---|
| `draft` | 草稿，未提交 |
| `funding` | submit 时的内部扣款态；debit 未完成前不可审核 |
| `account_binding` | **Meta 专有**：等 admin 人工绑定广告账户 |
| `pending_internal_review` | 已 funded，等 admin 审内容；无 ad account / 平台资源 |
| `approved` | 审核通过，准备分配账户并创建 |
| `creating` | 平台资源构建中 |
| `active` | 真实投放，可能消费 |
| `paused` | 平台已创建，暂停中 |
| `completed` | 预算耗尽或到期结束 |
| `cancelled` | 取消，按退款规则处理 |
| `superseded` | **终态，且刻意不叫 `cancelled`**：钱没退回，是**转移**了。广告账户被封导致 campaign 必须在替换账户上重建时设置，未花完的预算**拨给后继 campaign 而不是退回钱包**。不退款是结构性保证——`eligibleCampaignRefundWhere` 只扫 `cancelled` 和 `completed`。 |
| `failed` | approve 之后的 setup 失败 |
| `rejected` | **不是死路**：admin reject 之后 campaign 仍可 **reopen**。只有 reject 之后再 cancel 才彻底终结，不能再 reopen。 |

**Reject 的可恢复性（2026-09-20 用户确认）**：

- `reject` → 仍可 `reopen`，campaign 回到可推进状态。
- `reject` → `cancel` → **终态，不可 reopen**。
- 代码里 `rejected` 被标为 "legacy terminal review outcome"，注释称当前 admin Reject 让 campaign 保持 pending。无论最终落在哪个状态名，**可测的事实是 `allowedActions` 里还有没有 `reopen`**，断言应该断这个，而不是断状态名。

<!-- STALE 2026-09-20: 原文此处有「Admin-created path：`draft → creating → paused → active`，平台资源先以 PAUSED 创建，之后 Admin review 才允许 active」。代码中搜不到任何 admin 侧创建 campaign 的入口（`adminCreate` / `createCampaignAsAdmin` / admin create campaign 均无结果），用户 2026-09-20 确认此路径不存在。已删除，依赖它的 LAUNCH-006 断言一并删除。 -->

<!-- STALE 2026-09-20: 原文「`paused`：平台已创建但未消费，等待 Admin gate」把 paused 描述成一道审核门。Google path 下 approve 后自动激活，不存在这道门；paused 是 active 之后的暂停态，或激活被延后时的停留态。已改写。 -->

## 投放树（可起草的 Campaign 类型）

来源：用户提供的完整「Hellyeah 当前支持的 Campaign 投放树」（2026-10-20，对应前端 `campaign-methods.ts`）；`partial` = 可投放但能力不全。改动 Agent、输入框、目标 chip 或投放流程时，Case 设计 G6 的「投放树遍历」读这一节。

| 平台 | 目标 | 叶子（Campaign 类型） | 状态 | 备注 |
|---|---|---|---|---|
| Google Ads | Sales / Conversions | Google Search | partial，可投放，推荐优先 | 出价优化转化；需 X-Ray tracker，缺失时只给 advisory，不卡提交 |
| Google Ads | Sales / Conversions | Google Performance Max | partial，可投放 | 需 image_creative（横版 + 方版图 + logo） |
| Google Ads | Leads | Google Search（可选 lead form） | partial | 同样走转化追踪，缺失时 advisory |
| Google Ads | Leads | Google Performance Max | partial | 同样需 image_creative |
| Google Ads | Traffic | Google Search（maximize_clicks） | partial | |
| Google Ads | Awareness / Branding | — | none | Google 没有对应广告系列类型，不提供入口 |
| Google Ads | Apps | — | none | 没有原生 App Campaign / MMP 归因 |
| Meta | Branding → OUTCOME_AWARENESS | Meta Reach（REACH / IMPRESSIONS 计费） | partial | |
| Meta | Traffic → OUTCOME_TRAFFIC | Meta Traffic（LINK_CLICKS / LANDING_PAGE_VIEWS） | partial | |
| Meta | Leads → OUTCOME_LEADS | Meta Instant Form（原生表单，ON_AD，LEAD_GENERATION） | partial，method 已提供 | |
| Meta | Leads → OUTCOME_LEADS | 外部站内 Leads（WEBSITE 目的地，走 Pixel，OFFSITE_CONVERSIONS） | 能力表登记了，但 `campaign-methods.ts` 没有对应卡片，前端暂不提供入口 | 期望：无入口 |
| Meta | Conversions / Sales → OUTCOME_SALES | Meta Sales（WEBSITE，OFFSITE_CONVERSIONS，需 own Pixel + Purchase 事件） | partial | |
| Meta | Apps → OUTCOME_APP_PROMOTION | Meta App Promotion（APP_INSTALLS / OFFSITE_CONVERSIONS） | 有条件 partial：仅当该组织是 BYO 自有账户且 app 被服务端解析成功时才可投放，否则 none | BYO 测试组织由 QA 负责人在测试前准备；**没有明确告知已准备好，就记 Blocked**（恢复条件：QA 负责人提供 BYO 组织和可解析的 app），不自己搭环境。已提供时，起草前核对该组织确为 BYO 账户、app 解析成功；条件不满足时期望是无入口 |
| Meta | Engagement → OUTCOME_ENGAGEMENT | — | none | capability 表里只占位，optimizationGoals / billingEvents 为空，不可投放，没有对应 method，期望：无入口 |

规则：状态为 `none` 或「无入口」的行，期望是**入口不存在**（negative），不是能起草。叶子之间共用同一条前端/后端路径时，Case 设计可合并，合并理由写进计划。

## 前置条件

- active org、campaign/draft、平台、预算、日期和 business objective 明确。
- 当前钱包 available balance、pending debit 和 reservation 基线已记录。
- Creative/readiness 条件按 ticket 和当前产品规则满足；不凭普通 profile complete 推断 PMax ready。
- 区分 Google path（一次 approve 到底）和 Meta path（先 account_binding 人工绑号）。
- Launch/approve/active 属于资金或投放副作用，确认授权范围和 cleanup。

## Browser 观察点

- Launch 页面中的平台、campaign 类型、预算、日期、地域、creative 和 readiness。
- Submit 返回状态、campaign 列表/详情和钱包变化。
- pending review 的状态、可用动作、ad account/platform resource 是否仍为空。
- Admin 审核后的状态转换和拒绝原因。
- active/paused/cancelled 等用户可见状态与只读 campaign/wallet 事实。

## Page Signals

| Surface | URL pattern | Required visible anchors | Optional anchors | Wrong-page signals |
|---|---|---|---|---|
| Campaign composer/review | Dashboard campaign/draft 路由 | Campaign 名称；平台；预算；Launch/Submit 状态 | schedule、location、creative | onboarding 未完成 gate |
| Campaign list/detail | Dashboard campaigns 路由 | Campaign 状态；名称 | review banner、allowed actions | 旧 org 或无法关联实体 |
| Admin review | Admin campaign/review 路由 | 待审核 campaign；approve/reject 语义 | ad account、审核备注 | Customer Dashboard shell |
| Platform evidence | Google/Meta 或只读后台 | 可关联 platform resource 和状态 | spend、policy detail | 无 campaign correlation |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| LAUNCH-ACT-001 | 读取 launch readiness | draft、org、platform 明确 | 返回 readiness、预算、creative 和阻塞事实 | read | 缺模块时记录 model_gap |
| LAUNCH-ACT-002 | 提交 public launch | readiness 和资金授权满足 | funding 后进入 pending_internal_review | financial/platform side effect | 超时后执行 ACT-003，禁止重发 |
| LAUNCH-ACT-003 | 核验 submit 结果 | 有名称/ID/time correlation | 返回 campaign、debit、reservation 和资源事实 | read | 未知时保持 action_unknown |
| LAUNCH-ACT-004 | 执行获授权的 admin review | campaign 正处 pending review | approve→creating→自动激活；reject→保持可 reopen + 退款 | high impact | 记录审核人/结果，立即核验状态 |
| LAUNCH-ACT-005 | 核验 lifecycle 终态 | 已 approve/reject/launch | 返回状态序列、平台和资金事实 | read | 按异步预算观察，超时 Inconclusive |
| LAUNCH-ACT-006 | 清理本轮 campaign | 当前状态允许对应 cleanup | discard/cancel/reject 后状态和资金一致 | side effect | 不支持清理时记录 residual entity |

## Facts

| ID | Meaning | Source surface | Shape | Freshness |
|---|---|---|---|---|
| LAUNCH-FACT-IDENTITY | 本轮 campaign 关联信息 | UI/API | `{campaignRef, name, orgRef, platform, path}` | 创建后固定 |
| LAUNCH-FACT-READINESS | Launch 前置状态 | composer/preflight | `{ready, blockers[], creativeState, budgetCents}` | 提交前读取 |
| LAUNCH-FACT-STATUS | Campaign 当前业务状态 | UI + campaign detail | `{status, pending_internal_review?, allowedActions[]}` | 每次状态动作后 |
| LAUNCH-FACT-FUNDING | 与 campaign 关联的资金状态 | wallet/reservation/transaction | `{debitStatus, reservedCents, transactionCount}` | submit/cleanup 前后 |
| LAUNCH-FACT-ACCOUNT | 广告账户分配状态 | campaign/Admin | `{adAccountRef?, health?, assignedAt?}` | review 前后 |
| LAUNCH-FACT-PLATFORM | 平台资源与 delivery 状态 | platform/backend | `{resourceRef?, status?, spendCents?}` | creating/active 后 |
| LAUNCH-FACT-REVIEW | Admin 审核结果 | Admin/campaign | `{decision?, reason?, decidedAt?}` | review 动作后 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| LAUNCH-001 | negative | preflight/readiness 不满足 | 在资金或平台副作用前明确拒绝，给出可执行原因 | UI + API | 拒绝状态、钱包/实体基线 | ticket 明确允许降级；错误测试数据 |
| LAUNCH-002 | state_transition | public submit 成功 | debit 完成后进入 pending_internal_review；submit 不等于 live | UI + campaign/wallet read | campaign 状态、资金交易/reservation | 异步 funding 尚未终结 |
| LAUNCH-003 | exact | pending_internal_review | `adAccountId` 和平台资源仍为空，setup snapshot 冻结 | campaign detail/UI | 状态和资源事实 | 已经 admin approved；读取旧缓存 |
| LAUNCH-004 | cross_surface | admin approve public request | 分配账户，进入 creating/setup，复用原 debit，不产生第二次 submit debit | Admin + campaign + wallet | 状态序列、账户、交易/reservation | 不同 campaign；合法 re-open fresh debit |
| LAUNCH-005 | eventual | public setup 成功 | 最终 active；中间平台资源以安全状态创建，不在 gate 前消费 | UI + campaign/platform evidence | 状态时间线、active 事实 | 仍在合理创建窗口；平台异步延迟 |
| LAUNCH-006 | state_transition | Meta 提交且客户无已绑定广告账户 | 停在 `account_binding` 等 admin 人工绑号；绑定后才进入 `pending_internal_review` | Admin + campaign read | 状态序列、绑定前后的 account 事实 | 客户已有绑定账户（应直接进内容审核）；ticket 测的是 Google path |
| LAUNCH-006b | negative | Meta 两阶段进行中 | 用户侧 `account_binding` 和 `pending_internal_review` 都显示为 pending，不暴露内部分工；但只读事实必须能区分 | UI + API | UI 文案截图 + 只读状态 | 产品明确改为对客户展示细分状态 |
| LAUNCH-006c | negative | 广告账户被封导致 campaign 在替换账户上重建 | 原 campaign 进入 `superseded`（**不是** `cancelled`），未花完预算拨给后继 campaign，**不退回钱包** | campaign + wallet | 前后状态、后继 campaign 引用、钱包无退款入账 | 账户未被封；产品改变结转规则 |
| LAUNCH-007 | negative | 账户池为空或账户不健康 | funded public request 保持可恢复的 pending_internal_review，不二次扣款 | campaign + wallet | 状态、无第二 debit | 实际已分配健康账户 |
| LAUNCH-008 | cross_surface | pending request 被 reject | 立即全额退款（从未激活）；campaign **保持可 reopen**，`allowedActions` 含 `reopen` | Admin/UI + wallet/refund | 退款状态和金额、allowedActions | platform 已可能 spend，适用 settlement 路径不同 |
| LAUNCH-008b | negative | reject 之后再 cancel | 进入真终态，`allowedActions` **不再包含 `reopen`** | UI + campaign read | 两步后的 allowedActions | 产品改变 reopen 规则 |
| LAUNCH-009 | negative | action 超时/浏览器断开 | 不重复 submit/launch；先核对 campaign、debit 和 reservation | UI + read-only facts | unknown action 和核验结果 | 已证明请求根本未发送 |
| LAUNCH-010 | visible | campaign 已 submitted/reviewing | UI 不宣称 live/active，下一步和审核状态清晰 | UI | 状态文案截图 | 产品明确将状态文案重命名且语义不变 |

## 副作用与恢复

Submit/Launch/Approve 会产生资金、平台资源或投放副作用。任何超时或中断先标 `action_unknown`，按 campaign name/ID、wallet transaction、reservation 和列表核验，禁止盲目再次提交。

只清理本轮创建的 campaign。Cancel、reject、discard 和 refund 不是同义 cleanup；根据当前状态选择合法动作，并在操作后核对资金和平台状态。Campaign 可能无法立即删除，报告必须记录 residual entity 和预算状态。

## Bug 判断知识

### 高置信 Bug

- public submit 被当作 active，绕过内部审核或平台创建 gate。
- pending_internal_review 已有平台资源/ad account，违反当前生命周期合同。
- approve/retry 产生不应有的第二次 debit。
- campaign UI 状态、钱包 reservation/transaction 和后台状态明确矛盾。
- active 前缺少必要人工 gate，或 gate 后状态不推进且已排除环境/平台等待。

### 风险或待确认

- pending review 后尚未取得 Admin/平台证据。
- creating 长时间未终结，但缺 worker/log/平台状态。
- creative/readiness、预算口径或平台规则在近期版本发生变化。

### 不能直接判 Bug

- campaign 创建或 submit 成功但仍在 pending review。
- `adAccountId` 在 pending review 为 null。
- 普通 profile/doctor 通过但 PMax gate 因专属 readiness 拒绝。
- failed/orphan draft 显示历史 `reservedCents`，但 wallet 无 debit 且 `activeReservedCents=0`；此时重点检查清理路径。
- no-location PMax 使用当前明确的 Worldwide 默认，不应沿用旧规则判错。
- **Meta 提交停在 `account_binding`** —— 等 admin 人工绑号是设计内的两阶段，不是卡住。
- **用户侧看不出 `account_binding` 和 `pending_internal_review` 的区别** —— 两者都显示 pending 是刻意设计，不是状态展示缺陷。
- **`superseded` 状态下钱包没有退款入账** —— 预算是转移给后继 campaign，不是丢失。误判成资金 Bug 前先找后继 campaign。
- **Google path 下 approve 后没有第二次人工操作** —— 不要等一个并不存在的 unpause 步骤，也不要因为没有这一步判流程缺失。

## 历史风险与回归探针

- 创建成功被误报为已真实投放。
- pending review 后未继续验证审核和 active。
- creative set/readiness 与 launch mapping 不一致。
- 失败 draft 无 discard 或 next-step 指向不可用动作。
- platform asset duplicate 错误被误导性次级错误掩盖。
- location/keyword/forecast 更新后仍使用旧缓存和预算派生值。

## 待补测

| ID | 要验证什么 | 前置与做法 | 来源 | 状态 |
|---|---|---|---|---|
| LAUNCH-RT-001 | 投放入口（输入框、目标 chip、Agent 对话）改动后，投放树里每个「可投放」叶子仍能起草出有效 campaign 草稿：Google Search / PMax 的 Sales、Leads，Google Search 的 Traffic，Meta 的 Reach、Traffic、Instant Form、Sales，以及满足 BYO 条件时的 Meta App Promotion | 只做到「起草并读回草稿字段」，不 launch、不花钱；PMax 另核 image_creative 要求；`none` / 无入口的行（Google Awareness、Apps，Meta 外部站内 Leads、Engagement，不满足条件的 App Promotion）核对入口确实不存在 | 用户评审 PE-884 复测 2026-10-20：改了 launch 输入框，没测 PMax / Search / Leads 能否起草，覆盖率 70% | 未测 |

## 已知缺口

- Creative Studio、Admin Review 和 Campaign Lifecycle 后续应拆为独立模块；本模块只保留 Launch 必需接口。
- QA Knowledge 中存在预算口径历史冲突，涉及预算模型的 ticket 必须回查当前业务文档、目标 PR 和 version history，不能直接使用风险文件定义预期。
- 尚未通过真实 Browser launch ticket 验证全部状态断言。

## 模型回流

试跑后补充 Customer/Admin 稳定页面锚点、状态等待预算和 campaign correlation 方式。预算口径、平台策略或 creative readiness 的新规则必须先进入对应独立模块或 QA 工作台。

<!-- 2026-09-20: CLI 已退出 QA 范围，相关 surface、来源和交叉核验手段已删除。只读交叉核验改用 API / Admin Dashboard。 -->

## 不可测与不设计

| ID | 检查内容 | 处理 | 原因与恢复条件 | 来源 |
|---|---|---|---|---|
| LAUNCH-NT-001 | Meta App Promotion 能否起草（需 BYO 自有账户且 app 被服务端解析成功） | Blocked（默认） | BYO 测试组织由 QA 负责人在测试前准备；没有被明确告知已准备好就不执行。恢复条件：QA 负责人提供 BYO 组织和可解析的 app | 用户裁定 2026-10-20 |

