---
id: hellyeah.core-journeys
type: module
product: hellyeah
surfaces: [customer-dashboard, admin-dashboard, api]
status: draft
version: 2
last_reviewed: 2026-09-20
related_modules: [hellyeah.onboarding-brand, hellyeah.campaign-agent, hellyeah.creative-studio, hellyeah.campaign-composer, hellyeah.campaign-launch, hellyeah.admin-review]
---

# Core Journeys（核心链路回归清单）

**独立的完整主链回归，不是普通 ticket 默认步骤。**

仅在用户明确要求 release regression，或 ticket 属于跨主链高风险改动时启用。普通 ticket 只执行 checklist 加最多两条相关风险 smoke。

## 清单来源

两部分合并：

1. **已有的 Playwright release case**（`hy_ui_autotest/tests/release/cases/`）—— 借用链路划分和 stage 命名
2. **代码里的客户漏斗** `CUSTOMER_STATUSES`（`packages/shared/src/constants/identity.ts`）：

```
first_message → website_provided → strategy_confirmed
→ creatives_confirmed → budget_confirmed → top_up_complete → campaign_live
```

Playwright 覆盖了漏斗的首尾，**中间的 `strategy_confirmed` 和 `creatives_confirmed` 没有对应 case**——这是合并的主要价值，补上了 J2、J3。

⚠️ **本 skill 不调用那套 Playwright**，两者各管各的。这里只借用链路划分，执行用 Browser。

## 执行顺序

有依赖关系，**必须按序**。

```
（登录：前置，不算回归项）
     ↓
J1 Onboarding → J2 策略确认 → J3 素材确认 → J4 提交投放 → J5 审核放量
                                                              ↑
                                                       换 admin 角色
```

---

## 前置：登录

**不算回归项**，但每轮必须先做——不登录测不了任何东西。

Playwright 对应 `02-login`（stage：`ui-login` → `identity-bind` → `session-api`）。

准备阶段确认：

- 登录成功，active org 已解析（`orgScope.status === "ready"`）
- UI 显示的组织与只读身份事实一致
- 组织作用域数据可读

登录本身失败 → 整轮 `Blocked`，不是回归失败。

---

## J1 · Onboarding 与品牌确认

| | |
|---|---|
| **漏斗节点** | `website_provided` |
| **角色** | user |
| **Playwright 对应** | `03-onboarding`（`completeForcedOnboarding`，产出一个新 draft ID） |
| **业务终点** | 品牌资料已确认并持久化，且**产出了一个可用的 campaign draft** |
| **前置** | onboarding 未完成的账号；受控的域名/企业名输入 |

**关键观察**

- 研究分两阶段（`fast-pass` / `deep-pass`），「研究完成」有两个时间点，**等待预算分档，不要用单一超时**
- 研究结果的业务和域名与用户输入一致，不能静默用无关旧 profile 填充
- 不可达域名应明确失败，不能伪造成功
- 完成后产出的 draft ID 记下来 —— J2 用它

> 代码里这个流程叫 `completeForcedOnboarding`，说明它是**强制 gate**，不是可跳过的引导。

**相关模块**：[onboarding-brand](onboarding-brand.md)

---

## J2 · 策略确认（Agent 出方案）

| | |
|---|---|
| **漏斗节点** | `strategy_confirmed` |
| **角色** | user |
| **Playwright 对应** | **无** ← 合并客户漏斗后新增 |
| **业务终点** | Agent 产出的 campaign plan 已持久化，且用户确认了目标、平台、地域、预算方向 |
| **前置** | J1 完成，有品牌 profile |

**关键观察**

- 自然语言摘要与持久化的 plan 一致 —— 不能说一套存一套
- **用户明确指定的平台 / 地域 / 目标不被默认值覆盖**
- 用户没要求视觉内容时不擅自选 PMax
- 同一轮对话不重复创建 draft
- **Search campaign 的关键词必须覆盖四类**：brand / competition / general / negative（`AGENT-009`，缺类判质量 Bug）

**相关模块**：[campaign-agent](campaign-agent.md)

---

## J3 · 素材确认

| | |
|---|---|
| **漏斗节点** | `creatives_confirmed` |
| **角色** | user |
| **Playwright 对应** | **无** ← 合并客户漏斗后新增 |
| **业务终点** | Creative Set 生成完成且在 Composer 中被选中，readiness 通过 |
| **前置** | J2 完成，有 campaign draft |

**关键观察**

- `partial` 不等于可用 —— 必需的 landscape / square 任一失败，set 就不该是 selectable
- **metadata 尺寸与真实文件尺寸一致** —— 下载实际图片核对，不能只信字段
- 图片里的文字可读、品牌相关
- Composer 里选中的 set 与 preview、readiness、最终 payload 是同一个

**相关模块**：[creative-studio](creative-studio.md)、[campaign-composer](campaign-composer.md)

---

## J4 · 提交投放

| | |
|---|---|
| **漏斗节点** | `budget_confirmed` |
| **角色** | user |
| **Playwright 对应** | `05-campaign-launch`（stage：`campaign-balance` → `draft-create` → `draft-open` → `draft-configure` → `launch-submit` → `launch-reconciliation-api` → `launch-result-ui` → `launch-consistency`） |
| **业务终点** | **不是**「提交成功」。是：wallet debit 完成、进入 `pending_internal_review`、reservation 已占、**`adAccountId` 仍为空** |
| **前置** | J3 完成；账号余额充足（预置） |

**关键观察**

- **submit 时即扣款**，approve 不会二次扣款
- `pending_internal_review` 时**没有 ad account、没有平台资源** —— 这是正常的，不是缺失
- UI 不能宣称已 live / active
- **Meta 路径**：客户无已绑定账户时停在 `account_binding` 等人工绑号；它和 `pending_internal_review` 在客户侧都显示 pending，只能从 Admin 或 API 区分

**Playwright 已知会碰到的两个分支**，手工跑也要留意：

- `E_NO_AD_ACCOUNT` —— 账户池为空，应保持可恢复的 pending，**不二次扣款**
- `Creative job belongs to meta, not google` —— 素材平台与 campaign 平台串了

⚠️ **如果遇到 funding gap，本身就是异常信号**（余额预置失效或产品缺陷），当作发现上报，**不要设法充值绕过**——sandbox 也充不了。

**相关模块**：[campaign-launch](campaign-launch.md)、[meta-campaign](meta-campaign.md)、[wallet-payment](wallet-payment.md)

---

## J5 · 审核与放量

| | |
|---|---|
| **漏斗节点** | `campaign_live` |
| **角色** | **admin** ← 换角色，所以是独立一条 |
| **Playwright 对应** | **无** ← Playwright 停在 submit |
| **业务终点** | campaign 到 `active`，且**没有产生第二次 debit** |
| **前置** | J4 完成，有 admin 账号 |

**关键观察**

- **Google**：一次 approve 到底 —— 自动分配账户 → 建 setup → **自动激活**。**没有第二道人工门**，不要等一个不存在的 unpause
- **Meta**：绑号在 approve **之前**
- 唯一的失败分支是**账户池无可用号** → 激活延后（`autoActivated=false` + `activationDeferredReason`）
- reject 之后 campaign **仍可 reopen**；只有 reject → cancel 才终结。**断 `allowedActions` 里有没有 `reopen`，不要断状态名**
- 决定要传播到客户侧：Admin、客户 UI、campaign、wallet 四处状态无矛盾

> **没有 admin 账号时**：本条记 `WaitingUser`，备好 campaign 标识后请求人工协作，**不要标成未覆盖**。

**相关模块**：[admin-review](admin-review.md)、[ad-account](ad-account.md)

---

## 不在回归清单内

以下链路**不进核心回归**，只在 ticket 明确涉及时测。

### 用户决定不回归（2026-09-20）

| 链路 | 说明 |
|---|---|
| **注册** | 对应 Playwright `01-registration`。不回归。<br>（注：该 case 第一步是 `account-cleanup`，注册链路需要干净的邮箱状态；如果哪天要测，注意邮箱已存在会走成登录） |
| **登录** | 作为**前置**每轮都做，但不作为回归项判定 |
| **生命周期与退款** | pause / resume / cancel / 退款形态。不回归。<br>退款判据见 [wallet-payment](wallet-payment.md)：**看有没有激活过**，未激活即时退、激活过走 48h；`superseded` 不退款 |

### 环境或成本原因

| 链路 | 为什么不进 |
|---|---|
| **钱包充值** | **sandbox 跳不到 Stripe 付款页，不可执行**。账号预置余额，后续链路不依赖它。哪天支付 gate 开放了再考虑 |
| X-Ray / GTM 转化回传 | 需要真实网站 + GTM 容器 + 真实投放 + 等归因窗口，远超单轮测试。见 [xray-gtm-conversion](xray-gtm-conversion.md) |
| 自动优化 | 需要 active campaign 跑一段时间才有分析周期。见 [campaign-optimization](campaign-optimization.md) |
| Vendor | 新功能，只在提测单涉及时测 |
| 成员邀请 / 角色管理 | 会发真实邮件、改真实权限，副作用越界 |
| 通知邮件全链路 | 需要 DB 注入、provider 测试事件 |

---

## 执行与记录

在报告的「核心链路回归」一节按下表记录：

| 链路 | 结论 | 说明 |
|---|---|---|
| J1 Onboarding | | |
| J2 策略确认 | | |
| J3 素材确认 | | |
| J4 提交投放 | | |
| J5 审核放量 | | |

**每条都要有结论**，不能空着。未执行的写明原因（`Blocked` / `WaitingUser` / `NotApplicable` / `NotRun`），不要静默跳过。

`NotApplicable` 要写明前置是什么、为什么不成立。

## 已知缺口

- **J2、J3 是合并客户漏斗后新补的**，没有自动化对应，也**尚未通过真实 ticket 试跑验证**，业务终点的定义可能需要按实际调整。
- J5 的 admin 账号已在 `_workflow/qa-environment.md` §7 配置；执行前仍需验证凭据和权限有效。
- 各链路的异步等待预算（研究 fast-pass / deep-pass、素材生成、setup、激活）都没有明确数值，需实测后补。
- 整条 J1→J5 **从未在 sandbox 上端到端跑通过**。
