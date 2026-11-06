# Domain Memory: Payment

## 适用产品线

Hellyeah / FinalRound Web / FinalRound Desktop / Shared-InterviewAI

## 核心风险

- 只覆盖 checkout 页面打开，但未验证金额、币种、状态回写和后续链路。
- payment/subscription 状态与 UI gating 不一致。
- webhook、wallet transaction、refund 或 post-payment 行为遗漏。
- 充值后已消费再申请全额退款的资金套利路径：外部支付、内部 wallet、已发生 spend、reservation、refund eligibility 和风控审核可能不一致。

## 历史 Bug 模式

- checkout-only 覆盖不足导致真实支付链路风险残留。
- 金额校验、状态回写、refund 条件和事件链路容易漏测。
- refund 只验证 Stripe 成功，未同步核对内部账本和已消费金额，可能漏掉“钱退了但服务/广告成本已发生”的损失路径。

## 环境限制（Hellyeah / per-PR sandbox，2026-09-20 用户确认）

- **sandbox 里跳不到 Stripe 付款页，充值链路不可测。**涉及 top-up 的 checklist 项记 `Blocked`，不要想办法绕过。
- wallet 其余功能正常：余额、消费记录、退款展示都能看。
- **sandbox 账号预置了足够余额**，正常不会遇到 funding gap。**遇到 funding gap 本身就是异常信号**（预置失效或产品 Bug），应当作发现上报，而不是设法充值绕过。
- 预算下限 gate（代码默认总预算 ≥ $20、派生日额 ≥ $5）在 staging / sandbox 已被放开，不要按这两个数值判 Bug。

## Hellyeah 退款判据（2026-09-20 用户确认）

判据是 **campaign 有没有激活过**，不是取消入口：

| 情况 | 退款形态 |
|---|---|
| 从没激活过（审核被拒、admin cancel、用户自己 cancel，**含已扣款未激活**） | **即时退款** |
| 激活过之后再 cancel | 可以 cancel，但**走结算窗口**后才退（代码默认 `REFUND_SETTLEMENT_MINUTES = 48×60`，即 48 小时；env 可调） |

`superseded`（广告账户被封后 campaign 重建到替换账户）**不退款**——预算转移给后继 campaign。`eligibleCampaignRefundWhere` 只扫 `cancelled` 和 `completed`，结构上排除了 `superseded`。

⚠️ **UI 上不展示预计到账时间，这是设计，不判 Bug**（2026-09-20 用户确认）。agent 按 48h 预算轮询，超时标 Inconclusive。

## 不能直接判 Bug

- 退款界面不显示预计到账时间 —— 保持现状，产品不打算展示。
- 激活过的 campaign 取消后余额没立刻回来 —— 走 48h 结算窗口是设计。
- `superseded` 状态钱包没有退款入账 —— 预算转移给后继 campaign，不是丢失。
- 失败 / 孤儿 campaign 没有清理入口 —— 重新建一个即可，不是缺口。
- sandbox 里点不开 Stripe 付款页 —— 环境限制，记 Blocked，不是产品问题。

## 必测检查点

- 金额和币种。
- payment/subscription 状态。
- 支付前后 UI/API 状态。
- webhook/event/post-payment 行为。
- refund 或取消后的状态变化：先判断有没有激活过，再按上表断言即时退 / 结算后退。不断言 UI 是否展示到账时间。
- spent 后 refund：Stripe Dashboard、内部 wallet ledger、reservation、ad spend、refund status、重复退款幂等和风控/审核入口必须一致。

## AI 可独立覆盖

- API/CLI 可查询的金额、状态、transaction、配置和报告。
- 已有自动化中的 checkout、subscription、payment API 回归。

## AI+人工轻量协作覆盖

- 用户完成 Stripe 4242 checkout。
- 用户确认 Dashboard、Stripe、PostHog、Inngest 或 webhook 后台事件。
- AI 在用户完成操作后继续验证状态、日志、报告和沉淀。

## 不适合自动化的部分

- 强依赖真实生产支付或敏感资金操作。
- 第三方后台权限受限且无法稳定断言的内容。

## 自动化沉淀建议

- checkout 金额校验。
- subscription 状态与 UI gating 一致性。
- payment 成功后状态回写。
- refund 条件和状态变更。

## 已过期/慎用经验

- 已被产品规则或版本历史推翻的 payment 判断放入本区。
