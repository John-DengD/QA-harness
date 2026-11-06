---
id: workflow.naming-migration-2026-11-06
type: index
product: hellyeah
---

# Naming Migration 2026-11-06（命名统一对照表）

本表记录 2026-11-06 统一命名时的旧名到新名。外部文档(如 FR_workspace 里的快照)可能仍使用旧名,按此表对照。

## 文件

| 旧 | 新 |
|---|---|
| `QA-models/hellyeah/tracking-xray.md`(id `hellyeah.tracking-xray`) | `QA-models/hellyeah/xray-tracking.md`(id `hellyeah.xray-tracking`) |

## 出处编号

格式统一为 `<模块前缀>-S<两位序号>`,每个模块内从 S01 连续编号(旧编号有跳号,如 WALLET 从 002 开始)。

| 旧 | 新 |
|---|---|
| REVIEW-SRC-001 | REVIEW-S01 |
| REVIEW-SRC-002 | REVIEW-S02 |
| REVIEW-SRC-003 | REVIEW-S03 |
| REVIEW-SRC-004 | REVIEW-S04 |
| NOTIFY-SRC-001 | NOTIFY-S01 |
| NOTIFY-SRC-002 | NOTIFY-S02 |
| NOTIFY-SRC-003 | NOTIFY-S03 |
| NOTIFY-SRC-004 | NOTIFY-S04 |
| LAUNCH-SRC-001 | LAUNCH-S01 |
| LAUNCH-SRC-002 | LAUNCH-S02 |
| LAUNCH-SRC-003 | LAUNCH-S03 |
| LAUNCH-SRC-004 | LAUNCH-S04 |
| LAUNCH-SRC-005 | LAUNCH-S05 |
| LAUNCH-SRC-006 | LAUNCH-S06 |
| AGENT-SRC-001 | AGENT-S01 |
| AGENT-SRC-002 | AGENT-S02 |
| AGENT-SRC-003 | AGENT-S03 |
| AGENT-SRC-004 | AGENT-S04 |
| ACCT-SRC-001 | ACCT-S01 |
| ACCT-SRC-002 | ACCT-S02 |
| ACCT-SRC-003 | ACCT-S03 |
| WALLET-SRC-002 | WALLET-S01 |
| WALLET-SRC-003 | WALLET-S02 |
| WALLET-SRC-004 | WALLET-S03 |
| WALLET-SRC-005 | WALLET-S04 |
| WALLET-SRC-006 | WALLET-S05 |
| WALLET-SRC-007 | WALLET-S06 |
| AUTH-SRC-001 | AUTH-S01 |
| AUTH-SRC-002 | AUTH-S02 |
| AUTH-SRC-003 | AUTH-S03 |
| AUTH-SRC-004 | AUTH-S04 |
| LIFE-SRC-001 | LIFE-S01 |
| LIFE-SRC-002 | LIFE-S02 |
| LIFE-SRC-003 | LIFE-S03 |
| LIFE-SRC-004 | LIFE-S04 |
| META-SRC-001 | META-S01 |
| META-SRC-002 | META-S02 |
| CREATIVE-SRC-001 | CREATIVE-S01 |
| CREATIVE-SRC-002 | CREATIVE-S02 |
| CREATIVE-SRC-003 | CREATIVE-S03 |
| CREATIVE-SRC-004 | CREATIVE-S04 |
| CREATIVE-SRC-005 | CREATIVE-S05 |
| XRAY-SRC-001 | XRAY-S01 |
| XRAY-SRC-002 | XRAY-S02 |
| XRAY-SRC-003 | XRAY-S03 |
| XRAY-SRC-004 | XRAY-S04 |
| XRAY-SRC-005 | XRAY-S05 |
| XRAY-SRC-006 | XRAY-S06 |
| COMPOSER-SRC-001 | COMPOSER-S01 |
| COMPOSER-SRC-002 | COMPOSER-S02 |
| COMPOSER-SRC-003 | COMPOSER-S03 |
| COMPOSER-SRC-004 | COMPOSER-S04 |
| COMPOSER-SRC-005 | COMPOSER-S05 |
| COMPOSER-SRC-006 | COMPOSER-S06 |
| COMPOSER-SRC-007 | COMPOSER-S07 |
| SETTINGS-SRC-001 | SETTINGS-S01 |
| SETTINGS-SRC-002 | SETTINGS-S02 |
| SETTINGS-SRC-003 | SETTINGS-S03 |
| GTMCV-SRC-001 | GTMCV-S01 |
| GTMCV-SRC-002 | GTMCV-S02 |
| GTMCV-SRC-003 | GTMCV-S03 |
| GTMCV-SRC-004 | GTMCV-S04 |
| GTMCV-SRC-005 | GTMCV-S05 |
| GTMCV-SRC-006 | GTMCV-S06 |
| GTMCV-SRC-007 | GTMCV-S07 |
| GTMCV-SRC-008 | GTMCV-S08 |
| OPT-SRC-001 | OPT-S01 |
| OPT-SRC-002 | OPT-S02 |
| OPT-SRC-003 | OPT-S03 |
| OPT-SRC-004 | OPT-S04 |
| OPT-SRC-005 | OPT-S05 |
| ONBOARD-SRC-001 | ONBOARD-S01 |
| ONBOARD-SRC-002 | ONBOARD-S02 |
| ONBOARD-SRC-003 | ONBOARD-S03 |
| ONBOARD-SRC-004 | ONBOARD-S04 |
| ONBOARD-SRC-005 | ONBOARD-S05 |

## 出处角色

限定为 observation、risk、authority、user-confirmed、timeline 五种。下列行的原标注已并入 Status 列并保留:

- `code_observed` → observation
- `risk/user-confirmed rules`、`user-confirmed/risk` → risk(取较保守的一种:risk 不能单独作为 Expected 出处,user-confirmed 可以;需要提升时由人逐条核对)

## 其他

- 出处表列固定为 Ref、Source、Role、Status;原 Applies to 列并入 Source 列,以“— 适用:”引出。
- 所有 hellyeah 下文件都有 frontmatter 和 `type`(module、index、routing);标题统一为“English name（中文名）”。
- 章节名没有改动:“Browser 观察点”与“Page Signals”是模板里两个独立章节;“副作用、Bug 判断与回流”(精简模块)与“副作用与恢复”加“Bug 判断知识”(完整模块)是两种都允许的写法,见 module-template。
