# PR-1217-K2 Full-Auto 目标指标

原文出处:`QA_ROOT/User-Dashboard-test/PR-1217/runs/r-20261013-1528-exp3/pending-review.md`(QA-1149,staging,QA 负责人裁定,2026-10-13),下文为该条逐字摘录。
工作台编号 W-20261014-21。

PR-1217-K2 · Switch to Traffic 时 Full-Auto 目标指标被静默改写
- 来源：C3；证据 `evidence/C3/notes.md`、`facts-*.json`
- 已观察：PMax Sales 的 Full-Auto "Cost per purchase around $40.00" 切 Traffic 后显示为 "Cost per click around $40.00"（数值原样沿用），确认弹窗声称列出全部改动但未提及；Switch Back 后恢复 per purchase。
- 需要确认：Full-Auto 目标在切换时应否重算/重置、弹窗是否应列出此项。确认后会改变 Switch to Traffic 弹窗断言（列出项）与切换后的 Full-Auto 断言。
- 建议落点：`QA-models/hellyeah/campaign-composer`
- 等待：PM
- **裁定（2026-10-13，QA 负责人）**：**不是 bug**。Full-Auto 是给内部投手用的，数值由投手调整，自动生成的只是参考。→ 记入模块 `non_bugs`；弹窗不列 Full-Auto 不算遗漏。
