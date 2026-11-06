# Hellyeah User Dashboard Product Memory

## 定位

本文件是 AI 对 Hellyeah User Dashboard 的长期测试认知，用来提升 Dashboard 提测、回归、风险判断和 Bug 判断能力。

它不替代 Hellyeah `business_file/`，也不复制每个版本流水账。

- `../business_file/`：Hellyeah 完整业务事实来源。
- `version-history.md`：Dashboard 版本时间线、测试结论、历史风险和 Bug 是否过期的证据。
- `product-memory.md`：AI 开测前必须带入的 Dashboard 测试视角产品认知。
- `../product-memory.md`：Hellyeah CLI/API/Admin/managed ads/payment/event 的总产品记忆；Dashboard 涉及这些链路时必须联动读取。

当本文件不确定、与业务文件冲突或与实际行为冲突时，必须回查 `../business_file/`、`../version-history.md`、本目录 `version-history.md` 和当前证据，不能直接把推断写成长期规则。

## 业务文件关联索引

当前 `business_file/` 下尚未看到独立的 `user-dashboard` 文档。Dashboard 测试应先使用本文件导航，再按功能域回查以下业务文件：

| Dashboard 功能域 | 必读业务文件方向 | 测试场景 |
|---|---|---|
| Auth / org switching | `../business_file/shared/authentication/`, `../business_file/api-server/`, `../business_file/overview/` | 登录、组织切换、跨组织隔离、权限 gate |
| Screens / data reads | `../business_file/managed-ads/`, `../business_file/ssot/`, `../business_file/xray/`, `../business_file/api-server/` | 首页、campaign、wallet、tracking、空状态、错误状态 |
| Campaign actions | `../business_file/managed-ads/`, `../business_file/admin-dashboard/`, `../business_file/cli/` | campaign 创建后状态展示、pause/resume/cancel、Admin review 联动 |
| Wallet / billing / top-up | `../business_file/integrations/stripe/`, `../business_file/shared/payments/`, `../business_file/cli/wallet.md` | top-up、余额、reservation、refund、payment 状态 |
| Brand website / onboarding | `../business_file/aima/`, `../business_file/aima/user-flow.md`, `../business_file/learn-engine/`, `../business_file/creative-engine/` | business info、brand research、onboarding gate、AIMA 入口 |
| Observability | `../business_file/observability/`, `../business_file/xray/`, `../business_file/postbacks/` | BetterStack log drain、trace、error tracking、X-Ray/tracking 可见性 |

## 产品边界

Hellyeah User Dashboard 是 Hellyeah 的用户侧 Web Dashboard 产品线，不等同于 CLI，也不等同于 Ops/Admin dashboard。

Dashboard 测试重点是用户可见入口、读写路径、组织隔离、数据展示、空状态、错误状态、支付/钱包、campaign action、tracking/X-Ray、onboarding/AIMA 入口和与 CLI/API/Admin 的数据一致性。

## 当前明确事实

- 2026-06-24 Slack 明确：Customer/User Dashboard SIT 已 ready，入口为 `app-staging.hellyeahai.com`。
- 2026-06-24 Slack 明确：Dashboard SIT 工单包括：
  - HEL-1220：umbrella、smoke + run order。
  - HEL-1221：auth、org switching、cross-org isolation。
  - HEL-1222：screens、data reads、gate / empty states。
  - HEL-1224：write paths，包括 top-up、brand website、campaign actions。
- 2026-06-24 Slack 明确：测试应从 HEL-1220 smoke checks 开始。
- 2026-06-24 Slack 明确：User Dashboard 已 merged and deployed to staging，并设置 BetterStack log drain、traces 和 error tracking。
- 2026-06-24 Slack 明确：User Dashboard v1 目标是 2026-06-26（周五）launch；v2 正在规划更完整体验。

## 核心用户路径

- 用户访问 staging Dashboard 并完成登录。
- 用户在多个 org 间切换，Dashboard 只展示当前 org 的数据，不能泄露其他 org 数据。
- 用户查看核心 screen：dashboard overview、account/profile、campaigns、wallet/billing、tracking/X-Ray 相关模块。
- 用户在空数据、未完成配置、权限不足或 gate 状态下看到清晰可行动的提示。
- 用户执行写路径：top-up、brand website 更新、campaign action 等，Dashboard 与 API/CLI/Admin 状态保持一致。
- 用户从 onboarding / landing / business info / budget 等入口进入 Dashboard，并最终可作为 AIMA launch 的 Web 入口。
- 用户侧 tracking / attribution 后续可能同时存在 X-Ray 和第三方 analytics/postback 来源；Dashboard 需要给 QA 足够诊断线索，不能只展示单一成功态。

## 当前有效测试规则

- Dashboard 提测默认走 AI+人工协作：AI 读工单、拆测试点、跑可自动观察的 Web/API 检查；需要登录态、真实 UI 观察、支付或后台权限时由用户轻量协作。
- Onboarding 的 **Talk to a strategist** 预约入口必须使用 Hellyeah 团队日历 `https://cal.com/team/hellyeah`，在团队配置的 BD 日历间轮转；Cal.com 只承担排期，会议 provider 必须是 Google Meet，确认页/邮件应带 Google Meet 链接，以接入团队现有 Read AI 工作流。只验证“能选时间并预约成功”不足以放行。
- Dashboard 不是只测页面能打开；必须同时验证数据归属、跨组织隔离、空状态、错误状态和写入后的状态回读。
- Dashboard 与 CLI/API/Admin 共享业务状态时，不能只看 Dashboard UI 成功；需要用 CLI/API/Admin 或后台证据交叉验证关键状态。
- 涉及 top-up、wallet、refund、reservation 时，必须联动 Hellyeah payment/wallet 规则，不能只看 checkout 打开。
- 涉及 campaign actions 时，必须联动 Hellyeah campaign/admin-review 规则，区分 created、pendingAdminReview、Admin approve、active、paused、cancelled。
- Stripe Revenue Connect 的 Dashboard canonical 入口是 `/settings?tab=integrations`；连接状态必须用 Dashboard UI + `hellyeah stripe status` / `/api/v1/integrations/stripe/connect` 交叉验证。Embedded payments panel 通过 `/embedded-session` 获取 Stripe AccountSession，前端只应拿到短期 `clientSecret` 和 `stripeAccountId`，不能暴露 merchant OAuth access token。用户侧权限文案应表达为 `Read access` / `Read-only revenue access` 这类产品语义，不应直接展示 raw `read_write`。
- 第三方 analytics/postback 是长期实现方向（2026-07-20 用户确认）。Dashboard 涉及 data source、pixel、postback 或 attribution 诊断时，QA 需要同时检查第三方诊断路径和 X-Ray fallback：data source 绑定/权限、Pixel ID 识别与展示、事件可见性、postback 入队/交付、重复事件处理、归因一致性、失败提示与可恢复动作。
- Slack 中的 v2 规划、体验方向或产品愿景不直接写入长期规则；只有用户确认、业务文件确认或多次测试验证后，才能进入本文件。

## 高频风险区

- Auth / org switching：跨组织数据泄露、active org 与 Dashboard 展示不一致、登出/刷新后 org 状态错乱。
- Data reads：Dashboard 显示 stale data、空状态误导、loading/error/gate 状态缺失。
- Write paths：UI 写入成功但 API/CLI/Admin 未同步，或失败时没有可理解错误。
- Payment / wallet：top-up 金额、余额、reservation、refund、Stripe 状态与 Dashboard 展示不一致。
- Stripe Revenue Connect：merchant Stripe 与 Hellyeah wallet Stripe 是两条独立链路；测试时不能混用证据。重点检查 org isolation、connected/revoked 状态同步、embedded session token 边界、OAuth callback toast、fresh/not-connected empty state、Connect/Disconnect 与 CLI/API 一致性。
- Campaign actions：Dashboard action 与 campaign 状态机不一致，特别是 pendingAdminReview、active、pause/resume/cancel。
- X-Ray / tracking / third-party analytics：tracking 连接、conversion、postback 或 BetterStack trace 只在局部可见，Dashboard 与真实 backend 状态不一致；第三方 data source/pixel/postback 不能只看 UI 显示 connected，需要检查 Pixel ID、事件上报、delivery 和 attribution 分层证据。
- Onboarding / brand website：brand research、business info、budget 输入和 AIMA launch 前置条件不一致。

## Bug 判断能力

### 高置信 Bug

满足以下条件时，优先判为高置信 Bug：

- 当前 Dashboard 工单、业务文件、Hellyeah 总产品记忆或版本历史有明确规则。
- 实际 UI/API/CLI/Admin 证据与预期不一致。
- 已排除环境、账号、权限、组织选择、测试数据和缓存问题。
- 跨组织隔离、支付金额、wallet balance、campaign 状态、tracking 数据等高风险域出现可复现错误。

### 疑似 Bug / 风险

- Dashboard UI 与 CLI/API/Admin 状态不一致，但还缺少后端或后台证据。
- 只在单一账号、单一浏览器或单次刷新后出现。
- 需要用户提供权限、截图、后台事件或支付操作后才能确认。

### 不能直接判 Bug 的情况

- 产品规则仍是 v2 规划或 Slack 讨论，没有工单/业务文件/用户确认。
- 只有视觉喜好或体验建议，未违反明确验收标准。
- 缺少测试账号、权限、组织数据或环境状态不稳定。

## 测试入口和依赖

- Staging Dashboard：`http://app-staging.hellyeahai.com`。
- Linear 工单：HEL-1220、HEL-1221、HEL-1222、HEL-1224。
- Hellyeah CLI/API staging，用于交叉验证 org、wallet、campaign 和 tracking 状态。
- Ops/Admin dashboard，用于审核、状态和后台证据确认。
- Stripe sandbox / 4242 checkout，用于 top-up 和支付链路。
- BetterStack logs、traces、error tracking，用于 Dashboard 观测性证据。
- `QA-Knowledge/domains/campaign.md`、`payment.md`、`admin-review.md`、`webhook-event.md`、`automation.md`。

## AI+人工轻量协作点

- 用户提供 Dashboard 登录态或完成网页登录。
- 用户确认页面视觉、空状态、gate 状态和错误提示是否符合预期。
- 用户执行 Stripe 4242 checkout，AI 继续验证 wallet/API/CLI 状态。
- 用户在 Admin/Ops 或 BetterStack 中确认后台状态、trace 或 error，AI 继续归因和沉淀。
- 用户执行需要真实 UI 权限的 campaign action，AI 继续验证 API/CLI 状态。
- 用户在 GA4、Meta、TikTok、Amplitude 或其他第三方 analytics/postback 后台确认 data source、pixel、event、delivery 后，AI 继续核对 Dashboard、X-Ray、postbacks trace 和 campaign attribution。

## 自动化沉淀方向

- Dashboard smoke：打开 staging、登录态检查、核心导航可达。
- Auth/org switching：多 org 切换、刷新保持、跨 org 数据隔离。
- Screens/data reads：核心 screen、loading、empty、gate、error 状态。
- Write paths：top-up、brand website、campaign action 的 UI/API 双向断言。
- Report：保留视频、截图、trace、console/network 错误，测试结束后再沉淀可复用用例。

## 已过期/慎用规则

- 暂无。后续被业务文件或版本历史推翻的 Dashboard 判断放入本区。
