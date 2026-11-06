---
source: https://hellyeah-v2-docs.vercel.app/xray/event-model
site_timestamp: 1785830543000
synced_at: 2026-08-05T01:38:09.902Z
---
# Event Model

> Two event types, three naming tiers, deterministic conversion inference.

## Event Types

Events in X-Ray are one of two types:
| Type | `event_type` | Trigger | Has `event_name` |
| --- | --- | --- | --- |
| Pageview | `1` | Page load or client-side navigation | No |
| Custom Event | `2` | Tracker autocapture, manual `track()` call, or inference engine | Yes |

Pageviews carry an `env` tag, URL, referrer, and UTM data. Custom events carry the same fields plus an `event_name` and optional key-value properties stored in the `event_data` table (EAV pattern).

## Environment Tag

Every ingested event has an `env` tag. Missing `env` defaults to `prod` at ingest and storage, so existing production traffic stays in the production analytics view. The served tracker reads `data-env` from its script tag and sends `prod` when the attribute is absent.

Valid values are trimmed strings from 1 to 64 characters matching `/^[a-zA-Z0-9._-]+$/`. Reserved values are rejected case-insensitively: `none`, `null`, `undefined`, `true`, and `false`.

Event-backed analytics default to `env=prod`; pass `env=staging` or another valid value to query a non-production stream.

Session identity is scoped by `env` as well as website ID, so identify data and attribution state from staging traffic cannot merge into production sessions. A single batch request cannot mix `env` values; split prod and staging traffic into separate requests.

## Naming Convention

Event names follow a three-tier prefix system:
| Prefix | Source | Examples |
| --- | --- | --- |
| *(none)* | Tracker autocapture | `click`, `outbound_click`, `form_submit` |
| `hy_` | Tracker performance metrics | `hy_web_vitals` |
| `cv_` | Inference engine (conversions) | `cv_lead_submit`, `cv_purchase`, `cv_registration_complete`, `cv_add_to_cart`, `cv_begin_checkout` |

Rules:
- snake_case, max 100 characters
- No platform-specific names. Platform mapping (Google Ads, Meta CAPI, TikTok) happens in the postback layer
- Autocapture events have no prefix. They’re raw signals without business meaning until inference runs

## Autocapture Events

The tracker script fires these automatically when `autocapture` is enabled in the website config:
| Event | Trigger | Key Data |
| --- | --- | --- |
| `click` | Click on interactive elements (links, buttons, inputs, selects, textareas, elements with roles) | Tag, text, href, element attributes |
| `outbound_click` | Click on a link pointing to a different domain | URL, text |
| `form_submit` | Form submission | Form action, method, field count, field names (no values) |
| `hy_web_vitals` | Web Vitals collection (if `webVitals` enabled) | TTFB, FCP, LCP, INP, CLS |

The tracker also supports declarative tracking via `data-hy-event` attributes. Any element with `data-hy-event="signup_click"` fires a custom event on click, with optional `data-hy-prop-*` attributes for properties.

## Detection Rules

Autocapture is opt-in per website via the `autocapture` flag in the website config. When enabled:
- **Clicks**: detected on `<a>`, `<button>`, `<input>`, `<select>`, `<textarea>`, and elements with `role="button"`, `role="link"`, `role="tab"`, `role="switch"`, or `role="menuitem"`
- **Outbound clicks**: any `<a>` click where the `href` domain differs from the current page
- **Form submits**: `submit` event on `<form>` elements. Captures structure (field count, names) but never field values
- **DOM context**: when `domContext` is enabled, captures surrounding text and element hierarchy for richer click context

## Inference Mapping

The inference engine reads raw events via the API and writes back `cv_*` conversion events. Each inferred event gets a deterministic `hy_event_id` to prevent duplicates on re-runs.
| Raw Signal | Inferred Conversion | Conditions |
| --- | --- | --- |
| `form_submit` | `cv_lead_submit` | Form has an email field, action URL matches common lead patterns |
| `form_submit` | `cv_registration_complete` | Form has password fields, action URL matches auth patterns |
| Custom event with revenue | `cv_purchase` | `revenue > 0` and `currency` is set |
| `click` on cart element | `cv_add_to_cart` | Element matches cart/add-to-cart selectors |
| `click` on checkout element | `cv_begin_checkout` | Element matches checkout selectors |

Conversion events carry the original event’s properties plus enriched metadata. The inference engine maps raw autocapture signals to business-meaningful conversions that SSOT uses for attribution and postbacks.

### Comments
