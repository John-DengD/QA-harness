---
source: https://hellyeah-v2-docs.vercel.app/managed-ads/campaign-lifecycle
site_timestamp: 1785830543000
synced_at: 2026-08-05T01:39:42.619Z
---
# Campaign Lifecycle

> State machine governing campaign progression from draft to completion.

## States

Public submit (wallet allocation)

Debit confirmed

Admin creates draft (Admin Dashboard / AIMA)

Admin edits

Admin launches (balance check passes)

Preflight rejects (no debit)

Platform creation succeeds

Platform API error

Stuck recovery

Admin retries launch

Operator approves (assign account)

Operator rejects (refund)

Assignment deferred (pool/health)

Ad account assigned, setup saga builds Google setup

validateOnly / creation fails (refund)

Admin approves (review gate)

Admin pauses

Admin cancels

Admin cancels

Budget exhausted or end date

Budget exhausted or end date

Operator re-opens (fresh debit)

Operator or user withdraws

funding

pending_internal_review

draft

creating

paused

failed

approved

rejected

active

cancelled

completed

Two paths reach a live campaign. **Public launches** fund during submit and enter `pending_internal_review` with no ad account; a single operator review gate assigns an account, runs setup without a second debit, and auto-activates. **Admin-created drafts** launch through `creating` to `paused` and are activated by an admin at the paused review gate.
| Status | Meaning | Editable | Launchable |
| --- | --- | --- | --- |
| `draft` | Local database only, no platform resource exists | Yes | Yes |
| `funding` | Internal submit/re-open state with a durable pending wallet debit; recovery resumes it | No | No |
| `pending_internal_review` | Funded public launch request awaiting operator review; no ad account or platform resource yet | No (setup snapshot is frozen) | No |
| `approved` | Human gate passed — the system is assigning an ad account and about to build the platform setup | No | No |
| `creating` | Building platform resources. Admin drafts debit here; public requests reuse their submit debit | No | No |
| `paused` | Created on platform, pending admin review (not spending) | Safe admin edits only | No |
| `active` | Live on platform, actively spending | Safe admin edits only | No |
| `rejected` | Terminal review/setup rejection with an immediate full refund completed or retrying | No | No |
| `completed` | Budget exhausted or end date reached; unspent budget settled | No | No |
| `cancelled` | Admin-initiated cancellation, refund pending or complete | No | No |
| `failed` | Platform API error or admin intervention on stuck campaign | Yes | Yes (retry) |

The ad account is assigned at approval, not at submit. `adAccountId` is null for a `pending_internal_review` request and is populated only when an operator approves and the system pulls an account from the pool.

## Transition Rules
1. An **admin-created draft** starts as `draft`. A **public launch** runs read-only validation, then atomically writes `campaign(funding)` and `payments.transaction(pending)` under the org/wallet locks. Stripe debit must finalize before the campaign becomes `pending_internal_review`; nothing is sent to Google at submit.
2. A **pending_internal_review** campaign becomes **approved** at the review gate. The system assigns an ad account, moves it to `creating`, runs `validateOnly → create PAUSED → finalize` using the existing debit, then auto-activates it.
3. If an ad account cannot be assigned because the pool is empty or the assigned account is unhealthy, the funded campaign stays `pending_internal_review` for retry. Assignment does not require a second wallet floor check.
4. Rejecting or withdrawing a funded pending request persists the terminal state first and immediately refunds the full debit. An uncertain credit stays `processing` and the 15-minute worker replays the key derived from the original debit. Re-open is allowed only after that refund completes; it creates a fresh pending debit, passes through `funding`, and returns to review only after the new debit succeeds.
5. A draft becomes **creating** when an admin launches it and the CAS guard succeeds (the admin-created path). See [Launch Flow](/managed-ads/launch-flow).
6. On the **admin-created path**, a creating campaign reverts to its **original status** (normally `draft`, `failed` for retries) if [preflight](/managed-ads/launch-flow#preflight-validation) rejects the ad copy — schema/dedup fails, or Google Ads `validateOnly` returns a policy or approval error. No money has moved on that path and no platform resource exists, so `failed` would be the wrong terminal state. A public request is already funded when approval runs the same preflight; its failure becomes `rejected` and immediately attempts the full refund described above.
7. A creating campaign becomes **paused** when the ad platform confirms creation. Campaigns are always created as PAUSED for safety.
8. On the **admin-created path**, a creating campaign becomes **failed** if the platform API returns an error after debit. The failure reason and `failed_at` timestamp are recorded. Failed campaigns can be edited to fix launch parameters, then retried. On the public path, the equivalent post-approval failure becomes `rejected` and refunds the submit debit.
9. A creating campaign can also be moved to **failed** by stuck-state recovery when the launch is stuck. This triggers an immediate refund of the reserved amount — no 48-hour waiting period applies because the campaign never served ads. See [Stuck Creating Recovery](#stuck-creating-recovery) below.
10. A paused campaign becomes **active** when an admin explicitly approves it and the Google account-budget guard passes (the admin-created path’s review gate) — campaigns on this path never start spending without human approval or sufficient account-budget cap. On the public path, activation is automatic at the end of the setup saga rather than a separate admin step, but it runs the same account-budget guard. The platform status changes to ENABLED only after the guard confirms Google has an approved cap for the account’s reserved active/paused spend. The first activation records `activated_at` — subsequent pause/resume cycles do not overwrite it.
11. An active campaign can be **paused** by an admin. The platform status changes to PAUSED and spending stops.
12. An active or paused campaign can be **cancelled** by an admin; the platform campaign is removed first. Refund timing depends on whether the campaign ever served ads:

- **Never-activated rejection** — a pending-review `paused` campaign that was never approved (`activated_at` unset) refunds the full reserved amount **synchronously** in the same request. No settlement window applies because no spend is possible, and the admin status update emits `campaign.rejected` plus a synchronous `wallet.refund.completed`. The inline credit reuses the settlement cron’s idempotency key (see [Refund Flow](/shared/payments/refund-flow)), so the cron remains a safe fallback if the inline credit fails.
- **Post-activation cancellation** — a campaign that was activated at any point (`activated_at` set) may have spent, so its unspent budget settles through the 48-hour [Cancellation Flow](/managed-ads/cancellation-flow).

1. An active or paused campaign becomes **completed** when its lifetime budget is exhausted or its scheduled end date passes. The `sync-campaign-metrics` cron detects this after refreshing spend, pauses the campaign on Google Ads so a `completed` row never coexists with an actively-spending platform campaign, then CAS-transitions the local row and records `completed_at`. Unspent budget (reserved minus actual spend) is settled back to the wallet through the same refund engine as cancellation — anchored on `completed_at` rather than `cancelled_at`. See [Cancellation Flow](/managed-ads/cancellation-flow#natural-completion-settlement). On a successful transition the cron emits `campaign.budget_exhausted` (when budget triggered) and `campaign.completed` to PostHog — both carry `end_date_passed` so analytics can distinguish “exhausted before end date” from “exhausted at end date”.
2. **Daily-cap signal (non-terminal).** For `budget_type=daily` campaigns, the same cron emits `campaign.daily_budget_hit` whenever a `campaign_metric` row reaches `spend >= budget_amount` (the per-day cap). The campaign keeps running — Google resets the daily cap the next day. This signal applies only to legacy daily-budget campaigns (pre-existing Display rows); newly created campaigns use `budget_type=total` with a `CUSTOM_PERIOD` hard cap and never emit it. Deduplication uses a `daily_budget_hit_fired_at` timestamp on the `campaign_metric` row, set atomically before emission so each (campaign, day) hit fires exactly once across the four daily cron ticks and Inngest retries. A 2-day lookback prevents budget-edit churn from retroactively firing historical rows that now exceed a newly-lowered cap.

## User Actions (allowedActions)

The public campaign detail (`GET /api/v1/campaigns/:id`, surfaced by [`hellyeah campaign get`/`status`](/cli/campaign)) carries an `allowedActions` array naming the user-facing lifecycle actions valid right now — `pause`, `resume`, `cancel` — derived from the transition table above with these extra rules:
- A campaign pending admin review on the admin-created path (`paused` with `activated_at` unset) allows `cancel` only, because resume would bypass the review gate.
- A public launch awaiting the pre-assignment gate (`pending_internal_review`) or one sent back for changes (`rejected`) allows `cancel` only — the user can withdraw the request but cannot pause, resume, or otherwise act on a campaign that has no live platform resource yet.

Invalid lifecycle calls return `invalid_state` with a `fix` naming the commands that are currently available instead of internal transition states.

## Admin Review Gate

There is exactly one human review gate per campaign, and where it sits depends on how the campaign was launched.

### Pre-assignment gate (public launches)

Public launches place the single review gate **after wallet funding but before ad-account assignment**. The operator reviews the generated setup before Hellyeah commits pool capacity or creates Google resources.
- **Approve** — the system assigns an ad account, runs `validateOnly → create PAUSED → finalize` without another wallet debit, then auto-activates. A pending Google account-budget proposal can defer activation in `paused`.
- **Reject** — the campaign moves to `rejected` with a reason and immediately attempts a full wallet refund.

A post-approval `validateOnly` or creation failure also lands in `rejected` and refunds the submit debit. Pool exhaustion or an unhealthy account is not a rejection; the campaign stays funded and pending for retry.

### Paused activation gate (admin-created drafts)

Admin-created drafts (Admin Dashboard, AIMA) keep the legacy gate: they are always created as PAUSED on the ad platform, and an admin must explicitly approve the campaign (paused → active) before it starts spending. This is the same human-in-the-loop quality gate — admins verify targeting, budget, and ad copy before activating — placed **after** the platform resource exists rather than before assignment.

Approval and later resume (on either path) run the Google account-budget activation guard before enabling the platform campaign. The guard syncs any submitted account-budget proposals, computes the required cap from active/paused Google campaigns on the ad account, and reads the live approved Google account budget. Activation is allowed only when the live approved cap is sufficient and Google does not report a pending proposal. If the cap is short, a proposal is pending, or budget automation requires operator action, the transition is blocked and both Google and local campaign state are left unchanged; `ssot/campaign.activated` is emitted only after the guarded transition succeeds.

AIMA communicates this to users as “submitted for review” rather than “live”, which accurately reflects the pre-activation state without promising ad delivery.

## Stuck Creating Recovery

The same 15-minute worker first resumes public campaigns stuck in `funding`. It scans pending `spend_debit` transactions, replays Stripe with the key derived from the existing transaction UUID, and atomically finalizes the payment plus `pending_internal_review` transition. This path neither creates a second intent nor needs a campaign-side funding transaction column.

When a campaign is stuck in the `creating` state (e.g., platform API timed out, network failure, or worker crash), an admin can manually transition it to `failed`, and the `recover-stuck-creating-campaigns` Inngest cron performs the same recovery automatically every 15 minutes for rows whose `updated_at` is older than 10 minutes. This triggers:
1. **Best-effort platform cleanup** — if a platform campaign was created, the system attempts to remove it. When `platformCampaignId` is missing, recovery searches Google Ads for PAUSED campaigns matching the `campaign.name - launch-*` pattern in the bound ad account and removes the single match. Ambiguous matches (more than one candidate) are logged and skipped for manual review — the cost of a false delete is higher than leaving an orphan for an operator to clean up. Failure here is logged but does not block the refund.
2. **Immediate refund** — the reserved amount is refunded to the user’s wallet. No 48-hour waiting period applies because the campaign never served ads.
3. **Failure reason** — the admin-provided reason (or a default) is recorded for the audit trail.

The transition to `failed` uses a CAS guard (`WHERE status = 'creating'`) to prevent overwriting a concurrent successful launch. The refund idempotency key includes the `reservedTransactionId` so each launch-then-fail cycle produces a unique key.

If the wallet refund succeeds but the Google account-budget decrease request fails, the campaign stays `failed` with `refund_status = 'failed'`. The admin endpoint allows `failed -> failed` re-entry only for stuck-creating intervention rows with unresolved refunds, and the recovery cron also sweeps those failed refund attempts. Both replay the same wallet refund and account-budget idempotency keys, so retries heal missing budget-adjustment rows without double-crediting the wallet.

The campaign can be retried after the intervention — launching a `failed` campaign follows the same flow as launching a `draft`. On re-launch, all prior failure and refund metadata (`failedAt`, `failureReason`, `refundStatus`, `refundAmount`, `refundTransactionId`, `refundEligibleAt`, etc.) is cleared so the next cycle starts clean. If the relaunch fails again during preflight, `failed_at` is refreshed to the new failure time rather than restored from the previous cycle.

## Lifecycle Contract

Campaign Manager is the single entry point for all status transitions. External callers (AIMA, Admin Dashboard) never interact with platform connectors directly. The local database always mirrors the platform state — every platform status change is persisted locally before returning a response.

Draft and failed campaigns are fully editable. A `pending_internal_review` campaign holds a frozen setup snapshot — the operator reviews and approves or rejects the exact setup that was submitted, so its fields are not editable at the gate. Active and paused campaigns are restricted to specific admin-only edit paths: budget/end-date changes through [Budget Edit Flow](/managed-ads/budget-edit-flow), platform-backed renames, safe Google Search setup edits through [Active Setup Edit Flow](/managed-ads/active-setup-edit-flow), and limited Google Search/Display targeting edits through [Active Targeting Edit Flow](/managed-ads/active-targeting-edit-flow). Schedules outside the budget endpoint, Display copy/images, unsupported targeting dimensions, and unknown setup fields remain locked. Once a campaign enters `approved` or `creating`, all fields are locked until it either succeeds or fails. Operators can still edit the setup after it goes live through the paths above.

Platform-backed campaigns can be renamed through the admin rename endpoint while in `active` or `paused` status. The rename flow updates Google Ads first and writes the local `campaign.name` only after Google accepts the change, so duplicate-name conflicts never leave the database ahead of the platform. A no-op rename returns success without calling Google. Draft and failed campaigns use the draft edit path before launch or retry; completed campaigns are historical records and the active rename endpoint returns 422 for them.

## Lifecycle Timestamps

Every status transition records a timestamp so ops can answer “when did this happen?”
| Timestamp | Set when | Cleared when |
| --- | --- | --- |
| `launched_at` | Campaign submitted to platform | Overwritten on relaunch |
| `reviewed_at` | Operator approves or rejects a public launch at the pre-assignment gate | Never (historical record) |
| `activated_at` | Campaign first goes active — admin approval on the admin-created path, or automatically at the end of the public setup saga (paused → active) | Never (historical record) |
| `completed_at` | Budget exhausted or end date reached | Never |
| `cancelled_at` | Admin cancels campaign | Never |
| `paused_at` | Admin pauses campaign | Cleared on resume |
| `failed_at` | Campaign transitions to failed (platform rejection or admin intervention) | Cleared on relaunch (refreshed if relaunch fails again) |

### Comments
