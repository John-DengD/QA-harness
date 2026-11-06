# QA 环境与外部依赖

skill `linear-browser-qa` 从自身的 `qa-env/`、`QA-models/`、`QA-Knowledge/` 和 `hy_ui_autotest/` 读取运行依据。本文记录环境事实，不包含凭据值。

**改基础设施、换账号、加产品线，改这里就行，不用动 skill。**

> ⚠️ 本文不存任何凭据。密码、token、API key 放在密码管理器或环境变量里，这里只写**别名**和**去哪拿**。

---

## 1. QA 根目录

```
QA_ROOT = 用户明确指定的产物目录 > 环境变量 QA_ROOT > qa-env/.env.local 里的 QA_ROOT > 首次使用时询问（默认 $HOME/QA-runs）
```

`QA_ROOT` 只保存本轮工单、证据、报告和待审候选；产品知识和可执行脚本从本 skill 读取。本机已有的 FR_workspace 是历史产物目录，不是所有安装者都必须具备的前置。

---

## 2. 产品线到目录的映射

| 产品线 | 目录 | 当前是否在 QA 范围 |
|---|---|---|
| Hellyeah User Dashboard | `Hellyeah/User-Dashboard-test/<feature>/` | ✅ |
| Hellyeah Admin Dashboard | 同上（同一 feature 目录，区分 case 的角色） | ✅ |
| Hellyeah CLI | — | ❌ **2026-09-20 起排除** |
| FinalRound Web | `FinalroundAI/Web-test/<feature>/` | ❌ 本轮不在范围 |
| FinalRound Desktop | `FinalroundAI/Desktop-test/<feature>/` | ❌ |
| Shared InterviewAI | `FinalroundAI/Shared-InterviewAI/<feature>/` | ❌ |

`<feature>` 用**带 sandbox 的那个 PR 号**，例如 `PR-1117/`。版本目录不明确时不要覆盖历史结果。

---

## 3. QA 团队成员

用于识别 QA 单（**负责人是决定性信号**）：

```
junlong · xiaoyu · xinli
```

判定表见 skill 的 `references/intake-routing.md` §3.2。成员变动改这里。

---

## 4. 代码仓库

| 用途 | 仓库 | 基线分支 |
|---|---|---|
| Hellyeah 主仓 | `PRODUCT_REPO` 指定的 checkout；本机已有 `~/git-projects/hellyeah-v2` 时可作默认 | `origin/staging` |
| UI 自动化回归与 Computer Use 桥接 | `SKILL_DIR/hy_ui_autotest` | 随 skill 版本打包 |

换机器时先配置可访问的 `PRODUCT_REPO`；无法访问目标部署 SHA 的源码时按 skill 的脚本漂移流程标明缺失证据，不用当前分支猜测。代码只用来**发现枚举缺口和矛盾**，不用来定义预期（见 skill 的 `references/knowledge-sources.md`）。

---

## 5. Sandbox 解析

### bot comment

- 锚点：HTML 注释 `<!-- preview-sandbox -->`
- 作者：`github-actions`
- 同一条评论**原地更新**
- 状态文案：`Sandbox ready` / `Sandbox torn down`

### comment 提供的字段

| 字段 | 形态 | 能否从 PR 号推导 |
|---|---|---|
| Dashboard URL | Vercel 哈希域名 | ❌ **必须从 comment 读** |
| Admin URL | Vercel 哈希域名 | ❌ |
| API URL | `api-server-pr-<N>.up.railway.app` | ✅ 但仍应从 comment 读 |
| 运行时环境 | Railway 环境 `pr-<N>` | ✅ |
| 数据库 | Neon branch `preview/pr-<N>`，**staging 的 copy-on-write fork，写入不外流** | ✅ |
| 后台任务 | Inngest branch env `pr-<N>`，事件驱动 + 白名单内的 fork-scoped cron | ✅ |

**页脚**带实际部署的 **commit SHA** 和更新时间——这是 SHA 硬门槛的依据。

### 生命周期

- **推新 commit 不会自动重建**（页脚原文 `pushes do not rebuild`）→ SHA 落后是常态，每次必校验
- 刷新：在 PR 下评论 `/sandbox`
- 销毁：`/sandbox down`，或移除 `preview:sandbox` label
- **空闲的 sandbox 会被自动回收** → 续跑必须重新校验

### 授权边界

| 动作 | Agent 能不能做 |
|---|---|
| 评论 `/sandbox` 刷新**已有** sandbox | ✅ |
| 从零创建 sandbox | ❌ 停下问用户 |
| `/sandbox down` 销毁 | ❌ |

---

## 6. 环境能力限制

skill 执行前读取本节。

### 支付

- ❌ **无法跳转 Stripe 付款页，充值动作做不了。**涉及充值的 checklist 项记 `Blocked`
- ✅ 钱包其余只读功能正常：余额、消费记录、退款展示
- ✅ **测试账号预置了足够余额**
- ⚠️ **遇到 funding gap 本身就是异常信号**（预置失效或产品缺陷），当作发现上报，不要设法绕过

### 广告平台

- 接的是 **test MCC**（sandbox 继承 staging 的配置）
- 平台侧能看到资源真实创建，但**不产生真实曝光/点击/花费**。**指标恒 0 是预期，不判 Bug**
- **账户级预算 cap 卡在 $1000 且不会自动抬高**，超过后激活被挡住 → **环境特性，不判 Bug**

### 业务 gate

以下校验在 staging / sandbox **已被放开**以方便测试，**不要按代码默认值判 Bug**：

| gate | 代码默认 | 环境状态 |
|---|---|---|
| 总预算下限 | `MIN_CAMPAIGN_BUDGET_DOLLARS` = $20 | 已放开 |
| 派生日额下限 | `MIN_CAMPAIGN_DAILY_BUDGET_DOLLARS` = $5 | 已放开 |

### 退款结算窗口

- `REFUND_SETTLEMENT_MINUTES` 默认 `48 * 60` = **48 小时**（env 可调）
- **UI 不展示预计到账时间，这是设计，不判 Bug**
- agent 按 48h 预算轮询，超时标 `Inconclusive`

---

## 7. 测试账号与会话建立

> ⚠️ **本文不存任何凭据值。**只写别名、用途和「去哪拿」。

### 凭据位置

本文只保存变量名与用途，不保存变量值。宿主机运行 Computer Use 前，从受控密钥渠道向**当前进程**注入 `E2B_API_KEY`；需要在宿主机运行 Playwright 时，再为该进程注入相应测试变量。E2B 沙箱内从独立的 E2B testenv 获取账号、Clerk 和清理凭据。安装 skill 不会自动授予这些权限；缺少哪一层的凭据就明确报告该层缺失，不从产品文档猜值，也不把整份宿主机环境上传到沙箱。

| 变量名 | 用途 |
|---|---|
| `E2B_API_KEY` | 宿主机创建和连接 E2B Desktop；由宿主机密钥渠道注入 |
| `E2E_ACCOUNT_EMAIL` | 固定测试账号的邮箱 |
| `CLERK_SECRET_KEY` | **签发 sign-in token 用**，必须是 `sk_test_` 前缀 |
| `CLERK_PUBLISHABLE_KEY` | `pk_test_` 前缀，用于 testing token（绕 bot 检测，非 2FA） |
| `E2E_TEST_PASSWORD` | **仅供临时新建账号测 UI 登录表单**，与固定账号无关 |
| `E2E_BASE_URL` | 默认目标环境；测 sandbox 时覆盖为 sandbox Dashboard URL |
| `E2E_ADMIN_EMAIL` | **Admin 后台账号**（2026-09-20 新增） |
| `E2E_ADMIN_PASSWORD` | **Admin 后台密码**，走真实表单登录，**无两步验证** |
| `STAGING_E2E_ADMIN_TOKEN` | staging E2E control API：创建/bind/cleanup disposable account scope；不是通用 Admin token |

⚠️ `E2E_ACCOUNT_PASSWORD` 这个变量**代码里没有任何地方读取**（`src/config.ts` 的 schema 里不存在）。固定账号**不走密码登录**，所以它用不上。

### 账号清单

| 别名 | 角色 | 组织 | 用途 | 状态 |
|---|---|---|---|---|
| `qa-primary` | user | 待确认 | 主测试账号，预置余额 | ✅ 已配（`E2E_ACCOUNT_EMAIL`） |
| `qa-secondary` | user | 另一个 org | 需要固定历史资产的跨组织对照 | ❌ **未配**；普通隔离场景自动创建 disposable accounts |
| `qa-admin` | admin | — | Admin Dashboard 审核（J5 依赖） | ✅ 已配（`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`） |

**剩余缺口：**

- 没有第二个固定组织。普通 user/org 隔离测试可按 shard 自动创建 disposable accounts；只有依赖固定历史资产的跨组织断言仍受限。

（admin 账号已于 2026-09-20 补齐，J5 不再阻塞。）

### 会话建立：两条路径

| 角色 | 方式 | 原因 |
|---|---|---|
| **user** | **Clerk sign-in token 签发** | 固定账号开了两步验证，表单登录过不去 |
| **admin** | **真实表单登录** | Admin 后台独立账号体系，**无两步验证** |

⚠️ 两侧邮箱相同但**是两个独立入口**，不要混用凭据。admin 侧用 `E2E_ADMIN_PASSWORD`，**不是** `E2E_ACCOUNT_PASSWORD`（后者代码里无人读取）。

⚠️ admin 走密码登录 → 密码会经 Browser 输入。**该步不截图**，密码不进 run-state / 报告 / 日志。

#### user 侧流程（2026-09-20 用户确认：Agent 自己调 Clerk API 签 token）

参考实现在 `SKILL_DIR/hy_ui_autotest/src/actions/auth-actions.ts`：

```
Clerk Backend API：按邮箱查用户
  → POST /sign_in_tokens  { user_id, expires_in_seconds: 300 }
  → 浏览器打开  <baseUrl>/sign-in?__clerk_ticket=<token>
  → 等待跳离 /sign-in
  → 只读核验：实际登进了哪个用户、哪个 org
  → 记录 sessionId 到 run-state，收尾时 revoke
```

另需 `setupClerkTestingToken` 注入 testing token 绕过 Clerk 的 bot 检测（**不是 2FA，是防爬**）。

**安全约束**（skill 的 `references/session-setup.md` 有完整版）：

- `CLERK_SECRET_KEY` **能为任意用户签发会话**，权限远大于密码。使用前必须确认是 `sk_test_` 前缀；前缀不对立即停止
- token 有效期 300 秒，签发后立即用，不缓存
- **签发后必须核验实际落点**——签错人不会报错，会静默登进别的账号
- key、token、完整的带 ticket 的 URL **任何产物里都不落盘**
- 只为本节列明的账号签发，不为对话中临时提到的邮箱签

### disposable account（2026-09-22 用户授权）

- 单任务、单 E2B、不并行时默认使用 `qa-primary`。
- Agent 可在 staging/PR sandbox 为并行、多环境或 repeat N>1 的普通 shard 自动注册临时账号，无需逐次询问。
- 邮箱从 `E2E_EMAIL_BASE` 加唯一 runId 生成，禁止使用真实用户邮箱。
- 先调用 E2E control API 创建 scope，再创建 Clerk user、写 scope metadata 并 bind。
- 测试完成后必须在 `finally` 使用 `STAGING_E2E_ADMIN_TOKEN` 调 scope cleanup；只有 `cleaned` 算完成。
- cleanup 会清理 scope 内业务数据和 Clerk user/org/membership；`manual_review` 或未知状态写入报告和续跑入口。
- BYO、预置余额、已有对象或特殊权限场景继续使用明确固定账号，不能用空白 disposable account 冒充前置。

## 8. 第三方后台

当前不向 Agent 提供第三方后台账号或权限。执行 Dashboard 功能测试时不要请求这些账号，不进入对应后台，也不因缺权限暂停其它功能测试。

| 系统 | 可能用途 | 当前策略 |
|---|---|---|
| Stripe Dashboard | 支付 / 退款 / connected-platform webhook delivery | 跳过后台核验 |
| Google Ads | conversion action、平台侧预算与状态 | 跳过后台核验 |
| Meta Business | Meta 账户、广告审核状态 | 跳过后台核验 |
| Google Tag Manager | X-Ray tag 发布验证 | 跳过后台核验 |
| Inngest | 后台任务与异常记录 | 跳过后台核验 |
| PostHog | 事件矩阵 | 跳过后台核验 |
| Datadog / BetterStack | 日志、trace、error | 跳过后台核验 |

这不影响 User Dashboard 和 Admin Dashboard 的功能测试。处理规则：

- 可选的后台交叉核验：记 `SkippedByConstraint`，从本轮执行范围单列，不请求权限。
- Checklist 明确要求后台事实：继续完成可执行的 UI 功能测试，但该验收项记 `Inconclusive`，列出缺失证据；不能只凭 UI 判完整 Pass。
- 不得把“未进入第三方后台”写成“后台无错误”或“后台验证通过”。
- Admin Dashboard 是产品测试 surface，不属于本节第三方后台，继续使用已配置的 `qa-admin` 测试。

---

## 9. 回归策略

普通 ticket 不固定执行完整主链。默认范围是 QA checklist 加最多两条相关风险 smoke：一条 primary module 不变量，一条 adjacent contract / 历史 Bug / recovery。

完整 J1–J5 清单保留在 [`../QA-models/hellyeah/core-journeys.md`](../QA-models/hellyeah/core-journeys.md)，只在用户明确要求 release regression、或 ticket 是跨主链高风险改动时启用。

现有自动化参考 `SKILL_DIR/hy_ui_autotest/tests/release/cases/`：
`01-registration` · `02-login` · `03-onboarding` · `04-wallet-topup` · `05-campaign-launch`

新路径由 Agent 指挥 E2B Computer Use 逐步执行；已成熟的路径从 skill 内 `hy_ui_autotest` 复用 Playwright action/spec。沉淀脚本需修改 skill 源仓库并完成验证后再安装/发布，不能只改安装副本。

完整清单参考了 Playwright 链路与代码里的客户漏斗 `CUSTOMER_STATUSES`：
`first_message → website_provided → strategy_confirmed → creatives_confirmed → budget_confirmed → top_up_complete → campaign_live`

其中 J2、J3、J5 仍是未充分试跑的候选链路，因此不能作为每张 ticket 的固定门槛。

**不进回归**（2026-09-20 用户决定）：注册、登录（仅作前置）、生命周期与退款。
**环境原因不进回归**：钱包充值（sandbox 跳不到支付页）。

---


## 11. 浏览器执行主机（E2B）

skill 默认在 **E2B** 上执行 UI（那边有界面）。宿主机进程用已注入的 `E2B_API_KEY` 连接 E2B；账号和 Clerk 使用 **E2B testenv** 中的值。`qa-env/qa-environment.md` 不读取、分发或替代这些密钥。

### 运行约定

| 项 | 值 |
|---|---|
| 默认执行主机 | E2B（带 UI） |
| 会话凭据 | E2B testenv（`E2E_ACCOUNT_EMAIL`、`CLERK_SECRET_KEY` 等，须为 test 前缀） |
| 上传 fixture | agent 在 E2B 内查找或生成，不从本机传 |
| 本机 Chrome | 仅用户明确要求时 |
| 最终产物 | 报告、证据、run-state、version-history **落到独立的 QA_ROOT 产物目录** |
| 不落盘 | key、token、stream URL、clerk ticket |

细则见 skill 的 `references/e2b-runtime.md`。

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 建档。CLI 移出 QA 范围；business_file 降级为非判定依据；账户 cap 由 $150 更正为 $1000；确认 sandbox 继承 staging 的 test MCC |
| 2026-09-20 | §7 补齐：会话走 Clerk sign-in token 签发，不走密码；标注 `qa-secondary` / `qa-admin` 两个未配账号及其后果 |
| 2026-09-20 | §9 回归清单收敛为 5 条（J1–J5）；注册、登录、生命周期退款、钱包充值不进回归 |
| 2026-09-21 | §11：UI 在 E2B 执行；凭据用 E2B testenv；fixture 云内自备；报告落到本地 |
