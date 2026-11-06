---
source: https://hellyeah-v2-docs.vercel.app/shared/payments/spend-gating
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:41:07.115Z
---
# Spend Gating

> Durable, organization-scoped wallet allocation before campaign review or any other spend debit.

## Campaign Submit Flow

Public campaign submit always uses this durable debit path. Only a confirmed debit can enter `pending_internal_review`; approval uses that existing debit. See [Managed Ads Launch Flow](/managed-ads/launch-flow#submit-funding-contract).
1. Submit takes `FOR UPDATE` locks on the organization and its unique `stripe_customer_mapping` row.
2. The authoritative balance check subtracts every local `pending` `spend_debit` from the live Stripe balance.
3. If capacity is sufficient, the campaign enters the internal `funding` state and a `payments.transaction` row enters `pending` in the same database transaction.
4. The local transaction UUID produces the Stripe idempotency key. Stripe debit runs after the database commit.
5. The local payment transaction and campaign finalize atomically. Only a campaign with a confirmed Stripe balance transaction enters `pending_internal_review`.

The completed debit is the campaign’s committed budget. The pending transaction is only a short-lived technical allocation that closes the Stripe-call recovery window; there is no separate hold record.

## Available Balance Read Model

Wallet reads keep the Stripe ledger value and the local allocation value separate:

```
availableBalanceCents = max(0, balanceCents - pendingDebitCents)
```

`balanceCents` remains the raw normalized Stripe Customer Balance for API compatibility. `pendingDebitCents` is the sum of positive `payments.transaction.amount` values where `type = spend_debit` and `status = pending`. Customer-facing available-balance displays and launch preconditions use `availableBalanceCents`; they do not subtract the pending amount again.

A pending transaction remains unavailable until recovery marks it completed or failed. If Stripe committed a debit but the local finalize response was lost, this read can temporarily understate available funds until recovery converges; it fails closed instead of exposing the same cents to another campaign.

## Concurrency And Recovery

The unique wallet mapping row is the distributed per-org lock used by every API instance. Public submit, direct campaign launch, direct spend, and campaign budget increases all acquire this lock before the Stripe balance check. Budget-changing paths acquire the organization row before the wallet row so spend-cap and wallet locks have one order.

With a $100 balance, an $80 pending debit leaves $20 allocatable. A second $80 request is rejected with `availableCents: 2000` and `shortfallCents: 6000`, even when both requests run on different application instances.

The 15-minute recovery worker queries pending spend-debit transactions by type and status, oldest first. It replays Stripe with the original transaction-derived idempotency key and finalizes the campaign. Payments stores both that key and a SHA-256 operation fingerprint in Stripe balance-transaction metadata. The fingerprint covers signed amount, currency, description, and canonical caller metadata, so recovery can prove it found the same logical operation after Stripe’s request-key retention window.

## Other Spend Debits

`checkAndDebit(orgId, amountCents, { idempotencyKey })` requires a stable logical-operation key and uses the same database-backed wallet lock. A durable retry searches the customer’s Stripe history before taking the lock; a bounded newest-page lookup under the lock then closes the concurrent-create race. A key match is accepted only when the complete operation fingerprint also matches, otherwise Payments fails closed. A new operation subtracts pending spend-debit transactions before authorization, debits through `stripe.customers.createBalanceTransaction`, and records a best-effort local audit row. If the lock transaction’s close acknowledgement fails after Stripe has already returned, Payments keeps the known outcome. If funds are insufficient, it returns the exact available balance and shortfall.

Spend caps remain a Managed Ads policy control. Wallet serialization proves funds are available; per-campaign, daily, monthly, and cool-off caps independently decide whether that spend is allowed.

> **Stripe sign convention:** Diagrams use intuitive signs for readability. Stripe Customer Balance uses positive amounts for debits and negative amounts for credits. Payments normalizes this through `creditBalance` and `debitBalance`.

### Comments
