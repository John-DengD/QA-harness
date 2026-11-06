# Bug Patterns

用于沉淀常见 Bug 识别模式、证据要求和不应误判为 Bug 的场景。

## 条目模板

```md
## <YYYY-MM-DD> <产品线> - <Bug 模式名称>

- **来源**：<工单 / 报告 / 版本>
- **触发条件**：<什么操作或数据会触发>
- **可见现象**：<用户或测试能看到什么>
- **判定标准**：<为什么这是 Bug>
- **证据要求**：<命令输出、接口响应、截图、trace、日志>
- **排除项**：<哪些情况不应判 Bug>
- **回归建议**：<后续如何验证修复>
```

## 2026-08-26 Hellyeah Account Pool - 外部健康状态与内部可分配状态不能分裂

- **来源**：PE-250 / PE-259。
- **触发条件**：广告平台把账户标为 suspended/canceled/closed，但内部 pool status、UI badge 或 available 查询仍保留为可分配状态。
- **可见现象**：不可投放的账户显示 `available`，出现在手动选择或自动分配候选中。
- **判定标准**：外部平台非 `ENABLED` 时内部必须为 `disabled`；状态 badge、查询过滤、waitlist picker 和 assignment endpoint 必须共享同一 eligibility 契约。
- **证据要求**：保存 platform status、内部 DB/API status、Admin badge、available-list 响应、picker 候选和 direct assignment 结果。
- **排除项**：只有在平台已恢复 `ENABLED` 且最新探测成功后，账户才可从 `disabled` 恢复；旧缓存或仅文案差异也必须先核对真实 query eligibility。
- **回归建议**：分别覆盖已分配和未分配的 suspended 账户，确认 sync 后 disabled、保留正确 org 绑定、所有候选列表不可见、直接分配/手动恢复返回 `409`，平台恢复后再验证自愈。

## 2026-08-25 Hellyeah Onboarding - 预约成功不代表会议路由正确

- **来源**：QA-1043 / QA-1062。
- **触发条件**：产品嵌入第三方排期工具，但只验证时段选择和 booking success，未核对团队 routing form、轮转成员和最终会议 provider。
- **可见现象**：用户可以预约成功，但进入错误日历、使用错误的视频服务，或绕过团队既有会议自动化。
- **判定标准**：预约链路必须同时满足 canonical team link、正确成员轮转、预期 meeting provider 和确认通知；其中任一项不符都属于业务路由 Bug。
- **证据要求**：保存预约入口、team/event URL、assigned host、会议 location/provider、确认页和邮件链接；必要时核对团队成员配置。
- **排除项**：测试环境明确使用独立 event type 且产品已书面接受时，不按生产团队路由要求判定。
- **回归建议**：覆盖手动入口与自动 gate，至少连续预约多个可用时段验证轮转，并确认 Google Meet、确认邮件、取消/改期和既有会议自动化。

## 2026-08-19 Hellyeah Onboarding - 动态目录 ID 不能被旧静态枚举拦截

- **来源**：QA-1043 / QA-1047；PR #847。
- **触发条件**：读路径从运行时目录返回 UUID 等新 ID 格式，但写路径仍使用旧的硬编码 slug 枚举校验。
- **可见现象**：页面可以展示并选择实时素材，提交时却对每个所选 ID 返回 `invalid_value`，核心流程无法继续。
- **判定标准**：同一功能的读写契约必须接受同一标识空间；只要 UI 返回的合法 active item 无法被对应写接口接受，就是契约 Bug。
- **证据要求**：保存目录接口返回的 ID、UI 所选项、提交 payload、校验错误 path、静态 schema 与运行时目录 schema，并确认失败发生在业务服务之前。
- **排除项**：真正不存在、已停用、重复或超过选择上限的 ID 应继续被明确拒绝，不属于本模式。
- **回归建议**：至少选择 1 个 runtime-only ID 完成端到端写入；同时覆盖 legacy ID、非法 ID、重复 ID、停用 ID 与数量上限，防止放宽 schema 后丢失有效校验。

## 2026-08-19 Hellyeah Campaign Forecast - 部分定价数据不能静默渲染为有效零花费预测

- **来源**：QA-1014 / QA-1044；品牌 `thetoychestllc.com`。
- **触发条件**：Keyword Planner 返回的 grounded keywords 中只有部分条目带 CPC，前端或聚合层仍把结果当作完整成功预测。
- **可见现象**：预算提高后 likely spend 始终为 `$0`，曲线近似水平，但页面同时展示非零 aggregate CPC；部分关键词只有 volume、没有 CPC。
- **判定标准**：spend、curve、clicks、aggregate CPC 与 per-keyword CPC 属于同一预测契约，不能互相矛盾；不完整定价应明确降级或报错，不能静默显示为有效零花费结果。
- **证据要求**：保存预算 sweep、档期、品牌、曲线、原始警告、aggregate CPC 与关键词 chips；同时记录 provider/接口是否返回 partial、empty 或 error。
- **排除项**：如果所有关键词均明确无可用流量或 provider 返回可解释的零值，并且 UI 如实标明原因，则不属于此模式。
- **回归建议**：用同一 Draft 覆盖多个预算，并对 likely spend、曲线、clicks、aggregate CPC、每个关键词 CPC 做一致性断言；缺失 CPC 的关键词必须显式标记或排除。

## 2026-06-15 Hellyeah Integration - OAuth redirect URI provider allowlist mismatch

- **来源**：HEL-1131；报告 `Hellyeah_1.2.0/result/2026-06-15_18-54_HEL-1131-stripe-oauth-redirect-uri.md`
- **触发条件**：后端成功生成第三方 OAuth authorize URL，但生成的 `redirect_uri` 没有和 provider app settings 中的允许列表精确匹配。
- **可见现象**：CLI/API smoke 看起来通过，用户打开浏览器后 provider 直接显示 invalid redirect URI，无法进入授权 approve 页面，连接记录不会创建。
- **判定标准**：OAuth connect 的可用性不能只看 API 返回 200；provider 页面能接受 `client_id + scope + redirect_uri` 并进入授权页面才算 connect 前置通过。
- **证据要求**：保存 authorize URL 中的 `client_id`、`scope`、`redirect_uri`，provider 原始错误文案，失败后 `stripe status` 仍未连接的证据。
- **排除项**：用户取消 OAuth 或 state 过期属于独立失败模式；本模式特指 provider 在授权前拒绝 redirect URI。
- **回归建议**：修复后重新生成 authorize URL，确认 redirect URI 与当前环境一致，浏览器能进入 Stripe approve 页面；approve 后继续验证 `stripe status` active。

## 2026-06-25 Hellyeah Creative - Status metadata 与真实图片文件不一致

- **来源**：QA-913；报告 `Hellyeah_1.2.0/result/2026-06-25_11-00_QA-913-brand-research-creative-compositor.md`
- **触发条件**：creative image job 返回 complete，API/CLI metadata 报告平台目标尺寸，但下载 R2 图片后真实尺寸或比例不同。
- **可见现象**：status 返回 `1200x1200` 或 `1200x628`，实际 PNG 可能是 `1024x1024` 或 `1536x1024`；landscape 比例不符合 Google RDA preferred `1.91:1`。
- **判定标准**：广告素材验收必须以真实文件为准。metadata 仅用于展示或下游选择时，如果与文件不一致，会导致 QA、launch、平台合规判断和素材映射错误。
- **证据要求**：保存 status JSON、图片 URL、下载文件、`file` 输出、平台 spec 引用和视觉检查结论。
- **排除项**：如果业务明确允许返回“目标尺寸”而非“真实文件尺寸”，需产品/文档确认；未确认前按合规风险处理。
- **回归建议**：修复后对 square、landscape、edit、blend 产物逐一下载核对真实尺寸和比例，并验证 API metadata 与文件一致。

## 2026-06-25 Hellyeah Profile - Research fallback 不能伪造不可达 URL 的成功结果

- **来源**：QA-913；报告 `Hellyeah_1.2.0/result/2026-06-25_11-00_QA-913-brand-research-creative-compositor.md`
- **触发条件**：用户输入不可达、无 DNS 或无法抓取的 profile research URL。
- **可见现象**：CLI/API 返回 success，并给出当前 org、历史 profile、默认品牌或无关站点的 proposal / sources。
- **判定标准**：research 的目标 URL 是用户输入的事实来源。目标不可达时应明确失败或标注无法抓取，不能用无关数据填充 success，否则会污染 profile 并误导后续 creative/campaign。
- **证据要求**：保存输入 URL、CLI/API 输出、proposal businessName/sources、DNS/URL 不可达证据、对照可达 URL 的成功结果。
- **排除项**：用户显式选择“使用当前 profile fallback”且响应明确标注 fallback 时另议；默认静默 fallback 不应通过。
- **回归建议**：修复后覆盖 `.invalid`、DNS 不存在、HTTP 超时、403/robots、无颜色站点和正常站点，确保失败与 fallback 文案可区分。

## 2026-06-15 Hellyeah API - Integration surface 已部署但 runtime DB 查询 500

- **来源**：HEL-1131；报告 `Hellyeah_1.2.0/result/2026-06-15_17-12_HEL-1131-stripe-revenue-connect-retest.md`
- **触发条件**：新集成的 CLI 子命令和 OpenAPI paths 已出现，但 endpoint 第一次读取新 schema/table 时失败。
- **可见现象**：CLI 返回通用 `internal_error`；直接 API 返回 HTTP 500，并可能泄露 SQL 查询、schema、表名、字段和参数。
- **判定标准**：CLI/API surface 存在不等于功能可用；已登录 + active org 下的 status/connect-url smoke 不应 500。若公开响应泄露 SQL 或参数，应同时记录安全/错误处理风险。
- **证据要求**：保存 CLI `--version`、子命令 help、OpenAPI path 查询、`auth whoami` active org、CLI requestId、直接 API HTTP status/headers/requestId 和脱敏后的错误体。
- **排除项**：本机隔离沙箱（非 PR sandbox）的 DNS 或环境变量前缀导致的网络 `internal_error` 不能直接判 Bug，必须非沙箱/授权复测；未认证 401 属于正常鉴权结果。
- **回归建议**：修复后先确认目标 endpoint 对“无连接”返回 404/业务错误或 authorize URL/503 配置错误，不返回 500，且响应体不含 SQL；再进入 OAuth、Checkout、webhook 深链路。

## [已归档 · CLI] 2026-06-12 Hellyeah CLI - JSON 有状态但 human 输出隐藏资金状态

> **2026-09-20 归档**：QA 范围已排除 CLI，`--format human` / `--json` 的区分在 Dashboard 不存在，本条不再作为判定依据。
> 也**不要**把它套到 Dashboard 的退款到账时间上 —— 那是产品明确的设计选择，不判 Bug。
> 保留原文仅供历史追溯。

- **来源**：HEL-1054；报告 `Hellyeah_1.1.0/result/2026-06-12_10-03_HEL-1054-refund-output-clarity.md`
- **触发条件**：CLI 需求要求“用户可见地澄清资金/退款状态”，实现只覆盖 JSON 或 transactions table，遗漏核心 human balance 输出。
- **可见现象**：`campaign cancel --format human` 只提示 48h settlement 和 follow-up command，不显示 refund amount、available balance 或 funds reusable 状态；`wallet balance --json` 返回 `pendingRefundCents` 和 `pendingRefunds[]`，但 `wallet balance --format human` 只显示 available balance。
- **判定标准**：如果需求目标是减少人类用户反复确认余额/退款，human mode 不展示 pending refund 和可复用余额上下文就仍保留原痛点，应判产品 Bug，而不是只按 JSON 契约通过。
- **证据要求**：同一账号同一时间保存 JSON 输出、human 输出、cancel 输出、transactions 输出，证明后端数据存在但 human presentation 缺失。
- **排除项**：如果需求只声明 agent/JSON contract，不要求 human UX，则可降级为契约确认；HEL-1054 明确来自 dogfood 用户困惑，因此不适用。
- **回归建议**：修复后同时跑 `campaign cancel --format human`、`wallet balance --json` 与 `wallet balance --format human`，确认 refund amount、available balance、pending refund 总额、资金不可立即复用说明或 next action 在 human mode 可见。
