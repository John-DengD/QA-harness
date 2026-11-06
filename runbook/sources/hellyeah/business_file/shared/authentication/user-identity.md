---
source: https://hellyeah-v2-docs.vercel.app/shared/authentication/user-identity
site_timestamp: 1785830543000
synced_at: 2026-08-05T01:41:00.602Z
---
# User Identity Service

> Platform identity resolution — messaging channel IDs and Clerk OAuth users mapped to internal user records with multi-tenant org context. Part of the [Authentication](/shared/authentication) module.

## How It Works

This is **not traditional authentication**. The upstream platform has already verified the user — WhatsApp verified their phone, and Clerk verified their OAuth sign-in. Our job is **identity resolution**: mapping an external user ID to an internal user record + organization context.

On every inbound message, the [Messaging Gateway](/api-server/messaging-gateway) calls `resolveIdentity(db, channel, channelUserId)` before routing to the agent. It returns the resolved user + org, or `null` for new users. The production WhatsApp channel triggers onboarding on first contact. The [Dev Chat](/api-server/messaging-gateway/dev-chat) adapter auto-seeds a user and dev org instead.

For [CLI](/cli/auth) and future web sessions, identity is provisioned through Clerk webhooks instead of inbound-message resolution: `user.created` creates or links the `identity.user` and `linked_identity (provider=clerk)`, merging with any existing user matching by verified email or phone. Clerk organization webhooks create and sync `user_org` membership for this path; `user.created` does not fabricate a personal org.

Resolution results are cached in-memory (LRU, 500 entries, 5-minute TTL) to avoid repeated DB joins on every message.

### Linking Multiple Platforms

Multiple platform identities can point to the same `user`. Adding a new platform means inserting a new `linked_identity` row — no schema changes:

## Data Model
| Table | Key Columns | Notes |
| --- | --- | --- |
| **user** | `id`, `name`, `email?`, `phone`, `createdAt`, `updatedAt` | Business users. Email optional for messaging-only users; populated when linked to Clerk. |
| **user_org** | `id`, `name`, `slug`, `clerkOrgId?`, `customerStatus?`, `metadata`, `createdAt`, `updatedAt` | One per business. All module data is scoped here. `clerkOrgId` set when synced from a Clerk organization. `customerStatus` tracks onboarding progress: `first_message`, `website_provided`, `strategy_confirmed`, `creatives_confirmed`, `budget_confirmed`, `top_up_complete`, `campaign_live`. |
| **user_member** | `id`, `userId`, `userOrgId`, `role`, `createdAt`, `updatedAt` | Role: `owner` or `member`. Unique on `(userId, userOrgId)`. |
| **linked_identity** | `id`, `userId`, `provider`, `providerUserId`, `verifiedAt`, `createdAt`, `updatedAt` | Maps external identities to one user. Provider: `whatsapp`, `dev`, `clerk`. Unique on `(provider, providerUserId)`. |
| **business_profile** | `id`, `userOrgId` (unique FK), `businessName`, `websiteUrl`, `industry`, `brandColors` (JSONB), `logos` (JSONB), `fonts` (JSONB), + more | One per org. Created on onboarding completion. Owned by [Brand Research](/aima/brand-research) — see [data model](/aima/brand-research/data-model). |

All tables live in the `identity` Postgres schema (`packages/db/src/schema/identity.ts`).

## Multi-Tenancy

Every user belongs to an organization. All business data — campaigns, ad accounts, billing — is scoped to `user_org` via `userOrgId`. The owner is the person who onboarded; they can invite members. Each organization has a [business profile](/aima/brand-research/data-model) — brand identity, audience, and goals collected during onboarding via [Brand Research](/aima/brand-research).

### Clerk Organization Backfill

Legacy CLI users may have a Clerk-linked `identity.user` and `linked_identity(provider='clerk')` without a Clerk-backed `identity.user_org.clerkOrgId`. Before enforcing Clerk-backed org membership, run the API backfill script for each environment:

```
pnpm --filter @hellyeah/api backfill:clerk-orgs
pnpm --filter @hellyeah/api backfill:clerk-orgs -- --commit
pnpm --filter @hellyeah/api backfill:clerk-orgs -- --verify-only
```

The script creates one Clerk organization per legacy internal `user_org`, stores that Clerk ID on the existing row, and mirrors linked members into Clerk organization memberships. It does not create one umbrella Clerk org for all legacy tenants.

Run the script first without `--commit` and deploy only after `--verify-only` returns no legacy Clerk-linked orgs without `clerkOrgId`. If an org has non-Clerk members, the script refuses to proceed unless `--allow-partial-memberships` is passed after manual review.

CLI recovery commands that must work even when the active stored org is stale, such as `hellyeah whoami` and `hellyeah org list`, intentionally skip the stored `X-Hellyeah-Org` header while still using the stored Clerk access token.

## File Locations

```
apps/api/src/messaging-gateway/
├── identity.ts      # resolveIdentity(), linkIdentity(), LRU cache

packages/db/src/schema/
├── identity.ts      # user, user_org, user_member, linked_identity
└── conversation.ts  # conversation (channel routing table)
```

### Comments
