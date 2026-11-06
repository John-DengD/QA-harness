---
id: hellyeah.index
type: index
product: hellyeah
---

# Hellyeah QA Model Index（Hellyeah QA 模块索引）

当前模块处于 `pilot` 阶段。Linear ticket 先选择 primary module，再加载必要的 adjacent modules。

Customer Dashboard 工单先读取 [Dashboard Ticket Routing](dashboard-routing.md)。

| Module | Primary routing signals | Adjacent modules |
|---|---|---|
| [auth-organization](auth-organization.md) | login、Clerk、organization、org switch、membership、cross-org、session、401/403、active org | wallet-payment、campaign-launch |
| [wallet-payment](wallet-payment.md) | wallet、balance、top-up、Stripe Checkout、transaction、reservation、refund、pending debit | auth-organization、campaign-launch |
| [campaign-launch](campaign-launch.md) | launch、submit、funding、pending internal review、approve/reject、ad account assignment、active/paused、reserved budget | auth-organization、wallet-payment；后续 creative-studio、admin-review |
| [onboarding-brand](onboarding-brand.md) | onboarding、brand research、website/domain、business candidate、profile、logo/colors | auth-organization、campaign-agent、creative-studio |
| [campaign-agent](campaign-agent.md) | agent session、campaign plan/draft、objective、conversion、targeting、memory、artifact | onboarding-brand、campaign-composer、creative-studio |
| [campaign-composer](campaign-composer.md) | composer/editor、readiness、dry-run、budget、schedule、targeting、Import from Studio | campaign-agent、creative-studio、wallet-payment、campaign-launch |
| [creative-studio](creative-studio.md) | Studio、Creative Set、reference、generation、landscape/square、partial、picker | onboarding-brand、campaign-composer |
| [admin-review](admin-review.md) | Admin/ops review、approve/reject、review queue、rejection reason | campaign-launch、creative-studio、wallet-payment |
| [campaign-lifecycle](campaign-lifecycle.md) | pause/resume/cancel/completed/failed、allowedActions、refund settlement | campaign-launch、admin-review、wallet-payment |
| [xray-tracking](xray-tracking.md) | X-Ray、tracker、event、conversion、pixel、postback、attribution、funnel | auth-organization、campaign-lifecycle |
| [xray-gtm-conversion](xray-gtm-conversion.md) *(draft, 非 agent 执行目标)* | GTM、Tag Manager、container、publish tag、conversion action、`cv_*` 白名单、Google postback | xray-tracking、campaign-launch、campaign-lifecycle |
| [settings-members](settings-members.md) | settings、member、invite、role、organization、Clerk membership | auth-organization、notification-delivery |
| [notification-delivery](notification-delivery.md) | notification、email preference、delivery、skipped、suppression、Resend | settings-members、campaign-lifecycle |
| [campaign-optimization](campaign-optimization.md) *(draft)* | optimization、full auto、budget update、auto pause、authorization envelope、quiet hours、risk class、optimization review | campaign-lifecycle、wallet-payment、admin-review、notification-delivery |
| [ad-account](ad-account.md) *(draft)* | ad account、account pool、assignment、application、awaiting_manual、reseller、MCC/BP、waitlist、account health | campaign-launch、admin-review、campaign-lifecycle |
| [meta-campaign](meta-campaign.md) *(draft)* | Meta、advantage_plus、OUTCOME_*、ad set、bid strategy、special ad category、publisher platform、account_binding | campaign-launch、ad-account、campaign-composer |

## 完整主链回归（按需）

[core-journeys.md](core-journeys.md) —— J1–J5：Onboarding → 策略确认 → 素材确认 → 提交投放 → 审核放量。仅用于明确的 release regression 或跨主链高风险改动；普通 ticket 使用 checklist 加最多两条相关风险 smoke。

登录是每轮前置但不作为回归项；注册、钱包充值、生命周期与退款不进回归（原因见清单内）。

## 组合示例

### Dashboard Top-up Ticket

Primary：`wallet-payment`。Adjacent：`auth-organization`。选择金额、交易、余额增量、刷新幂等和组织隔离断言。

### Public Campaign Launch Ticket

Primary：`campaign-launch`。Adjacent：`wallet-payment`、`auth-organization`。若涉及素材 readiness 或审核 UI，再加载后续的 creative/admin 模块。

### Org Switch Ticket

Primary：`auth-organization`。根据页面数据加载 `wallet-payment` 或 `campaign-launch` 验证跨组织隔离。

## 2026-09-20 审计与补建

本轮对照 `hellyeah-v2` `origin/staging` 代码做了一次交叉检验，报告见 [`../_audit-models-2026-09-20.md`](../_audit-models-2026-09-20.md)。

**已处理：**

- **删除编造的状态模型** —— `auth-organization` 的 6 个状态、`onboarding-brand` 的 6 个状态在代码中零命中，已替换为代码可查的真实信号，并把 QA 视角的抽象阶段显式标注为「非产品枚举」。
- **修正与已确认口径冲突的断言** —— `wallet-payment` 的 refund 状态、`admin-review` 的 reject 终态、`campaign-lifecycle` 的退款判据、`campaign-launch` 的 admin-created path。
- **补建三个缺失子系统** —— `campaign-optimization`、`ad-account`、`meta-campaign`。
- **补齐 `notification-delivery`** 漏掉的 4 个通知类型和 3 组枚举。
- **移除 CLI** —— QA 范围已排除，相关 surface / 来源 / 交叉核验手段全部删除。
- **术语统一** —— `operator` → `admin`（只有 user / admin 两个角色）；`pendingAdminReview` → `pending_internal_review`。

**`business_file/` 已降级**：159 个文件全部停在 2026-08-05，此后代码 304 次提交、68 个 DB migration、四个子系统无文档。**不再作为 QA 判定依据**，仅供理解产品最初形态。

## 模块准入门槛

模块从 `pilot` 升到 `active` 之前，其**状态模型、错误码、字段名**中的每个标识符必须满足其一：

1. 能在目标代码库中找到；
2. 显式标注为 **QA 概念状态**（非产品枚举），并说明对应哪个可观察信号。

这道检查可脚本化，几秒跑完。它本可以在建模当天拦住全部「编造状态」问题。

## 下一轮拆分候选

- vendor-management（新功能，仅在提测单涉及时测；目前只有一条孤立断言挂在 settings-members）
- stripe-revenue-connect
- postback-delivery
- reporting-performance
- creative-compositor
- meta-creative（Meta 的素材规格，现有 creative-studio 只覆盖 Google PLATFORM_SPECS）
