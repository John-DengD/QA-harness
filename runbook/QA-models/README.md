# QA Models

QA Models 是 Browser Use 的产品语义层。它把分散在业务文档、产品记忆、版本历史和 QA Knowledge 中的内容整理成稳定、可执行的业务测试合同，供 Linear ticket 路由和 Browser Use 动态测试使用。

建立这层的目的，是避免测试 Agent 每次重新阅读代码、临时理解产品并自由发明断言。模块向 Agent 提供已经提炼和审核过的业务状态、动作、观察点、断言、恢复规则和误判排除，从而提高测试框架的容错性、可重复性和鲁棒性。

## 角色分工

- `business_file/`：历史产品意图和术语背景，不作为当前 Expected。
- `version-history.md`：规则生效、修复、回归和历史版本证据。
- `product-memory.md`：当前产品的长期测试判断导航。
- `QA-Knowledge/`：跨产品测试方法、风险和 Bug 模式。
- `QA-models/`：按业务模块组织的状态、断言、观察点、证据和误判排除。

QA Model 不是新的产品规范，但它是测试执行期的首选接口。每条强制断言必须引用上游来源；来源过期、冲突或不适用于当前版本时，该断言不得直接用于判 Product Bug。

## 建模期与执行期

### 建模期

维护模块时可以读取业务文档、代码、PR、产品记忆、版本历史和真实测试证据，用于提炼稳定业务合同。新知识必须标来源、适用版本和审核状态。

### 执行期

测试 Linear ticket 时默认只读取 ticket、模块索引、命中的模块和必要的运行证据。不要重新遍历产品代码或全部业务文档来理解已有能力。

仅在以下情况回查上游资料：

- ticket 明确引入模块尚未描述的新行为；
- 模块版本或适用环境与目标部署不匹配；
- 运行事实与模块断言冲突；
- 模块将某项标记为 gap、candidate 或 needs-review；
- 需要定位失败原因，但代码结论只能标为推测。

遇到模块缺口时记录 `model_gap`，继续执行不依赖该缺口的目标，并将候选知识写入 QA 工作台。不得在测试过程中静默生成一条永久规则来让当前结果通过或失败。

## 目录

```text
QA-models/
  README.md
  _workflow/
    linear-ticket-intake.md
  _schema/
    module-template.md
    ticket-task-model.md
  _examples/
  hellyeah/
    index.md
    dashboard-routing.md
    auth-organization.md
    wallet-payment.md
    campaign-launch.md
```

## Ticket 路由

收到 Linear ticket 后：

1. 提取产品、surface、动作、实体、状态、风险和关联 PR。
2. 从产品 `index.md` 选择 primary modules。
3. 根据模块的 `related_modules` 加载必要的邻接模块。
4. 选择 ticket 明确断言、模块核心不变量和相关历史风险。
5. Browser Use 执行时只加载当前需要的模块，不读取整个库。

详细转换规则见 [`_workflow/linear-ticket-intake.md`](_workflow/linear-ticket-intake.md)。执行任务使用 [`_schema/ticket-task-model.md`](_schema/ticket-task-model.md) 保存。

若 ticket 无法路由到任何模块，先标记 `model_gap: unrouted_ticket`，再进行最小范围的材料发现；发现结果用于本轮临时判断和模块候选，不自动成为 active 断言。

## 运行时模块合同

一个能被 Browser Use 稳定使用的模块至少提供：

- `page_signals`：URL、页面标题、关键可见文本和状态锚点，用于确认当前页面；
- `business_actions`：动作意图、前置条件、预期状态变化和副作用等级；
- `facts`：需要从 UI 或只读 surface 观察的结构化业务事实；
- `assertions`：Expected、适用条件、事实比较方式和证据要求；
- `recovery`：loading、过期会话、异步等待、动作未知和状态偏移的处理；
- `cleanup`：本轮对象的恢复、保留或人工收尾方式；
- `non_bugs`：合法降级、异步中间态和常见误判。

模块描述业务语义，不保存容易失效的坐标。优先使用可见名称、角色、标签、状态文本和稳定 test id；页面改版时允许 Agent重新定位，但不得改变动作和断言语义。

测试范围：

```text
Ticket 验收标准
+ Primary module 核心不变量
+ 跨模块接口契约
+ 与改动相关的历史 Bug 风险
```

## 来源与冲突

断言来源按用途分层：当前 ticket/明确用户要求定义本轮新行为的 Expected；已审核且适用于目标版本的 active 模块断言可定义未改动行为的回归 Expected。version history 判断时效，product memory 排除误判，QA Knowledge 提供方法和风险，历史报告只提供观察与复现线索。不能用一条全局优先级让历史资料覆盖本轮验收。

`business_file/` 是历史产品意图和术语背景，不是执行期的当前正式业务文档；产品代码说明实现事实，也不定义 Expected。来源表中的这些引用均标为 `observation`，保留原始出处供定位。没有 ticket、用户确认或已审核的当前文档时，相关 Case 只能记为候选、UX observation 或 Inconclusive，不能单独判 Product Bug。模块整体仍为 pilot/draft，来源标签不使断言自动升级为 active。

模块中的 `source_role`：

- `authority`：经审核的当前来源才可以定义预期，还须检查版本适用性；pilot/draft 模块中的标签不使断言自动生效。
- `timeline`：用于判断规则何时生效或是否过期。
- `risk`：用于扩展测试，不单独定义失败。
- `observation`：历史事实，只作为复现和风险线索。

同一规则冲突时，不在模块内静默选边。记录冲突、影响断言和当前决定；无法消解时结果为 Requirement conflict/Inconclusive。

## 模块成熟度

- `pilot`：已从现有材料提炼，等待真实 ticket 试跑和人工复核。
- `active`：已通过至少一次真实测试验证，来源与断言得到确认。
- `needs-review`：来源变更、冲突或行为变化，需要重新审核。
- `deprecated`：业务能力下线，仅保留历史追溯。

每次测试后只回流已确认内容。单次异常、推测原因和待确认规则进入 `QA-Knowledge/qa-workbench.md`。

### 降级：成熟度是双向的

**只升不降的知识库一定在积累错误。**库越大，执行期加载的内容越多，而其中死断言和坏断言的比例只会上升。

命中以下任一条件时，把断言或整个模块降回 `needs-review`，并写明触发原因和来源 run：

| 触发条件 | 说明 |
|---|---|
| **判断被驳回** | 该断言判出的 ProductFail 在 Linear 上被关闭为 not a bug / won't fix |
| **长期零引用** | 连续多轮路由命中该模块，但这条断言从未被任何 case 使用 |
| **上游失效** | `source` 指向的 ticket、业务文档或版本记录已变更、过期或被推翻 |
| **持续不可判** | 反复导致 `Inconclusive`，说明断言的事实比较方式在当前产品上不可观察 |
| **反复冲突** | 多轮出现 `requirement_conflict`，说明它与当前业务口径已经不一致 |

降级是人工触发的建模期动作，不在执行期自动发生——执行中只记录触发信号（见 `_schema/run-metrics.md` 的 `bugs[].assertion_ref` 与 `correctness` 段），由人在建模期据此决定。

健康判据：**每个评审周期的降级数应当大于 0。**长期只有升级没有降级，说明降级信号没有被真正查看，而不是说明知识全部正确。
