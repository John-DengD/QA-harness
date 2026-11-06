# qa-harness

按 QA Runbook 驱动的 QA 命令行工具。每个 QA 环节一条命令,环节之间用落盘文件衔接;LLM 只做语言判断,其余(读取、校验、执行、判定、落盘、退出码)都是代码。设计见 [设计文档](docs/superpowers/specs/2026-11-06-qa-harness-cli-design.md)。

```
qa extract → qa design → qa review ⇄ qa design --revise → qa run → qa report        (qa all = 以上全部)
```

| 命令 | 输入 | 输出(都在 `<runRoot>/<feature>/runs/<runId>/` 下) |
|---|---|---|
| `qa extract` | `--ticket <LINEAR-ID>` / `--ticket-file <path>` / `--pr <url>` / `--goal <text>`(四选一) | `acceptance.json` `change-model.json` `env.json` `sources.json` `extract-report.json` |
| `qa design` | 上一步产物;`--revise` 只重做评审标 revise 的 case | `cases.json` `cases.vN.json` `generators.json` |
| `qa review` | `cases.json` | `case-review.json` `case-review.vN.json` `cases.reviewed.json` |
| `qa run` | `cases.reviewed.json` `env.json` | `results/<caseId>.json` `evidence/<caseId>/` `run-summary.json` `generated-specs/` |
| `qa report` | `results/` 等 | `report.md` |
| `qa doctor` | 配置与 Runbook | 校验结果;每条命令启动时也会先跑一遍 |

所有命令都需要 `--config <path>`(默认 `./qa-harness.config.json`);除 `doctor` 外还需要 `--feature <名字> --run-id <id>`;已存在的产物不会被覆盖,除非加 `--force`。命令从不提问,缺输入就退出并说明原因。

## 配置

1. `qa-harness.config.json`:Runbook 目录、运行产物根目录、executor 目录、LLM 模型名和预算。**不放密钥,也不放任何测试地址**。示例里 `llm.model` 是占位符 `REPLACE_WITH_OPENAI_MODEL`,必须改成真实模型名。
2. 密钥和测试地址放环境变量,或放这两个 gitignored 文件之一(优先级:真实环境变量 > `.env.local` > `qa-env/.env.local`):
   - `<配置文件目录>/.env.local`
   - `<配置文件目录>/qa-env/.env.local`(executor 读的同一个文件,变量名与 hy_ui_autotest 一致)

   | 变量 | 用途 |
   |---|---|
   | `OPENAI_API_KEY` | extract / design / review / run(生成脚本) |
   | `E2B_API_KEY` | run(创建沙箱) |
   | `LINEAR_API_KEY` | 只有 `--ticket` 需要 |
   | `E2E_BASE_URL`(可选 `E2E_API_URL`、`E2E_CONTROL_URL`) | staging 地址;`--ticket-file`、`--goal` 和没有链接 PR 的 `--ticket` 使用。没有默认值 |
   | `E2E_ACCOUNT_EMAIL` `E2E_EMAIL_BASE` `E2E_TEST_PASSWORD` `CLERK_PUBLISHABLE_KEY` `CLERK_SECRET_KEY` `STAGING_E2E_ADMIN_TOKEN` 等 | executor / Playwright 脚本自己读取,见 hy_ui_autotest 的 `qa-env/.env.example` |
3. Runbook(`runbook/`)是内容,不是代码:`QA-models/`(模块)、`references/`(规则)、`sources/`(外部依赖文件)、`environments.json`(PR sandbox 评论的标记、作者、状态文案、URL 标签、页脚 SHA 模式)、`script-bindings.json`(case 标题到现有 Playwright 脚本的绑定)、`authorized-side-effects.json`(生成脚本允许的副作用)。环境约定变了就改这些文件,不改代码。
4. `executor/` 是从 linear-browser-qa 迁移来的 Action 和 Playwright 执行器,记录见 [executor/MIGRATION.md](executor/MIGRATION.md)。第一次使用:`cd executor && pnpm install`。

## 第一次运行

```bash
pnpm install
(cd executor && pnpm install)
# 改好 qa-harness.config.json 的 llm.model,把密钥和 E2E_BASE_URL 放进 .env.local
pnpm qa doctor
pnpm qa extract --feature DEMO --run-id r1 --ticket-file ./ticket.md      # 先只跑第一步,看 acceptance.json
pnpm qa all --feature DEMO --run-id r2 --ticket-file ./ticket.md          # 全流程
```

## 退出码

`0` 全部执行且为 Pass 或 NotApplicable;`2` 配置、Runbook 或输入无效(含没有 live sandbox、SHA 不一致、没有验收点通过核对);`3` 外部服务失败(OpenAI、Linear、GitHub、E2B);`10` 存在 ProductFail;`20` 没有 ProductFail,但覆盖不完整(Blocked、Inconclusive、Automation failure、未自动化或被跳过)。几种并存时数字小的优先。

## 测试

`pnpm test`(根目录,不联网)、`pnpm tsc --noEmit`;executor 自己的测试在 `executor/` 里 `pnpm test:unit`。`tests/pipeline.test.ts` 用假的 LLM、假的沙箱把五个阶段串起来跑一遍。

## 已知限制(需要真实运行来验证)

- **从未对真实的 OpenAI、E2B、Linear、GitHub 跑过。** 这些适配层只做了命令行与数据格式的单元测试。`qa-sandbox.ts`(创建沙箱、录像、取页面)是按原 Computer Use 脚本移植的,首次运行可能要调整。
- OpenAI 结构化输出用的是非 strict 的 json_schema 模式,所有输出由 zod 再校验一遍。
- **生成的 Playwright 脚本的一次通过率没有数据**(设计文档第 9 节要求先量出来)。生成脚本的断言失败一律记 Inconclusive。
- 现有脚本的匹配只有 `script-bindings.json` 里的精确标题绑定,目前是空的;`action:select` 的意图匹配没有接入,所以几乎所有 case 都会走脚本生成。
- 过期的 PR sandbox 不会自动用 `/sandbox` 评论刷新,SHA 落后就直接失败。
- 副作用动作超时后的 `action_unknown` 规则没有强制执行,只在生成脚本的提示词里要求"不要盲目重试"。
- 没有 `qa script` 单独命令,没有 `--publish`(发布到 artifact.cafe)。
- `executor/` 保留了设计文档说不迁移的几个文件(checker、omission 等,因为 `state.ts` 引用它们)和 14 个设计之外的维护脚本,见 MIGRATION.md。
