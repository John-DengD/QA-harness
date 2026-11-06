---
id: hellyeah.wallet-payment
type: module
product: hellyeah
surfaces: [customer-dashboard, admin-dashboard, stripe-checkout, api]
status: pilot
version: 2
last_reviewed: 2026-10-13
related_modules: [hellyeah.auth-organization, hellyeah.campaign-launch]
---

# Wallet & Payment（钱包与支付）

## 业务目标与边界

用户在明确组织中查看可用余额、充值、交易、reservation 和 refund 状态。完成 Checkout 不是业务终点；最终结果必须由支付状态、钱包账本和 UI 回读共同证明。

## Ticket 路由信号

`wallet`、`balance`、`top-up`、`Stripe Checkout`、`transaction`、`reservation`、`refund`、`pending debit`、`available balance`、`billing`，以及 payment/webhook 状态回写。Admin 侧追加：`admin credit`、`direct credit`、`reverse`、`reversal`、`冲正`、组织 Transactions tab。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| WALLET-S01 | `sources/hellyeah/business_file/shared/payments/top-up-flow.md` — 适用:Top-up lifecycle | authority | current, synced 2026-08-05 |
| WALLET-S02 | `sources/hellyeah/business_file/shared/payments/refund-flow.md` — 适用:Refund lifecycle | authority | current, synced 2026-08-05 |
| WALLET-S03 | `sources/hellyeah/product-memory.md` — 适用:Hellyeah payment judgment | risk | current guidance |
| WALLET-S04 | `sources/qa-knowledge/domains/payment.md` — 适用:Cross-product payment risks | risk | current guidance |
| WALLET-S05 | `sources/rulings/2026-10-13-wallet-pr1273-reversal.md` (PR #1273 浏览器验收（sandbox pr-1273，SHA `187c1be`）+ 2026-10-13 人工确认) — 适用:Admin direct credit 冲正 | authority | confirmed 2026-10-13 |
| WALLET-S06 | `sources/rulings/2026-10-14-wallet-pr1273-audit-concurrency.md` (PR #1273 exp1/exp2 验收（staging `229cd3674`）+ 2026-10-14 QA 负责人裁定（工作台 W-20261014-01、02、10、11、12）) — 适用:冲正审计与并发冲正 | authority | confirmed 2026-10-14 |

## 状态模型

Top-up：`checkout_created → pending → completed | failed`。超时或浏览器中断后业务结果可能为 `unknown`，必须只读核验。

资金：`balanceCents` 是总账语义；`availableBalanceCents` 反映可用余额；`pendingDebitCents` 是未决扣款；pending refund 与 credited refund 必须区分。

Refund：`pending` → `processing` → `completed`，失败为 `failed`（`REFUND_STATUSES`，`packages/shared/src/constants/managed-ads.ts`）。

**Admin direct credit 与冲正**（WALLET-S05，2026-10-13 确认）：

```
TOP-UP (source=Admin) ──冲正──> TOP-UP 仍在，状态转 REVERSED
                                 + 新增独立 REVERSAL 记录（负额）
REVERSED ──> 终态，不可再次冲正
```

冲正**不是删除**：原 top-up 记录保留在账本里并改状态，冲正本身是一条独立的负额记录。两条都永久留在 transaction history。冲正只调整钱包余额，**不退回支付方式**。

<!-- 2026-09-20: 原文写 `pending_settlement`/`awaiting_processing`/`completed`，与代码枚举不符，且漏了 `failed` 分支，已更正。 -->

**退款形态判据是「campaign 有没有激活过」，不是取消入口**（2026-09-20 用户确认）：

| 情况 | 退款 |
|---|---|
| 从没激活过（审核被拒、admin cancel、用户 cancel，**含已扣款未激活**） | **即时退款** |
| 激活过之后再 cancel | 走结算窗口（`REFUND_SETTLEMENT_MINUTES` 默认 48 小时，env 可调） |
| `superseded`（封号后 campaign 重建到替换账户） | **不退款**，预算转移给后继 campaign |

UI 不展示预计到账时间，这是设计，不判 Bug。

## 前置条件

- active org 明确，UI 和只读身份事实一致。
- 当前余额、pending debit、pending refund 和基线时间已记录。
- 金额、币种、测试支付环境和允许的最大测试金额明确。
- 使用 Browser 提交支付前确认当前授权；不记录卡号、CVC、OTP 或完整 checkout URL。

## Browser 观察点

- Wallet 页的 available balance、pending 状态、交易和退款提示。
- Top-up 表单金额、币种、Checkout 商户/商品和最终返回状态。
- 支付后的 Wallet 页刷新结果和 transaction 列表。
- 只读交叉核验：top-up status、wallet balance、transactions、reservations、refunds。

## Page Signals

| Surface | URL pattern | Required visible anchors | Optional anchors | Wrong-page signals |
|---|---|---|---|---|
| Wallet Dashboard | Dashboard wallet/billing 路由 | Available balance；Top Up 或交易入口 | pending debit、refund、reservations | 登录页；其它 org 明确名称 |
| Top-up form | Wallet 内弹窗/页面 | 金额输入；币种；继续/支付动作 | 当前 org、余额 | campaign budget 表单 |
| Stripe Checkout | Stripe-hosted checkout | 商户、金额、币种、支付表单 | 返回/取消入口 | 浏览器安全警告；非 Stripe host |
| Wallet result | Wallet/回跳页面 | 余额或交易状态 | success/pending/failed 提示 | 无法关联到本次 session |
| Admin 组织 Transactions | Admin `/organizations/<id>` 的 Transactions tab | DATE / TYPE / SOURCE / AMOUNT / BALANCE / STATUS 表头 | Reverse 按钮、组织名、Balance 摘要 | 其它组织详情页；Admin 登录页 |
| Admin 冲正对话框 | Transactions tab 内弹窗 | 冲正金额、原交易时间、Reason 输入框、全额确认按钮 | 「不退回支付方式」说明 | 普通 Top Up 弹窗（只有金额没有 Reason） |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| WALLET-ACT-001 | 读取钱包基线 | active org 明确 | 返回余额、pending、交易基线 | read | 刷新一次，仍不一致则检查 org |
| WALLET-ACT-002 | 打开充值并核对订单 | 基线已记录 | 显示正确金额、币种、商户和 org | reversible | 关闭/取消 Checkout |
| WALLET-ACT-003 | 提交获授权的测试充值 | 金额上限和支付环境明确 | 创建/完成唯一 top-up session | financial side effect | 超时后禁止重发，执行 ACT-004 |
| WALLET-ACT-004 | 核验充值终态 | 有 session/time correlation | 返回 status、余额和关联交易事实 | read | pending 时按等待预算继续观察 |
| WALLET-ACT-005 | 刷新验证幂等 | 已观察 completed | 同一交易不重复入账 | read | 发现变化时保存第二份独立证据 |
| WALLET-ACT-006 | 读取 refund/reservation | 有 campaign 或退款上下文 | 返回 pending/credited/reserved 事实 | read | 缺第三方证据时标 Inconclusive |
| WALLET-ACT-007 | Admin 读取组织交易账本 | admin 会话、目标组织明确 | 返回交易列表与各行 STATUS、SOURCE、可用操作 | read | 刷新一次，仍不一致则确认组织 |
| WALLET-ACT-008 | Admin 直接充值（direct credit） | 组织明确、金额上限明确 | 余额增加该金额，新增 SOURCE=Admin 的 COMPLETED top-up | financial side effect | 超时禁止重发，先 ACT-007 只读核验 |
| WALLET-ACT-009 | Admin 冲正一笔 admin top-up | 该笔为 COMPLETED 且 SOURCE=Admin，全额可用 | 余额扣减该金额，原记录转 REVERSED，新增 REVERSAL | financial side effect | 超时记 `action_unknown`，先 ACT-007 只读核验，禁止重发 |

## Facts

| ID | Meaning | Source surface | Shape | Freshness |
|---|---|---|---|---|
| WALLET-FACT-ORG | 钱包归属组织 | UI + identity | `{orgRef, name}` | 每个资金动作前 |
| WALLET-FACT-BALANCE | 钱包金额状态 | UI/API | `{balanceCents, availableBalanceCents, pendingDebitCents, currency}` | 动作前后分别读取 |
| WALLET-FACT-TOPUP | 本次充值 session 状态 | status/UI | `{correlationRef, amountCents, currency, status}` | 直到终态或等待上限 |
| WALLET-FACT-TRANSACTION | 与本次充值关联的账本记录 | transactions | `{type, amountCents, status, createdAt, correlationRef?}` | payment 后读取 |
| WALLET-FACT-REFUND | 退款状态 | wallet/billing | `{amountCents, status, eligibleAt?, campaignRef?}` | campaign 状态变化后 |
| WALLET-FACT-RESERVATION | Campaign 资金占用 | reservations/campaign | `{campaignRef, reservedCents, status}` | launch/cancel 前后 |
| WALLET-FACT-LEDGER-ROW | 账本单行事实 | Admin Transactions tab | `{date, type, source, amountCents, balanceAfterCents, status, allowedActions}` | 资金动作前后分别读取 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| WALLET-001 | cross_surface | Wallet 页面加载 | UI 金额、币种和 active org 与只读钱包事实一致 | UI + API | 页面截图、脱敏钱包事实 | 页面缓存；错误组织；并发交易 |
| WALLET-002 | exact | 输入充值金额 | 金额最多两位小数，wire/accounting 使用整数 cents，币种展示正确 | UI + response | 表单、返回金额/币种 | 本地化展示差异但 cents 正确 |
| WALLET-003 | state_transition | 创建 Checkout | 仅证明 `checkout_created`，不得当作充值完成 | UI + status | Checkout/返回状态 | 无 |
| WALLET-004 | eventual | 支付提交成功 | 对应 session 最终为 completed，存在关联 completed top-up transaction | UI + API | session 状态、交易事实、页面结果 | webhook 尚在合理等待期；错误 session/org |
| WALLET-005 | amount_delta | 无并发资金变化的充值 | available balance 增量等于本次 completed top-up 金额 | 前后事实比较 | before/after、交易金额 | 并发充值/扣款/refund；基线过期 |
| WALLET-006 | negative | 支付完成后刷新/重复查看 | 同一 session/transaction 不重复入账 | UI + transaction history | 刷新前后余额、唯一关联交易 | 不同 session 的合法交易 |
| WALLET-007 | negative | 使用其它组织的 session/entity | 返回不可发现/拒绝，不泄露交易信息 | API/UI | 404/拒绝事实 | 当前用户本来就是目标 org 成员且已切换 |
| WALLET-008 | cross_surface | refund pending | balance、transactions 和 billing refunds 对 pending 金额/状态/eligible time 语义一致 | UI + API | 三表面事实 | settlement worker 尚未到期；历史服务器缺字段 |
| WALLET-009 | visible | refund 列表为空 | 明确区分 pending、processing 和 no refund due / 错误组织 | UI/API | empty state 文案和只读事实 | 旧版本明确保留 legacy flat message |
| WALLET-010 | visible | Admin 查看组织交易账本 | 冲正入口只出现在 `COMPLETED` 且 `SOURCE=Admin` 的 top-up 上；Checkout 来源、非 COMPLETED、已 REVERSED 的行都没有 | UI | 账本行截图含 TYPE/SOURCE/STATUS 与该行操作 | 操作者权限不足导致全部入口隐藏（属 WALLET-014） |
| WALLET-011 | negative | 提交冲正 | 原因为空时拒绝提交；确认按钮展示**全额**，不支持部分金额 | UI | 空原因提交后的弹窗状态、余额与原记录状态未变 | 前端校验与后端校验文案差异，但两者都拒绝 |
| WALLET-012 | state_transition | 冲正成功 | 原 top-up **保留**并转为 `REVERSED`，不被删除 | UI + 账本 | 冲正前后同一行的 STATUS 对比 | 列表默认过滤掉 REVERSED（需切换筛选后确认记录仍在） |
| WALLET-013 | amount_delta | 冲正成功且无并发资金变化 | 新增一条独立 `REVERSAL` 负额记录，可用余额减少额等于原 credit 金额 | 前后事实比较 | before/after 余额、两条记录的金额与 balance 列 | 并发充值/扣款/refund；基线过期 |
| WALLET-014 | negative | 对已 `REVERSED` 的记录再次冲正 | UI 不提供入口；直接调用接口为**幂等回放**：返回 2xx 且 `alreadyReversed: true`、带回原 REVERSAL 的 transactionId；不产生第二条 REVERSAL、不二次扣款、不新增审计 | UI + API | REVERSED 行无操作入口的截图；接口响应 + 回读账本与审计 | 仅确认按钮隐藏而未验证接口——这种情况只能给 Inconclusive；返回 2xx 本身不是缺陷（2026-10-14 裁定，WALLET-S06） |

| WALLET-015 | negative | 两个 operator 几乎同时冲正同一笔 admin top-up | 只产生一条 `REVERSAL`、只扣一次；败方提示「已冲正」类结果即可（与胜方相同的 `top-up reversed` 也可接受）；审计只记录真正生效的那一次 | 双方接口响应 + 账本 + 审计日志 | 两次请求实际先后到达（非并发），按 WALLET-014 判 |
| WALLET-016 | eventual | 冲正请求已到达服务端，但浏览器没收到响应（超时 / 断网） | UI 重新拉取交易状态，显示「结果未知」或「已冲正」，不能只显示原始 `Failed to fetch`；余额与该行状态刷新为服务端真实结果，不继续诱导重复提交 | 服务端回读账本 + UI 余额/行状态/提示 + 本 Case 视频 | 请求在发出前就失败（服务端无记录），此时通用失败提示可接受 |

**断言的可用范围**：`WALLET-015`、`WALLET-016` 及 `WALLET-014` 的接口侧来自 WALLET-S06，同样可以单独支撑 ProductFail。`WALLET-010` 至 `WALLET-014` 来自 WALLET-S05（真实浏览器验收 + 2026-10-13 人工确认），**可以单独支撑 ProductFail**。其余 `WALLET-001`–`WALLET-009` 仍受模块 `status: pilot` 限制，失败时需要 ticket、用户确认或其它当前有效证据才能判 ProductFail。

## 副作用与恢复

Top-up 和 Admin 冲正都是资金副作用。提交后超时、断开或返回不明时记录 `action_unknown`，冻结再次提交，先查 session、余额和 transaction。**冲正自身就是 admin direct credit 的恢复手段**：测试中造的 admin credit 可以用冲正归零，但账本会留下 TOP-UP(REVERSED) + REVERSAL 两条记录，这是设计预期的遗留，不是未清理。交易通常不可删除；报告记录测试金额、组织、时间、关联引用和资金遗留。

Refund、Campaign cancel 或真实支付不为复现自动重做。需要 Stripe/Admin 后台确认时准备好 session/campaign 等可观察引用后请求轻量协作。

## Bug 判断知识

### 高置信 Bug

- completed top-up 金额与唯一余额增量或交易金额不一致。
- 同一支付 session 导致重复入账。
- active org 与资金归属不一致或跨 org 泄露交易。
- UI 显示成功，但最终账本明确失败/缺失且已超过合理异步窗口。

### 风险或待确认

- Checkout 完成但 webhook/账本仍 pending。
- Stripe 与内部 wallet/refund 不一致，但缺第三方后台证据。
- 充值后已消费再全额退款的套利路径，需要 spend/reservation/refund 全链路证据。

### 不能直接判 Bug

- 仅成功打开 Checkout。
- 合理异步窗口内余额尚未更新。
- `topup_timeout` 后未核对最终 session/transaction。
- 并发资金变化时只比较余额差，不关联具体交易。
- 审计日志的 `Admin top-up reversed` 条目只显示金额、不带组织名（对应的 `Wallet credited` 条目带组织名）——**不是 Bug**，现状即预期（WALLET-S06）。
- 并发冲正的败方收到与胜方相同的成功提示、审计里没有败方的尝试——**不是 Bug**，见 WALLET-015（WALLET-S06）。

## 历史风险与回归探针

- Checkout-only 覆盖导致真实入账问题遗漏。
- UI、wallet ledger、reservation 和 Stripe 状态不一致。
- pending refund 被错误显示为无退款，或 credited 后重复展示 projection。
- 已产生广告 spend 后仍允许不受控全额 refund。

## 已知缺口

- 业务文档最后同步时间早于当前日期，真实 ticket 执行前需核对目标版本和近期 version history。
- 尚未通过真实 Browser top-up ticket 验证断言和证据采集方式（指 Stripe Checkout 路径；Admin direct credit 与冲正已于 2026-10-13 验证）。
- ~~WALLET-014 的接口侧拒绝尚未实测~~：2026-10-13 已实测 11 次（返回 200 `alreadyReversed: true`），2026-10-14 裁定幂等回放即为预期，断言已改写。
- Admin 冲正的审计留痕归属：`Admin top-up reversed` 的审计条目不含组织名，而 `Wallet credited` 含。已记为 bug 草稿，未定性，暂不作为断言。

## 模型回流

试跑后补充 Wallet/Checkout 稳定页面锚点、session correlation 方法和合理异步等待预算。测试卡、账户或敏感支付信息不得写入模块。

<!-- 2026-09-20: CLI 已退出 QA 范围，相关 surface、来源和交叉核验手段已删除。只读交叉核验改用 API / Admin Dashboard。 -->
