---
id: hellyeah.admin-review
type: module
product: hellyeah
surfaces: [admin-dashboard, customer-dashboard, api]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.campaign-launch, hellyeah.creative-studio, hellyeah.wallet-payment]
---

# Admin Review（管理员审核）

## 业务目标与边界

Ops/Admin 对 pending campaign 的广告质量、安规、账户与投放条件做人工 gate，记录 approve/reject 决定并推动正确生命周期。模块不负责平台创建内部实现。

## Ticket 路由信号

`admin review`、`pending_internal_review`、`approve`、`reject`、`rejection reason`、`ad account assignment`、`review queue`、`moderation`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| REVIEW-S01 | `sources/hellyeah/business_file/admin-dashboard/campaigns.md` | observation | historical snapshot, synced 2026-08-05 |
| REVIEW-S02 | `sources/hellyeah/business_file/managed-ads/campaign-lifecycle.md` | observation | historical snapshot, synced 2026-08-05 |
| REVIEW-S03 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| REVIEW-S04 | `sources/qa-knowledge/domains/admin-review.md` | risk | current guidance |

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Review queue | Admin campaigns/review route | pending campaign rows；status/filter | customer campaign list |
| Review detail | Admin campaign detail | campaign identity；creative/ad preview；approve/reject | wrong org/campaign |
| Customer detail | Dashboard campaign detail | pending/launching/rejected roadmap | admin-only controls exposed |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| REVIEW-ACT-001 | 读取待审核对象 | admin permission + campaignRef | review facts 与 customer campaign 对齐 | read | 无权限则 WaitingUser/Blocked |
| REVIEW-ACT-002 | 审核 creative/targeting/budget/account | 完整 review evidence | 形成 approve/reject decision | manual/read | 缺证据不提交决定 |
| REVIEW-ACT-003 | Approve | pending review 且授权明确 | approved→creating/setup | high impact | 超时后只读核验，禁止重按 |
| REVIEW-ACT-004 | Reject with reason | pending review 且授权明确 | rejected + reason + refund path | high impact | 核对 customer UI/wallet |
| REVIEW-ACT-005 | 核验决定传播 | decision 已提交 | Admin、Customer、campaign、wallet 一致 | read | 按异步预算等待 |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| REVIEW-FACT-CAMPAIGN | 审核对象 | Admin/campaign | `{campaignRef,orgRef,status,platform,budget}` |
| REVIEW-FACT-CREATIVE | 审核素材与文案 | Admin/Studio | `{setRef,copy,imageRefs,readiness}` |
| REVIEW-FACT-DECISION | 审核决定 | Admin/API | `{decision,reason,decidedAt,reviewerRef?}` |
| REVIEW-FACT-ACCOUNT | 账户分配/健康 | Admin/campaign | `{adAccountRef?,health?,poolState?}` |
| REVIEW-FACT-CUSTOMER | 用户侧 roadmap | Customer UI | `{status,reason?,reviewedAt?,allowedActions}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| REVIEW-001 | cross_surface | review detail 打开 | 审核对象、org、budget、platform 与 customer/campaign 一致 | CAMPAIGN + customer facts | 页面旧缓存 |
| REVIEW-002 | negative | creative/readiness 不完整 | 不得 approve；给出明确阻塞证据 | CREATIVE + decision controls | ticket 明确豁免且有来源 |
| REVIEW-003 | state_transition | approve | pending→approved/creating，账户在 gate 后分配 | DECISION + ACCOUNT + status timeline | setup 尚在合理窗口 |
| REVIEW-004 | state_transition | reject | reason/time 持久化，未激活则立即全额退款；campaign **保持可 reopen**，`allowedActions` 含 `reopen` | DECISION + CUSTOMER + wallet + allowedActions | platform 已消费的 settlement 路径不同 |
| REVIEW-004b | negative | reject 之后再 cancel | 进入真终态，`allowedActions` **不再含 `reopen`** | 两步后的 allowedActions | 产品改变 reopen 规则 |
| REVIEW-005 | visible | customer 查看 rejected | 显示拒绝原因与时间，后续 cancel 不丢失 rejection milestone | CUSTOMER screenshot | 当前 ticket 不含 customer roadmap |
| REVIEW-006 | negative | approve/reject 超时 | 不重复提交决定，先查 decision/status | action record + DECISION | 已证明请求未发出 |
| REVIEW-007 | cross_surface | decision 传播完成 | Admin、Customer、campaign、wallet 状态无矛盾 | all facts | eventual consistency 未过预算 |
| REVIEW-008 | negative | 无 Admin 权限 | 不伪造审核完成；进入轻量协作/Blocked | permission evidence | 可用专用测试 Admin 会话 |

## 副作用、Bug 判断与回流

Approve/Reject 是高影响动作，只对明确测试对象执行一次。高置信 Bug 包括 gate 被绕过、决定作用于错误 campaign/org、拒绝原因丢失、approve 重复扣款、customer/admin 状态永久矛盾。无 Admin 权限或仅 pending 状态不是 Bug。真实试跑后补权限角色、review evidence checklist 和状态等待预算。
