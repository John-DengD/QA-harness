# PR-1217-K3 多 org 与 tracker 状态

原文出处:`QA_ROOT/User-Dashboard-test/PR-1217/runs/r-20261013-1528-exp3/pending-review.md`(QA-1149,staging,QA 负责人裁定,2026-10-13),下文为该条逐字摘录。
工作台编号 W-20261014-22。

PR-1217-K3 · 测试数据缺口：需要“默认 org ≠ 草稿 org”的多 org 账号来验证 `?org=` 交接
- 来源：C2；证据 `run-state/case-harvest.md` C2 节
- 已观察：qa-secondary 有两个 org，但新标签默认始终落在 org-A（=草稿 org），因此 `?org=` 是否生效未被反证；在 org-B 建草稿被本轮约束禁止。
- 需要：一个 disposable 账号建两个 org、在非默认 org 生成 Sales 草稿后点 Set Up Tracking；或获准使用 org-B。补测后关闭 C2 判别力缺口。
- 建议落点：`QA-models/hellyeah/auth-organization`（fixture 说明）
- 等待：QA 负责人（数据）
- **裁定（2026-10-13，QA 负责人）**：可以在 org 之间来回切换来制造「默认 org ≠ 草稿 org」；没装 tracker 的 org 就是未安装状态（不是 live），只是 Traffic goal 不会因 tracking 卡 launch。→ 下轮用 org-B（未安装）补测 C2 交接。同时确认规则：tracker 状态与 goal 无关，Sales ↔ Traffic 切换从不改变 tracker 状态。
