---
source: https://hellyeah-v2-docs.vercel.app/managed-ads/launch-flow
site_timestamp: 1785830543000
synced_at: 2026-08-05T01:39:45.196Z
---
# Launch Flow

> Draft to live campaign — balance check, platform creation, safety pause.

## Who triggers the saga

The launch saga below resolves targeting, runs `validateOnly`, creates the Google campaign PAUSED, and finalizes it. **Wallet timing depends on the entry point:**
- **Public launches** ([`hellyeah campaign launch`](/cli/campaign)) run the read-only preconditions, capture the setup snapshot, and debit the wallet during submit. Only a confirmed debit moves the campaign from the internal `funding` state to `pending_internal_review`. Operator approval assigns an ad account and runs the platform portion of the saga without a second debit, then auto-activates the campaign.
- **Admin-created drafts** (Admin Dashboard, AIMA) run the saga when an admin launches the draft, producing a `paused` campaign that an admin activates at the paused review gate.

The diagram below shows the admin-created draft path, where debit still occurs inside the saga. On the public path, the operator’s approve action promotes `approved` into `creating` and reuses the confirmed submit debit.

## Saga

The saga is the sequence of Campaign Manager steps that resolves targeting, runs preflight, moves money, and creates the platform campaign. It is the same work on both entry points; only the trigger and the final activation differ. The diagram below shows the **admin-created draft** path, where an admin launches the draft and later activates the resulting `paused` campaign. The [public pre-assignment path](#public-pre-assignment-launch) reuses these steps but runs them on operator approval and auto-activates.
1. User requests a campaign launch via AIMA
2. AIMA forwards to Campaign Manager
3. Campaign Manager promotes the campaign from `draft|failed` to `creating` via a CAS guard, then re-reads it to pick up any concurrent draft edits (budget, targeting, ad copy)
4. Preflight runs **before any money moves**: the `adCopy` is re-parsed through `adCopySchema` (truncation, NFKC normalization, dedup canonicalization), and for Search campaigns the full mutate batch is submitted to Google Ads with `validateOnly: true`. The campaign’s stored targeting (`"US"`, `"Singapore"`, `"en"`, `"18-24"`) is also resolved here into Google’s machine vocabulary, so an unresolvable location or language fails pre-debit. See [Preflight Validation](#preflight-validation)
5. The schema-normalized `adCopy` is persisted back to the row (CAS-guarded on `status = creating`) so the real launch uses the exact bytes that passed validateOnly
6. Campaign Manager enforces [budget caps](#budget-caps) — per-campaign max, rolling 24h daily cap, calendar month cap, and cool-off window. If any cap is exceeded, the status is rolled back to its pre-CAS value and a `budget_cap_exceeded` error is returned (HTTP 429). No money moves
7. Campaign Manager calculates the reserved amount: equal to the budget ($500). Service fee is disabled for v1
8. Campaign Manager calls Payments to check balance and debit $500 (50,000 cents)
9. Payments reads the Stripe Customer Balance and verifies sufficient funds
10. Payments debits the reserved amount and records a `spend_debit` transaction
11. Campaign Manager resolves the [calendar window](#review-and-setup-buffer) sent to Google — the user’s delivery end plus a review/setup buffer of three calendar days by default — once, so the budget preflight, the validateOnly dry-run, and the real create all use the same end date. The buffer is never persisted
12. Campaign Manager fetches the org’s brand logo from `business_profile` and processes it into a 1200×1200 PNG via sharp (brand color background for transparent images, white for opaque)
13. Campaign Manager calls the ad platform API to create the campaign as PAUSED and returns a platform campaign ID. Routing is by `campaignType`: Search sets budget, ad groups, ads, and keywords, then attaches the logo in a separate best-effort API call (logo failure does not affect campaign creation). Performance Max instead builds one asset group — copy and image assets plus the required logo — inside a single atomic batch (no ad groups), so the [logo-required preflight](#preflight-validation) has already guaranteed the logo before debit
14. Campaign Manager pushes the resolved targeting (location, language, and demographic criteria) onto the new campaign — the create call sets budget, ad groups, ads, and keywords but no targeting criteria, so without this the campaign would serve to all countries/languages/ages. Performance Max receives the same location, language, and age/gender criteria as Search (demographics as negative-complement exclusions). If the push fails, the just-created campaign is removed and the launch enters refund compensation; the campaign is never finalized while ignoring its targeting
15. Campaign Manager persists the platform ID and updates the local status to `paused`
16. Campaign Manager reads the new campaign’s copy back from the platform and records its fingerprint as the ad-copy baseline for [External Sync](/managed-ads/external-sync-flow) — without it, an edit made in the Google Ads UI before the first sync poll would be adopted as the baseline and lost. Best-effort: the campaign is already live and finalized, so a failed read or write is logged and the first poll bootstraps a baseline as before
17. AIMA tells the user the campaign is submitted and pending admin review
18. Admin reviews targeting, budget, and ad copy on the platform, then activates the campaign
19. Campaign status changes to `active` and the user is notified that the campaign is live

## Public Pre-Assignment Launch

The public path funds the campaign before it reaches the single review gate. Ad-account assignment and Google setup remain deferred until approval.

### Submit funding contract

Public submit always creates `funding` plus a pending payment transaction and confirms the wallet debit before returning `pending_internal_review`. The public launch response includes `funded: true`, derived from the existing `reservedTransactionId`; it is a wire field only and does not add a database column. Approval consumes the existing debit and never charges the campaign again.

There is currently no product-defined review TTL, so this change does not invent an automatic expiration deadline. Rejection and user withdrawal release funding immediately; adding automatic expiry later must define its SLA and use the same idempotent pre-platform refund path.
1. The user runs `hellyeah campaign launch --yes`. The CLI posts to `POST /api/v1/campaigns/launch`; one ambiguous transport, HTTP 5xx, or unreadable-response failure is retried with the same `Idempotency-Key`, and an unresolved result returns that key for safe cross-process continuation
2. Campaign Manager runs the read-only preconditions, captures the setup snapshot, and under the org/wallet locks verifies `Stripe balance - pending spend-debit transactions` plus spend caps
3. The campaign and a pending `payments.transaction` are written atomically. Stripe debit uses the payment transaction UUID as its idempotency key. Only after local finalize does the campaign enter `pending_internal_review` with `adAccountId = null`; an interrupted attempt stays `funding` and the 15-minute worker resumes it
4. An operator reviews the full generated setup and the captured dry-run result in the [Admin Dashboard](/admin-dashboard/campaigns), then approves or rejects
5. On **approve**, Campaign Manager assigns an ad account and moves the campaign to `creating`, then runs `validateOnly → create PAUSED → finalize` using the existing submit debit. An unfunded row fails closed and cannot be approved
6. When setup succeeds, the campaign is **auto-activated** (`active`) with no second human gate. If the Google account-budget cap is still pending, activation is deferred and the campaign stays paused until the cap approves — the setup already exists, so this is a wait, not a rejection
7. If `validateOnly` or creation fails after approval, the saga refunds anything debited and the campaign moves to `rejected` with a user-visible reason and fix
8. On **reject** at the gate, the campaign moves to `rejected` and immediately attempts a full refund. The terminal verdict remains even if the credit is uncertain; the refund worker retries with a key scoped to the original debit
9. If an account cannot be assigned at approval (pool empty or unhealthy org account), the funded campaign stays `pending_internal_review` for the operator to retry

## Denied Flow
1. User requests a campaign launch via AIMA
2. Campaign Manager calls Payments to check and debit $500
3. Payments reads the Stripe Customer Balance: $300
4. Balance is insufficient — Payments returns the current balance and shortfall ($200)
5. AIMA prompts the user to top up before retrying
6. The campaign remains in `draft` state, unchanged

## Dry-Run Validation

`POST /api/v1/campaigns/launch/validate` is the read-only twin of `POST /launch`, powering the CLI’s `campaign launch --dry-run` ([CLI → Campaign → Dry Run](/cli/campaign#dry-run)) and the customer dashboard’s launch readiness panel. It runs `validateLaunchPreconditions` in `@hellyeah/managed-ads`, which mirrors every gate the launch path enforces — ad-account assignment and health, creative jobs and the Performance Max image kit recipe, the campaign budget floor and the derived per-day floor (total budget ÷ active delivery days, skipped for open-ended runs), a usable campaign schedule (an open-ended run has no lifetime spend cap to derive, and a delivery window that has already ended cannot be launched at all — both are blocked with a schedule-oriented message), Google budget configuration, spend caps, and available wallet balance after pending spend-debit transactions (and, for Performance Max, the pre-debit 1:1-logo gate) — plus the API-layer profile-website and ad-copy gates, and reports **all** failures in one response instead of the launch surfacing them one at a time.

Four properties define it:
- **Read-only.** It never assigns an ad account, waitlists the org, inserts a creative draft, takes a lock, debits the wallet, or provisions a missing wallet. The real public submit performs the authoritative locked cap and wallet check immediately afterward; the dry-run remains a point-in-time preview.
- **The ad-account check is advisory.** Checks carry `pass`, `warn`, or `fail`, and the verdict (`launchable`) is true when no check is `fail`. The ad-account check — an unhealthy assigned account or an empty pool — reports `warn`: visible in the report but never blocking, because submit defers assignment to [operator approval](/managed-ads/campaign-lifecycle#admin-review-gate) and accepts those conditions. The dry-run verdict therefore matches what submit would do. Each ad-account warn carries a `reason` discriminator — `capacity` (no account assigned yet, pool empty) or `account_health` (the org’s assigned account is suspended or ops-paused) — so a UI can hide the former and surface the latter. The setup snapshot captured at submit carries the same checks, so an operator reviewing the request sees the advisory alongside any failures.
- **A draft ad-copy override is reported, not rejected.** The dashboard ships the previewed creative copy as an `adCopy` override, and a sparse import (a single-variant Studio creative) or an edit can legitimately sit below Google’s RSA minimums. Validate preserves the submitted text and runs the strict public-submission schema inside the report: whatever `POST /launch` would reject — fewer than 3 headlines or 2 descriptions, duplicate or blank rows, an asset over Google’s weighted character limit, or a missing landing-page URL — surfaces as a failing `ad_copy` check with counts and a fix — plus a structured `issues` array carrying one entry per fixable item, so UIs render discrete lines instead of re-splitting the joined message — instead of a 400 that would hide the rest of the report. The same lenient posture applies to the budget: validate accepts `budgetCents: 0` (a cleared field mid-edit) and reports it as failing budget checks with the rest of the report intact. `POST /launch` itself keeps the strict schema — a positive budget and launch-ready, non-truncated override — so invalid user copy is rejected before persistence or debit.
- **Unified top-up math.** The wallet summary reports the campaign budget minimum, the pending submit debit, and the exact shortfall on top of `availableBalanceCents` (raw Stripe balance minus pending spend-debit transactions). Suggested top-up amounts are always that gap, never the total.

The report also resolves the [review/setup buffer](#review-and-setup-buffer) with the same helper the launch uses, so the previewed active delivery window, buffer days, and Google calendar window match what launch will send.

## Preflight Validation

Money is committed before the ad platform call. On admin-created drafts, preflight runs before the saga debit. Public requests are already funded at submit, so an approval-time preflight rejection triggers the immediate full-refund path.
1. **Local schema re-parse** — `adCopySchema.safeParse(freshCamp.adCopy)` truncates each headline/description using Google Ads text limits, including double-width counting for Chinese, Japanese, and Korean characters. The truncation keeps whitespace word boundaries where available and falls back to conservative CJK phrase boundaries when a hard cut would leave a dangling partial token. It also applies NFKC normalization, strips zero-width characters, collapses whitespace, and rejects within-ad duplicates on the canonical key. This catches the most common failure mode: the schema’s transforms produce a different final form than the raw stored draft, which would otherwise pass a naive equality check but be rejected by Google.
2. **Google Ads `validateOnly` dryRun** — for Search campaigns, the full mutate batch is sent with `validateOnly: true`. For Performance Max, Campaign Manager first fetches the final R2 image bytes, verifies both landscape and square image slots are present, and sends those same image bytes through the shared image kit with `dryRun: true`; the campaign builds one asset group, and the 1:1 logo is part of that asset group’s atomic batch, so Campaign Manager fetches the logo before the dryRun and fails the launch when it is missing, making the validated batch match the real launch exactly. Google runs its own policy and approval checks and returns the same rejections it would emit on a real launch (e.g., `POLICY_TOPIC: TRADEMARK_IN_AD_TEXT`, disapproved copy, duplicate image assets, or image policy issues) without creating any platform resources or moving money.

After both layers pass, the schema-normalized `adCopy` is persisted back via `UPDATE ... WHERE status = 'creating'`. The CAS doubles as the abort signal: if the row no longer matches (an admin moved it to `failed` during the long validateOnly call), the launch aborts. On an admin-created draft this is before debit; on a funded public request the approval failure enters the immediate refund path.

### Preflight Failure

On the **admin-created path**, any preflight failure rolls the row back to its pre-CAS status (normally `draft`, `failed` for retries) under a `WHERE status = 'creating'` guard so a concurrent admin-driven status change is never overwritten. No money has moved on that path and no Google resources exist, so `failed` would be the wrong terminal state — the campaign is still editable and can be retried after the user fixes the copy. When rolling back to `failed` (retry scenario), `failedAt` is refreshed to the current time rather than restored from the previous cycle, so the “Failed Today” dashboard KPI and timeline reflect the most recent failure.

Google `validateOnly` failures are thrown with the `Ad copy validation failed:` prefix. The CLI launch route (`POST /api/v1/campaigns/launch`) maps submit-time validation failures to HTTP 400 so the client can surface the policy reason inline. The admin route in `apps/api/src/modules/managed-ads/campaigns.ts` does the same. The shared `fetchDisplayImages()` image-kit fetch is non-throwing for per-URL problems — unreachable, oversized, malformed, or wrong-dimension images are logged and skipped, and a missing landscape or square slot surfaces as a typed `KitIncompleteError`. Performance Max runs this image kit check and adds a logo check: the 1:1 logo belongs to the asset group’s atomic batch, so a missing logo fails preflight with `NO_VALID_LOGO`. These checks happen before debit for admin-created drafts and during read-only validation before public submit; if the approval-time repeat later fails on a funded public request, it enters the immediate refund path.

Targeting resolution runs in the same preflight. Locations and languages are **fail-closed**: a value that resolves to no Google geo/language constant throws with the `Targeting validation failed:` prefix (mapped to HTTP 400 the same way), so the campaign never launches to the wrong geography. Public submit resolves targeting during its read-only validation before debit and captures the result; approval repeats platform validation against the funded request. **Worldwide is the deliberate exception, shared by every campaign type.** Google Ads has no positive geo target for “all countries and territories” — serving globally is the *absence* of any location criterion — so a campaign launched with no location (or with a worldwide-intent term like `Worldwide` or `Global`) pushes no geo criteria and serves worldwide, whether it is Search or Performance Max. Worldwide-intent terms are never sent to the geo-suggestion service, which would otherwise fuzzy-match the word to a literal place; combining one with a concrete location keeps only the concrete location. A blank-only value (e.g. `" "`) is **not** a way to express worldwide — targeting values are trimmed and rejected at request validation, so a whitespace location/language/keyword fails the dry-run and launch with a `400` before resolution ever runs. Worldwide is expressed by omitting the location, never by a blank string. Demographics are **fail-open**: an unmappable age/gender value is dropped (that dimension stays at Google’s default of “all”) rather than blocking the launch, since geography is the higher-stakes dimension.

The schedule is checked in the same preflight, before the debit. A delivery window that has fully elapsed throws with the `Campaign schedule validation failed:` prefix (mapped to HTTP 400 like the others) and is surfaced to the user verbatim, since the fix is theirs to make. See [Stale Start Dates](#stale-start-dates).

If the rollback `UPDATE` itself throws — extremely unlikely, but possible during a database outage — the campaign is logged as a CRITICAL stuck-in-creating event for operator follow-up.

On the **public path**, this same preflight runs inside the approval saga. The submit snapshot catches most problems before review; a failure that only appears at approval moves the campaign to `rejected` and immediately refunds the submit debit.

## Review and Setup Buffer

A campaign has two end dates. The user’s requested dates are the **active delivery window** — the days the campaign is meant to spend. The date sent to Google is the **calendar window** — the delivery end plus a review/setup buffer of three calendar days by default (configurable via the `REVIEW_SETUP_BUFFER_DAYS` env var). The buffer exists because Google review takes one to two days and early setup or no-spend fixes can eat a tight window before delivery ramps; the extra calendar days give the platform room to approve and start serving without losing intended delivery days.

The buffer only relaxes Google’s daily pacing. The **total budget is a hard cap and is unchanged** by the buffer — the lifetime `total_amount_micros` ceiling stays the reserved amount regardless of how many calendar days Google has, so the extra days can never increase spend (see [Budget Validation](/managed-ads#budget-validation)).

The window is resolved **on-demand at every point dates are sent to Google** — launch, the launch dry-run/validate path, and active [budget edits](/managed-ads/budget-edit-flow) — and is **never persisted**. The stored schedule always keeps the user’s delivery dates, so a relaunch or edit recomputes the same calendar end from the unchanged delivery end. Because the dry-run resolves the buffer with the identical helper, the validate preview’s end date matches what launch actually sends. The start date is resolved the same way on both surfaces (see [Stale Start Dates](#stale-start-dates)), so the previewed window matches at both ends.

A campaign can be flagged as a **hard deadline** (`schedule.isHardDeadline`). Hard-deadline campaigns are **not extended** — the calendar end equals the delivery end, with no buffer — and the user is warned that review and setup may leave fewer active delivery days. Campaigns with no end date are open-ended and likewise get no buffer.

The resolved window — active delivery window, buffer days, and Google calendar window — is disclosed to the user at the confirmation step on both the CLI and AIMA, so the gap between the requested end and the date Google receives is visible before launch.

## Stale Start Dates

A launch request can sit in internal review past its own start date, and a draft can be left unlaunched for days. Google rejects a campaign whose start date has already passed — the whole mutate batch fails on the date, and every operation that references the campaign cascades into unrelated-looking “resource not found” noise.

A start date that has passed is therefore **clamped forward to today**, the same default an unscheduled launch uses. A start date of today or later is sent verbatim. The stored schedule is never rewritten, so the campaign keeps the dates the user chose and a relaunch resolves the clamp again from scratch.

The clamp needs somewhere to land. When the **delivery end has passed as well**, there is no window left and the launch refuses the campaign outright rather than sending Google a window that ends in the past. On the public path this is a schedule failure the user fixes by moving the end date; it is raised before any money moves, so nothing is debited and nothing needs refunding.

Two properties make this safe to rely on:
- **The dry-run agrees with the launch.** `validateLaunchPreconditions` applies the same clamp, so the previewed delivery window, the derived per-day floor, and the elapsed-window refusal all match what launch does. A campaign that clears the dry-run is not later rejected on its schedule.
- **The launch resolves the clamp once.** The date is fixed before the wallet debit and reused for the real platform call, so a launch running across UTC midnight sends exactly the window Google validated instead of drifting a day mid-saga.

## Budget Caps

Three independent spend ceilings and a cool-off window are enforced before money moves: at submit for public requests and inside the launch saga for admin-created drafts.
| Cap | Default | What it checks |
| --- | --- | --- |
| Per-campaign | $5,000 | Single campaign budget cannot exceed this amount |
| Per-org daily | $10,000 | Sum of `reserved_amount` for campaigns launched in the rolling 24h window |
| Per-org monthly | $100,000 | Sum of `reserved_amount` for campaigns launched in the calendar month |
| Cool-off | 60 seconds | Minimum interval between successive launches for the same org |

Cap configuration is stored in the [`spend_cap`](/managed-ads/data-model#spend_cap) table, keyed by `org_id`. Missing rows fall back to the managed-ads environment defaults: `BUDGET_CAP_PER_CAMPAIGN_DOLLARS`, `BUDGET_CAP_DAILY_ORG_DOLLARS`, `BUDGET_CAP_MONTHLY_ORG_DOLLARS`, and `BUDGET_CAP_COOL_OFF_SECONDS`. CS can raise or lower caps for a specific org by editing the table — no deploy required.

Budget increases on active campaigns also check per-campaign, daily, and monthly caps but skip the cool-off window (edits are not new launches). The per-campaign check uses the campaign’s new total reserved amount; org caps count the current campaign’s existing reservation and add only the requested increase.

Both launches and budget increases acquire `SELECT ... FOR UPDATE` on the campaign’s `user_org` row before the cap query and run the cap reads on the same transaction executor. This serializes concurrent launches and edits within an org so a launch cannot pass against the stale aggregate while an in-flight edit (or another launch) is still uncommitted. Launches release the lock immediately after the cap check, since `reserved_amount` and `status="creating"` are already committed by that point; edits hold the lock through debit and the platform mutate because they atomically update `reserved_amount` inside the same transaction.

The daily and monthly aggregates count funded review states (`funding`, `pending_internal_review`, `approved`) alongside `creating`, `active`, `paused`, and `completed`. Public submit takes the org lock before checking and inserting, so concurrent requests cannot pass against the same cap snapshot.

Both admin and public campaign launch routes surface cap failures as HTTP 429 with `code: "budget_cap_exceeded"` and structured cap details.

## Platform Failure

If the ad platform API fails after the balance has been debited, Campaign Manager refunds the debited amount and records the refund metadata on the campaign. Admin-created drafts become `failed`; funded public requests become `rejected` so the review verdict and user-facing fix stay explicit. Performance Max image format, missing-slot, and image policy failures are expected to be caught during preflight; the refund path remains for failures that cannot be detected before debit, such as transient platform errors or post-validation mutate failures.

Public submit derives `campaign_submit_debit_<paymentTransactionId>` from the durable local transaction UUID. Recovery and same-key request replay reuse it. Admin-created draft launches use `campaign_launch_<campaignId>_<previousFundingCycleId>`: the initial funding cycle uses `initial`, retries reuse the same key even when a Stripe response is lost, and a completed refund supplies the next generation so a legitimate relaunch receives a fresh key.

The client `Idempotency-Key` deduplicates the campaign request; the local payment transaction ID deduplicates the Stripe debit. Re-opening is allowed only after the previous refund completes and creates a fresh pending payment transaction, so each funding cycle has distinct debit and refund keys.

Stripe idempotency converges each wallet mutation. Funded requests that never reach a platform refund immediately on rejection or cancellation; only campaigns that may have spent use the 48-hour settlement window.

Each Google Ads launch attempt also gets unique sub-resource names for platform objects such as campaign budgets and ad groups. This avoids a failed or partially created platform resource blocking a later retry with a duplicate-name error.

## Account Suspension Fallback

Google can suspend, cancel, or close an upstream ad account at any time, and the hourly platform-status sync leaves a staleness window — a freshly suspended account can pass the allocation health gate and a Google call can fail with an account-level authorization error (`CUSTOMER_NOT_ENABLED`). Direct admin-created/AIMA launches detect it, quarantine the account, re-allocate from the pool, and retry before debit when possible. On the public path, assignment happens after submit funding; unavailable capacity keeps the request in `pending_internal_review` for a later approval retry.
1. **Detection is probe-confirmed.** When a launch fails, an error classifier checks for account-level authorization errors (`CUSTOMER_NOT_ENABLED`, `ACTION_NOT_PERMITTED_FOR_SUSPENDED_ACCOUNT`) buried in the Google error chain. On a match, the live `Customer.status` is fetched through the parent MCC before anything destructive happens — a mutate error alone cannot distinguish a suspended sub-account from a suspended login MCC, and quarantining on a guess would burn healthy pool accounts. If the probe reports `ENABLED` or fails, the original error propagates unchanged.
2. **The account is marked, not silently dropped.** A probe-confirmed suspension writes `platformStatus` + `platformStatusSyncedAt` on the `ad_account` row immediately — the same columns the hourly sync maintains — so the admin dashboard, anomaly detectors, and every allocation predicate see the suspension without waiting for the next sync.
3. **Quarantine and re-allocation happen at the allocation layer.** `getOrAssignAdAccount` probe-confirms a cached non-`ENABLED` status, then unbinds the account from the org and parks it as `disabled` — guarded so an account with active or creating campaigns is never unbound. The org then grabs a healthy pool account through the normal CAS path. If the pool is empty the org is waitlisted (unbinding always precedes waitlisting, so waitlist fulfillment can never collide with a still-bound account). Same-org races converge: concurrent launches re-read the winner’s assignment instead of failing.
4. **Direct draft launches retry once, in-request.** On the admin-created/AIMA path, a `preflight`-phase suspension (no money moved) triggers one re-resolve + relaunch of the same draft within a 15-second budget. The launch saga repoints the draft’s `ad_account_id` to the org’s replacement account; the repoint is CAS-guarded on the previous account **and** on refund resolution (`reservedTransactionId IS NULL OR refundStatus = 'completed'`) so a failed campaign with an unresolved refund stays pinned to the account its refund cleanup targets. When the suspension surfaces **after** the debit, the normal [Platform Failure](#platform-failure) compensation refunds first, and no in-request retry happens. Public submit has already funded the request before assignment; approval leaves it in `pending_internal_review` when the pool or account is unavailable, without a second debit or refund cycle.
5. **Errors are typed, not generic.** When no replacement is available or the retry is exhausted, the route returns a structured 409 instead of `internal_error`:

| Code | When | Client guidance |
| --- | --- | --- |
| `upstream_ad_account_suspended` | Suspension confirmed; direct-launch retry exhausted, skipped (over time budget), or post-debit | Post-debit: verify the refund, then relaunch. Otherwise retry after a replacement is assigned |
| `ad_account_pool_unavailable` | Account quarantined but the pool is empty | Org is waitlisted; relaunch once capacity frees |

AIMA and admin relaunches of a draft pinned to a quarantined account self-heal through the same repoint: the saga swaps the draft to the org’s current account when one exists, and otherwise surfaces the typed `Ad account is suspended on Google Ads` error. A funded public request stays at the review gate when assignment cannot proceed; it is not debited again. PostHog telemetry distinguishes user-resolvable gates (`campaign.launch_blocked`) from platform failures (`campaign.launch_failed`), and a successful fallback stamps `ad_account_replaced: true` on `campaign.launched` — see [Funnel Events](/observability/posthog/funnel-events).

## Launch Contract

Money is debited before calling the ad platform. Public `pending_internal_review` is therefore a funded state equivalent to the admin-created path’s funded `paused` state. Deterministic keys make submit recovery and launch retries idempotent.

The ad platform always creates campaigns as PAUSED before they serve. On the **admin-created path**, an admin explicitly activates it. On the **public path**, human review happens before account assignment and Google setup, but after wallet funding; successful approval auto-activates instead of adding a second gate.

> **Why PAUSED?** Creating campaigns as PAUSED means creation and activation are distinct steps, so ad delivery never starts as a side effect of setup. Human review — an admin at the paused gate, or an operator at the funded pre-assignment gate — verifies targeting, budget, and ad copy before ads can serve. This is critical for a managed-accounts model where Hellyeah operates the ad accounts on behalf of customers.

## Google Ads Bidding

Generated Search campaigns use **Maximize Clicks** (`TargetSpend`), not Manual CPC. Google sets per-auction bids automatically to win the most clicks the campaign budget allows, which removes manual bid maintenance and aligns with current Google Ads guidance. Ad groups carry no fixed CPC bid — automatic bidding owns the bid.

A CPC ceiling guards the strategy so a single click can’t drain a small daily budget. `TargetSpend.cpcBidCeilingMicros` is the daily (or derived-daily) budget × 10%, capped at 2 account-currency units, rounded down to the account currency minimum unit, and floored at one minimum unit so Google never receives a zero ceiling.
| Daily budget | CPC ceiling |
| --- | --- |
| $20/day | $2.00 (capped) |
| $7.14/day (derived) | $0.71 |

The ceiling is computed in account-currency micros from the same resolved budget used for the campaign budget, so zero-decimal currencies (e.g. JPY) round to whole units. `target_spend_micros` is omitted — Google marks it deprecated, and the campaign budget already serves as the spend target.

Editing a campaign’s budget recomputes the ceiling from the new budget so the guardrail stays proportional. Campaigns still on legacy Manual CPC are left untouched.

For Search, conversion-based Smart Bidding (Maximize Conversions) is **not** used: it depends on verified conversion tracking and postback quality, which are not confirmed. Maximize Clicks stays in place until those are validated. Performance Max is the exception — it offers no click-based strategy, so Performance Max campaigns bid with Maximize Conversions, the only strategy Google supports for that channel.

## Creative Kit Registry

Performance Max campaigns require more than one image — Google needs both a `landscape` (1200×628) and a `square` (1200×1200) asset to assemble the image kit. The set of formats that completes a launch is **data-driven**, not hardcoded in the launch saga: it lives in `@hellyeah/shared`’s `PLATFORM_SPECS` registry as a “kit recipe”. The creatable recipes are `search` and `pmax`; the `display` recipe is retained as a legacy entry so existing Display campaigns still validate, and it carries the same `landscape + square` requirement as `pmax`:

```
// packages/shared/src/specs/creative.ts (excerpt)
PLATFORM_SPECS = {
  google: {
    formats: {
      landscape: { width: 1200, height: 628,  slot: "marketing"       },
      square:    { width: 1200, height: 1200, slot: "squareMarketing" },
    },
    campaigns: {
      search:  { requires: [] },
      pmax:    { requires: ["landscape", "square"] },
      display: { requires: ["landscape", "square"] }, // legacy, read-only
    },
    textAssets: {
      headlines:     { min: 3, max: 15, maxLength: 30 },
      descriptions:  { min: 2, max: 4,  maxLength: 90 },
      longHeadlines: { min: 1, max: 5,  maxLength: 90 }, // PMax asset groups only
    },
    // ...
  },
}
```

The registry is also the single source of truth for Google’s text-asset rules: `textAssets` carries the min/max counts and per-asset character limits for headlines, descriptions, and long headlines (see [Google Ads Specifications](/creative-engine/platform-specs/google#copy-limits)). Headlines and descriptions apply to every campaign type; long headlines belong to Performance Max asset groups alone, since a Search RSA has no such asset. The public submission schema, dry-run `ad_copy` readiness check, and dashboard editor all read these bounds from the registry instead of hardcoding them. The separate stored-copy schema keeps normalization for generated creative and legacy campaign rows; it is not the public user-edit boundary.

When `createCreativeDraftFromJobs` runs, it reads `PLATFORM_SPECS[platform].campaigns[type].requires`, walks the supplied `creativeJob` rows, and reads the format stamped on `params.format` (or falls back to pixel-dimension classification for legacy rows). If a required format is missing it throws `KitIncompleteError` — surfaced to the caller as `400 kit_incomplete` with a `fix` hint pointing at the missing format. Validation runs **before** the submit debit so a misshapen kit never costs the caller money.

Adding a new platform (Meta, TikTok) is a registry-only change: add a top-level entry with that platform’s `formats`, `slot` labels, and `campaigns[type].requires`. The launch validator and the CLI’s `--size all` shortcut both read from the registry; neither needs code edits to support the new platform.

### Comments
