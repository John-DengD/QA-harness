---
source: https://hellyeah-v2-docs.vercel.app/shared/payments/top-up-flow
site_timestamp: 1785361273000
synced_at: 2026-08-05T01:41:04.895Z
---
# Top-up Flow

Two paths to add funds: **AIMA chat** (Stripe Checkout) and **Admin Dashboard** (direct credit).

## Flow 1: AIMA Chat (Stripe Checkout)
1. User requests top-up via AIMA chat
2. Payments validates the absolute `successUrl` and `cancelUrl`, then creates a Stripe Checkout Session with `threadId` and (optionally) `bridgeId` in metadata (Stripe-hosted payment form). The session is created with `allow_promotion_codes: true`, so users can redeem an active Stripe promotion code at checkout.
3. User completes payment on Stripe
4. Stripe redirects the user to the callback page (`CALLBACK_URL/billing/result?topup=success`) — a standalone page confirming Checkout completion. The actual balance credit happens asynchronously via the webhook below
5. Stripe sends `checkout.session.completed` webhook
6. Webhook handler validates signature, then calls `stripe.customers.createBalanceTransaction()` with a positive credit equal to `session.amount_subtotal` (the intended top-up before any promotion-code discount). See [Promotion Codes](#promotion-codes).
7. Local `transaction` table records the event for audit
8. If `threadId` is present in checkout metadata, the webhook handler sends a confirmation message directly to the user’s messaging channel via the Messaging Gateway
9. Webhook emits a `cv_purchase` event to X-Ray for ad funnel attribution — see [Conversion Event Emission](#conversion-event-emission)

## Flow 2: Admin Dashboard (Direct Credit)
1. Admin selects an organization in the Admin Dashboard
2. Clicks “Top Up”, chooses a preset amount ($50 / $100 / $250 / $500) or enters a custom amount ($0.50–$10,000)
3. Dashboard calls `POST /payments/credit` — **no Stripe Checkout Session, no webhook**
4. API resolves the Stripe Customer (creates mapping if first top-up)
5. Calls `stripe.customers.createBalanceTransaction()` directly with positive amount (credit)
6. Records transaction with `metadata: { source: "admin_direct" }` for audit trail
7. Dashboard shows success confirmation

> **Key difference:** Admin direct credit bypasses Stripe Checkout entirely — no payment form, no webhook. The credit is applied synchronously via the Stripe API. This is intended for internal operations only (admin-initiated, auth-gated).

## Webhook Handler

Endpoint: `POST /api/webhooks/stripe`

The webhook handler processes Stripe events for payment confirmation:
1. **Signature verification** — Validates the `Stripe-Signature` header against the webhook secret. Rejects invalid signatures with `400`.
2. **Event routing** — Handles `checkout.session.completed` events. Ignores unrelated event types.
3. **Idempotency** — Claims a “pending” slot via `UNIQUE(stripe_session_id)`. On duplicate, checks existing transaction status: skips if completed, defers if in-flight, re-attempts if stale (>5 min) or failed.
4. **Credit** — Calls `stripe.customers.createBalanceTransaction()` with `session.amount_subtotal` as a positive credit. Subtotal is used rather than total so that promotion-code discounts do not reduce wallet funding — see [Promotion Codes](#promotion-codes).
5. **Audit** — Records a `topup_credit` in the local `transaction` table with `amount = session.amount_subtotal` and Stripe session metadata.
6. **Payment notification** — For AIMA-initiated top-ups (checkout metadata contains `threadId`), the webhook sends a confirmation message to the user’s messaging channel via the Messaging Gateway. Dashboard top-ups (no `threadId`) skip this step. Notification is fire-and-forget — it never blocks the webhook response.
7. **Conversion event** — Emits a `cv_purchase` event to X-Ray with the revenue and currency from the session. See [Conversion Event Emission](#conversion-event-emission).

> The webhook is the only path that converts a Checkout Session payment into a Customer Balance credit. If the webhook fails, the payment is captured by Stripe but the balance is not credited — manual reconciliation would be needed. Google Ads account budget updates are separate from wallet top-ups and are driven by campaign required-cap changes.

## Google Account Budget Reconciliation

Wallet top-ups and admin credits do not change the assigned Google Ads account budget. Google account-budget reconciliation is driven by campaign state changes such as launch, budget edits, and repair discovery; refunds can still enqueue direct downward adjustments for cancellation and budget-decrease flows.
| Condition | Result |
| --- | --- |
| `ad_account.auto_budget_management_enabled = false` | Create `manual_required` adjustment for ops. |
| Auto enabled, existing main-account OAuth can manage budgets, USD account budget has no pending proposal | Submit `AccountBudgetProposal` with `proposalType = UPDATE`, then sync the submitted proposal status until Google reports a terminal state. |
| Existing pending proposal for the same Google account budget | Keep the request queued; the next worker pass can submit it after the in-flight proposal reaches a terminal state. |
| Non-USD account, no approved account budget, missing/insufficient OAuth access, permission error | Record failure reason and expose the adjustment in manual budget actions. |
| Retryable Google/API failure | Mark `failed`; the 30-minute worker retries. |

Google Ads account budgets are changed through `AccountBudgetProposalService`, so Hellyeah’s immediate guarantee is “proposal submitted or manual action recorded.” Google approval timing is outside the wallet flow and outside Hellyeah’s control; submitted proposals are synced asynchronously to `approved` or `rejected`.

## Checkout Session Metadata

`createTopUpSession` accepts two optional attribution fields that are attached to the Stripe Checkout Session metadata and relayed back to the webhook on `checkout.session.completed`:
| Field | Source | Purpose |
| --- | --- | --- |
| `threadId` | AIMA-initiated top-ups only | Identifies the messaging thread so the webhook can deliver a confirmation to the right channel, and so dashboard-initiated top-ups (no `threadId`) can be distinguished from chat top-ups. |
| `bridgeId` | Present when the user originated from an AIMA ad landing page | Forwarded from AIMA’s `RequestContext` (see [Gateway Integration · Ad Funnel Attribution](/aima/gateway-integration#ad-funnel-attribution)). The landing page also emits a `hy_bridge_handoff` event through the public X-Ray browser API before navigating to WhatsApp. The webhook uses the same `bridgeId` as the `distinctId` on `cv_purchase` so X-Ray can recover the original anonymous landing touch for Meta attribution. |

Both fields pass through unchanged — Stripe persists them on the session and the webhook reads them from `session.metadata`. The dashboard direct-credit path never sets either field.

## Promotion Codes

AIMA-initiated Checkout Sessions are created with `allow_promotion_codes: true`, so users can redeem any active Stripe promotion code at the hosted payment page. Promotion codes and their discount rules are managed in the Stripe Dashboard; no Hellyeah-side configuration is required to enable or rotate a campaign.

Each Checkout Session references a single fixed Stripe Product supplied via the `STRIPE_WALLET_TOPUP_PRODUCT_ID` env var, provisioned per Stripe account and mode. Coupons that restrict to specific products in the Stripe Dashboard must list this product ID under **Applicable Products**, otherwise Stripe rejects the code with “It doesn’t apply to items in your order”.

A discounted top-up splits into two amounts on the Checkout Session:
| Field | What it represents | Used for |
| --- | --- | --- |
| `amount_subtotal` | Intended top-up amount before any discount. | Wallet credit (`createBalanceTransaction`) and local `transaction.amount`. |
| `amount_total` | Cash the user actually paid. | `cv_purchase.revenue` and the dollar amount in the user-facing payment confirmation message. |

The dashboard direct-credit path does not go through Stripe Checkout and therefore cannot redeem promotion codes — admin top-ups always credit the requested amount in full.

> **Why the split.** A promo like “topup50” (50% off a top-up) is a launch incentive: the user should still receive the full top-up they asked for, with Hellyeah absorbing the discount as a marketing cost. The wallet therefore tracks the gross top-up amount, while X-Ray and ad-network postbacks see the actual revenue Stripe collected. A redelivered webhook uses the same `session.amount_subtotal`, so idempotency is unaffected.

## Conversion Event Emission

Every completed top-up emits a `cv_purchase` event to X-Ray from the Stripe webhook. The event carries:
| Field | Value |
| --- | --- |
| `distinctId` | `bridgeId` when present, otherwise `userOrgId` — ensures the event is attributable to the ad click when the funnel originated from a landing page, and still carries org context on dashboard/organic flows. |
| `revenue` | `session.amount_total / 100` in the session currency — the cash actually collected. Diverges from the credited amount when a promotion code is applied (see [Promotion Codes](#promotion-codes)); without a promo code, subtotal and total are equal. |
| `currency` | `session.currency` (uppercased), defaulting to `USD`. |
| `metadata.type` | `initial` on the org’s first completed top-up, `top_up` on subsequent top-ups. Computed from the count of prior `completed` `topup_credit` transactions on the org (excluding the current session). |
| `metadata.stripeSessionId` | The Stripe Checkout Session id, for reconciliation. |

Emission is `fire-and-forget` — failures log a warning but never fail the webhook. See [X-Ray · SSOT Integration](/xray/ssot-integration) for how these events are picked up for postback.

For Meta purchase postbacks, the webhook event is only the start of the delivery chain. `identify-meta-purchase-postbacks` scans the bridge-linked `cv_purchase`, and `fire-meta-purchase` resolves attribution through X-Ray’s bridge-handoff lookup. If attribution or required Meta match fields are not available yet, the workflow returns `deferred`, sleeps for 15 minutes, and retries until the event is sent, fails permanently, or ages out of Meta’s 7-day website event window. The Meta client is configured with `META_CAPI_PIXEL_ID` and posts to `/{pixelId}/events`.

## Top-up Flow Contract

Organization member initiates top-up (via AIMA tool call `initiate_topup`). Payments creates a Stripe Checkout Session (hosted by Stripe) with the AIMA `threadId` and (optionally) `bridgeId` in session metadata. On successful payment, Stripe sends a `checkout.session.completed` webhook. The webhook handler validates the signature, credits the balance via `createBalanceTransaction()`, records the audit log, sends a payment confirmation to the user’s messaging channel (if `threadId` is present), and emits a `cv_purchase` event to X-Ray. Meta postback delivery happens later in Inngest, where the bridge handoff is resolved back to the landing-page browser touch before the final `/{pixelId}/events` call is made.

> **Stripe sign convention:** Diagrams use intuitive signs (`+10000` = credit) for readability. Stripe Customer Balance internally inverts this: positive amounts are debits, negative amounts are credits. The Payments service normalizes this via `creditBalance` / `debitBalance` helpers — callers never deal with Stripe sign semantics directly.

## Balance Query Contract

AIMA calls `check_balance` tool. Admin Dashboard reads the balance view. Both return the same shape: `{ stripeBalance, currency }` — balance in cents (USD). `stripeBalance` is read directly from the Stripe API and is the single source of truth.

### Comments
