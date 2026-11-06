---
id: hellyeah.campaign-agent
product: hellyeah
surfaces: [customer-dashboard, agent-conversation, api]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.onboarding-brand, hellyeah.campaign-composer, hellyeah.creative-studio, hellyeah.wallet-payment]
---

# Campaign Agent

## 业务目标与边界

Agent 根据用户明确请求与当前组织品牌资料生成可审核的 Campaign plan/draft，保持目标、平台、地域、转化、预算、creative 和持久化结果一致。模块验证决策与产物，不把模型文案本身当成功证据。

## Ticket 路由信号

`campaign agent`、`agent session`、`draft`、`plan`、`objective`、`conversion decision`、`targeting`、`forecast`、`memory`、`agent artifact`、`chat launch`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| AGENT-SRC-001 | `sources/hellyeah/business_file/aima/specialists/campaign.md` | observation | historical snapshot, synced 2026-08-05 |
| AGENT-SRC-002 | `sources/hellyeah/business_file/aima/user-flow.md` | observation | historical snapshot, synced 2026-08-05 |
| AGENT-SRC-003 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| AGENT-SRC-004 | `sources/hellyeah/product-memory.md` | risk | current guidance; newer runtime rules require source recheck |

## 状态模型

`PLANNING → CREATIVE → BUDGET → FUNDING? → LAUNCH → MANAGE`。Plan、creative direction、budget 是独立确认边界。Search 默认；PMax 仅在明确视觉/图片意图时选择。当前运行时行为可能较旧 AIMA 文档更新，ticket 涉及 Agent Runtime 时必须核对目标 PR/当前模块来源。

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Agent conversation | Dashboard launch/agent route | 用户消息；Agent 进度/结果 | 静态 campaign detail |
| Draft artifact | Campaign draft/plan route | objective、platform、targeting、budget/creative 区域 | 无关联 turn 的旧 draft |
| Review panel | Campaign review/editor | editable persisted plan | 只有自然语言回答无 artifact |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| AGENT-ACT-001 | 提交明确 campaign 目标 | profile/org ready | 生成一次 grounded plan/draft | artifact creation | 超时后先查 conversation/artifact |
| AGENT-ACT-002 | 调整 plan 字段 | 已有当前 turn artifact | artifact 更新并保持未改字段 | reversible | 保存 before/after |
| AGENT-ACT-003 | 选择/生成 creative direction | plan 已确认 | creative draft 与 campaign context 关联 | generation | 超时查 job/set，不重复生成 |
| AGENT-ACT-004 | 确认预算/日期 | creative 已保存 | total budget/window 被持久化 | reversible before launch | 在 review panel 修改 |
| AGENT-ACT-005 | 读取 artifact coherence | 有 conversation/turn/draft | 返回同一 turn 的结构化事实 | read | 无 artifact 时 Inconclusive/ProductFail 需看工具结果 |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| AGENT-FACT-REQUEST | 用户明确请求 | conversation | `{goal, platformIntent?, locationIntent?, constraints}` |
| AGENT-FACT-PROFILE | 当前品牌上下文 | profile | `{orgRef, offer, audience, website, geography}` |
| AGENT-FACT-PLAN | 持久化 campaign plan | artifact/API | `{objective, platform, type, conversion, targeting, dates, budget}` |
| AGENT-FACT-CREATIVE | 关联 creative 决策 | artifact/Studio | `{direction, setRef?, copyRefs, imageRefs}` |
| AGENT-FACT-PROVENANCE | 生成来源 | turn/artifact | `{conversationRef, turnRef, model?, guideVersion?}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| AGENT-001 | cross_surface | Agent 完成 draft | 自然语言摘要与持久化 PLAN 一致 | REQUEST + PLAN + UI | UI 显示旧 artifact |
| AGENT-002 | exact | 用户明确平台/地域/目标 | 明确请求优先，不被 profile/default 覆盖 | REQUEST + PLAN | 平台不支持且 Agent 明确降级 |
| AGENT-003 | negative | 用户未要求 visual/PMax | 不因行业或目标擅自选择 PMax | REQUEST + PLAN | 当前 ticket 明确改变路由规则 |
| AGENT-004 | cross_surface | plan 调整后 | keywords/targeting/forecast/description 使用同一新上下文 | PLAN before-after + UI | 异步 re-ground 尚未完成 |
| AGENT-005 | exact | 生成 artifact | objective 和 conversion decision 结构完整且业务语义一致 | PLAN/API | 旧 artifact schema；目标版本不适用 |
| AGENT-006 | negative | 同一 turn create 成功 | 不重复创建第二个 draft/plan | PROVENANCE + artifact list | 用户明确要求多个方案 |
| AGENT-007 | cross_surface | creative 已生成 | CREATIVE 与 platform/type/landing page 匹配 | PLAN + CREATIVE | job partial/仍在生成 |
| AGENT-008 | negative | Agent 工具返回 error | 不宣称成功，不盲目重试副作用 | conversation + artifact facts | 已证明调用未发出 |
| AGENT-009 | exact | Search campaign（或任何依赖关键词信号的 campaign）生成关键词 | 关键词覆盖四类策略：**brand**（保护品牌流量）、**competition**（获取竞品流量）、**general**（覆盖产品相关主题）、**negative**（排除误导点击与预算浪费）。缺类即为质量不达标 | PLAN.targeting/keywords + UI | 关键词全量列表（按四类归类）、profile/offer 上下文 | campaign 类型不消费关键词（如 PMax）；ticket 明确只测单一类别 |

> **AGENT-009 是可判 Bug 的质量门（2026-09-20 用户确认）**，不是软性建议。关键词只要「有内容、能 launch」但四类覆盖不全，按产品质量 Bug 处理。
> 判定时按语义归类，不要求产品在 UI 上显式标注类别。negative keywords 若产品当前无生成能力，记 `model_gap` 并向用户确认，不直接判 Bug。
> 复杂客户场景可能需要人工或 Marco review 兜底，这不改变自动化判定口径。

## 副作用、Bug 判断与回流

Draft/create/generate 是副作用，超时后先查 artifact/job。高置信 Bug 包括明确请求被覆盖、摘要与 artifact 矛盾、同 turn 重复创建、跨 campaign memory 污染。模型策略质量若无当前规则只记 UX/risk。已知缺口：当前 Eve Agent Runtime 与旧 AIMA Specialist 文档存在演进，需要以 ticket/目标部署确认适用合同。
