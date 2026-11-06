---
source: https://hellyeah-v2-docs.vercel.app/xray
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:38:05.844Z
---
# X-Ray

> Headless analytics server. Collects pageviews and custom events, resolves sessions, serves query APIs. The tracker script and [client SDKs](/xray/sdks) form the X-Ray half of the [Hellyeah SDK](/overview/products#hellyeah-sdk--developer-surface).

## Team

@Bharath, @Bing

## Purpose

X-Ray is Hellyeah’s analytics backend. No UI, no user accounts. A lightweight tracker script on the client’s website sends pageviews and custom events to X-Ray’s collection endpoint. The server resolves events into env-scoped sessions using a deterministic fingerprint (IP, user agent, device attributes), stores events and sessions in Postgres, and exposes a query API for analytics, funnels, retention, attribution, and revenue reporting.

X-Ray feeds SSOT as Source 1. User behavior data flows through here before SSOT joins it with ad spend and revenue metrics.

## Scope

### In Scope
- Tracker script (`script.js`) — injected on client websites, autocaptures pageviews, clicks, form submits, outbound links, web vitals
- Collection endpoint — unauthenticated event ingestion via `POST /api/send` and `POST /api/batch`
- First-party attribution cookie — `hy_attr` cookie stores click IDs, UTMs, and a persistent visitor ID across sessions (90-day TTL, opt-in)
- Session resolution — env-scoped deterministic SHA-512 fingerprint, no cookies required for basic tracking
- PII hashing — `identify()` email and phone are SHA-256 hashed server-side for Google Enhanced Conversions
- Website management — CRUD for registered websites and their tracker configuration
- Analytics queries — stats, metrics breakdowns, pageview time series, sessions, active visitors, GA4-aligned channel classification (19 channels, session-scoped first-touch)
- Reports — funnels, retention cohorts, user journeys, UTM breakdowns, attribution (first-touch and last-touch models), revenue aggregation
- Cross-dimension filtering — 25 filterable dimensions across all query endpoints
- Inference engine — maps raw autocapture events to conversion events (`form_submit` → `cv_lead_submit`)
- Client SDK (`@hellyeah/x-ray`) — multi-platform npm package for browser and server-side tracking
- Internal SDK (`@hellyeah/xray-sdk`) — Speakeasy-generated TypeScript SDK for service-to-service access

### Out of Scope
- Session replay
- Real-time event streaming to external systems
- Custom event builder UI
- User-facing dashboard (SSOT and Admin Dashboard own the presentation layer)

## Sub-modules
| Sub-module | What it does |
| --- | --- |
| [**Architecture**](/xray/architecture) | Service boundaries, data flow, auth model, key design decisions |
| [**Event Model**](/xray/event-model) | Event types, naming conventions, detection rules, inference mapping |
| [**Database**](/xray/database) | Four-table schema (website, session, website_event, event_data), indexes, design choices |
| [**API Reference**](/xray/api-reference) | 28 endpoints across 5 groups: Health, Collect, Websites, Analytics, Reports |
| [**SDKs**](/xray/sdks) | Client SDK and internal SDK |
| [**Operations**](/xray/operations) | Commands, environment variables, logging, quality gates |
| [**SSOT Integration**](/xray/ssot-integration) | Data X-Ray provides to SSOT, required metrics, channel postback readiness |
| [**Contributing**](/xray/contributing) | Onboarding, ecosystem map, generation loop, conventions, code review checklist |

## Dependencies

### Needs (consumes from other modules)
| Module | What X-Ray needs | Interface |
| --- | --- | --- |
| **Shared: DB** | Neon Postgres connection | `DATABASE_URL` env var (X-Ray uses its own database, not the shared one) |

### Provides (other modules consume)
- **Behavior data → SSOT.** User website events (pageviews, custom events, sessions, conversions)
- **Admin Dashboard.** Website CRUD, org-to-website linking, and analytics queries proxied through the API server via the internal SDK
- **Internal SDK** (`@hellyeah/xray-sdk`). Typed API access for any monorepo package
- **OpenAPI spec.** `GET /openapi.json` serves the live spec, consumed by Speakeasy for SDK generation

## Key Contracts

### Authentication
- **Public endpoints** (no auth): `POST /api/send`, `POST /api/batch`, `GET /api/config/:websiteId`, `GET /api/health`
- **Protected endpoints** (API key): pass `x-api-key` header with an `sk_xray_` prefixed key
- No user accounts, sessions, or RBAC. A single API secret gates all protected operations.

### Event Naming
- No prefix for autocapture events (`click`, `outbound_click`, `form_submit`)
- `hy_` prefix for tracker performance events (`hy_web_vitals`)
- `cv_` prefix for inferred conversion events (`cv_lead_submit`, `cv_purchase`, `cv_registration_complete`)
- snake_case, max 100 characters, no platform-specific names

### Collection Endpoint Contract

X-Ray’s collection endpoint is the only ingestion path. The tracker script and client SDK both POST to `/api/send` (single event) or `/api/batch` (queued flush). The server detects bot traffic and silently drops it. Soft-deleted websites silently reject events with a `200` response. The batch endpoint extracts email and phone from `identify()` payloads, hashes them with SHA-256 (NANP-aware phone normalization), and stores the hashes on the session for Enhanced Conversions.

## Project Structure

```
apps/xray/                → Analytics server (Bun + Hono)
  src/
    routes/               → API route handlers (health, collect, websites, analytics, reports)
    queries/              → SQL query builders (analytics, reports, websites)
    middleware/            → Request logging, auth, tracker config
    db/                   → Drizzle schema, client, migrations
    lib/                  → Shared utilities (geo, identity, openapi helpers)
    tracker/              → Client-side tracker script (vanilla JS)
    utils/                → Pure helpers (detect, filters, IP, URL parsing)
    __tests__/            → bun:test suites (PGlite for DB tests)
  scripts/                → Seed data, key generation, geo DB build
packages/xray-sdk/        → Internal SDK (Speakeasy-generated)
```

### Comments
