---
id: hellyeah.meta-campaign
type: module
product: hellyeah
surfaces: [customer-dashboard, admin-dashboard, api, meta]
status: draft
version: 1
last_reviewed: 2026-09-20
related_modules: [hellyeah.campaign-launch, hellyeah.ad-account, hellyeah.campaign-composer, hellyeah.admin-review]
---

# Meta Campaign（Meta 平台专属配置）

## 业务目标与边界

Meta 投放的配置模型与 Google **完全不同**，且审核流程多一道人工环节。本模块承载 Meta 独有的枚举、配置约束、合规红线和两阶段审核。

Google 与 Meta 共享的部分（提交、扣款、退款、生命周期）见 [campaign-launch](campaign-launch.md) 与 [campaign-lifecycle](campaign-lifecycle.md)；账户开户与分配见 [ad-account](ad-account.md)。

> ⚠️ **代码有一条强约束（D1）**：Meta campaign 的字段**绝不能用 Google 的枚举校验**，反之亦然。原文：
> *"Deliberately per-platform and NOT merged with Google's campaign-type values: a Meta campaign type must never validate against the Google enum, and vice-versa."*
> 这条是本模块最重要的测试面——跨平台枚举串用是设计上明确禁止的。

## Ticket 路由信号

`Meta`、`Facebook`、`Instagram`、`advantage_plus_sales`、`advantage_plus_leads`、`advantage_plus_app`、`advantage_state`、`OUTCOME_*`、`objective`、`ad set`、`adset`、`optimization goal`、`billing event`、`bid strategy`、`bid cap`、`COST_CAP`、`destination type`、`special ad category`、`publisher platform`、`placement`、`account_binding`、`Business Portfolio`、`BP`、`system user`，以及 Meta adapter / Graph API 相关改动。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| META-S01 | `hellyeah-v2` `packages/shared/src/constants/managed-ads.ts` — 适用:全部 Meta 枚举及注释中的 v0 约束 | observation | current, read 2026-09-20 (staging) |
| META-S02 | `sources/hellyeah/product-memory.md` — 适用:Meta 审核需先人工绑号 | user-confirmed | current, 2026-09-20 确认 |

> `business_file/` 无 Meta 文档，事实来自代码，断言为 `draft`。
> 代码注释中的 `D1` / `D9` 等标记指向某份设计决策文档，**该文档不在工作目录中**，需要时向研发索取。

## 配置模型

Meta 的配置分**两层**：campaign 层和 ad set 层。这是与 Google 最大的结构差异。

### Campaign 层

| 字段 | 取值 | 说明 |
|---|---|---|
| `campaignType` | `manual` · `advantage_plus_sales` · `advantage_plus_app` · `advantage_plus_leads` | **Advantage+ 模式**，从 `advantage_state` 读回（v25 unified）。`manual` = 不启用 Advantage+ 自动化。**与 objective 正交** |
| `objective` | `OUTCOME_TRAFFIC` · `OUTCOME_SALES` · `OUTCOME_LEADS` · `OUTCOME_ENGAGEMENT` · `OUTCOME_AWARENESS` · `OUTCOME_APP_PROMOTION` | ⚠️ **v0 只投 `OUTCOME_TRAFFIC`**。其余值枚举完整但对应的 pixel/转化链路**尚未实现**（D9） |
| `special_ad_categories` | `NONE` · `EMPLOYMENT` · `HOUSING` · `CREDIT` · `ISSUES_ELECTIONS_POLITICS` | **合规红线**，v0 默认 `["NONE"]`。配对的 `special_ad_category_country` **有意未实现**（D9） |

### Ad Set 层

| 字段 | 取值 | 说明 |
|---|---|---|
| `optimization_goal` | `LINK_CLICKS` · `OFFSITE_CONVERSIONS` · `LANDING_PAGE_VIEWS` · `REACH` · `IMPRESSIONS` · `THRUPLAY` | |
| `billing_event` | `IMPRESSIONS` · `LINK_CLICKS` · `THRUPLAY` | |
| `bid_strategy` | `LOWEST_COST_WITHOUT_CAP` · `LOWEST_COST_WITH_BID_CAP` · `COST_CAP` · `LOWEST_COST_WITH_MIN_ROAS` | ⚠️ **`bidAmount` 仅在带 cap 的策略下必填** |
| `destination_type` | `WEBSITE` · `APP` · `MESSENGER` · `INSTAGRAM_DIRECT` | v0 只投 `WEBSITE` |
| `publisher_platforms` | `facebook` · `instagram` · `messenger` · `audience_network` | 版位 |

### 广告审核状态（平台侧）

```
APPROVED · APPROVED_LIMITED · AREA_OF_INTEREST_ONLY · DISAPPROVED · UNKNOWN
```

⚠️ `APPROVED_LIMITED` 和 `AREA_OF_INTEREST_ONLY` **不是完全通过**——投放范围被平台限制了。把它们当作 `APPROVED` 会高估实际投放能力。

## 两阶段人工审核

Meta 比 Google 多一道人工环节，代码注释解释了原因：

> *"Binding an ad account and reviewing the ad content are two people's jobs, so they are two states."*

```
draft → funding → account_binding → pending_internal_review → approved → creating → active
                  └─ 人工绑号 ──┘   └─ 人工审内容 ──────┘
```

- **`account_binding`**：客户没有已绑定的 Meta 广告账户时停在这里，等 admin **人工绑号**。已有绑定账户的直接跳到内容审核。
- **`pending_internal_review`**：审广告内容。

⚠️ **这两个状态在客户侧都显示为 "pending"，看不出区别。**代码注释：*"Invisible to the customer: which of our people is holding the request is our business."*

测试要区分，**必须从 Admin 侧或只读 API 读实际状态**，不能只看客户侧文案。

## 前置条件

- 明确本轮测的是 Meta 而不是 Google——两边字段校验完全独立。
- 已知客户是否有已绑定的 Meta 广告账户（决定会不会进 `account_binding`）。
- Meta Business Portfolio 连接正常（见 [ad-account](ad-account.md)）。
- 涉及 `special_ad_categories` 时确认测试授权——**投错分类会导致账户被封**。

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| META-ACT-001 | 读取 Meta campaign 配置 | draft 存在 | 返回 campaign 层 + ad set 层全部字段 | read | 刷新；仍缺则查 API |
| META-ACT-002 | 提交 Meta campaign | readiness 满足 | 无绑定账户 → `account_binding`；有则 → `pending_internal_review` | financial side effect | 超时只读核验，禁止重发 |
| META-ACT-003 | 人工绑定广告账户 | 处于 `account_binding`，授权明确 | 进入 `pending_internal_review` | high impact | `UserLed`；核验状态传播 |
| META-ACT-004 | 核验平台侧审核状态 | 已到平台 | 返回 `AD_APPROVAL_STATUSES` 之一 | read | 平台不可访问时 Blocked |
| META-ACT-005 | 核验跨平台枚举隔离 | 有 Google 和 Meta 各一个 draft | Meta 字段拒绝 Google 值，反之亦然 | read | — |

## Facts

| ID | Meaning | Source | Shape | Freshness |
|---|---|---|---|---|
| META-FACT-CAMPAIGN | campaign 层配置 | UI/API | `{campaignType, objective, specialAdCategories[]}` | 编辑后 |
| META-FACT-ADSET | ad set 层配置 | UI/API | `{optimizationGoal, billingEvent, bidStrategy, bidAmount?, destinationType, publisherPlatforms[]}` | 编辑后 |
| META-FACT-STAGE | 两阶段审核当前位置 | Admin/API | `{status, boundAccountRef?}` | 每次状态动作后 |
| META-FACT-APPROVAL | 平台侧审核结果 | Meta/后台 | `{adApprovalStatus, limitedReason?}` | 平台审核后 |
| META-FACT-CUSTOMER-VIEW | 客户侧看到的状态文案 | Dashboard | `{displayedStatus}` | 每次导航后 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| META-001 | negative | Meta campaign 字段校验 | **拒绝 Google 的枚举值**（如 `search` / `pmax` 作为 campaignType） | API | 拒绝响应 | 产品明确合并了枚举 |
| META-002 | negative | Google campaign 字段校验 | **拒绝 Meta 的枚举值**（如 `advantage_plus_sales`） | API | 拒绝响应 | 同上 |
| META-003 | exact | 使用带 cap 的 bid strategy | `LOWEST_COST_WITH_BID_CAP` / `COST_CAP` / `LOWEST_COST_WITH_MIN_ROAS` 必须带 `bidAmount`；缺失应被拒 | UI + API | 提交 payload、拒绝原因 | `LOWEST_COST_WITHOUT_CAP`（不需要） |
| META-004 | negative | v0 范围外的 objective | 选择 `OUTCOME_SALES` / `OUTCOME_LEADS` / `OUTCOME_APP_PROMOTION` 时，**不应静默成功**——对应的转化链路未实现 | UI + API | 提交结果、实际下发值 | ticket 明确扩展了 objective 支持 |
| META-005 | exact | `special_ad_categories` | v0 默认为 `["NONE"]`；选择受限类别时的行为需明确（拒绝或要求补充国家） | UI + API | 提交值、下发值 | ticket 明确实现了受限类别 |
| META-006 | state_transition | 客户无已绑定账户时提交 | 停在 `account_binding` 等人工绑号；绑定后才进 `pending_internal_review` | Admin + campaign | 状态序列、绑定前后账户事实 | 客户已有绑定账户 |
| META-007 | negative | 处于 Meta 两阶段中 | 客户侧 `account_binding` 与 `pending_internal_review` **均显示为 pending**，不暴露内部分工；但只读事实必须能区分 | UI + API | UI 文案截图 + 只读状态 | 产品改为对客户展示细分状态 |
| META-008 | negative | 平台返回 `APPROVED_LIMITED` 或 `AREA_OF_INTEREST_ONLY` | **不得当作完全通过**；投放范围受限应可见 | 平台 + UI | 平台状态、客户侧展示 | 产品明确将受限视为通过 |
| META-009 | exact | ad set 配置下发 | UI/draft 中的 optimization goal、billing event、destination、publisher platforms 与实际下发到 Meta 的值一致 | API + 平台 | 两侧字段对照 | 平台传播窗口内 |
| META-010 | exact | campaignType 与 objective | 两者**正交**，`manual` 不限制 objective 取值，Advantage+ 模式不隐式改写 objective | API | 两字段组合 | 产品引入联动规则 |

## 副作用与恢复

`META-ACT-003`（人工绑定广告账户）改变真实的账户归属，属高影响动作，需明确授权。

提交 Meta campaign 会产生资金副作用并在平台创建资源，规则与 Google 相同（见 [campaign-launch](campaign-launch.md)）。

⚠️ **`special_ad_categories` 配错可能导致广告账户被平台封禁**，这是**不可逆的外部后果**。测试受限类别前必须取得明确授权，并优先使用只读校验（提交被拒即可证明校验生效），**不要为了验证而真的投出去**。

## Bug 判断知识

### 高置信 Bug

- Meta 字段接受了 Google 的枚举值，或反之（违反 D1 硬约束）。
- 带 cap 的 bid strategy 缺 `bidAmount` 却提交成功。
- `APPROVED_LIMITED` / `AREA_OF_INTEREST_ONLY` 被当作完全通过，客户侧显示为正常投放。
- 客户侧暴露了 `account_binding` 与 `pending_internal_review` 的内部区别（违反设计）。
- 只读事实**无法**区分这两个状态（测试和运维都会失去可观测性）。
- UI 中的 ad set 配置与实际下发到 Meta 的值不一致。
- 客户已有绑定账户却仍停在 `account_binding`。

### 风险或待确认

- v0 范围外的 objective 被选中后的正确行为（拒绝？降级？静默接受？）—— 需产品确认。
- `special_ad_categories` 选择受限类别时的期望行为 —— 配对的国家字段未实现，行为不明。
- `D1` / `D9` 引用的设计文档不在工作目录，部分约束只能从代码注释推断。

### 不能直接判 Bug

- Meta 提交停在 `account_binding` —— 设计内的人工环节。
- 客户侧两个 pending 状态看不出区别 —— 刻意设计。
- v0 只支持 `OUTCOME_TRAFFIC` 和 `WEBSITE` —— 当前范围，不是缺陷。
- 测试环境下 Meta 侧不产生真实投放数据。

## 已知缺口

- `business_file/` 无 Meta 文档，全部来自代码。
- `D1` / `D9` 设计决策文档缺失，v0 范围的确切边界需向研发确认。
- Meta 的 creative 规格（图片尺寸、文案长度）未建模——`creative-studio` 模块目前只覆盖 Google 的 `PLATFORM_SPECS`。
- Meta 侧的转化回传（CAPI）与 X-Ray 的关系未建模，见 `xray-gtm-conversion` 的已知缺口。
- Meta System User 角色（`admin` / `employee`，HEL-1386）对绑号能力的影响未验证。
- 尚未通过真实 ticket 试跑验证任何断言。

## 模型回流

升级到 `pilot` 需要：一次完整的 Meta 提交 → `account_binding` → 绑号 → 内容审核 → 激活链路证据，以及一次跨平台枚举隔离的实测。

不得写入模块：真实 Meta 账户 ID、BP 标识、System User token。
