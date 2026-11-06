---
id: hellyeah.campaign-lifecycle
type: module
product: hellyeah
surfaces: [customer-dashboard, admin-dashboard, api, ad-platform]
status: pilot
version: 1
last_reviewed: 2026-10-19
related_modules: [hellyeah.campaign-launch, hellyeah.admin-review, hellyeah.wallet-payment]
---

# Campaign Lifecycle（Campaign 生命周期）

## 业务目标与边界

Campaign 在创建、审核、投放、暂停、恢复、取消、完成和失败之间只走合法状态转换；UI actions、平台状态、资金和退款保持一致。Launch 建立过程由 campaign-launch 模块负责，本模块聚焦 launch 后管理和终态。

## Ticket 路由信号

`pause`、`resume`、`cancel`、`complete`、`failed`、`reopen`、`allowedActions`、`refundEligibleAt`、`status sync`、`lifecycle`、`stuck recovery`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| LIFE-S01 | `sources/hellyeah/business_file/managed-ads/campaign-lifecycle.md` | observation | historical snapshot, synced 2026-08-05 |
| LIFE-S02 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| LIFE-S03 | `sources/hellyeah/business_file/shared/payments/refund-flow.md` | observation | historical snapshot, synced 2026-08-05 |
| LIFE-S04 | `sources/qa-knowledge/domains/campaign.md` | risk | source recheck required |

## 状态模型

核心状态（13 个，以 `CAMPAIGN_STATUSES` 为准）：`draft`、`funding`、`account_binding`、`pending_internal_review`、`approved`、`creating`、`active`、`paused`、`completed`、`cancelled`、`superseded`、`failed`、`rejected`。

Allowed actions 由当前状态和历史 activation 决定，**不能只按状态名称猜测**。

<!-- 2026-09-20: 补 account_binding（Meta 人工绑号）和 superseded（封号重建、预算转移不退款）。 -->

**退款判据是「有没有激活过」，不是取消入口**（2026-09-20 用户确认）：未激活即时退；激活过走 48h 结算窗口（`REFUND_SETTLEMENT_MINUTES`）；`superseded` 不退款。

**reject 不是终态**：reject 后仍可 `reopen`；只有 reject 之后再 cancel 才终结。断言断 `allowedActions`，不断状态名。

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Campaign list | Dashboard campaigns route | status/filter/campaign identity | draft composer |
| Campaign detail | campaign detail route | roadmap；allowed actions；budget/platform | wrong campaign/org |
| Admin lifecycle | Admin campaign detail | platform/account/state controls | customer-only action set |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| LIFE-ACT-001 | 读取 lifecycle facts | campaignRef/org known | 返回 current/history/actions/funding/platform | read | 跨 surface 核对 |
| LIFE-ACT-002 | Pause active campaign | allowedActions 包含 pause | active→paused，平台停止/将停止消费 | reversible side effect | 超时先核验，不重按 |
| LIFE-ACT-003 | Resume previously active campaign | allowedActions 包含 resume | paused→active，保留关联资源 | spend side effect | 需要明确授权；超时核验 |
| LIFE-ACT-004 | Cancel campaign | allowedActions 包含 cancel | 进入 cancelled/refund path | irreversible business action | 必须明确授权并核对 refund |
| LIFE-ACT-005 | 核验 completed/failed/rejected | 已进入终态 | 状态、原因、资金、平台一致 | read | 缺后台事实时 Inconclusive |
| LIFE-ACT-006 | Reopen eligible request | refund 已完成且规则允许 | 新 debit 和新的 review 流程 | financial side effect | 作为新 run/实体跟踪 |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| LIFE-FACT-STATUS | 当前/历史状态 | UI/API | `{current,history[],changedAt}` |
| LIFE-FACT-ACTIONS | 服务端允许动作 | campaign detail | `{allowedActions[]}` |
| LIFE-FACT-PLATFORM | 平台 delivery | platform/backend | `{status,spendCents?,resourceRef?}` |
| LIFE-FACT-FUNDING | reservation/refund | wallet/campaign | `{reservedCents,activeReservedCents,refundStatus?,eligibleAt?}` |
| LIFE-FACT-REASON | failure/reject/cancel 原因 | UI/API | `{reason?,failedAt?,reviewedAt?}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| LIFECYCLE-001 | cross_surface | detail 加载 | UI status/actions 与服务端 facts 一致 | STATUS + ACTIONS | stale cache/async transition |
| LIFECYCLE-002 | state_transition | pause allowed | active→paused，平台和 UI 最终一致 | STATUS + PLATFORM | provider propagation window |
| LIFECYCLE-003 | state_transition | resume allowed | previously active paused→active，不创建新 campaign/debit | STATUS + FUNDING | pre-activation paused 只允许 cancel |
| LIFECYCLE-004 | negative | pending review 或首次 activation 前 paused | 不错误展示 Resume；按 contract 仅 Cancel | ACTIONS + UI | 目标版本改变 contract |
| LIFECYCLE-005 | state_transition | cancel | terminal state、平台 teardown 和 refund 语义符合路径 | STATUS + PLATFORM + FUNDING | 48h settlement 尚未到期 |
| LIFECYCLE-006 | eventual | budget/end date 达成 | active/paused 最终 completed，未花预算按规则结算 | STATUS + FUNDING | metrics/settlement 延迟 |
| LIFECYCLE-007 | visible | rejected/failed | 原因和时间可追溯，合法恢复动作清晰 | REASON + UI | 无 customer-facing reason contract |
| LIFECYCLE-008 | negative | failed/orphan draft | 历史 reserved 字段不等同 active 占用；提供合法 cleanup | FUNDING + ACTIONS | activeReservedCents/账本确有占用 |
| LIFECYCLE-009 | negative | 动作超时 | 不重复 pause/resume/cancel，先读取终态 | action record + STATUS | 已证明请求未发送 |
| LIFECYCLE-010 | state_transition | reopen | 仅 refund 完成后创建 fresh debit，不复用旧未决资金 | STATUS + FUNDING | ticket 不覆盖 reopen |

## 副作用、Bug 判断与回流

Resume/Cancel/Reopen 可能重新消费或改变退款，必须明确授权。高置信 Bug：非法 action 可执行、状态与平台/资金长期矛盾、取消重复退款、resume 创建新实体/重复 debit。合法 settlement 窗口和 provider propagation 不直接判 Bug。待真实 ticket 验证 allowedActions 和时间预算。

<!-- 2026-09-20: CLI 已退出 QA 范围，相关 surface、来源和交叉核验手段已删除。只读交叉核验改用 API / Admin Dashboard。 -->

## 不可测与不设计

| ID | 检查内容 | 处理 | 原因与恢复条件 | 来源 |
|---|---|---|---|---|
| LIFE-NT-001 | 已投放但尚未上报数据时 Overview 的展示；首个有上报数据的日期及与平台数据核对（PE-884 C 节） | Blocked | 投放要经 admin 审核、真实跑数天后才有上报数据，无法实时观察；恢复条件：有 campaign 已通过审核并真实投放、产生上报数据的组织。上线前（无任何投放）的状态可以测，不在此条 | 用户裁定 2026-10-19（PE-884 复测） |
