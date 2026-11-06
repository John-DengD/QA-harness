# Hellyeah User Dashboard 版本演进索引

> Agent 产品记忆：每次接到 User Dashboard 提测单，先读本文件 + `product-memory.md`，再结合 Hellyeah 总 `product-memory.md`、`business_file/` 和相关 QA-Knowledge domains 判断风险。

## 2026-09-24 · PR #1119 / PE-547 CLI header API 定点复测

- **结论**：本轮 #22 定点通过，非整单 QA Pass。PR head 与 Sandbox 均为 `9cfd917`；CLI 相关单测 36/36、typecheck 通过。独立模拟 feedback POST 的四类 positional 输入均未进入 `X-Hellyeah-CLI-Command`，请求体保留原文。当前 Sandbox 的 PE-545 九位密码 API 拒绝也再次通过。
- **范围限制**：未发送真实 feedback 写请求，也未核对服务端日志；PR 其余高风险项沿用前次未覆盖结论。PE-547 已有 Linear 单，本轮未更新外部状态。
- **报告**：`PR-1119/result/2026-09-24_17-26_PR-1119-PE-547-api-retest.md`。

## 2026-09-24 · PR #1119 / PE-530 成员重加自动化回归

- **结论**：当前 PR sandbox `c37e16c` 上，同组织合成 Admin 成员创建→移除→以不同输入密码重加→独立会话用原密码登录→再次移除，Playwright 37.8 秒通过；不代表 PE-530 整单通过或跨组织路径已覆盖。
- **沉淀**：本地 `linear-browser-qa/hy_ui_autotest` 新增完整回归 spec 与安全 page/action；单测 135/135、typecheck、test discovery 通过。仅测试 membership 已清理，底层 sandbox user row 可能残留。
- **证据**：`PR-1119/runs/20260924-member-readd/run-state.md` 与该目录 `evidence/playwright/`；无 commit/push。

## 2026-09-24 · PR #1119 / PE-530 / PE-545 API 专项复测

- **结论**：部分通过，不能整单 QA 放行。当前 PR head 与 Sandbox 均为 `c37e16c`；PE-545 的真实认证 Admin API 以 9 位密码返回 400 和具体 12 位提示，没有创建成员。接口、退款、X-Ray、CLI 等本地合约测试覆盖较广，但 #22 对单词型 feedback 仍会把内容写入 CLI command header；已有英文 Bug 草稿，未在 Linear 建单。
- **风险/遗留**：真实 0128 迁移、跨组织成员乱序 webhook、DNS 指向私网、网站重新绑定后归因、CLI callback 局域网隔离和非 SDK 转化来源仍缺运行时证据。PR 描述的 X-Ray `tracker` 与实际 `sdk` 不一致。QA Gate 失败，不能标 QA Pass。
- **报告**：`PR-1119/result/2026-09-24_12-50_PR-1119-PE-545-api-qa.md`；新增测试及真实 API 脚本位于隔离 checkout `/Users/new/git-projects/hellyeah-pr1119-qa`，未提交。

## 2026-09-23 · PR #1119 / PE-530 安全加固 Browser QA

- **结论**：整单未通过；Admin 成员移除后重加不改写原密码（#4）通过；成员创建 UI 写最少 8 位而服务端要求 12 位，九位值被拒并仅提示 `Invalid request body`。其余 22 个验收框未完整验证。
- **证据与清理**：独立隐私窗口原密码登录成功；合成成员最终从 sandbox Team 移除，27→26，未触发资金/投放；Bug 草稿 `PR-1119/bug-drafts/bug-01-admin-member-password-hint.md` 待审核，未建 Linear。
- **报告**：[本地报告](PR-1119/result/2026-09-23_23-34_PR-1119-browser-qa.md)；[workspace artifact](https://hellyeah.artifact.cafe/a/pr-1119-security-browser-qa-387amm)。

## 2026-09-21 · Release 20260917 UI 回归（e2b Desktop）

- **关联改动**：PR #1091、#1069、#1104、#1107；环境 staging + e2b desktop `iy7s2s6067kahwscmpmqd`。
- **结论**：部分通过。Studio Confirm Brief 门控与 Launch Editor 主路径通过；登录按用户要求跳过。
- **明确事实**：staging Studio 创建页文案为 `New Creative Sets` / `Confirm Brief` / 禁用的 `Generate`；固定账号 `POST /campaigns/drafts` 为 `E_NO_AD_ACCOUNT`，composer 可打开 editor。
- **风险点与遗留**：未覆盖真实出图、copy regenerate Apply、Meta BYO #1117、Stripe、$50 Launch / Admin approve。
- **报告**：`Release-20260917/result/2026-09-21_19-47_release-ui-regression.md`。

## 2026-09-21 · PR #1110 / QA-1129 · Studio uploaded Creative Sets

- Sandbox `dcf0398`：上传/裁剪/生成/持久化/Google+Meta Campaign 选用与 MP4 preview-only 主路径通过，未发现阻塞 Bug。
- 部分通过：failure injection、16:9 replacement、rotated JPEG、透明像素对照及跨组织隔离未完整覆盖。
- 报告：`Hellyeah/User-Dashboard-test/1110/result/2026-09-21_13-47_1110.md`。

## Local UI E2E decoupled Campaign validation — 2026-09-07

- **结论**：5 个独立 Case 全部通过，总耗时 8.3 分钟；Campaign Case 约 1.1 分钟且不再执行 Onboarding。
- **Campaign 改进**：通过现有 `/campaigns/drafts` 创建本次独立 Search 草稿，使用固定账号 Studio 已有素材；Launch 前失败只 discard 本次 draft，成功后只 cancel 本次 Campaign。
- **数据库事实**：个人 Neon branch `br-flat-hat-akty47qd` 的 `0095` ledger 与物理 schema 不一致；执行仓库原始 `0095_drop_campaign_trunk_columns.sql` 后 draft/launch 恢复。Staging 仍需 fresh branch 验证完整迁移。
- **报告改进**：Vercel 正式域名直接部署 Playwright 原生报告；GitHub run 保存每次不可变 Deployment URL 用于历史追溯。
- **报告**：`Local-E2E-20260907/result/2026-09-07_19-05_UI自动化独立Case回归.md`。

## Local UI E2E independent-case validation — 2026-09-07

- **结论**：5 个独立 Case 中 4 个通过、1 个失败；Registration、Login、Onboarding、Wallet 通过，Campaign Launch 失败。Case 隔离有效，单项失败不阻止其余测试。
- **明确测试事实**：Onboarding 完整运行约 5 分钟；reference manifest 返回 5027 条素材；Wallet `$50` top-up 的 UI、webhook、余额增量和 `topup_credit` 流水一致。
- **失败事实**：Campaign launch validate 为 200/launchable，但真实 launch 返回 500，发生在 funding campaign 数据库写入。个人 Neon branch 存在 migration ledger 与物理 schema 不一致，不能将该失败直接判为 staging 产品回归。
- **自动化改进**：拆成 5 个 Case；增加 API/UI 冲突矩阵、短期 JWT、组织 header、Stripe Link/Card 分支、失败 trace、Stage 分类和在线报告 Case tags。
- **报告**：`Local-E2E-20260907/result/2026-09-07_17-35_UI自动化本地运行.md`。

## PE-159 Campaign Agent forecast and output consistency Bug — 2026-08-28

- **结论**：PE-159 新增 High priority Bug [PE-277](https://linear.app/hellyeah-ai/issue/PE-277/campaign-agent-的预算预测campaign-描述与价格曲线未保持一致)，Backlog。
- **明确 Bug 事实**：改变地域会触发 Search 关键词重新 grounding，但预计花费与价格曲线没有随新的地域和关键词组合一致刷新；Campaign 描述质量也不稳定，部分结果过于简单并呈现 AI 拼接痕迹。
- **对齐要求**：需要与 Wilson 现有的关键词策略和预算预测契约对齐，保证 Agent、Dashboard 和 forecast model 使用同一套输入与展示口径。
- **回归范围**：联合验证 locations、objective、landing page、language 对 keywords、CPC、click estimate、likely spend、pricing curve 和 campaign description 的影响；重开草稿后仍需保持一致。
- **本地草稿**：`PE-159/result/Bug - Campaign Agent 预算预测与生成内容不一致.md`。

## QA-1043 strategist booking routing/provider Bug — 2026-08-25

- **结论**：QA-1043 新增 High priority Bug [QA-1062](https://linear.app/hellyeah-ai/issue/QA-1062/onboarding-strategist-booking-uses-the-wrong-scheduling-flow-and-video)，Backlog，分配给 Bharath。
- **明确 Bug 事实**：Onboarding strategist booking 当前使用错误的排期流程和 Cal.com Video；团队要求使用 `https://cal.com/team/hellyeah` 的轮转 BD 日历，并由 Google Meet 承载会议，以保留现有 Read AI 工作流。
- **回归范围**：手动入口与高预算自动入口、BD 轮转、assigned host、Google Meet provider、确认页/邮件链接、Skip/Back 与 embed failure fallback。
- **草稿与证据**：`QA-1043/result/Bug - Onboarding strategist booking uses the wrong scheduling flow and video provider.md`；截图 `QA-1043/evidence/2026-08-25_hellyeah-cal-team-members.png`。

## Release 20260820 and activation flow completion — 2026-08-20 ~ 2026-08-21

- **明确版本事实**：Hellyeah Release `20260820` 已发布，包含 Dashboard 移动端支持、Campaign Launch 内置 Studio creative generation、Creative Set 稳定性和 Dashboard 体验改进。
- **Activation 更新**：团队确认 signup-to-campaign 重建流程、后台 draft campaign 创建、campaign detail handoff 和端到端 PostHog funnel instrumentation 已完成。
- **测试影响**：后续 QA Process 应把随 `20260820` 发布的项目纳入已发布排除基线；QA-1043 仍需按其子 Bug 状态继续验证 draft-only、恢复、跨组织、creative、funnel 和 strategist booking。
- **来源**：HY Slack `1787234665.646119`、`1787307657.247919`；详见 `QA-Knowledge/daily-radar/2026-08-25.md`。

## QA-1043 live reference ID validation blocker — 2026-08-19

- **结论**：QA-1043 正在测试，新增 High priority Bug [QA-1047](https://linear.app/hellyeah-ai/issue/QA-1047/live-creative-references-are-rejected-by-onboarding-confirmation)，当前由研发阻塞。
- **明确 Bug 事实**：Onboarding 实时目录展示 446 个素材并提交 UUID，但 `/onboarding/confirm` 仍只接受 35 个旧素材 slug；点击 `Generate My Ads` 后 3 个 `referenceIds` 均被 `invalid_value` 拒绝，无法进入生成阶段。
- **根因**：Dashboard 使用运行时 catalog 的 `reference.id`；共享请求 schema 仍使用静态 `z.enum(CREATIVE_REFERENCE_IDS)`，请求在下游运行时目录解析前即失败。
- **回归范围**：修复后至少选择 1 个 runtime-only UUID 素材，验证 confirm 接受最多 3 个唯一 ID、生成对应 landscape/square Creative Sets，并补测非法 UUID、重复 ID 和超过 3 个 ID 的拒绝路径。
- **草稿与证据**：`QA-1043/result/Bug - Live creative references are rejected by onboarding confirmation.md`。

## Dashboard and Campaign consolidation approved — 2026-08-19

- **明确版本事实**：PE-183 的 Dashboard 与 Campaign 页面整合方案已评审通过并合并，目标是取消独立历史 Campaign 页面，将内容统一到一个入口。
- **测试影响**：提测时覆盖旧 Overview/Campaign 入口、历史 campaign、深链、返回导航和空状态，确认没有死链或信息丢失。
- **来源**：HY Slack thread `1787034259.839249`；详见 `QA-Knowledge/daily-radar/2026-08-19.md`。

## QA-1014 budget forecast consistency Bug — 2026-08-19

- **结论**：QA-1014 继续测试中，但新增高优先级 Bug [QA-1044](https://linear.app/hellyeah-ai/issue/QA-1044/budget-forecast-stays-at-dollar0-spend-and-omits-cpc-values-for)，当前由研发阻塞。
- **明确 Bug 事实**：`thetoychestllc.com` 的 Search campaign 在多个预算下始终显示 `$0` likely spend，同时部分 grounded keyword 只有 volume、没有 CPC，预算曲线、聚合 CPC 与关键词定价信息互相矛盾。
- **测试影响**：修复后需用 7 天档期覆盖 `$50`、`$100`、`$265`、`$400`，联合校验 likely spend、曲线、clicks、aggregate CPC 和每个关键词 CPC；之后继续 QA-1018。
- **草稿与证据**：`QA-1014/result/Bug - Budget forecast stays at zero spend and omits keyword CPC.md`。

## PE-89 / PR #789 Dashboard mobile release validation — 2026-08-14

- **结论**：QA Passed。用户确认 PE-89 已完成，关联 PR #789 已 merged；在当前 QA Process 中归“已测试、尚未发布”。
- **范围**：Dashboard 移动端响应式发布验证；后续正式 Release Summary 应保留该 PR，直到进入已发布基线。
- **状态来源**：用户于 2026-08-14 的明确完成口径；QA Process 本地数据截止 18:31 CST。

## Creative reference staging 503 configuration recovery — 2026-08-14

- **明确 Bug 事实**：staging creative reference 请求返回 503；Slack thread 定位为缺少必需的 staging 环境凭据，补齐环境变量后团队确认恢复。
- **来源**：[HY Slack thread](https://hellyeah-ai.slack.com/archives/C0A17S1531Q/p1786695100752589)，记录于 `QA-Knowledge/daily-radar/2026-08-14.md`。
- **测试影响**：复测 reference catalog 200、Studio 素材加载和组织隔离；凭据轮换后再次验证。排查 thread 中出现过敏感凭据值，本文件不保存任何值，轮换/撤销与审计作为 pending-review 风险跟踪。

## Creative Studio QA signals — 2026-08-11 ~ 2026-08-12

- **来源**：HY Slack channel `C0A17S1531Q`，threads `1786433256.271679`、`1786465713.729099`；记录于 `QA-Knowledge/daily-radar/2026-08-12.md`。
- **明确 Bug 事实**：新 onboarding 中切换 Search / Performance Max 会清除已导入 Creative Set，并显示 `Cleared the creative — import one for the new type`；已创建 [QA-1011](https://linear.app/hellyeah-ai/issue/QA-1011/performance-max-selection-clears-imported-creatives-in-staging)，父单 QA-1010，分配给 Josh。
- **产品方向**：Creative Studio typography 应来自 brand research；当前文字效果被认为过于粗糙，已创建 PE-42 进入 triage。
- **测试影响**：QA-1010 回归需覆盖 campaign type 切换后 compatible creative 的保留/自动选择、library empty 时提示、非空时不误清理，以及品牌字体在生成素材中的一致性。

## Ad-hoc onboarding brand research bug draft — 2026-08-04

- **来源**：用户手动反馈；记录于 `QA-Knowledge/daily-radar/2026-08-04.md`。
- **Bug 草稿**：`Ad-hoc-Onboarding/result/Bug Draft - Onboarding cannot initialize brand information for fedex.com.md`。
- **发现的问题**：
  - Onboarding 输入公司网站 `fedex.com` 时，搜索不到 brand 信息，导致 brand profile 无法初始化，用户无法继续 onboarding。
- **风险点**：
  - Brand website / brand research 初始化是 onboarding 核心路径；对高知名度有效域名失败且无 fallback，会阻塞新用户进入 dashboard / launch 流程。
  - 后续验证需补充截图、API/console trace、具体环境与频率，并检查无结果时是否有 retry/manual entry/fallback。

## Dashboard full ad lifecycle production release — 2026-07-30

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1785403485.802649`；记录于 Slack Daily Radar `QA-Knowledge/daily-radar/2026-08-03.md`。
- **明确版本事实**：
  - Hellyeah release 已 live on production。
  - 团队说明用户现在可以在 dashboard 中完成 onboard、launch、track 的完整广告生命周期，不再必须触 CLI。
- **测试影响**：
  - User Dashboard 测试判断需更新：不能再默认认为 dashboard v1 只覆盖查看/管理，需要确认 launch/track 是否为正式用户路径。
  - 后续回归应覆盖 dashboard onboarding、campaign launch、tracking/performance 展示，并用 CLI/API/Admin 交叉验证真实状态。
  - 与早期 Dashboard v1 只读/管理入口记忆冲突时，以本条作为新版本事实，但具体业务细节仍需回查提测单或当前实现。

## QA-942 Stripe embedded panel appearance warning regression — 2026-07-14

- **关联工单**：QA-942 `Stripe embedded payments panel logs invalid appearance color warnings`（父单 QA-933）。
- **本版本改动/优化点**：
  - 回归 Settings -> Integrations -> Stripe Revenue Connect 的 embedded payments panel console warning。
- **测试结论**：通过。Staging Customer Dashboard 在 `FinalRound` org 下展示 Stripe connected card 与 embedded payments iframe；按 Stripe/appearance/color 关键字过滤 console warn/error 为空，QA-942 未复现。
- **风险点与遗留**：
  - 页面仍有 Clerk staging development key warning，属 staging 环境提示，与 QA-942 无关。
  - 本轮未覆盖 production。
- **报告**：`Hellyeah/User-Dashboard-test/QA-942/result/2026-07-14_16-06_QA-942-regression.md`

## Stripe Revenue Connect / QA-933 closure — 2026-07-09

- **来源**：Linear QA-933，Customer Dashboard — Settings → Integrations，PR #582。
- **环境**：staging `https://app-staging.hellyeahai.com/settings?tab=integrations`；API `https://api-staging.hellyeahai.com`。
- **本版本改动/优化点**：
  - Customer Dashboard 新增 Stripe Revenue Connect UI：connected card、Connect/Disconnect、embedded Stripe payments panel、OAuth callback toast。
  - Dashboard 通过 `/api/v1/integrations/stripe/connect` 与 `/embedded-session` 读取连接状态并渲染 Stripe Connect embedded component。
- **测试结论**：
  - QA-933 核心链路通过，无 Sev-1 / Sev-2 阻塞问题。
  - Dashboard connected card、embedded payments panel、CLI/API 状态一致性、embedded session token 边界、cross-org API 隔离、OAuth connected/cancelled toast、disconnect revoked 同步均已覆盖。
  - Fresh org / not connected empty state、完整 OAuth approve flow、confirm disconnect revoked 状态由用户人工验证通过。
- **发现的问题**：
  - QA-938：Recent Activity filter 文案需要调整。
  - QA-941：Connected card 应展示用户友好的读权限说明，不应暴露 raw `read_write`。
  - QA-942：Stripe embedded panel appearance color value 格式 warning。
- **风险点与遗留**：
  - QA-933 中 `/settings/integrations` redirect output contract 与当前实际入口 `/settings?tab=integrations` 不一致；用户确认按工单描述问题处理，不建产品 bug。
  - staging 覆盖 Stripe test mode，不代表生产真实 Stripe / Google Ads 投放验证。
- **报告**：`Hellyeah/User-Dashboard-test/QA-933/result/2026-07-09_16-50_stripe-revenue-connect.md`。

## Notifications preferences / merged PR QA entry — 2026-07-01

- **来源**：HY Slack channel `C0A17S1531Q`，mid-week summary thread `1782898956.174859`，reply `1782900439.660289`。
- **明确事实**：
  - Creative QA 已 finalized。
  - Notifications big PR 已 merged。
  - 仍需一个小改动：preferences 应展示在 customer-facing dashboard，并从 ops dashboard 移除。
  - Notifications QA testing 开始。
- **测试影响**：
  - User Dashboard 测试需要覆盖 notification preferences 在 customer-facing dashboard 的入口、展示、默认值、保存/回读、权限与 org isolation。
  - Ops dashboard 应确认相关 preferences 入口已移除，避免同一设置在两个后台产生冲突。
  - 当前只记录 merged / QA entry，不等同于 QA passed。
- **报告**：Slack Daily Radar `QA-Knowledge/daily-radar/2026-07-02.md`。

## User Dashboard v1 / Release 20260630 + QA closure — 2026-06-30

- **来源**：HY Slack channel `C0A17S1531Q`，release 消息 `1782811927.666379`；QA update `1782793047.959989`。
- **环境**：production `https://app.hellyeahai.com`；staging QA update 已完成。
- **关联工单**：
  - HEL-1220：umbrella / smoke + run order。
  - HEL-1221：auth、org switching、cross-org isolation。
  - HEL-1222：screens、data reads、gate / empty states。
  - HEL-1224：write paths，包括 top-up、brand website、campaign actions。
- **本版本改动/优化点**：
  - Customer Dashboard v1 发布，提供 campaigns、spend、website analytics（traffic、sessions、events）的 Web view。
  - PMax ad previews 可展示 creative images 和 brand logo。
  - Platform 侧包含 dashboard OTel tracing + Better Stack error tracking，以及 `@hellyeah/ui` components library。
  - 重要边界：onboarding 与 Campaign Launch flow 仍需通过 CLI，不属于 Dashboard v1 Web launch 能力。
- **测试结论 / 已修复事实**：
  - User Dashboard v1（HEL-1220 + 1221/1222/1224）staging QA done。
  - 本轮 filed 8 bugs；6 个 fixed（1257/1259/1261/1262/1263/1267）。
  - 2 个 closed as expected：1264 invite-consent、1265 multi-acct logout。
- **风险点与遗留**：
  - Dashboard v1 是查看/管理入口，不是完整 onboarding/launch 入口；测试报告需要区分 Dashboard 展示/动作和 CLI launch。
  - Dashboard 展示 campaign spend 时应按业务语义确认：用户可见 spend 应为 launch 之后真实已花费金额，不应等同于 launch 时 wallet reservation/debit。
  - Dashboard 与 CLI/API/Admin 共享状态；campaign action、wallet/top-up、ad preview 和 analytics 仍需跨系统验证。
- **报告**：Slack Daily Radar `QA-Knowledge/daily-radar/2026-07-01.md`。

## User Dashboard v1 / SIT ready — 2026-06-24

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1782234883.856899`；mid-week summary thread `1782271223.687079`。
- **环境**：staging `http://app-staging.hellyeahai.com`。
- **关联工单**：
  - HEL-1220：umbrella、smoke + run order。
  - HEL-1221：auth、org switching、cross-org isolation。
  - HEL-1222：screens、data reads、gate / empty states。
  - HEL-1224：write paths，包括 top-up、brand website、campaign actions。
- **本版本改动/优化点**：
  - Customer/User Dashboard SIT 已 ready。
  - User Dashboard 已 merged and deployed to staging。
  - 已设置 BetterStack log drain、traces 和 error tracking。
  - QA 初始覆盖已开始；要求从 HEL-1220 smoke checks 开始。
  - User Dashboard v1 计划 2026-06-26（周五）launch；v2 正在规划更完整体验。
- **测试结论**：尚未执行正式 QA；当前仅记录 Slack 明确版本事实和测试入口。
- **风险点与遗留**：
  - Dashboard 是用户侧 Web 入口，不应只按页面可打开判断；首轮必须覆盖 auth/org isolation、data reads/gate/empty states、write paths、wallet/top-up、campaign actions 和 observability。
  - Dashboard 与 CLI/API/Admin 共享状态；关键操作需要交叉验证，防止 UI 与真实业务状态不一致。
  - 涉及 top-up、campaign action、tracking/X-Ray 时，需要联动 Hellyeah 总产品记忆和 QA-Knowledge domains。
- **报告**：待测试后补充。
# PR-1117 / QA-1130 · 2026-09-22

- Feature：Meta BYO App Install、IAP、Website Purchase campaign creation。
- 结论：2 Pass、2 Blocked；Website Purchase 与 inaccessible App readiness 通过，eligible App/IAP 被 Meta App eligibility 前置阻塞。
- Product Bug：0；报告：https://hellyeah.artifact.cafe/a/pr-1117-meta-byo-qa-fg1kpt（workspace members only）。

## PR-1105 / QA-1133 · 2026-09-22
- Feature：Meta Instant Form Leads；新建 E2B 真实 UI 执行，10 功能 case 通过、2 失败、5 组外部依赖阻塞；全链路未签核。
- 问题：401 恢复产生可提交的默认 $100 Traffic；Admin 缺 Page 仍预检 LAUNCHABLE。两份英文草稿待审核，未建 Linear。
- 收尾：$50 预留全额退款、未创建 Meta 资源，Clerk 会话撤销、新建 E2B 已销毁。
- 报告：https://hellyeah.artifact.cafe/a/pr-1105-instant-form-qa-bs38y1；本地 PR-1105/result/2026-09-22_PR-1105.md。
# PR-1117 / QA-1130 revision f1d1246f · 2026-09-22

- 重测结论：不通过；Website Purchase 与 missing-App readiness 通过，App Install/IAP 因未选择 App To Advertise/Store Listing 阻塞。
- Product Bug：0；必要 Case 通过率 2/4；报告：https://hellyeah.artifact.cafe/a/pr-1117-meta-byo-qa-fg1kpt。

## PR-1132 / QA-1134 · 2026-09-22
- Feature：Studio Key message、generation-run 分组、Search 三组导入；SHA 32a9717f。
- 结论：不通过；6 个功能 case，5 Pass、1 ProductFail；Search 已有 1 组时静默截取 3-set run 的前 2 组，独立复现。
- 遗留：5 个完成 set 留在 PR sandbox；未投放/扣款，旧 Search 草稿未改，Clerk 会话已撤销、新 E2B 已销毁。
- 报告 v2：https://hellyeah.artifact.cafe/a/pr-1132-studio-grouping-qa-7gtxrt；Bug 草稿在 PR-1132/bug-drafts，未建 Linear。

## PR-1132 / QA-1134 Case 6 复测 · 2026-09-23
- 同一部署 SHA 32a9717f 下，旧 1 + 新 run 3 一次点击仍是旧 1 + 新 2；空池点击同一 run 则是新 3，确认用户与原报告观察分别对应不同前置。
- 结论：原 P2 ProductFail 范围不变；原 Search 草稿与钱包未改，未提交 Campaign，Clerk 会话已撤销，新 E2B 已销毁。
- 报告：https://hellyeah.artifact.cafe/a/pr-1132-search-run-retest-0zc7hb；原 Bug 草稿仍待审核，未建 Linear。

## PR-1117 / QA-1130 · 2026-09-23
- 部署 c419449；独立 E2B 登录 Andy，仅看见 Final Round AI，无 fr-test；旧 Google 草稿只读未改。
- 结论：不通过；7 个必要 Case 均阻塞，其中 1 个只读前置 Case 有视频；Clerk 隔离账号创建 403，scope 已清理。
- Product Bug：0；报告：https://hellyeah.artifact.cafe/a/pr-1117-meta-byo-qa-retest-99l7ai；会话登出、E2B 已终止。

## PR-1117 / QA-1130 组织入口复核 · 2026-09-24
- 用户确认左上角组织下拉框是切换入口；新 E2B 再查只列 Final Round AI，Clerk 只读成员关系却包含 fr-test。
- 修正原“账号可能不是成员”的推断；当前缺口在 Clerk → PR 环境 `/me` → Dashboard 菜单之间，未定性产品 Bug。用户要求停止测试，已退出会话并销毁 E2B。
- 报告同一链接更新为 v2：https://hellyeah.artifact.cafe/a/pr-1117-meta-byo-qa-retest-99l7ai。
## PR-1160 / QA-1136 · 2026-09-25
- Feature：投放审核太平洋时区日期顺延与 Meta 仅改日期；PR Sandbox SHA 7685e77。
- 结论：不通过；旧 SHA Google 原样批准 Sep 24→Sep 25 且 v2/History 正确，Setup Preview 时间轴仍显示 Sep 24/8 天；Meta UI 因 E2B 回收/重建失败阻塞。PR/Sandbox 后续刷新至 d1f9a6f，新提交相关测试 24/24，UI 待复测。
- 遗留：Sandbox 受控 Google 申请 Setup Pending、$100 预留待清理；Meta 草稿提交状态待只读查重。Bug 为本地草稿，未建 Linear。
- 报告：https://hellyeah.artifact.cafe/a/pr-1160-campaign-review-qa-gn0jit；本地 PR-1160/result/2026-09-25_10-31_PR-1160.md。

## PR-1105 / QA-1133 staging 补测 · 2026-09-29
- Feature：Dealinfo/Jone Meta Instant Form Leads；Dashboard/Admin 部署 SHA a4f4b10。
- 结论：不通过；7 Case，4 Pass、2 ProductFail、1 Blocked。Admin leadgen webhook DENIED 仍批准；Setup Pending 取消失败，受控申请 $50 仍预留待人工恢复。Bug 草稿 2 份，未建单。
- 原报告 https://hellyeah.artifact.cafe/a/pr-1105-instant-form-qa-bs38y1 经 workspace/slug 核对已不存在；新 workspace 报告：https://hellyeah.artifact.cafe/a/pr-1105-dealinfo-jone-staging-qa-xsj7ae。
- Admin/客户测试标签均登出并返回登录页，E2B 已终止；session ID 未捕获，服务端撤销无独立读回。
- 后续按用户要求补沉淀：Meta Leads/Page/表单/Admin 审核/取消的参数化 Playwright 原子 action 写入本地 skill 源码；模拟浏览器验证单次提交/批准/取消，未对现存受控申请重放有副作用动作。

## PR-1168 / PE-600 Preview QA · 2026-09-29
- Studio Confirm 预填/空值/超限/确认后重新编辑通过；375px 超限提示被 Confirm 按钮遮挡（P2，本地 Bug 草稿）。
- 并发生成与 pending/final set 未执行：PR 没有隔离 product sandbox，Vercel Preview 的后端隔离未证明；无生成任务或业务遗留。
- SHA a7f9fdf；已登出测试会话并终止 E2B；报告：https://hellyeah.artifact.cafe/a/pr-1168-pe-600-creative-studio-preview-q-96jzu8。
- 随后补齐 Confirm 文案的四个 Playwright 原子 action，源码与已安装运行时同步；模拟浏览器验证通过，未在非隔离 Preview 重放生成流程。
## PR-1181 / PE-599 Chatwoot Support 入口 · 2026-09-29
- Feature：官网页脚与 Dashboard 账户菜单的 Support 入口；工单指定 Vercel preview 对应 PR head c97b8a5，无独立 preview-sandbox。
- 结论：限定 UI 入口范围通过，2 Case Pass；无 Chatwoot 消息或新对话，联系人/HMAC 非本单范围。
- 两次新建测试会话已精确撤销并复核 revoked；完整 Case 视频 2 条均可在 workspace 报告播放。
- 报告 v2：https://hellyeah.artifact.cafe/a/pr-1181-chatwoot-support-qa-v6r9gd；本地 PR-1181/result/2026-09-29_16-09_PR-1181.md。新 E2B 测试机已终止。

## PR-1185 / PE-606 · 2026-09-29 执行 / 2026-09-30 交付
- Meta availability flag；SHA 820ca046；6 Pass、4 Blocked，PR 6 图中 4 图验证、2 图等待 Yulong flip，尚未签核；planner 503 阻断 Generate，缺 active/paused Meta 样本。
- Sets/Images/Plans/Launch 409 且无观察到的 jobs/quota/wallet 变更；无产品 Bug；E2B 回收后 host Playwright 独立视频、会话已收尾。
- 13 个旧 Action + 9 个新增 Action 实际调用并同步本地 skill；完整清单 PR-1185/run-state/action-usage.md。
- 报告 v2：https://hellyeah.artifact.cafe/a/pr-1185-meta-availability-qa-hseqk9，workspace members only。

## PR-1168 / PE-600 隔离 Sandbox 复测 · 2026-09-30
- SHA dbce505f；Case 1 Confirm Pass，Case 2 375px 提示重叠 P2 仍在，Case 3 双 pending 与干净新建已见、最终 set/job 未获可核实终态，Inconclusive；整体不通过。
- 复用了 9 个既有 Studio/Reference Action；新 `beginStudioSetGeneration`、`returnToStudioLibrary`、`observeStudioLibraryRuns` 均在 PR UI 调用，并以聚焦单测与已安装 skill 同步。全量 unit 目录 151/151 通过。
- E2B 已终止，会话由 fixture 撤销；无本轮持久化 set/job、投放或资金操作。原 P2 草稿追加新证据，不新建 Linear Bug。
- 原报告 URL 原地更新为 v4：https://hellyeah.artifact.cafe/a/pr-1168-pe-600-creative-studio-preview-q-96jzu8；线上正文与三段独立 Case 视频已验证。
- QA 跟进：用户确认 Case 3 另见 `API request failed` 且刷新后进度消失，作为根因待查的 PE-610 子 Bug；Case 2 的旧 P2 建为 PE-609。两个 Bug 均挂 PE-600，英文草稿与编号已存 PR-1168/result/；本地报告补记，原 Artifact v4 保持原始测试时点。

## GOAL-staging-action-hit · 2026-10-09
- Staging 全量范围 12 个去重 Case：8 个实际 UI 执行，2 Pass、5 Inconclusive、1 Automation failure、4 Blocked；整体不通过（未闭环），无已确认产品 Bug。
- 23 个有逐意图记录的样本中 Action hit 21、drift miss 2（91.3%）；C5 旧 Case 不计入分母，检索耗时未单独测量。
- 单次 Launch → Cancel 后 Campaign cancelled、未激活，$50 已退款且余额恢复；S3 生成终态、S2 上传和 C2 Draft 身份待只读关联。
- 报告：https://hellyeah.artifact.cafe/a/staging-action-ity5nw；本轮无 Linear Bug 草稿或建单。

## GOAL-action-reuse-iterations · 2026-10-09
- 两批独立 E2B、四条不同只读 Case：首批 2/4 Action 命中，修复两个 Settings 缺口后在新功能点验证 4/4；总计 6/8，不能与前轮不同域分母合并。
- V1 首跑因断言漂移失败，诊断后 UI 与新鲜偏好响应一致；V2 仅面板可见，连接状态未证实。整任务速度改善尚无因果证据。
- `openDashboardSettings`、`selectSettingsTab` 已在本地维护源码与当前安装 skill 验证；新建 E2B 默认私有 CDP，测试会话按 fixture 撤销，测试机终止，无产品写副作用。
- 报告：https://hellyeah.artifact.cafe/a/staging-action-0r03h2；本轮 `GOAL-action-reuse-iterations-20261009-2030/result/2026-10-09_20-52_GOAL-action-reuse-iterations.md`；无已确认产品 Bug。

## GOAL-release-20261010-regression · 2026-10-10
- Release Train v183 的 10.10 范围为 21 Feature/39 PR；指定账号 staging 计划 11 Case，8 个有 UI 视频、5 个有限 Pass、2 Inconclusive、4 Blocked，整体不通过、无已确认产品 Bug。
- R02 单次 Agent Search 提交后 Drafting 终态未知，禁止重发；R11 更早时间窗确认无新交易/预留，Lead Form/PMax 缺本轮自有 Draft，Shopify 固定组织为手动渠道。
- 测试跨 GitHub staging Dashboard 新部署记录，`app-staging` 别名 SHA 未单独确认；早晚证据分开。独立视频已冻结，E2B 测试机已终止，Playwright fixture 会话按 Case 收尾。
- 报告 v2：https://hellyeah.artifact.cafe/a/10-10-release-staging-qa-xv4t3v；本地 `GOAL-release-20261010-regression/result/2026-10-10_12-45_GOAL-release-regression.md`；未创建 Linear Bug。

## GOAL-release-20261010-regression 官网与前置补测 · 2026-10-10
- 用户确认官网测试部署属本轮 staging 范围；对精确提交 6de0f1a 的测试部署补测 ROAS、活动详情、首页/Blog/Sitemap，三个独立 Case 有视频且有限 Pass；原 R09 Blocked 已纠正。
- 固定账号尝试一次唯一 Google Leads Draft 返回 409 E_NO_AD_ACCOUNT；R03/R04/R05 未达到业务终点。Shopify Pixel、Google conversion goal 按第三方前置 Blocked；R02 原提交仍不得重发。
- 官网 Action 逐意图 0/4，均为 absent miss；首个计算器 Case 三次自动化/oracle 失误保留，不把重跑计入命中分母。旧 21/23 与 6/8 样本不同域、不合并。
- 同一报告 v4：https://hellyeah.artifact.cafe/a/10-10-release-staging-qa-xv4t3v；本地 `GOAL-release-20261010-regression/result/2026-10-10_16-03_GOAL-release-regression.md`；无新对象、无资金占用、无已确认产品 Bug。

## 10.10 官网 Action 与 Leads Agent 补测 · 2026-10-10
- 四个可复用官网 Action 已在不同输入/页面状态真实调用并同步当前本地 skill；首跑官网 3/4 hit，活动入口一次 drift 后修复，Leads 既有 Action 2/2 hit，合计首跑 5/6；原 0/4 miss 不改写。
- 新 Leads 请求只提交一次，会话 turn completed，持久化 search/leads + Google Lead Form 的 pending plan；无 Campaign、Launch 或资金变化。只读 plans 列表亦关联旧 R02 03:59 UTC 的 search/traffic pending plan，旧未知状态收束。
- 两个测试生成的 pending plan 在 staging 留存；公开 plans API 无删除方法，不盲删。Shopify/Google conversion 仍按先前约定 Blocked，完整 Leads Campaign 仍需测试广告账号。
- 沿用团队报告路由发布 v5：https://hellyeah.artifact.cafe/a/10-10-release-staging-qa-xv4t3v；本地 `GOAL-website-action-leads-20261010-1630/result/2026-10-10_17-15_website-actions-leads.md`，无已确认产品 Bug。

## GOAL-leads-case5-retest · 2026-10-10
- Case 5：固定账号填全 Google 原生 Lead Form 后该项 ready，但 Proposal 明确提示原生 Google Lead Form 未实现，Launch 禁用；更正 v5 将其归因于缺广告账户的结论。
- 本轮新 plan 后缀 `4bd443e2` 留存；无本轮 Campaign、Launch/Cancel 或资金变动；两个 Campaign Action 命中 2/2，业务终点未达，无已确认产品 Bug 或 Linear 单。
- 报告 v6：https://hellyeah.artifact.cafe/a/10-10-release-staging-qa-xv4t3v；本地 `GOAL-leads-case5-retest-20261010-1900/result/2026-10-10_18-10_case5-leads-retest.md`。

## GOAL-leads-compare · 2026-10-10
- 用户复现对照：既有 cancelled Campaign 是 `web/lead_submit`，而 v6 为一次原生 Lead Form pending proposal；v6 不支持泛化为所有 Leads 路径。
- 两个新的网站 Leads UI Case 均未达 Launch/Cancel：首个无 Proposal 但脚本漏填表单，次个服务端 turn completed、UI Drafting 超时；各有独立视频。新 pending plans `07b7e1a1`、`59e674d5` 留存，无新 Campaign 或资金变化；未确认 Product Bug。
- 同一报告 v7：https://hellyeah.artifact.cafe/a/10-10-release-staging-qa-xv4t3v；本地 `GOAL-leads-compare-20261010-1830/result/2026-10-10_19-10_leads-path-comparison.md`。

## PR-1217 / QA-1149 · 2026-10-10
- Google Sales/Signups 追踪准入；PR head 与 preview SHA 均为 `a868f1f`。新建独立 E2B 执行 8 Case，8 Pass：无 tracker 阻断、Traffic 切换/恢复、等待首访自动 live、QA 3 live 及服务端 409/钱包不扣款。
- QA 2 首访 fixture 只触发一次且已消耗，后续复测需 Yulong 重置；live 只证实收到访问，Google 转化归因、真实 Launch/支付不在本轮。多个草稿时较早 Sales 缺可见入口，产品预期记录于 `PR-1217/pending-review.md`，未判 Bug。
- QA 1 Traffic 恢复原 Sales；最后一台 E2B 会话已登出并终止，前两台到期销毁但服务端会话撤销未单独读回。8 段独立脱敏视频均可在线加载，Case 1/3/7 已播放校验。Playwright 只读 Action 候选未在真实 Firefox 页面验证，因此未加入复用库。
- 工作区报告 v4：https://hellyeah.artifact.cafe/a/pr-1217-google-tracking-qa-gppy9i；本地 `PR-1217/result/2026-10-10_17-35_PR-1217.md`。

## PE-816 onboarding 品牌资料缺值 Bug · 2026-10-12
- 用户截图显示 `finalroundai.com` 的 onboarding review 中 What you do、公司/Logo/颜色已有内容，而 Who you serve、Tone、Value proposition 为 `Add ...` 占位；`Looks Right` 按 QA-1048 的必填规则正确禁用。环境 URL、重复性及缺值层级仍待查。
- 按用户指定创建 [PE-817](https://linear.app/hellyeah-ai/issue/PE-817/onboarding-review-leaves-audience-tone-and-value-proposition-empty) 为 PE-816 子 Bug，分配 Naman；原截图已附在 Linear。英文归档与截图位于 `PE-816/result/`、`PE-816/evidence/`。原 QA-1043 草稿标记为已转单，不另建重复票据。

## 2026-10-12 · PR #1273 · Admin top-up reversal

- PR/SHA：#1273 / `187c1be`（preview sandbox pr-1273，Neon fork）
- feature：PR-1273 admin direct credit 冲正
- 结论：**不通过**。C1 冲正主链路 Pass（余额归零、REVERSAL 记录、原记录转 REVERSED 并保留、不可二次冲正、必填原因、全额确认、audit 双条留痕）；C2/C3/C4 Blocked。
- Bug：bug-01 Audit Log 冲正条目缺组织归属（低，PR 范围内）
- 遗留：QA 1 · No tracker 保留 TOP-UP(REVERSED) + REVERSAL 两条记录（设计预期，非未清理）

## PR-1273 / QA-1156 独立补测 · 2026-10-12
- 部署 `187c1be` 的 PR Sandbox；`Studio Sandbox Smoke` 两笔各 $0.50 Admin direct credit 分别完整撤销，余额回到 $0.00，保留两条 Reversed 原交易及两条 Completed Reversal。第二笔在可撤销时供 write/read 角色对照。Audit API 双向链接/操作人/原因通过，Audit 表缺组织名的既有草稿仍适用。
- 本轮 6 Case：4 Pass（含 Checkout/User 不可 Reverse、刷新门禁）、1 Inconclusive（角色对照未冻结成员 read 角色前置）、1 Blocked（余额不足无安全 fixture）；另补跨组织 API 404。没有申请 QA approved。
- 三台 E2B：第一台中途回收，第二、三台终止；临时 read 成员独立确认清零，server session revoke 未读回。工作区旧报告 Artifact 继续复用 `pr-1273-admin-top-up-reversal-axti2k`，新版本交付记录见本轮 delivery。
