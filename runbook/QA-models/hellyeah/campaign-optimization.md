---
id: hellyeah.campaign-optimization
type: module
product: hellyeah
surfaces: [customer-dashboard, admin-dashboard, api, ad-platform]
status: draft
version: 1
last_reviewed: 2026-09-20
related_modules: [hellyeah.campaign-lifecycle, hellyeah.wallet-payment, hellyeah.admin-review, hellyeah.notification-delivery]
---

# Campaign Optimization（自动优化）

## 业务目标与边界

系统在客户**授权的范围内**自动调整 active campaign 的预算、或自动暂停 campaign，以逼近客户设定的优化目标（CPA / ROAS 等）。每次调整前必须通过授权检查，调整结果要能被客户和 Admin 追溯。

模块覆盖：enrollment（客户授权）、run（优化运行）、cycle（分析周期）、decision（决策与人工复核）、action（实际执行）、以及全部授权拒绝原因。

不覆盖：campaign 首次 launch（见 [campaign-launch](campaign-launch.md)）、pause/resume 的手动路径（见 [campaign-lifecycle](campaign-lifecycle.md)）。

> ⚠️ **这是本产品风险最高的自动化面**：它会在无人值守的情况下**动客户的钱**（改预算）和**停客户的投放**（暂停 campaign）。任何授权门失效都是资金级事故。

## Ticket 路由信号

`optimization`、`full auto`、`full-auto enrollment`、`optimization run`、`budget update`、`auto pause`、`optimization target`、`CPA target`、`ROAS target`、`risk class`、`quiet hours`、`authorization envelope`、`safety limits`、`optimization review`、`decision`、`playbook`、`evidence window`，以及 `apps/api/src/modules/optimization/*`、`apps/api/src/modules/campaigns/optimization-executor.ts`、`apps/api/src/inngest/functions/*optimization*`、`apps/admin/src/features/optimization-review/*`、`apps/dashboard/src/features/campaigns/optimization.tsx` 下的改动。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| OPT-S01 | `hellyeah-v2` `packages/shared/src/constants/optimization.ts` — 适用:全部枚举与限额常量 | observation | current, read 2026-09-20 (staging) |
| OPT-S02 | `hellyeah-v2` `packages/shared/src/schemas/optimization.ts` — 适用:authorization envelope / limits / quietHours | observation | current, read 2026-09-20 |
| OPT-S03 | `hellyeah-v2` `apps/api/src/inngest/functions/*optimization*` — 适用:run / action / enrollment 的后台流程 | observation | current, read 2026-09-20 |
| OPT-S04 | `hellyeah-v2` `apps/admin/src/features/optimization-review/` — 适用:Admin 复核界面 | observation | current, read 2026-09-20 |
| OPT-S05 | `hellyeah-v2` `apps/dashboard/src/features/campaigns/optimization.tsx` — 适用:客户侧展示 | observation | current, read 2026-09-20 |

> **`business_file/` 中没有任何自动优化文档**，本模块全部事实来自代码。按知识来源规则，代码只能说明「是怎么实现的」，**不能定义「应该是什么样」**——因此本模块所有断言均为 `draft`，**不可单独作为判 Product bug 的依据**，需要 QA 单或产品确认。

## 状态模型

四层对象，各有独立状态机：

### Enrollment（客户授权）

```
pending_activation → started → completed
                            ↘ expired / cancelled / failed
```

客户为某个 campaign 开启自动优化，声明优化目标和授权范围。

### Run（优化运行）

```
running ⇄ paused → stopped / completed / failed
```

控制动作：`pause` / `resume` / `stop`。**最长运行 31 天**（`MAX_OPTIMIZATION_RUN_DAYS`）。

### Cycle（分析周期）

```
open → decided
```

`open` 超过 **120 分钟**（`OPTIMIZATION_CYCLE_OPEN_TIMEOUT_MINUTES`）视为 worker 死亡，按 failed 关闭。

### Decision（决策）

```
recorded → blocked / pending_review → confirmed / approved / rejected / superseded / cancelled
```

决策结果 `OPTIMIZATION_DECISION_OUTCOMES`：`no_change` / `change_proposed` / `analysis_failed`。

### Action（实际执行）

```
authorized → executing → executed
                      ↘ failed / cancelled
```

- `authorized` 超过 **2 分钟**无人认领会被重新派发（`OPTIMIZATION_ACTION_DISPATCH_GRACE_MINUTES`）
- `executing` 超过 **30 分钟**视为**结果未知**（`OPTIMIZATION_ACTION_EXECUTION_TIMEOUT_MINUTES`）
- 可重试的 provider 失败最多 **3 次**（`OPTIMIZATION_ACTION_MAX_ATTEMPTS`）

动作类型只有两种：`budget_update`、`campaign_pause`。
权限项三种：`budget_increase`、`budget_decrease`、`campaign_pause`。

## 授权门：18 种拒绝原因

这是本模块最核心的测试面。每次动作执行前都要过授权检查，`OPTIMIZATION_AUTHORIZATION_REASONS` 穷举了所有可能结果：

| 分类 | 原因 | 含义 |
|---|---|---|
| 通过 | `authorized` | 唯一的放行值 |
| **运行态** | `run_not_running` | run 不在 running 状态 |
| | `campaign_not_active` | campaign 不是 active |
| **时间窗** | `outside_time_window` | 不在允许的时间窗内 |
| | `quiet_hours` | 处于客户设定的静默时段 |
| | `risk_control_only_window` | campaign 激活后 **2 天内**（`OPTIMIZATION_RISK_CONTROL_ONLY_DAYS`）只允许风险控制类动作 |
| **目标** | `optimization_target_missing` | 没有优化目标 |
| | `provisional_target_no_scale` | 目标是临时的，不允许放量 |
| **权限** | `action_not_allowed` | 该动作不在授权范围 |
| | `risk_class_not_allowed` | 风险等级超出授权（`low`/`medium`/`high`） |
| **证据** | `evidence_incomplete` | 证据不足 |
| | `stale_action_baseline` | 动作基线已过期 |
| **playbook** | `playbook_action_mismatch` | 动作与 playbook 不符 |
| | `playbook_snapshot_incomplete` | playbook 快照早于动作清单，**fail closed** |
| **限额** | `daily_action_limit_reached` | 当日动作次数上限 |
| | `daily_budget_change_limit_reached` | 当日预算变更次数上限 |
| | `budget_change_limit_exceeded` | 单次变更幅度超限（`maxDailyBudgetChangeCents`） |
| | `budget_ceiling_exceeded` | 预算天花板 |

**任何一条失效都意味着系统可能在不该动的时候动客户的钱。**

## 前置条件

- active org 明确，目标 campaign 处于 `active`。
- enrollment 的授权范围（authorized scope）、安全限额（safety limits）、优化目标、静默时段已记录为基线。
- 钱包余额、当前 campaign 预算、当日已执行动作次数已记录为基线。
- **执行任何会真实改预算或暂停投放的动作前，必须有明确授权**——这是 `irreversible/high_impact` 级别。
- 测试环境下 provider（广告平台）是否真实接受变更需先确认；`OPTIMIZATION_PROVIDER_VERIFICATION_STATUSES` 为 `unavailable` 时相关断言记 `Blocked`。

## Browser 观察点

- Dashboard campaign 页的自动优化区块：run 状态、Accepted Target、Authorized Scope、**Safety Limits**、历史动作记录。
- Admin 的 optimization review 队列：待复核决策、business evidence、optimization target、复核对话框。
- 复核结果对客户侧的传播：预算是否真的变了、是否收到 `campaign.optimization_budget_updated` 通知。
- 钱包与 reservation 是否随预算变更同步。
- 广告平台侧的实际预算值（能访问时）。

## Page Signals

| Surface | URL pattern | Required visible anchors | Optional anchors | Wrong-page signals |
|---|---|---|---|---|
| 客户侧优化区 | Dashboard campaign 详情 | run 状态；Accepted Target；Authorized Scope；Safety Limits | 历史动作、下次分析时间 | 手动 pause/resume 控件（属 lifecycle） |
| Admin 复核队列 | Admin optimization-review 路由 | 待复核决策列表；campaign 标识 | risk class、evidence window | campaign 审核队列（属 admin-review） |
| Admin 复核详情 | 复核对话框 | business evidence；optimization target；verdict 选项 | playbook 引用 | 无 evidence 的空对话框 |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| OPT-ACT-001 | 读取 enrollment 与授权范围 | campaign 已开启优化 | 返回 target / scope / limits / quietHours | read | 刷新一次；仍缺则查 API |
| OPT-ACT-002 | 开启自动优化 | campaign active，客户授权明确 | enrollment `pending_activation → started` | **授权系统改客户预算** | 明确授权后执行；记录原始 enrollment 状态 |
| OPT-ACT-003 | 控制 run | run 存在 | `pause` / `resume` / `stop` 生效 | reversible | 超时先只读核验，不重按 |
| OPT-ACT-004 | 读取 decision 与 action 历史 | 有 run | 返回决策链与执行结果 | read | 按异步预算等待 |
| OPT-ACT-005 | Admin 复核决策 | 决策处于 `pending_review`，授权明确 | verdict 落为 `as_submitted` / `with_edits` / `rejected` / `override` | **high impact** | 记录复核人与结果，立即核验传播 |
| OPT-ACT-006 | 核验动作执行结果 | 有 `authorized`/`executing` 动作 | 返回终态、预算实际值、平台侧值 | read | 超 30 分钟仍 executing → `action_unknown` |
| OPT-ACT-007 | 构造触发授权拒绝的条件 | 可控地制造静默时段/超限等 | 返回对应的拒绝原因，**动作未执行** | read/reversible | 确认预算和平台侧均未变化 |

## Facts

| ID | Meaning | Source surface | Shape | Freshness |
|---|---|---|---|---|
| OPT-FACT-ENROLLMENT | 授权与目标 | UI/API | `{status, target, authorizedActions[], riskClass, limits, quietHours}` | 每次授权变更后 |
| OPT-FACT-RUN | 运行状态 | UI/API | `{status, startedAt, expiresAt}` | 每次控制动作后 |
| OPT-FACT-CYCLE | 分析周期 | API | `{status, openedAt, decidedAt?}` | 周期结束后 |
| OPT-FACT-DECISION | 决策 | Admin/API | `{status, outcome, reason?, verdict?, reviewerRef?}` | 复核后 |
| OPT-FACT-ACTION | 执行动作 | API | `{type, status, attempts, reason, beforeValue, afterValue}` | 每次动作后 |
| OPT-FACT-BUDGET | campaign 实际预算 | UI + campaign + 平台 | `{internalCents, platformCents?, changedAt}` | 动作前后分别读取 |
| OPT-FACT-LIMITS | 当日已用额度 | API | `{actionsToday, budgetChangesToday, cumulativeChangeCents}` | 每次动作前 |

## 断言目录

| ID | Type | Applies when | Expected | Observe | Required evidence | Failure exclusions |
|---|---|---|---|---|---|---|
| OPT-001 | exact | enrollment 已建立 | 客户侧展示的 Accepted Target、Authorized Scope、Safety Limits 与 API 中的 envelope 完全一致 | UI + API | 两侧字段对照 | envelope 刚更新尚未同步 |
| OPT-002 | negative | 任一授权条件不满足 | 动作**不执行**，记录对应的 授权检查结果字段（`optimizationAuthorizationReasonSchema`，取值见下表），预算和平台侧**均无变化** | API + 平台 | 拒绝原因、动作前后预算 | 条件实际满足；并发的合法动作 |
| OPT-003 | negative | 处于 quiet hours | 拒绝原因为 `quiet_hours`，不执行任何动作 | API | 时间窗配置、拒绝记录 | 时区解析差异需先排除 |
| OPT-004 | negative | campaign 激活后 2 天内 | 仅允许风险控制类动作；其余拒绝原因为 `risk_control_only_window` | API | 激活时间、动作类型、拒绝记录 | 已超过 2 天 |
| OPT-005 | exact | 单次预算变更 | 变更幅度 ≤ `maxDailyBudgetChangeCents`；超出时拒绝原因为 `budget_change_limit_exceeded` | API + 预算前后 | limits、变更量 | 限额未配置（此时应有其它兜底） |
| OPT-006 | negative | 当日动作次数达上限 | 拒绝原因 `daily_action_limit_reached`；**不得绕过** | API | 当日计数、拒绝记录 | 跨自然日重置 |
| OPT-007 | negative | playbook 快照不完整 | **fail closed** —— 拒绝原因 `playbook_snapshot_incomplete`，不执行 | API | 快照状态、拒绝记录 | 属于 override 路径（不带 playbook） |
| OPT-008 | cross_surface | 预算变更已执行 | 内部预算、客户侧展示、平台侧实际值三者一致 | UI + API + 平台 | 三方数值 | 平台传播窗口内；平台侧不可访问时记 Blocked |
| OPT-009 | state_transition | Admin 复核 | verdict 正确落库，并向客户侧和 action 链传播 | Admin + 客户侧 | 复核前后状态 | eventual consistency 未超预算 |
| OPT-010 | eventual | 预算被自动更新 | 触发 `campaign.optimization_budget_updated` 通知，且金额准确 | 通知审计 | delivery 记录、金额 | 客户关闭了对应通知偏好（应记 `skipped`） |
| OPT-011 | negative | action 执行超 30 分钟 | 视为**结果未知**，不重复派发扣款/变更 | API | 动作状态、重试次数 | 已明确失败并进入重试 |
| OPT-012 | negative | provider 返回可重试失败 | 最多重试 3 次后记为 `failed`，不无限重试 | API | attempts 计数 | 不可重试错误应立即 failed |
| OPT-013 | negative | run 已 stop/expire | 不再产生任何新动作 | API | run 状态、动作时间线 | 停止前已 authorized 的动作合法完成 |
| OPT-014 | exact | run 持续时间 | 不超过 31 天，到期进入终态 | API | startedAt / 终态时间 | 客户主动续期（若产品支持） |
| OPT-015 | cross_surface | 预算变更影响资金 | 钱包 reservation 随新预算同步，不出现占用与预算不一致 | wallet + campaign | 前后 reservation | 结算窗口内 |

## 副作用与恢复

`OPT-ACT-002`（开启优化）、`OPT-ACT-005`（Admin 复核）、以及任何触发真实 `budget_update` / `campaign_pause` 的路径都属于 **irreversible / high_impact**：

- 它们会**真实改变客户预算或停止投放**，效果越出本环境边界（会推到广告平台）。
- 执行前必须取得明确授权，且只对本轮明确的测试对象执行一次。
- 超时或中断记 `action_unknown`，**下一动作必须是只读核验**：查 action 状态、内部预算、平台侧预算。**禁止重试**——重复的 budget_update 会叠加。
- 测试结束前把预算恢复到原值，并用新的只读观察验证；无法恢复时记 residual entity 与人工下一步。
- 构造拒绝条件（`OPT-ACT-007`）优先使用只读或可逆手段，不要为了触发限额而真的连续改预算。

## Bug 判断知识

### 高置信 Bug

- 任一授权拒绝原因**未生效**：本该拒绝的动作实际执行了，预算或投放状态发生变化。
- 客户侧展示的 Safety Limits 与实际执行时采用的限额不一致。
- 单次或当日累计变更超过授权限额。
- `playbook_snapshot_incomplete` 时没有 fail closed，而是放行。
- quiet hours 或 risk-control-only 窗口内执行了非风险控制动作。
- 同一 action 被重复执行导致预算叠加。
- run 已 stop / expire 后仍产生新动作。
- 预算变更后钱包 reservation 未同步，出现资金占用与预算长期不一致。
- 自动改了预算但没有任何客户可见记录或通知。

### 风险或待确认

- 平台侧实际预算无法访问，只能验证到内部值。
- 决策质量（改得对不对）本身——没有明确产品规则时只记 UX/risk，不判 Bug。
- `provisional_target_no_scale` 的判定条件尚无文档，需产品确认。

### 不能直接判 Bug

- 动作被拒绝且拒绝原因合理 —— 这是授权门在正常工作，**不是失败**。
- 分析周期没有产出动作（`no_change`）—— 合法结果。
- 测试环境下广告平台不真实生效，平台侧数值为空或不变。
- `executing` 处于 30 分钟窗口内尚未终结。

## 已知缺口

- **`business_file/` 完全没有自动优化文档**，本模块全部来自代码，所有断言仅为 `draft`。
- 授权限额的**具体数值**（每日次数上限、预算天花板的默认值）未在常量中固化，需从实际 envelope 读取。
- `playbook` 的内容和来源未建模。
- 风险等级（low/medium/high）的划分规则未知。
- 尚未通过真实 ticket 试跑验证任何断言。
- 与 `campaign-lifecycle` 的 `pause` 边界需确认：自动 pause 是否复用同一条状态转换、`allowedActions` 是否受影响。

## 模型回流

升级到 `pilot` 需要：至少一次真实的 enrollment → cycle → decision → action 完整链路证据，以及至少两条授权拒绝原因的实测。

升级到 `active` 还需要产品侧对授权规则的书面确认——**在此之前，本模块的断言只能用于发现和提问，不能单独支撑 Product bug 结论**。

不得写入模块：客户真实预算数值、广告账户标识、平台凭据。
