---
source: https://hellyeah-v2-docs.vercel.app/aima/brand-research
site_timestamp: 1785361273000
synced_at: 2026-08-05T01:38:50.381Z
---
# Brand Research

> Agentic brand research and business profile storage — the data layer behind onboarding.

## Team

@Yulong

## Purpose

Brand Research is the onboarding specialist’s brand extraction capability and the shared data layer for business profiles. The [onboarding specialist](/aima/specialists/onboarding) delegates brand research to a `brandResearcher` sub-agent that uses `exaDeepSearch` (~7s) for quick research and re-research of specific fields, with `webLookup` as a supplementary asset fallback. The sub-agent covers company overview, brand identity, target audience, value proposition, and brand voice — returning structured findings to the specialist.

After research, the onboarding specialist generates a visual brand preview page via `generateBrandPreview` — an HTML page with color swatches, logos, and formatted details uploaded to R2. The user receives a temporary CDN link to review their profile in a browser. The confirm/edit/re-research loop regenerates the preview link after every change.

Profile CRUD functions (`getBusinessProfile`, `upsertBusinessProfile`) live in `packages/db/` and are consumed by the API server, admin dashboard, and specialist agents. Zod schemas for profile data live in `@hellyeah/shared`.

Identity resolution (typo correction, brand name → domain, disambiguation) is the [onboarding specialist’s](/aima/specialists/onboarding) job — it uses LLM intelligence and `exaSearch` (Exa auto search, ~1s) to verify the business before delegating research.

## Stack
| Layer | Technology |
| --- | --- |
| **Research** | `brandResearcher` sub-agent using `exaDeepSearch` (~7s) for quick research and re-research, `webLookup` (supplementary asset fallback). |
| **Preview** | `generateBrandPreview` — HTML preview page uploaded to R2, temporary CDN link (1 hour) |
| **Storage** | PostgreSQL via Drizzle (`@hellyeah/db`) — `business_profile` table in `identity` schema |
| **Validation** | Zod 4 schemas (`@hellyeah/shared`) |

## Package

There is no standalone package for brand research. The onboarding specialist agent performs research directly. Profile persistence and queries live in the database layer, with an API module for brand endpoints:

```
packages/db/src/schema/
├── identity.ts           # business_profile table definition

packages/db/src/queries/
├── business-profile.ts   # get, upsert, getByDomain queries

packages/shared/src/schemas/
├── brand.ts              # Zod schemas for profile input/output

apps/api/src/modules/brand/
├── ...                   # Brand API endpoints (admin dashboard, profile CRUD)
```

## How It Works

### Research + Extraction

The onboarding specialist performs brand research after the user confirms identity:
1. **Check existing profile** — The specialist calls `getBrandProfile` to check if the user’s own org already has a profile (e.g. from a previous incomplete session). If found, the existing data is used and research is skipped.
2. **Delegate to brand researcher** (no existing profile) — The specialist delegates to the `brandResearcher` sub-agent with the confirmed domain and business name.
3. **Search** — The brand researcher uses one of two modes: “quick research” via `exaDeepSearch` (~7s, default first pass) or “re-research [field]” via `exaDeepSearch` (~7s, targeted follow-up). `webLookup` supplements both modes as a fallback for assets.
4. **Structured findings** — The brand researcher returns structured findings covering business name, domain, industry, description, brand personality, target audience, value proposition, and brand colors.
5. **Save draft** — The specialist immediately calls `saveBrandProfile` to persist the findings as a draft. This ensures nothing is lost if the user leaves mid-flow.
6. **Generate preview** — The specialist calls `generateBrandPreview` to create an HTML preview page with color swatches, logos, and formatted details. The page is uploaded to R2 and a temporary CDN link (1 hour) is returned.
7. **Present to user** — The specialist presents a text summary alongside the preview link and asks for confirmation and goal selection. The confirm/edit/re-research loop saves and regenerates the preview after every change.

### Profile Reuse

When resuming a session, the specialist checks if the user’s org already has a profile from a previous attempt. If found, the existing data is reused and research is skipped. Each org always gets its own research — there is no cross-org data sharing.
| Concern | Strategy |
| --- | --- |
| **Same org, repeated access** | Profile hit — read from `business_profile` table by `userOrgId` |
| **Brand data refresh** | Manual trigger from admin dashboard or agent tool. Re-runs agentic research, overwrites curated fields. Updates `lastResearchedAt`. |
| **Partial extraction** | If research yields sparse data, curated fields are partially filled. The onboarding specialist asks follow-up questions for missing fields. |

### Dependency Injection

Profile queries take a Drizzle `db` client as a parameter — they never construct their own database connection:
- **AIMA agent tools** — the API server passes `db` when wiring up tools
- **API server routes** — passes `db` from the shared Drizzle client
- **Tests** — pass a test database client

## Scope

### In Scope
- Agentic brand research via `brandResearcher` sub-agent (`exaDeepSearch` for quick research and re-research, `webLookup` supplementary)
- Curated field extraction (brand assets + marketing context)
- Profile CRUD — get by org, upsert

### Out of Scope
- Identity resolution (typo correction, brand name → domain) — [onboarding specialist](/aima/specialists/onboarding) handles this agentically
- Onboarding conversation flow — [onboarding specialist](/aima/specialists/onboarding)
- Working memory sync — the specialist syncs curated data after writing to DB
- Logo/image hosting — stores discovered CDN URLs; brand preview pages upload to R2 via `generateBrandPreview`
- Ad creative generation — [Creative Specialist](/aima/specialists/creative) consumes brand profile data

## Dependencies

### Needs
- **Database** — PostgreSQL via Drizzle (`@hellyeah/db`) for the `business_profile` table
- **Shared schemas** — Zod 4 types from `@hellyeah/shared`

### Provides (other modules consume)
- **`getBusinessProfile(db, userOrgId)`** → API server (admin dashboard endpoints), campaign specialist, creative specialist, reporting specialist
- **`upsertBusinessProfile(db, userOrgId, data)`** → Admin dashboard (manual profile edits), onboarding specialist

## Key Contracts

Profile queries are **functions, not a service**. They export pure functions that take a `db` client and return typed results. No HTTP server, no background jobs, no event bus.

The `business_profile` table is the canonical store. [Working memory](/aima/memory#working-memory--business-context) holds a synced copy for agent context — the onboarding specialist writes to the DB first, then syncs to working memory. If working memory is stale, it rebuilds from the relational table.

### Comments
