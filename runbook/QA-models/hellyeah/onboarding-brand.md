---
id: hellyeah.onboarding-brand
product: hellyeah
surfaces: [customer-dashboard, api, aima]
status: pilot
version: 1
last_reviewed: 2026-10-19
related_modules: [hellyeah.auth-organization, hellyeah.campaign-agent, hellyeah.creative-studio]
---

# Onboarding & Brand

## 业务目标与边界

用户为当前组织识别正确业务、完成品牌研究、审核并保存可供 Campaign 与 Creative 使用的品牌资料。覆盖 identity、research、review、edit、resume 和品牌资产，不覆盖后续 campaign 生成质量。

## Ticket 路由信号

`onboarding`、`brand research`、`website/domain`、`business candidate`、`brand profile`、`logo`、`brand color`、`research run`、`Talk to a strategist`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| ONBOARD-SRC-001 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| ONBOARD-SRC-002 | `sources/hellyeah/business_file/aima/brand-research.md` | observation | historical snapshot, synced 2026-08-05 |
| ONBOARD-SRC-003 | `sources/hellyeah/business_file/aima/brand-research/data-model.md` | observation | historical snapshot, synced 2026-08-05 |
| ONBOARD-SRC-004 | `sources/hellyeah/user-dashboard/product-memory.md` | risk | current guidance |
| ONBOARD-SRC-005 | `sources/hellyeah/version-history.md` | timeline | current timeline |

## 状态模型

<!-- 2026-09-20 重写：原有的 identity_input / candidate_selection / domain_validation /
     brand_review / invalid_domain / research_failed 在代码中零命中，属想象出来的名称，已删除。 -->

### 产品实际状态（代码可查）

```
ResearchRunStatus       queued · processing · complete · failed · superseded · confirmed
TerminalResearchStatus  complete · failed · superseded · confirmed
ResearchCheckpoint      start · fast-pass · deep-pass-progress · deep-pass
```

来源：`apps/api/src/modules/onboarding/state.ts`。

两个要点：

- **研究分两阶段**（`fast-pass` / `deep-pass`），意味着「研究完成」可能有两个时间点，等待预算应分档，不能用单一超时。
- **有 `superseded` 状态** —— 研究被新的一次取代。不是失败，不要按失败判。

已有同 org profile 时允许复用，不跨 org 共享。

### QA 概念阶段（非产品枚举）

*输入识别 → 研究中 → 品牌审核 → 确认*，仅用于组织测试思路。写断言时用上面的实际状态。

## 前置条件

- 登录和 active org 明确；记录是否已有 profile。
- 输入是受控域名/企业名称；不可达域名场景单独测试。
- 研究异步等待预算明确，不能把 loading 当失败。

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Identify | onboarding/business 路由 | website/email 或 business candidate 输入 | Campaign editor |
| Research | onboarding 状态页 | research progress / loading | unrelated global spinner |
| Brand review | onboarding/brand 路由 | business fields；brand kit 区域；confirm/edit | 空白页或别的 org 名称 |
| Brand profile | Dashboard brand 路由 | persisted business fields；logo/colors | onboarding 未完成 gate |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| ONBOARD-ACT-001 | 识别业务 | org/session ready | 输入解析为正确 candidate/domain | reversible | 返回修改输入 |
| ONBOARD-ACT-002 | 发起品牌研究 | candidate 已确认 | researching → brand_review | generation side effect | 超时后按 run/profile 核验，禁止重复 |
| ONBOARD-ACT-003 | 编辑品牌字段/资产 | review/profile 可编辑 | 保存后 profile 反映改动 | reversible | 保存原值，测试后恢复验证 |
| ONBOARD-ACT-004 | 确认品牌 | 必要字段可接受 | confirmed，后续能力可消费 | side effect | 记录 profile 状态，不重复确认 |
| ONBOARD-ACT-005 | 恢复未完成流程 | 有同 org draft/profile | 复用当前组织资料，不重做无关研究 | read/reversible | 核对 last researched/profile facts |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| ONBOARD-FACT-IDENTITY | 用户输入与解析业务 | UI/API | `{input, domain, businessName, candidateSource}` |
| ONBOARD-FACT-RUN | research run 状态 | UI/API | `{runRef, status, failure?}` |
| ONBOARD-FACT-PROFILE | 当前组织品牌资料 | UI/API | `{orgRef, domain, fields, profileStatus}` |
| ONBOARD-FACT-ASSETS | logo/color/font 资料 | UI/profile | `{logos, primaryLogo?, colors, fonts}` |
| ONBOARD-FACT-SOURCES | 研究来源 | review/API | `{sources[], researchedAt}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| ONBOARD-001 | cross_surface | candidate 已确认 | research/profile 对应用户确认的同一业务和 domain | IDENTITY + PROFILE + screenshot | 用户选择错误 candidate |
| ONBOARD-002 | negative | domain 不可达/格式错误 | 明确失败或要求修正，不用无关旧 profile 静默成功 | IDENTITY + RUN | 用户显式选择复用 profile |
| ONBOARD-003 | eventual | research 已发起 | 在等待预算内进入 review 或明确 failed | RUN + progress evidence | provider outage / environment |
| ONBOARD-004 | visible | research 无 brand kit | review 仍展示 brand kit 区并提供 logo/color 补充入口 | ASSETS + screenshot | 当前版本明确移除此能力 |
| ONBOARD-005 | cross_surface | 用户保存编辑 | UI 回读和 profile 持久化一致 | PROFILE/ASSETS before-after | 保存仍 pending；错误 org |
| ONBOARD-006 | negative | 同账号切换 org | profile 不跨组织复用或泄露 | AUTH + PROFILE | 两 org 合法使用相同公开品牌 |
| ONBOARD-007 | state_transition | 已有 incomplete profile 重新进入 | 恢复已有资料，不丢失已保存字段 | PROFILE + RUN | 用户主动重置/research refresh |
| ONBOARD-008 | manual | Talk to a strategist 在范围 | 使用 canonical team 链接 `cal.com/team/hellyeah`，event slug `hellyeah-demo`，时长 15 或 30 分钟（默认 15）；在团队 BD 日历间**轮转**；会议 provider 为 **Google Meet**，确认页与邮件带 Meet 链接 | booking/confirmation evidence；team/event URL；assigned host；会议 location | 测试环境有书面独立 event type |

## Cal.com 预约事实（代码 + 用户确认，2026-09-20）

代码常量见 `packages/shared/src/cal.ts`：

| 项 | 值 | 来源 |
|---|---|---|
| team slug | `hellyeah` | `CAL_TEAM_SLUG` |
| event slug | `hellyeah-demo` | `CAL_EVENT_SLUG` |
| 可选时长 | 15 / 30 分钟 | `CAL_DURATIONS` |
| 默认时长 | 15 分钟 | `CAL_DEFAULT_DURATION` |
| BD 日历轮转 | **成立** | 用户 2026-09-20 确认 |
| 会议 provider | **Google Meet** | 用户 2026-09-20 确认 |

⚠️ 轮转和 Google Meet 是 **cal.com 后台配置，代码里查不到**，只能通过实际预约结果验证。只验证「能选时间并预约成功」不足以放行 —— 必须核对 assigned host 是否轮转、会议 location 是否为 Google Meet、确认邮件是否带 Meet 链接（接团队既有 Read AI 工作流）。

## 副作用、Bug 判断与回流

研究和确认可能覆盖当前 org profile。修改前保存原值；研究超时先查 run/profile。高置信 Bug 包括不可达域名静默产出无关品牌、合法 runtime asset 无法保存、跨 org profile 泄露。单次研究质量偏差或 provider outage 先记风险。模块缺口：稳定页面锚点、研究等待预算和预约后台证据需真实 ticket 试跑后确认。

## 不可测与不设计

| ID | 检查内容 | 处理 | 原因与恢复条件 | 来源 |
|---|---|---|---|---|
| ONBOARD-NT-001 | 没有填写网站的用户在 Overview 看到“无网站”提示（PE-884 的 no-website 状态） | NotApplicable | 所有新用户都必须走完 onboarding，产品里不存在没有网站的新用户；状态不可达。已在 QA 工作台向 ticket 作者确认该状态是否保留 | 用户裁定 2026-10-19（PE-884 复测）；2026-10-20 再裁定：直接丢弃，规划时不排这个 Case |
| ONBOARD-NT-002 | pre-audit 运行中途重启 API 后能恢复 | Blocked | 我们没有 staging 上重启 API 的操作权限；恢复条件：有受控的 API 重启窗口（或沙箱可自行重启） | 用户裁定 2026-10-19（PE-884 复测） |
| ONBOARD-NT-003 | 重新部署环境后重跑 pre-audit 及额度检查 | SkippedByConstraint | 为测试而重新部署环境不合理，属于非常边缘的情况，不设计 Case | 用户裁定 2026-10-19（PE-884 复测） |

## 不能直接判 Bug（人工裁定）

以下是用户（QA 负责人）2026-10-20 对 PE-884 复测结果的裁定。这些情形**不判 Bug，也不作为 Case 的阻塞项**；若 ticket 原文与之冲突，以此裁定为准，除非用户另行说明。

- **ONBOARD-NB-001 · 小站点第三方数据拉不到**：能拉多少显示多少。Key Metrics 出现 No Data 徽标、Findings 更多区域出现小写 "No data" 小块，都是可接受行为（原 bug-02 丢弃）。
- **ONBOARD-NB-002 · onboarding 完成后的落点**：落在 /campaigns 还是 Overview 都不重要，不作判定依据。
- **ONBOARD-NB-003 · pre-audit 与 Overview 的体验细节，当前接受**：
  - 有 X-Ray 的组织切换范围或导航时，Performance 指标栏先短暂（约 0.4–4 秒）显示另一套再翻成转化那套；
  - 新组织 Overview 首次加载先闪现骨架；
  - 320 宽度下 "They also visit" 百分比被卡片内裁剪；
  - 某来源失败时子区块写 "Not enough to read yet"、状态芯片文案；
  - 同一会话里改回已跑过的站点后，短时间仍显示旧站点报告。
  这些记作备注，不返工、不进 Bug 草稿。
- **ONBOARD-NB-004 · 上线前 Overview 的 Campaigns 卡**：只有 onboarding 草稿、还没有上线时，Overview 可以显示空的 Campaigns 卡，不是 Bug（原 bug-01 丢弃，用户 2026-10-20）。
- **ONBOARD-NB-005 · 已知站点没有 Competitors**：没有竞品或竞品广告也可以，不要求 Competitors 卡落地内容；ticket 中「Competitors' ads 落地」的要求不作为判定依据（用户 2026-10-20）。

