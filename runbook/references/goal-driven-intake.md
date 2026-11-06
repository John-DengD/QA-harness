# 测试目的入口与自主 Case 规划

用户不需要提供 PR 或 Linear。以下请求都直接进入 Agent QA：

- “测一下 Launch Campaign 的主要流程”
- “测试一下 Creative”
- “回归一下主要核心流程”
- “把 Campaign Editor 连跑 10 次”
- “比较 staging 和两个 PR 的 onboarding”

## 1. 识别模式

| 模式 | 典型输入 | 任务模型 |
|---|---|---|
| `ticket` | Linear QA 单、已确认关联 QA 单的 PR | `ticket-task-model.md` |
| `pr` | 仅 PR，没有已确认 QA 单 | `pr-case-model.md` |
| `goal` | 产品域、业务流程、回归目标 | `goal-test-model.md` |
| `repeat` | 同一目标 N 次、稳定性/偶现验证 | 在 ticket/pr/goal model 上增加 repetition |

输入同时有 ticket 和测试目的时，以 ticket 定义改动 Expected，以用户目的裁剪或扩展执行范围。只给 PR 时按 [PR 变更驱动规划](pr-driven-intake.md) 从 diff 定位影响、从 PR 明确原文/已确认规则找 Expected；不凭 PR 链接臆造 ticket。PR 加测试目的时，用用户目的明确测试范围，并扫描范围内的 PR 影响。

## 2. Goal Test Model

保存到 `<run>/run-state/goal-test-model.md`：

- 用户原始测试目的；
- 产品、surface、角色、环境；
- primary module 和必要 adjacent modules；
- 核心业务终点；
- 规划的 cases、每条 applies_when、facts、assertions、证据，以及数据依赖 `requires`/`produces`/`mutates`（字段同 [Ticket Task Model](../QA-models/_schema/ticket-task-model.md) 的 `data`，用于 [同一 shard 内 Case 排序](workflow.md#同一-shard-内-case-排序)）；
- 目标→去重 Case→断言/证据映射，以及每条 Case 相对已有 Case 的独立风险；
- 风险与副作用；
- 数据/账号需求；
- repetitions 与 run shard 计划；
- 不做什么；
- 停止条件和完成门槛。

不要创建假的 ticket ID、PR 号、checklist 或“产品要求”。

## 3. 从目的到 Case

1. 将用户用词映射到 `SKILL_DIR/QA-models/<product>/index.md` 的 routing signals。
2. 读取 primary module；只加载有明确接口/状态关系的 adjacent modules。
3. 按 [Case 设计：七个生成器](case-design.md) 推导：用户目的拆成验收原子走 G1，其余生成器读命中模块的断言、状态模型、Business Actions、待补测与历史风险；每个机制标 `generator`。
4. 从 QA-Knowledge 和 product-memory 选择高价值风险：权限、金额、异步、刷新、幂等、恢复、跨模块状态。
   对高代价异步/并发目标按 [时序风险 Case 发现](temporal-risk-cases.md) 推演事件顺序，选出有权威 Expected 和可观察事实的补充 Case；不扩成无关全量回归。
5. 按 [Case 覆盖与执行准确率](coverage-and-accuracy.md) 去重，并用 [Action 索引与命中实验](action-reuse.md) 预选适用 Action；缺口才交给动态探索。
6. 为每个 case 选择执行器：已有成熟路径用 Playwright，新路径在桥接可用时用 E2B Computer Use 原子闭环；Case 结束即记录知识/脚本沉淀判断，实现与验证可安排在本轮收尾。

### “主要流程”

选择该模块从入口到持久业务终点的 happy path，再加最能证明状态没有停在中间的一条持久化/刷新核验。不要把所有边界条件都塞入“主要流程”。

### “测试 Creative”

先判断用户指 Studio 创建、上传裁剪、Campaign picker、素材预览、生成状态还是跨平台规格。若上下文能从当前产品和最近任务明确推断，先覆盖共同主链并记录分支；只有不同解释会导致完全不同的高副作用路径时才询问。

### “核心流程回归”

读取 `QA-models/<product>/core-journeys.md`，选择当前 surface 可执行的主链。登录是前置；第三方后台继续遵循环境约束。每条 journey 拆成独立 case，失败不阻止其它独立 case。

## 4. Expected 来源

- 用户明确陈述“应该/必须/不能”的行为，可作为本轮 Expected。
- PR-only 模式下，PR 描述中明确、可观察、与当前 head 适用的行为可作本轮 `pr_spec`，不自动成为长期产品规则；详见 [PR 变更驱动规划](pr-driven-intake.md)。
- `active` QA-models assertion 可定义 goal 回归 Expected。
- `pilot/draft` 模块只用于路由、facts 和 smoke；单独失败不能判 ProductFail。
- product-memory/QA-Knowledge 提供风险和误判排除。
- 代码只说明实现事实，不定义正确预期。

缺少权威 Expected 时仍可执行探索并交付事实，但结论用 Inconclusive/UX observation，不用模型常识制造 ProductFail。

## 5. 环境选择

- 用户给 PR：使用其 live sandbox，并校验 SHA。
- 用户明确 staging：使用 `qa-environment.md` 配置的 staging。
- 用户只说产品流程：默认使用 QA 环境配置中的非生产主环境；报告明确环境。
- 多环境比较：每个环境建立独立 run shard 和 E2B。
- 生产环境不因“主要流程”被自动选中。

## 6. 默认执行

除非用户说“只规划”，完成 Goal Test Model 后继续选择/复用执行器、建立 E2B、动态执行、收证、归因、按价值沉淀脚本、生成并发布 artifact。不能停在 case 列表。
