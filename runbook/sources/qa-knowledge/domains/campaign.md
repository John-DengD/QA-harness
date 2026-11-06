# Domain Memory: Campaign

## 适用产品线

Hellyeah

## 核心风险

- campaign 创建成功但后续状态、审核、支付、creative、event 链路未闭环。
- launch review 只看 campaign 提交成功，漏掉 Creative Sets 前置验收门，导致素材选择、导入替换、后台生成状态、通知、review 入口或失败恢复没有闭环。
- 只测 happy path，漏掉 pause/resume/cancel/refund-eligible 等状态边界。
- 把 campaign 创建成功误判为已经 launch；实际所有 campaign 都需要 admin 人工审核广告质量和安规，通过后才进入真实 launch/active。
- **把 Google 和 Meta 的审核流程当成同一条**（2026-09-20 用户确认 + 代码核对）：
  - **Google**：一次 admin approve 即到底 —— 自动分配账户 → 建 setup（不二次扣款）→ **自动激活到 active**，没有第二道人工门。唯一失败分支是账户池无可用号。
  - **Meta**：两阶段人工 —— 先停在 `account_binding` 等 operator **人工绑定广告账户**，再进 `pending_internal_review` 审内容。绑号在 approve 之前。
  - 用户侧这两个 Meta 状态**都显示 pending**，只能从 Admin 或只读 API 区分。
- **漏掉 `superseded` 状态**：广告账户被封导致 campaign 在替换账户上重建时，原 campaign 进入 `superseded`（不是 `cancelled`），未花完预算**转移给后继 campaign 而非退回钱包**。看到「取消了但钱没退」先确认是不是这个状态。
- 误解预算模型：HEL-1245（PR #564，2026-06-29）之后**所有 campaign 只有总预算，没有 daily budget 字段**。系统会用 `总预算 ÷ 投放天数` 派生出每日额度，并按下限校验（代码默认总预算 ≥ $20、派生日额 ≥ $5，均由 env 可调；staging / sandbox 已放开该 gate 方便测试）。把「派生下限」当成「可填的 daily budget 字段」是过期口径。<!-- STALE 2026-09-20: 原文称「daily budget 没有全局废弃，非 PMax campaign 仍需覆盖 daily budget」，与 packages/managed-ads/src/env.ts 注释「Post-HEL-1245 campaigns are total-budget only, so this is a per-day FLOOR derived from totalBudget ÷ activeDeliveryDays, not a daily-budget field」冲突。 -->
- 把普通 profile complete / `doctor` profile pass 误判为 PMax launch-ready；PMax 还需要 1:1 PNG brand logo，PMax readiness 以 dry-run / launch gate 为准。
- 把 PMax keyword、demographics 当作同一类字段处理：keyword 是 no-op，应从 payload / dry-run echo / stored draft 中剥离；age/gender demographics 支持 campaign-level negative-complement exclusions，不应再按必须 strip 判断。
- 把 PMax no-location dry-run 通过误判为 Bug；PMax `--location` 是建议项，不强制，不传时默认 `Worldwide`。测试应区分“用户明确指定地域是否被保留/推送”和“用户有意不指定地域投全球”。
- 误判 PMax Google mutate 错误：brand logo 与 marketing image 内容重复可能先触发 duplicate asset rejection，再级联出 asset group headline / long headline / description 数量不足等误导性错误。
- **关键词质量只按「有关键词、能 launch」判断**（2026-09-20 用户确认为可判 Bug 的质量门）：Search 或任何消费关键词信号的 campaign，关键词必须覆盖四类 —— **brand**（保护品牌流量）、**competition**（获取竞品流量）、**general**（覆盖产品相关主题）、**negative**（排除误导点击与预算浪费）。缺类即质量不达标，可判 Bug。断言见 `QA-models/hellyeah/campaign-agent.md` `AGENT-009`。
- 把失败 draft 的 `reservedCents` 直接等同当前资金占用；当前实际占用应看 `activeReservedCents`，失败/孤儿 draft 的重点是是否提供 discard 清理路径。

## 历史 Bug 模式

- Campaign targeting/grounding 更新后只刷新关键词列表，未使 forecast cache 或下游预算派生值失效，导致 locations/keywords 已变化但 CPC、click estimate、likely spend 和 pricing curve 仍使用旧上下文。
- Campaign Agent 的策略数据与描述生成没有共享一致上下文时，会出现关键词和预算看似结构化、用户可见描述却短促、拼接或无法解释投放逻辑的问题。
- pendingAdminReview 后没有继续审核覆盖。
- Creative Sets 已被确认为 launch review 的正式前置验收门，但测试仍按旧 campaign-only 口径执行。
- active 状态下 pause/resume happy path 未覆盖。
- creative generation 与 launch mapping 不一致。
- campaign 报告只记录系统创建成功，未标注 ops review 是否完成、Admin 是否 approve、Google Ads 是否真实投放。
- PMax 测试把 daily budget 当作废弃字段，导致旧 campaign 类型兼容性漏测。
- `doctor` 全绿但 PMax dry-run 失败 `pmax_logo`，说明普通 profile check 与 PMax launch gate 不等价；这本身不再作为 doctor Bug。
- PMax dry-run / stored draft 仍回显或保存 keyword，说明 PMax no-op 字段未正确剥离。
- PMax no-location dry-run `launchable=true` 不再作为 Bug 模式；默认 `Worldwide` 是允许行为。
- PMax 素材未按内容去重，brand logo 与 marketing image 相同时触发 Google duplicate asset mutate rejection，并可能伴随虚假的 asset group 文案数量不足错误。
- PMax 或其他失败 draft 没有可用清理动作，导致 next-step 提示不可执行或 campaign 长期停留在不可操作状态。

## Meta Facebook Page 授权与解绑

两条**互相独立实现**的 Meta Page 授权路径，不要混用口径：

- **自助（组织绑定，"组织绑定"）**：客户在 Dashboard 走 Nango OAuth 弹窗完成 Meta 授权后自选 Page，落在 `apps/dashboard/src/features/campaigns/launch/page.tsx` 的 `MetaPagePanel`（`data-slot="meta-page-panel"`）。Hooks 见 `apps/dashboard/src/data/hooks/meta.ts`：`start-connect`（开始授权）→ `authorized-pages`（读取已授权 Page 列表，`GET /api/v1/integrations/meta/page/authorized-pages`，返回 `{ pages }`）→ `bind`（绑定）。
- **BYO（ops 代客授权）**：Admin 在组织详情页手动为客户创建一条授权链接、客户用该链接走真实 Meta OAuth、Admin 轮询拿到结果后选号导入，组件是 `apps/admin/src/features/organizations/components/connect-meta-byo-dialog.tsx`（`ConnectMetaByoDialog`，`start → connecting → waiting → review → importing → success/error`，3 秒轮询 `.../meta-byo/resolve`）。这不是自助流程，是 ops 先手操作。
- **disconnect 的可用性与来源无关**：「Change Page / Disconnect Page」按钮是否可点（`canChangePage`/`pageAvailability.available`）只取决于该 Page 当前是否仍被占用——`packages/managed-ads/src/service/meta-page-disconnect.ts` 的 `findMetaPageDependency` 只检查：是否被其他组织持有、是否有依赖它的进行中 campaign（`funding`/`account_binding`/`pending_internal_review`/`approved`/`creating`/`active`/`paused`，或失败但已建号的）、是否有未完成的 Lead Form operation、是否有近 1 小时内刚 notified 还没读完的 lead submission。**与该 Page 是自助绑定还是 BYO 导入完全无关**——不要把「BYO 的 Page 解绑规则不同」当成假设去设计 case 或写 Action。
- 解绑文案与行为（真实 UI 原文，disconnect Action/case 据此核对）：触发按钮 "Disconnect Page"；确认弹窗标题 "Disconnect Facebook Page?"，正文 "New campaigns stop using this Page. Your Facebook authorization, advertising accounts, and Hellyeah's access to the Page stay in place. Remove that access in Facebook if you no longer want it."；取消按钮 "Keep Page"；确认按钮 "Disconnect Page"。后端 `POST /api/v1/integrations/meta/page/disconnect` 只清组织自己的 `pageId`，**不撤销 Hellyeah 在 Meta 侧的授权**——这是有意设计（授权可能先于本次绑定存在，或被其他用途共用同一 Page），不要把它当成遗留 Bug。拒绝时返回 409，`E_META_PAGE_DISCONNECT_CHANGED`（Page 已变化，需刷新）或 `E_META_PAGE_DISCONNECT_IN_USE`（仍被占用）。
- **授权本身可以 mock，不必走真实 Meta OAuth**：真实弹窗/第三方 OAuth 是我们 DOM 之外的边界，可测的边界是「弹窗关闭后我们读取的那个 API 响应」。两条路径各自的 mock 点：
  - 自助：mock `GET /api/v1/integrations/meta/page/authorized-pages`，返回 `{ pages: [{ id, name }] }`（`MetaAuthorizedPages`/`MetaGrantedPages` 同构）。
  - BYO：mock `POST /api/proxy/api/admin/managed-ads/admin/organizations/${orgId}/meta-byo/resolve`，返回 `{ adAccounts, authorizedBy, connectionId, pages, providerConfigKey }`（见 `apps/admin/src/features/organizations/hooks/use-meta-byo-connect.ts` 的 `ByoMetaResolveResult`）。
  - 对应 Action：`mockMetaCustomerAuthorization`（自助）、`mockMetaByoAuthorization`（BYO），均只做本地 `page.route()` 拦截，不触碰任何真实后端状态，`rollback: read`。

## QA-1183：Page-required launch gate 的 campaign-type 覆盖缺口

- 之前的 mock 实验只验证了 Traffic/Awareness 两种 campaign type 对「必须先绑 Meta Page 才能 launch」这道新 gate 的行为，**没有覆盖 Google 下所有 campaign type、也没有覆盖 Meta 下所有 campaign type**——这是 case 设计覆盖率问题，不是功能本身的问题（2026-10-27 用户纠正）。Google 账户本身不受这道 gate 影响（gate 只约束需要 Meta Page 的流程），但仍需要把 Google 的每种 campaign type 和 Meta 的每种 campaign type 都各走一遍，确认 gate 只在该卡的类型需要 Page 时触发、不该触发时不要误挡。
- 同一批里还漏了一个 case：**Page 断开再重新连接**，因为 org、Page、Meta 账户三者是关联的，断开后必须验证能正常重新连接回去，而不仅仅验证断开本身。对应 Action 已沉淀：`openMetaPageDisconnectConfirmation` + `disconnectMetaPageOnce`（断开）+ 既有的 `openMetaPagePicker` → `selectMetaPage` → `bindSelectedMetaPage`（重新连接）。
- **2026-10-28 代码级核实（非浏览器执行）**：直接读 `apps/dashboard/src/features/campaigns/launch/page.tsx` 的 `metaPagePanelState()`——判断逻辑是 `platform !== "meta" || streaming ? "hidden" : (已绑 ? "bound" : "connect")`，**只看 `platform` 这一个轴，和 campaignType 本身无关**。所以这道 gate 的真实设计不是「按 campaign type 逐个判断」，而是「只按 platform=google/meta 二选一判断」——把它当成 N×M 矩阵来设计 case 本身就是过度覆盖；真正需要走查的是「每个 Google 子类型下 gate 确实不出现」和「每个 Meta 子类型下 gate 确实出现」这两类断言。**这一条本身仍然成立**，下面这条是对"怎么把每个子类型跑出来"这个前提的纠正。
- **2026-10-28 复核发现：上一条给出的"已有 Action 可直接复用"结论是错的，case 设计目前不可执行，是真实 GAP，不是已解决项**。逐条核实 `apps/dashboard/src/features/campaigns/launch/draft.tsx`：
  - Google：UI 的 `CampaignType` 类型本身只有 `"search" | "pmax"` 两个值（`draft.tsx:67`），**没有 "display" 这个可创建的类型**——`"display"` 只在旧数据/外部类型里出现（`screen.tsx:1349`、`packages/managed-ads/.../types.ts`），这个页面创建不出来。正常的 AI 起草流程里，`campaignType` 下拉是只读文本，由 `goalCategory` 单向推出（`draft.tsx:588`：`goalCategory === "traffic" ? "search" : "pmax"`），只有手动模式（`manual && !isMeta`）才会出现可选的 Select（`draft.tsx:1650-1673`）。也就是说 search/pmax 两种可以通过手动模式或构造 goalCategory 可靠地跑出来，但 "display" 这个值在这个页面完全不可达。
  - Meta：`draft.tsx:597` 强制 `campaignType: platform === "meta" ? null : googleCampaignType`——**Meta 场景下这个字段永远不会被填，UI 上看到的"Campaign type"那一行文案来自 agent/objective，不是用户可选项**（代码注释原文见 `draft.tsx:1646-1648, 1681-1682`）。`META_CAMPAIGN_TYPES`（manual/advantage_plus_sales/advantage_plus_app/advantage_plus_leads，`packages/shared/src/constants/managed-ads.ts:442-446`）是 Graph API 的 `advantage_state` 枚举，在 launch/draft.tsx 里找不到对应的用户可操作控件；`create-meta-campaign-draft.ts:483` 直接写死 `DEFAULT_CAMPAIGN_TYPE`，不是由某次用户交互决定的。
  - **结论**：「把 Google 每种类型、Meta 每种类型都走一遍」目前对 Meta 完全不可执行（没有触发特定 advantage_state 的手段），对 Google 只能覆盖 search/pmax、display 不可达。在拿到一个确定性的类型覆盖手段（后端 seed 接口、测试专用 override 开关，或者对 agent 分类结果做可控 mock）之前，不要再往这个方向新写"选中某个 Meta campaignType"的 Action——写了也调不出对应场景。
  - 已有 Action 仍然可以覆盖"至少一种 Google 类型 + 至少一种 Meta 场景"这个弱化版本：`submitCampaignGoal`/`chooseOnboardingObjective` → `readCampaignStrategySummary` 确认落到哪个 campaignType → 对 Meta 平台配合既有的 Page 面板可见性检查确认 gate 状态。这只验证了"gate 在当前唯一能达到的 Meta 场景下出现、在能达到的 Google 场景下不出现"，不是"每个子类型都验证过"。
  - **仍然诚实地标注**：以上是代码走读得出的结论，没有跑过浏览器；类型覆盖缺口需要先和用户/PM 确认是否存在类型 override 机制，再决定要不要为此新开发/新写 Action。
- **2026-10-30 用户指出一个被漏掉的入口，并纠正了我对"类型"这个词的范围误判**：launch 页面除了默认的"推荐"卡片（`LaunchPreviewCard`）外，还有一张 **"Create" 卡片**（`screen.tsx:626` `create = () => setCreating(true)`，切换展示 `CampaignTypesCard`，`types.tsx:522`，标题 "What should this campaign do?"）。点进去先选平台（`PlatformSegment`，`types.tsx:238-306`，Google/Meta 二选一，Meta 不可用时置灰），再选目标（`CAMPAIGN_TYPES`，`types.tsx:74-100`：Awareness / Traffic / Leads / Conversions / App installs，按平台过滤——Google 只有 Traffic/Conversions 对应的 search/pmax 两行，没有 Awareness/App installs）。这纠正了"没有入口可以指定目标/类型"的说法。
  - **范围纠偏**：我之前把 `META_CAMPAIGN_TYPES`（`manual`/`advantage_plus_sales`/`advantage_plus_app`/`advantage_plus_leads`，Graph API 的 `advantage_state` 枚举）当成需要覆盖的"类型"维度，并因为它在 UI 上不可选而判定是个 GAP。用户纠正：这个字段本来就不是业务上用户可选的"类型"，它是后端内部默认值（`create-meta-campaign-draft.ts:89/497` 写死为 `"manual"`），从来没打算让用户或测试去挑——不是一个遗漏的入口，是我自己把不相关的后端字段当成了测试维度。真正要测的"类型"，就是 Create 卡片里能点的那几个目标，Google 和 Meta 列表本身不同（Google: 对应 search/pmax 两种；Meta: Awareness/Traffic/Leads/Conversions/App installs 五种）。
  - **最终可执行的 case 矩阵**：对 Google 的 {search, pmax} 和 Meta 的 {Awareness, Traffic, Leads, Conversions, App installs} 各走一遍，用 Create 卡片选平台 → 选目标 → 走完 AI 起草流程（`screen.tsx:630-633` → `start()`），然后检查 Page-required gate 的可见性是否符合"Google 永远不出现、Meta 永远出现"（`metaPagePanelState()` 只看 `platform`，参见上面已确认的结论）。这个矩阵现在被认为是完整、可执行、无需等待任何额外机制的。`advantage_plus_*` 这个字段不再作为测试维度出现在这张票的 case 设计里。
  - **Google 的 {search, pmax} 并不对应全部 5 个目标**：按 `CAMPAIGN_METHODS`（`packages/shared/src/constants/campaign-methods.ts:98-174`，注释原文 "Google has no awareness or app campaign"），Google 在 Create 卡片里根本不出现 Awareness（`branding`）和 App installs（`apps`）这两张类型卡——不是置灰，是这两个 bucket 下压根没有 `platform: "google"` 的 method，`CampaignTypesCard` 的 `types` 过滤（`types.tsx:532-536`）会把它们整行滤掉。Google 实际能走的类型卡只有 Traffic（`google_search`）、Leads（`google_search` + `google_pmax`）、Conversions（`google_search` + `google_pmax`）三张；Meta 五张都有。写 case 矩阵时不要默认"Google {search,pmax} × 5 目标"，正确写法是按目标分别列出该平台有哪些方法，新写的 `observeCampaignCreateTypes` Action 可以直接读出当前平台下实际渲染了哪些 `data-type-header`，用它校验这一条而不是硬编码假设。
  - **2026-10-30 已沉淀 5 个 Action**（`hy_ui_autotest/src/actions/campaign-actions.ts`，已入 `action-catalog.json` 共 191 行，通过结构校验：`tests/unit/action-table.test.ts` 17/17、`tsc --noEmit` 干净；其余 vitest 单测里 7 个超时失败是既有的 CLI spawn 类用例，和本次改动无关，未受影响）：`openCampaignCreateCard`（点击 "Create" 磁贴，等 `[data-slot="launch-types"]` 可见）、`selectCampaignCreatePlatform`（在 `role="group" aria-label="Platform"` 内点 `[data-platform="google"|"meta"]`，Meta 不可用时读 `aria-disabled` 而不是盲点）、`observeCampaignCreateTypes`（读当前平台下所有 `[data-type-header]`，验证上面一条"Google 少两张卡"的断言）、`chooseCampaignCreateType`（点类型卡头；单 method 类型直接起草，整张 Create 卡片会卸载，多 method 类型展开折叠，二者互斥，用 `expect.poll` 等其中一种发生）、`chooseCampaignCreateMethod`（展开折叠后点具体 method 行，`data-method` 对应 `campaign-methods.ts` 里的 id）。`chooseCampaignCreateType`/`chooseCampaignCreateMethod` 定级为 `irreversible`（会创建持久草稿并启动一次 Agent 生成，与既有的 `submitCampaignGoalFromChip` 同级，catalog 里不写 `undoneBy`，只写 `undoNote`）；其余三个是 `read`。

## QA-1173：Studio 创意上传与跨平台素材库

- 客户自传素材的入口是 Studio 的 "Upload your own" 流程：`apps/dashboard/src/features/studio/upload.tsx`（上传/裁剪/校验）+ `upload-review.tsx`（文案审核/编辑/保存），路由 `/studio/upload`，提交接口 `POST /api/v1/creative/sets/imports`。这与 admin 侧 `apps/admin/src/features/creative-library/**` 的「参考图上传」是两个完全不同的功能（后者给 AI 生成提供参考图，不是客户自传广告素材），写 case/Action 前要先分清楚问的是哪一个。
- **这个页面没有 `data-slot`/`data-testid`**，只有 `aria-label`；现有单测（`upload-interaction.test.ts`）也是用 `container.querySelector('input[aria-label="..."]')` 这种方式选取元素，不是 Testing-Library 的 role/label 查询。新写的 Action 应沿用 `aria-label` 选择器（如 `Upload landscape image`、`Upload square image`、`Replace image`、`Remove ${format} image` 等），不要凭空假设有 `data-slot` 容器。
- **跨平台素材复用 = 同一套组件，不是分别实现**：`apps/dashboard/src/features/campaigns/launch/creatives.tsx` 的 `SetLibrary`（代码注释自证："the picker is the Studio library: the same create tile and cards"）被 `SearchPicker`（Google Search，确认按钮 "Use Ad"）和 `PmaxPicker`（Google PMax **以及** Meta，通过 `strategy.platform` 区分，没有单独的 MetaPicker）共用，背后统一依赖 `apps/dashboard/src/features/campaigns/launch/sets.ts` 的 `CreativeSet`/`getCreativeSets()`。验证「上传的素材能否被 Google Search 和 Meta 广告使用」时，测的是同一个 `SetLibrary`/`SetCard` 在 `campaignType="search"` 与 `campaignType="pmax"`（含 `strategy.platform="meta"`）两种挂载下是否都能正确选中同一个已上传的 CreativeSet，而不是去找两套互相独立的选择器。
- **素材库管理（删除/取消生成）**：入口不在卡片上，而在「打开这条素材后自己的页面」里（`apps/dashboard/src/features/studio/review.tsx` 的 `SetActions`，代码注释原文："Destructive actions live on the set's own page, not on library cards"）。按钮文案随状态变化：生成中显示 "Cancel Generation"（确认弹窗标题 "Cancel Ad Generation?"），生成完成后显示 "Delete Ad"（确认弹窗标题 "Delete Ad?"，正文 "Are you sure? This removes the ad everywhere, including campaign ad pickers. This action can't be undone."）。触发入口是 `aria-label="Ad Actions"` 的下拉菜单按钮。
- **上传失败文案**（`upload.tsx` 内联校验，`role="alert"` 展示）：类型错误 "Choose a PNG or JPEG image."；超过 20MB "Choose an image smaller than 20 MB."（注意这是"Upload your own"两图流程自己的 20MB 上限，和 Studio 单图导入流程的 25MB 上限/`CREATIVE_IMAGE_TOO_LARGE_MESSAGE` 是两套不同常量，不要混用）；文件无法打开 "This image could not be opened. Try another PNG or JPEG."；保存失败兜底 "Could not save the ad set. Try again."。文案审核页（`upload-review.tsx`）另有一套：加载失败 "We could not load your copy. Try loading it again."、保存失败 "Could not save your copy. Try again."、单平台文案生成失败 "Copy could not be prepared. Retry, or go back to change your images."（若后端带了具体 `errorMessage` 会优先展示该信息，不是固定文案）。
- **headline 在上传流程中可以填/改，且 Google 和 Meta 的字数要求不同、不是同一套规则**（`upload-review.tsx` + `packages/shared/src/specs/creative.ts`）：Google headline 上限 **30**、description/long headline 上限 **90**，且 Google 用 `googleAdsTextLength()` 计数——中日韩/全角字符按 **2** 个字符算，不是简单 `.length`；Meta headline 的 UI 软上限是 **27**（Graph API 硬上限 255，但产品只暴露软上限）、primary text 软上限 **125**（硬上限 2200）。超限时 Save 按钮直接禁用，并出现对应平台的提示 banner（Google："Shorten Google headlines to 30 characters and descriptions and long headlines to 90 before saving. Full-width characters count as two."；Meta："Shorten Meta headlines to 27 characters and primary text to 125 characters before saving."）。写字数校验 case/Action 时必须按平台分别断言，不能共用一个 30/90 或一个 27/125 的阈值。
- **2026-10-28 已沉淀 13 个 Action**（`hy_ui_autotest/src/actions/studio-creative-actions.ts`，已入 `action-catalog.json` 并通过结构校验：82/82 vitest 文件、539/539 测试、`tsc --noEmit` 干净、186/186 Action-catalog 命中）：`uploadCreativeImage`/`readCreativeUploadError`/`saveCreativeUploadOnce`（上传两图并保存，命中 `POST /api/v1/creative/sets/imports`）、`fillCreativeCopyField`/`readCreativeCopyCounter`/`readCreativeCopyLimitBanner`/`saveCreativeCopyOnce`/`retryCreativeCopyOnce`（文案填写、读计数器、读超限 banner、保存、重试，字段选择器用 `${platform}-${group}-${index}` 这个确定性 id，不是 aria-label）、`selectCreativeSetInLibrary`/`confirmCreativeSetSelection`（跨平台素材库选中，同一组 Action 覆盖 Google Search 和 Meta，因为两者共用同一个 `SetLibrary`/`SetCard`）、`openCreativeSetActionsMenu`/`openCreativeSetDeleteConfirmation`/`deleteCreativeSetOnce`（素材集删除/取消生成，命中 `DELETE /api/v1/creative/sets/{id}`，已确认该路由真实存在，不是沿用背景调研 agent 未核实的猜测）。`saveCreativeUploadOnce`/`saveCreativeCopyOnce` 是 irreversible，catalog 里**不**写 `undoneBy`（只有 reversible 行才允许），改用 `undoNote` 说明只能靠 `deleteCreativeSetOnce` 整体删除来清理。
- **2026-10-28 复核发现并修复两个"结构校验通过但真执行会卡住"的问题**：(1) `tests/fixtures/studio/sample-upload.png` 是一张 8×8、74 字节的占位图，远低于 `upload.tsx` 的真实最小尺寸要求（Google landscape 600×314、Meta portrait 600×750、square 300×300/600×600）——`uploadReadiness()` 会把它判成 `"low_resolution"`，`uploadCreativeImage` 用这张图根本跑不完整个"Save images"流程；已另外生成三张满足两平台最小尺寸的真实占位图（`sample-landscape.png` 600×750、`sample-portrait.png` 600×750、`sample-square.png` 600×600，取两平台较大值保证通用），原 `sample-upload.png` 不动（素材库参考图上传等其他用例仍在用它，只按文件名断言，不受尺寸影响）。(2) `upload.tsx` 里同一个槽位有两种 input：未选图时 `aria-label="Upload ${slot} image"`，选图之后换成 `aria-label="Replace ${slot} image"`——`uploadCreativeImage` 原先只匹配 `^Upload ...`，对已经有图的槽位重新上传会找不到元素；已改成 `^(?:Upload|Replace) ${slot} image$`。两处都已重新跑过 `pnpm vitest run tests/unit`（82/82）+ `tsc --noEmit`（干净）确认没有破坏既有测试。

## QA-1185：ticket 口径纠偏（核心应测成功率与耗时，不是 logo 有无）

- 2026-10-27 用户明确纠正：QA-1185 这张票本身写得不够准确，**真正要测的核心是「创意生成成功率 ≥ 90%」和「生成耗时不超过 10 分钟」**；logo 带不带都算正常结果，不应该把"有没有 logo"当作判断生成是否成功的标准。
- **logo 有无本身是系统自动质量兜底的正常产物，不是 bug 信号**：`packages/creative-engine` 的 logo-safety 管线（`logo-safety-agent.ts` + `logo-safety.ts`）会在生成后用视觉模型给 logo 打分，如果 logo 渲染错误（文字/拼写/颜色/位置等任一不对）会触发 `regenerateWithoutLogo` 重新生成一版**不带 logo**的图，再用 `expectLogoOmission: true` 校验「确实干净地没有 logo」。也就是说一次「成功」的生成结果完全可能最终没有 logo——这是管线按设计工作，不是失败，QA-1185 的成功率统计不应该因为某次生成结果没 logo 就判它失败。
- **「10 分钟」门槛需要和 PM/用户对齐具体对应哪个系统常量，不要直接套用**：代码里没有统一的 10 分钟生成超时。`apps/api/src/modules/creative/recovery.ts` 里 `generate` 操作（即「生成」本身）的超时是 **`CREATIVE_JOB_STALE_AFTER_MS = 20 分钟`**；10 分钟（`CREATIVE_EDIT_STALE_AFTER_MS`）对应的是 `edit` 操作（编辑器内二次修图），不是初次生成。视频生成另有 90/130 分钟的窗口。用户说的「生成不超过 10 分钟」字面上和系统的 20 分钟 generate 超时不一致——这个差异需要在写断言前和用户/PM 确认清楚，到底是把 10 分钟当作一个比系统超时更严格的性能基线去测（允许提前判定"慢"但不算超时失败），还是这张票的 10 分钟本身就是对 edit 场景的描述；在未确认前，不要把 10 分钟直接当作生成失败的判定阈值写进 Action。
- **2026-10-28 已沉淀 2 个 Action**（同一个文件，已入 catalog 并通过结构校验）：`pollCreativeSetGenerationOutcome`（对单个 `creativeSetId` 轮询 `GET /api/v1/creative/sets/{id}` 直到 `status` 落在 `complete`/`partial`/`failed` 终态或超时，返回实际耗时 `elapsedMs`）、`measureCreativeGenerationSuccessRate`（批量跑多个 creativeSetId，统计 `complete`+`partial` 占比为 successRate，不看 logo 维度）。**`timeoutMs` 是必传参数、故意不给 10 分钟默认值**——因为上面"10 分钟 vs 20 分钟"的口径分歧还没和用户/PM 对齐，写死任一个数字都可能是错的；调用方必须显式传入，等澄清后再把结论固化成默认值或断言阈值。`partial` 状态目前算作"非失败"，但如果以后用户要更严格的"只有 complete 才算成功"，应从 Action 返回的 `outcomes` 数组里按 `finalStatus === "complete"` 重新计算，不需要改 Action 本身。

## 必测检查点

- Meta Page disconnect/reconnect：断开后立即校验入口回到 "Choose Page / Connect Facebook Page"（未绑定态），再用 `openMetaPagePicker → selectMetaPage → bindSelectedMetaPage` 重新绑回；若 Page 仍被进行中 campaign/Lead 占用，核对确认弹窗不可操作或后端返回 409 `E_META_PAGE_DISCONNECT_IN_USE`，不要把它当成 Bug。
- Agent Search draft coherence：修改 location、objective、landing page 或 language 后，联合检查 keywords、CPC、click estimate、likely spend、pricing curve 和 campaign description，不能只验证关键词重新生成。
- 创建。
- draft/pendingAdminReview/active/paused/canceled 等状态。
- ops review / Admin approve：人工审核广告生成质量和安规后才可真实 launch。
- Creative Sets launch review gate：review 前必须检查素材选择、导入/替换、后台生成状态、通知、review 入口和失败恢复。<!-- STALE 2026-09-20: 删除「HEL-1332 / HEL-1331 未正式提测前不按当前待测工单处理」，属一次性排期信息。 -->
- active 后 pause/resume/cancel。
- payment/refund 关联状态。
- creative 和 event 链路。
- campaign 类型与预算口径：可创建类型只有 Search 和 PMax。统一按总预算验证，并检查派生日额是否满足下限；核对 Dashboard 展示、Admin 展示和 Google Ads 侧预算三处一致。
- PMax readiness：显式检查 1:1 PNG brand logo；不要把 `doctor` 普通通过当作 PMax 可 launch，最终以 PMax dry-run / launch gate 为准。
- PMax launch payload：keyword 不应进入 dry-run echo 或 stored draft；age/gender demographics 应按 campaign-level negative-complement exclusions 检查，不再期望被 strip。
- 关键词四类覆盖：brand / competition / general / negative 逐类检查，按语义归类，缺类判质量 Bug。
- PMax location：显式传入 location 时应保留/推送；不传 location 时应按默认 `Worldwide` 处理，不应回退到 ad account creator/default location 或具体区域。
- PMax asset handling：至少覆盖 brand logo 与 marketing image 相同内容的去重风险，避免 Google duplicate asset mutate rejection。
- failed/orphan draft cleanup：验证 Dashboard 上的 discard / 清理入口、next-step 提示、wallet debit 与 `activeReservedCents`。<!-- REVIEW 2026-09-20: 原文用 CLI 命令 `hellyeah campaign discard`。Dashboard 上对应的清理入口叫什么，待确认。 -->

## AI 可独立覆盖

- User Dashboard 上的 campaign 创建与状态查询，配合只读 API 交叉核验。
- sandbox 上可重复的核心链路回归。

## AI+人工轻量协作覆盖

- Admin approve。
- Stripe checkout。
- 后台事件确认。
- 用户确认 ops review 是否通过及审核意见，AI 继续验证 approve 后状态和投放链路。
- 用户在 Admin / Dashboard 确认 Creative Sets review 入口、素材状态和通知展示，AI 继续用 CLI/API 验证 campaign 状态与 creative 关联。

## 不适合自动化的部分

- 强依赖第三方后台权限且无稳定接口的场景。

## 自动化沉淀建议

- campaign 创建到 pendingAdminReview。
- Creative Sets 作为 launch review 前置门的 smoke：creative set 选择、替换、generation status、notification、review 入口。
- approve 后 active 状态检查。
- active pause/resume/cancel。
- 总预算 + 派生日额下限的边界断言（刚好达标 / 差一分）。
- PMax payload 字段断言：keyword 剥离、demographics negative-complement exclusions。
- PMax location 字段断言：明确地域保留/推送；无地域默认 `Worldwide`。
- PMax duplicate image asset regression。
- failed/orphan draft discard path。

## 已过期/慎用经验

- 已被后续 Hellyeah 版本推翻的 campaign 判断放入本区。
- “daily budget 已废弃”是错误口径；正确口径是 PMax 不看 daily budget、看 total budget，非 PMax 仍保留 daily budget 相关语义。
- “PMax 会 strip age/gender demographics / Google 会拒绝 demographics”是错误口径；正确口径是 PMax 支持 campaign-level age/gender negative-complement exclusions。
- “doctor 全绿但 PMax dry-run 因缺 1:1 PNG logo 失败就是 doctor Bug”是错误口径；正确口径是 doctor pass 不等于 PMax launch-ready。
- “PMax without `--location` should be rejected”是错误口径；正确口径是 location 建议但不强制，不传默认 `Worldwide`。
