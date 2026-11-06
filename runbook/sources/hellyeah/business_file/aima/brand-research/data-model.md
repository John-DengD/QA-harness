---
source: https://hellyeah-v2-docs.vercel.app/aima/brand-research/data-model
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:38:52.447Z
---
# Data Model

## Tables
| Table | Key Columns | Notes |
| --- | --- | --- |
| **business_profile** | `id`, `userOrgId` (unique FK), `businessName`, `websiteUrl`, `industry`, `description`, `brandColors` (JSONB), `logos` (JSONB), `targetAudience`, `mainGoal`, `tone`, `valueProposition`, `researchMetadata` (JSONB), `lastResearchedAt`, `createdAt`, `updatedAt` | One per org. Created on onboarding completion. `userOrgId` unique constraint enforces 1:1. |

### Column Groups

#### Identity (user-provided or extracted)
- **`userOrgId`** — FK to `identity.user_org`, unique constraint, cascade delete.
- **`businessName`** — Display name. May differ from `user_org.name` (the account name).
- **`websiteUrl`** — The domain provided during onboarding. Nullable. Also serves as the cache key for research lookups.
- **`description`** — Short brand summary. Sourced from web research (homepage content, search results).

#### Brand Assets (from agentic research)
- **`brandColors`** — JSONB array: `[{ hex: "#ff0000", type: "brand", brightness: 127 }, ...]`. Types: `brand`, `accent`, `dark`, `light`. Brightness (0–255) enables the creative engine to check text contrast.
- **`logos`** — JSONB array: `[{ theme: "light", type: "logo", formats: [{ src, format, width, height }] }, ...]`. Multiple variants (icon, logo, symbol) in multiple themes (dark, light) and formats (SVG, PNG, WebP).

#### Marketing Context (from agentic research + user input)
- **`industry`** — Extracted from web research (company descriptions, industry directories) or user input. Free-form text.
- **`targetAudience`** — Free-form description of the ideal customer. Extracted by LLM analysis of homepage content, or asked during onboarding if extraction fails.
- **`mainGoal`** — Primary marketing objective (free-form text). Always user-provided — this is a business decision, not something the agent guesses.
- **`tone`** — Brand personality: professional, friendly, bold, premium. Extracted by LLM analysis of homepage content, or asked during onboarding.
- **`valueProposition`** — What differentiates the business. Extracted by LLM analysis of hero text and headlines, or asked during onboarding.

#### Research Metadata
- **`researchMetadata`** — JSONB object storing metadata about the research process: sources consulted (Exa citations), confidence signals, and any notes from the research pass. Useful for understanding extraction quality.
- **`lastResearchedAt`** — Timestamp of the most recent research pass.

## Relationships

`business_profile` has a strict 1:1 relationship with `user_org` — created when onboarding completes, deleted when the org is deleted. The presence of a row means onboarding is complete. The profile has no direct relationship to `user` — it’s org-scoped, not user-scoped. Any member of the org benefits from the profile context. When two orgs share a domain, the second org gets a copy of the curated fields (independent edits, no cross-org side effects). When the admin dashboard updates curated fields, working memory syncs lazily on the next agent turn.

## Data Flow
1. The onboarding specialist delegates to the `brandResearcher` sub-agent with the confirmed domain and business name.
2. The brand researcher uses tiered Exa search (quick ~7s, deep ~60s, or re-research ~7s) with `webLookup` as a supplementary asset fallback, and returns structured findings.
3. The onboarding specialist calls `generateBrandPreview` to create an HTML preview page uploaded to R2, returning a temporary CDN link.
4. On confirmation, the specialist calls `saveBrandProfile` to persist the profile to the database.
5. The specialist reports state transitions via `reportState` (structured tool-result data — the supervisor extracts it via `onDelegationComplete` and updates working memory).
6. All non-agent consumers read from the relational table via `getBusinessProfile()`.

## Downstream Consumers
| Consumer | Fields used | Why |
| --- | --- | --- |
| **Admin Dashboard** | Full profile | Display and edit org details |
| **Campaign Specialist** | `industry`, `targetAudience`, `mainGoal`, `brandColors` | Targeting defaults, budget recommendations |
| **Creative Specialist** | `brandColors`, `logos`, `tone`, `valueProposition` | On-brand ad creatives with correct colors and logo variants |
| **Reporting Specialist** | `industry`, `mainGoal` | Contextualize performance against business objectives |
| **Supervisor Agent** | Curated fields via working memory | Route intent, provide business context to specialists |

## File Locations

```
packages/db/src/schema/
├── identity.ts           # business_profile table definition

packages/db/src/queries/
├── business-profile.ts   # get, upsert, getByDomain queries

packages/shared/src/schemas/
├── brand.ts              # Zod schemas for profile input/output
```

### Comments
