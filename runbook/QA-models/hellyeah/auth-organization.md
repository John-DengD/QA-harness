---
id: hellyeah.auth-organization
product: hellyeah
surfaces: [customer-dashboard, api]
status: pilot
version: 1
last_reviewed: 2026-09-24
related_modules: [hellyeah.wallet-payment, hellyeah.campaign-launch]
---

# Auth & Organization

## 业务目标与边界

已登录用户只能在其成员组织内选择 active organization；Dashboard 和 API 和业务数据必须使用同一组织上下文。模块覆盖登录态、组织选择、刷新保持和跨组织隔离，不覆盖成员邀请的完整生命周期。

## Ticket 路由信号

`auth`、`login`、`Clerk`、`organization`、`org switch`、`membership`、`active org`、`cross-org`、`session`、`401`、`403`、`E_ORG_REQUIRED`，以及 Dashboard org provider / API auth 相关改动。

## 来源

| Ref | Source | Role | Applies to | Status |
|---|---|---|---|---|
| AUTH-SRC-001 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | Customer Dashboard | historical snapshot, synced 2026-08-05 |
| AUTH-SRC-002 | `sources/hellyeah/business_file/shared/authentication/user-identity.md` | observation | Identity and multi-tenancy | historical snapshot, synced 2026-08-05 |
| AUTH-SRC-003 | `sources/hellyeah/user-dashboard/product-memory.md` | risk | Dashboard testing | current guidance |
| AUTH-SRC-004 | `sources/hellyeah/user-dashboard/version-history.md` | timeline | Dashboard versions | current timeline |

## 状态模型

<!-- 2026-09-20 重写：原有的 signed_out / signed_in_unresolved_org / active_clerk_org /
     active_legacy_org / org_switching / access_denied 六个状态在代码中零命中，属建模时
     从业务文档描述里想象出来的名称，无法落地为可观察信号，已全部删除。 -->

### 产品实际状态（代码可查）

| 信号 | 取值 | 来源 |
|---|---|---|
| org scope | `pending` \| `ready` | `apps/dashboard/src/data/hooks/scope.ts` |
| 跨组织访问被拒 | 错误码 `org_not_connected`（由 403 forbidden 映射） | `apps/dashboard/src/data/api.ts` |

**断言只能建立在这两个信号和 UI 可观察事实上。**

### QA 概念状态（非产品枚举，仅用于组织测试思路）

以下不是产品里的状态名，**不要去页面或接口里找同名字段**，只作为测试阶段的划分：

- *未登录* —— 没有有效会话，看到登录入口
- *已登录但组织未就绪* —— `orgScope.status === "pending"`，组织相关数据尚不可读
- *组织已就绪* —— `orgScope.status === "ready"`
- *切换中* —— 两次 ready 之间的过渡，**无对应字段**，只能通过「新旧组织数据是否混合」间接观察
- *无权限* —— 观察信号是 `org_not_connected` 或资源不可发现

写断言时用左边的可观察信号，不用右边的概念名。

## 前置条件

- 测试环境、登录账号和预期组织明确。
- 跨组织测试需要至少两个已知组织及可区分的受控数据。
- 需要「默认 org ≠ 草稿所在 org」时（例如验证 `?org=` 交接），可以在同一账号的两个 org 之间切换来制造，不必新注册账号；要测「tracker 未安装」须使用从未安装过 tracker 的 org（QA 负责人 2026-10-13 确认，工作台 W-20261014-22）。
- 记录当前页面、组织名称/slug 和可脱敏的组织引用。
- 登录或组织切换失败时先区分 Clerk、API、membership 和环境问题。

## Browser 观察点

- 登录入口、成功后的用户身份和 active org。
- Dashboard 左上角当前组织名称旁的下拉框；展开后的可选组织及当前选中项。左下角用户头像菜单是账号菜单，不是组织切换入口。
- 切换后的页面标题、URL、钱包/campaign 等组织特异数据。
- 刷新或重新进入页面后的 active org。
- 受限组织或非成员访问时的错误和可恢复动作。
- 只读交叉核验：`/me` 或当前组织上下文接口，明确标记 surface。

## Page Signals

| Surface | URL pattern | Required visible anchors | Optional anchors | Wrong-page signals |
|---|---|---|---|---|
| Customer Dashboard | `app-*.hellyeahai.com/*` | Dashboard shell；用户或组织入口 | 当前 org 名称、导航 | 登录表单、错误环境 hostname |
| Sign in | Dashboard 登录路由 | Clerk 登录表单 | SSO/provider 入口 | 已加载 Dashboard shell |
| Organization switcher | 任意 Dashboard 页面 | 当前组织；可展开组织列表 | Create organization、member count | 只有用户菜单且无组织语义 |

### 切换到测试目标组织

1. 登录后记录账号和当前组织。即使默认显示另一个组织，也先展开 Dashboard **左上角的组织下拉框**，读取完整可选列表；不能仅凭默认组织判断目标组织不可用。
2. 目标组织（例如 BYO 测试的 `fr-test`）在列表里时，点击该组织；等待页面与组织作用域数据重新加载，再核对左上角已选名称和至少一项该组织的只读事实。关键写操作前还要核对只读 `/me` 或当前组织上下文。
3. 列表没有目标组织时，刷新后重新展开核对一次；仍没有则记录账号、目标环境、实际可选项和截图，并只读核对 Clerk 成员关系及当前环境 `/me` 的组织列表。Clerk 也无成员关系时先归为账号前置；Clerk 有而 Dashboard 没有时记录跨表面不一致，继续区分 sandbox 身份同步、API 数据与 UI 过滤，证据不足时不直接判产品 Bug。目标组织未能实际切换前，不通过修改 URL、创建新组织或沿用旧组织的 BYO 资产继续写测试。

此入口与核验顺序由用户于 2026-09-24 确认；它是测试操作知识，不定义任何 Campaign 产品预期。

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| AUTH-ACT-001 | 读取当前身份与 active org | Dashboard 可观察 | 不改变状态，返回 session/org facts | read | 重新加载一次；仍失败则检查会话 |
| AUTH-ACT-002 | 切换到已知成员组织 | 目标 org 在 membership/列表中 | active org 从 A 进入 B，scoped data 重新加载 | reversible | 切回原 org 并刷新验证 |
| AUTH-ACT-003 | 刷新验证 org 保持 | active org 已稳定 | 刷新后按产品解析规则保持有效 org | read | 会话过期则停止并恢复登录 |
| AUTH-ACT-004 | 读取组织特异 sentinel | 已选择目标 org | 钱包/campaign 等 sentinel 与目标 org 数据一致 | read | 换用另一项可区分事实 |
| AUTH-ACT-005 | 验证非成员隔离 | 有受控的非成员目标引用 | 拒绝或不可发现，不返回业务数据 | read | 无合法隔离 fixture 时 Blocked |

## Facts

| ID | Meaning | Source surface | Shape | Freshness |
|---|---|---|---|---|
| AUTH-FACT-SESSION | 当前是否有有效用户会话 | Dashboard/Clerk | `{authenticated, accountAlias}` | 每次登录/过期后更新 |
| AUTH-FACT-MEMBERSHIPS | 当前用户可选择的组织 | UI 或只读身份接口 | `[{orgRef, name, kind}]` | 切换前读取 |
| AUTH-FACT-ACTIVE-ORG | 后端解析的 active org | 只读身份/API | `{orgRef, name}` | 每个关键写操作前 |
| AUTH-FACT-PAGE-ORG | UI 当前显示的组织 | Dashboard | `{orgRef?, name}` | 每次导航/刷新后 |
| AUTH-FACT-SCOPED-SENTINEL | 可区分组织的数据事实 | wallet/campaign/其它模块 | `{kind, value, orgRef}` | 切换前后分别读取 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| AUTH-ORG-001 | cross_surface | 登录完成 | UI active org 与只读身份/组织事实一致 | Dashboard + API | active org UI、只读身份事实 | 页面仍在 loading；旧缓存；错误账号 |
| AUTH-ORG-002 | state_transition | 用户切换到成员组织 B | active org 进入 B，组织作用域数据切换为 B | UI + org-scoped read | 切换前后组织、至少一项可区分数据 | B 数据本身为空；异步加载未完成 |
| AUTH-ORG-003 | negative | 用户访问非成员组织或其它 org 实体 | 请求被拒绝或资源不可发现，不泄露业务数据 | UI/API | 拒绝状态、无敏感数据的响应/页面 | 测试对象实际属于当前 org；共享公共数据 |
| AUTH-ORG-004 | exact | active org 已稳定 | 页面刷新后仍保持同一有效组织，或按明确解析优先级选择 | UI | 刷新前后 active org | 会话过期；用户主动改变选择 |
| AUTH-ORG-005 | visible | active legacy org 使用 Clerk-only 功能 | 显示明确 `org_not_connected` 或可执行恢复提示，不冒充成功 | UI | gate/error 页面 | Ticket 已明确移除 legacy 支持 |
| AUTH-ORG-006 | negative | 多组织用户未建立明确 money context | 金额相关操作不得静默选择错误租户 | UI/API | 当前 org、动作结果/拒绝 | 单组织用户；用户已明确选择 active org |

## 副作用与恢复

组织切换属于可逆状态变更，记录原 active org，测试后按需要切回并刷新验证。不要创建、删除组织或修改 membership，除非 ticket 明确授权并提供 cleanup。

## Bug 判断知识

### 高置信 Bug

- 切换后 UI 显示 B，但业务请求或数据仍来自 A。
- 非成员可以看到另一个组织的钱包、campaign 或内部业务数据。
- 刷新后无规则地跳到其它组织并导致错误写入。

### 风险或待确认

- UI 与 API 指向不同 org，但缺少身份/请求证据。
- Clerk-backed 和 legacy org 行为差异尚未确认适用版本。

### 不能直接判 Bug

- legacy org 在 Clerk-only 路径显示明确 `org_not_connected`。
- 目标组织合法但当前没有数据，不能仅凭空列表判切换失败。
- 登录会话过期、测试账号不是成员或环境 Clerk 配置错误。

## 历史风险与回归探针

- active org 与 Dashboard 展示不一致。
- 切换或刷新后出现跨组织数据泄露。
- UI 写入成功但 API 使用了另一组织上下文。

## 待补测

| ID | 要验证什么 | 前置与做法 | 来源 | 状态 |
|---|---|---|---|---|
| AUTH-RT-001 | 草稿所在 org 不是默认 org 时，从草稿点 Set Up Tracking，带 `?org=` 打开的页面落在**草稿所在 org**，而不是默认 org | qa-secondary：先在 org-A / org-B 之间切换，使默认 org ≠ 草稿 org；在 org-B（未安装 tracker）的 Sales 草稿上点 Set Up Tracking，读落地页的当前 org | PR-1217 exp3 C2 未能反证（新标签总落在 org-A = 草稿 org）；前置方法由 QA 负责人 2026-10-13 确认 | 未测 |

## 已知缺口

- 尚未通过真实 Browser ticket 验证全部断言。
- 组织邀请、角色权限和 Vendor membership 后续拆成独立模块。

## 模型回流

真实 ticket 试跑后补充稳定页面锚点、合法 legacy-org gate 和可复用 cross-org fixture。selector 或一次性文案变化不直接写入模块。

<!-- 2026-09-20: CLI 已退出 QA 范围，相关 surface、来源和交叉核验手段已删除。只读交叉核验改用 API / Admin Dashboard。 -->
