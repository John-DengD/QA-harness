# 取单、Feature 与环境解析

本轮要测什么（ticket checklist、PR 明确承诺或用户目标）和在哪测（sandbox）是两条**独立**的解析链路，职责不同、可靠性不同，不要混在一起。

```
执行环境 ← 纯机械，每步都有可验证的事实锚点
验收标准 ← QA 单关联可能不可靠；仅 PR 时可从明确原文建立本轮合同
```

把不可靠的部分隔离在「验收标准」一侧，是因为那一侧本来就有用户兜底；环境那一侧则要求全程可验证。

---

## 1. Feature：本 skill 的调度单元

**一个 feature = 一个 live sandbox。**

- 一个 feature 对应 1 个或多个 Linear 单、1 个或多个 PR。
- **只有一个 PR 带 sandbox**；stacked PR 时通常在最新那个。
- 发现多个 PR 各自带 live sandbox → **就是多个 feature**，分别建立、排队处理。
- **Feature 主键 = 带 sandbox 的那个 PR 号**。报告目录、run-state 分片、证据路径都用它。

不要用 Linear 单号做主键——一个 feature 常有多个单。

---

## 2. 执行环境解析（机械链路）

### 2.1 展开候选 PR

| 入口 | 展开方式 |
|---|---|
| 用户给了 PR | 该 PR + 它所在的 stack |
| 用户给了 Linear 单 | 单里关联的 PR |
| 单里没有关联 PR | 按作者、标题、内容搜索匹配 → **标 `inferred`** |

**候选集必须排除已 merged 的 PR。** QA 通过才会合入，所以 merged 的 PR 不是测试对象。发现目标 PR 已 merged，说明单子来晚了，停下问用户。

### 2.2 定位 sandbox

在候选 PR 上找 bot comment，锚点是 HTML 注释 `<!-- preview-sandbox -->`（作者 `github-actions`）。**同一条评论原地更新**，状态有两种：`Sandbox ready` / `Sandbox torn down`。

按「最新」顺序扫描，**但主判据是「有没有 live sandbox」，不是「是不是最新」**——「最新」只是搜索顺序的启发式，命中即停。

| 命中数 | 处理 |
|---|---|
| 1 个 ready | 这就是本 feature 的环境 |
| 0 个 | **停下问用户。**不要自行创建 |
| N 个 | **N 个 feature**，分别建立 run shard；每个 shard 使用独立 E2B，默认并行，不要只选一个 |

**sandbox 地址一律从 comment 读，不猜不拼。**前端地址是不可推导的哈希，且每次重新部署都会变。

comment 通常提供：各前端 surface 的 URL、API URL、以及运行时/数据库/后台任务的环境标识。**具体字段名和 URL 形态随基础设施变化，写在外部依赖文件里，不硬编码进本 skill。**

数据库通常是基线环境的 copy-on-write fork，写入不会流出 sandbox——这是「清理判据看副作用是否越界」的前提，执行前按外部依赖文件确认它仍然成立。

### 2.3 构建身份校验（硬门槛）

bot comment 页脚带**实际部署的 commit SHA** 和更新时间。

```
页脚 SHA == PR head SHA ?
  ├─ 是 → 继续
  └─ 否 → 硬停。不测，不绕过，不降级
```

sandbox **不会因为推送新 commit 自动重建**，所以落后是常态，必须每次校验。

SHA 落后时：

1. Agent 可以**自行发评论触发刷新**（刷新已有 sandbox 属于授权范围）
2. 部署很慢 → **挂起本 feature，切到下一个 feature**
3. 从零创建 sandbox **不在授权范围**，要问用户

> 授权边界：**刷新已有的，可以；凭空建新的，不行。**

### 2.4 续跑时重新校验

sandbox 会被自动回收，也可能被重建。续跑、切回一个挂起的 feature 时，必须重新读 comment 确认状态和 SHA，不能依赖 `run-state/` 里记录的旧值。

**记录不能证明环境仍处于同一状态。**

---

## 3. 验收标准解析（人工链路）

### 3.1 定位 QA 单的入口顺序

1. **用户直接给的 QA 单** ← 正常路径
2. 从带 sandbox 的 PR 的 Linear linkback 里识别出的 QA 单
3. 都没有 → 转 [PR-only 规划](pr-driven-intake.md)，只用 PR 的明确可观察承诺和其它当前有效规则，不把代码 diff 当 Expected

PR 与 QA 单的关联**是人工建立的**，不保证存在。开发自己关联的通常是研发单。所以第 2 条是兜底，不是主路径；没有已确认的 QA 单不会阻塞仅凭 PR 的测试。

### 3.2 区分 QA 单和研发单

单号前缀**不可靠**——QA 单也可能用研发团队的前缀。判据是两个信号，**负责人是决定性的**：

| 标题含 QA | 负责人 | 结论 |
|---|---|---|
| ✅ | QA 团队 | 是 QA 单 |
| ✅ | 无人认领 | 候选（可能还没分配），标 `inferred` |
| ✅ | 研发 | **不是** QA 单 |
| ❌ | QA 团队 | 是 QA 单 |
| ❌ | 研发 / 无 | 不是 |
| 全无命中 | — | 走 PR-only，不猜 QA 单 |

QA 团队成员名单放在外部依赖文件，不硬编码进 skill。

标题形态不统一（可能是 `[QA Test Request] ...`、`QA Validate ...`、或靠单号），所以标题只作子串判断，不作格式匹配。

### 3.3 状态过滤

- **Done 的单不再验收。**
- 状态还在进行中、开发未完成的单，确认后再决定是否纳入。
- 非验收类的单（spike / chore / design）排除。

### 3.4 模糊匹配的确认规则

| 猜出来的 | 要不要用户确认 | 为什么 |
|---|---|---|
| PR | 不用 | 下游有 sandbox 和 linkback 二次验证 |
| QA 单 | **必须确认** | 它直接就是验收标准，没有任何下游验证 |

候选 QA 单未确认时不能借它定义 Expected；若同时有独立 PR 明确承诺，仍可先按 PR-only 执行可判断部分，候选单保留待确认。

---

## 4. 从 QA 单到测试任务

拿到 checklist 之后，按 `SKILL_DIR/QA-models/_workflow/linear-ticket-intake.md` 建立 Ticket Task Model，产出到 `RUN_ROOT/run-state/ticket-task-model.md`。

先建 Change Model 和 Requirement Atoms，再路由模块、生成 Test Tasks。**不要从 ticket 文本直接跳到点击操作。**

外部文件读不到时：降级为「只用 ticket 明确验收标准 + 用户补充」，记录降级原因，不要自行发明一套建模流程。

---

## 5. 轻量任务包

每个 feature 建立一份，内容尽量少：

- 目标与核心业务终点
- checklist（逐条，带来源单号）
- 已确认预期及来源
- 高风险状态与副作用
- 当前未知项
- 可用入口、身份、环境、测试数据
- 第一项最小安全动作

**不生成大而全的测试矩阵。**执行中维护已知事实、开放问题、证据和下一动作即可。

只有用户明确要求「仅规划」时才停在方案阶段；普通「测这个 ticket」默认继续执行已授权且当前可执行的部分。

---

## 6. 多 Feature 调度

按 [E2B 并行执行与隔离](parallel-e2b.md) 建立 run shards。每个 feature 使用独立 E2B、独立登录态、独立 run-state 和 evidence 目录，默认并行。

SHA 落后的 feature 可自行刷新已有 sandbox 并进入 `WaitingExternal`；其它 shard 不受影响。切回时仍必须重新读取 comment 和 SHA。
