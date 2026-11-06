# qa-harness:基于 QA Runbook 的 QA 命令行工具(设计)

状态:草案,待用户审阅。日期:2026-11-06。
标注"【我的决定】"的条目是设计者替用户做的选择,不是用户已确认的内容。

## 1. 意图

现有的 `linear-browser-qa` skill 靠一份约 22KB 的 SKILL.md 加 40 多份 references,由 Codex 按自然语言步骤执行。它的问题是:

- 流程靠约定而不是代码保证。2026-11-06 夜间核心回归第 94 轮没跑成,原因是调度规则的 `cwd` 指向了没有 `.env.local` 的源仓库,而不是 skill 安装目录。
- 引擎和内容(Runbook)混在同一个目录里,路径一错两者一起错。
- 执行者只能是 Codex。

目标是把它做成一套命令行工具(CLI):每个 QA 大环节一条命令,环节之间用落盘文件衔接,所有 QA 规则、case 设计方法和环境约定都来自一份独立的 **QA Runbook**。调度器(agent-autoloop、Slack 触发)和人手动运行,调用的是同一组命令。

## 2. 目标、非目标、反目标

**目标**

1. 五条命令:`qa extract`、`qa design`、`qa review`、`qa run`、`qa report`,另有一条 `qa all` 按顺序串起它们。
2. 每条命令的输入输出都是磁盘上的结构化文件(JSON 或 Markdown),下一条命令只读上一条的文件,不依赖聊天上下文。
3. 所有命令启动时先校验配置和 Runbook,配置错误在第 0 步就失败,而不是跑到一半。
4. `qa review` 在执行前审核 case 清单,剔除无效 case,剔除必须留下理由。
5. 能由调度器无人值守地运行:非交互、退出码明确、日志落盘。

**非目标(本版本不做,用户说"需要时再加")**

- 执行后的逐 case 证据复核、汇总复核、lane 合并复核
- 漏测 Hook(omission hook)和漏测 finding 确认
- 人工盲审与评分
- 知识沉淀(写 pending-review)
- Computer Use 探索式执行
- 自动创建 Linear bug(bug 草稿也先不做)

**反目标(即使技术上能跑也算失败)**

- `qa review` 悄悄删除 case,没有落盘的剔除理由。
- 报告里出现"已独立复核"之类的说法。本版本执行后的结论没有人独立核对,报告必须如实写明。
- 任何密钥(OpenAI key、Clerk secret、E2B key、账号密码)写进 run 产物或日志。
- Runbook 缺失时回退到猜测或默认值继续跑。

## 3. 已由用户确认的决定

- 形态是 CLI。仓库是新建的独立仓库 `qa-harness`。
- 范围是完整流水线:五条命令一次搭出来,再逐条填实。
- 命令按 QA 环节划分,不按底层技术划分。
- 审核只保留"执行前审 case 清单,剔除无效 case"这一处。
- LLM 使用 OpenAI 的模型(用户会提供 API 访问)。具体模型名由配置决定。
- `qa run` 通过调用脚本执行 case(用户原话:"case 的执行去调用脚本")。没有现成脚本的 case,第一版就要用 OpenAI 生成新的 Playwright 脚本(用户选择了这一项,而不是只执行已有脚本)。执行脚本本身不调用 LLM,只有"脚本生成"子步骤调用。

## 4. 我的决定(请用户核对)

1. **语言**:TypeScript(Node)。因为现有 `hy_ui_autotest` 和 loop 代码都是 TypeScript。
2. **Runbook 的范围**:指 `qa-environment.md`、`QA-models/`(含 `hellyeah/core-journeys.md`)、`references/case-design.md`(七个生成器)、`references/knowledge-sources.md`(知识源优先级)、`references/verdicts.md`(判定词表)这一组文件,而不是旧的 `FR_workspace/QA-RUNBOOK.md`。Runbook 作为一个目录,由配置文件指向。
3. **与现有脚本的关系**(已按用户反馈修改):不再通过路径调用外部目录,而是把 Action 和 QA module 从本机 linear-browser-qa 安装副本(`~/.codex/skills/linear-browser-qa`)迁移进 `qa-harness` 仓库,见第 10 节。此前"以子进程调用 `executor.scriptsRoot`"的做法作废,第 5、6 节里相应的措辞以第 10 节为准。
4. **OpenAI 调用**:用官方 `openai` SDK,使用结构化输出(JSON Schema)约束 `extract`、`design`、`review` 的返回,代码校验后再落盘。模型不直接读文件或操作环境,文件由 CLI 读取后放进提示词。
5. **`qa doctor`**:配置与 Runbook 校验的逻辑单独暴露成 `qa doctor` 命令,同时每条命令启动时自动调用。
6. **`revise` 的处理**:`qa review` 标 `revise` 的 case 带着 reviewer 的反馈回到 `qa design` 重新生成,最多两轮,仍不合格则转为 `drop` 并记录理由。
7. **报告发布**:`qa report` 默认只在本地生成 Markdown,发布到 artifact.cafe 作为单独的 `--publish` 选项。
8. **Linear、GitHub 访问**:`qa extract` 用 Linear API(`LINEAR_API_KEY`)和 `gh` 读取 ticket 与 PR;同时支持 `--ticket-file` 手动提供文本,以便离线或测试时使用。
9. **Runbook 的读取方式**:Runbook 文件已存在。`QA-models/hellyeah/*.md` 带 YAML frontmatter(`status`、`version`、`last_reviewed`),由代码解析,`status` 为 `pilot` 或 `draft` 的模块不能单独支撑 `ProductFail`。七个生成器和判定词表是文字规则,原文放进提示词交给模型,不由代码解析。
10. **`ProductFail` 的判定**:`qa run` 用确定性规则映射 Playwright 结果,不调用 LLM。脚本通过记 `Pass`;断言失败时,若该断言的 Expected 出处是 ticket、PR 作者声明或用户确认,记 `ProductFail`;若 Expected 只来自 `status` 为 pilot 或 draft 的 QA module 断言,记 `Inconclusive`(当前 17 个 module 全部是 pilot 或 draft,没有 active,所以这条规则实际上意味着没有 ticket 出处的回归失败都不会判 ProductFail);超时、选择器找不到、沙箱或网络错误记 `Automation failure`。断言失败与选择器错误的区分方式由实现者决定。
11. **`revise` 回路**:`qa design --revise` 只重新生成被标 `revise` 的 case,case id 保持不变,每轮的清单另存为 `cases.v1.json`、`cases.v2.json`,`cases.json` 指向最新版。`qa all` 负责串联 design 与 review 的循环。
12. **预算**:沿用 Runbook `case-design.md` 的规则:G1 全部纳入,普通 ticket 在验收之外再加两条,高风险改动可扩展并说明理由。另在配置里设 `design.maxCases`、`run.caseTimeoutMs`、`run.totalTimeoutMs`、`llm.maxRetries`,默认值由实现者定。
13. **anchor 匹配**:核对前对原文和 anchor 都做空白与 Markdown 标记归一化,保持原文语言比对。提示词要求 anchor 必须取自原文,不得翻译。
14. **夜间核心回归**:使用 goal 模式,目标是 `QA-models/hellyeah/core-journeys.md` 里的 J1 到 J5。验收原子来自这份清单,`sourceRef` 指向它。注意该文件当前 `status: draft`,没有 ticket 出处,按第 10 条夜间回归的失败在这个阶段最多记为 `Inconclusive`,直到该文件被升级为 active。

## 5. 命令与文件契约

每次运行有一个 `runId` 和运行目录 `RUN_ROOT/<feature>/runs/<runId>/`。命令默认不覆盖已有产物,需要 `--force`。

| 命令 | 输入 | 输出 |
|---|---|---|
| `qa extract` | ticket、PR、或用户目标(goal 模式),以及 Runbook | `acceptance.json`(验收原子,每条带出处和逐字 anchor)、`change-model.json`(碰到的 surface、实体、状态迁移、副作用)、`env.json`(解析出的测试环境) |
| `qa design` | `acceptance.json`、`change-model.json`、Runbook | `cases.json`、`generators.json` |
| `qa review` | `cases.json`、`acceptance.json`、Runbook | `case-review.json`、`cases.reviewed.json` |
| `qa run` | `cases.reviewed.json` 中标 keep 的 case | `results/<caseId>.json` 和证据目录(视频、截图、trace、事实记录) |
| `qa report` | `results/`、`case-review.json` | `report.md` |

**`qa extract` 细节**
- 环境解析按 Runbook 的机械规则:展开候选 PR(排除已 merged),查找带 `<!-- preview-sandbox -->` 标记的 bot 评论,校验评论页脚的 SHA 等于 PR head SHA,不一致则失败退出。Goal 模式使用 `qa-environment.md` 里配置的 staging 环境。
- 每个验收原子必须带 `sourceRef` 和逐字 `anchor`。代码和 PR diff 只能产生候选,不能当作 Expected 出处。

**`qa design` 细节**
- 按 Runbook 中 `case-design.md` 定义的七个生成器(G1 验收、G2 断言、G3 状态迁移、G4 执行模式、G5 状态组合、G6 横切契约、G7 历史风险)逐个推导。每个生成器都必须有结论:产出了哪些机制,或"不适用"加一句理由。
- 每条 case 包含:`id`、标题、产出它的 `generator`、类型(happy/negative/edge)、`expected`(文本、`sourceRef`、`anchor`)、前置条件、风险、可测性状态(`ready`、`Blocked` 加恢复条件、`NotApplicable` 加依据)。
- 没有权威出处的机制不进计划,进入候选池并在 `generators.json` 里记录。
- 按"失效机制"去重,按"失败代价 × 发生可能"排序,按预算裁剪,被裁剪的写明原因。

**`qa review` 细节**
- 由 OpenAI 模型担任独立 reviewer。它使用与 `qa design` 不同的提示词和独立调用,且只读 `cases.json`、`acceptance.json` 和 Runbook,不能看 design 阶段的推理过程。
- 每条 case 的结论是 `keep`、`drop` 或 `revise`,必须附理由。
- 剔除依据(由 Runbook 和代码共同判定):没有可核对的 Expected 出处(anchor 在原文中不存在则由代码直接判 drop,不经模型)、与其他 case 重复、超出本次 ticket 或 PR 范围、前置条件在当前环境不可满足、副作用未获授权。
- `drop` 和 `revise` 的理由都落盘,以便将来的汇总核对。

**`qa run` 细节**
- 只执行 `keep` 的 case。每个 case 在独立的 E2B Desktop 沙箱中执行,调用已有的 Playwright 脚本。
- 每个已执行的 case 必须有从第一个业务 UI 操作开始的独立录像,在 `finally` 中停止并校验非空。
- 副作用动作超时时记为 `action_unknown`,下一步只能做只读核对,不盲目重试。
- 判定词表沿用 Runbook:`Pass`、`ProductFail`、`Blocked`、`Inconclusive`、`NotApplicable`、`Automation failure`。脚本漂移(`script_drift`)归为 `Automation failure`,不判 `ProductFail`。
- **没有匹配脚本的 case(用户已确认:第一版就包含生成新脚本)**:`qa run` 先在现有脚本中按 case 查找(确定性匹配),找不到时进入"脚本生成"子步骤(同时暴露为 `qa script` 命令,【我的决定】):
  1. 调用 OpenAI,依据 case 的前置条件、预期和被测页面的实时 DOM 快照(通过沙箱的 CDP 连接获取),生成一份 Playwright 脚本。
  2. 代码对生成的脚本做类型检查和 `playwright test --list` 校验,不通过则有限次重试,仍失败则该 case 记为 `Automation failure`,不执行。
  3. 校验通过后保存到本轮运行目录的 `generated-specs/`,然后和现有脚本一样在 E2B 中执行。
  4. 生成的脚本**不会自动写入** `hy_ui_autotest` 仓库,要纳入正式脚本库需要人工提升。
  - 因为生成的脚本没有任何人核对过,**来自生成脚本的结果在报告里单独标注 `generated`,并且其"断言失败"一律记 `Inconclusive`,不记 `ProductFail`**(【我的决定】,理由是无法区分产品缺陷和脚本写错)。
  - 仍然没有脚本也无法生成的 case 记为 `not_automated`,不执行也不伪造结果,计入报告的未覆盖部分。
- 现有脚本的调用契约(已核实):`run-e2b-playwright <sandbox-id> <Playwright 测试参数>`;必须设置环境变量 `E2E_TEST_OUTPUT_DIR`;运行前必须已经通过 `loop:state` 登记本轮 run(脚本内部调用 `assertRegisteredRun`)。账号和密钥由脚本自己通过 `loadQaEnv` 读取 `qa-env/.env.local`,Clerk 登录由 Playwright 的 auth actions 完成。`qa run` 不接触密钥,只负责登记 run、创建沙箱、设置输出目录、调用脚本、校验录像和结果。`action:select` 等脚本不调用 LLM,匹配是确定性的。
- 日志脱敏:`qa run` 保存脚本 stdout 和 stderr 之前,把环境中已知密钥的值替换为占位符。

**`qa report` 细节**
- 只汇总已有结果,不重新判定。包含:总体结论、case 总览、失败和阻塞 case 的复现条件、未覆盖和被剔除的 case 及理由、覆盖统计。
- 必须有一段固定的"独立性说明":执行前 case 清单经过一次独立审核,执行后的结论未经独立复核。

## 6. 配置

一个配置文件(`qa-harness.config.*`),启动时校验:

- `runbook.path`:Runbook 目录(必须存在,且包含第 4 节第 2 条列出的必需文件)
- `runRoot`:运行产物根目录
- `executor.scriptsRoot`:`hy_ui_autotest` 脚本所在目录
- `llm.model`、`llm.baseUrl`(默认 OpenAI 官方地址,允许改成兼容端点)
- 密钥(`OPENAI_API_KEY`、`E2B_API_KEY`、`LINEAR_API_KEY` 等)只从环境变量或 gitignored 的 `.env.local` 读取,配置文件里不存放密钥

## 7. 调度与失败行为

- 所有命令非交互运行,不提问;缺少输入就以非零退出码退出并说明原因。
- 退出码(多种情况并存时,数字小的优先):`0` 全部执行且为 `Pass` 或 `NotApplicable`;`2` 配置或 Runbook 无效;`3` 外部服务失败(OpenAI、Linear、E2B);`10` 存在 `ProductFail`;`20` 没有 `ProductFail`,但有 `Blocked`、`Inconclusive`、`Automation failure` 或 `not_automated`(即覆盖不完整)。
- LLM 返回不符合 JSON Schema 时重试有限次数,仍失败则退出,不用部分结果继续。
- 夜间核心回归使用 `qa all`,由 agent-autoloop 调用,`cwd` 不再影响行为,因为一切路径来自配置。

## 8. 留给实现者的部分

- 目录结构、模块划分、测试策略、日志格式
- JSON Schema 的具体字段命名(须保证第 5 节列出的信息都可表达)
- case 到脚本的绑定方式:现有仓库有 Action 表和 `action:select` 做 intent 匹配,可以沿用,也可以另设映射表
- `revise` 回路的具体实现

## 9. 已知风险

- 去掉执行后复核后,`Pass` 和 `ProductFail` 没有人独立核对。历史数据(5 个 run、30 条 case)里,逐 case 复核在首轮拦下了约四成,多数是证据或声明不完整,少数是结论过强。去掉后这类问题会直接进入报告,所以报告必须如实标注。
- `qa review` 的剔除可能造成漏测。因此 `drop` 理由必须落盘。
- 生成的 Playwright 脚本没有人核对,而且模型需要观察实时页面才能写出可用的选择器。这是本设计里最不确定、工作量最大的部分:生成成功率、选择器稳定性和对真实副作用(扣费、投放)的控制都没有数据。实现者应当先做一个小型试验,量出生成脚本的一次通过率,再决定其余工作的安排。
- 生成脚本里的副作用动作(提交、审批、付款)可能真实发生。第一版只允许对 Runbook 里标记为已授权的动作(如已预先授权的钱包充值)生成并执行,其余副作用动作的 case 记为 `Blocked`。
- 模型生成的 case 质量依赖 Runbook 的完整程度。Runbook 中 `pilot` 或 `draft` 状态的模块不能单独支撑 `ProductFail`。

## 10. 迁移范围(来源已由用户确认,具体清单待确认)

来源:本机安装副本 `~/.codex/skills/linear-browser-qa`(最后一次提交 9-20,之后有未提交的修改,`hy_ui_autotest` 最后修改 10/20、`qa-env` 10/21)。**不以源码仓库为来源**,原因见本节末尾的核实结果。迁移用复制加提交,不保留对原目录的运行时依赖。

**迁移的 Action(代码)**
- `hy_ui_autotest/src/actions/` 下 18 个文件。登记在 `src/tools/action-catalog.json` 里的 Action 共 191 个(`read` 117、`reversible` 45、`irreversible` 29)。
- Action 基础设施:`src/tools/` 中的 `action-catalog.json`、`action-hotlist.json`、`action-select`、`action-table`、`action-index`、`action-invocation`、`action-failure`、`action-health`、`shared-action-policy`、`shared-action-evidence`、`api-poll`、`app-navigation`、`identity`、`qa-env`、`e2b-shared-browser`、`video-transfer`、`stage-tracker` 和 `stages`。
- 执行支撑:`src/clients/`、`src/session/`、`src/cleanup/`、`src/account-fixtures.ts`、`src/e2b-testenv.ts`、`src/config.ts`、`src/fixtures.ts`、`src/report/evidence.ts`、`src/report/manifest.ts`。
- 现有的 Playwright 用例和测试:`tests/release/`(含 `assertion-refs.lock.json`)、`tests/fixtures/`、`tests/unit/` 中与上述代码对应的单测,以及 `playwright.config.ts`。
- Run 登记与门禁:`src/loop/state.ts`、`run-gate.ts`、`run-root.ts`,因为现有 `run-e2b-playwright` 在执行前要求 run 已登记。
- `scripts/` 中只迁移 `run-e2b-playwright.ts`、`e2b-action.ts`、`action-select.ts`。

**迁移的 QA module(内容)**
- `QA-models/hellyeah/` 的 17 个 module,加 `index.md`、`core-journeys.md`。这 17 个当前全部是 `pilot`(12)或 `draft`(5),没有 `active`。
- `QA-models/_schema/`(module 模板、task model 格式)和 `QA-models/_workflow/`(`qa-environment.md`、`linear-ticket-intake.md`、`pr-change-intake.md`)。
- 作为 Runbook 规则的 references:`case-design.md`、`knowledge-sources.md`、`verdicts.md`、`intake-routing.md`、`pr-driven-intake.md`、`goal-driven-intake.md`、`case-matrix.md`、`coverage-and-accuracy.md`、`temporal-risk-cases.md`。
- `assets/report.md`(报告模板)。

**不迁移**
- 执行后复核、漏测、人工评审、lane 合并相关代码:`src/loop/checker.ts`、`omission.ts`、`human-review.ts`、`lane-merge.ts`、`pr-diff.ts`、`drift-gate.ts`,以及对应的 `qa-checker`、`omission-hook`、`human-review` 脚本和 references(本版本的非目标)
- Computer Use 与探索:`src/computer-use/`、`src/exploration/`、`midscene_run/`
- `apps/`(报告展示应用)、`node_modules/`、`playwright-report/`
- `qa-env/.env.local` 及一切凭据。新仓库只通过配置指向凭据文件的路径,不复制内容
- `QA-Knowledge/`:暂不迁移(非目标"知识沉淀")。其中 `testing-heuristics.md`、`test-design-cases.md`、`bug-patterns.md` 是 `qa design` 可能有用的素材,是否迁移待用户决定。

**已核实(2026-11-06)**
- 迁移来源定为安装副本(用户确认)。源码仓库 `~/git-projects/skill/linear-browser-qa` 的最后提交是 11-05,但内容比安装副本旧:没有 `case-design.md`、`case-matrix.md`,Action 登记 33 个(安装副本 191 个),`src/actions/` 14 个文件(安装副本 18 个),缺 `run-gate.ts`、`run-root.ts`、`action-health.ts`、`action-failure.ts`。安装副本的最新内容是未提交的工作区修改(10-12 至 10-21)。
- 两份副本里文字有差异的只有 `QA-models/_workflow/qa-environment.md`(1 处)和 `references/knowledge-sources.md`(4 处)。逐处核对后,两处都是安装副本更新(qa-workbench 取代 pending-review,`QA_ROOT` 解析顺序可配置),不需要从源码仓库合并。
- `src/pages/` 在安装副本里是空目录,`src/actions/` 与 `tests/` 都没有引用它,Action 的 locator 是内联的,无需补页面对象。该目录不迁移。
- 安装副本有未提交的修改,迁移时记录它当时的状态,以便追溯。

**仍待决定**
- `QA-Knowledge/` 中 `testing-heuristics.md`、`test-design-cases.md`、`bug-patterns.md` 是否迁移(见上)。
- QA module 的统一命名与外部依赖文档的收拢(见第 11 节)。

## 11. QA module 命名统一与外部依赖收拢(待用户确认)

2026-11-06 只读审计(对象:安装副本 `QA-models/hellyeah/` 的 17 个文件)的结果:

**外部依赖约 40 份**
- `Hellyeah/business_file/*` 产品文档快照 17 份,均为 8-05 的历史快照。安装副本里没有 `Hellyeah/` 目录,这些引用在安装副本中是断的。
- `Hellyeah/product-memory.md`、`version-history.md` 及 `User-Dashboard-test/` 下的同名文件,共 4 份,同一文件有两种写法。
- `QA-Knowledge/` 6 份:`bug-patterns.md`、`testing-heuristics.md`、`domains/{webhook-event,campaign,admin-review,payment}.md`。
- `hellyeah-v2` 代码引用约 12 处,没有统一的仓库根,仅部分带 commit SHA。
- 无文件的出处约 5 条(QA 负责人口头裁定、Slack 口述、PR 验收),其中两条指向某次运行的 `pending-review.md`(`QA_ROOT/.../PR-1217/runs/...`),不是稳定文档。
- 悬空引用:`../_audit-models-2026-09-20.md`、`references/case-matrix.md`(后者在安装副本存在,在 module 内以相对路径引用方式不一致)。

**命名不一致**
1. 出处编号前缀 16 种(ACCT、REVIEW、AUTH、AGENT、COMPOSER、LAUNCH、LIFE、OPT、CREATIVE、META、NOTIFY、ONBOARD、SETTINGS、XRAY、WALLET、GTMCV);`wallet-payment` 编号从 002 起。
2. frontmatter:`core-journeys` 缺 `surfaces`、`related_modules`;`dashboard-routing`、`index` 无 frontmatter;`xray-gtm-conversion` 独有 `agent_testable`。
3. 章节名:"Browser 观察点"与"Page Signals";"副作用、Bug 判断与回流"与"副作用与恢复"。
4. 标题语言混用(纯英文、英文加中文说明、纯中文)。
5. 文件名前缀:`campaign-*` 5 个,xray 相关为 `tracking-xray`、`xray-gtm-conversion`。
6. 出处角色词:observation、risk、authority、user-confirmed、timeline,另有 `risk/user-confirmed rules` 等混合写法。

**【我的建议】,待用户确认后才动文件**
- 范围:命名与依赖收拢一起做。迁入 qa-harness 后,外部路径都会失效。
- 外部依赖:业务文档快照、`product-memory.md`、被引用的 6 份 QA-Knowledge 迁入 `runbook/sources/`;代码引用统一写成"仓库 + 路径 + commit SHA";口头裁定各写成一个小文件放 `sources/rulings/`。
- 编号:统一为 `<module 短名>-S<序号>`;出处表列固定为 Ref、Source、Role、Status;Role 取值限定为 5 个。
- 先产出"旧名到新名"对照表供用户审阅,再改文件。

### 11.1 外部依赖收拢:已执行(2026-11-06,用户确认外部依赖部分)

位置:本仓库 `runbook/`。
- `runbook/QA-models/`:从安装副本复制的 `hellyeah/`(19 个文件)、`_schema/`、`_workflow/`、`README.md`(只复制 `.md`)。
- `runbook/sources/hellyeah/`:被引用的 17 份 `business_file` 文档,以及 `product-memory.md`、`version-history.md`,加 `user-dashboard/` 下的另外两份同名但内容不同的文件。这批文件取自 `~/Documents/FR_workspace/Hellyeah/`(比源码仓库新,`version-history.md` 为 10-20 版)。
- `runbook/sources/qa-knowledge/`:被引用的 6 份。
- `runbook/sources/rulings/`:8 份裁定文件。PR-1217-K1、K2、K3 逐字摘录自原 `pending-review.md`;其余几份只有模块里的表述,原始记录缺失处已在文件内注明(W-20261014-10、12、13、51 和口述、Slack 原话)。
- module 的出处表已改写为指向 `sources/`,共 35 个路径,逐个核对均存在。

**尚未做:** 出处编号统一、frontmatter 与章节名统一、文件重命名(用户只确认了外部依赖部分);`hellyeah-v2` 代码引用的 commit SHA 补全(多数引用只有"读取日期",无法从现有材料还原 SHA);`README.md`、`_workflow/*` 中对旧路径的叙述性提及。

**更正:** 第 11 节中"`product-memory.md` 有两种写法"不准确,`Hellyeah/product-memory.md` 与 `Hellyeah/User-Dashboard-test/product-memory.md` 是内容不同的两份文件。

## 12. LLM 与 harness 的职责边界(待用户确认)

**总则**
- LLM 只做需要理解自然语言的判断:读文本、提方案、写草稿。
- harness(代码)负责一切有规则、有副作用、要读事实的事:读文件、调接口、校验、执行、判定、落盘、退出码。
- LLM 的每一个输出都只是提议。经 schema 校验和代码核对通过后才算数,通不过就重试,重试用完则退出,不用部分结果继续(沿用第 7 节)。

**LLM 绝不做**
- 读写文件、访问环境、接触任何密钥。需要的文本由 harness 读出来放进提示词。
- 判定已执行 case 的结果(`Pass`、`ProductFail` 等)。判定由代码按第 4 节第 10 条映射。
- 决定是否跳过校验、是否扩大预算、是否执行有副作用的动作。
- 计算退出码,生成报告里的数字与结论。

**harness 绝不做**
- 判断一句话是不是验收标准、两条 case 是不是同一种失效机制、一个前置条件在当前环境能不能满足。这些是语义判断,交给 LLM。
- 手写 Playwright 脚本。

| 阶段 | LLM 做 | harness 做 |
|---|---|---|
| `extract` | 从 ticket、PR 文本拆出验收原子,给出 `sourceRef` 和逐字 `anchor`;整理变更模型(surface、实体、状态迁移、副作用) | 拉取 Linear 与 GitHub 内容;展开候选 PR、排除已 merged、找 `<!-- preview-sandbox -->` 评论、核对页脚 SHA 等于 PR head SHA;写 `env.json`;核对每个 anchor 在原文中存在(归一化后),不存在的原子不落盘并记录原因 |
| `design` | 按七个生成器逐个推导并给出结论;写 case;判断失效机制是否重复;按"失败代价 × 发生可能"排序并提出裁剪 | 把 Runbook 原文放进提示词;校验 schema;检查七个生成器都有结论;核对 `sourceRef` 与 anchor;强制预算(`design.maxCases`、G1 全部纳入);没有权威出处的机制进候选池;保存 `cases.v1.json`、`cases.v2.json` |
| `review` | 作为独立 reviewer(不同提示词,不看 design 推理)对每条 case 给 `keep`、`drop`、`revise` 和理由:重复、超范围、前置不可满足、副作用未授权 | anchor 在原文不存在的 case 直接判 `drop`,不经模型;检查每条 case 都有结论、理由非空;理由落盘;控制 `revise` 回路最多两轮,仍不合格转 `drop` |
| `run` | **只有脚本生成一项**:依据 case 和实时 DOM 快照写 Playwright 脚本 | 按 case 确定性匹配现有脚本;校验生成脚本(类型检查加 `playwright test --list`)并有限重试;登记 run、建沙箱、设输出目录、调用脚本;校验录像;超时与 `action_unknown` 规则;Runbook 里未授权的副作用动作记 `Blocked`;确定性判定;日志脱敏;生成脚本的结果标 `generated`,断言失败一律 `Inconclusive` |
| `report` | 不用 LLM(【我的决定】报告只汇总,不重新判定,也不让模型润色结论) | 全部由代码生成,包含固定的"独立性说明" |

**需要用户确认的三点(都是我的选择)**
1. `report` 完全不用 LLM。如果想要自然语言摘要,可以加,但摘要不得改变结论或数字。
2. `design` 里的去重与排序由 LLM 做,代码只强制数量上限和 G1 全纳入,不自己判断哪条该删。
3. `extract` 中 anchor 核对失败的原子直接不落盘并记录原因,而不是让整条命令失败。理由是单个原子的 anchor 写错不应让整张 ticket 无法测试;代价是可能少抽一条验收,所以落盘的原因清单要在报告里列出。
