# PR Change Intake

仅给 PR 且没有已确认 QA 单时，按 [PR 驱动入口](../../references/pr-driven-intake.md) 形成 `RUN_ROOT/run-state/pr-case-model.md`；可判断的 PR 原文保存在 `RUN_ROOT/tickets/pr-spec.json`。本文件是建模清单；环境、来源强度、漏项扫描与执行门槛以链接中的规则为准。

| 层 | 问题 | 产出 |
|---|---|---|
| PR identity | 哪个仓库、base/merge-base/head、live sandbox 实际 SHA？ | 可重现的 diff 范围和描述快照 |
| Change | 哪个用户/组织在何处触发，哪个实体/状态/副作用改变？ | `changeId` 与 diff 锚点，未知项写 `unknown` |
| Impact | 直接路径和相邻合同会怎样受影响？ | 按不同失效机制去重的 `mechanismKey` |
| Source | PR 原文是否明确承诺可观察结果，或有其它当前有效规则？ | `sourceKind/sourceRef/anchor/appliesWhen`；只有代码推断则待确认 |
| Case | 哪个 Case 能证伪该承诺，负向/边界是否独立且可安全执行？ | Case ID、终点、fixture、视频/持久事实、清理 |
| Gap | 哪个变更点或机制没测，为什么？ | 排除/阻塞/待确认项及下轮验证触发 |

PR-only 在本地有完整提交对象时先生成、分类并验证 [变更文件清单](../../references/omission-hook.md)；每个文件有 `changeId` 或排除原因，`changeId` 再映射到 target。清单不能证明业务影响无遗漏，仍要沿调用链和用户旅程反向扫描；缺本地提交对象则明确写“文件覆盖未验证”，不伪造完整性。

PR 描述或作者评论原文中的精确验收条款才可标 `pr_spec`，且只对本轮 PR head 有效；`sourceRef` 指向本轮 `RUN_ROOT/tickets/pr-spec.json`，`anchor` 是该快照声明正文的原文片段。代码、测试和 diff 本身是影响发现材料，不是产品 Expected。计划初版在 UI 执行前保留；新发现的 Case 追加来源和时间，不改写旧分母。
