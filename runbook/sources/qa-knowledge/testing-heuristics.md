# Testing Heuristics

用于沉淀可复用的测试设计方法、风险启发式和需求拆解思路。

## 条目模板

```md
## <YYYY-MM-DD> <产品线> - <启发式名称>

- **来源**：<工单 / 报告 / 版本>
- **适用场景**：<什么类型需求适用>
- **测试思路**：<如何拆测试点>
- **重点风险**：<最容易漏的风险>
- **证据要求**：<需要什么输出、截图、日志或数据>
- **后续复用**：<下次遇到类似需求怎么用>
```

## 初始规则

### 2026-09-20 通用 - 缓存功能要拆成「命中后的行为」和「真实环境能否命中」两条结论

- **来源**：QA-1017 / QA-1033；从 `pending-review.md` `K-2026-08-17-003` 提升（2026-09-20 用户确认）。
- **适用场景**：任何带缓存的功能验收 —— 关键词 grounding 缓存、forecast 缓存、以及后续所有「为了省调用/省时间」而引入的缓存层。
- **测试思路**：把结论拆成互相独立的两条，分别取证。
  1. **命中后的行为对不对** —— 命中时是否零下游调用、是否不重复排队、返回值是否与未命中一致。这条单测通常能覆盖。
  2. **真实环境到底命不命中** —— **必须去 DB / log 看实际命中率**，不能靠单测。单测里的「命中」往往是 mock 掉缓存读、直接返回命中行，它只证明了第 1 条。
- **重点风险**：**第 2 条不成立时第 1 条全绿**。QA-1017 就是这个形态 —— 命中零调用、命中不排队都有精确单测且通过（`keywords.test.ts:253` / `:289`），但真实环境**永不命中**：缓存键里含 LLM 生成的 seeds（见 `packages/campaign-agent/src/keyword-planner.ts` 的 `getKeywordPlannerCacheKey`），每次都不一样。三条 staging draft 全部 `groundingCacheHit: false`。只看「相关单测全绿」会误判缓存已放行。
- **可操作的判断动作**：
  1. 看到缓存类工单，**先问「缓存键的每个字段，在重复同一个用户操作时是否保持稳定」**。键里出现 **LLM 输出、时间戳、随机 id、自增序号**的，一律先怀疑永不命中。
  2. 去 **DB / log 查实际命中标志**（如 `groundingCacheHit`），用同一操作重复至少两次，确认第二次真的命中。
  3. 命中率为 0 时，先定位是键不稳定、TTL 过短，还是写入路径根本没执行。
- **证据要求**：缓存键的构造代码位置、重复操作两次的命中标志（DB 或 log 原始值）、相关单测的 mock 方式、下游调用次数。
- **后续复用**：同类风险还包括 forecast 缓存（键含 grounding 选出的 keywords，同样在 LLM 下游）。任何缓存工单的放行条件都必须包含「真实环境命中率 > 0 的直接证据」。

### 2026-06-25 Hellyeah Creative - Compositor 要分层验证生成、编辑、blend 与真实文件

- **来源**：QA-913；报告 `Hellyeah_1.2.0/result/2026-06-25_11-00_QA-913-brand-research-creative-compositor.md`
- **适用场景**：creative image text layer、image edit、blend-text、platform-ready image 尺寸与可读性测试。
- **测试思路**：不要只看 `creative status=complete`、`textLayerConfig` 或 API 返回 URL。必须下载实际 PNG，分别检查原始生成图、edit text 图、blend-text 图，并核对 metadata width/height 与文件真实尺寸、比例、文字可读性。
- **重点风险**：某一路径可读不代表全部 compositor 路径可用；例如 blend-text API 单独可读，但 generate/edit text layer 仍可能渲染成方块字。API metadata 也可能报告平台目标尺寸，但实际文件尺寸/比例不符合广告平台 spec。
- **证据要求**：保存 job id、resultImageUrl、status metadata、实际 `file` 尺寸、图片 artifact、人工/AI 视觉检查结论、position/font/textLayerConfig。
- **后续复用**：后续 creative/compositor 工单固定覆盖 `generate -> status -> download -> edit -> download -> blend -> download`，并把“真实图片文字可读”和“真实尺寸符合平台 spec”作为放行条件。

### 2026-06-10 通用 - 提测单先分流再测试

- **来源**：QA 闭环知识系统设计
- **适用场景**：任何提测单进入后的第一轮分析
- **测试思路**：先判断 AI 独立执行、AI+人工协作、人工主导，再决定是否跑框架或生成人工 checklist。
- **重点风险**：未判断权限、环境、可观测性和执行风险就直接自动化，容易误判结果或产生不可逆影响。
- **证据要求**：分流结论必须写明原因、可自动部分、人工参与部分、缺失信息、建议测试顺序、风险注意事项。
- **后续复用**：每次测试前先输出分流判断，再执行测试。

### 2026-06-11 Hellyeah CLI - 版本升级要三方核对 docs/help/runtime

- **来源**：`Hellyeah_1.1.0/result/2026-06-11_12-25_hellyeah-cli-e2e-regression.md`
- **适用场景**：CLI beta/staging 版本升级、命令 surface 迁移、agent 调用契约回归。
- **测试思路**：同一能力至少核对三层证据：同步业务文档、`--help` 输出、真实命令运行结果。若三者不一致，先判断是产品 bug、文档差异、帮助契约差异还是测试方法偏差。
- **重点风险**：只按旧文档写用例会误判新命令；只看 help 又可能漏掉运行时条件校验，例如 total budget 场景下实际要求 `--end-date`。
- **证据要求**：保留旧命令返回的迁移提示、help 输出、实际 validation error/exit code，以及新命令成功结果。
- **后续复用**：每次 CLI 回归先跑 `--version`、主命令 `--help`、关键子命令 happy path 和至少一个 runtime validation case，再决定是否更新测试矩阵。

### 2026-06-11 Hellyeah CLI - Creative 要验完整广告组合质量

- **来源**：`Hellyeah_1.1.0/result/2026-06-11_16-55_complete-ad-preview-quality.md`
- **适用场景**：广告文案、图片生成、campaign launch、Admin approve、Google display 素材回归。
- **测试思路**：不能只验 `creative status=complete` 和 campaign launch 成功；必须把 text creative、image URLs、campaign `adCopy.ads[]` 组合起来看，确认用户最终看到的广告是否成立。
- **重点风险**：图片可能非空且 job complete，但出现幻化品牌、无关产品示例、业务语义跑偏，或 API 元数据尺寸与实际文件尺寸不一致。
- **证据要求**：保存 text job、image job、campaign id、image URL、实际下载文件尺寸、campaign `adCopy.ads[]`，并人工检查图片内容。
- **后续复用**：下次 creative/campaign 回归把“文案完整性、图片品牌一致性、图片业务相关性、实际尺寸契约、组合后 adCopy”列为固定检查项。

### 2026-06-12 Hellyeah CLI - Integration 工单先做三层部署 smoke gate

- **来源**：`Hellyeah_1.1.0/result/2026-06-12_10-46_HEL-1131-stripe-revenue-connect.md`
- **适用场景**：CLI + API + 第三方 webhook/OAuth 的集成类提测单。
- **测试思路**：进入 OAuth、支付、webhook 等深链路前，先核对三层是否真的部署并可运行：CLI 命令面是否存在、OpenAPI 是否暴露目标 paths、带合法 auth/org 的预期 endpoint 是否不再 404/500。
- **重点风险**：PR 在 feature/stacked branch merged 不等于 staging deploy 已包含；surface 部署成功也不等于 DB migration/config/runtime 可用。如果跳过 smoke gate，后续人工 Stripe/Admin/X-Ray 协作会浪费时间。
- **证据要求**：保存 CLI `--help`/子命令输出、OpenAPI path 查询结果、未登录 401、多 org `E_ORG_REQUIRED`、带 org 后 404/500/业务响应；若出现 500，直接 API 复核 HTTP status、requestId 和是否泄露内部错误细节。若 API 返回 OAuth authorize URL，还要解析并保存 `client_id`、`scope`、`redirect_uri`，确认 provider 页面不拒绝。
- **后续复用**：以后遇到 Stripe、X-Ray、Postbacks、Admin webhook 这类跨系统工单，先跑三层 smoke gate、runtime smoke 和 OAuth URL 参数检查，再决定是否请求用户做深度协作。

### 2026-06-12 FinalRound Web/Desktop - Release 记忆从 Slack 部署流补全

- **来源**：Slack `frai-deployment-and-cr` 频道历史，InterviewAI release #2442 与 Desktop CR 线程。
- **适用场景**：没有正式提测单，但频道里有发布、CR、hotfix、测试反馈，需要补产品记忆或评估版本影响。
- **测试思路**：先按 PR 仓库归属分层，再按“发布对象 -> PR/commit -> canary/prod -> 健康检查 -> 线程人工反馈 -> 下次回归点”抽取，不把部署成功等同于产品通过。
- **归属规则**：`frai-website` 记 Web；`finalround-desktop` 记 Desktop；`interviewai` 和 `frai_js_server` 记共享 InterviewAI/Backend，只作为 Web/Desktop 的依赖风险引用。
- **重点风险**：Slack 里常混合 release summary、review request、人工测试反馈和 bot 部署日志；只记录 PR 标题会漏掉线程里的真实风险，例如 payment deep link 登录异常、ASR TTFT 既有 alert、cross-pod WS 背景。把共享后端 PR 直接记成 Web 或 Desktop 改动会污染产品记忆。
- **证据要求**：记录 channel id、thread ts、PR 链接、仓库名、commit/image、canary/prod rollout、auto-test run、Datadog/watch item、人工反馈原始结论。
- **后续复用**：每次接到 FinalRound Web/Desktop 测试任务前，先查 `frai-deployment-and-cr` 最近 release/CR，再按仓库归属合并到 Web、Desktop、Shared-InterviewAI 三处记忆。

### 2026-06-12 Shared InterviewAI - 生产 only bug 不能只用 dev 结论关闭

- **来源**：Slack `frai-deployment-and-cr` 早期历史，`interviewai#2127` GCS/Firestore V2 credentials 修复。
- **适用场景**：上传、存储、凭证、区域访问、第三方服务、prod-only 报错。
- **测试思路**：先在 dev/preview 复现和验证修复，再明确标注 prod-only 条件；如果风险来自生产凭证或区域访问，必须在 prod 发布后做最小验证或拿到生产日志/用户反馈。
- **重点风险**：dev 环境使用不同 credentials、bucket、region、IAM 或 Firestore client，dev 通过不能证明 prod 用户不再报错。
- **证据要求**：保存环境、commit/PR、上传文件类型、GCS/Firestore client 路径、prod 发布确认、生产日志或用户侧“不报错”反馈。
- **后续复用**：遇到简历/材料上传、文件存储、region 用户问题时，把“prod-only 验证证据”列为报告必填项。
