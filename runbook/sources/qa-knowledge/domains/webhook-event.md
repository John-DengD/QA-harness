# Domain Memory: Webhook Event

## 适用产品线

Hellyeah / FinalRound Web / FinalRound Desktop / Shared-InterviewAI

## 核心风险

- 主流程通过，但 webhook/event/PostHog/Inngest 未覆盖。
- 后台事件只能用户确认时，被误写成真正未覆盖。
- 把单个可见状态字段当成 webhook 成功处理的唯一 smoke 指标，忽略第三方 delivery、业务落库和下游事件之间的层级差异。
- 第三方 analytics/postback 作为长期实现后，只看 X-Ray 自有链路或 Dashboard connected 状态，漏掉 data source、Pixel ID、事件上报、postback delivery 和归因一致性诊断。
- **只查一端的事件**（2026-09-20 用户确认）：Stripe Connect、payment、approval gate、campaign launch 这类关键转化路径，**server-side 事件和 client-side 事件必须同时查**。UI 成功态不能代替事件完整性，客户端事件到了也不代表服务端落库了，反之亦然。

## 历史 Bug 模式

- event matrix 漏项。
- webhook 或 cron 触发条件未被验证。
- Stripe Dashboard 已显示 connected-platform delivery 成功，但 Hellyeah CLI/API 状态字段如 `lastEventAt` 不更新，导致状态反馈/可观测性与真实 webhook delivery 不一致。
- third-party analytics/postback 场景中，Pixel ID 已能识别但没有进入 diagnostic，导致 QA/用户只能看到“connected/failed”而无法判断具体卡在 data source、event、delivery 还是 attribution。

## 必测检查点

- 关键转化路径的 **server-side 与 client-side 事件同时核对**，两端都要有，且字段一致。
- 关键事件是否发出。
- 事件字段是否正确。
- cron 或 async job 是否触发。
- 失败/重试/重复事件。
- 第三方 provider delivery、内部 handler 状态回写、业务落库、下游 outbox/trace 分层验证，不能用单个字段互相替代。
- 第三方 analytics/postback 诊断路径：data source 绑定和权限、Pixel ID 识别与展示、浏览器/服务端事件可见性、postback 入队与交付、重复事件、归因一致性、X-Ray fallback 或差异说明。

## AI 可独立覆盖

- 可通过 API、日志、CLI 或测试报告查询的事件。
- 可通过 API/CLI/reporting trace 查询的 postback row、delivery status、Pixel ID、event correlation id 或 attribution state。

## AI+人工轻量协作覆盖

- 用户在 PostHog、Inngest、webhook provider 或 Dashboard 确认事件出现与否。
- 用户确认 Stripe Dashboard connected-platform delivery 状态后，AI 继续核对 Hellyeah status、X-Ray conversion、Postbacks trace 和报告归因。
- 用户在 GA4、Meta、TikTok、Amplitude 或其他第三方 analytics/postback 后台确认 data source、pixel、event 或 delivery 后，AI 继续核对 Hellyeah diagnostic、X-Ray fallback、postbacks trace 和 campaign attribution。

## 不适合自动化的部分

- 无稳定 API 或测试权限的第三方后台。

## 自动化沉淀建议

- 关键状态流转事件矩阵。
- webhook payload 字段断言。
- cron trigger smoke。
- Stripe Revenue Connect 分层检查：Stripe Dashboard delivery -> Hellyeah handler/status -> X-Ray `cv_purchase` -> Postbacks delivery row。
- 第三方 analytics/postback 诊断 smoke：data source connected -> Pixel ID detected -> event visible -> postback queued/delivered -> attribution reconciled -> X-Ray fallback/diff reported。

## 已过期/慎用经验

- 已被后续 event schema 或产品规则推翻的判断放入本区。
- `lastEventAt` 不是团队认可的可靠 webhook 成功处理 smoke 指标。仅凭 `lastEventAt: null` 不能判定 Stripe 未投递或 webhook 未成功处理；若 Stripe Dashboard delivery 已成功但 `lastEventAt` 长期不更新，可按 Hellyeah 状态反馈/可观测性或 handler 回写异常建 Bug。
