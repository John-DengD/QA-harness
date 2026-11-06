---
id: hellyeah.xray-gtm-conversion
product: hellyeah
surfaces: [customer-dashboard, google-tag-manager, tracked-website, google-ads, postbacks]
status: draft
version: 1
last_reviewed: 2026-09-20
related_modules: [hellyeah.tracking-xray, hellyeah.campaign-launch, hellyeah.campaign-lifecycle]
agent_testable: false
---

# X-Ray GTM 安装与转化回传

## 业务目标与边界

用户通过授权 Google Tag Manager 容器，让 Hellyeah 代为安装 X-Ray tracker，并让站点的转化事件最终回传到 Google Ads，形成投放效果闭环。

模块覆盖三段链路：GTM 容器连接与发布、`cv_*` 转化事件的产生方式、Google Ads conversion action 的自动创建与 postback 回传。

不覆盖：X-Ray 事件采集与查询本身（见 [tracking-xray](tracking-xray.md)）、Meta/TikTok 等非 Google 渠道、SSOT 报表口径。

**本模块默认不在 agent 自动化测试范围内**（见「测试可行性」）。它的首要用途是解释现象和排除误判，而不是作为 Browser 执行目标。

## Ticket 路由信号

`GTM`、`Tag Manager`、`container`、`gtm connection`、`publish tag`、`Hellyeah X-Ray tag`、`conversion action`、`postback`、`cv_registration_complete`、`cv_purchase`、`primary conversion event`、`conversion goal`，以及 `apps/api/src/modules/integrations/gtm/*`、`apps/api/src/inngest/gtm/*`、`apps/dashboard/src/features/tracker/gtm/*`、`packages/postbacks/src/google/*` 下的改动。

## 来源

| Ref | Source | Role | Applies to | Status |
|---|---|---|---|---|
| GTMCV-SRC-001 | `hellyeah-v2` `apps/api/src/inngest/gtm/contract.ts`、`publish.ts` | observation | GTM 实体命名与发布流程 | current, read 2026-09-20 (staging) |
| GTMCV-SRC-002 | `hellyeah-v2` `packages/shared/src/gtm`（`buildGtmCustomHtmlSnippet`） | observation | 注入的 tag 内容 | current, read 2026-09-20 (staging) |
| GTMCV-SRC-003 | `hellyeah-v2` `apps/dashboard/src/features/tracker/gtm/connect-state.ts`、`apps/api/src/modules/integrations/gtm/model.ts` | observation | 连接状态与错误分类 | current, read 2026-09-20 (staging) |
| GTMCV-SRC-004 | `hellyeah-v2` `packages/postbacks/src/google/resolver.ts` | observation | 13 个转化事件与 Google action 命名 | current, read 2026-09-20 (staging) |
| GTMCV-SRC-005 | `hellyeah-v2` `packages/shared/src/constants/managed-ads.ts` | observation | campaign primary conversion event 与 goal 映射 | current, read 2026-09-20 (staging) |
| GTMCV-SRC-006 | `sources/hellyeah/business_file/xray/event-model.md` | observation | 事件命名分层与推断引擎 | synced 2026-08-05；**无 GTM 内容** |
| GTMCV-SRC-007 | `sources/hellyeah/business_file/xray/ssot-integration.md` | observation | postback 就绪条件与 click ID | synced 2026-08-05 |
| GTMCV-SRC-008 | `sources/rulings/2026-09-gtm-slack-dev-confirmation.md` (研发口头确认（Slack，2026-09）) | user-confirmed | GTM 模板只加载 tracker；转化需另建 tag；conversion action 首次 postback 自动创建；campaign 必须从 Hellyeah 发起 | current；待补书面业务文档 |

> `business_file/` 中目前完全没有 GTM 相关文档，本模块的 GTM 事实主要来自代码与研发确认。产品侧补齐正式文档后需要回查并升级 Status。

## 状态模型

### GTM 连接

`not_connected → pending → active`，异常进入 `error` 或 `revoked`。

- `not_connected`：组织尚未授权 GTM 容器。
- `pending`：已授权，tag 尚未成功发布。
- `active`：workspace / trigger / tag / version 已发布成功。
- `error`：发布或连接失败，带 `errorKind`。
- `revoked`：用户在 Google 侧撤销授权。

`errorKind` 取值：`channel_not_permitted`、`compiler_error`、`connection_not_found`、`connection_not_owned`、`container_permission`、`disconnect_failed`、`provider_unavailable`、`publish_conflict`、`publish_failed`、`quota_exhausted`、`revoked_grant`。

UI 可用命令随状态变化：`connect`、`disconnect`、`load_containers`、`reconnect`、`retry_connect`、`retry_containers`、`retry_publish`、`retry_status`、`show_manual_setup`。

### 转化回传

`cv_* 事件产生 → 带 click ID 或 hashed PII → postback 扫描 → Google Ads conversion action（首次自动创建）→ 上报`。

## Hellyeah 在用户 GTM 容器里创建什么

发布成功后，用户容器中出现三个固定命名的实体：

| 实体 | 名称 | 说明 |
|---|---|---|
| Workspace | `Hellyeah` | Hellyeah 专用工作区 |
| Trigger | `Hellyeah - All Pages` | pageview 触发器 |
| Tag | `Hellyeah X-Ray` | Custom HTML tag，挂在上面的 trigger 上 |

Tag 的内容只做一件事——把 tracker 脚本插入页面：

```html
<script>
  var s = document.createElement('script');
  s.src = '<hostUrl>/script.js';
  s.async = false;
  s.dataset.websiteId = '<websiteId>';
  s.dataset.hostUrl = '<hostUrl>';
  s.dataset.tag = 'gtm';
  document.head.appendChild(s);
</script>
```

发布流程为：找/建 workspace → 找/建 trigger → 找/建 tag → 创建 container version → publish。任一步 compiler error、merge conflict 或 sync error 都会让连接进入 `error`。

## 转化事件如何产生

**这是最容易误解的一段。** `Hellyeah X-Ray` tag 只加载 tracker，**它不会、也不能发出转化事件**。转化事件有两条来源，都在前端：

### 1. 自动推断（尽力而为）

tracker autocapture 采集无前缀原始信号（`click`、`outbound_click`、`form_submit`），服务端推断引擎按规则写回 `cv_*`，每条带 deterministic `hy_event_id` 防重复：

| 原始信号 | 推断结果 | 条件 |
|---|---|---|
| `form_submit` | `cv_lead_submit` | 表单含 email 字段，action URL 匹配 lead 模式 |
| `form_submit` | `cv_registration_complete` | 表单含 password 字段，action URL 匹配 auth 模式 |
| 带 revenue 的自定义事件 | `cv_purchase` | `revenue > 0` 且 `currency` 已设置 |
| `click` 命中购物车元素 | `cv_add_to_cart` | 元素匹配 cart 选择器 |
| `click` 命中结算元素 | `cv_begin_checkout` | 元素匹配 checkout 选择器 |

条件不命中就不会自动产生转化。这是**设计如此，不是 Bug**。

### 2. 手动埋点（确定性，推荐）

在用户自己的 GTM 容器里**另建一个 Custom HTML tag**，挂在业务转化触发器上：

```js
window._hy.push(["track", "cv_registration_complete"])
```

不需要任何后端接口。等价的浏览器调用是 `window.hellyeah?.track("cv_registration_complete")`。

**事件名必须取自 13 个白名单之一**，否则不会被计为转化：

| 事件名 | Google Ads conversion action 名称 |
|---|---|
| `cv_add_payment_info` | `Hellyeah - Payment Info` |
| `cv_add_to_cart` | `Hellyeah - Add to Cart` |
| `cv_begin_checkout` | `Hellyeah - Checkout` |
| `cv_book_appointment` | `Hellyeah - Appointment` |
| `cv_contact` | `Hellyeah - Contact` |
| `cv_lead_submit` | `Hellyeah - Lead` |
| `cv_purchase` | `Hellyeah - Purchase` |
| `cv_registration_complete` | `Hellyeah - Registration` |
| `cv_search` | `Hellyeah - Search` |
| `cv_start_trial` | `Hellyeah - Trial Start` |
| `cv_submit_application` | `Hellyeah - Application` |
| `cv_subscribe` | `Hellyeah - Subscription` |
| `cv_view_content` | `Hellyeah - Page View` |

`sign_up`、`signup`、`purchase` 等非白名单名称会作为普通自定义事件被采集，**但不会成为转化**。

### Campaign 侧的 primary conversion event

campaign 只能选 4 个之一，且受 goal category 约束：

| Goal | 可选 primary conversion event | 默认 |
|---|---|---|
| `traffic` | 无 | `null` |
| `sales` | `cv_purchase` | `cv_purchase` |
| `leads` | `cv_lead_submit` | `cv_lead_submit` |
| `signups` | `cv_registration_complete`、`cv_start_trial` | `cv_registration_complete` |

## Google Ads conversion action

**不需要任何人手工创建。** 首次 postback 成功投递时按 `Hellyeah - <DisplayName>` 自动创建并持久化映射。

因此：**在真实转化跑通之前，Google Ads 后台看不到对应 conversion action 是正常现象**，不是配置遗漏，也不是 Bug。

## 前置条件

- active org 明确，且该 org 已绑定目标 website（`websiteId` 与受测站点一致）。
- 用户持有目标 GTM 容器的发布权限，并已完成 OAuth 授权。
- 受测站点是真实可访问域名，且 GTM 容器已实际挂载在该站点。
- 需要验证转化到 Google 的链路时：campaign 必须**从 Hellyeah 发起**并已通过 ops approval 与 unpause，落地页带 `gclid`/`gbraid`/`wbraid`，或会话已通过 `identify()` 写入 hashed email/phone。
- 严禁在 Google Ads 后台手工新建 campaign 来"模拟"链路——客户不存在这条路径。
- 全链路验证使用 dogfood campaign 与 dogfood 广告账户，不使用 Hellyeah 自有主账户（封号风险）。

## Browser 观察点

- Dashboard Tracker/GTM 页面的连接状态、容器选择列表、发布结果与错误提示。
- 用户 GTM 容器中是否出现 `Hellyeah` workspace、`Hellyeah - All Pages` trigger、`Hellyeah X-Ray` tag，以及是否已 publish 为新 version。
- 受测站点页面源中是否加载了 `script.js` 且 `data-tag=gtm`、`websiteId` 正确。
- X-Ray 事件查询中原始信号与 `cv_*` 的对应关系、env 归属、`hy_event_id` 唯一性。
- Google Ads 中 `Hellyeah - <DisplayName>` conversion action 是否在首次转化后出现。

## Page Signals

| Surface | URL pattern | Required visible anchors | Optional anchors | Wrong-page signals |
|---|---|---|---|---|
| Tracker GTM 设置 | Dashboard tracker/GTM 路由 | 连接状态；容器选择或已连接容器 | 发布时间、错误提示、manual setup 入口 | X-Ray 事件页；未选择 website |
| GTM 容器 | `tagmanager.google.com` | 目标 account/container；workspace 列表 | version 历史 | 其它 Google 账号或容器 |
| 受测站点 | 已绑定域名 | 页面加载 `script.js` 且 `data-tag=gtm` | dataLayer / `window._hy` | 其它环境域名；未发布容器 |
| Google Ads 转化 | Google Ads conversions 页 | conversion action 列表 | 归因设置、计数方式 | 非目标广告账户 |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| GTMCV-ACT-001 | 读取当前 GTM 连接状态 | active org + website 已选 | 返回 status / containerId / errorKind | read | 刷新一次；`read_error` 时用 `retry_status` |
| GTMCV-ACT-002 | 授权并选择容器 | 用户持容器权限 | `not_connected → pending` | 写入用户 Google 账号授权 | `disconnect` 后重连；失败记录 errorKind |
| GTMCV-ACT-003 | 发布 Hellyeah tag | 连接 `pending`/需重试 | 创建 workspace/trigger/tag 并 publish，进入 `active` | **写入用户真实 GTM 容器并发布 version** | `retry_publish`；冲突时按 `publish_conflict` 处理，禁止盲目重发 |
| GTMCV-ACT-004 | 验证站点已加载 tracker | 容器已发布且挂载在站点 | 页面出现 `script.js` 且 websiteId 正确 | read | 清缓存/等待 GTM 生效后重看一次 |
| GTMCV-ACT-005 | 触发受控 `cv_*` 事件 | tracker 已加载 | 事件进入对应 env 与 session | analytics side effect | 用唯一 marker；不重复触发以免污染计数 |
| GTMCV-ACT-006 | 核验 postback 与 conversion action | 存在带 click ID 的 `cv_*` | delivery 达终态；Google 侧出现 `Hellyeah - <Name>` | read | 缺 Google Ads 权限时 WaitingUser |
| GTMCV-ACT-007 | 断开连接 | 连接存在 | 进入 `not_connected`/`revoked` | **移除用户容器中的 Hellyeah 实体** | 仅在明确授权下执行；失败记 `disconnect_failed` |

## Facts

| ID | Meaning | Source surface | Shape | Freshness |
|---|---|---|---|---|
| GTMCV-FACT-CONNECTION | GTM 连接状态 | Dashboard/API | `{status, containerId?, errorKind?, publishedAt?}` | 每次连接/发布动作后 |
| GTMCV-FACT-CONTAINER | 容器内 Hellyeah 实体 | GTM UI/API | `{workspace?, triggerName?, tagName?, versionId?}` | publish 后 |
| GTMCV-FACT-SNIPPET | 站点实际加载的 tracker | 受测站点页面 | `{scriptSrc, websiteId, hostUrl, tag}` | 每次页面验证 |
| GTMCV-FACT-EVENT | 采集到的原始/转化事件 | X-Ray 查询 | `{eventName, type, env, hyEventId?, marker?}` | 触发后按等待预算 |
| GTMCV-FACT-DELIVERY | postback 投递 | postbacks/admin | `{destination, status, attempts, correlationRef}` | 转化产生后 |
| GTMCV-FACT-ACTION | Google conversion action | Google Ads | `{actionName, category, countingType, resourceName?}` | 首次成功 postback 后 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| GTMCV-001 | state_transition | 用户完成授权并选定容器 | 连接进入 `pending`，随后发布成功进入 `active` | Dashboard | 状态前后、containerId | 用户取消授权；容器权限不足（应为 `container_permission`） |
| GTMCV-002 | exact | 发布成功 | 容器中存在 workspace `Hellyeah`、trigger `Hellyeah - All Pages`、tag `Hellyeah X-Ray`，且已 publish 为新 version | GTM 容器 | 三项实体名称与 version | 用户手工改名；容器被他人并发修改 |
| GTMCV-003 | exact | 站点已挂载容器且已发布 | 页面加载 `<hostUrl>/script.js`，`websiteId` 与 Dashboard 绑定一致，`data-tag=gtm` | 站点页面 | 页面源/网络请求 | GTM 发布传播尚在生效窗口；站点有缓存层 |
| GTMCV-004 | negative | 仅完成 GTM tag 发布，未另建转化 tag | 站点**不产生** `cv_*` 转化事件（推断命中的除外） | X-Ray 查询 | 事件列表、时间窗 | 推断引擎条件命中；用户已自行埋点 |
| GTMCV-005 | eventual | 手动触发白名单 `cv_*` | 事件被采集并计为转化，`hy_event_id` 唯一 | X-Ray 查询 | 事件 + marker + 去重证据 | 事件名不在白名单；env 选择错误 |
| GTMCV-006 | negative | 触发非白名单名称（如 `sign_up`） | 作为普通自定义事件采集，**不计为转化** | X-Ray 查询 | 事件类型/名称 | ticket 明确扩展了白名单 |
| GTMCV-007 | exact | campaign 选择 conversion goal | primary conversion event 落在该 goal 允许集合内，默认值正确 | Composer/API | draft 字段 | ticket 明确改变 goal 映射 |
| GTMCV-008 | eventual | 存在带 click ID 或 hashed PII 的 `cv_*` | postback 达成终态；Google 侧出现 `Hellyeah - <DisplayName>` | postbacks + Google Ads | delivery 状态、action 名称 | 归因窗口未到；Google API 配额/延迟 |
| GTMCV-009 | negative | 尚无成功 postback | Google Ads 中**看不到** conversion action 属正常 | Google Ads | 列表截图 | 该账户历史上已有同名 action |
| GTMCV-010 | state_transition | 发布失败 | 连接进入 `error` 并给出具体 `errorKind` 与可执行命令（retry / reconnect / manual setup） | Dashboard | 错误状态与可用动作 | 纯网络抖动且已自动恢复 |
| GTMCV-011 | negative | 用户断开连接 | 容器中 Hellyeah 实体被清理，状态回到 `not_connected` | GTM + Dashboard | 断开前后容器实体 | `disconnect_failed`，此时须记录残留实体 |

## 副作用与恢复

`GTMCV-ACT-003`（发布）和 `GTMCV-ACT-007`（断开）**直接写入用户真实的 Google Tag Manager 容器并发布 version**，属于越出 Hellyeah 边界的高影响动作，不受 sandbox 隔离保护。

- 只对明确授权的测试容器执行，禁止在客户真实容器上试跑。
- 发布超时或中断时记 `action_unknown`，先只读核对容器 workspace/tag/version，禁止重复发布（会产生 `publish_conflict`）。
- 触发的 `cv_*` 事件会进入真实转化统计并可能上报 Google Ads；使用唯一 marker 与 dogfood 账户，报告中登记触发次数与时间窗。
- 断开失败（`disconnect_failed`）时容器中会残留 Hellyeah 实体，必须作为 residual entity 记录并给出人工清理步骤。

## Bug 判断知识

### 高置信 Bug

- 发布返回成功，但容器中缺少 workspace / trigger / tag 任一实体，或未生成新 version。
- 站点加载的 `websiteId` 与 Dashboard 绑定的 website 不一致（跨站点串数据）。
- 白名单内的 `cv_*` 被采集却始终不计为转化，且已排除 env 与时间窗。
- 同一转化重复计数（`hy_event_id` 去重失效）。
- conversion action 名称与 `Hellyeah - <DisplayName>` 映射不符，或写到了错误的广告账户。
- campaign 的 primary conversion event 落在该 goal 不允许的集合内。
- 断开连接后容器中仍残留 Hellyeah 实体，且 UI 报告断开成功。

### 风险或待确认

- postback 长时间未达终态，但缺 Google Ads 侧或 delivery 审计证据。
- 推断引擎对特定站点结构不生效（可能是条件设计问题，也可能是站点不符合规则），需要产品确认预期。
- GTM 发布传播延迟与生效窗口目前无明确预算。

### 不能直接判 Bug

- **Google Ads 中看不到 conversion action**——首次成功 postback 前本就不存在。
- **手动 `window.hellyeah.track()` 能上报而站点自动不上报**——GTM 官方 tag 只加载 tracker，本就不发转化事件。
- **`sign_up` 之类名称没有变成转化**——不在 13 个白名单内。
- GTM 发布后站点短时间内未生效（容器传播/CDN 缓存）。
- `container_permission`、`quota_exhausted`、`revoked_grant` 属于用户侧 Google 账号状态，不是产品缺陷。

## 测试可行性

本模块**默认不作为 agent 的 Browser 执行目标**，原因：

1. 需要真实的第三方账号与容器（Google 账号、GTM 容器发布权限、Google Ads 账户），PR sandbox 不具备。
2. 关键动作会写入 Hellyeah 边界之外的真实系统，不受 sandbox 隔离保护，无法靠销毁环境回滚。
3. 完整闭环依赖真实投放、真实点击带 click ID、ops 审批与 Google 侧归因窗口，时间尺度远超单次测试。

因此：ticket 涉及本模块时，agent 应记录 `Blocked` 或 `UserLed`，给出具体的人工验证步骤与观察点，不得用局部只读观察冒充链路已验证。**本模块的主要价值是解释现象和排除误判**，上面「不能直接判 Bug」四条是最常见的误报来源。

## 已知缺口

- `business_file/` 缺少 GTM 正式业务文档，本模块 GTM 部分依赖代码与研发口头确认，需要产品补齐后回查。
- GTM 发布生效窗口、postback 归因等待预算均无明确数值。
- 推断引擎各条规则的精确匹配条件（lead/auth 的 action URL 模式、cart/checkout 选择器）未在业务文档中固化。
- 尚未通过真实 ticket 试跑验证任何断言，全部为 `draft`。
- dogfood campaign 与 dogfood 广告账户的具体标识需要单独维护，不写入本模块。

## 模型回流

真实试跑后补充：Tracker/GTM 页面稳定锚点、发布与传播的等待预算、postback 终态等待预算、推断引擎规则的可观察判据。

升级到 `pilot` 需要：至少一次完整的连接→发布→站点验证链路证据；升级到 `active` 还需要一次真实转化回传到 Google Ads 的端到端证据，以及产品侧书面业务文档。

敏感信息不得写入：Google 账号、OAuth token、容器 ID 全量值、广告账户 ID 全量值。
