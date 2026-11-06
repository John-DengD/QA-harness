---
source: https://hellyeah-v2-docs.vercel.app/xray/ssot-integration
site_timestamp: 1785361273000
synced_at: 2026-08-05T01:38:19.897Z
---
# SSOT Integration

> X-Ray provides conversion and revenue data. SSOT joins it with ad spend to compute campaign reports and route postbacks.

## Architecture

The relationship is pull-based: SSOT queries X-Ray’s API for conversion events and revenue, joins them with ads metrics from Managed Ads, and computes derived KPIs (CPC, CPA, ROAS, burn rate, trends). SSOT also polls X-Ray for new conversion events with click IDs to identify postback candidates.

SSOT

X-Ray

write

read

conversions, revenue,
stats

cv_* events
with click IDs

Collection Endpoint

Event Store

Query API

Report Query

Postback Identifier

X-Ray does not push data to SSOT. SSOT authenticates with the same `x-api-key` header used by all internal consumers.

## What X-Ray Provides

### Behavior Data
- Pageviews, custom events, sessions, and their metadata (URL, referrer, UTMs, click IDs, geo, device)
- Revenue and currency attached to events
- Session-level engagement (duration, bounce status, page count, scroll depth)

### Click IDs
- `gclid` (Google), `gbraid` (Google iOS app), `wbraid` (Google web-to-app), `fbclid` (Meta), `msclkid` (Bing), `ttclid` (TikTok), `li_fat_id` (LinkedIn), `twclid` (Twitter)
- Stored at the event level, inherited from the landing page URL across the entire session
- Click ID resolution on the conversion feed uses a 4-level COALESCE: event → other events in the same session → cross-session by `distinct_id` → cross-session by `visitor_id` (90-day lookback)

### Meta Matching Context
- `fbc` and `fbp` are stored at the event level alongside `fbclid`
- The tracker derives `fbc` only from a real `fbclid` or an existing `_fbc`, reads existing `_fbp` / `_fbc`, and generates `_fbp` when absent
- `GET /api/websites/:id/meta-attribution` is an env-scoped bridge-handoff lookup: it starts from the latest `hy_bridge_handoff` event for the external ID, uses that handoff session’s `visitor_id`, and resolves the latest pre-handoff Meta touch back to the canonical landing-page `pageUrl`, `ipAddress`, `userAgent`, `fbclid`, `fbc`, and `fbp`

### Hashed PII (Enhanced Conversions)
- `hashed_email` and `hashed_phone` — SHA-256 hashes from `identify()` data, stored on the session
- Exposed on the conversion feed alongside click IDs
- Enables Google Enhanced Conversions without a click ID (EC-only postbacks)

### Analytics
- Aggregate stats, dimension breakdowns, time series, active visitors
- Channel classification (19 GA4-aligned channels: paidSearch, organicSearch, paidSocial, organicSocial, display, direct, email, referral, etc.)
- Period-over-period comparisons

### Reports
- Funnels with step-by-step drop-off
- Cohort retention (day/week/month)
- User journey paths
- UTM breakdown
- Attribution across 7 dimensions (referrer, adPlatforms, utmSource, utmMedium, utmCampaign, utmContent, utmTerm) with revenue, first-touch or last-touch model
- Revenue aggregation by currency

## Key Endpoints SSOT Uses

SSOT calls three primary endpoints for its core functions (reports and postbacks). Additional endpoints are available if needed.
| Endpoint | What SSOT gets | Used for |
| --- | --- | --- |
| `GET /api/websites/:id/conversions` | Individual `cv_*` events with click IDs, revenue, currency. Cursor-paginated | Postback identification + report conversion count + revenue |
| `GET /api/websites/:id/stats` | Aggregate pageviews, visitors, visits, bounces, duration | Report traffic context |
| `GET /api/websites/:id/revenue` | Revenue by currency with total, count, average | Report revenue totals |

Additional endpoints available for future use:
| Endpoint | What it provides |
| --- | --- |
| `GET /api/websites/:id/metrics` | Breakdown by any of 25 dimensions |
| `GET /api/websites/:id/conversions/timeseries` | Conversion trends over time |
| `GET /api/websites/:id/meta-attribution` | Env-scoped bridge-handoff Meta matching context for later CAPI delivery |
| `GET /api/websites/:id/attribution` | First-touch and last-touch attribution with revenue |
| `GET /api/websites/:id/utm` | UTM source/medium/campaign performance |
| `GET /api/websites/:id/channels` | Channel-level traffic classification |

## Channel Postback Readiness

X-Ray stores the fields that ad platform postback APIs require. Google Ads delivery runs through the dedicated Postbacks runtime, not SSOT. Meta server delivery remains isolated to the AIMA-specific lanes: `identify-meta-purchase-postbacks` scans bridge-linked `cv_purchase` events and `fire-meta-purchase` delivers them as `Purchase`; `identify-meta-lead-postbacks` scans bridge-linked `first_message` events and `fire-meta-lead` delivers them as `Lead`; and `identify-meta-milestone-postbacks` scans the bridge-linked AIMA milestones `website_provided`, `strategy_confirmed`, and `budget_confirmed` before `fire-meta-milestone` delivers the corresponding custom Meta events. When X-Ray exposes `hashed_email` or `hashed_phone`, the Meta sender also threads them through as `em` / `ph` match keys. Browser-lane `PageView` and `Contact` still depend on the landing-page pixel implementation, not this repo. Other non-Google click IDs are still stored for later use but are not yet uploaded.
| Platform | Required Fields | X-Ray Data | Delivery Path |
| --- | --- | --- | --- |
| Google Ads (click-based) | `gclid` or `gbraid` or `wbraid`, conversion event, revenue, currency | Ready | Dedicated Postbacks |
| Google Ads (EC-only) | `hashed_email` or `hashed_phone` (no click ID needed), conversion event | Ready | Dedicated Postbacks |
| Meta CAPI (`Purchase`, bridge-linked) | `fbclid`, `fbc`, `fbp`, event, landing-page URL, user agent, IP, client timestamp | Ready | Dedicated purchase flow |
| Meta CAPI (`Lead`, bridge-linked) | `fbclid`, `fbc`, `fbp`, event, landing-page URL, user agent, IP, client timestamp | Ready | Dedicated lead flow |
| Meta CAPI (AIMA milestones, bridge-linked) | `fbc`, `fbp`, event, landing-page URL, user agent, IP, client timestamp | Ready | Dedicated milestone flow |
| TikTok Events API | `ttclid`, event, revenue, user agent, IP | Ready | Not yet |
| Microsoft UET | `msclkid`, event, revenue | Ready | Not yet |
| LinkedIn CAPI | `li_fat_id`, event, revenue | Ready | Not yet |

The collection endpoint captures click IDs from URL parameters on landing (including `gbraid` and `wbraid` for Google’s iOS app and web-to-app flows), stores Meta browser identifiers (`fbc`, `fbp`) on event rows, and validates `cv_`-prefixed event names against the fixed set of 13 conversion events. Click IDs on conversion events are resolved via a 4-level COALESCE that looks across session events and cross-session history. For Meta, the bridge-handoff lookup route starts from `hy_bridge_handoff`, uses `visitor_id` to recover the latest pre-handoff Meta touch, and returns the earliest event from that touch as the canonical landing context. When `identify()` has set hashed PII on the session, the conversion feed exposes `hashed_email` / `hashed_phone` and the Meta sender forwards them as `em` / `ph`. Google delivery uses the durable Postbacks scanner and delivery worker. Meta delivery uses dedicated X-Ray-backed identify -> fire paths: `identify-meta-purchase-postbacks` reads bridge-linked `cv_purchase` events, `identify-meta-lead-postbacks` reads bridge-linked `first_message` events, `identify-meta-milestone-postbacks` reads the AIMA milestones `website_provided`, `strategy_confirmed`, and `budget_confirmed`, and the matching `fire-meta-*` workflows keep deferred deliveries in Inngest until attribution resolves, a permanent failure occurs, or Meta’s 7-day website event window expires.

## Server-Side cv_purchase Emission

Not every conversion is fired from the client. The Stripe webhook in the API server emits `cv_purchase` directly via `@hellyeah/x-ray/server` when a top-up checkout completes — this is how AIMA-driven payments (landing page → WhatsApp → chat → Stripe Checkout) get a revenue event into X-Ray despite the conversion itself happening off-site.

Server-side emission uses a stable bridge ID (`distinctId`) that the landing page generates and threads through the funnel. The landing page makes the browser-to-server bridge explicit by enqueueing a `hy_bridge_handoff` event through the public X-Ray browser API immediately before navigating to WhatsApp, with `id = bridgeId` and no global `identify()` call. That handoff event rides the normal unload/sendBeacon path with the current `visitor_id`, `fbclid`, `fbc`, and `fbp`, while the same bridge ID also continues through `(hy:<token>)` in the WhatsApp prefill → message body → AIMA `RequestContext` → Stripe session metadata → webhook. `fire-meta-purchase` later uses that handoff plus `visitor_id` to recover the originating anonymous landing touch. When no bridge ID is present (dashboard top-ups, organic flows), the event still fires with `userOrgId` as the fallback `distinctId` for internal analytics, but it is not attributable to an ad click.

See [Payments · Top-up Flow · Conversion Event Emission](/shared/payments/top-up-flow#conversion-event-emission) and [AIMA · Gateway Integration · Ad Funnel Attribution](/aima/gateway-integration#ad-funnel-attribution) for the full flow.

### Comments
