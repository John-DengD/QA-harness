# Customer Dashboard Ticket Routing

用于将 Dashboard Linear ticket 路由到产品模块。路由基于用户 surface、实体、动作和状态，不只匹配标题关键词。

| Dashboard area / signal | Primary module | Common adjacent modules |
|---|---|---|
| 登录、session、org switch、跨组织数据 | auth-organization | settings-members、wallet-payment、campaign-lifecycle |
| Onboarding、website/domain、brand review/profile | onboarding-brand | auth-organization、campaign-agent、creative-studio |
| Agent chat、campaign plan/draft、objective/targeting | campaign-agent | onboarding-brand、campaign-composer |
| Campaign editor、readiness、dry-run、budget、targeting | campaign-composer | creative-studio、wallet-payment、campaign-launch |
| Studio、reference、Creative Set、生成状态 | creative-studio | onboarding-brand、campaign-composer |
| Wallet、Top Up、transaction、refund | wallet-payment | auth-organization、campaign-launch |
| Launch/Submit、pending internal review | campaign-launch | wallet-payment、admin-review |
| Campaign detail、pause/resume/cancel、roadmap | campaign-lifecycle | wallet-payment、admin-review |
| Tracking、X-Ray、event、funnel、attribution | tracking-xray | auth-organization、campaign-lifecycle |
| Settings profile/org/members/invites | settings-members | auth-organization、notification-delivery |
| Settings Notifications、email delivery/suppression | notification-delivery | settings-members、campaign-lifecycle |
| Settings Integrations / Stripe Revenue Connect | `model_gap: stripe-revenue-connect` | auth-organization、settings-members |
| 第三方 postback delivery | `model_gap: postback-delivery` | tracking-xray、campaign-lifecycle |

## 路由规则

1. 页面位置只提供候选模块；最终看 ticket 修改的业务对象和状态。
2. UI-only 样式修复仍加载拥有该页面业务结果的模块，用于保护不变量。
3. 一个 ticket 最多选择少量 primary modules；其它模块只选受影响的接口断言。
4. 没有模块时保留 model_gap，不用相似模块替代。
5. Ticket/PR 同时修改多个 surface 时，按用户旅程拆成多个 Task，不拆成多个无业务意义的点击。
