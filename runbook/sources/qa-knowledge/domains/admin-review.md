# Domain Memory: Admin Review

## 适用产品线

Hellyeah

## 核心风险

- 把 `pending_internal_review` 当成终点，导致 active 后续链路未覆盖。
- Admin 操作可由用户轻量协作完成，却被写成未覆盖。
- 把 admin review 当成可选质量复核；实际这是所有 campaign launch 前的人工审核关卡，主要审核广告生成质量和安规是否符合规定。
- **把 Google 和 Meta 的审核流程混用**（2026-09-20 用户确认 + 代码核对）：
  - **Google**：一次 approve 到底 —— 自动分配账户 → 建 setup（不二次扣款）→ **自动激活到 `active`**。**没有第二道人工门**，不要等一个不存在的 unpause。唯一失败分支是账户池无可用号。
  - **Meta**：两阶段 —— 先 `account_binding` 等 operator **人工绑定广告账户**，再 `pending_internal_review` 审内容。**绑号在 approve 之前。**
  - 用户侧这两个 Meta 状态都显示 pending，只能从 Admin 或只读 API 区分。
- **把 reject 当成死路**：reject 之后 campaign **仍可 reopen**；只有 reject 之后再 cancel 才不可恢复。断言应该断 `allowedActions` 里有没有 `reopen`，不要断状态名。
- **只有 user 和 admin 两个角色**：旧文里的 "operator" 就是 admin，不是第三种角色，也不是第二道门。

## 历史 Bug 模式

- 未审核导致 pause/resume/cancel happy path 无法继续。
- 审核后状态流转未继续验证。
- 测试报告只写 campaign created / `pending_internal_review`，没有区分 ops review 通过、真实 launch/active 和后续投放状态。

## 必测检查点

- 进入 `pending_internal_review`（Meta 还要先经过 `account_binding`）。
- admin approve：确认广告质量与安规审核结果。Google 看是否自动激活到 active；Meta 看绑号是否在 approve 之前完成。
- approve 后状态变化。
- active 后 pause/resume/cancel。
- 审核相关事件或日志。

## AI 可独立覆盖

- CLI/API 状态查询。
- 审核前后的状态验证。

## AI+人工轻量协作覆盖

- 用户在 Admin dashboard approve campaign。
- 用户确认后台状态、审核结果、审核意见或拒绝原因。

## 不适合自动化的部分

- 无稳定 Admin 测试权限时的完整 UI 自动化。

## 自动化沉淀建议

- approve 前后状态检查。
- active 后 pause/resume/cancel happy path。
- 报告模板中固定标注：submit 成功、admin approve、真实 launch/active 是否分别完成。
- reject → reopen 与 reject → cancel 两条分支的 `allowedActions` 断言。

## 已过期/慎用经验

- 已被 Hellyeah 后续规则推翻的 admin-review 判断放入本区。
