---
id: hellyeah.creative-studio
type: module
product: hellyeah
surfaces: [customer-dashboard, studio, api]
status: pilot
version: 1
last_reviewed: 2026-09-16
related_modules: [hellyeah.onboarding-brand, hellyeah.campaign-agent, hellyeah.campaign-composer]
---

# Creative Studio（素材工作室）

## 业务目标与边界

用户从 Reference Gallery 生成、查看、选择和管理完整 Creative Set。模块验证 set 聚合、copy/landscape/square 资产、真实文件质量、Studio 可见性、平台适配和 campaign picker 关联。

## Ticket 路由信号

`Studio`、`Creative Set`、`reference`、`generate copy/image`、`landscape`、`square`、`partial`、`creative job`、`blend`、`image metadata`、`Import from Studio`。

## 来源

| Ref | Source | Role | Status |
|---|---|---|---|
| CREATIVE-S01 | `sources/hellyeah/business_file/customer-dashboard.md` | observation | historical snapshot, synced 2026-08-05 |
| CREATIVE-S02 | `sources/hellyeah/business_file/creative-engine.md` | observation | historical snapshot, synced 2026-08-05 |
| CREATIVE-S03 | `sources/hellyeah/business_file/creative-engine/platform-specs.md` | observation | historical snapshot, synced 2026-08-05 |
| CREATIVE-S04 | `sources/hellyeah/product-memory.md` | risk | current guidance(原标注 risk/user-confirmed rules) |
| CREATIVE-S05 | `sources/qa-knowledge/testing-heuristics.md` | risk | current guidance |

## Page Signals

| Surface | URL pattern | Required anchors | Wrong-page signals |
|---|---|---|---|
| Studio library | Dashboard Studio route | Creative Sets；Reference Gallery | legacy `/creatives` without redirect completion |
| Set detail | Studio set route/modal | reference；direction；copy；landscape；square；readiness | standalone job only |
| Generation queue | Studio/library | queued/processing row；cancel when allowed | no correlation to requested reference |
| Campaign picker | composer modal | Studio/reference tabs；selectable sets | platform-mismatched set presented as ready |

## Business Actions

| ID | Intent | Preconditions | Expected transition | Side effect | Recovery |
|---|---|---|---|---|---|
| CREATIVE-ACT-001 | 读取 Studio sets | active org ready | 返回当前 org first-class sets | read | 刷新并核对 API set view |
| CREATIVE-ACT-002 | 选择 reference/direction 并生成 set | brand/profile ready | queued→processing→complete/partial/failed | generation | 超时按 set/job 核验，禁止重复 |
| CREATIVE-ACT-003 | 查看真实 set 资产 | 有 setRef | 返回 copy + 两种图片的真实 facts | read/download | 文件不可访问则 Inconclusive |
| CREATIVE-ACT-004 | 在 composer 选择 set | set 对当前平台 ready | campaign draft 关联同一 set | reversible | 恢复原 set |
| CREATIVE-ACT-005 | cancel/delete 本轮 set | allowedActions 明确 | active generation cancel 或 finished set delete | destructive/reversible limits | 删除需明确授权；核对列表与 picker |

## Facts

| ID | Meaning | Source | Shape |
|---|---|---|---|
| CREATIVE-FACT-SET | 聚合 set | Studio/API | `{setRef,orgRef,status,reference,direction}` |
| CREATIVE-FACT-COPY | 文案资产 | set/job | `{headlines,descriptions,longHeadlines?,status}` |
| CREATIVE-FACT-IMAGE | 真实图片资产 | downloaded file/job | `{role,url,width,height,format,readable,status}` |
| CREATIVE-FACT-JOBS | 子任务 | API | `[{jobRef,type,status,failure?}]` |
| CREATIVE-FACT-PICKER | composer 可选性 | UI | `{visible,selectable,platform,setRef}` |

## 断言目录

| ID | Type | Applies when | Expected | Facts / evidence | Failure exclusions |
|---|---|---|---|---|---|
| CREATIVE-001 | state_transition | generate set | queued row 立即可见，最终进入明确聚合状态 | SET + JOBS + screenshots | provider 正在合理处理 |
| CREATIVE-002 | negative | 必需 landscape/square 任一失败 | set 不可作为 ready/selectable；partial 不等于可用 | SET + IMAGE + PICKER | Search 当前只消费已完成 text 的明确路径 |
| CREATIVE-003 | cross_surface | first-class set complete | 同 org Studio 与 API 均可见，刷新后保持 | SET + library evidence | standalone text/image job 不应进 Studio |
| CREATIVE-004 | exact | 图片 status complete | metadata 与真实文件尺寸、比例、format 一致 | IMAGE metadata + downloaded file | 规则明确字段为 target size 而非 actual |
| CREATIVE-005 | visual | 图片含文字/品牌 | 最终用户可见图片文字可读、品牌和业务相关 | actual image + profile | 主观偏好无明确要求 |
| CREATIVE-006 | cross_surface | set detail | reference、direction、copy、两图和 UUID 属于同一 set | SET/COPY/IMAGE | 页面旧缓存 |
| CREATIVE-007 | negative | campaign picker | 只允许满足目标平台和必需资产的 set | PICKER + set facts | 合法平台无关 Search text reuse |
| CREATIVE-008 | negative | 用户生成 standalone asset | 不作为 first-class set 出现在 Studio library | job + library evidence | 产品已明确升级 standalone 为 set |
| CREATIVE-009 | state_transition | cancel/delete | 状态与 allowed action 一致，相关 picker/library 同步更新 | SET + UI | 异步删除尚未完成 |
| CREATIVE-010 | cross_surface | edit/blend workflow 在范围 | 分别验证 generate、edit、blend 最终文件，不用中间字段代替最终图 | jobs + actual images | ticket 只改变单一独立阶段 |

## 副作用、Bug 判断与回流

生成会消耗模型资源；超时先查 set/jobs。删除需明确授权，只删本轮实体。高置信 Bug 包括 complete metadata 与真实文件不符、必需资产失败却可 launch、first-class set 同 org 丢失、picker 关联错误 set。单次生成美学偏好不是 Bug。真实试跑后补生成等待预算、文件下载证据和稳定 page signals。

<!-- 2026-09-20: CLI 已退出 QA 范围，相关 surface、来源和交叉核验手段已删除。只读交叉核验改用 API / Admin Dashboard。 -->
