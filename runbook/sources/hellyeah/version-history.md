# Hellyeah CLI 版本演进索引

## QA-1120～QA-1123 目标驱动出价与预算预测 — 2026-09-16

- **关联改动**：[PR #1060](https://github.com/finalroundai/hellyeah-v2/pull/1060)；QA-1120 总单及 QA-1121、QA-1122、QA-1123。
- **结论**：Junlong 人工确认测试完成、未发现问题，记录为 QA 通过；不是 Agent 独立实测结论，也不表示已发布。
- **范围**：目标继承与事件选择、出价和类型、预测指标与文案、Google 转化配置。未提供逐项执行证据及实际构建 SHA，不额外推断真实投放效果或全部异常路径覆盖。
- **报告**：[测试完成总结](2026-09-16_10-06_goal-aware-campaign-qa-summary.md)。

> Agent 产品记忆：每次接到新提测单，先读本文件 + 上一版本 result/，带着历史风险点开始测试。

## PE-250 suspended account remains available Bug — 2026-08-26

- **关联工单**：[PE-250](https://linear.app/hellyeah-ai/issue/PE-250/qa-sit-banned-account-teardown-cancel-self-heal-cron-refund-reassign)；PR #845、PR #930。
- **结论**：新增 High priority Bug [PE-259](https://linear.app/hellyeah-ai/issue/PE-259/suspended-google-ads-accounts-are-shown-as-available-for-assignment)，Backlog，分配给 Naman。
- **明确 Bug 事实**：测试数据中的两个 Google Ads `SUSPENDED` 账户仍显示为 `available`；Naman 确认 suspended 账户必须为 `disabled`，`available` 表示可被分配，因此当前状态违反账户池安全语义。
- **风险点与遗留**：UI/内部状态错误已确认；直接调用 assignment API 是否也会接受这两个账户尚未抓取。修复后需同时验证 sync 映射、列表 badge、available 查询、waitlist picker、自动分配和 direct API `409`。
- **草稿与证据**：`PE-250/result/Bug - Suspended Google Ads accounts are shown as available for assignment.md`；`PE-250/evidence/2026-08-26_suspended-account-status-slack-transcript.md`。

## Hellyeah Release 20260820 and creative platform status — 2026-08-20 ~ 2026-08-21

- **明确版本事实**：Release `20260820` 已发布，覆盖 Studio creative workflow、Creative Set 稳定性、Campaign Launch 内置创意生成、Dashboard 移动端适配及发布可靠性改进。
- **Creative Library / Studio**：Ops-managed catalog 和初始 410 个 reference assets 已交付；Studio batch-generation foundation 和图片编辑已完成，但 batch upload、canonical reference integration 与 keep/discard 仍需按实际工单继续验证。
- **测试影响**：后续版本收集应排除 `20260820` 已发布范围；不要把 Creative Library/Studio 后续未完成部分因基础能力已交付而整体判为通过。
- **来源**：HY Slack `1787234665.646119`、`1787282651.740429`、`1787282650.590289`；详见 `QA-Knowledge/daily-radar/2026-08-25.md`。

## Slack production retirement and Admin Team overflow — 2026-08-19

- **明确版本事实**：Legacy AIMA 已正式从 production 退役，发布讨论关联 PR #836。
- **明确 Bug 事实**：Hellyeah Admin Dashboard staging 的 Team Settings 长列表无法向下滚动且内容溢出，团队已要求修复；RBAC 角色细分属于单独的 P2 方向。
- **测试影响**：回归 AIMA 旧入口/API/链接残留；Team Settings 覆盖长列表、不同视口、键盘滚动和 overflow。
- **来源**：HY Slack `1787108782.495049`、`1787020936.162199`；详见 `QA-Knowledge/daily-radar/2026-08-19.md`。

## HEL-1591 / QA-1017 Keyword 缓存 + 配额闸门 + 失败行为 — 2026-08-17

- **关联工单**：QA-1017（父单 QA-1014）。环境：staging API，org FinalRound `24a275fb-a4ee-4f47-9980-434eec58d8b0`，日志 BetterStack source `hellyeah-api-staging-otel`。执行方式：AI + 人工协作。
- **测试结论**：**部分通过。** 缓存存储/失效/命中行为、限流闸门、失败分类在代码层全部成立且单测通过（campaign-agent 43/43，API keywords+throttle+errors 17/17）。但运行时命中路径不可达，工单核心用例「跑两次第二次命中」无法端到端验证。
- **已验证的产品规则**（可作为后续测试判断依据）：
  - 缓存 TTL：discovery 30 天 / forecast 7 天，`expiresAt` 写入时落列
  - **读取按 `expiresAt` 过滤，正确性不依赖 sweeper**；sweeper（每日 04:17，5000/批 × 上限 20 批）只回收存储
  - 两种缓存**共用一张表**，靠键前缀区分（`keyword-planner:` / `keyword-forecast:`）；结构不匹配 `safeParse` 失败 → 退化为 miss，不崩溃
  - **缓存读在限流闸门外面** —— 命中跳过整个 network 分支，结构上不可能排队，也不解析凭证
  - 失败分类**只认错误类型不认 message 字符串**（防文案改动导致静默降级为 `unknown`）
  - 闸门：同客户不并发、间隔 ≥1s、不同客户不互等；排队中的请求会在闸门内二次读缓存
- **风险点与遗留**：
  - **QA-1033 / High / open**：缓存键含 LLM 生成的 seeds（来自 strategy agent 流式输出的 keywords），重复 draft 必然 miss。staging 三条 draft 全 `groundingCacheHit: false`；开发库缓存行印证 finalroundai 两次归一化种子 20 词中 10 词不同、swiprai 15 vs 18。影响：全公司共享 ~1 rps planning 配额几乎得不到缓存保护，每个 draft 都在花配额（配额耗尽是 demo 时真实炸过的故障）。已挂 QA-1014，分配 Wilson。
  - **测试判断陷阱（重要）**：单测里的「命中」是 mock `cache.get` 返回命中行，证明的是「一旦命中行为正确」，**不证明「真实环境能命中」**。后续读到 QA-1017 相关单测通过时不要据此判缓存已放行。
  - 低优未建单：`getKeywordPlannerCacheEntry` 注释「TTL change takes effect on the next read」不准确 —— `expiresAt` 已落列，改 TTL 常量不影响已有行。
  - 观察项未建单：staging 日志 `environment` 字段值为 `"production"`。
- **未覆盖 / 未观测**：
  - 端到端命中（被 QA-1033 阻塞，修复后同 org 连开两个相同 draft 即可补验）
  - 结构不匹配 → miss 无直接测试断言（覆盖缺口，自动化回流候选）
  - sweeper 未观测真实运行（搜 BetterStack `sweep-keyword-planner-cache` 可补；严重度低）
  - 六个失败码未在真实环境观测 —— **主动放弃造场景**：`quota` 要打爆共享配额（等于复现事故且逻辑上反向），`credentials`/`planning_account_missing` 要拆 Nango 或删 ad_account 行，`timeout`/`invalid_input` 无正当触发手段。替代方案：搜 `keywordGroundingCode` / `budgetForecastCode` 反查历史失败
  - staging 库无写权限，缓存行证据取自本机开发库（同代码路径，佐证非替代）
- **下次回归重点**：QA-1033 修复后验端到端命中；QA-1018 真实投放（$20/7 天，预期 CPC 上限 $0.28、花费约 $4.98/25%，欠花为预期非缺陷）
- **报告**：2026-08-17_18-30_qa1017-keyword-cache-quota.md

## Slack release / campaign platform facts — 2026-08-12 ~ 2026-08-14

- **Release `20260812` 已上线**：creative generation Gemini fallback、TinyFish partner story、campaign start-date timezone、refund immediate、review 中 ops edit 等改动进入生产基线。来源：[HY Slack](https://hellyeah-ai.slack.com/archives/C0A17S1531Q/p1786527947904809)。
- **Meta campaign schema split 阶段性合入**：按平台拆 detail table，并迁移 campaign type、targeting、ad copy、setup preview 的读路径。该事实不等同于 QA passed；后续 destructive drop 需要严格部署顺序和 Google campaign 回归。来源：[HY Slack](https://hellyeah-ai.slack.com/archives/C0A17S1531Q/p1786565587824609)。
- **HEL-1591 已部署 staging 并进入 QA**：关键词落地与预算预测当前由 QA-1014 及 QA-1015 至 QA-1018 覆盖，尚未完成。来源：[HY Slack](https://hellyeah-ai.slack.com/archives/C0A17S1531Q/p1786675994964229)。
- **Campaign Agent v1 已 deprecated**：后续方向切换为 hosted conversation agent + versioned skill pack；已交付的 HEL-1591 仍作为现有能力记录。来源：[HY Slack](https://hellyeah-ai.slack.com/archives/C0A17S1531Q/p1786678086919749)。
- **雷达记录**：`QA-Knowledge/daily-radar/2026-08-14.md`。

## 1.2.1-beta.4 / QA-1008 CLI reference-led Creative Sets — 2026-08-11

- **关联工单/PR**：QA-1008；HEL-1507；PR #748。
- **测试范围**：reference 列表/筛选、稳定 ID 与白名单 URL、单图与 Creative Set 生成、Human/JSON 输出、list/view、跨组织隔离、failed/partial 终态；仅同步 CLI 范围。
- **结论**：Pass。正常生成主链路、输入校验、输出契约、组织隔离、policy failure 和人工图片审核均通过；2026-08-12 用户确认 QA-1008 最终放行。任一必需图片 asset 失败时，`--watch` 返回 `creative_failed` / exit 1 是预期；持久化 `partial` 表示仍有 copy 等子任务成功。
- **发现的问题**：无确认产品 Bug。Set `2b3be0e3-32f2-40dd-af46-02e3901063cd` 刷新同一 FinalRound staging Studio 后正常显示；[QA-1012](https://linear.app/hellyeah-ai/issue/QA-1012/cli-generated-creative-set-is-missing-from-the-studio-library) 为 stale UI 导致的 QA 误判，已 `Canceled`。失败图片的 `format: unknown` 暂仅记录为观察项，未单独判 Bug。
- **未覆盖**：rate limit 由用户按原分工自行覆盖，Agent 未重复压测；按用户要求未做 UI 测试。两项均不阻塞用户确认的最终 Pass。
- **2026-08-12 复测（CLI 1.2.1-beta.4，AI 独立执行）**：重跑 references list + category/hook 过滤、三种负路径 reference 报错、`generate set --watch`(reference beehiiv → status complete + landscape/square)、`sets list`(25)/`sets view`、跨 org(切 test inc → list=0、view 拿不到 FinalRound set，无泄漏)——**仍 Pass**。新观察(低优,非阻塞):图片 asset URL 字段名跨命令不一致 —— `generate set` 输出 `images[].url`,`sets view` 输出 `images[].imageUrl`,建议统一。
- **报告**：`Hellyeah_1.2.1/result/2026-08-11_17-49_QA-1008_CLI-reference-led-creative-sets.md`;复测 `Hellyeah_1.2.1/result/2026-08-12_12-33_qa1008-cli-reference-led-creative-sets-retest.md`
- **证据**：`Hellyeah_1.2.1/artifacts/QA-1008/QA-1008-cli-reference-led-evidence.md`
- **QA-Knowledge 判断**：Creative Set 的 `partial` 持久化状态与 `--watch` 的 asset-level `creative_failed` 可同时成立；Studio 只应展示 first-class Creative Set，不展示 standalone text/image job。跨 surface 验证需同时核对 CLI set 类型、组织和持久化详情，并在刷新 Studio 后再判断 library 可见性。

## 1.2.1-beta.4 / QA-1013 Studio 隐藏 unknown-format Creative Set — 2026-08-12

- **关联工单**：[QA-1013](https://linear.app/hellyeah-ai/issue/QA-1013)（QA-1008 子单，Bug/High/Backlog）。由 QA-1008 当时"failed 图 `format: unknown` 仅作观察项"升级坐实的产品 Bug。
- **根因**：前端 `getCreativeSets`（`features/campaigns/launch/sets.ts`）仅按精确 `format === "landscape"/"square"` 塞槽（`newestForFormat`），并 `.filter(cs => cs.landscape || cs.square)` 剔除无槽集；API `format = inferFormat(row) ?? "unknown"`（routes.ts:424），失败图无结果尺寸且顶层 `params.format` 未 stamp 时 → `unknown`。unknown 图两槽都进不去。
- **失效面（共因=unknown 丢槽，区别只在剩几个空槽,且过滤与 status 无关）**：
  - 两图全 unknown → 两槽空 → 整集被过滤，**Studio 不显示**（processing/partial/failed 都一样，连成功 copy 一起隐藏）。复现集 `66e03b8b`（CLI, processing, unknown×2）、`40821131`（QA-1008 partial, unknown×2）。
  - complete 集里完成的那张是 unknown → 一槽空 → `getSetState` 落 `generating` → **卡 processing**。样本 `29cd96ed`。
  - 至少一张保住真 format（如 `a29a4e7d` UI: square+unknown）→ needs attention,可见。
- **与 QA-1012 区分**：QA-1012（complete + 真 landscape/square，刷新后出现）判 stale-UI 属合理；本 Bug 是 unknown 被确定性过滤,刷新也不出现,不重复。
- **复现**：`hellyeah creative generate set --hook problem_solution --platform google --direction 'user star wars element' --reference clickup --watch --json`（FinalRound staging）→ creative_failed → `sets view` 见 unknown×2 → Studio 查无。
- **次要观察**：CLI 集第二张图 job `37808db6` 卡 processing >1min 未落终态,疑似独立的卡住 image job,留待跟进。
- **本地草稿**：`Hellyeah_1.2.1/result/Bug - studio hides creative sets with unknown-format image jobs.md`。
- **2026-08-13 按修复层拆单**：应用户要求把 QA-1013 拆成两条独立 Bug，均挂 QA-1010（Studio 提测单）子单、Bug/High/assignee junlong.deng：
  - [QA-1019](https://linear.app/hellyeah-ai/issue/QA-1019) 前端 —— Studio 用 `.filter(landscape || square)` 当"集是否存在"的判据，导致全 unknown 集消失（与 status 无关）、complete 集卡 processing。修复方向：按 `creativeSetId` 分组渲染，unknown 图作为降级资产暴露。草稿 `Hellyeah_1.2.1/result/Bug - studio drops creative sets when image format is unresolved (frontend).md`。
  - [QA-1020](https://linear.app/hellyeah-ai/issue/QA-1020) 后端 —— `inferFormat(row) ?? "unknown"`：失败图无结果尺寸，只能靠 stamped `params.format`，实测拿不到 → 吐 `unknown`。草稿 `Hellyeah_1.2.1/result/Bug - api reports image format unknown for failed image jobs (backend).md`。
  - **未决点**：代码看似在 `service.ts:459` stamp 了 `format`，但实测行仍是 unknown；raw `params` 从 CLI/API 读不到，需 DB/admin 才能定死。已写入 QA-1020 的 open question，不硬判。
  - QA-1013 保持原状，由用户自行处理（未取消、未加评论）。

## 1.2.1-beta.4 / QA-1008 复测：failed 图 `format: unknown` 已修复 — 2026-08-13

- **结论**：Pass。新生成的 policy 失败集 `e3b82d6f`，两张失败图返回 `landscape` / `square`，**不再是 `unknown`**。对照旧集 `66e03b8b` 仍带两条 `unknown`（历史数据，源头修复不回溯）。
- **验证对象**：PR #794 squash 合入 staging（`d32f1147b`）。开测前确认过 `api-staging` 的 openapi 已含改动、后端部署 `Hellyeah / staging` 成功。
- **根因回顾**：不是「enqueue 时没 stamp」，而是图片 worker 在成功和 Gemini 降级两处**整列覆盖** `params`（写的是事件参数，不含 `kind`/`format`/`flags`）。成功图靠结果尺寸兜回来，失败图无从恢复 → `unknown`。详见 QA-1013。
- **顺带验证**：direction 取最新值的聚合已生效 —— 旧集 `66e03b8b` 现在显示的是用户重试时改成的 `'user star element'`，不是原始值。
- **新观察（低优，未建单）**：`sets` 的 status 把被替换的历史 job 也算进去。`66e03b8b` 当前两张图都 complete，CLI 仍报 `partial`，而 dashboard 的 `getCreativeSets` 只看每个 format 的最新 job（会显示 Ready）—— 同一个 set 两个 surface 状态对不上。
- **未覆盖**：历史 `unknown` 行需 backfill；成功图是否保住 `format` 键从 CLI 侧观测不到（要查 staging 库，本机 psql 连的是另一个库）；前端未验，`staging – hellyeah-dashboard` 的 Vercel 部署 failed（`Deployment was blocked`，Git author `Junlong-bop` 未获 Vercel 授权），`app-staging` 仍是合并前的前端。
- **报告**：`Hellyeah_1.2.1/result/2026-08-13_19-43_qa1008-format-unknown-retest.md`

## 1.2.1-beta.4 / QA-1021 Set review 单一 Try Again + 可编辑 direction — 2026-08-13

- **关联工单**：[QA-1021](https://linear.app/hellyeah-ai/issue/QA-1021)（QA-1010 子单，**Improvement**/Medium/assignee junlong.deng）。来源是用户给的设计改动诉求（截图），**不是测出来的缺陷**，故打 Improvement 而非 Bug，与 QA-1019/1020 两条真缺陷区分。
- **三点诉求**：① 两张图各自的 Try Again 合并成 set 级一个按钮，放 Creative Direction 行右下角，点击直接重试所有失败 format；② 有失败图时 direction 可编辑，重试发送编辑后的值（失败常由 direction 引起，content-policy 报错原文就是 "Adjust the creative direction…"）；③ 左列补 "Creative Direction" 标签，原来 direction 塞在 Brief 行里悬浮无 context。
- **实现现状（2026-08-13 已拆分提交，未 push）**：改动原先和 QA-1019 的修复混在废弃分支 `codex/creative-resilience` 的工作区里，已按修复层拆成两条独立分支，各自基于 `origin/staging`：
  - `junlong/qa-1021-set-review-retry` → `41626a764` *feat(dashboard): single set-level Try Again with an editable creative direction*（只含 `review.tsx`）。
  - `junlong/qa-1019-studio-set-visibility` → `1d668e57f` *fix(dashboard): keep creative sets visible when image format is unresolved*（只含 `sets.ts` + `sets.test.ts`）。
  - 分支命名跟仓库惯例 `<短名>/<票号>-<3~4 词>`（对标 `mohit/hel-1567-creatives-set-grouping`），不用 Linear 自动生成的整句截断名；票号仍在名字里，push 后 Linear 照常自动关联。
  - 两条分支各自独立验证：dashboard typecheck 干净、全量测试 70 files 全绿（A 629 / B 627 tests）。旧分支 `codex/creative-resilience` 无独有提交（creative-engine 改动早已 reset 掉，旧提交仍在 reflog 可恢复），已删除。
  - 注意：dashboard typecheck 前若拉过新 staging，需先跑 `pnpm --filter dashboard generate:rpc`，否则会报一批过期 RPC 类型错误（与本改动无关）。
- **补测（用户自测）**：两个 format 同时失败时"一次点击 → 两次 mutate"、以及编辑后的 direction 确实进入 mutation —— 现有测试只覆盖单 format，用户自行覆盖。
- **本地草稿**：`Hellyeah_1.2.1/result/Improvement - studio set review single try again and editable creative direction.md`。

## release/20260810 QA Summary finalized — 2026-08-11

- **最终发布结论**：GO。本次发布 scope 为 17 个产品 PR，`17/17` 已完成 QA。
- **下次发布**：`#748` 处于 QA Process；`#759`、`#762`、`#768`、`#747`、`#767`、`#730` 尚未进入 QA。以上 7 个 PR 均归下次发布，不阻塞本次发布。
- **长期判定规则**：QA 中与未进入 QA 的 PR 都属于下次发布；当前发布建议只按本次发布分组计算。该结论取代下方 Aug 11 上午“仍在补测、暂不放行”的阶段性状态。
- **QA Summary**：V7，`https://hellyeah.artifact.cafe/a/qa-summary-aug-6-onjtsf`。
- **来源**：Release Scope V5 + 用户于 2026-08-11 对发布分组与 GO 结论的明确确认。

## Slack confirmed fixes and risks — 2026-08-06 ~ 2026-08-11

- **Provisioning model route**：生产 LiteLLM 未启用 Anthropic model alias 曾使 Provisioning Workflow 返回 403；团队已上线 `anthropic/claude-opus-4-8` 到 GPT-5.6 Terra 的 US prod alias 并通过 E2E，仍待业务侧真实重试。若继续 403，下一步核对 Railway 稳定出口 IP 与 WAF allowlist。
- **HEL-1607 / website bug**：团队确认 Hellyeah case study 跳转到 Pinzak 页面，已创建 HEL-1607 跟踪。
- **Search campaign logo**：新 launch flow 的 Search campaign 内容 logo 错配已修复并部署到 staging；后续需做当前 org logo 与跨 org 隔离回归。
- **发布风险**：Aug 10 release scope 被指出有若干 PR 未进入 QA coverage；截至 Aug 11 上午仍在补测，不能仅按 merge 状态放行。
- **来源**：`QA-Knowledge/daily-radar/2026-08-11.md`。

## Hellyeah website production landing page — 2026-08-02

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1785489730.790329`；记录于 Slack Daily Radar `QA-Knowledge/daily-radar/2026-08-03.md`。
- **明确版本事实**：
  - 新版 Hellyeah landing page 已发布到 production：`https://hellyeahai.com`。
- **测试影响**：
  - 涉及官网、转化入口或品牌展示测试时，需要覆盖 production landing page 可访问性、主 CTA、跳转、OG/SEO 展示与移动端布局。
  - `/events` 页面 poster 完整性在当天 Slack 中作为风险信号记录，未作为已确认 bug 写入版本历史。

## 1.2.1 / QA-971 Creative Sets 自动化 + 库 + campaign 选择 — 2026-07-27

- **关联工单/PR**:QA-971;PR #668(commit `7e4a3add`);dev 单 HEL-1332/1414/1416/1430/1431。migration `0058_creative_sets_v2`。上线日 7/24。
- **当前结论**:全部通过,无阻塞、无 Bug、无遗留(ticket 范围 + 补充异常/边界均覆盖)。
- **执行方式**:AI+人工协作(web/admin + Inngest/DB 验证;第二 org 做隔离)。
- **新增功能**:onboarding 审批后**后台异步幂等**生成 starter Creative Sets(不阻塞进入 dashboard);可复用的 Creative Sets **库**(bento 卡/详情/删除/进度态);campaign launcher(Goal→Plan→Creative→Review)按 Search/PMax 就绪度**自动推荐并选中**最强 set(可改选、有 fallback),提交保留 Set ID 归因;生成质量(logo 自然融入 HEL-1430)、策略误报修复(方形概念 HEL-1431)、失败终态化。
- **重点验证(acceptance 要求)**:跨 org 隔离(库/推荐/API 层均拒)、幂等不重复、终态不回退、incompatible/deleted set 提交前拦截、策略不误报、provider 卡死超时 —— 均通过。
- **报告**:Hellyeah_1.2.1/result/2026-07-27_18-32_qa971-creative-sets-automation-library-selection.md

## 1.2.1 / QA-975 Performance Max 长标题(1-5)— 2026-07-27

- **关联工单/PR**:QA-975;dev 单 HEL-1474 / PR #686(commit 16e6e83c2,无 migration)。上线日 7/28。
- **当前结论**:SIT 通过(含 1 个非阻塞 bug,见下),建议按计划 7/28 发布。
- **新增功能**:PMax 从单条长标题升级为**支持 1-5 条**。编辑器改为 "Long Headlines" 列表(加/删、上限 5、90 加权字符校验 CJK 双宽、最低 1 条否则 Launch 禁用);readiness、campaign 详情卡、admin 审核均按多条独立编号行展示。**向后兼容**部署前 legacy 单条 campaign/草稿(无 migration)。生成→导入→编辑器→readiness→launch/扣款全链路验证通过;PMax 编辑器仍无 Short Headline/单 Description(HEL-1473 成立)。
- **发现的 Bug(不阻塞本次发布,已在 Linear 记录)**:在 Google Ads 直接改多长标题 PMax campaign 的 headline 后,external-sync **实际无法把改动同步回本地文案**(确认可复现,非"未覆盖")。触发/复现入口:`sync-external-campaign-edits` / 事件 `campaign/external-sync.requested`。疑似根因:PMax 多长标题的 adCopy 命中 external-sync 里"un-cacheable shape → flag-only 不 apply"分支(见 `external-sync.ts` adCopyChanged 处理),导致只 flag、不写回。不阻塞 7/28 发布,建议作为 follow-up 修复。
- **备注**:dev 已在 dashboard 外用真实 `validateOnly` 证过 Google API 行为(3 长标题→3 assets、6 条 pre-debit 拒绝),本轮只测客户侧界面。

## 1.2.1 / QA-968 New-campaign 预算预设 + $5/天下限 + 7 天默认投放 — 2026-07-24

- **关联工单/PR**:QA-968;dev 单 HEL-1440 / PR #671。staging 门槛:总额 $50、每天 $5。上线日 7/24。
- **当前结论**:通过,无阻塞、无遗留。
- **验收要点**:预算 chips 按门槛过滤(staging = $50/$100+自定义,`$20` 因低于门槛隐藏=预期);默认 $100 / 7 天;$5/天派生下限(总额÷天数)在 dry-run + 真实 launch 双侧拦截,一键 `Set $X` 修复抬到 `max(总额, $5×天数)`;readiness Budget 行合并总额+每天失败无重复行;/launch/config 三端读同一门槛。
- **关键澄清(研发 Wilson 于 QA-968 确认)**:**"开放式/无结束日投放"不是功能** —— 总预算需要投放窗口,清空结束日会被 readiness 以 "end date is required" 挡下(预期,非 bug);$5/天下限对无结束日**故意跳过**(无天数→无每天费率)。→ earlier 关注的"开放式总预算前后不一致"**不成立**,readiness 侧即拦截,不会走到 Google 建预算。
- **报告**:Hellyeah_1.2.1/result/2026-07-24_10-26_qa968-budget-presets-5day-floor-7day-flight.md

## 1.2.1 / QA-960~963 Dashboard Launch: readiness rail + submit-time 扣款 — 2026-07-21

- **关联工单/PR**:QA-960(umbrella)/QA-961(readiness rail)/QA-962(submit 扣款&退款生命周期)/QA-963(并发&幂等);dev 单 HEL-1401;PR #643 + #653;migration 0055。上线日 7/24。
- **当前结论**:通过,无阻塞。web launch flow 的 readiness rail + submit 扣款模型全部子单验收通过。
- **执行方式**:AI+人工协作(用户主导 web+admin;AI 做 CLI 代理审计 + 判定 + 沉淀)。
- **核心变更(已验证)**:**submit 时就扣钱包**(扣完才进 Pending review),approve 不再二次扣款,reject/用户取消(平台创建前)立即全额退,serving 中取消走 48h 延迟退。**推翻 HEL-1166 "submit 不扣款" 旧模型**(product-memory 已更新)。
- **验收要点**:readiness 8 检查正负路径 + funding strip 精确缺口/预填 top-up/免刷新翻 pass;ad_account advisory 不挡;ad_copy 稀疏不 400;$100 钱包两个 $80 只过一个(超额守卫);双击/断网/双 admin approve 幂等;approve 二次扣款=Sev-1。
- **边界项(2026-07-23 与研发协作验证通过)**:①崩溃恢复 funding 自愈 —— 方式二(QA 真实提交 → 研发 DB 回拨 `funding`+`spend_debit=pending` → QA 在 Inngest invoke `recover-stuck-creating-campaigns`):campaign 回 `pending_internal_review`、恰好一笔扣款无二次扣款、worker 幂等。②DB 审计 `count(spend_debit pending)`:回拨后=1、恢复后=0,静息不变式成立。→ **QA-960~963 整批全部通过、无遗留**。
- **报告**:Hellyeah_1.2.1/result/2026-07-21_16-27_qa960-963-dashboard-launch-submit-funding.md

## 1.2.1 / Campaign delivery recovery #532 + #569 + #580 — 2026-07-21

- **关联工单/PR**：#532 postbacks-not-ready detector（无 HEL 号）、#569/HEL-1278 auto end-date extension、#580/HEL-1279 external total-budget reconcile。均 merge staging（2026-07-09 前），prod 未上。
- **当前结论**：三项通过（用户拍板）；#580 核心通过但"超钱包是否需 auto-pause"仍讨论中（open）。
- **执行方式**：AI+人工协作（用户持 Inngest + 只读 Google Ads MCC 触发/观察；AI 做代码分析 + CLI 查询 + 判定）。
- **验证要点**：
  - **#532**：未配增强转化的 ENABLED/已分配账户 → 一次 platform-status sync 后冒 P1 "Google Ads postback setup incomplete"，去重不 flap，配好后 auto-resolve。该设置是 Google 账户端(MCC)配置，Hellyeah 只读不写。
  - **#569**：零花费场景（campaign `31a2d050`）launch 初期真零花费 → 触发 +3 延期，曝光/点击是延期后几小时才来（用户现场时间线）。CLI 确认 delivery endDate 7/22→7/25，Google 7/28=delivery+buffer3，`reserved=budget=$100` 未动（money-never-changes ✓）。延期改持久化 delivery endDate（Hellyeah 可见）；buffer 不持久化只 Google 侧体现（恒差 3 天）。
  - **#580**：Google 改总预算（未超钱包）→ 发 `campaign/external-sync.requested`（`sync-external-campaign-edits` 平时每 4h cron）→ Hellyeah 预算同步 + 钱包按新额重算，无误报。同步走 `total_amount_micros` 直接比对。
- **#580 超钱包已实测确认（open 点，K-2026-07-21-001）**：用户把 Google 预算调超钱包 $945.50 → 同步后 **Google 预算没被改回、Hellyeah 保持旧值、campaign 未暂停、未扣钱包,Inngest 仅写一条操作异常记录**。行为符合代码（只 flag 不拦）。**实测新发现**：只在 Inngest 见异常记录,**admin/Slack 是否有 ops 可见告警未确认** → 超投窗口若无人盯风险更高。待研发确认是否加 auto-pause + failure 的 ops 可见性。
- **未覆盖**：#569 underpacing 场景 + 延期护栏（2 次/7 天/硬 deadline 不延）；#532 auto-resolve（需 Google Admin 权限）；#580 超钱包 failure 的 admin/Slack 告警可见性。
- **报告**：Hellyeah_1.2.1/result/2026-07-21_10-39_campaign-delivery-recovery-532-569-580.md

## 1.2.1 / HEL-1326 + HEL-1333 RSA ad-copy readiness 与规则迁移 PLATFORM_SPECS — 2026-07-20

- **关联工单**：HEL-1326（#614 report RSA ad-copy shortfalls as an `ad_copy` readiness check）、HEL-1333（#618 move RSA text-asset rules into PLATFORM_SPECS）。均已 merge staging（2026-07-09），prod 未上。
- **当前结论**：本轮通过，无阻塞问题。#614 ad_copy 缺项提示、#618 补齐逻辑与编辑器数值均正常。
- **执行方式**：AI+人工协作 —— #614 ad_copy 检查 + 编辑器数值由用户 Web 手动验证；#618 补齐逻辑 AI 用 CLI dry-run 验证。
- **关键认知（测试导航）**：**#614 的 `ad_copy` readiness 只在 Web / validate 端点携带内联 adCopy 草稿覆盖时触发；CLI `--text-id` 路径碰不到**——CLI/creative-job 走 managed-ads build 时 `compactAndPadGoogleText` 会自动把 headline 补齐到 min 3、description 到 min 2（真实内容不够则用兜底短语/带序号填充串凑数），再截到 max 15/4。测 readiness 缺项必须走 Web 或直接打 API，不能用 CLI dry-run。
- **验证要点**：
  - #614：Web 删文案到 headline<3 / description<2 → "Ready to launch" 返回友好 ad_copy 缺项（非修复前 `Couldn't check readiness` + 原始 Zod）；补齐后转 pass。
  - #618：编辑器 max 15/4、字符 30/90、缺项最小 3/2 与 `PLATFORM_SPECS.google.textAssets` 一致；CLI dry-run 拿 2-headline standard 文案（job `451c73d2`）→ `launchable:true`、无 ad_copy 项，证明补齐读 spec 正常。
- **未覆盖**：Creative Studio 单变体稀疏导入触发 ad_copy 缺项（以"编辑删条数"等价覆盖）；直接 API 打 validate 带内联 adCopy（沙箱 token 限制，Web 等价覆盖）。
- **报告**：Hellyeah_1.2.1/result/2026-07-20_16-29_hel-1326-1333-rsa-readiness-specs.md

## 1.2.1 / HEL-1323 Dashboard X-Ray tracker install 风险记录 — 2026-07-15

- **关联工单**：HEL-1323 `[QA Test Request] [SIT] Dashboard X-Ray install: GitHub connect to live events`。
- **当前结论**：Dashboard X-Ray tracker 自动安装链路可跑到 PR/部署阶段，但安装结果不够可信，仍需人工 review、CI/install/build 和二次状态检查兜底。
- **已建 Bug**：
  - HEL-1384：首次 install PR merge 后再次 install 仍生成补漏 PR，说明完成安装状态/完整性检测与二次 audit 语义不清。
  - HEL-1385：tracker install PR 新增 `frontend/package.json` 依赖但漏更新 `frontend/package-lock.json`，导致部署 `npm ci` 失败；已通过手动 lockfile 修复 commit `48f30a1` 恢复部署。
- **风险点**：
  - 生成 PR 需要校验 package manager / lockfile 完整性，依赖变更必须包含匹配 lockfile，并通过目标 repo 的 install/build。
  - 合并部署后的 `/provisioning` 状态验证不能替代 PR 生成阶段的依赖完整性保证。
  - 合并后再次运行 install 时，应先做 install-state / install-integrity 检查；完整安装应 no-op，不完整覆盖应明确呈现为 audit/follow-up improvement。
- **本地 Bug 记录**：
  - Hellyeah_1.2.1/result/Bug Draft - HEL-1323 tracker install is not idempotent after merged PR.md
  - Hellyeah_1.2.1/result/Bug - HEL-1385 tracker install PR omits package-lock update.md

## 1.2.1-beta.3 / HEL-1321 + HEL-1322 campaign launch idempotency 与 ad-account advisory — 2026-07-08

- **关联工单**：HEL-1321 `[SIT] Campaign launch — Idempotency-Key replay dedupe`；HEL-1322 `[SIT] Dry-run advisory ad_account (HEL-1293)`。
- **测试结论**：HEL-1321 通过；HEL-1322 CLI/API dry-run 核心通过。已在 Linear 评论：HEL-1321 comment `54bd6e8d-eee1-4522-b469-9c559f637584`，HEL-1322 comment `03525fc3-94fe-47c3-a575-b5ea397ef755`；未检查 DB。
- **已通过点**：
  - HEL-1321：同一 `Idempotency-Key` 重放返回同一 campaign；跨 org 不串；不同 key、缺 key、超长 key 不误去重；submit 阶段不扣款；用户 Admin approve 后仅扣一次 `$50`；测试 campaign 已取消清理。
  - HEL-1322：新注册 org `b3a2a39f-c897-41a9-ac71-e0d5f97e6ab9` 无 ad account 时，`$50` search dry-run exit 0、`launchable=true`、`ad_account=warn`、`wallet.adAccountAssigned=false`；human 输出显示 `! Ad account`、`1 advisory (non-blocking)`、`Ready to launch`。
  - HEL-1322 true failure 分层：同一无 ad account org 的 `$1000` dry-run exit 1、`launchable=false`，`ad_account` 仍为 `warn`，blocking failure 只有 `wallet_balance=fail`，human 输出显示 `✖ 1 launch precondition failed` 和 top-up fix。
  - HEL-1322 Admin setup-preview：用户在 `Dry-run checks` 中确认 `Ad account — warning`，文案为 `No Google Ads sub account is currently available — one will be assigned when your campaign is approved.`。
- **证据边界**：未检查 DB；HEL-1321 使用 API/CLI 可见 campaign id、wallet 和 Admin approve 结果判断去重与单次扣款，HEL-1322 使用 CLI/API dry-run 响应和 Admin `Dry-run checks` advisory 行的人工确认作为证据。
- **报告**：2026-07-08_16-04_HEL-1321-1322-idempotency-ad-account.md

## 1.2.1-beta.1 / HEL-1301 [SIT] HEL-1176 review/setup 结束日期缓冲 — 2026-07-07

- **关联工单**：HEL-1301（dev HEL-1176 / PR #567）。CLI `hellyeah@beta 1.2.1-beta.1` → api-staging；`REVIEW_SETUP_BUFFER_DAYS` 默认 3。
- **本版本改动**：soft launch（有 --end-date、无 --hard-deadline）推给 Google 的 end_date = 交付结束 +3 天 buffer，但 stored/展示的结束日仍是用户交付日（buffer 不落库）；`--hard-deadline` 关闭 buffer；总预算不被 buffer 抬高；CLI 三行披露。
- **测试结论**：核心行为全部通过，**未发现 bug**；external-sync legacy 按工单界定（HEL-1279 跟进的已知安全过渡态）记未覆盖。
- **已通过点**：
  - CLI 披露：`--hard-deadline` flag 存在；dry-run 达 validate 带 calendarWindow；soft human 三行（Active window / buffer +3 / Google window end+3）；soft JSON calendarWindow 字段齐（calendarEndDate=交付+3、bufferDays 3、isHardDeadline false）；hard-deadline human "none (hard deadline)"、JSON calendarEndDate==deliveryEndDate、bufferDays 0、isHardDeadline true。
  - Google 侧真实：soft `72c46aa2` end_date=交付+3（07-28，用户确认）；**hard-deadline `dd3ca87a` end_date=07-25 未 +3（用户 Google Ads 核对，证明 --hard-deadline 关闭 buffer）**。
  - money/data-integrity：**总预算不被 buffer 抬高**（reserved=total=$50）；**buffer 不落库**（72c46aa2 stored endDate=07-25，仅 Google 07-28）。
  - active budget-edit（用户测）：active 只能改预算、改预算不影响结束日。
- **未覆盖 / 依赖**：active 改结束日→Google buffered end（active 无改结束日入口，不适用）；open-ended 无 --end-date（total budget 强制 end-date，不可达）；external-sync legacy 安全 3 条（需 sync 触发 + Google 状态操纵；且 HEL-1279 已界定为已知安全过渡态、非 bug）。
- **顺带更正（退款入口差异，实测于本轮 cleanup）**：Pending Activation campaign 的取消退款——**Admin cancel 即时全额退，User CLI cancel 走 48h 延迟退**（CLI 只对"从没上 Google 且未扣款"的 pending/rejected 即时零退款；有 platformCampaignId 或已扣款一律 48h）。已同步修正 product-memory 退款形态规则。
- **报告**：2026-07-07_10-52_hel-1301-review-setup-end-date-buffer-sit.md

## 1.2.1-beta.1 / HEL-1300 [SIT] HEL-1166 推迟广告账户分配 + #586 re-open/cancel — 2026-07-06

- **关联工单**：HEL-1300（dev HEL-1166 / PR #581 + re-open/cancel PR #586）。CLI `hellyeah@beta 1.2.1-beta.1` → api-staging；Admin `ops-staging`。
- **本版本改动**：campaign launch 不再当场分配账户/扣款/调 Google，改为先落 `pending_internal_review`（零账户/零扣款/零 Google/零 waitlist）；Admin approve 后才分配账户→建 Google setup（validateOnly→debit→create PAUSED）→自动激活到 active（无第二道门）；新增 reject-with-reason、user withdraw、rejected 的 re-open/cancel 恢复（#586）。
- **测试结论**：主链路 + 核心 money-safety 通过；无新增发布阻断级 bug。故障注入类场景受 test 账户/权限/单一 org 限制未覆盖。
- **已通过点**：
  - Submit（CLI）：dry-run 只读（钱包不变、7 check + calendarWindow）；`launch --yes`→pending_internal_review 且无扣款/无 Google/无账户附着；get/status 正确渲染。
  - Admin：inline approve→active+精确扣款+自动激活无第二道门；reject-with-reason→rejected+记录理由+钱包不动。
  - Withdraw 从没上 Google 的 pending → cancelled + **即时零退款**（refundAmountCents 0、completed，非 48h）+ 钱包不变。
  - #586：rejected 菜单出现 Re-open+Cancel；Re-open→pending_internal_review+reason 清空+账户清空+Approve/Reject 重现+Audit `campaign.launch_request_reopened`；Cancel rejected（未扣款）→cancelled 零退款+弹窗无退款文案+PostHog 未双发 `campaign.rejected`。
  - Money-safety：**钱包不足 402**（submit 与 approve 之间余额变化，A 停 pending 未扣款）命中；**账户 cap gate**（B 扣款后被 $150 cap 挡住激活，停 Pending Activation）。
  - CLI 渲染 6 状态（pending_internal_review/active/paused-PendingActivation/cancelled/rejected/completed）。
- **发现的问题**：
  - **BUG（已建单 HEL-1305）**：user dashboard 看不到 pending_internal_review / rejected campaign（bug draft 在 1.2.1/result/）。
  - **观察-1/2/3 low-sev**：`cancel --help` 写死 48h（对零扣款 withdraw 误导）；即时零退款后 `campaign get` 仍显示 refundEligibleAt+48h；over-budget submit 提示「launching debits」但 submit 不 debit。
- **开放问题 / pending-review**：账户 cap 卡死 $150 不自动抬高（架构上应能抬），待判定 test MCC 特性 vs 自动抬 cap 真 bug。
- **状态一致性提醒**：approve 扣款 ≠ 到达 active；B 扣款后停 Pending Activation 未投放，报告须区分「approve 成功/扣款」与「active/在投」。
- **未覆盖（含依赖）**：dry-run ad_account-only 非阻塞（需无账户 org）、无 waitlist 断言（admin/DB）、账户分配 floor shortfall（org 已有账户）、Google validateOnly 拒绝+reason 质量（需坏 ad copy/真实账户）、approve post-debit 失败→failed（需故障注入）、post-debit 已退款 rejected 的 re-open/cancel 不双扣、stale approved 恢复 sweep、withdraw 竞态 409、suspended 账户 re-open 自愈、re-open 409/403（admin API）、failed 状态 CLI 渲染（无实例）、真实投放/计费/转化回传（test MCC 不投）。
- **报告**：2026-07-06_16-47_hel-1300-defer-adaccount-sit.md

## 1.2.0 / Notification system E2E 可配置与审计验证 — 2026-07-03

- **来源**：用户确认的测试结果整理；目标是覆盖通知系统端到端可用、可配置、可审计，以及不该发时能正确 `skipped`。
- **测试结论**：除明确受权限/数据构造限制无法覆盖的分支外，其余覆盖项均已通过。
- **已通过点**：
  - Notification preferences API：`GET/PUT /api/v1/notifications/preferences` 默认值、campaign email 关闭/开启、无 email 用户 `unavailable` 状态均通过。
  - Dashboard 设置页：`Settings > Notifications` 可展示 email destination；Campaign emails toggle 可正确展示、修改，刷新后持久化。
  - Campaign 生命周期邮件：`approved-live`、`cancelled` 已触发对应通知；`approved-live` 仅 first activation 发送；品牌文案为 Hellyeah。
  - Delivery 审计：`notification_delivery` 可记录正确的 type/status/dedup/entity metadata；重复事件不重复发送。
  - Skipped 状态：用户关闭 campaign email 后触发通知，delivery 记录为 `skipped / preference_disabled`。
  - Resend webhook：invalid signature 返回 400。
  - Clerk email freshness：Clerk verified email 更新可同步到 `identity.user.email`；unverified email 不覆盖；backfill script dry-run 与 commit mode 行为正确。
  - Admin delivery API：`/api/admin/notifications/deliveries` 可列表、按 entity/status 过滤、分页，并能查到 skipped 记录。
  - 回归观察：campaign/refund/Inngest/profile gate 相关链路未发现回归。
- **未覆盖 / 需协作或源码/DB 条件**：
  - Campaign 生命周期邮件中的 `completed`、`refunded`、`failed` 状态无法通过当前 CLI/黑盒条件稳定构造，未覆盖。
  - Suppression 分支无法覆盖：包括 bounce/complaint 写入 suppression，以及 suppressed email 后续触发通知记录 `skipped / suppressed` 且不再发送；可能需要 DB 注入、Resend 测试事件或后端测试 fixture。
  - Production gate：生产环境缺 `RESEND_API_KEY` 应阻止启动，当前无源码/部署权限，无法通过 CLI 侧验证。
- **后续风险**：通知系统放行不能只看邮件发出；后续回归仍需同时检查 preferences、recipient/email freshness、delivery audit、dedup、skipped reason、Resend webhook/suppression、Admin observability 与生产配置 gate。

## 1.2.0 / Release 20260630 — 2026-06-30

- **来源**：HY Slack channel `C0A17S1531Q`，release 消息 `1782811927.666379`；QA update `1782793047.959989`。
- **关联工单 / 范围**：User Dashboard v1（HEL-1220 + 1221/1222/1224）、Stripe Connect CLI（HEL-1131）、PMax + Display removal（HEL-1270/1272）、Brand research + creative compositor（QA-913），以及 CLI v1.2.0 release。
- **本版本改动/优化点**：
  - Performance Max end to end：PMax campaigns 支持 full launch、sync、policy checks、reporting；legacy Display 从 forward path 退役。
  - Customer Dashboard v1：`https://app.hellyeahai.com` 提供 campaigns、spend、website analytics（traffic/sessions/events），PMax ad previews 显示 creative images 和 brand logo；onboarding 与 Campaign Launch flow 仍走 CLI。
  - Stripe Revenue Connect：商户通过 OAuth 连接自有 Stripe account；tokens encrypted at rest；1:1 Stripe account to org。
  - Brand research + creative compositor：`hellyeah profile research <url>` 使用 Exa + LiteLLM refine 自动填充 brand profile；新增 two-layer compositor（`edit-text` / `edit-blend`）和 exact gpt-image-2 dimensions。
  - CLI v1.2.0：新增 `hellyeah stripe`、`hellyeah creative workflow`、`hellyeah telemetry` settings；blank targeting 被拒；RSA descriptions capped at 90 chars。
  - Managed ads / Payments / Admin / Platform：worldwide targeting fix、review/setup end-date buffer、suspended account retry、distinct ad descriptions、idempotent refunds、per-env OAuth redirects、livemode gating、daily wallet top-up summary、active/paused targeting edit panel、Customers renamed to Organizations、dashboard OTel tracing + Better Stack error tracking、`@hellyeah/ui` components library。
- **测试结论 / 已修复事实**：
  - QA update 明确 4 个区域 staging done，major bugs fixed & re-verified。
  - User Dashboard v1 filed 8 bugs；6 个 fixed（1257/1259/1261/1262/1263/1267），2 个 closed as expected（1264 invite-consent、1265 multi-acct logout）。
  - Stripe Connect CLI：OAuth callback wrong CLI hint（1253）和 same Stripe account on multiple orgs（1255）均 fixed。
  - PMax + Display removal：CLI（1270）与 API/managed-ads（1272）通过；ad-copy truncation + headline/description diversity（1256）fixed/verified。
  - QA-913 Brand research + creative compositor：square-glyph text（914/915）与 image dimension mismatch（916）fixed/verified。
- **风险点与遗留**：
  - HEL-1271 Admin filter 未跑。
  - HEL-1272 仍有 2 个 legacy display cases 需要研发 seed legacy display row 才能覆盖。
  - Dashboard v1 已发布查看/管理入口，但 onboarding 与 Campaign Launch flow 仍不能从 Dashboard 执行，测试时不能按完整 Web launch flow 预期。
- **报告**：Slack Daily Radar `QA-Knowledge/daily-radar/2026-07-01.md`。

## 1.2.0-beta.4 / HEL-1270+1272 Display campaign 下线复测 — 2026-06-29

- **关联工单**：HEL-1269（umbrella）/ HEL-1270（CLI）/ HEL-1272（API+managed-ads）；dev HEL-1245，PR #564。本轮未测 HEL-1271（Admin filter）。
- **改动**：Display 从前向路径下线 → 只剩 Search+PMax 可创建；display 变 legacy 只读；预算 total-only（daily 拒绝）。
- **结论**：
  - **HEL-1270 CLI 全部通过**：search/pmax dry-run 到达 validate；裸 `--budget` 默认 total；`--type display`、`--budget-type daily`、total 无 end-date 均被客户端拒绝且 **exit 2**；`generate image` help 改为 "Performance Max image kit"。
  - **HEL-1272 黑盒可覆盖项全通过**：OpenAPI 写侧 enum 确认拒 display/daily（campaignType=`['search','pmax']`、budgetType=`['total']`）；读侧保留 display/daily（legacy）；**实launch 验证资金路径**——search `f9063546` + pmax `f0197b11` 均 budgetType=total，钱包 $450.50→$350.50（−$100），测后均已 cancel。
- **未覆盖**：
  - legacy `display` 行 read/pause/cancel/sync + launch-fail-loud + pgEnum 实回读 → 需研发 seed 历史 display 行（display 已无法创建）。
  - `E_NO_IMAGE_KIT`（由 `E_NO_DISPLAY_KIT` 重命名）→ 仅"平台无 kit"时触发，google 永远有 kit，运行时不可黑盒复现。
- **无新 Bug**。报告：`2026-06-29_HEL-1270-1272-display-removal.md`。

## Slack Daily Radar / HEL-1029 PMax 与 Notification Email 状态 — 2026-06-26

- **来源**：`QA-Knowledge/daily-radar/2026-06-26.md`；HY Slack channel `C0A17S1531Q`。
- **明确事实**：
  - HEL-1029 / PR #548 覆盖 Performance Max 从 Google GUI sync、policy、adCopy read-back；reviewer 已 approval / re-approval，Daily Standup 明确 QA cleared、safe to merge to production。当前记录为 merge-ready / merge-gate 状态，不等同于已上线。
  - User Notification System (Email) 项目中，核心 email dispatch 已完成 10 个 ticket（HEL-1196~HEL-1204、HEL-1225）；compliance/preferences 相关 11 个 ticket 在 In Review；Dashboard settings、Admin delivery read endpoint、failure observability、DNS/Resend cutover runbook 仍 In Progress；HEL-1246~HEL-1250 manual dev testing 已排入 Backlog。
- **测试影响**：
  - PMax PR 合并并部署后，需要重点验证 Google Ads GUI -> Hellyeah 后端的 policy/adCopy/read-back、dashboard/reporting 展示和既有 PMax launch/readiness 规则。
  - Email notification 测试不能只看“邮件能发出”，需要拆分 core dispatch、recipient/email freshness、preferences、suppression、Resend webhook signature、production config、Dashboard settings/Admin observability。
- **风险点与遗留**：
  - Meta account pooling、owned wrapper / Page + ad-account pool、customer-facing creative experience 均仍是 Slack 讨论/规划信号，已写入 daily-radar / pending-review，未升级为长期产品规则。
  - PR #548 仍需 merge/deploy 证据后再按上线事实补充。

## 1.2.0-beta.4 / PMax dashboard ad-content（logo + long headline）— 2026-06-26

- **关联工单**：HEL-1259（PMax ad-content view on user dashboard 不完整），lineage HEL-1256（ad-copy 截断 / 多样性）。
- **背景**：user dashboard 上 PMax 预览未体现 profile logo（预览显示 favicon），且无独立 long headline 区块（`longHeadline` 文本被复用进 `descriptions[1]`）。search / display 正常，问题仅限 PMax。验证 campaign：`8c75cddc-6948-4a65-bdc9-090a873b9a14`（Google campaign `23968648440`，org FinalRound `24a275fb`）。
- **logo 架构结论（研发 2026-06-26 确认）**：logo 只存在 business/profile level，launch 时随 campaign 附加到 Google asset group，**不单独存 campaign-level logo**；`campaign get` 的 adCopy 无 logo 字段属设计内，logo 实际有投。研发判定无需新增 campaign-level logo DB 字段（over-engineering）。→ 已同步进 `product-memory.md` 当前有效产品规则。
- **logo 展示修复**：**已修复** —— dashboard 预览现已能展示 logo（预览直接读 business-level logo 渲染，无需新字段）。
- **遗留**：HEL-1259 症状 1（PMax 无独立 long headline 区块 + `longHeadline` 被错误复用为 description）仍开放，属展示/映射问题。ad-copy 截断见 HEL-1256（已分配 Josh）。

## 1.2.0-beta.4 / QA-913 creative edit blend CLI 复测 — 2026-06-25 14:42

- **关联工单**：QA-913 `Brand research + creative text compositor pipeline (PRs #527-529)`，专项验证 `creative edit blend` 是否可用。
- **测试结论**：通过。`hellyeah creative edit blend --json --job-id f2e45a14-97f4-4ec5-9d53-5d05cfbc270f` 对真实 completed image job 成功返回 `blendedImageUrl`，下载后的 PNG 有效且文字可读。
- **证据**：源 edited 图仍显示方块字；CLI blend 输出 `blended-cli.png` 中 `Interview Ready` / `Start Today` 变为可读手写风格。输出文件位于 `Hellyeah_1.2.0/artifacts/QA-913-edit-blend/`。
- **风险点 / 遗留**：本轮只验证 `edit blend` CLI 可用；generate/edit text layer 方块字问题和 metadata `1200x1200` vs 实际 `1024x1024` 的尺寸不一致问题仍未关闭。
- **报告**：2026-06-25_14-42_QA-913-edit-blend-cli-retest.md

## 1.2.0-beta.4 / QA-913 CLI surface & portrait-tall 复测 — 2026-06-25 14:00

- **关联工单**：QA-913 `Brand research + creative text compositor pipeline (PRs #527-529)`，复测上一报告问题 #4、#5。
- **改动点**：CLI 版本 beta.3 → beta.4。
- **复测结论**：部分通过。
  - 问题 #4 CLI surface 未暴露 → **已修复**：`creative workflow`（非交互 `--hook/--headline/--position/--font/--json`）与 `creative edit blend`（`--job-id/--json`，实测打到后端返回 `not_found`+requestId）均已暴露。`edit text` 仍 TTY-only，但脚本化文字+位置+字体路径由 `creative workflow` 承接，原诉求满足。原 Bug 草稿「QA-913 CLI workflow and blend commands are missing」可置为 Fixed。
  - 问题 #5 portrait/tall 不支持 → **维持不支持，判定预期非 Bug**：业务文件 `cli/creative.md` 明确 Google 平台只定义 `landscape/square/all`，`--size portrait|tall` 返回 `validation_error`，`--size vertical` 文档化为 `E_FORMAT_UNSUPPORTED`。
- **风险点 / 遗留**：QA-913 提测单若把 "tall" 列为验收尺寸，属工单措辞 vs PLATFORM_SPECS 范围不一致，建议向 Wilson 确认；非 CLI 缺陷。本轮未重测方块字 / metadata 尺寸 / profile 不可达 URL 等其余问题。
- **报告**：2026-06-25_14-00_QA-913-cli-surface-size-retest.md

## 1.2.0-beta.3 / QA-913 Brand research + creative text compositor pipeline — 2026-06-25 11:00

- **关联工单**：QA-913 `Brand research + creative text compositor pipeline (PRs #527-529)`。
- **测试结论**：不通过。Brand research happy path、refine API、creative image 生成、text edit API、blend-text API 有可用结果，但核心 compositor / CLI workflow 未达到放行标准。
- **已通过点**：
  - `profile research https://www.nike.com --json` 与顶层 URL shortcut 可返回结构化 brand proposal，包含颜色、logo、sources。
  - API `/profile/research` 与 `/profile/research/refine` 可用，但返回体是 bare object，不是 CLI 常见 `{success,data}` envelope。
  - square / landscape image job 能完成，status 返回 `textLayerConfig` 与 `isTextEditable=true`。
  - API `PATCH /creative/images/{id}/text` 可更新 headline、cta、position、font。
  - API `POST /creative/images/{id}/blend-text` 返回 blended image，下载后的 blended 图文字可读。
- **发现问题**：
  - 原始生成图和 edit text 图中文字层显示为不可读方块字；blend-text API 单独输出可读，说明问题集中在 generate/edit text layer 路径。
  - 人工协作补测新的 square job `f2e45a14-97f4-4ec5-9d53-5d05cfbc270f`：初始生成图已为方块字；只修改 headline/CTA 后仍为方块字，问题不依赖 position 调整。
  - 人工协作补测 position picker/edit 行为：同一张可读 blended 图调整到 `middle`、`bottom`、`top` 时，API 均成功且 position 回写正确，但用户确认调整后文字会变成方框符号；position movement 生效，edit compositor 输出不可用。
  - API/CLI metadata 与实际 PNG 尺寸不一致：square metadata `1200x1200` 但实际 `1024x1024`；landscape metadata `1200x628` 但实际 `1536x1024`，不符合 Google RDA preferred `1.91:1`。
  - `creative workflow` 与 `creative edit blend` CLI 命令不存在；`creative edit text --json` 被拒绝，要求真实 TTY。
  - `--size portrait` / `--size tall` 不支持，当前只接受 `landscape, square, all`，与 QA-913 tall 覆盖目标不一致。
  - 不可达 `.invalid` URL 返回 success 并生成 unrelated/default brand proposal，而不是明确抓取失败。
- **未覆盖 / 待协作**：TTY refine/accept/skip wizard、TTY creative edit picker、旧 job 无 `textLayerConfig` 兼容 fixture、`--size all` 重新生成未触发。
- **报告**：2026-06-25_11-00_QA-913-brand-research-creative-compositor.md

## 1.2.0-beta.3 / HEL-1175 PMax asset group & targeting — 2026-06-24 14:31

- **关联工单**：HEL-1175 `[QA Test Request] [SIT] Display -> Performance Max migration · asset group & targeting`。
- **测试结论**：部分通过。CLI 与公开 API 可覆盖的 PMax targeting、预算预留、素材映射、pendingAdminReview 主路径通过；Google Ads GUI / GAQL asset group 读回已由用户确认通过。发现 1 个问题：blank-only `--location "   "` 在 dry-run 和真实 launch 中均未拒绝，真实 campaign 进入 `paused + pendingAdminReview=true`，并保存 `locations=["   "]`。
- **已通过点**：
  - 用户要求取消的 `$50` campaign `450e8945-fb37-46c5-ab1e-2cb68a103f33` 已 cancel，`refundStatus=completed`，`refundAmountCents=5000`，余额回到 `86564` cents。
  - `$20` 正向 PMax campaign `a5fbed15-f69c-4125-9d84-f9eeeb9afcaa` 创建成功，platform campaign `23974251295`，`paused + pendingAdminReview=true`，`failureReason=null`，`reservedCents=2000`，`activeReservedCents=2000`；Google Ads GUI / GAQL read-back 已由用户确认通过，随后 cancel/refund completed。
  - campaign get 读回：`campaignType=pmax`，`budgetType=total`，`budgetCents=2000`，`locations=["United States"]`，`languages=["en"]`，`demographics.ageRanges=["25-34"]`。
  - stored `adCopy.ads` 为单 ad，含 3 条 short headlines、1 条 long headline、2 条 descriptions、business name、2 条 image URLs 和 finalUrl。
  - 不传 location 的 PMax dry-run 通过且不含 locations 字段，按已确认口径为预期：默认 `Worldwide`，不是 Bug。
- **发现问题**：blank-only `--location "   "` 的 PMax dry-run 返回 `launchable=true`，真实 launch 也成功创建 campaign `e7de36cd-01b7-491a-b214-32b0bebdbffa` / platform campaign `23974785967`，并把 `locations=["   "]` 原样保留在 stored targeting。该问题只针对显式空白 location，不影响“不传 location 默认 Worldwide”的已确认口径；异常 campaign 已 cancel/refund completed。
- **未覆盖 / 待协作**：
  - Multi-ad rejection 暂无法通过公开 CLI / 用户侧 API 自动构造：CLI 和 OpenAPI 均只接单个 `textJobId`，需要后端 fixture、数据库注入或研发提供多 ad 异常 draft。
- **报告**：2026-06-24_14-31_HEL-1175-pmax-asset-targeting-stage.md

## 1.2.0-beta.3 / HEL-1173 PMax CLI launch 修复复测 — 2026-06-24 11:32

- **关联工单**：HEL-1173 `[QA Test Request] [SIT] Display -> Performance Max migration · CLI launch`；子 Bug HEL-1181、HEL-1182、HEL-1183、HEL-1184。
- **测试结论**：通过。核心阻塞已解除：PMax dry-run 和真实 launch 均可成功，真实 PMax campaign 进入 `paused + pendingAdminReview=true` 并返回 Google platform campaign id；用户 Admin approve 后 PMax 可进入 `active`，并完成 `pause -> resume -> cancel`；PMax keyword 已从 dry-run echo / stored campaign 中剥离；旧失败 draft 可通过 `campaign discard` 清理；Google Ads / 后台读回已由用户确认。
- **已通过点**：
  - 主路径 PMax campaign `1c61f6dc-67c2-4bae-a25f-3987451b3b98` launch 成功，platform campaign `23973929728`，`status=paused`，`pendingAdminReview=true`，`failureReason=null`，随后 cancel/refund completed。
  - HEL-1181 duplicate asset 根因复测通过：使用 profile logo 同图作为 PMax square marketing image 时，真实 launch 成功，campaign `5339d10b-66c3-4bd7-bff2-a951328e0d80`，platform campaign `23973933586`，无 Google duplicate asset / asset group 文案数量错误，随后 cancel/refund completed。
  - HEL-1182 keyword 修复通过：PMax dry-run request 和 stored campaign targeting 均不再包含 `keywords`；age range 保留为 `demographics.ageRanges=["25-34"]`，按 2026-06-24 修正口径不判 Bug。
  - HEL-1184 discard 修复通过：旧失败 draft `05284f31-c1e6-4b0c-bceb-6d88b4e9d54d` 执行 `campaign discard --yes` 返回 `deleted=true`，后续 get 返回 `not_found`。
  - Search regression 通过：campaign `ae38ee77-68e2-478f-81e8-14f9676a06b2` 进入 `paused + pendingAdminReview=true`，随后 cancel/refund completed。
  - Admin approve 补测通过：campaign `a83f23f7-fb63-44a1-9908-133af4566a06` 经用户 Admin approve 后进入 `active`，CLI 验证 `active -> paused -> active -> cancelled` 成功；用户在 Admin 中将预算调整为 `$20`，cancel 后产生 `2000` cents pending refund，符合已激活 campaign 的 settlement window。
  - Google Ads / 后台读回已由用户确认：PMax campaign type、曾启用后取消、location `United States`、age targeting/exclusions `25-34`、image asset、headline 和 description 均可读回。
- **口径纠正**：PMax no-location dry-run `launchable=true` 不是 Bug。2026-06-24 用户与 Wilson 确认：`--location` 是建议项，不强制；不传 location 默认投放 `Worldwide`。此前创建的 HEL-1227 属于按旧验收口径误判，应按非 Bug/建议项处理。
- **知识口径纠正**：K-2026-06-23-002 已按用户与研发确认纠正：`doctor` 通过不能作为 PMax 可以 launch 的充分条件，这不是 Bug；PMax readiness 以 dry-run / launch gate 为准。
- **仍需确认**：Admin approve / ops review 后 PMax active、pause/resume/cancel 已覆盖；Google Ads / 后台读回已覆盖。PMax no-location 口径已确认：建议但不强制，默认 `Worldwide`。
- **报告**：2026-06-24_11-32_HEL-1173-pmax-cli-launch-retest.md

## 1.2.0-beta.3 / HEL-1174 budget & wallet 修复复测 — 2026-06-24 12:28

- **关联工单**：HEL-1174 `[QA Test Request] [SIT] Display -> Performance Max migration · budget & wallet`；子 Bug HEL-1189、HEL-1190。
- **测试结论**：自动可覆盖部分通过。Search + PMax bare `--budget` 已按 total 处理；PMax 真实 launch 的 reserve / debit / cancel / refund completed 闭环通过；Display 已恢复 daily 行为，不再要求 keyword，显式 `--budget-type total` 已被拒绝；insufficient wallet dry-run 只失败在 wallet balance，未创建 campaign，钱包余额不变。
- **已通过点**：
  - Search bare amount dry-run：不带 `--budget-type` 时 `campaignType=search`、`budgetType=total`、`budgetCents=2000`、`requiredCents=2000`、`launchable=true`。
  - PMax bare amount dry-run：不带 `--budget-type` 时 `campaignType=pmax`、`budgetType=total`、`budgetCents=5000`、`requiredCents=5000`、`launchable=true`。
  - PMax real launch：campaign `f5338aec-2416-4bb0-8b67-f9810bf39242`，platform campaign `23974000000`，`paused + pendingAdminReview=true`，`reservedCents=5000`；cancel 后 refund completed，余额回到 `86564` cents。
  - Display bare amount：不带 `--budget-type`、不带 keyword 时 `campaignType=display`、`budgetType=daily`、`dailyBudgetCents=100`、`totalBudgetCents=3200`、`launchable=true`。
  - Display explicit total guard：`--type display --budget-type total` 返回 validation error，提示 Display requires daily。
  - Display real launch：campaign `96e2bd10-5096-4d45-86b7-a1af5c36af12`，platform campaign `23964343176`，daily budget `$1`，schedule total/reserve `3200` cents；cancel 后 refund completed。
  - Insufficient wallet dry-run：PMax `$1000` dry-run 只失败在 `wallet_balance`，`budget_caps=pass`，未创建 campaign，余额不变。
  - Google Ads GUI CUSTOM_PERIOD：用户已确认 PMax platform campaign `23974000000` 显示为 Campaign total / CUSTOM_PERIOD，不是 daily budget。
  - Budget edit / re-pace 与 Display budget-edit guards：用户反馈此前已测过无问题。
- **后续观察**：hard cap / over-pacing 需要真实投放后的 Google Ads spend / delivery 数据，短时间 CLI smoke 无法证明，用户确认只能后续观察。
- **报告**：2026-06-24_12-28_HEL-1174-budget-wallet-retest.md

## 1.2.0-beta.2 / PR #537 修复事实：HEL-1173 PMax CLI launch 子 Bug — 2026-06-24

- **关联工单**：HEL-1173 子单 HEL-1181、HEL-1182、HEL-1183、HEL-1184；PR #537 `fix(managed-ads,cli,api): QA SIT fixes for the Display→PMax migration (HEL-1181/1182/1183/1184/1189/1190)`。
- **状态说明**：Linear 子单已标记 Done；以下为 Wilson 在 Bug 单评论中的修复说明，尚未作为 QA 复测通过结论。
- **HEL-1181 / PMax real launch Google mutate failure**：根因是 PMax asset group 未按内容去重，brand logo 与 marketing image 字节相同时触发 Google duplicate-asset mutate rejection，并级联出误导性的 asset group headline / long headline / description 数量不足错误。Wilson 使用原 draft 对 live Google API 复现并验证：修复前复现原错误，修复后 `validateOnly` mutate 通过。
- **HEL-1182 / PMax payload keyword & demographics**：keyword 是 PMax no-op，已从 launch payload、dry-run echo 和 stored draft 中剥离。age/gender demographics 被 Wilson 判定为非 Bug：PMax 支持 campaign-level age/gender，按 negative-complement exclusions 生效；此前“PMax strips demographics / Google rejects them”的规格或文档口径需按错误预期处理。
- **HEL-1183 / doctor PMax readiness**：Wilson 说明 `doctor` profile check 现在会报告 PMax logo readiness；整体仍可 pass，因为 Search / Display 不依赖 logo。profile completeness 仍只看 8 个文本字段，PMax dry-run 仍是权威 launch gate，`doctor` 只提供更早 readiness hint。2026-06-24 用户与研发确认：doctor pass 不是 PMax 可以 launch 的充分条件，旧的“doctor 不提示就是 Bug”口径撤销。
- **HEL-1184 / failed draft cleanup & reservation clarity**：新增用户可见清理路径 `hellyeah campaign discard <id> --yes`，背后是 authenticated delete endpoint，用于清理 orphaned draft 或 never-launched failed campaign；next-step hint 不再指向无可用 lifecycle action。`reservedCents` 保留为历史意图金额，当前实际占用资金以 `activeReservedCents` 为准；draft 未 debit，failed campaign 仅在 refund settled 后可移除。
- **复测关注点**：PMax real launch 是否能进入 `paused + pendingAdminReview`；keyword 是否不再回显/存储；age/gender 是否按 negative-complement exclusions 验证；缺 logo 时 PMax dry-run / launch gate 是否明确拦截；失败/孤儿 draft 是否可 discard 且钱包无异常占用。

## 1.2.0-beta.2 / HEL-1174 budget & wallet 可测部分 — 2026-06-23 16:39

- **关联工单**：HEL-1174 `[QA Test Request] [SIT] Display -> Performance Max migration · budget & wallet`。
- **测试边界**：用户要求先测不被 HEL-1173 阻塞的部分。本轮覆盖 Search total budget/wallet、Search insufficient wallet dry-run、Display daily regression、Display cancel/refund；PMax real launch、PMax Google GUI CUSTOM_PERIOD、hard cap / over-pacing / re-pace 继续被 HEL-1173 / HEL-1181 阻塞。
- **测试结论**：部分通过。Search `--budget-type total` dry-run 与真实 launch 通过，`reservedCents=2000`，wallet debit/cancel/refund 闭环正常；Display `--budget-type daily` 真实 launch 通过，`budgetType=daily`、`dailyBudgetCents=100`、`reservedCents=3100`，cancel 后 refund completed，最终钱包回到 `91564` cents。
- **发现问题**：
  - Search bare amount 未按 HEL-1174 预期默认 total；CLI 仍要求 `--budget-type`。
  - Display launch 不带 `--keyword` 会被拒绝，疑似 Search validator 泄漏到 Display。
  - Display dry-run 接受 `--budget-type total --budget 20` 并返回 `launchable=true`，与“Display 保持 daily”预期冲突。
  - Display daily 不带 `--end-date` 失败，带 end date 后按 schedule total 做 wallet reserve；当前确认是 prepaid wallet 风控/文档口径，不作为问题处理。
- **报告**：2026-06-23_16-39_HEL-1174-budget-wallet-partial.md

## 1.2.0-beta.2 / HEL-1173 PMax CLI launch — 2026-06-23 14:18

- **关联工单**：HEL-1173 `[QA Test Request] [SIT] Display -> Performance Max migration · CLI launch`。
- **本版本改动/优化点**：CLI `campaign launch` 当前支持 `--type=<search|display|pmax>`，PMax 分支使用 total budget，并增加 PMax location/logo 等 dry-run precondition。
- **测试结论**：不通过。PMax dry-run 在补齐 1:1 PNG logo 后通过，返回 `campaignType=pmax`、`budgetCents=5000`、`budgetType=total`、`launchable=true`；但真实 `--yes` launch 在 Google mutate 阶段失败，campaign `05284f31-c1e6-4b0c-bceb-6d88b4e9d54d` 停在 `draft`，`platformCampaignId=null`，未进入 `paused + pendingAdminReview`，钱包未扣款。
- **已通过点**：text creative 生成通过；landscape/square image creative 生成完成且尺寸为 `1200x628` / `1200x1200`；PMax 无 image、无 location guard 生效；free-text hook enum guard 生效；Search regression real launch 通过，campaign `25f9d7fb-1d28-4366-b92f-e4d5cf2c2759` 返回 `paused + pendingAdminReview=true`、platform campaign `23961237828`，随后 cancel 成功、refund completed。
- **风险点与遗留**：
  - PMax real launch 失败信息包含 Google mutate errors：duplicate asset fields，以及 asset group headline / long headline / description 数量不足。
  - PMax dry-run 和失败 draft 中仍保留 `keywords` 与 `demographics.ageRanges`，与 HEL-1173 “PMax keyword no-op、age/gender stripped”预期不一致。
  - `doctor` / `profile get` 认为 profile complete，但 PMax dry-run 仍可因缺 1:1 PNG logo 失败。2026-06-24 已纠正：doctor pass 不是 PMax launch-ready 的充分条件，该现象本身不再按 doctor Bug 判断。
  - 失败 PMax draft 显示 `reservedCents=5000` 但没有 wallet spend_debit，且 draft 无法通过 CLI cancel 清理。
- **报告**：2026-06-23_14-18_HEL-1173-pmax-cli-launch.md

## QA 知识审核回写 — 2026-06-23

- **关联知识条目**：K-2026-06-16-002、K-2026-06-17-001、K-2026-06-17-002、K-2026-06-23-002。
- **审核结论**：
  - `lastEventAt` 不是团队认可的 webhook 成功处理可靠 smoke 指标；Stripe Dashboard connected-platform delivery 成功但 `lastEventAt` 不更新时可以建 Bug，但归因应写为 Hellyeah 状态反馈/可观测性或 handler 回写异常，不能仅凭该字段判定 Stripe 未投递 webhook。
  - ops review 是所有 campaign launch 前必须经过的管理员人工审核关卡，主要审核广告生成质量和安规是否符合规定；审核通过后才是真正 launch/active。
  - daily budget 没有废弃；PMax 是新增广告投放方式，launch 时使用 `--pmax` 字段。PMax 不看 daily budget、看 total budget；非 PMax campaign 仍需覆盖 daily budget / derived daily budget 兼容测试。
  - PMax launch readiness 不能只看普通 profile complete；PMax 需要 1:1 PNG brand logo。2026-06-24 已纠正：`doctor` 普通通过不能作为 PMax 可 launch 的充分条件，PMax readiness 应以 dry-run / launch gate 为准。
- **已更新落点**：Hellyeah `product-memory.md`，`QA-Knowledge/domains/campaign.md`，`QA-Knowledge/domains/admin-review.md`，`QA-Knowledge/domains/webhook-event.md`，`QA-Knowledge/pending-review.md`，并在 2026-06-16/17/22/23 daily-radar 中补充审核更正。

### 2026-06-24 K-2026-06-23-002 纠正

- 用户与研发确认：`doctor` 通过不能作为 PMax 可以 launch 的充分条件，这不是 Bug。
- 旧口径“`doctor` 应提示 PMax-specific readiness，不提示导致 PMax 前置条件误判可直接建 Bug”已撤销。
- 正确测试口径：PMax readiness 必须显式通过 PMax dry-run / launch gate 验证；缺 1:1 PNG brand logo 时 dry-run / launch gate 应明确拦截。`doctor` 中的 PMax logo readiness 只能作为辅助提示，不能替代 launch gate。

## 1.2.0-beta.1 / HEL-1131 Stripe Revenue Connect 追加复测 — 2026-06-22 12:22

- **关联工单**：HEL-1131 `[QA Test Request] [SIT] Stripe Revenue Connect — OAuth + CLI + webhook → cv_purchase pipeline`，关联历史 Bug HEL-1149、HEL-1150、HEL-1168。
- **本版本改动/优化点**：HEL-1168 修复后，connected merchant payment 触发 Stripe connected-platform webhook 时，connection 状态应更新 `lastEventAt` 并保持 `lastError=null`。
- **测试结论**：核心链路通过 / X-Ray conversion 聚合已确认 / Postbacks trace 待补。当前 staging CLI 登录 `junlong.deng@finalroundai.com`，active org `525b0981-9ad0-4363-9c59-eea37f0e1319`；`hellyeah stripe status --json` 对同一 connected account `acct_1TjCe5HckEoBzp31` 返回 `status=active`、`websiteId=019e5d03-9e5a-7000-9837-8209d5626786`、`lastEventAt=2026-06-22T04:18:59.935Z`、`lastError=null`。此前 11:12 的 `lastEventAt:null` 结果已被本轮新支付/新状态证据覆盖。Ops Admin proxy 正确路径 `/api/proxy/api/admin/xray/websites/{id}/conversions?...` 返回 `{"count":1,"revenue":1}`。
- **已通过点**：doctor 全绿；active connection 状态正常；already-connected gating 返回 `E_STRIPE_ALREADY_CONNECTED`；disconnect 不带 `--yes` 返回 `confirmation_required`；无效 API key 返回 `unauthenticated`；webhook 缺签名/伪签名均返回 400；tracker state 确认 org 绑定同一 X-Ray website。
- **风险点与遗留**：
  - Stripe Dashboard UI 补查：全局搜索 `cv_purchase` 返回 no results；Workbench / Events 只显示 Stripe 原生 `checkout.session.completed`，且该事件的 `Deliveries to connected platforms` 显示 `Connected Platform: Hellyeah AI, Inc.` / `200 OK`。这只能证明 Stripe event 投递成功，不能直接证明 X-Ray `cv_purchase` 已落库。
  - Ops Admin X-Ray 补查：目标 website `019e5d03-9e5a-7000-9837-8209d5626786` 在 `/websites` 列表中存在且 linked org 为 `JUNLONG.DENG`。正确 proxy 路径 `/api/proxy/api/admin/xray/websites/{id}/conversions?startAt=2026-06-22T00:00:00Z&endAt=2026-06-23T00:00:00Z` 返回 `{"count":1,"revenue":1}`，与一笔 `$1.00` Stripe test payment 相符。
  - Admin website 详情页 30d analytics 面板仍显示 `No data yet`；这与 conversions proxy 聚合结果存在 UI/口径差异，建议研发确认详情页是否应展示 conversion summary。
  - 若 HEL-1131 的最终放行要求 Postbacks spot-check，需要继续补 `/api/admin/postbacks/*` trace，确认生成 `postbacks.delivery` row，或确认 test-mode/route 条件下合理 suppress。
- **报告**：2026-06-22_12-22_HEL-1131-stripe-revenue-connect-final-retest.md

## 1.2.0-beta.1 / HEL-1168 Stripe connected-platform webhook 回写复测 — 2026-06-22

- **关联工单**：HEL-1168 `Stripe connected-platform webhook returns 200 but lastEventAt remains null`（https://linear.app/finalroundai/issue/HEL-1168），父单 HEL-1131。
- **本版本改动/优化点**：研发标记 HEL-1168 Done，预期 connected merchant payment 触发 Stripe connected-platform webhook 后，`hellyeah stripe status --json` 能看到 `lastEventAt` 更新。
- **测试结论**：不通过。用户完成一笔新的 Stripe test Payment Link 支付后，AI 在 staging 多轮复查 `hellyeah stripe status --json`，同一 active connection `acct_1TjCe5HckEoBzp31` 仍显示 `lastEventAt: null`、`lastError: null`。`doctor` 确认 staging/auth/org/API 正常，webhook endpoint 缺签名仍返回 400，环境和基础入口未见异常。
- **风险点与遗留**：
  - HEL-1168 不建议关闭或应重新打开；需要研发按 2026-06-22 11:11 CST 左右的新支付事件查询 staging `/api/webhooks/stripe/connect` handler 日志。
  - X-Ray `cv_purchase` 与 Postbacks delivery 仍未能放行；connection 层 `lastEventAt` 已未通过。
- **报告**：2026-06-22_11-12_HEL-1168-stripe-webhook-last-event-retest.md

## Slack Bug 事实 / Campaign Worldwide 地域异常 — 2026-06-18

- **来源**：HY 产品 channel `C0A17S1531Q`，launch ops report 线程 `1781529242.563239`，新增回复 `1781671293.938869` / `1781671307.755169` / `1781716364.583669`。
- **事实**：某 campaign 在 Ops 中显示用户选择 `Worldwide`，但 Google 实际使用了香港的新 territories，甚至具体 neighborhood。线程中已创建 `ING-202 Check Google location targeting for worldwide campaigns`，后续要求 `change to HEL`。
- **测试影响**：后续 campaign launch / PMax / managed ads 测试必须覆盖 location targeting 三层证据：用户选择值、Hellyeah 存储/传参值、Google Ads 实际 target。`Worldwide` 不应回退到 ad account creator/default location 或具体区域。
- **风险点**：该问题可能影响真实投放地域与预算消耗，不能只按 campaign 创建成功判定通过；需等待 canonical HEL ticket 后继续跟踪。

## 1.2.0-beta.1 / HEL-1131 Stripe Revenue Connect 复测 — 2026-06-15

- **关联工单**：HEL-1131 [QA Test Request] [SIT] Stripe Revenue Connect — OAuth + CLI + webhook → `cv_purchase` pipeline（https://linear.app/finalroundai/issue/HEL-1131）
- **本版本改动/优化点**：
  - CLI surface 已包含 `hellyeah stripe connect|status|disconnect`。
  - staging OpenAPI 已暴露 `/api/v1/integrations/stripe/connect` 和 `/api/v1/integrations/stripe/connect/url`。
  - `stripe disconnect` 不带 `--yes` 已返回 `confirmation_required` 和 next command。
- **测试结论**：不通过 / smoke 阻塞。`hellyeah stripe status --json` 与 `hellyeah stripe connect --json` 在已登录 + active org 下均返回 `internal_error`；直接 API 复核为 HTTP 500，响应体泄露 `integrations.stripe_revenue_connection` SQL 查询文本和 org 参数。OAuth happy path、Stripe Checkout、webhook → X-Ray `cv_purchase`、Postbacks 仍未进入。
- **风险点与遗留**：
  - **已建 Bug**：HEL-1149 `Stripe Revenue Connect status and connect endpoints return SQL-backed 500`（https://linear.app/finalroundai/issue/HEL-1149），已分配给 Mohit。疑似 staging DB migration/schema 或后端异常处理问题，同时存在用户态错误泄露内部 SQL 风险。
  - 修复后需先复跑 smoke gate，再请求用户进行 Stripe OAuth approve、4242 Checkout、webhook/X-Ray/Postbacks 轻量协作补测。
- **报告**：2026-06-15_17-12_HEL-1131-stripe-revenue-connect-retest.md

### 2026-06-15 18:54 追加复测

- **复测结论**：部分进展 / 仍阻塞。HEL-1149 核心 500/SQL 泄露问题已不复现：`stripe status` 返回 `E_STRIPE_NOT_CONNECTED`，`stripe connect` 返回 HTTP 200 authorize URL。用户打开 Stripe OAuth URL 后，Stripe 拒绝 `redirect_uri=https://hellyeahai.com/api/integrations/stripe/oauth/callback`，提示该 URI 未在 Stripe application settings 中精确匹配。
- **风险点与遗留**：
  - **已建 Bug**：HEL-1150 `Stripe OAuth rejects generated redirect URI`（https://linear.app/finalroundai/issue/HEL-1150），已分配给 Mohit。当前无法完成 merchant OAuth approve，因此 active connection、disconnect/reconnect、Checkout webhook、X-Ray `cv_purchase` 和 Postbacks 仍未覆盖。
  - 需确认 staging OAuth client 的 allowlist 和服务端生成的 callback URL 是否一致；若 staging 应使用 staging callback，需要修正环境配置或 URL 生成逻辑。
- **报告**：2026-06-15_18-54_HEL-1131-stripe-oauth-redirect-uri.md

### 2026-06-17 14:43 / 15:10 追加复测

- **复测结论**：部分通过 / webhook 已投递但后续回写仍异常。HEL-1150 已修复：`stripe connect` 生成的 OAuth callback 已改为 `https://api-staging.hellyeahai.com/api/integrations/stripe/oauth/callback`，用户可完成 Stripe OAuth approval。`stripe status` 返回 active test-mode connection，`disconnect --yes` 后变为 revoked，重新 OAuth 后恢复 active；already-connected、without `--yes`、invalid API key、webhook missing/invalid signature 负向入口均符合预期。
- **风险点与遗留**：
  - 用户完成两笔 Stripe test-mode payment，商户 Dashboard 可见两笔 `$1.00 USD` succeeded payment；最新 `checkout.session.completed` event `evt_1TjDO7HckEoBzp31jeWaCB8B` 在 Workbench 显示 `Deliveries to connected platforms` → `Connected Platform: Hellyeah AI, Inc.` → `Delivered` / `200 OK`（2026-06-17 6:55:51 AM UTC）。
  - 在 Stripe 已确认 connected-platform delivery `200 OK` 后，复核 `hellyeah stripe status --json` 仍显示 `lastEventAt: null`。后续应按 event id 查询 staging webhook handler 日志，确认是否漏更新 connection、漏 forward X-Ray `cv_purchase` 或漏写 Postbacks。
  - X-Ray `cv_purchase` 和 Postbacks delivery row 未覆盖，仍是 HEL-1131 放行前风险。
- **报告**：2026-06-17_14-43_HEL-1131-stripe-revenue-connect-oauth.md

## 1.1.0-beta.4 / PR-512 Google RSA headline mapping — 2026-06-12

- **关联工单/PR**：finalroundai/hellyeah-v2#512 `fix(managed-ads): keep long copy out of RSA headlines`
- **本版本改动/优化点**：
  - Google campaign launch 时不再把 `longHeadline` / description 长文案塞进 RSA headline slots。
  - 长文案保留在 descriptions，headline 使用短 headline 与安全 fallback。
  - CLI 版本包含 `creative generate text --rsa` standalone headline 改动。
- **测试结论**：通过。`hellyeah 1.1.0-beta.4` 真实生成 text creative 后 launch Google campaign，stored headlines 为 `Claim AI Ad Offer`、`Fresh Org QA`、`Claim AI Ad Offer 2`，stored descriptions 保留原 description 与 longHeadline；未出现历史残句或长文案截断进 headline 的问题。测试 campaign `e7a2742b-87ef-481d-afbe-96c4c79af0f0` 已 cancel，refund completed，余额回到 `83564` cents。
- **风险点与遗留**：
  - 本轮未稳定触发 “generated shortHeadline > 30 chars” warning；多次 creative generate 当前都返回 30 字以内 short headline，因此 warning 文案未拿到真实触发输出。
  - 未进入 Admin approve 后 active 状态；本 PR 修复点在 launch/ad copy 映射阶段，paused pending review campaign 证据已覆盖核心问题。
- **报告**：2026-06-12_23-48_PR-512-google-rsa-headline-mapping.md

## 1.1.0-beta.2 / QA-904 + QA-905 — 2026-06-12

- **关联工单**：
  - QA-904 [QA Test Request] [SIT] CLI refund/reservation status clarity (HEL-1105 + HEL-1133)（https://linear.app/finalroundai/issue/QA-904/qa-test-request-sit-cli-refundreservation-status-clarity-hel-1105-hel）
  - QA-905 [QA Test Request] [SIT] HEL-1132 CLI UX & diagnostics polish（https://linear.app/finalroundai/issue/QA-905/qa-test-request-sit-hel-1132-cli-ux-and-diagnostics-polish）
- **本版本改动/优化点**：
  - CLI refund/reservation clarity 覆盖 `campaign get/list`、`billing refunds --campaign`、`wallet balance`。
  - CLI UX diagnostics 覆盖 `doctor` binary check、environment、install source、staging note、org context header。
  - Campaign state explainability 覆盖 `allowedActions`、human `Actions:` 和 invalid_state actionable copy。
- **测试结论**：通过 / 剩余自然完成分支待专项数据。QA-904 pending / awaiting / no_refunds CLI contract 通过；QA-905 diagnostics、org context、environment、JSON 静默、cancelled/draft allowedActions 与 invalid_state 通过。经用户 Admin approve / Inngest 权限补测后，pending-admin-review / active / paused 状态矩阵、pause/resume/cancel、active cancel 后 refund pending、reservation 清空、Admin detail Budget 卡 settlement countdown、`process-refunds` 到期 refund credit 与 exactly-once 防重复入账均通过。未发现 Sev-1 / Sev-2 阻塞问题。
- **风险点与遗留**：
  - naturally-completed campaign refund claim 仍需自然完成测试数据；本轮只覆盖 cancelled campaign 到期 refund worker claim。
  - 新建 campaign `2aa2c794-ab54-461a-8191-251850a0d015` 仍由 persisted `refundEligibleAt=2026-06-14T06:23:08.218Z` gating，Inngest scheduled event rerun 不会绕过后端 DB eligibility。
  - 更新前本机 `1.1.0-beta.1` 曾复现多项输出缺失；用户更新到 `1.1.0-beta.2` 后已复测通过，后续以 beta.2 为基线。
- **报告**：2026-06-12_14-16_QA-904-905-cli-refund-ux.md

## 1.1.0-beta.2 / Creative RSA 文案残句复测 — 2026-06-12

- **关联工单**：无，按用户指定命令复测历史 `BUG-CAMPAIGN-COPY-001` 相关风险。
- **测试命令**：`hellyeah creative generate text --hook limited_time_offer --platform google --tone casual --rsa`
- **测试结论**：通过 / 未复现。连续 5 次 `creative generate text --rsa` 均返回完整短标题、长标题和描述，未见生成端残句、硬截断或模板碎片。
- **风险点与遗留**：
  - 本轮只覆盖 creative text 生成端，未覆盖 `campaign launch` 后最终 `adCopy.ads[]` / Google headline 映射阶段。
  - 历史 `BUG-CAMPAIGN-COPY-001` 仍不能仅凭本轮结果关闭；关闭前需要继续用 text job launch campaign 并检查最终广告文案字段。
- **报告**：2026-06-12_15-57_creative-rsa-copy-residual-sentence.md

## 1.1.0-beta.1 / HEL-1131 — 2026-06-12

- **关联工单**：HEL-1131 [QA Test Request] [SIT] Stripe Revenue Connect — OAuth + CLI + webhook → `cv_purchase` pipeline（https://linear.app/finalroundai/issue/HEL-1131）
- **本版本改动/优化点**：
  - 预期新增 `hellyeah stripe connect|status|disconnect` CLI surface。
  - 预期 staging API 提供 Stripe Revenue Connect OAuth/status/disconnect endpoints。
  - 预期后续覆盖 Stripe OAuth、Connect webhook、X-Ray `cv_purchase` 和 Postbacks pipeline。
- **测试结论**：阻塞 / 不通过 smoke。当前 staging CLI `1.1.0-beta.1` 没有 `stripe` 子命令；staging OpenAPI 未暴露 Stripe Revenue Connect paths；预期 endpoint 带 token + org header 返回 404。HEL-1131 entry criteria 未满足，happy path/webhook 测试未进入。
- **风险点与遗留**：
  - CLI/API surface 疑似未部署到 staging；需确认 PR #339/#359 是否进入 staging deploy，而不只是 stacked feature branch merged。
  - OAuth/Stripe checkout/webhook/X-Ray/Postbacks 全链路仍未覆盖。
  - 该工单需要 Stripe sandbox merchant account、Connect webhook、X-Ray/Postbacks 或后台日志观测条件，后续应按 AI+人工深度协作执行。
- **报告**：2026-06-12_10-46_HEL-1131-stripe-revenue-connect.md

## 1.1.0-beta.1 / HEL-1054 — 2026-06-12

- **关联工单**：HEL-1054 CLI: refund / cancel / wallet status clarity in output（https://linear.app/finalroundai/issue/HEL-1054）
- **本版本改动/优化点**：
  - `campaign cancel` 输出 pending refund 状态、refund eligible time、refund amount 和 available balance。
  - `wallet balance` JSON 输出新增 pending refund 总额与明细。
  - `wallet transactions` 输出新增 pending refund 记录。
  - 用户补充要求覆盖 Admin approve 后再 cancel 的 JSON 输出状态，以及 `campaign cancel --format human` 直接输出。
- **测试结论**：部分通过。`campaign cancel --json`、`wallet balance --json`、`wallet transactions --json/human` 通过；Admin approve 后 cancel 的 JSON 输出状态通过；`campaign cancel --format human` 已补测但只提示 48h settlement 和 follow-up command，未显示 refund amount、available balance 或 funds reusable 状态；`wallet balance --format human` 仍只显示 available balance，未展示 pending refund。
- **风险点与遗留**：
  - **BUG-HUMAN-REFUND-OUTPUT-001 / 待审核建单**：human mode refund output 不完整。`campaign cancel --format human` 未显示 refund amount、available balance、pending refund amount 或 funds immediately reusable 状态；`wallet balance --format human` 隐藏 pending refunds，JSON 已有 `pendingRefundCents: 10000` 和明细，但 human 输出只有 `Balance  $835.64 USD`。
  - **范围外风险 / HEL-1133**：`campaign get/list` pending refund 表达仍不完整，部分 JSON 字段为 `refundStatus: null`，但 human `campaign get` 通过 `refundEligibleAt` 给出 refund processes next action。
  - refund 48 小时后从 pending 到 completed 的 cron 闭环未覆盖，需 settlement window 后回归。
- **报告**：2026-06-12_10-03_HEL-1054-refund-output-clarity.md

## 1.1.0-beta.1 — 2026-06-11

- **关联工单**：无单号，按用户要求执行 Hellyeah CLI 从头到尾回归。
- **本版本改动/优化点**：
  - 新增/强化 `doctor`，可一次性检查 config、internet、api、auth、org、profile、wallet。
  - Tracker 命令面迁移：旧 `list/status/install/link/unlink/get` 返回结构化迁移提示，主入口改为 `tracker state/create/update/verify`。
  - Output contract 历史问题修复：unknown command、unknown flag、format conflict、confirmation `next` 参数保留均已复测通过。
  - Wallet topup 金额入口校验修复：三位小数 `10.999` 被 CLI 拦截为 `validation_error`。
- **测试结论**：部分通过。12:25、12:55、13:34 三轮回归均证明 Auth/org/profile/wallet/billing/creative text/campaign launch/cancel/tracker state/skills/feedback/output contract 主链路可用；pending review campaign launch 后已 cancel 清理，余额与 reservation 恢复正常。13:48 补测经用户 Admin approve 后确认 active pause/resume/cancel happy path 通过；active 后 cancel reservation 清空，但 refund 仍 pending。12:25 与 13:34 image job 均已完成并返回 1200x1200 PNG。
- **风险点与遗留**：
  - **BUG-CAMPAIGN-COPY-001 / Sev-2 / open**：headline 硬截断问题仍复现，新 campaign `58215d3d-e1f5-49e9-84e2-c607085eba66` 生成 `Use Guided AI Workflows to`、`For small business owners and` 等残句。
  - **DOC-TRACKER-001 / 文档差异**：business_file 中 tracker 文档仍描述旧命令，CLI 1.1.0-beta.1 已迁移到 `tracker state/create/update/verify`。
  - **DOC-CAMPAIGN-HELP-001 / 帮助契约差异**：`campaign launch --budget-type total` 实际要求 `--end-date`，但 help 未标注该场景下必填。
  - **ENV-OUTPUT-001 / 环境限制**：沙箱内 `env HELLYEAH_OUTPUT=json hellyeah wallet balance` 仍可能报网络 `internal_error`，按 README 规则不判产品 bug。
  - 12:55 复跑再次确认：headline 残句、tracker 文档差异、campaign help 差异、沙箱 `HELLYEAH_OUTPUT=json` 网络限制仍存在。
  - 13:34 全量回归再次确认：新 campaign `51e1aaa4-758b-4e9f-9ecc-26ff9f0296c3` 已 cancel/refund completed，余额恢复 `73465` cents，reservation 清空；headline 残句、tracker 文档差异、campaign help 差异仍存在。
  - 13:48 轻量协作补测：用户 Admin approve campaign `2b3e3657-af77-4fd0-b37b-bb02cb8c2591` 后，CLI 验证 `active -> paused -> active -> cancelled` 通过；active cancel 后 reservation 清空，但 refund pending，余额仍为 `71465` cents，需后续跟进 refund cron/completed。
  - Coverage Rescue 补测：真实 Stripe 4242 支付已完成，wallet 新增 `topup_credit 1099`，余额到 `72564` cents；PostHog/Inngest/webhook 事件矩阵用户确认已看到；watch Ctrl+C 已执行，exit `130` 但未返回 JSON envelope，需确认 watch 中断输出契约；rate limit 真实 429 压测用户选择跳过；token refresh 未篡改凭证，仅验证 token valid 和 `auth whoami` 正常。
  - 16:55 完整广告组合补测：text creative + landscape image + square image 可一起 launch 为 display campaign `bb44eaef-464a-496a-83ea-ca9e12820c22`，用户 Admin approve 后进入 active；但生成图片品牌和业务语义跑偏，并发现 API 返回尺寸与实际下载 PNG 尺寸不一致，素材质量不建议放行。
- **报告**：
  - 2026-06-11_12-25_hellyeah-cli-e2e-regression.md
  - 2026-06-11_12-55_hellyeah-cli-e2e-rerun.md
  - 2026-06-11_13-34_hellyeah-cli-full-regression.md
  - 2026-06-11_16-55_complete-ad-preview-quality.md

## 1.0.0（beta.5 → beta.7）— 2026-05-27 ~ 2026-06-04

- **关联工单**：
  - [QA Test Request] [SIT] CLI — funnel event coverage (source=cli, beta release)
  - [QA Test Request] [SIT] Admin + Stripe webhook + Inngest crons — event coverage
  - [QA Test Request] [SIT] Stripe Revenue Connect — OAuth + CLI + webhook → cv_purchase pipeline
- **本版本改动/优化点**：
  - PostHog 事件埋点全面落地：CLI 新增 `X-Hellyeah-Source: cli` header，~13 个 funnel 事件按 source=cli/admin/webhook/cron 打标
  - 新增 Stripe Revenue Connect：`hellyeah stripe connect/status/disconnect` + webhook → `cv_purchase` pipeline（HEL-569/G5）
  - campaign total budget 最低限额由 $50 降为 $20（beta.7）
  - `creative generate text` 移除 `--variants` 选项（0.1.0 的 BUG-1 由此被取代，提测文档未同步）
  - Admin 激活链路可观察：campaign 经 Admin approve 后进入 active，可做 post-activation cancel
- **测试结论**：三轮均非全绿。beta.5 campaign 复测部分通过（英文 creative→launch→list/get/status 链路可用）；beta.6 admin/webhook/cron 事件矩阵因本机缺 Admin Ops、PostHog、Stripe CLI、Inngest 访问条件整体阻塞，仅完成测试数据准备；beta.7 vibe mode smoke 部分通过，auth→creative→launch→Admin 激活→cancel→reservation 清理全链路跑通，但不能作为干净的 launch-gate 通过。
- **风险点与遗留**：
  - **BUG-CAMPAIGN-COPY-001 / Sev-2 / open**：campaign ad headline 按硬截断而非语义边界拆分，产出残句广告文案（如 "Join SMB Teams Using AI to"），用户可见的广告质量问题
  - **BUG-CAMPAIGN-CN-001 / Sev-2 / open**：中文长文案 creative 可生成 completed job，但 launch 被 Google Ads 以 headline too long 拒绝（validation_error / exit 2），并残留 draft campaign
  - **RISK-WALLET-REFUND-001 / 待跟进**：post-activation cancel 后 refund pending（48h refundEligibleAt），cron refund exactly-once（wallet.refund.completed 恰好一次）未验证，需 Inngest/手动触发回归
  - **BLOCKER-EVENT-001~004**：Stripe CLI、Admin Ops/x-api-secret、PostHog project 418727、Inngest UI 访问权限缺失，整个事件矩阵（source=admin/webhook/cron）待补测
  - **CONTRACT-SMOKE-001 / Sev-3**：smoke 提测文档对 beta.7 已过期（`--variants 3`、`--text-job-id`、$10 预算均不成立，实际为无 variants、`--text-id`、最低 $20）
  - 仍未覆盖：active 状态下干净的 pause/resume happy path、真实 Stripe 4242 卡支付、Stripe Revenue Connect 工单全量场景
  - 下版本重点回归：campaign copy 映射（headline 拆分/中文长度）、refund cron 时序、补齐权限后的事件矩阵、0.1.0 遗留的 wallet 金额校验与 output contract
- **报告**：
  - 2026-05-27_17-38_campaign-creative-launch-retest.md（beta.5）
  - 2026-06-01_14-10_admin-stripe-inngest-event-coverage.md（beta.6）
  - 2026-06-04_16-35_vibe-mode-smoke.md（beta.7）

## 0.1.0 — 2026-05-13 ~ 2026-05-25

- **关联工单**：无 tickets/ 工单，按 test_source_file/ 提测文档执行（login/logout/whoami/config status、Campaign CLI、Wallet & Billing、Output Contract & Exit Codes、Hellyeah CLI Smoke Test Summary 等）
- **本版本改动/优化点**（首个被测版本，能力基线）：
  - Auth + Config：Clerk OAuth 登录/登出/whoami、credentials 文件、`config status`
  - Profile（8 必填字段 gate）、Wallet（balance/topup/transactions/reservations）、Billing refunds
  - Creative text/image 生成、`status --watch`、list
  - Campaign launch/list/get/status/pause/resume/cancel，launch 后进入 paused + pendingAdminReview
  - Tracker、Skills、Feedback 命令与 JSON/Human 双输出契约、exit code 0/1/2/3/4/5/130
- **测试结论**：9 轮报告整体为"部分通过、不能完整放行"。主链路（登录→profile→wallet→creative→launch→cancel→refund pending）可跑通；Auth + Config 于 2026-05-25 在 1.0.0-beta.5 上复测放行。阻塞点集中在 wallet 资金入口校验和 output contract 横切契约。
- **风险点与遗留**：
  - **BUG-WALLET-001 / Sev-1 / open（发布阻断）**：三位小数充值金额未在 topup 入口拦截，`--amount 10.999` 实际入账 1100 cents，且 checkout-only 也能创建 Stripe session；未见修复回归
  - **BUG-OUTPUT-001 / Sev-1 / open**：unknown command 不输出 JSON envelope（Human help + exit 1，非 usage exit 2），2026-05-25 smoke 复测仍存在
  - **BUG-OUTPUT-002/003/004 / Sev-2 / open**：未知 flag 被静默忽略返回 success；`--json + --format human` 冲突不报错；confirmation `next` 丢失原参数（如 `--reason`/`--org`）——均在 05-25 复测确认仍存在
  - **BUG-1 / Sev-2**：`creative generate text --variants 3` 只返回 1 条 variant（beta.7 中该选项被移除，转为文档差异跟踪）
  - **已撤销（不再按 bug 处理）**：BUG-2（watch 不流式 → TTY human mode 复测通过，测试方法偏差）；BUG-CAMPAIGN-001（NONINTERACTIVE=1 绕过 --yes → 产品语义确认等价 implicit `--yes`）；BUG-CAMPAIGN-002（余额不足残留 draft → 按业务文档 E2E-2 draft 规则复判为预期行为）
  - **契约待确认**：CONTRACT-CAMPAIGN-001（缺必填参数 exit 1 vs 文档 2）、CONTRACT-WALLET-001（非法 since/limit/uuid 透出 ZodError、exit 1 vs 2）、CONTRACT-WALLET-002（Ctrl+C topup 实际 exit 130 vs 文档 0）、CONTRACT-OUTPUT-001（envelope 用 `success` 而非文档 `ok`）
  - **文档/环境差异**：`--text-job-id` 实际为 `--text-id`、total budget 最低 $50（文档 $10）、credentials 路径形态不一致、测试 org 非 fresh（无法验证初始空态）
  - **未覆盖区域**：active 下 pause/resume happy path、cross-tenant campaign、rate limit（exit 5）、watch Ctrl+C（exit 130）、真实 Stripe 卡支付、token refresh 分支
  - 脆弱区域提示：output contract（agent/parser 消费）、wallet 资金路径、campaign 状态机受 pendingAdminReview 时序影响、refund 仅见 pending 未见 completed 闭环
- **报告**：
  - result.md（v1 smoke 总览）
  - 2026-05-13_18-24_auth-config-status.md
  - 2026-05-14_11-14_creative-watch-tty-retest.md
  - 2026-05-14_14-20_campaign-cli.md
  - 2026-05-14_14-52_campaign-cli-retest.md
  - 2026-05-14_17-20_wallet-billing-cli.md
  - 2026-05-18_14-29_output-contract-exit-codes.md
  - 2026-05-25_10-22_auth-config-retest.md（beta.5 复测放行）
  - 2026-05-25_10-36_hellyeah-cli-smoke.md

## Meta Admin campaign dispatcher / Account Pooling — 2026-08-18

- **来源**：HY Slack project update，消息 `1786964589.563499`；关联 PE-119。
- **明确版本事实**：Meta campaign creation 已在 Admin path 端到端跑通；跨平台 campaign delivery 采用单一 dispatcher 加各平台独立 domain chain，未知平台明确拒绝，钱包扣款、spend cap、refund settlement 与 debit idempotency 继续共享单一实现。
- **当前边界**：Customer-facing launch 尚未接入 dispatcher，不携带 platform 字段且仍有多处 Google 硬编码；当前客户不能选择 Meta，不能把 Admin path 完成解读为客户侧已支持。
- **测试关注点**：Meta 五步 Graph 调用的部分失败恢复、未知平台拒绝、共享资金逻辑 exactly-once，以及客户入口不得创建无法 launch 的 Meta campaign。
## Campaign strategy and Support Agent production facts — 2026-08-28

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1787882510.757259`、`1787856299.909749`。
- **Campaign Strategy Quality**：keyword strategy 与 budget forecasting 已 live；项目更新明确表示 keyword grounding、预算预测、launch integrity 和规划账户隔离已完成 QA 覆盖。
- **Customer Support Agent**：release `d8a5ad2` 已在 production 工作；Chatwoot widget 可创建 tenant-scoped SupportHub V2 ticket、接收 grounded reply，并在 Karie dashboard 查看完整会话。
- **后续关注**：campaign 回归继续检查 Google 数据、预算/日期联动和账户池隔离；Support Agent 需用当前 release 重跑代表性 widget 流程，验证回复长度、链接选择、升级与 placeholder 渲染。
## Creative Library and X-Ray activation visibility — 2026-08-31

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1787890291.522019`、`1787899426.880229`。
- **Creative Library**：Admin 已 live，可管理 reference asset 并查看 usage 与 organization limits；Content Intelligence 是 reference data 的单一事实来源，相关实现已通过 PR #982 合并。
- **X-Ray**：PostHog activation dashboard 已上线，覆盖 channel selection 到 tracker serving、handoff、first event、channel switching 和 GTM 子漏斗；GitHub channel 因 first event 仍为客户端事件而暂时排除。
- **测试关注点**：Creative Library 检查管理操作与 Studio 消费一致性；Tracker QA 可使用 dashboard 验证 Shopify/GTM 漏斗，但不能用当前 dashboard 判定 GitHub activation 完成。

## Meta Ads production release #1015 — 2026-09-03

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1788497332.952489`。
- **明确版本事实**：Meta campaign delivery 已通过 release #1015 发布 production；17 条 pending migrations 已应用且 health checks green，Meta Business Portfolio 与 ad accounts 已同步，首个客户 Meta creative 已完成生成。
- **发布能力**：客户可选择 Meta 创建 campaign；launch 创建 campaign/ad set/creative/ad，wallet debit 成功后激活，达到 90% budget 或结束日期时停止，并同步 Ads Manager ON/OFF 状态。
- **已知边界**：Meta link description 暂不发送到 Facebook Feed；partner-owned ad account spend limit 不能由 system user 修改，预算超出预设上限会在最后一步失败。
- **QA 状态**：用户人工口径为“按现在 QA 可以发”；正式 QA Summary、QA Process 与 Release Train 需按 PR #1015 的精确合并范围更新，不能仅凭编号推断其他 PR 已发布。

## Meta BYO App Campaign Sandbox #1117 — 2026-09-20

- **来源**：HY Slack channel `C0A17S1531Q`，消息 `1789893148.258749`。
- **明确版本事实**：PR #1117 已实现 Meta BYO App Install 与 in-app purchase 支持并部署 Sandbox。Campaign Readiness 保留请求的 App Campaign 类型；缺少 App ID、store link 或 PURCHASE 配置时明确阻止 Launch，不再静默降级 BYO 客户。Campaign Agent 不再中途请求输入，Sandbox 新 run 可完成并保留 `App purchases`。
- **当前 QA 状态**：Meta BYO App Install delivery 与 in-app purchase optimization 仍在 QA；当前测试账户没有可投放 Meta App 或 App PURCHASE 事件，真实 happy path 尚未完成。
- **遗留验证**：绑定真实 App、补 Brand Profile App ID/store listing、确认 Meta 接收 PURCHASE 事件，并完成 PE-507 installs/purchases/revenue Insights 数量与收入校验。#1117 只有在这些 QA 项通过后才能合并和发布。

## PR-1273 admin top-up reversal · staging 回归 + 执行模态 — 2026-10-13

- 环境：staging（PR 已于 06:26 UTC 合入，`ef4021e6c→229cd3674`）；runs `20261013-exp1-r2`、`20261013-exp1-r3`、`20261013-exp2-execmode`。
- 结论：C1–C5 两轮均 Pass（第 1 轮 C2–C4 Blocked 已解锁）；执行模态 7/7 资金不变量成立；bug-01（冲正审计缺组织）staging 复现；新增候选 bug-02（并发败方被告知成功）、bug-03（响应丢失后状态陈旧）。
- Bug：均未建单（待用户授权），草稿在 `User-Dashboard-test/PR-1273/bug-drafts/`。

## PR-1217 conversion tracking gate · staging（exp3 round 1）— 2026-10-13
- run `PR-1217/runs/r-20261013-1528-exp3`；qa-secondary org-A 造出 missing→waiting→live；11 Case：9 Pass / 1 ProductFail（C3）/ 1 Inconclusive（C11）。结论：不通过。
- Bug：bug-01 PMax Sales 切 Traffic 后关键词/点击预估不出现、readiness 卡死（reproduced，待授权）；bug-02 候选：切换后刷新草稿自冲突（Expected 待确认）。均未建单。
- 遗留：org-A X-Ray tracker 已 live（staging，不可 UI 删除）。

## PR-1327 QA-1149 第二轮回归 · PR sandbox c49b6d6 — 2026-10-15
- run `User-Dashboard-test/PR-1327/runs/r-20261015-1415`；第二轮 5 条全部 Pass；风险 smoke：Case 1 waiting 行文案 ProductFail（bug-03 未修）、Case 7 刷新丢 Switch Back Inconclusive（自冲突已修）。结论：不通过。
- Bug：bug-01（补到原 bug-03 单，待审）、bug-02（暂缓，待 W-20261015-04）；未建单。上一轮 bug-01（切 Traffic 后 Readiness 卡住）已不再出现。
- 遗留：sandbox 内 3 个带 runId 的 plan + 1 个广告组；tracker 状态未改动；E2B 已销毁。

## PE-884 · PR #1335 / #1364 安装副本测试 · 2026-10-16

- 两个独立 sandbox/run，head cc64a71 / 5336da5 与 bot comment 一致，页面无 SHA。#1335 执行2 Case均 Inconclusive：已知站点指标与 US/25–34/men/desktop Plan handoff 有真实证据；首读及完整卡片未放行。#1364 执行3 Case均 Inconclusive：Brand迁移和部分手机布局可观察，SimilarWeb未配置阻塞正常报告；失败文案仅UX候选。其余3计划Case Blocked/NotRun，真实日报与资金链路未执行。
- Plan已清空，原组织恢复；两套会话独立回读 revoked，E2B终止。sandbox run行/配额/可能草稿未DB核销仍残留。组织切换Action假阳性校正drift，整轮命中率未测量。未改产品、未建单/评论/放行。工作台 W-20261016-PE884-01..04；发布回执见各run delivery.json。

PE-884 收尾：组织切换 Action 修复已提交 b4024767（未推送），安装副本已同步；落盘验证29条相关测试与typecheck通过。1335报告发布v2，1364报告发布v1；后者在线正文空白、回读未完成，保留reviewed状态。

## PE-884 · staging 复测（PR #1335 / #1364 已合入）· 2026-10-19
- 结论：不通过。staging SimilarWeb 已配置；16 个 Case 执行并逐 Case 复核通过：Pass 13、Inconclusive 3、ProductFail 0；未执行 4（SkippedByConstraint 1、Blocked 3，均为用户裁决），Case 7 按用户决定丢弃。2026-10-20 用户裁决：小站点 No Data、onboarding 落点、上线前空 Campaigns 卡、已知站点无竞品/竞品广告均不算 Bug（bug-01、bug-02 丢弃）；用户评分覆盖 70%（遗漏 launch.tree-drafting-per-leaf）。
- 无待处理 Bug 草稿（bug-01、bug-02 均丢弃）；测试组织花费：Admin 充值 $150（未冲销，由用户处理）、$20 预留已退；一次性 scope 清理 manual_review（scope-expired），工作台 W-20261019-PE884-*。
- 报告：PR-1335/result/2026-10-19_12-15_PE-884_staging-retest.md；终版 artifact（见 delivery.json）（https://hellyeah.artifact.cafe/a/pr-1335-brand-pre-audit-qa-7jrzqi），汇总复核 check/漏测 gate 均通过（qaApprovalReady=false）；回执见 run delivery.json。
