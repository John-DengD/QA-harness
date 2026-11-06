---
id: hellyeah.xray-tracking
type: module
product: hellyeah
surfaces: [customer-dashboard, xray, tracked-website, api, postbacks]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.auth-organization, hellyeah.campaign-lifecycle]
---

# X-Ray Tracking（追踪与事件）

## 业务目标与边界

用户正确安装并诊断 X-Ray tracker，事件进入匹配 website/env/session，转化推断、Dashboard 查询和下游 attribution/postback 使用一致事实。第三方 analytics/postback 是邻接链路，不因 X-Ray 局部成功而自动通过。

## Ticket 路由信号

`X-Ray`、`tracker`、`website`、`pageview`、`event`、`conversion`、`cv_`、`pixel`、`data source`、`attribution`、`postback`、`funnel`、`session`、`UTM`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| XRAY-S01 | `sources/hellyeah/business_file/xray.md` | observation | historical snapshot, synced 2026-08-05 |
| XRAY-S02 | `sources/hellyeah/business_file/xray/event-model.md` | observation | historical snapshot, synced 2026-08-05 |
| XRAY-S03 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| XRAY-S04 | `sources/hellyeah/business_file/xray/ssot-integration.md` | observation | historical snapshot, synced 2026-08-05 |
| XRAY-S05 | `sources/qa-knowledge/domains/webhook-event.md` | risk | current guidance |
| XRAY-S06 | `sources/rulings/2026-10-13-pr1217-k3-multi-org-tracker.md` (PR-1217-K3（QA-1149，staging，QA 负责人裁定；工作台 W-20261014-22）) | authority | confirmed 2026-10-13 |

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Dashboard Tracking | tracking/X-Ray route | website/config/status/analytics navigation | campaign metrics only |
| Tracked website | configured domain | tracker script/config for target website | different env/site ID |
| Events/Funnel | tracking analytics route | env/date/filter/event dimensions | empty state without query context |
| Postback diagnostics | integration/admin route | source/event/delivery/correlation | X-Ray-only success badge |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| XRAY-ACT-001 | 读取 website/tracker 配置 | active org + website known | 返回 websiteId/env/config | read | 错误绑定时停止事件测试 |
| XRAY-ACT-002 | 触发受控页面/自定义事件 | tracker 已安装 | event 进入对应 env/session | analytics side effect | 使用唯一 marker 防混淆 |
| XRAY-ACT-003 | 查询原始事件和 session | 有 marker/time window | 返回唯一关联 facts | read | 扩展等待窗口一次 |
| XRAY-ACT-004 | 核验 conversion inference | 原始信号满足条件 | 生成确定的 cv_* 且幂等 | read/eventual | inference job 延迟 |
| XRAY-ACT-005 | 核验 Dashboard/SSOT/postback | event/conversion 已存在 | 各 surface 语义一致或给出差异原因 | read/manual | 缺第三方权限则 WaitingUser |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| XRAY-FACT-WEBSITE | 目标 website/config | Dashboard/API | `{websiteRef,orgRef,domain,env,autocapture}` |
| XRAY-FACT-EVENT | 原始事件 | X-Ray query | `{eventRef,type,name?,env,url,timestamp,marker?}` |
| XRAY-FACT-SESSION | session/visitor | X-Ray | `{sessionRef,websiteRef,env,attribution}` |
| XRAY-FACT-CONVERSION | inferred/manual conversion | X-Ray/SSOT | `{eventName,hyEventId?,value?,currency?,status}` |
| XRAY-FACT-DELIVERY | postback/third-party delivery | postbacks/provider | `{destination,status,attempts,correlationRef}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| XRAY-001 | exact | website 已绑定 | Dashboard/domain/websiteId/env 指向同一目标 | WEBSITE + screenshot | 多 website 选择错误 |
| XRAY-002 | eventual | 触发 pageview/custom event | 事件进入指定 env，不混入 prod/其它 env | EVENT + marker | bot filtering；soft-deleted website |
| XRAY-003 | negative | batch/events 跨 env | 单 batch 不混合 env，staging session 不并入 prod | EVENT + SESSION | 测试请求实际分成多个 batch |
| XRAY-004 | exact | event naming | autocapture 无前缀、performance `hy_`、conversion `cv_`，snake_case | EVENT/CONVERSION | ticket 明确迁移 naming contract |
| XRAY-005 | negative | inference 重跑 | deterministic hy_event_id 防重复 conversion | CONVERSION count/correlation | 不同原始事件的合法 conversion |
| XRAY-006 | cross_surface | Dashboard 查询事件 | UI 统计/明细与 X-Ray facts 在同 env/window 一致 | EVENT + UI | timezone/filter/window 不同 |
| XRAY-007 | negative | identify 包含 email/phone | 服务端只存/使用 hash，不在可见事实泄露原值 | session/event evidence | 本地请求调试界面明确受控 |
| XRAY-008 | eventual | postback 在范围 | conversion 入队并有 delivery 终态或明确失败恢复 | CONVERSION + DELIVERY | 第三方权限/配置缺失 |
| XRAY-009 | cross_surface | attribution 在范围 | click/UTM、session、conversion 和 campaign attribution 可关联 | SESSION + CONVERSION + campaign facts | attribution window/model 不同 |
| XRAY-010 | visible | 无数据/错误 | UI 区分无事件、过滤为空、配置错误和服务失败 | UI + query facts | 合法新 website 无事件 |
| XRAY-011 | negative | campaign goal 在 Sales ↔ Traffic 之间切换 | tracker 安装状态（未安装 / waiting / live）不随 goal 改变；未安装 tracker 的组织显示未安装，不显示为 live；Traffic goal 不因 tracking 未就绪阻塞 launch | 切换前后的 tracker 状态与 readiness 行 + 本 Case 视频 | 测试期间 tracker 真实收到首次访问，由 waiting 变为 live |

**断言的可用范围**：`XRAY-011` 来自 XRAY-S06（QA 负责人 2026-10-13 裁定），**可以单独支撑 ProductFail**。其余断言仍受模块状态限制。

## 副作用、Bug 判断与回流

测试事件使用唯一 marker、非生产 env 和可识别测试数据；不发送敏感 PII。高置信 Bug：env 混流、同一事件重复 conversion、Dashboard 与同查询窗口事实矛盾、原始 PII 泄露。仅 `lastEventAt:null` 或 UI connected 不足以证明 webhook 成败。第三方后台证据缺失时标风险/Blocked。
