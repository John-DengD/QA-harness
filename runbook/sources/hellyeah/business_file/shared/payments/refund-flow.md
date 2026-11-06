---
source: https://hellyeah-v2-docs.vercel.app/shared/payments/refund-flow
site_timestamp: 1785361273000
synced_at: 2026-08-05T01:41:09.471Z
---
# Refund Flow

> Credit campaign funds back to the wallet after review rejection, cancellation, or settlement.

## Flow
1. Campaign Manager calls Payments with the organization ID, refund amount in cents, and campaign ID
2. Payments credits the Stripe Customer Balance via `createBalanceTransaction(credit)`
3. Payments records a `refund` transaction in the audit log with the campaign ID in metadata
4. Payments returns the refunded amount and Stripe transaction ID to the caller

For the full cancellation and settlement flow that triggers this refund, see [Managed Ads Cancellation Flow](/managed-ads/cancellation-flow).

## Refund Contract

Managed Ads Campaign Manager calls `refund(orgId, amountCents, campaignId)` immediately when a funded campaign is rejected or withdrawn before any platform resource exists, or after spend settles for a platform-backed cancellation or completion. Payments credits the amount back to the Stripe Customer Balance and records a `refund` transaction for audit. Payments does not verify the refund amount or timing — the caller is responsible for both.

> **Scope boundary:** Managed Ads owns the cancellation decision, spend settlement timing, and refund calculation. Payments only executes the credit — it does not know about campaigns, ad platforms, or settlement status.

> **Stripe sign convention:** Diagrams use intuitive signs (`+25000` = credit) for readability. Stripe Customer Balance internally inverts this: positive amounts are debits, negative amounts are credits. The Payments service normalizes this via `creditBalance` / `debitBalance` helpers — callers never deal with Stripe sign semantics directly.

## Idempotency and Recovery

The synchronous review refund, admin refund endpoint, and `process-refunds` recovery resolve the same keys from the current durable debit transaction. When debit metadata has no stored keys, resolution falls back to `campaign_refund_<campaignId>` / `account_budget_refund_<campaignId>`. A re-opened request freezes new transaction-scoped keys in its debit metadata, so later-cycle refunds cannot replay an earlier credit while every retry within one cycle still converges.

Payments writes the key and a SHA-256 operation fingerprint into Stripe balance-transaction metadata. Before creating a credit, it walks the customer’s balance transactions for that key and validates the signed amount, currency, description, and canonical caller metadata through that fingerprint. A match returns the original Stripe transaction even after request-key retention expires; a mismatch fails closed. Campaign refund writes also compare the campaign’s current `reservedTransactionId` with the generation that started the attempt, so a late old-cycle worker cannot overwrite refund state after re-open.

### Stale processing recovery

An atomic CAS claim sets `refundStatus` to `processing` before the Stripe call. If the Stripe credit succeeds but the final `completed` status write fails, the row stays `processing` — it is intentionally **not** reverted to `failed`, because the Stripe refund is already durable and the `processing` lock prevents duplicate admin retries.

The `process-refunds` cron runs every 15 minutes and reclaims stale `processing` rows (stuck >15 min). It replays the refund with the same idempotency keys. Payments first reconciles Stripe metadata, so an earlier credit is returned instead of recreated and the row can reach `completed`.

> **Worst case:** a row can stay `processing` for up to ~30 minutes (one stale-claim threshold + one cron interval). During this window the Stripe result may be unknown locally. Recovery reconciles the original key before finalizing status, and the `processing` state prevents duplicate admin actions in the interim.

### Audit row dedup

The `transaction` table has a partial unique index on `stripeBalanceTransactionId` (where not null). `recordTransaction` uses `onConflictDoNothing` so stale-processing replays that re-enter the refund path do not insert duplicate audit rows — the insert silently becomes a no-op and the existing row is returned.

### Comments
