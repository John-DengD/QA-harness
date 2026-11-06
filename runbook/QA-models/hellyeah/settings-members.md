---
id: hellyeah.settings-members
product: hellyeah
surfaces: [customer-dashboard, clerk, api]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.auth-organization, hellyeah.notification-delivery]
---

# Settings & Members

## 业务目标与边界

用户管理个人资料、组织上下文和成员邀请时，权限、组织归属和 Dashboard/API 状态一致。组织删除当前明确不属于 Dashboard 支持范围；通知偏好由 notification-delivery 模块负责。

## Ticket 路由信号

`settings`、`profile`、`member`、`invite`、`role`、`owner`、`organization create`、`Clerk membership`、`leave organization`、`delete organization`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| SETTINGS-SRC-001 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| SETTINGS-SRC-002 | `sources/hellyeah/business_file/shared/authentication/user-identity.md` | observation | historical snapshot, synced 2026-08-05 |
| SETTINGS-SRC-003 | `sources/hellyeah/product-memory.md` | user-confirmed/risk | includes Vendor email rule; separate surface check required |

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Settings | Dashboard settings route | profile/org settings navigation | Admin settings |
| Org switcher/member flow | Dashboard shell/settings | active org；member/invite action | wrong org name |
| Clerk profile/org UI | Clerk embedded/modal | profile or organization context | permission prompt for unrelated app |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| SETTINGS-ACT-001 | 读取 profile/org/member facts | session/org ready | 返回当前用户、角色、memberships | read | 跨 surface 核对 |
| SETTINGS-ACT-002 | 创建测试组织 | 当前范围明确允许 | 新 org 出现在 membership/switcher | side effect | 仅在可靠 cleanup 存在时执行 |
| SETTINGS-ACT-003 | 邀请测试成员 | 有授权邮箱和目标 org | invitation 创建并归属正确 org/role | external communication/access | 明确授权；可撤销时记录 cleanup |
| SETTINGS-ACT-004 | 修改允许的成员角色 | owner/admin 权限明确 | role 按权限合同更新 | access change | 保存原 role 并恢复 |
| SETTINGS-ACT-005 | 核验不支持的删除/离开入口 | 当前 Dashboard contract | 不暴露危险但未完整支持的删除路径 | read | 不调用 Clerk API 绕过 UI |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| SETTINGS-FACT-USER | 当前用户 | UI/identity | `{userRef,emailAlias,verifiedEmail?,profile}` |
| SETTINGS-FACT-ORG | 当前组织 | UI/API | `{orgRef,name,kind}` |
| SETTINGS-FACT-MEMBER | 成员/角色 | Clerk/API | `[{memberRef,emailAlias,role,status}]` |
| SETTINGS-FACT-INVITE | 邀请 | Clerk/UI | `{inviteRef,emailAlias,role,status,orgRef}` |
| SETTINGS-FACT-CAPABILITIES | 当前允许设置动作 | UI/API | `{actions[]}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| SETTINGS-001 | cross_surface | Settings 加载 | 当前 user/org/role 与 identity facts 一致 | USER + ORG + MEMBER | membership hydration 未完成 |
| SETTINGS-002 | state_transition | 创建 org | 新 org 有独立 membership/profile scope，切换可用 | ORG + AUTH facts | create 尚在异步 |
| SETTINGS-003 | exact | 发出 invite | email、role、org 与用户确认输入一致 | INVITE + UI | 邮件 delivery 不在本 ticket |
| SETTINGS-004 | negative | 无管理权限成员 | 不显示或拒绝成员/角色写操作 | CAPABILITIES + rejection | 测试账号实际有更高角色 |
| SETTINGS-005 | negative | Dashboard 当前版本 | 不提供会留下孤儿 wallet/campaign 的 org delete | UI + source | ticket 明确实现完整 delete contract |
| SETTINGS-006 | cross_surface | role 更新 | UI、Clerk membership 和 API 授权结果一致 | MEMBER before-after | token/session 尚未刷新 |
| SETTINGS-007 | negative | unverified email | 不覆盖 verified canonical identity email | USER + identity facts | 用户刚完成验证且事件尚在处理 |
| SETTINGS-008 | negative | 同一邮箱跨 Vendor 在范围 | 按已确认规则拒绝跨 Vendor 重复归属 | Vendor/member facts | 普通 organization membership 与 Vendor 不是同一模型 |

## 副作用、Bug 判断与回流

邀请和角色修改会改变访问权限，必须明确目标、接收人和 scope；测试后撤销或恢复。不要测试 org 删除，除非 ticket 已提供完整安全合同。高置信 Bug：跨 org 邀请、错误 role、无权限可修改、身份邮箱被未验证值覆盖。Vendor 邮箱规则必须只用于 Vendor surface，不能泛化为普通组织成员规则。
