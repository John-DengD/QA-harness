---
source: https://hellyeah-v2-docs.vercel.app/customer-dashboard
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:39:06.230Z
---
# Customer Dashboard

> Customer-facing operating console for profile setup, wallet, campaign status, and tracking analytics.

## Team

@Bharath

## Purpose

The Customer Dashboard gives a signed-in customer one place to manage their active organization. It reads org-scoped data from the public API, renders cached managed-ads metrics, and surfaces X-Ray analytics without exposing internal admin tools.

The dashboard is a presentation layer. API and service modules own tenant authorization, campaign state, wallet accounting, and analytics contracts.

## Stack
| Area | Technology |
| --- | --- |
| App | Next.js 16 App Router, React 19 |
| UI | Tailwind v4, `@hellyeah/ui` chart primitives |
| Data | Hono RPC via `@hellyeah/api/rpc`, TanStack Query |
| Auth | Clerk user session and organization context |

## Package

```
apps/dashboard/
  src/app/             Route shells and API proxy
  src/components/      Shell, providers, org switcher
  src/data/            Typed RPC hooks, adapters, preview fixtures
  src/features/        Dashboard, campaigns, tracking, wallet, onboarding
packages/ui/
  src/components/      Shared chart and UI primitives consumed by the dashboard
```

## Scope

### In Scope
- Active organization selection across Clerk-backed and legacy organizations, plus creating a new organization and sending dashboard-directed member invitations from the switcher
- Brand profile and onboarding status
- Wallet balance, transactions, reservations, refund history, and top-up entry points
- Campaign list, campaign detail, metrics, pause, resume, and cancel controls
- Studio reference gallery and asynchronously generated copy, landscape, and square creative sets
- Overview metrics from managed ads and X-Ray sessions/visitors
- X-Ray tracker setup, tracking overview, funnel, breakdown, and raw event views
- Per-user notification preferences for broad opt-out, delivery channels, and topics
- Integrations overview with Stripe Revenue Connect status and CLI callouts
- Preview fixtures for local and review environments

### Out of Scope
- Deleting an organization. The API does not consume Clerk’s `organization.deleted` event, so a deleted org would keep its row, its wallet, and its campaigns while disappearing from Clerk. Clerk requires the creator role to hold `org:sys_profile:delete`, so the Settings screen hides the danger section instead of revoking the permission. Hiding the control also hides “Leave organization”, and it does not stop the Clerk API from destroying an org directly.
- Internal campaign approval and ad-account operations
- Customer or user administration across organizations
- Direct database reads from the browser app
- X-Ray ingestion or analytics query ownership

The dashboard presents customer actions and state while the API owns authorization, organization scope, and operational contracts.

## Core Components
| Component | What it does |
| --- | --- |
| Org provider | Resolves active org from explicit selection, stored selection, server identity, then first membership. Clerk-backed org switching calls Clerk `setActive`; legacy orgs remain selectable but render `org_not_connected` states where required. |
| API proxy | Forwards `/api/proxy/api/v1/*` requests to the API server with the user’s session. It rejects malformed decoded path segments before constructing the upstream URL. |
| Data hooks | Convert typed RPC responses into dashboard models. Hooks require a resolved org scope before calling org-scoped routes. |
| Overview | Joins managed-ads spend/value series with X-Ray sessions and visitors for trend charts. Date labels are UTC calendar days. |
| Tracking | Renders current tracker status, analytics overview, funnel, breakdown, and event feed. `no_tracker` is a first-class UI state. |
| Wallet | Shows available balance, reserved spend, completed refunds, and pending refunds separately. |
| Brand Profile | Shows the business context and brand assets saved during onboarding. Edit mode updates every researched text field, allows multiple logos to be uploaded and managed with one explicit primary, and adds brand colors only after the customer chooses both a color and its role. |
| Onboarding | Identifies work-email domains directly and uses name-based business candidates for personal email domains. Cached identify results that resolve to an email provider are discarded and fetched again. Manual website/email entries are format-validated inline, and the API rejects unreachable domains before research starts, so a typo domain fails fast instead of researching a look-alike brand. The review screen always shows the brand kit section; when research finds no kit, it offers logo upload and a color-and-role picker whose values persist on save. |
| Settings | Wraps Clerk profile/org management and Hellyeah-owned notification preferences. |
| Integrations | Renders the connected, revoked, and not-connected view of [Stripe Revenue Connect](/integrations/stripe). Merchants can connect (browser OAuth) and disconnect from the dashboard, with the CLI (`hellyeah stripe connect |
| Studio | Queues reference-led creative sets through 1 API request, shows queued rows immediately, polls while copy and image generation continue in Inngest, and lets customers cancel active generation or delete a finished Creative Set from its actions menu. |

## Dependencies

### Needs
| Module | What Customer Dashboard needs |
| --- | --- |
| [**API Server**](/api-server) | Public v1 routes, Clerk JWT auth, active-org header resolution, Hono RPC declarations |
| [**Managed Ads**](/managed-ads) | Campaign lifecycle, cached metrics, org overview metrics, refund state |
| [**Payments**](/shared/payments) | Wallet balance, reservations, transactions, top-up, refund history |
| [**X-Ray**](/xray) | Tracker status, analytics overview, sessions, funnels, breakdowns, raw events |
| [**Stripe Revenue Connect**](/integrations/stripe) | Read-only Stripe Connect state (account, mode, scope, linked X-Ray site, last event, last error) surfaced on Settings → Integrations |
| [**Shared UI**](/shared) | Chart and surface primitives used across dashboard views |

### Provides
- Customer self-service for campaign and wallet state
- A typed dashboard-facing API client that exercises public route contracts
- Preview data that mirrors live org, period, end date, and pagination inputs

## Key Contracts

### Organization Scope

The dashboard never invents tenant scope. It sends `X-Hellyeah-Org` only after the active org is resolved. Mutations use the same ready-scope boundary as reads, so org-scoped RPC calls cannot run while membership hydration is still pending.

Active organization resolution is deterministic: explicit user selection, valid stored org, server `/me.org`, then the first membership. Preview mode uses the same active-org context as live mode.

### Notification Preferences

Notification preferences are per user, not per organization. The Settings screen calls `GET /api/v1/notifications/preferences` and `PUT /api/v1/notifications/preferences`; the API persists explicit rows in `notifications.notification_preference` and returns defaults for any supported channel/category pair without an override. The current matrix supports campaign email notifications, and the dashboard provides both an individual row toggle and a broad control that updates every supported preference item together.

### Campaign Data

Campaign list hooks fetch all cursor pages with `limit=100` and return one merged campaign list model to callers. UI components do not know about pagination unless they own a paginated screen.

Campaign route bodies are part of the typed RPC contract. Launch, launch validation, and cancel request bodies are declared in the API metadata so client calls cannot drift from the server contract.

Every campaign the org submitted is visible in the dashboard, whatever its lifecycle state. Submissions waiting at the [internal review gate](/managed-ads/campaign-lifecycle) (`pending_internal_review`) and admin-created launches awaiting activation both present as pending review; `approved` campaigns still building their Google setup present as launching. Rejected campaigns keep a first-class rejected state with its own list filter, and the detail roadmap ends with the reviewer’s rejection reason, stamped with the admin review time, so the customer can see why and when, then resubmit. If a rejected campaign is later cancelled, the roadmap keeps the rejection milestone, reason, and review time ahead of the cancellation entry, so the “why” survives the status change.

Campaign detail actions follow the API’s `allowedActions` contract. Both a request in `pending_internal_review` and an admin-created `paused` campaign awaiting first activation expose **Cancel Campaign** as their only customer action; a campaign paused after activation can instead be resumed or cancelled. A `rejected` request also remains cancellable. A pre-assignment withdrawal has no platform teardown, but it immediately attempts a full refund because submit already debited the budget. Cancelling a rejected request preserves its existing refund state instead of promising or issuing another credit.

Campaign detail ad previews render by the campaign’s declared `campaignType`. Search shows RSA headlines and descriptions with the org’s primary brand-profile logo, falling back to the Hellyeah glyph when the profile has no usable logo or the image fails to load. Display shows image previews plus short headline, long headline, description, business name, and CTA fields. Performance Max maps the selected set’s landscape asset to wide placements and its square asset to square placements, then lists every headline, long headline, and description the asset group carries — headlines, not “short headlines”, since a Performance Max asset group has no short-headline asset. The logo is read from the current brand profile, not stored on the campaign draft.

Campaign detail summarizes who a campaign targets instead of echoing the stored targeting back: gender, age, location, and — on Search — keywords. A dimension carrying no narrowing reads as **All** or **Worldwide**, because Google models “everyone” as the absence of criteria, and the launch editor labels the same empty dimension that way; a fully enumerated set reads verbatim instead, since enumerating every option excludes Google’s undetermined segment and is genuinely narrower than everyone. Adjacent age buckets collapse into one range, and a long keyword or location list shows the first few behind a control that reveals the rest — the dashboard cannot edit targeting, so this card is the only place those values are ever visible. Performance Max never shows a keyword row: PMax sends no keywords to Google (see [PMax targeting](/managed-ads/launch-flow)), so rendering the ones a row may still store would advertise targeting that does not exist. Demographics stay on Performance Max, which does apply them. The budget reads as a property of the campaign rather than one of its metrics, so it sits on the identity line beside the platform and creation date — the total that spend counts against, or the daily rate it may not exceed.

New campaign drafts import generated creative with the brand profile website as the default landing page. Imported copy is trimmed to Google’s per-asset character widths (counting CJK characters as double-width) at import, so the preview and copy editor show exactly what will ship. For Performance Max the copy editor edits long headlines as a list, beside the headline and description arrays and bounded by the same [text asset registry](/managed-ads/launch-flow#creative-kit-registry) — an asset group serves several, and the one Google requires is only the floor. Import gives them their own full-width slots instead of word-trimming one into the narrower headline pool, so a long headline ships as it was written. Search still trims one into its headline pool, the only way that copy reaches an ad with no long-headline asset of its own. The placement mock beside the editor resolves its own headline, long headline, and description from those same arrays, so it tracks the copy the user is editing. Each placement caption names the assets that frame actually draws, with counts — `Headline 01/03 · Long Headline 01/02 · Description 01/02` — so a mock showing one asset out of several reads as a rule rather than a dropped edit, and a caption can never name copy the frame left out. Every multi-asset slot is counted, long headlines included: an uncounted label standing beside counted siblings reads as the only one the campaign has. The mock’s button carries Google’s own call-to-action wording: Google selects the call to action for Performance Max, and Hellyeah sends no call-to-action asset. User edits are never silently trimmed: the editor refuses a change that would exceed the weighted limit, while a restored over-limit draft stays visibly invalid and can be shortened until readiness passes. If the user edits creative copy or destination in the dashboard, the launch override preserves that landing page instead of falling back to a blank destination. A sparse or invalid edit — too few headlines, long headlines, or descriptions, duplicates, an over-limit asset, or a blank landing page — shows up as a failing ad-copy row in the readiness rail with one line per fixable item, and readiness rechecks as the user edits (see [Launch Flow → Dry-Run Validation](/managed-ads/launch-flow#dry-run-validation)).

Campaign targeting offers the same 50 common-country vocabulary the strategy agent uses, with Worldwide kept as an explicit no-location option. Locations also accept Google-targetable country, region, or city names outside that preset list; languages remain a fixed known vocabulary that the dashboard converts to Google language codes. Campaign names expose and enforce the API’s 255-character limit in the form. The budget field enforces the API’s maximum total the same way: a typed amount and the strategy agent’s proposal both clamp to the largest budget readiness accepts, so an over-cap value never reaches validation and the customer never sees a raw validation error in the readiness rail. The wallet balance is deliberately not a ceiling — being short is a fundable state the rail resolves with a top-up, so clamping there would block entering a budget the customer intends to fund.

The launch screen presents readiness as a sticky rail beside the draft on wide screens and as a compact summary after the editor on narrower dashboard layouts. The compact form stays in normal page flow and expands the checklist on demand; only the wide right rail is sticky. Initial validation reserves the checklist and wallet geometry with a reduced-motion-aware skeleton; subsequent draft edits keep the previous results visible but dimmed while debounced validation runs. A failed refresh keeps those results as stale reference, disables Launch and Top Up, and offers **Retry Check**. If the browser is offline, the rail names that paused state instead of presenting it as an active check, keeps the actions locked, and automatically rechecks when connectivity returns. The rail regroups the dry-run checks into customer-facing rows and never shows raw check ids: creative, ad copy, and budget are permanent rows so the checklist reads consistently — the passing budget row says “valid” rather than repeating the amount the funding strip already prices in — while schedule (a missing end date) and targeting are exceptional problems that appear only when failing, each sending its fix to the matching control rather than the budget field. Failing rows open folded sections as needed, move keyboard focus to the relevant control, scroll it into view, and add a reduced-motion-safe visual cue. A zeroed-out budget is a normal mid-edit state: validate accepts it and the full report still runs, so the other rows keep their real status while the budget row carries the floor message (the funding strip shows the balance alone until a budget exists, and the top-up shortcut waits for one). The ad-account capacity advisory (`reason: "capacity"`) is hidden — assignment is Hellyeah’s job at approval — while a health advisory on an already-assigned account (`reason: "account_health"`) stays visible as a non-blocking note. Wallet funding is a quantity, not a check, so it renders as a permanent fuel-gauge strip between the checklist and the footer: balance over required, a meter that fills orange while short and settles green once covered. While short, a secondary Top Up button carrying the exact gap stacks above Launch Campaign in the footer and opens the top-up dialog prefilled with that amount, clamped to the top-up bounds. Checkout locks synchronously once it starts, and after Stripe returns the rail keeps its actions disabled with **Confirming wallet top-up…** until the wallet refresh settles; a failed or timed-out confirmation releases the lock and gives the customer an actionable error.

Studio is a first-class dashboard destination directly below Brand. Its Creative Sets library shows queued and completed landscape/square pairs, while its Reference Gallery starts new reference-led generations. After selecting a reference, the user can optionally add a high-priority creative direction that guides copy and every image attempt; the reference keeps its overall layout family while the requested subject, mood, palette, styling, and execution details take priority. The direction is retained with the set. Selecting a set opens a read-only detail with the source reference, direction, both generated formats, matched copy, readiness, and the set’s UUID as subtle metadata beside the title. Each set can be deleted after a destructive confirmation, which removes it from Studio and campaign creative pickers. The legacy `/creatives` route redirects to Studio.

**Studio creation flow (local QA confirmation, 2026-09-28; not yet synced from the source site):** In the Studio library, **New Creative Sets** opens the brief-first creation sheet. The user enters a Brief and confirms it with the checkmark control named **Confirm Brief**, then chooses at least one reference. **Generate** stays disabled with no selected reference; once references are selected, its label includes the selected count (for example, **Generate 1 Set**). This flow replaces the older standalone Studio labels **New Creative Set**, **Continue To Style**, and a fixed **Generate Set** button. Use the target deployment's code and accessible names when testing a specific version. This confirmation covers the entry flow and generation gate only.

Performance Max drafts use one Import from Studio picker with Studio and Reference Gallery tabs. When Studio is empty, the popup shows four compact reference choices—Ramp accounting integrations, PostHog, Webflow, and Sentry Session Replay—and a Generate Set action. The starter is laid directly into the popup rather than inside a nested card. Queueing immediately replaces the picker with a “Waiting for your set to be ready” state while copy, landscape, and square generation continue in the background; the user can close the popup without cancelling the work. The user can otherwise select an existing set or choose one reference composition; Hellyeah then generates concise visual copy for native rendering independently from the campaign’s textual ad fields. The queued set also appears in Studio while it is processing. A set becomes selectable only after its matched landscape and square images are complete; the set id keeps both copy roles, the reference, and both image jobs together across refreshes. Square previews use their natural 1:1 frame without cover-cropping.

Completed set cards in the import popup show their landscape and square assets as a small overlapping card stack beside the creation date. The same stack appears on Search creative cards when the text job belongs to a generated set; standalone text creatives continue to show only their date. Hovering or keyboard-focusing the parent creative card gently fans the two image cards outward, with reduced-motion users retaining the static stack.

Search drafts use the same compact four-reference starter when no text creative exists. The popup explains that Search only consumes the generated text, while Hellyeah still creates the complete image set for reuse in future campaigns. Selecting a reference immediately shows the shared waiting state. Search copy becomes selectable as soon as its text job completes, without waiting for the matching images, which continue in the background. Existing Search creatives retain the searchable Studio list.

### Wallet Data

The wallet’s **Available Balance**, sidebar amount, and campaign readiness balance use the API’s `availableBalanceCents`: raw Stripe `balanceCents` minus local pending spend-debit transactions. Pending transactions are subtracted once in the Payments read model, so the dashboard never repeats that arithmetic.

Pending refunds are separate rows and separate money. They are visible in wallet history and `pendingRefundCents`, but they do not count as completed refunded money until the API reports them in settled refund transactions.

Wallet `Spent` summary cards use actual platform spend reported by campaign metrics, not wallet reservation debits taken at launch time.

### Tracking Data

`Sessions vs Spend` uses X-Ray visit/session series, not raw event counts. Page breakdowns preserve every pageview row and attach conversion attribution by landing page.

Tracker status requests run only for serving trackers and merge results by tracker id. A mismatched status response cannot update the wrong tracker.

### Charts

Chart labels represent UTC calendar days. Shared chart primitives keep clipping stable with `useId`-scoped clip paths so multiple charts can render on the same page without ID collisions.

### Comments
