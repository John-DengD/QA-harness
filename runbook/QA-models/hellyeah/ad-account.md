---
id: hellyeah.ad-account
type: module
product: hellyeah
surfaces: [admin-dashboard, api, google-ads, meta]
status: draft
version: 1
last_reviewed: 2026-09-20
related_modules: [hellyeah.campaign-launch, hellyeah.admin-review, hellyeah.campaign-lifecycle]
---

# Ad Account（广告账户池与分配）

## 业务目标与边界

Hellyeah 维护一个广告账户池，按组织分配账户供 campaign 投放。账户来源有两类：自己在经销商处开的（`managed`），和客户自带并授权的（`customer`）。

模块覆盖：账户的开户申请流程、池内状态、平台健康状态同步、按组织分配、以及账户被封后的处理。

不覆盖：campaign 的审核与激活（见 [campaign-launch](campaign-launch.md)）、Admin 审核动作本身（见 [admin-review](admin-review.md)）。

## Ticket 路由信号

`ad account`、`account pool`、`ad account assignment`、`account application`、`awaiting_manual`、`reseller`、`MCC`、`BP`、`Business Portfolio`、`waitlist`、`account health`、`suspended account`、`banned account`、`platform status`、`system user`，以及账户分配、开户、封号处理相关改动。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| ACCT-S01 | `hellyeah-v2` `packages/shared/src/constants/managed-ads.ts` — 适用:全部账户枚举 | observation | current, read 2026-09-20 (staging) |
| ACCT-S02 | `sources/hellyeah/product-memory.md` — 适用:健康状态与池状态一致性规则 | user-confirmed | current |
| ACCT-S03 | `sources/qa-knowledge/bug-patterns.md` — 2026-08-26 Account Pool 条目 — 适用:PE-250 / PE-259 的历史 Bug 模式 | risk | current |

> `business_file/` 无对应文档，账户枚举与流程事实来自代码，断言为 `draft`。

## 状态模型

### 开户申请（Application）

```
submitted → approved → bound
         ↘ awaiting_manual ↗
         ↘ cancelled / failed
```

代码注释说明了每个状态的来历：

| 状态 | 来源 | 含义 |
|---|---|---|
| `submitted` | 镜像经销商 `PENDING` | 已向经销商提交开户请求 |
| `awaiting_manual` | **Hellyeah 自有，Meta 专属** | Meta 的提交返回一个表单 URL，**需要人工填写完成** |
| `approved` | 镜像经销商 `SUCCESS` | 经销商已开户 |
| `bound` | **Hellyeah 自有** | 账户已加入我们的 MCC（Google）/ BP（Meta），池子可以用它了 |
| `cancelled` | 镜像经销商 `CANCEL` | — |
| `failed` | 镜像经销商 `FAIL` | — |

⚠️ **`approved` ≠ 可用。**必须到 `bound`（加入 MCC / BP）池子才能分配它。这是最容易误判的一步。

⚠️ **`awaiting_manual` 是 Meta 专属的人工环节**，和 campaign 侧的 `account_binding` 是两回事：前者是「开新账户时人工填表」，后者是「给 campaign 绑一个已有账户」。

### 池内状态

```
available · in_use · paused · disabled
```

- `available`：**健康且可安全分配**
- `in_use`：已分配给某组织
- `disabled`：不可分配（含被平台封禁）

### 平台原生状态（不归一化）

```
google: ENABLED     ← 只有这个可分配
meta:   ACTIVE      ← 只有这个可分配
```

代码明确：`platformStatus` 保持**平台原样，不做归一化**——Meta 的 `ACTIVE` 不会被转成 Google 的 `ENABLED`。测试时不要跨平台套用状态名。

不可用的平台状态：`SUSPENDED` / `CANCELED` / `CLOSED`。

### 其它维度

| 维度 | 取值 | 说明 |
|---|---|---|
| `source` | `managed` / `customer` | 我们开的 vs 客户自带授权的 |
| `purpose` | `serving` / `platform_operations` | 与 source 正交——客户自带的账户仍是 `serving` |
| waitlist | `waiting` / `assigned` / `cancelled` | 池子没号时的排队 |
| 主账户 | `connected` / `disconnected` / `error` | MCC / BP 本身的连接状态 |

## 核心规则（product-memory 已确认）

**外部健康状态与内部可分配状态必须一致。**

平台报告非 `ENABLED`（Google）/ 非 `ACTIVE`（Meta）时，内部必须是 `disabled`：不能显示或查询为 `available`，不能出现在手动选择或自动分配的候选里。

被封禁的**已分配**账户在 teardown 期间保留 `user_org_id`；恢复可用前必须**重新探测平台状态**，仍不健康时返回 `409`。

**账户是 org 级 1:1 分配，不是 per-campaign** —— 一个组织的所有 campaign 共用同一个账户。

**账户被封导致 campaign 重建时**，原 campaign 进入 `superseded`，未花完预算**转移给后继 campaign，不退回钱包**（见 [campaign-launch](campaign-launch.md)）。

## 前置条件

- Admin 权限可访问账户池管理界面。
- 已知至少一个健康账户和（如需测封禁场景）一个非健康账户。
- 区分测试目标是 Google 还是 Meta——两边的状态名、人工环节、凭据模型都不同。
- 涉及真实开户申请时确认授权范围——这会在**真实经销商处产生请求**。

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| ACCT-ACT-001 | 读取账户池状态 | Admin 权限 | 返回账户列表、状态、归属、平台状态 | read | 刷新一次 |
| ACCT-ACT-002 | 读取某组织的账户分配 | orgRef 已知 | 返回该 org 的账户（应为 0 或 1 个） | read | 跨 surface 核对 |
| ACCT-ACT-003 | 提交开户申请 | 明确授权 | `submitted`，Meta 可能进 `awaiting_manual` | **在真实经销商处产生请求** | 需明确授权；超时只读核验，禁止重发 |
| ACCT-ACT-004 | 完成 Meta 人工表单 | 处于 `awaiting_manual` | 进入 `approved` | 人工/外部 | `UserLed` |
| ACCT-ACT-005 | 核验账户已 bound | 申请处 `approved` | 进入 `bound`，池中可见且 `available` | read | 按异步预算等待 |
| ACCT-ACT-006 | 核验封禁账户处理 | 有已封禁账户 | 内部为 `disabled`，不在任何候选中 | read | 平台状态不可读时记 Blocked |
| ACCT-ACT-007 | 尝试分配不健康账户 | 目标账户非健康 | **被拒绝，返回 409** | read（被拒） | 若意外成功，立即记录并停止 |

## Facts

| ID | Meaning | Source | Shape | Freshness |
|---|---|---|---|---|
| ACCT-FACT-POOL | 池内账户 | Admin/API | `[{accountRef, status, source, purpose, platform, platformStatus, orgRef?}]` | 每次分配/状态变更后 |
| ACCT-FACT-APPLICATION | 开户申请 | Admin/API | `{applicationRef, status, platform, submittedAt, formUrl?}` | 状态变更后 |
| ACCT-FACT-ASSIGNMENT | 组织的账户分配 | campaign/Admin | `{orgRef, accountRef?, assignedAt?}` | 分配前后 |
| ACCT-FACT-PLATFORM | 平台侧原生状态 | 平台后台 | `{platform, nativeStatus}` | 探测时 |
| ACCT-FACT-WAITLIST | 排队 | Admin/API | `{orgRef, status, requestedAt}` | 排队/分配后 |
| ACCT-FACT-MAIN | MCC / BP 连接 | Admin | `{platform, status}` | 每轮开测 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| ACCT-001 | cross_surface | 平台状态非健康 | 内部状态为 `disabled`；**不出现在 available 查询、手动选择器和自动分配候选中** | Admin + API + 平台 | 平台状态、内部状态、三处候选列表 | 平台刚恢复且尚未重新探测 |
| ACCT-002 | negative | 尝试分配/恢复不健康账户 | 拒绝并返回 `409`，不完成分配 | API | 拒绝响应、分配前后归属 | 账户实际已恢复 `ENABLED`/`ACTIVE` |
| ACCT-003 | exact | 账户已分配给某 org | **一个 org 至多一个账户**；该 org 的所有 campaign 共用它 | Admin + campaign | 分配记录、多个 campaign 的账户引用 | 产品改变分配粒度 |
| ACCT-004 | state_transition | 开户申请 approved | **必须再到 `bound` 才可分配**；仅 `approved` 时池中不应为 `available` | Admin/API | 状态序列、池内可见性 | 异步绑定窗口内 |
| ACCT-005 | negative | Meta 开户 | 停在 `awaiting_manual` 并给出表单 URL 是设计内的人工环节，不是卡住 | Admin/API | 状态、表单 URL 存在 | Google 路径（无此状态） |
| ACCT-006 | exact | 跨平台读取状态 | 平台状态保持原样，不归一化（Meta `ACTIVE` 不写成 `ENABLED`） | API | 两平台账户的 platformStatus | 产品明确引入归一化字段 |
| ACCT-007 | negative | 账户池为空 | funded 的 campaign 保持可恢复的 `pending_internal_review`，**不二次扣款**；或进入 waitlist | campaign + wallet + waitlist | 状态、无第二 debit | 实际已分配健康账户 |
| ACCT-008 | state_transition | 已分配账户被封 | teardown 期间保留 `user_org_id`；恢复前重新探测平台状态 | Admin/API | 封禁前后归属、探测记录 | 账户未被封 |
| ACCT-009 | cross_surface | 账户被封导致 campaign 重建 | 原 campaign 进 `superseded`，预算转移给后继 campaign，钱包**无退款入账** | campaign + wallet | 前后状态、后继引用、钱包流水 | 产品改变结转规则 |
| ACCT-010 | visible | MCC / BP 未连接 | 明确提示 `disconnected` / `error`，不静默把账户当可用 | Admin | 主账户状态、候选列表 | 连接刚恢复 |

## 副作用与恢复

`ACCT-ACT-003`（提交开户申请）会在**真实经销商处产生请求**，越出本环境边界，属高影响动作：

- 必须明确授权，只对测试目标执行一次。
- 超时或中断记 `action_unknown`，**下一动作只读核验申请列表**，禁止重复提交（会开出多余账户）。
- 无法撤销的申请记为 residual entity，给出人工下一步。

账户分配与状态变更会影响真实投放能力，修改前记录原值，测试后恢复并用新的只读观察验证。

## Bug 判断知识

### 高置信 Bug

- 平台侧非健康的账户在内部仍为 `available`，或出现在任何分配候选中。
- 仅 `approved`（未 `bound`）的账户被当作可分配。
- 一个 org 被分配了多个账户。
- 不健康账户的分配/恢复请求没有返回 `409` 而是成功了。
- 平台状态被错误归一化（Meta 状态写成 Google 的值）。
- 账户池为空时产生了第二次扣款。
- 封禁账户 teardown 后 `user_org_id` 丢失，导致无法追溯归属。

### 风险或待确认

- 经销商侧状态与内部镜像不一致，但无法访问经销商后台核对。
- waitlist 的分配顺序规则未建模。

### 不能直接判 Bug

- Meta 开户停在 `awaiting_manual` —— 设计内的人工表单环节。
- `approved` 之后短时间内还没 `bound` —— 异步绑定窗口。
- 账户池空导致 campaign 停在 `pending_internal_review` —— 这是正确的可恢复行为。
- 测试环境的账户不产生真实投放数据。

## 已知缺口

- `business_file/` 无文档，全部来自代码。
- 经销商（reseller）的对接细节、超时与重试策略未建模。
- waitlist 的优先级与分配算法未知。
- 账户池容量、补货策略未知。
- Meta System User 角色（`admin` / `employee`）对分配能力的影响（HEL-1386）仅在代码注释中提及，未验证。
- 尚未通过真实 ticket 试跑验证任何断言。

## 模型回流

升级到 `pilot` 需要：一次完整的开户 → bound → 分配链路证据，以及一次封禁账户的处理证据。

不得写入模块：真实广告账户 ID、MCC/BP 标识、经销商凭据。
