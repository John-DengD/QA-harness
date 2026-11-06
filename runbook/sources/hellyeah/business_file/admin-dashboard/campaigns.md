---
source: https://hellyeah-v2-docs.vercel.app/admin-dashboard/campaigns
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:39:14.162Z
---
# Campaigns

> Campaign oversight — review, approve, intervene, and manage ad campaigns across all customers.

## Purpose

The Campaigns page gives the ops team visibility into every campaign in the system. Operators approve public launch requests at the pre-assignment review gate, approve admin-created campaigns awaiting activation, intervene on stuck campaigns, and manage active campaign lifecycle — all from a single table with status filtering and inline actions.

## Campaign Table

The table displays all campaigns with the following columns:
| Column | Source | Notes |
| --- | --- | --- |
| Campaign | `campaign.name` | Campaign display name |
| Customer | `user_org.name` | Resolved via join on `userOrgId` |
| Platform | `campaign.platform` | Badge (e.g. “google”) |
| Status | `campaign.status` + `launchedAt` + ad policy aggregate | Color-coded lifecycle badge plus a separate red ad-disapproval badge when any synced ad is disapproved |
| Type | `campaign.campaignType` | Badge: “search”, “performance max”, or “display” (hidden by default) |
| Daily Budget | Derived from `budgetAmount` + targeting schedule | Formatted as `$X.XX` with tabular numbers |
| Total Budget | Derived from `budgetAmount` + targeting schedule | Formatted as `$X.XX` with tabular numbers |
| Spend | `campaign.actualSpend` | Formatted as `$X.XX` with tabular numbers |
| Created | `campaign.createdAt` | Relative time (e.g. “2d ago”) |
| Failed | `campaign.failedAt` | Relative time — shows ”—” for non-failed campaigns |
| Refund | `campaign.refundStatus` | Badge: pending/processing/completed/failed (hidden by default) |
| Actions | — | Context menu per row |

### Filtering

The toolbar has two filter controls:
1. **Status multi-select** — dropdown with checkboxes for Pending Review, Paused, Active, Funding, Approved, Creating, Rejected, Draft, Completed, Cancelled, Failed, plus an “All” option to clear. Multiple statuses can be selected simultaneously and combine with OR (e.g. Active + Pending Review returns the union). “Pending Review” is a single synthetic option that folds **both** review gates: the derived admin-created state (`paused` + launched + never activated, routed through the `pendingReview` boolean) **and** the stored `pending_internal_review` status (routed through the `statuses` param); the backend ORs the two. Every other option maps directly to a stored DB status — the public launch path’s `funding` and `rejected` statuses show as “Funding” and “Rejected”.
2. **Advanced filters** — popover with 8 dimensions, each with a dedicated value picker:

| Dimension | Picker Type | Filter Params |
| --- | --- | --- |
| Platform | Radio: Google | `platform` |
| Campaign Type | Radio: Search / Performance Max / Display | `campaignType` |
| Budget Range | Min/max inputs ($) | `budgetMin`, `budgetMax` |
| Spend Range | Min/max inputs ($) | `spendMin`, `spendMax` |
| Budget Utilization | Min/max inputs (0-100%) | `utilizationMin`, `utilizationMax` |
| Created Date | Presets (7d/30d/90d) + custom calendar | `createdAfter`, `createdBefore` |
| Launched Date | Presets (7d/30d/90d) + custom calendar | `launchedAfter`, `launchedBefore` |
| Refund State | Started / Not Started / Eligible Now | `hasRefund` |

Active advanced filters appear as dismissible badge pills below the toolbar. A “Clear all” button appears when 2+ filters are active.

`Eligible Now` uses the same claim predicate as the refund worker: immediate funded requests that never reached the platform, platform-backed cancellations/completions whose persisted settlement time has passed, and stale processing claims ready for recovery. `Started` / `Not Started` refer to whether `refundStatus` has been written; they do not mean money is or is not owed.

All filter state is persisted in URL search params — copy-pasting the URL reproduces the exact view. Filters reset pagination to page 1.

## Status Badges
| Status | Badge Label | Visual |
| --- | --- | --- |
| `draft` | Draft | Muted secondary |
| `funding` | Funding… | Secondary with pulse animation — internal wallet recovery state |
| `pending_internal_review` | Pending Review | Amber outline — public launch awaiting the pre-assignment gate |
| `approved` | Setting up… | Secondary with pulse animation |
| `creating` | Creating… | Secondary with pulse animation |
| `paused` (with `launchedAt`, no `activatedAt`) | Pending Activation | Amber outline — admin-created campaign built and awaiting activation |
| `paused` (without `launchedAt`) | Paused | Neutral outline — admin manually paused |
| `active` | Active | Primary (brand color) |
| `rejected` | Rejected | Destructive outline — rejected at the gate or by a failed post-approval setup |
| `completed` | Completed | Muted secondary |
| `cancelled` | Cancelled | Destructive |
| `failed` | Failed | Destructive |

Two states carry an amber “awaiting review” treatment for two different gates. `pending_internal_review` is a **funded public launch** parked at the pre-assignment gate — no ad account assigned or Google resource exists, but the wallet debit is complete — where the operator approves or rejects the generated setup. `paused` with `launchedAt` is an **admin-created** campaign already on the platform, awaiting first-time activation. The `paused` status uses `launchedAt` to distinguish campaigns awaiting first-time admin review from campaigns that were manually paused after being active. `funding` is not a review gate; it is the short-lived recovery state before the debit finalizes.

Ad disapproval is not a lifecycle status. When the backend policy poller finds any related ad with Google `approval_status = DISAPPROVED`, the table and detail header show a separate destructive badge (`Ads disapproved · {topic}`) next to the normal status badge. This keeps an `active` campaign visibly active in Hellyeah while still surfacing that Google has stopped one or more ads from serving.

Google account-budget health is a separate campaign-detail signal, not an ad-policy signal. For launched Google campaigns, the backend reads the live approved Google account budget and compares it with the required account cap from active/paused reserved spend on the ad account. The detail page shows approved cap, amount served, required cap, missing cap, pending proposal, and the latest upward budget-adjustment row so operators can distinguish ad disapproval from account-budget exhaustion.

## Actions

Campaign actions require `write`, `admin`, or `owner` role. Read-only users see the campaign table without the actions column.

Available actions depend on the campaign’s current status:
| Current Status | Action | Effect | Surface |
| --- | --- | --- | --- |
| `pending_internal_review` | Approve for Assignment | Assigns an ad account, runs the setup saga (preflight → create PAUSED → finalize) with the existing submit debit, and **auto-activates** — no second review gate. Opens the pre-assignment review screen first | Detail screen — see Pre-Assignment Review |
| `pending_internal_review` | Reject… | Transitions to `rejected` with a reason and fix, then immediately attempts a full refund of the submit debit | Detail screen — dialog with reason field |
| `rejected` | Re-open for Review | Requires the prior refund to be complete, clears the rejection verdict and staged account, creates a fresh debit, and returns through `funding` to `pending_internal_review` | Dropdown — wallet debit may fail |
| `rejected` | Cancel Campaign… | Local-only withdrawal to `cancelled` — no platform teardown and no new refund; the rejection refund remains settled or retrying | Dropdown — dialog with optional reason |
| `paused` | Approve Campaign | Transitions to `active` — ads start serving (admin-created path) | Dropdown — immediate |
| `active` | Pause Campaign | Transitions to `paused` — ads stop serving | Dropdown — immediate |
| `creating` | Mark as Failed… | Transitions to `failed`, triggers immediate refund of reserved budget | Dropdown — dialog with reason field |
| `active` / `paused` | Cancel Campaign… | Transitions to `cancelled`, removes from platform. A never-activated (pending-review) campaign refunds the reserved budget immediately; an activated campaign refunds after the 48-hour settlement window | Dropdown — dialog with optional reason |
| `active` / `paused` | Rename Campaign | Updates the campaign name on the ad platform and in Hellyeah | Inline pencil on the detail header — see Campaign Detail |

Approve for Assignment, Approve Campaign, and Resume Campaign are blocked when the Google account budget is not ready. The backend checks the live approved account cap before enabling Google; insufficient caps, pending Google proposals, ad accounts with automatic budget management disabled, and `manual_required` / `rejected` / `failed` upward budget-adjustment states surface as actionable errors and keep the campaign paused. On the pre-assignment path, if the account-budget cap is still pending when the setup saga reaches auto-activation, activation is deferred and the campaign stays paused until the cap approves — the setup already exists, so this is a wait, not a rejection.

If an ad account cannot be assigned when the operator approves a `pending_internal_review` campaign — the pool is empty (org waitlisted) or the org’s account is unhealthy — the approval does not fail into a rejection. The campaign stays funded in `pending_internal_review` with an actionable message, and the operator retries once capacity frees. Approval does not apply a second wallet floor because submit already secured the full budget.

A `rejected` campaign is recoverable from the ops dashboard rather than a dead end. **Re-open for Review** is available only after the rejection refund completes. It clears the rejection reason and staged ad account, creates a fresh wallet debit, passes through `funding`, and returns to `pending_internal_review` after that debit succeeds. This is the recovery path when a rejection was not the customer’s fault: the assigned ad account was suspended on Google, or a transient failure surfaced during the approval saga. **Cancel Campaign** instead withdraws a rejected request locally to `cancelled`; it preserves the existing refund state and never credits the same debit again.

Destructive actions (Mark as Failed, Cancel) require confirmation through a dialog. The dialog explains the consequences and captures a reason for the audit trail.

## Pre-Assignment Review

Public launches ([`hellyeah campaign launch`](/cli/campaign)) place the single human review gate **after wallet funding but before ad-account assignment**. Submit debits the wallet, then creates the resting `pending_internal_review` state with no ad account or Google resource. This is the only sign-off on the public path — approval assigns an account, runs the setup saga without a second debit, and auto-activates, so there is no later paused gate.

The review screen renders the full generated setup from the campaign row so the operator can verify everything before Hellyeah commits pool capacity or creates Google resources. The wallet budget is already funded:
- **Setup preview** — name, budget (amount and type), targeting (keywords, locations, languages, demographics), final URL, ad copy (headlines and descriptions), and image assets.
- **Captured dry-run result** — the read-only precondition report snapshotted at submit time, showing each gate’s pass/fail state exactly as the launch recorded it.
- **Calendar window** — the buffered Google campaign window (active delivery window plus the review/setup buffer) captured at submit, so the operator sees the dates Google will receive.

Two decisions are available:
- **Approve for Assignment** — assigns an ad account from the pool, moves the campaign to `creating` (building platform resources), runs the launch saga (`validateOnly` preflight → create the Google campaign PAUSED → finalize) with the existing submit debit, then auto-activates it. A post-approval `validateOnly` or creation failure moves the campaign to `rejected` with a user-visible reason and fix, then refunds the submit debit.
- **Reject** — moves the campaign to `rejected` with a reason and fix captured for the customer, then immediately attempts a full refund. An uncertain credit remains attached to the terminal verdict and retries automatically.

## Campaign Detail

Clicking a row in the campaign table navigates to `/campaigns/[id]`, showing the full campaign record in a two-column layout.

### Header

Breadcrumb (`Campaigns > {name}`), campaign name, status badge, platform badge, platform campaign ID (if launched), and an actions dropdown (same actions as the table, minus “View Details” since you’re already on the page).

For `active` and `paused` campaigns, operators with `write`, `admin`, or `owner` role see a pencil icon next to the campaign name. Clicking the pencil swaps the heading for an inline input pre-filled with the current name. `Enter` saves, `Escape` cancels, and clicking outside cancels (suppressed during an in-flight save). The save button is disabled while the input is empty, unchanged, or fails the shared `campaignNameSchema` (trimmed, 1–255 characters). Duplicate-name conflicts surface inline below the input — the editor stays open so the operator can correct without re-opening — while other failures close the editor and emit a toast. On success the heading and breadcrumb refresh from cache, and an audit entry is recorded server-side.

For `active` and `paused` **Google Search** campaigns, an “Edit Setup” button appears in the header. Clicking it opens a right-side Sheet for editing live platform setup: add/remove keywords (single or batch import), edit RSA headlines and descriptions inline, toggle individual ads on/off, and replace the campaign final URL. All changes are staged locally and submitted as a single batch with a required operator rationale. The sheet fetches live Google Ads state on open, shows character counters and validation, and reports a specific success summary (e.g. “Added 2 keywords, paused 1 ad”). Unsaved changes prompt a discard confirmation. RSA ads with pinned assets show a locked state. Display campaigns do not show this button.

### Left Column
| Section | Content |
| --- | --- |
| **Budget** | Allocated (reserved amount or budget amount), Spent, Remaining — displayed as currency with a spend progress bar. Shows budget type (daily/total) and service fee percentage |
| **Targeting** | Schedule (start–end dates), keywords as badges, locations, languages, demographics (age ranges, genders). Read-only — keyword editing is done via the “Edit Setup” sheet |
| **Ad Copy** | Headlines and descriptions as distinct rows, final URL (external link), display path, call-to-action badge, image thumbnails grid, video links. Read-only — copy editing is done via the “Edit Setup” sheet |
| **Ad Approval** | Synced Google ad rows with ad ID, ad type, approval/review status, policy topic badges, and last sync timestamp. Hidden until a campaign has synced ad policy rows |

### Right Column
| Section | Content |
| --- | --- |
| **Account Budget Health** | Live Google account-budget health for launched Google campaigns — approved cap, amount served, required cap, missing cap, pending proposal, latest upward adjustment status, and manual/rejected reason when available |
| **Ad Account** | The platform account running the campaign — account name, platform account ID (monospaced), and account status badge. Empty until an account is assigned, which on the public path happens at approval |
| **Timeline** | Vertical timeline of lifecycle events: Created → Reviewed (public path: `reviewedAt`, approve or reject) → Launched → Activated → Completed/Cancelled/Failed. Shows `failedAt` timestamp for failed campaigns and the reason/fix in a destructive callout (including `rejected`) |

### Actions on Detail Page

The same `CampaignActions` dropdown is available (Approve, Pause, Cancel, Mark as Failed) with the same role gating and confirmation dialogs. Status changes on the detail page automatically refresh the displayed data.

The “View Details” action appears in the table’s dropdown menu for every campaign status, providing a second way to navigate to the detail page alongside row clicking.

## Dependencies
| Module | What Campaigns needs |
| --- | --- |
| [**Managed Ads**](/managed-ads) | Campaign list API, status update API |
| [**Managed Ads: Campaign Lifecycle**](/managed-ads/campaign-lifecycle) | Status transition rules and refund logic |
| [**Payments**](/shared/payments) | Refund processing (triggered server-side on fail/cancel) |

## Key Contracts

### API Endpoints
- **List campaigns** — `GET /api/admin/managed-ads/admin/campaigns`. Supports query params: `search`, `status` (single, backward compat), `statuses` (comma-separated multi-select), `pendingReview`, `campaignType`, `platform`, `userOrgId`, `budgetMin/Max`, `totalBudgetMin/Max`, `spendMin/Max`, `utilizationMin/Max`, `createdAfter/Before`, `launchedAfter/Before`, `hasRefund`, `page`, `limit`. When both `statuses` and `pendingReview` are present, they are combined with OR — the response is the union of campaigns matching either filter. All other filters AND together. Returns campaigns with `campaignType`, `refundStatus`, `failureReason`, ad-policy aggregate fields (`adsDisapproved`, `disapprovalTopics`), and a `counts` object (`{ all, pendingReview, failed, active }`).
- **Get campaign** — `GET /api/admin/managed-ads/admin/campaigns/:id`. Returns full campaign details including ad account info (`platformAccountId`, `platformAccountName`, `status`; null until assignment, which on the public path happens at approval), lifecycle timestamps (`reviewedAt`, `activatedAt`, `launchedAt`, `completedAt`, `cancelledAt`, `failedAt`), budget reservation (`reservedAmount`), failure/notes metadata (including the reason and fix on `rejected`), ad-policy aggregate fields (`adsDisapproved`, `disapprovalTopics`), synced per-ad policy rows (`ads[]`), and `accountBudgetHealth` for launched Google campaigns. `accountBudgetHealth.status` is one of `healthy`, `insufficient_cap`, `pending_proposal`, `manual_required`, `rejected`, or `unavailable`.
- **Update status** — `POST /api/admin/managed-ads/admin/campaigns/:id/status` with `{ status, reason? }`. Server validates transition rules, handles platform operations and refunds.
- **Rename campaign** — `PATCH /api/admin/managed-ads/admin/campaigns/:id/name` with `{ name }`. Available for platform-backed `active` and `paused` campaigns. Google Ads is updated before the local database; duplicate names return `409`, and non-platform-backed or non-renameable states return `422`.
- **Get campaign setup** — `GET /api/admin/managed-ads/admin/campaigns/:id/setup`. Fetches live Google Ads setup state (ad groups, ads with headlines/descriptions/status, keywords with match types). Returns `422` if the campaign is not editable.
- **Update campaign setup** — `PATCH /api/admin/managed-ads/admin/campaigns/:id/setup` with `{ keywordChanges?, adStatusChanges?, searchAdCopyReplacement?, searchFinalUrlReplacement?, reason? }`. Batches multiple edit types in a single request. Returns operation counts and refreshed setup state. Stale resources return `409`, unsupported edits return `400`.

### Notifications

When a campaign status changes, the API fires a `campaign/status.changed` Inngest event. The `notifyCampaignStatus` function resolves the customer’s messaging channel and delivers a notification (e.g. “Your campaign has been approved and is now live”).

### Comments
