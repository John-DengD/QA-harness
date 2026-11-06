# Ticket Task Model Template

保存到 `<ticket>/traces/ticket-task-model.md`，并在执行中更新状态。原始 ticket 快照另存 `tickets/`，不要用本文件覆盖原文。

```yaml
ticket:
  id: QA-000
  title: ""
  url: ""
  type: []
  parent: null
  related_tickets: []
  prs: []

target:
  product: hellyeah
  surface: customer-dashboard
  environment: staging
  build: unknown
  role: unknown
  org: unknown

change_model:
  actor: ""
  surface: ""
  trigger: ""
  entity: ""
  current_behavior: ""
  expected_behavior: ""
  state_transition: ""
  inputs: []
  side_effects: []
  observability: []
  non_goals: []

requirement_atoms:
  - id: TICKET-AC-01
    statement: ""
    applies_when: {}
    expected_facts: {}
    source_ref: ""
    authority: ticket
    ambiguity: null

module_routing:
  primary_modules: []
  adjacent_modules: []
  model_gaps: []
  excluded_modules: []

tasks:
  - id: TASK-01
    kind: acceptance
    generator: G1-acceptance   # G1-acceptance | G2-assertions | G3-transitions | G4-execution-modes | G5-state-pairs | G6-cross-cutting | G7-history，见 references/case-design.md
    intent: ""
    module: ""
    requirement_refs: []
    assertion_refs: []
    action_refs: []
    preconditions: []
    facts_to_collect: []
    expected: {}
    evidence_required: []
    side_effect: read
    cleanup: none
    data:                      # 同一 shard 内排序与重跑依据，见 references/workflow.md「同一 shard 内 Case 排序」
      requires: []             # 出发前必须成立的数据/状态，例：["未安装 tracker 的 org"]
      produces: []             # 本 Case 会造出的数据/状态，例：["一笔 COMPLETED 的 admin top-up"]
      mutates: []              # 会改掉的共享状态，例：
                               #   - { state: "org 钱包余额", reversible: true, undo: "Action reverseAdminTopUp" }
                               #   - { state: "org 的 tracker 已 live", reversible: false }
    execution_mode: AIIndependent
    status: NotRun

generator_results:            # 七个生成器都要有结论：产出的机制，或不适用及理由
  G1-acceptance: []
  G2-assertions: []
  G3-transitions: []
  G4-execution-modes: []
  G5-state-pairs: []
  G6-cross-cutting: []
  G7-history: []

excluded_assertions: []
open_questions: []
first_safe_action: ""
```

## 约束

- Ticket 原文和评论中的事实必须保留 source ref。
- `expected` 不能来自无来源的 Agent 推断。
- 模块 Assertion 适用性需核对目标版本和前置条件。
- `TEMP-*` 只在当前 run 有效，测试后进入 QA 工作台。
- 每条任务填 `data`：`requires` 写出发前置，`produces` 写本 Case 造出的数据，`mutates` 写会改掉的共享状态；每项标 `reversible`，可撤回的**必须**写 `undo`（不写会在冻结 Case packet 时被拒）（引用 `hy_ui_autotest/src/tools/action-catalog.json` 的 `undoneBy` 或具体页面操作），`reversible: false` 不写 `undo`。只读任务三项均为空。执行顺序与冲突处理见 `references/workflow.md`「同一 shard 内 Case 排序」。
- 执行状态使用 NotRun、Running、WaitingUser、WaitingExternal、Blocked、Pass、ProductFail、Inconclusive、NotApplicable、SkippedByConstraint。
