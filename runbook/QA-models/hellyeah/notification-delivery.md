---
id: hellyeah.notification-delivery
product: hellyeah
surfaces: [customer-dashboard, api, admin-dashboard, email-provider, webhook]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.settings-members, hellyeah.campaign-lifecycle]
---

# Notification Delivery

## 业务目标与边界

用户通知偏好、收件邮箱、campaign lifecycle 事件、delivery 审计、去重、skipped reason、suppression 和 Admin 查询形成一致链路。邮件是否到达只是其中一项证据。

## Ticket 路由信号

`notification`、`email`、`preference`、`campaign emails`、`delivery`、`skipped`、`suppression`、`bounce`、`complaint`、`Resend webhook`、`dedup`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| NOTIFY-SRC-001 | `sources/hellyeah/business_file/customer-dashboard.md#Notification Preferences` | observation | preference UI/API, synced 2026-08-05 |
| NOTIFY-SRC-002 | `sources/hellyeah/product-memory.md` | user-confirmed/risk | lifecycle/delivery contracts require code/ticket recheck |
| NOTIFY-SRC-003 | `sources/qa-knowledge/domains/webhook-event.md` | risk | current guidance |
| NOTIFY-SRC-004 | `sources/hellyeah/version-history.md` | timeline | current timeline |

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Notification Settings | Settings notifications tab | destination；broad toggle；campaign email row | Clerk notification settings only |
| Admin deliveries | Admin notification deliveries route | status/entity filters；delivery rows | campaign events without delivery audit |
| Provider evidence | Resend/provider dashboard | message/webhook status/correlation | unrelated sender/environment |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| NOTIFY-ACT-001 | 读取 preference/destination | signed-in user | 返回 defaults/overrides 和 verified destination | read | 无 email 时记录 unavailable |
| NOTIFY-ACT-002 | 切换 campaign email preference | 当前值已保存 | PUT 后刷新仍持久化 | reversible | 恢复原值并验证 |
| NOTIFY-ACT-003 | 触发受控 lifecycle event | 测试 campaign/event 可用 | 创建 sent 或明确 skipped delivery | communication side effect | 使用测试收件人/实体 marker |
| NOTIFY-ACT-004 | 查询 delivery/dedup | 有 entity/event correlation | 返回唯一审计状态 | read | 扩展合理异步窗口 |
| NOTIFY-ACT-005 | 注入受控 bounce/complaint | provider/fixture 授权 | suppression 写入，后续 skipped | high impact test fixture | 仅专用邮箱，记录恢复方式 |
| NOTIFY-ACT-006 | 验证 webhook signature | 沙箱/fixture 支持 | invalid signature 被拒绝，合法事件处理 | test event | 不对生产发送伪造 webhook |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| NOTIFY-FACT-PREFERENCE | 用户偏好 | UI/API | `{channel,category,enabled,source}` |
| NOTIFY-FACT-DESTINATION | 收件目标 | identity/UI | `{emailAlias,verified,availability}` |
| NOTIFY-FACT-EVENT | 触发业务事件 | campaign/system | `{entityRef,eventType,eventRef,timestamp}` |
| NOTIFY-FACT-DELIVERY | 审计记录 | Admin/API | `{status,reason?,providerRef?,attempts,entityRef,eventType}` |
| NOTIFY-FACT-SUPPRESSION | bounce/complaint 状态 | provider/API | `{emailAlias,type,status,createdAt}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| NOTIFY-001 | cross_surface | Settings 加载 | UI toggle/destination 与 preferences/identity 一致 | PREFERENCE + DESTINATION | preference defaults 尚未 hydrate |
| NOTIFY-002 | state_transition | toggle 修改 | 保存后刷新保持，并只影响当前用户 | before-after PREFERENCE | 错误账号/session |
| NOTIFY-003 | negative | preference disabled + event | 不发送；记录 `skipped/preference_disabled` | EVENT + DELIVERY | event 不属于 campaign email category |
| NOTIFY-004 | eventual | preference enabled + valid destination | 形成 sent/completed 或明确失败 delivery | EVENT + DELIVERY + provider | provider 合理延迟 |
| NOTIFY-005 | negative | 同 entity/event 重复触发 | 不重复发送，不产生多条非幂等 delivery | DELIVERY count/correlation | 不同 eventRef 的合法事件 |
| NOTIFY-006 | negative | email unavailable/unverified | UI 不显示为可发送；delivery 不使用 stale/unverified 地址 | DESTINATION + DELIVERY | verified email 刚更新尚未同步 |
| NOTIFY-007 | state_transition | bounce/complaint | suppression 写入，后续 delivery `skipped/suppressed` | SUPPRESSION + DELIVERY | 测试 provider event 未被接受 |
| NOTIFY-008 | negative | invalid webhook signature | 返回拒绝且不改变 suppression/delivery | webhook response + before-after facts | 测试未命中目标环境 endpoint |
| NOTIFY-009 | cross_surface | Admin 查询 | entity/status filter 和分页能找到对应 sent/skipped/failure | DELIVERY + Admin UI | 时间窗/filter 错误 |
| NOTIFY-011 | eventual | 自动优化更新了预算 | 触发 `campaign.optimization_budget_updated`，金额准确 | 审计 + 客户侧 | delivery 记录、金额对照 | 客户关闭对应偏好（应记 `skipped/preference_disabled`） |
| NOTIFY-012 | eventual | Meta 提交进入 `account_binding` | 触发 `campaign.account_binding_required` | 审计 | delivery 记录 | Google path；客户已有绑定账户 |
| NOTIFY-013 | visible | 用户无可用邮箱 | delivery 记 `skipped / no_email`，UI 不显示为可发送 | 审计 + UI | skip reason | 邮箱刚验证尚未同步 |
| NOTIFY-014 | exact | suppression 写入 | reason 属于 `bounce` / `complaint` / `manual` / `provider_suppression` 之一，不是自由文本 | API | suppression 记录 | — |
| NOTIFY-010 | negative | production config gate 在范围 | 缺必要 provider key 时部署/启动 fail closed | deployment evidence | staging 明确允许 disabled provider |

## 副作用、Bug 判断与回流

真实邮件和 suppression 会影响收件人，使用专用测试邮箱并明确授权。高置信 Bug：关闭偏好仍发送、无 skipped 审计、重复发送、invalid signature 被接受、bounce 后继续发送。仅收件箱没看到邮件不能单独判 delivery 失败；先查审计和 provider。当前缺独立正式 notification 业务文档，除 preference 外的强断言在真实 ticket 前需结合目标 PR/代码和用户确认复核。
