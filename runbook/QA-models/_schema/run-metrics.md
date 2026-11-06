# run-metrics.json

每轮 run 的结构化度量，落盘到 `RUN_ROOT/run-metrics.json`（`[<surface>/]<feature>/runs/<runId>/run-metrics.json`）。每轮一份、放在自己的 run 目录，不写 feature 层——feature 层一份会被下一轮覆盖。2026-10-15 之前的轮次留在 feature 层，不迁移。

## 为什么要有它

报告回答「这一轮测出了什么」。run-metrics 回答**「这个 skill 在变强吗」**——而后者只能靠跨轮比较，跨轮比较只能靠每轮当场采集。

事后无法补算：跑过的轮次不会留下这些痕迹。因此它是必写项，和 `version-history.md` 同级。

它同时是后续评分机制的唯一数据源。没有它，断言精度、动作命中率、知识密度全都算不出来。

## 落盘时机

收尾顺序的第 4 步：最终报告原子生成之后，知识沉淀之前。

放在报告之后，是因为覆盖统计和 verdict 分布要以最终报告为准；放在沉淀之前，是因为 `knowledge` 段要记录本轮候选的分级结果。

## Schema

```json
{
  "run_id": "string",
  "ts": "ISO8601",
  "mode": "ticket | goal | repeat",
  "feature": "string",
  "target": { "pr": "string | null", "sha": "string | null", "env": "string" },

  "coverage": {
    "planned": 0,
    "covered": 0,
    "not_applicable": 0,
    "blocked": 0,
    "model_gap": 0
  },

  "velocity": {
    "wall_clock_s": 0,
    "shards": 0,
    "cu_steps_total": 0,
    "action_hits": 0,
    "action_misses": [
      { "intent": "string", "reason": "absent | not_found | denied | precondition | drift | unsafe | novel | other" }
    ]
  },

  "correctness": {
    "inconclusive": 0,
    "requirement_conflict": 0,
    "script_drift": 0,
    "action_unknown": 0,
    "expected_source": { "module": 0, "ticket": 0, "user": 0, "inferred": 0 },
    "human_overrides": [
      { "caseId": 7, "from": "Inconclusive", "to": "ProductFail", "reason": "wrong_env | expected_missing | scope_rule | evidence | other", "note": "string", "at": "ISO8601" }
    ]
  },

  "knowledge": {
    "pending_review": 0,
    "auto_promoted": 0,
    "archived_only": 0,
    "model_gaps": ["string"]
  },

  "review": {
    "mode": "incremental | whole",
    "caseReviews": { "upheld": 0, "corrected": 0 },
    "tailSeconds": 0
  },

  "bugs": [
    {
      "draft_id": "string",
      "linear_id": "string | null",
      "assertion_ref": "string | null",
      "resolution": null
    }
  ]
}
```

## 字段语义

### coverage

覆盖率的分母约定：

```
覆盖率 = covered / (planned − not_applicable)
```

- `not_applicable`：断言前置在当前环境不成立，**从分母剔除并单列**。与 `blocked` 的区别是后者有恢复条件。
- `blocked`：有恢复条件但本轮未恢复，**留在分母里**。它是真实的覆盖缺口，不能用 NotApplicable 洗掉。
- `model_gap`：路由不到模块或模块缺少必要 fact 的次数。这个值下降，说明 agent 真的在学会这个产品。

### velocity

- `action_hits`：复用已有 action 的次数。
- `action_misses`：**必须逐条记录，不只记数量。**每条写明意图和未命中原因，枚举与 `hy_ui_autotest` 的 reuse 日志（`src/tools/reuse-miss.ts`）一致，直接按 `run-state/action-reuse.jsonl` 填写：
  - `absent` —— 库里根本没有这个意图对应的动作（覆盖问题，补 Action）
  - `not_found` —— 库里有且未被共享执行禁止清单挡住，但没检索到（检索问题，改 Action 表的 `intent`/别名与热列表）
  - `denied` —— 库里有，但被共享执行禁止清单挡住（如参数是密码/验证码/卡号，改用 *FromEnv 版本或 Computer Use）
  - `not_allowlisted` —— **旧值**（白名单时代的「未登记共享执行」，2026-10-14 起共享执行默认放行）。既往记录中保留可读，新记录不再使用
  - `precondition` —— 有候选，但本次前置不满足，如同 origin 多标签（纠正适用范围）
  - `drift` —— 找到并调用了，但已与当前部署不符（修脚本）
  - `unsafe` / `novel` / `other` —— 不宜共享执行 / 新类型意图 / 其它

  未命中核对按 Action 表（`src/tools/action-catalog.json`）每行的 `intent` 与别名检索候选。Action 的回滚等级（`read`/`reversible`/`irreversible`）是表里的属性，随调用事实写入，不影响 hit/miss 判定。

  这些原因的改进方向完全不同。只记总数等于知道命中率低但不知道该改什么。切换/关闭标签页、刷新、滚动等浏览器原语不是业务意图，不进入 `action_misses`。旧轮次里的 `no_action`、`drifted` 分别对应 `absent`、`drift`，不回改历史文件。
- `cu_steps_total`：Computer Use 的总步数。它与 `action_hits` 反向变化——成熟路径沉淀得越多，CU 步数越少。

### correctness

- `expected_source`：本轮每条 Expected 的来源计数。
  - `module` —— 来自 QA-models 的 active 断言
  - `ticket` —— 来自工单明确声明的行为
  - `user` —— 来自用户当轮确认
  - `inferred` —— **来自代码或推断**

  `inferred` 是设计正确率的早期预警。它偏高说明 Expected 正在从实现中产生，测试正在退化成重言式。健康值接近 0。
- `human_overrides`：报告交付后，QA 负责人（人）改判 Case 结论的每一次记录，追加写，不改原记录。`reason` 取：`wrong_env`（环境或测试数据不对）、`expected_missing`（缺权威预期，人补了口径）、`scope_rule`（规则适用范围变了）、`evidence`（证据不足或误读）、`other`。这是「Agent 哪类判断最常被人纠正」的直接信号：跨轮按 `reason` 统计，持续偏高的类别就是下一步要改进的地方（例如 `expected_missing` 多 → 补 QA module；`wrong_env` 多 → 加强开测前的环境与数据核对）。独立 reviewer 的改判不算在这里（记在逐 Case 复核里）。
- `requirement_conflict`：工单与已审断言直接矛盾的次数。**这个值不是越低越好**——它大于 0 说明冲突检测在工作，长期恒为 0 反而要怀疑检测失效。

### knowledge

记录候选分级的实际结果，对应 [报告与知识沉淀](../../references/reporting.md) 的候选分级规则：

- `pending_review`：进入人审队列的条数（配额 ≤3）
- `auto_promoted`：自动入库的 `non_bugs` 条数
- `archived_only`：仅留档、不进队列的条数

`auto_promoted / (auto_promoted + pending_review)` 衡量分级机制替人省下了多少审核量。

### review

独立复核的方式与尾部耗时，见 [独立复核](../../references/independent-checker.md)：

- `mode`：`incremental` = 每条已执行 Case 沉淀后单独冻结并复核，汇总 packet 带 `caseReviews`；`whole` = 只在收尾做整份复核（`caseReviews` 为空）。
- `caseReviews.upheld`：首次 Case review 即 `upheld` 的 Case 数；`caseReviews.corrected`：被 `downgrade`/`insufficient` 或证据改动失效后，修正并以新序号（`case-N.r2…`）重审通过的 Case 数。`whole` 模式两者写 `null`。
- `tailSeconds`：最后一条 Case 结束（`record-stop`）到 `qa:checker check` 通过的秒数。它是增量复核要压缩的尾部等待，与旧模式对照用；gate 未通过写 `null`。

### bugs

每个 bug 草稿一条记录。两个字段是为后续评分预埋的，**本轮无法填也必须保留键**：

- `assertion_ref`：**判出这个 bug 的是哪条断言或哪个 hook**。将来从 Linear 回流 bug 的关闭原因时，靠它反查「是哪条知识做出的判断」，进而算出该断言的精度。不埋这个字段，所有历史轮次都无法参与评分。
- `resolution`：Linear 上该 bug 的最终关闭原因（`real_bug` / `not_a_bug` / `wont_fix` / `duplicate`）。落盘时一律为 `null`，由后续回流流程回填。

`linear_id` 在用户授权建单后回填；未建单保持 `null`。

## 填写规则

- 本轮无法确定的数值写 `null`，**不要猜测，也不要省略字段**。缺失和零是两种不同的事实。
- 所有计数以最终报告为准，不以执行过程中的中间统计为准。
- 这份文件不进入 artifact 发布包，只留在 `QA_ROOT` 本地供跨轮汇总。
