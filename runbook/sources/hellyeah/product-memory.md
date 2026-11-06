# Hellyeah Product Memory

> **2026-09-20 审计说明**
>
> 本轮对照 `hellyeah-v2` `origin/staging` 代码做了一次过期筛查。标记含义：
>
> - `<!-- STALE -->`：有代码或更新规则证据表明已失效，已就地修正或移入「已过期/慎用规则」。
> - `<!-- REVIEW -->`：需要人工业务判断，AI 不擅自改动。
> - `<!-- CLI-ONLY -->`：仅适用于 CLI。**QA 范围已于 2026-09-20 排除 CLI**，这些规则保留作历史参考，不作为当前测试依据；其中的业务语义若在 Dashboard 同样成立，需要人工确认后改写。
>
> 另一处范围变化：当前测试环境已从 staging 转为 **per-PR sandbox**（staging 数据的 copy-on-write fork）。凡涉及 staging 专有环境特性的条目，都标了 `<!-- REVIEW -->` 要求确认 sandbox 是否继承。

## Vendor 邮箱归属（2026-09-10 用户确认）

- 同一邮箱只能归属一个 Vendor，无论角色是 Owner 还是 Member；跨 Vendor 的 Owner→Owner、Owner→Member、Member→Owner、Member→Member 均应拦截。一个 Vendor 可以有多个不同邮箱的成员。来源：Junlong 在本会话明确确认；Bug [PE-374](https://linear.app/hellyeah-ai/issue/PE-374)，父单 PE-358。此项是预期规则，尚不代表实现已修复或 QA 通过。

## 定位

本文件是 AI 对 Hellyeah 的长期测试认知，用来提升测试判断、风险判断和 Bug 判断能力。

它不替代 `business_file/`，不复制业务文件全文，也不记录每个版本流水账。

- `business_file/`：完整业务事实来源。
- `version-history.md`：版本时间线、历史风险、Bug 是否过期的证据。
- `product-memory.md`：AI 开测前必须带入的测试视角产品认知。

当产品记忆不确定、与实际行为冲突、或与业务文件冲突时，必须回查 `business_file/` 和 `version-history.md`，不能直接把推断写成长期规则。

## 业务文件索引

| 功能域 | 必读业务文件方向 | 测试场景 |
|---|---|---|
| Campaign lifecycle | `business_file/cli/`, `business_file/api-server/`, `business_file/managed-ads/` | campaign 创建、状态流转、pause/resume/cancel |
| Admin review | `business_file/admin-dashboard/`, `business_file/api-server/` | pendingAdminReview、审核通过、审核后的状态验证 |
| Payment/refund | `business_file/integrations/`, `business_file/api-server/`, `business_file/postbacks/` | checkout、金额、wallet transaction、refund、post-payment 状态 |
| Creative engine | `business_file/creative-engine/`, `business_file/managed-ads/` | creative generation、RSA mapping、素材与广告组合 |
| Observability/event | `business_file/observability/`, `business_file/postbacks/`, `business_file/integrations/` | PostHog、Inngest、webhook、事件矩阵 |
| Notification email | `business_file/api-server/`, `business_file/admin-dashboard/`, `business_file/integrations/`, `business_file/observability/` | preferences、Dashboard settings、campaign lifecycle email、delivery audit、skipped、Resend webhook/suppression、Clerk email freshness、Admin delivery API、production config gate |

## 子产品线索引

| 子产品线 | 产品记忆 | 使用方式 |
|---|---|---|
| User Dashboard / Customer Dashboard | `User-Dashboard-test/product-memory.md` | 用户侧 Dashboard 提测先读 Dashboard 记忆；涉及 campaign、wallet、Stripe、AIMA、Admin、observability 时，再联动读取本 Hellyeah 总记忆和 `business_file/`。 |

## 产品边界

Hellyeah 测试重点是 User Dashboard / Admin Dashboard / managed ads / payment / event 链路。只有两个角色：**user（User Dashboard）**和 **admin（Admin Dashboard）**——旧文中的 "operator" 即 admin，不是第三个角色。涉及 Stripe、PostHog、Inngest、webhook 后台确认时，默认进入 AI+人工轻量协作。

<!-- STALE 2026-09-20: 原文为「测试重点是 CLI/API/Admin…纯 CLI staging 测试可由 AI 独立执行」。QA 范围已排除 CLI，且测试环境改为 per-PR sandbox，已改写。 -->

## 核心用户路径

- 用户在 User Dashboard 中通过 Agent 对话 / Composer 创建并提交 campaign。<!-- STALE 2026-09-20: 原文为「通过 CLI 或相关入口创建」。 -->
- campaign 提交后必须经过 **admin 审核关卡**；admin 人工审核广告生成质量与安规，通过后才进入真实 launch/active。Google 是一次 approve 到底（自动分配账户并自动激活）；Meta 要先人工绑号（`account_binding`）再 approve。
- campaign 进入 active 后，继续验证 pause、resume、cancel 等状态流转。
- payment/refund 场景不能只看 checkout 打开，还要验证金额、状态、wallet transaction、后续事件和 refund 条件。
- creative 场景要关注生成内容、映射关系、launch 前后行为是否一致。
- launch review 场景必须把 Creative Sets 当作正式前置验收门：素材选择、导入替换、后台生成状态、通知、review 入口和失败恢复都要先闭环，不能只验证 campaign 已提交。

## 当前有效产品规则

- **广告账户平台健康状态与池状态必须一致**：Google Ads 报告 `SUSPENDED`、`CANCELED` 或 `CLOSED` 等非 `ENABLED` 状态时，Hellyeah 内部状态必须为 `disabled`，不能显示或查询为 `available`，也不能参与自动/手动分配。`available` 只表示可安全分配的健康账户。被 ban-disabled 的已分配账户在 teardown 期间保留 `user_org_id`；恢复到可用前必须重新探测 Google 状态，仍为非 `ENABLED` 时应返回 `409`。
- **发布范围与 QA Summary 判定（2026-08-11 用户确认）**：最终发布分组中，只有已完成 QA 且确认属于本次 scope 的 PR 计入本次发布；“QA 中”和“未进入 QA”都归到下次发布，不阻塞本次发布。发布建议只按本次发布分组计算：本次 scope 全部验证完成时为 GO。若要把下次发布 PR 提前带入，必须先重新归入本次 scope 并完成 QA，不能仅凭 merged/staging 状态放行。
- `pending_internal_review` 不是终点，也不是可跳过的附加流程；所有 campaign 都要经过 admin 人工审核广告质量和安规，审核通过后才是真正 launch/active。<!-- STALE 2026-09-20: 原文用旧字段名 `pendingAdminReview` 并把 ops review 与 Admin 审核并列，实际只有一道 admin 门。 -->
- **Creative Sets 是 launch review 的正式前置验收门**（2026-07-20 用户确认）：涉及 campaign launch review 的提测，需要在 review 前检查 Creative Sets 的素材选择、导入/替换、生成状态、通知、review 入口和失败恢复。<!-- STALE 2026-09-20: 原文此处附有「HEL-1332 / HEL-1331 暂时没有进入提测流程」。这是 2026-07 的一次性排期信息，不是长期产品规则，已删除。 -->
- **Creative Set partial 与 asset failure 语义（2026-08-12 用户确认）**：持久化 `partial` 表示 set 的部分子任务已成功，例如 copy 成功但 image 失败；它不等于 set 可用。只要必需的 landscape 或 square 图片 asset 失败，`creative generate set --watch` 返回 `creative_failed` 和 exit code `1` 属于预期。判断时同时记录持久化聚合状态与命令的 asset-level 终态，不能因二者名称不同直接判 Bug。
- **Studio Creative Set 可见性（2026-08-12 用户确认）**：standalone `creative generate text` / `creative generate image` 不应进入 Studio；first-class `creative generate set` 产物应在同一组织的 Studio library 展示。验证顺序必须是：确认 CLI 与 Studio 的 active org 一致 → 用 `creative sets view` 确认持久化 → 刷新 Studio UI → 再检查列表。未刷新时暂时看不到不能直接判数据缺失或跨 surface Bug；QA-1012 即因此被撤销。
- campaign 测试报告要分清 submit 成功、进入 `pending_internal_review`、admin approve、真实 launch/active 四层状态，不能把提交成功等同于已投放。
- active 状态下才有完整的 pause/resume happy path 意义。
- Stripe 4242 支付、Admin approve、PostHog/Inngest/webhook 后台确认属于典型 AI+人工轻量协作点，不应默认写成未覆盖。
- payment 测试不能只验证 checkout-only；需要关注金额、状态、wallet transaction、webhook/refund 等后续链路。
- Display campaign 类型已从前向/创建路径下线（HEL-1245 / PR #564，2026-06-29 起）：可创建类型只剩 **Search + Performance Max**；`campaignType:"display"` 在 CLI（`--type` 客户端拒绝，exit 2）和 API 写侧 schema（`launchBody`/create/draft/pending 的 campaignType enum=`['search','pmax']`）都被拒。**预算改为 total-only**：create 路径 `budgetType:"daily"` 被拒（CLI "daily budgets are no longer supported" exit 2；schema enum=`['total']`），裸 `--budget` 对所有类型默认 total，total 必须带 `--end-date`。images-without-type 现在 infer `pmax`（旧为 display）。
- Display 仅作 **legacy 只读** 保留（无 DB migration）：读侧/响应 schema（`CampaignDetail`/`CampaignListItem`.campaignType=`['search','display','pmax']`、budgetType=`['daily','total']`）、`adFormat:"display"` copy mode、`display` kit recipe（与 pmax 同）均保留并标 `@deprecated`。历史 display 行的 read/report/pause/cancel/sync 应仍可用，launch 历史 display 行应 fail-loud（不静默重建为 search）——这些需研发 seed 历史 display 行才能验证（display 已无法经任何界面创建）。
- 旧错误码 `E_NO_DISPLAY_KIT` 已重命名为 `E_NO_IMAGE_KIT`（kit 查找 display→pmax，PR #564）。该错误仅在"平台无 kit recipe"时触发，google 永远有 kit，运行时不可黑盒复现。
- PMax 预算口径看 total budget。
- PMax launch readiness 不能只看 `profile.isComplete=true` 或 `doctor` 的普通 profile pass；PMax 还需要 1:1 PNG brand logo。`doctor` 通过不是 PMax 可 launch 的充分条件，真正 launch gate 以 PMax dry-run / launch 校验为准；doctor 中的 PMax logo readiness 只能作为辅助提示。
- PMax `keyword` 是 no-op，应从 launch payload、dry-run echo 和 stored draft 中去掉；如果 PMax launch 后仍存储或回显 keyword，可按 payload/存储契约问题判断。
- PMax 支持 campaign-level age/gender targeting，表现为 negative-complement exclusions，不能再按“PMax 必须 strip demographics / Google 会拒绝 demographics”作为 Bug 判断标准。
- PMax `--location` 是建议项，不是强制项；不传 location 时默认投放 `Worldwide`。User 的 Claude / skill 会按用户意向自动带 location，或在用户有意投全球时不带 location；PMax no-location dry-run `launchable=true` 不再按 Bug 判断。
- PMax 素材要按内容去重；brand logo 与 marketing image 字节内容相同时，Google 可能返回 duplicate asset mutate rejection，并级联出误导性的 asset group headline / long headline / description 数量不足错误。
- PMax brand logo 存储在 business/profile level（`profile.logos`），**不单独存 campaign-level logo**；launch 时由后端从 business level 取出并附加到 Google asset group。因此 `campaign get` 的 adCopy **不含 logo 字段属设计内**（非丢失），logo 仍随 campaign 投出。判断 logo 是否投放不能只看 adCopy 有无 logo 字段。研发 2026-06-26 确认，并判定新增 campaign-level logo DB 字段为 over-engineering，暂不做。
- campaign `reservedCents` 可作为历史意图预留金额保留；判断当前实际占用资金时以 `activeReservedCents` 为准。**失败的 campaign 直接新建一个即可，不需要清理入口**（2026-09-20 用户确认，不是产品缺陷）。<!-- STALE 2026-09-20: 原文要求「失败或孤儿 draft 应可通过 `hellyeah campaign discard <id> --yes` 清理，否则按可清理性 Bug 判断」。CLI 已退出范围；Dashboard 上 `DELETE /api/v1/campaigns/:id` 只在 launch 成功后自动清理 onboarding originating draft，无面向用户的清理入口——这是设计，不是缺口。 -->
- **[HEL-1166 / 1.2.1-beta.1 起，其中扣款时机已被 HEL-1401 推翻] 广告账户分配推迟到审核后**：submit 不再当场分配账户/调 Google，而是先落 `pending_internal_review`（**零账户、零 Google 调用、零 waitlist**）。Admin approve 后才：分配账户→建 Google setup（validateOnly→create PAUSED）→尝试激活到 active。新状态：`pending_internal_review`、`approved`、`rejected`。此规则取代旧的"launch 后进入 paused + pendingAdminReview"模型（旧模型是 pr579 及更早分支）。
  - <!-- STALE 2026-09-20: 原文含「零扣款」和「debit 在 approve 阶段」，与下方 HEL-1401 规则直接矛盾。代码证据：`packages/managed-ads/src/service/campaigns.ts:5204` 注释 "at `pending_internal_review` the submit debit has already"，以及 :2595 "durable debit is required before returning to `pending_internal_review`"。**现行为：submit 时即扣款**，已从本条删除「零扣款」并移除 approve 阶段的 debit 步骤。 -->
- **approve 之后没有第二道人工门，但行为按平台分叉（2026-09-20 用户确认）**：
  - **Google**：admin approve → **自动分配广告账户** → 自动激活到 `active`。**无人工 unpause 步骤**。唯一的失败分支是**账户池没有可用号**，此时激活失败（对应 API 返回的 `autoActivated=false` + `activationDeferredReason`，见 `apps/api/src/modules/managed-ads/campaigns.ts:1624`）。
  - **Meta**：**需要先人工分配广告账户，然后才能 approve**。分配动作在 approve 之前，不是之后。
  - 判断要点：Google 路径下停在 `paused` / 未 active 且账户池有号，是异常；Meta 路径下未分配账户就无法 approve 属预期。**不要把两个平台的顺序混用。**
- **状态枚举以代码为准（2026-09-20 核对 `packages/shared/src/constants/managed-ads.ts`）**，共 13 个。知识库此前漏了两个关键状态：
  - **`account_binding`（Meta 专有）**：绑号和审内容是两个人的活，所以是两个状态。客户没有已绑定 Meta 广告账户时停在这里等 operator 人工绑号，之后才进 `pending_internal_review`。⚠️ **用户侧这两个状态都显示 "pending"，看不出区别**，只能从 Admin 或只读 API 区分。
  - **`superseded`（终态，刻意不叫 `cancelled`）**：广告账户被封导致 campaign 必须在替换账户上重建时设置。**钱没退回，是转移了**——未花完预算拨给后继 campaign。不退款是结构性的：`eligibleCampaignRefundWhere` 只扫 `cancelled` 和 `completed`。看到「取消了但钱没回来」先确认是不是这个状态。
- **reject 不是死路（2026-09-20 用户确认）**：admin reject 之后 campaign **仍可 reopen**；只有 reject 之后再 cancel 才彻底终结。断言应该断 `allowedActions` 里有没有 `reopen`，不要断状态名（代码把 `rejected` 标为 legacy）。
- **Pending Review ≠ Pending Activation（两个琥珀色状态，含义相反）**：
  - **Pending Review** = `pending_internal_review`：建 setup **之前**的人工审核门，零账户/零扣款/零 Google。取消 = 真零退款。
  - **Pending Activation** = `paused` + `launchedAt` 有值 + `activatedAt=null`：setup **已建好**（已扣款、Google 上已 PAUSED），只差激活。取消 = 已扣款走退款语义（但从没投放则即时全退）。
  - 不要把 `pending_internal_review` 当成"卡在 paused"去测 pause/resume——它还没上 Google。
- **广告账户是 org 级 1:1 分配（不是 per-campaign）**：`getOrAssignAdAccount(orgId)`，org 已有账户就复用并报错拒绝再分配。账户池的粒度在 org 层（不同 org 领不同账户），**单个 org 的所有 campaign 共享同一个账户**。
- **账户级预算 cap = 该账户下 active+paused（有 platformCampaignId）campaign 的 reserved 之和**（`calculateRequiredGoogleAccountCapCents`）。多 campaign 并存受此 cap 约束，超 cap 时 approve 会扣款建 PAUSED 但**激活被 `assertGoogleAccountBudgetHealthyForActivation` 挡住 → 停 Pending Activation**。⚠️ **[2026-07-06 提出，2026-09-20 更正] staging test MCC 不支持自动抬高账户 cap**（当前卡在 **$1000**，早期记录的 $150 已过期）：架构上账户 cap 本应通过 account-budget-adjustment 自动抬到 required cap，但 test 账户不支持，所以 staging / sandbox 上并存 campaign 的 reserved 总额受该 cap 硬约束，超过之后 approve 会扣款但激活被挡住、停在 Pending Activation——**这是环境特性，不判 bug**。prod / 真实账户上的自动抬 cap 行为需另行回归验证。**per-PR sandbox 继承 staging 的 test MCC 和 $1000 账户 cap（2026-09-20 用户确认）。**
- **【当前 Dashboard 口径，2026-09-20 用户确认】退款形态只看「campaign 有没有激活过」，不看取消入口**：
  - **从没激活过** —— 包括审核阶段被 reject、admin cancel、用户自己 cancel —— → **直接退款**（即时到账）。注意这**包含已扣款但未激活**的情况（旧称 Pending Activation）。
  - **激活过之后再 cancel** —— 仍然可以 cancel，但**钱不会立即回到账户，几个工作日内退回**。
  - 结算窗口以代码为准：`packages/managed-ads/src/env.ts` 的 `REFUND_SETTLEMENT_MINUTES` 默认 `48 * 60`，即 **48 小时**（env 可调）。**UI 上不展示预计到账时间，这是设计，不判 Bug**（2026-09-20 用户确认，保持现状）。agent 按 48h 预算轮询，超时标 Inconclusive，不要把「界面没告诉用户什么时候到账」报成缺陷。
  - <!-- REVIEW 2026-09-20: 新口径与下方旧 CLI 口径冲突——旧规则说「user cancel + 已扣款（含 Pending Activation）→ 48h 延迟退」，新口径说未激活就是即时退。可能是 Dashboard 与 CLI 行为本就不同，也可能旧规则已整体过期。若 CLI 已下线，建议直接删除下方三条。 -->

- <!-- CLI-ONLY / 疑似过期 2026-09-20: 以下三条是 2026-07-07 基于 CLI 实测的旧口径，判据是「取消入口 + 是否扣款」，与上方当前 Dashboard 口径不一致。保留待确认，**不要作为当前判定依据**。 -->
- **[旧 CLI 口径] 退款形态取决于「取消入口 + 是否 launch/扣款」（2026-07-07 实测）**：
  - **User CLI cancel（campaigns 路由）**：仅当 campaign **从没上 Google 且从没扣款**（`!platformCampaignId && !reservedTransactionId`，即 pending_internal_review / 未扣款 rejected）→ **即时零退款**（refundStatus completed、amount 0）。只要**有 platformCampaignId 或已扣款**（含 Pending Activation）→ **走 48h 延迟退款**（refundStatus pending、金额 `reserved − actualSpend`），**即使从没投放**。
  - **Admin cancel（managed-ads `updateCampaignStatus`）**：never-served debited（`paused`+`!activatedAt`+`actualSpend=0`，即 Pending Activation）→ **即时同步全额退**（`refundNeverActivatedCampaign` / syncRefund）。三重守卫：`!activatedAt && actualSpend==0 && status=="paused"`。
  - **served（激活过 / 有花费）**：两条入口都走 **48h 结算**后退 `reserved − actualSpend`。
  - ⚠️ **同一个 Pending Activation campaign：admin cancel 即时全退、user CLI cancel 走 48h** —— 入口不同结果不同。<!-- STALE 2026-09-20: 当前 Dashboard 口径下不存在这个差异，未激活一律即时退。 -->
- **[HEL-1401 / PR #653，2026-07-21 验证，已推翻旧模型] submit 时就扣钱包**：public campaign submit **当场 debit 钱包**（扣款完成后才进 `pending_internal_review` / Pending review），**approve 不再二次扣款**（approve 时再出现 campaign-budget debit = Sev-1），reject / 用户取消（平台创建前）→ **立即全额退**，serving 中取消 → 48h 延迟退（`X − 实际花费`）。目的：旧的 submit 只做非绑定的余额快照 check（不占资金），多个 pending 请求能拿同一笔钱都通过 → 超额 commit；改成 submit 扣款把 check 变成真实资金 hold，后续提交看到已减少余额。不变式：已扣 debit + 已 funded pending ≤ 钱包余额，并发提交也成立（$100 钱包两个 $80 只过一个，另一个报 $60 缺口）。⚠️ **此规则取代下方旧的"submit 不 debit、真正 debit 在 approve"**（HEL-1166 时期，1.2.1-beta 及更早）。⚠️ staging 一旦有 funded pending 行，别回滚到 #653 之前的 binary（旧码把 funded pending 当没扣款，approve 会再扣一次）。
- **[旧模型，已被 HEL-1401 取代，仅历史参考] submit 不 debit 但有前置 wallet 充足性 check**：`launch --yes` 预算 > 钱包余额会在 **submit 时**就被拒（"Wallet balance below required"），带 topup fix；真正 debit 仍在 approve。
- **approve 扣款 ≠ 到达 active**：approve 可能扣了款却因账户 cap 满而停在 Pending Activation。报告/判断必须区分「approve 成功/扣款」与「active/在投」，不能把 approve 成功当作已投放。
- **[HEL-1176 / 1.2.1-beta.1] review/setup 结束日期缓冲**：soft launch（有 `--end-date`、无 `--hard-deadline`）推给 Google 的 `end_date` = 交付结束 + `REVIEW_SETUP_BUFFER_DAYS`（默认 3）天；`--hard-deadline` 关闭 buffer（Google end = 交付日）。关键判断点（比"日期有没有延长"更重要）：① **buffer 不落库**——stored/dashboard 的结束日仍是用户交付日，只有 Google 侧才是 +3；② **总预算不被 buffer 抬高**——reserved/total = 用户设定值，不因额外天数膨胀；③ CLI 三行披露（Active delivery window / Review-setup buffer +N 或 "none (hard deadline)" / Google campaign window），JSON `calendarWindow` 带 deliveryEndDate/calendarEndDate/bufferDays/isHardDeadline。staging test MCC 下 Google campaign 即使停 PAUSED/Pending Activation，其 end_date 在创建时即写死、可在 Google Ads 核对。active campaign 只能改预算、无改结束日入口（改预算不影响结束日）。external-sync 对 legacy campaign 的 buffer 精确性由 HEL-1279 跟进，当前为工单认定的已知安全过渡态、非 bug。
- **staging 用 test MCC，Google 上有显示但永不真实投放**：validateOnly 真校验、campaign 真建成 ENABLED，但 test 账户不产生曝光/点击/花费、绑不了真实账单。指标恒 0 是预期，不判 bug。真实投放/计费/转化回传只能在 prod 或真实账户覆盖，staging 只能测到"推给 Google 为止"的创建正确性。
  - **per-PR sandbox 继承 staging 的 test MCC（2026-09-20 用户确认）**，所以本条在 sandbox 上同样成立：Google 侧能看到 campaign 真建成，但指标恒 0 是预期，不判 bug。
- Creative text compositor 测试必须区分三层输出：`generate image` 初始 text layer、`PATCH /creative/images/{id}/text` edit layer、`/blend-text` 最终 blended image。单独某一层成功不能代表整条 workflow 可放行；如果产品预期是 `edit -> blend` 才是最终自然图，则 CLI/API 必须提供可用的 blend/workflow 入口，QA 也必须检查最终 blended image。
- <!-- CLI-ONLY 2026-09-20: `--size` 参数为 CLI 专有；但其背后的 PLATFORM_SPECS 尺寸约束（landscape 1200×628 / square 1200×1200）在 Dashboard/Studio 同样成立，判定素材尺寸时仍可引用。 -->
- Creative `--size` 对 Google 平台只定义 `landscape (1200×628) / square (1200×1200) / all`（由 `@hellyeah/shared` PLATFORM_SPECS 驱动）；`portrait/tall/vertical` 等平台未定义尺寸返回 `validation_error` / `E_FORMAT_UNSUPPORTED`，属设计内拒绝，不判 Bug。提测单若把 tall 列为验收尺寸，先按工单措辞 vs PLATFORM_SPECS 范围不一致处理，不直接判 CLI 缺陷。（QA-913 1.2.0-beta.4 复测 + `business_file/cli/creative.md` 确认）
- <!-- CLI-ONLY 2026-09-20: 本条为纯 CLI 命令行为，QA 范围已排除 CLI，仅作历史参考。 -->
- Creative CLI surface（1.2.0-beta.4 起）：`creative workflow` 提供端到端非交互入口（`--hook/--headline/--position/--font/--size/--json`），`creative edit blend` 可脚本化（`--job-id/--json`，落到后端）。`creative edit text` 为 TTY-only，脚本化「文字+位置+字体」走 `creative workflow`，不应再按「edit text 缺脚本化参数 / workflow|blend 命令缺失」判 Bug。
- RSA ad-copy readiness 缺项（`ad_copy` 检查，HEL-1326/#614）**只在 Web / `POST /campaigns/launch/validate` 携带内联 adCopy 草稿覆盖时触发**；CLI `campaign launch --text-id` dry-run **碰不到**——CLI/creative-job 走 managed-ads build 时 `compactAndPadGoogleText` 会自动补齐 headline 到 min 3、description 到 min 2（真实内容不足则用兜底短语/带序号填充串凑数），再截到 max 15/4。RSA 数值统一来自 `PLATFORM_SPECS.google.textAssets`（headlines min3/max15/30char，descriptions min2/max4/90char，HEL-1333/#618）。**测 readiness 缺项必须走 Web 或直接打 API。**<!-- STALE 2026-09-20: 原文末句为「不能用 CLI dry-run 判定"文案不足未拦截"」。CLI 已排除，该告诫自动成立，保留前半句即可。 -->（代码 + 2026-07-20 CLI+Web 复测确认）
- Notification system 验收不能只看邮件是否发出；必须同时覆盖用户偏好、收件邮箱 freshness、Dashboard 设置页、campaign lifecycle event、`notification_delivery` 审计、dedup、`skipped` reason、Resend webhook/suppression、Admin delivery 查询和生产配置 gate。
- 第三方 analytics/postback 是长期实现方向（2026-07-20 用户确认）。涉及 data source、pixel、postback、attribution 或 campaign conversion 诊断时，QA 需要保留第三方诊断路径，不能只依赖 X-Ray 自有链路。诊断至少分层覆盖：data source 绑定和权限、Pixel ID 是否识别并展示、浏览器/服务端事件是否上报、postback 是否入队和交付、重复事件与归因一致性、X-Ray fallback 或差异解释。
- Notification preferences 的核心契约：`GET/PUT /api/v1/notifications/preferences` 应有稳定默认值；campaign email 可关闭/开启并持久化；无 email 用户应表现为 `unavailable`，不能显示成可发送状态。
- Dashboard `Settings > Notifications` 应展示 email destination；Campaign emails toggle 要与 API 偏好一致，修改后刷新仍持久化。
- Campaign lifecycle email 判断：`approved-live` 只应在 first activation 发送；`failed`、`cancelled`、`completed`、`refunded` 触发对应通知；退款邮件金额必须准确；用户可见品牌文案应为 Hellyeah。
- `notification_delivery` 是通知系统放行的审计事实来源之一；每次通知应记录正确的 type/status/dedup/entity metadata，重复事件不能重复发送。
- `skipped` 不是失败的泛称，必须区分 reason：用户关闭 campaign email 后应记录 `skipped / preference_disabled`；邮箱进入 bounce/complaint suppression 后后续通知应记录 `skipped / suppressed` 且不再发送。
- Resend webhook 必须校验签名：invalid signature 返回 400；bounce/complaint 应写入 suppression，后续被 suppression 命中的邮箱不再发送。
- Clerk verified email 才能同步到 `identity.user.email`；unverified email 不应覆盖；email backfill script 必须分别验证 dry-run 与 commit mode。
- Admin delivery API `/api/admin/notifications/deliveries` 应支持列表、按 entity/status 过滤和分页，并能查到 skipped 记录。
- Production 环境缺 `RESEND_API_KEY` 应阻止启动；该项属于源码/部署配置 gate，通常不能仅靠 CLI 黑盒验证。

## 高频风险区

- campaign 状态机：pendingAdminReview、active、paused、canceled、refund-eligible 等状态流转。
- campaign 预算口径：PMax total budget 与非 PMax daily budget 并存，测试时必须按 campaign 类型分别断言 CLI 参数、Admin 展示、Google Ads 预算和 reporting 口径。
- payment/refund：金额、币种、状态回写、重复支付、refund 条件、event/webhook。
- payment/refund/fraud：top up 后已产生 managed ads spend 再申请全额 refund 是高优先级资金套利风险；测试时必须同时核对 Stripe Dashboard、wallet ledger、reservation、ad spend、refund eligibility、重复退款幂等和 Admin/风控审核状态。
- creative：生成内容与 launch mapping 不一致。
- creative compositor：文字层可能在 generate/edit 阶段渲染成不可读方块字；position/font 字段回写成功不等于最终图片可读。后续测试必须下载真实图片人工/AI 视觉检查，并将 edit output 与 blended output 分开判定。
- creative asset metadata：API/CLI 返回的 `resultWidth/resultHeight` 可能与实际 R2 PNG 尺寸不一致；广告素材验收以真实下载文件尺寸和平台比例为准，不能只信 metadata。
- PMax readiness：普通 profile complete 与 PMax launch-ready 不是同一概念；缺少 1:1 PNG brand logo 时，不能因 `doctor` 普通检查通过而判定 PMax 可 launch，需以 PMax dry-run / launch gate 为准。
- PMax launch payload：keyword 应剥离；age/gender demographics 不应剥离，需按 negative-complement exclusions 逻辑验证。
- PMax location：不能把 no-location dry-run launchable 判为 Bug；需要验证用户明确传 location 时能正确保留/推送，用户不传时按 `Worldwide` 默认口径处理。
- PMax asset mutate：重复图片素材可能触发 Google duplicate asset 错误，并伴随误导性的 asset group 文案数量不足错误。
- draft / reservation 展示：失败或未 launch 的 campaign 要区分历史 `reservedCents` 与当前 `activeReservedCents`，并验证 discard 清理路径。
- event/observability：PostHog、Inngest cron、webhook 事件矩阵遗漏；第三方 analytics/postback 接入时还要分层检查 data source、Pixel ID、事件上报、postback delivery、归因一致性和 X-Ray fallback。
- notification email：生命周期事件能发不代表系统可放行，还要检查偏好开关、审计记录、去重、skipped reason、suppression、Clerk email freshness、Admin 查询和 production config gate。`completed`/`refunded`/`failed`、suppression、production startup gate 往往需要 DB 注入、后端 fixture、Resend 测试事件、源码或部署权限，不能在纯 CLI 黑盒测试中硬写已覆盖。

## Bug 判断能力

### 高置信 Bug

满足以下条件时，优先判为高置信 Bug：

- 当前产品规则明确。
- `business_file/` 或 `version-history.md` 有证据。
- 实际行为与预期不一致。
- 已排除环境、测试数据、权限、配置和操作顺序问题。
- Stripe Revenue Connect 中，如果 Stripe Dashboard 已确认 connected-platform webhook delivery 成功，但 CLI/API 状态仍长期不更新 `lastEventAt` 或状态反馈异常，可以建 Bug；归因应写为状态反馈/可观测性或 handler 回写异常，不能仅凭 `lastEventAt` 推断 Stripe 未投递 webhook。
- PMax 场景中，若 dry-run echo 或 stored draft 保留 keyword，属于 keyword no-op 未正确剥离的 Bug；age/gender demographics 保留本身不再判 Bug。
- PMax 场景中，不传 `--location` 但 dry-run / launch 继续通过不属于 Bug；默认投放 `Worldwide`。只有用户明确传入 location 却未保留/未推送，或 `Worldwide` 在实际 Google Ads 中错误回退到具体非全球地域时，才按 targeting 问题判断。
- 失败 PMax draft 如果没有 wallet debit 且 `activeReservedCents=0`，单看 `reservedCents` 不再判资金占用 Bug。**「没有清理入口」也不判 Bug** —— 失败的 campaign 重新建一个就行（2026-09-20 用户确认）。
- Creative/compositor 场景中，若 status 返回 complete 且 `textLayerConfig` 正确，但真实下载图片中文字不可读、字体变方块、或最终 blended image 缺失/无法通过 CLI 触达，应按用户可见素材质量或 workflow surface Bug 判断；不能仅凭 API 字段回写成功判通过。
- Notification 场景中，如果用户偏好已关闭 campaign email 但 delivery 没有记录 `skipped / preference_disabled`，或仍实际发送邮件，可按偏好未生效/审计缺失判断高置信 Bug。
- Notification 场景中，如果同一 entity/event 重复触发后出现重复发送或多条非幂等 delivery 记录，可按 dedup/idempotency Bug 判断。
- Notification 场景中，如果 invalid Resend webhook signature 未返回 400，或 bounce/complaint 没有进入 suppression，属于 webhook 安全/合规高风险；但 suppression 分支通常需要 Resend 测试事件或 DB/fixture 支持。

### 疑似 Bug / 风险

- 产品记忆提示高风险，但业务文件未明确。
- 现象只出现一次，尚未稳定复现。
- 需要 Admin、Stripe、PostHog、Inngest 或 webhook 后台确认但尚未完成。

### 文档/实现不一致

- `business_file/` 明确要求与实际行为冲突。
- `product-memory.md` 与 `business_file/` 冲突。
- `version-history.md` 显示历史规则可能已过期但当前文档未更新。

### 不能直接判 Bug 的情况

- 产品记忆不确定且业务文件无明确规则。
- 需求未定义，只是体验不符合预期。
- 环境、权限、测试数据不足。
- 历史规则可能已经过期。
- 仅看到 `lastEventAt: null`，但没有 Stripe Dashboard delivery、X-Ray conversion、Postbacks trace 或后端日志证据时，不能直接判定 webhook 未成功处理；`lastEventAt` 不是团队认可的可靠 webhook smoke 指标。

## 测试入口和依赖

- User Dashboard / Admin Dashboard，运行在**目标 PR 的 sandbox** 上（不再是 staging，也不再走 CLI）。<!-- STALE 2026-09-20: 原文为「Hellyeah CLI staging 环境」。 -->
- Admin dashboard。
- Stripe sandbox / 4242 checkout。
- PostHog、Inngest、webhook 或相关后台事件查看能力。
- Resend webhook/suppression 测试事件、notification delivery admin/API 查询权限、必要时 DB fixture 或后端脚本权限。
- `version-history.md` 当前版本和最近版本风险。
- `QA-Knowledge/domains/campaign.md`、`payment.md`、`admin-review.md`、`webhook-event.md`、`automation.md`。

## AI+人工轻量协作点

- 用户在 Admin dashboard approve campaign，AI 继续验证 active/pause/resume/cancel。
- 用户完成 Stripe 4242 checkout，AI 继续验证金额、wallet transaction、payment 状态和后续事件。
- 用户确认 Stripe Dashboard connected-platform delivery 后，AI 继续核对 CLI/API 状态、X-Ray conversion 和 Postbacks trace，并按层级判断问题归因。
- 用户确认 PostHog/Inngest/webhook 后台是否出现指定事件，AI 继续整理事件矩阵。
- 用户或研发提供 DB 注入、Resend bounce/complaint 测试事件、suppressed email fixture、production config gate 运行环境后，AI 继续验证 notification suppression、`skipped / suppressed`、`completed/refunded/failed` lifecycle email 和 production `RESEND_API_KEY` startup gate。

## 已过期/慎用规则

- 旧版本成立但当前 `business_file/` 或 `version-history.md` 已推翻的规则必须移入本区。
- 本区规则只能作为历史提醒，不能直接作为 Bug 判断依据。
- “PMax 会 strip age/gender demographics / Google 会拒绝 demographics”已被 PR #537 修复说明纠正；后续应按 campaign-level negative-complement exclusions 验证。
- “doctor 通过但 PMax dry-run 因缺 1:1 PNG logo 失败就是 doctor bug”已被 2026-06-24 人工与研发确认纠正；正确口径是 doctor pass 不是 PMax 可 launch 的充分条件，PMax readiness 以 dry-run / launch gate 为准。
- “PMax 不带 location 必须被 dry-run 拒绝”已被 2026-06-24 用户与 Wilson 确认纠正；正确口径是 location 建议但不强制，不传默认 `Worldwide`。
