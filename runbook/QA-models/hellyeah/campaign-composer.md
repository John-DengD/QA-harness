---
id: hellyeah.campaign-composer
type: module
product: hellyeah
surfaces: [customer-dashboard, api]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.campaign-agent, hellyeah.creative-studio, hellyeah.wallet-payment, hellyeah.campaign-launch]
---

# Campaign Composer（Campaign 编辑器）

## 业务目标与边界

用户在 Dashboard 审核和编辑 Agent/draft 产物，看到真实将要提交的平台、预算、日期、targeting、creative、landing page 和 readiness，并在满足 gate 后进入 Launch。

## Ticket 路由信号

`composer`、`campaign editor`、`readiness rail`、`dry-run`、`budget`、`schedule`、`targeting`、`landing page`、`Import from Studio`、`Retry Check`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| COMPOSER-S01 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| COMPOSER-S02 | `sources/hellyeah/business_file/managed-ads/launch-flow.md` | observation | historical snapshot, synced 2026-08-05 |
| COMPOSER-S03 | `sources/hellyeah/product-memory.md` | risk | current guidance |
| COMPOSER-S04 | `sources/rulings/2026-10-13-pr1217-k1-switch-back.md` + `sources/rulings/2026-10-13-pr1217-k2-fullauto-metric.md` (PR-1217-K1、K2（QA-1149，staging，QA 负责人裁定；工作台 W-20261014-20、21）) | authority | confirmed 2026-10-13 |
| COMPOSER-S05 | `sources/rulings/2026-10-14-composer-qa-1157.md` (QA 负责人 2026-10-14 裁定（工作台 W-20261014-13、51；对应人工提单 QA-1157）) | authority | confirmed 2026-10-14 |
| COMPOSER-S06 | `sources/rulings/2026-10-15-composer-google-draft-tracker-rules.md` (QA 负责人 2026-10-15 口述并确认：Google 草稿类型（Search / PMax）× 目标 × tracker 三种状态（没装 / waiting / live）的规则（本会话；PR-1327 那一轮环境给错，相关两条 bug 作废）) | authority | confirmed 2026-10-15 |
| COMPOSER-S07 | `hellyeah-v2` origin/staging `970cf08`：`packages/shared/src/constants/managed-ads.ts`（`CAMPAIGN_GOAL_CATEGORIES`、`requiresConversionTracker`、`resolveGoogleBiddingStrategy`）、`schemas/campaign-generation.ts`（campaignType） | observation | 2026-10-15 读取；只说明实现与枚举，不定义 Expected(原标注 code_observed) |

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Composer | campaign draft/editor route | campaign identity；editable sections；readiness summary | campaign detail read-only page |
| Creative picker | composer popup | Studio/reference choices；selected set | standalone Studio detail |
| Readiness rail | composer | creative/ad copy/budget rows；Launch state | raw internal check IDs |
| Top-up dialog | composer/wallet modal | exact shortfall；amount；wallet context | unrelated generic payment page |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| COMPOSER-ACT-001 | 打开并读取 persisted draft | current draft/org known | UI fields 与 artifact 对齐 | read | 重载一次，仍旧则查 API |
| COMPOSER-ACT-002 | 修改一个 plan 字段 | field 可编辑 | readiness stale→recheck，相关派生事实更新 | reversible | 恢复原值 |
| COMPOSER-ACT-003 | 导入/替换 Creative Set | compatible set ready | preview/copy/readiness 使用选中 set | reversible | 重新选择原 set |
| COMPOSER-ACT-004 | 执行 readiness/dry-run | draft facts 完整 | 返回完整 checks 和 funding gap | read | 失败保留旧结果但禁用动作 |
| COMPOSER-ACT-005 | 打开 gap top-up | funding shortfall | 预填 exact gap，完成后重新核验 | financial | 委托 wallet module；不重复提交 |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| COMPOSER-FACT-DRAFT | 持久化 draft | API/artifact | `{platform,type,objective,targeting,dates,budget,landingPage}` |
| COMPOSER-FACT-UI | 当前编辑器值 | UI | 与 DRAFT 同维度 |
| COMPOSER-FACT-CREATIVE | 选中素材/文案 | UI/API | `{setRef,platform,copy,imageFormats,readiness}` |
| COMPOSER-FACT-READINESS | dry-run checks | UI/API | `{status,checks[],stale,checkedAt}` |
| COMPOSER-FACT-FUNDING | 钱包与 gap | UI/wallet | `{availableCents,requiredCents,gapCents}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| COMPOSER-001 | cross_surface | draft 打开 | UI 值与 persisted draft 一致 | DRAFT + UI | re-ground/reprice 尚在进行 |
| COMPOSER-002 | state_transition | 字段编辑 | 相关 readiness 和派生值失效并重算，不沿用旧结果 | before-after READINESS | 编辑未提交；debounce 未完成 |
| COMPOSER-003 | negative | readiness stale/error/offline | Launch 和 Top Up 保持锁定并提供 Retry/恢复提示 | READINESS + screenshot | 仅 advisory check 明确非阻塞 |
| COMPOSER-004 | exact | wallet shortfall | gap = required - available，Top Up 预填同一金额并符合上下限 | FUNDING + dialog | 并发余额变化后尚未刷新 |
| COMPOSER-005 | cross_surface | 选择 Creative Set | 平台、copy、landscape/square 和 preview 与同一 set 对齐 | CREATIVE + UI | Search 合法只消费 text copy |
| COMPOSER-006 | negative | PMax | 不展示/提交 keyword；保留当前支持的 demographics | DRAFT + UI/API | legacy read-only row |
| COMPOSER-007 | visible | invalid copy/landing page | readiness 每项给出可定位、可修复原因，不暴露 raw check id | READINESS + UI | 纯网络错误 |
| COMPOSER-008 | exact | targeting 无限制 | UI 使用 All/Worldwide 语义，不伪造枚举限制 | DRAFT + UI | 用户明确枚举全部选项导致真实 narrowing |
| COMPOSER-009 | negative | 用户手工编辑过长字段 | 不静默截断；阻止并显示限制 | UI + DRAFT | import 流程按正式规则预裁剪 |
| COMPOSER-010 | state_transition | 已经 Switch to Traffic、尚未 launch 的草稿，此时刷新或重新打开草稿（PR #1327 后只有 PMax 草稿有切换按钮，见 COMPOSER-013；本断言需在当前 staging 上按 PMax 切换路径重新验证） | 仍提供 Switch Back；单标签单用户保存成功，不出现 "updated elsewhere" / 409 自冲突；Launch 不被保存失败挡住 | 刷新前后 DRAFT goal 与 revision、保存响应、Switch Back 与 Launch 可见性 + 本 Case 视频 | 确有第二个标签或另一用户在同时编辑同一草稿 |
| COMPOSER-011 | state_transition | 没装 tracker 的 PMax Sales / Signups 草稿，用户点切换按钮并在确认弹窗里确认 | 草稿切到 Search + Traffic（按点击出价）是预期行为；必须经过确认弹窗，不能静默改变类型 | 切换前后 DRAFT campaign type / goal / bidding + 弹窗 + 本 Case 视频 | 用户取消了弹窗 |
| COMPOSER-012 | exact | tracker 没装或 waiting（装了但还没收到访问）的组织请求 Sales / Signups，agent 生成的是 **Search** 草稿 | 草稿直接是 Traffic 目标（Search + Maximize clicks）；**没有** Switch to Traffic / Switch Back 按钮；Launch Readiness 不因 conversion tracking 拦 launch | DRAFT goal / type / bidding + READINESS + UI 截图 | 组织其实已装 tracker 且收到过访问（那时应保持 Sales / Signups） |
| COMPOSER-013 | negative | 没装 tracker（或已装但还没收到首次访问）的组织，草稿是 **PMax** 且目标为 Sales / Signups | 不允许 launch：Launch Readiness 显示 Conversion tracking 阻塞，服务端 launch 也拒绝；页面提供切换按钮；出路只有两条：装好 tracker，或切换成 Search（Traffic，见 COMPOSER-011） | READINESS + launch 响应 + UI 截图 | tracker 已收到首次访问 |
| COMPOSER-014 | negative | tracker 为 live（已收到访问）的组织，Sales / Signups 草稿（Search 或 PMax） | 保持 Sales / Signups；Launch Readiness 不因 conversion tracking 拦 launch；**没有**切换按钮；tracking 卡片只显示一行 "tracker live on …"，不声称已回报购买 / 注册 | DRAFT + READINESS + UI 截图 | tracker 实际未收到访问（那时属于 waiting） |

**断言的可用范围**：`COMPOSER-011`、`COMPOSER-012`、`COMPOSER-013`、`COMPOSER-014` 来自 COMPOSER-S06（QA 负责人 2026-10-15），可以单独支撑 ProductFail（COMPOSER-011 由 2026-10-14 的「PMax 不得改写为 Search」改为现行规则）。`COMPOSER-010` 来自 COMPOSER-S04（2026-10-13 裁定）；2026-10-15 曾扩展到 Signups 草稿，因依据的 PR-1327 测试环境给错已撤回，**在当前 staging 上按 PMax 切换路径重新验证前，只能作为风险提示，不能单独支撑 ProductFail**。其余断言仍受模块 `status: pilot` 限制，失败时需要 ticket、用户确认或其它当前有效证据才能判 ProductFail。

**Google 草稿的类型与目标（COMPOSER-S07，实现事实）**

- campaign type：`search`、`pmax`。`display` 只用于读取旧数据，新建不可用。
- goal：`traffic`、`signups`、`sales`、`leads`（只有这 4 个）。
- 需要 tracker 的只有 Google 的 `sales`、`signups`；`leads` 只做提示不拦（线索表单自己回报提交），`traffic` 从不需要。
- 出价：`traffic` 且不是 PMax → Maximize clicks；其余都是 Maximize conversions（PMax 没有按点击出价的方式，Traffic 目标的 PMax 也按转化出价）。
- Meta 暂不在本模块范围内。

**测试矩阵：转化追踪门禁（Google，按 `references/case-matrix.md`）**

目标 Sales / Signups（需要 tracker）。每格看 4 个观察点：门禁提示 / launch 是否被拦（UI + 服务端）/ 是否有切换按钮 / 点按钮后。tracker 三种状态：没装（missing）、waiting（装了但还没收到过访问，`firstEventAt` 为空）、live（正在收到访问）。

| tracker \ 类型 | Search | PMax |
|---|---|---|
| 没装 | 生成即为 Traffic（Search + Maximize clicks）；不拦 launch；**没有**切换按钮（COMPOSER-012） | 拦 launch（UI + 服务端）；有 "Draft as Traffic" 按钮；确认后切成 Search + Traffic（COMPOSER-011、013） |
| waiting | 同「没装」：生成即为 Traffic；不拦 launch；**没有**切换按钮（COMPOSER-012） | 拦 launch；卡片提示打开一次网站唤醒 tracker，同时有 "Draft as Traffic" 按钮（COMPOSER-013）；提示文案不应让用户再去安装 |
| live | 保持 Sales / Signups；不拦 launch；**没有**切换按钮；卡片只有一行 "tracker live on …"（COMPOSER-014） | 保持 Sales / Signups；不拦 launch；**没有**切换按钮（COMPOSER-014） |

Leads 只提示不拦，Traffic 不出现门禁（COMPOSER-S07 代码事实；作为预期使用前需确认）。

## 副作用、Bug 判断与回流

普通编辑可恢复；Top-up/Launch 交给对应模块。高置信 Bug 包括 UI/artifact 不一致、编辑后旧 readiness 仍允许 Launch、gap 计算错误、PMax 提交 keyword、选中 set 与 preview/launch payload 不一致。视觉排列差异无明确合同只记 UX。

**不能直接判 Bug**（COMPOSER-S04）：

- Switch to Traffic 时 Full-Auto 目标指标沿用原数值并换成新口径（例如 "Cost per purchase around $40.00" 变为 "Cost per click around $40.00"），确认弹窗也不列出这一项——**不是 Bug**。Full-Auto 给内部投手使用，数值由投手调整，自动生成的只是参考。
- 同一组织有多个未发布草稿时，Campaigns 首页只展示最新一个——**是设计，不是 Bug**（COMPOSER-S05）。测试要进入较早的草稿时，用只读查询拿到 draft ID 后直接打开，并在报告里写明入口方式。
待真实 ticket 确认响应式页面锚点和 debounce 等待预算。
