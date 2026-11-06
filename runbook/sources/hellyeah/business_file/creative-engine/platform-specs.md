---
source: https://hellyeah-v2-docs.vercel.app/creative-engine/platform-specs
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:40:09.849Z
---
# Platform Specifications

> Format requirements for Google Ads

## Purpose

Validates creative assets against platform-specific requirements before bundle handoff to Managed Ads. Ensures all images, copy, and CTAs meet platform policies to prevent rejection during ad submission.

## Source of Truth

The per-platform registry lives in `@hellyeah/shared/specs/creative` (`PLATFORM_SPECS`) and is consumed by all three layers — Creative Engine validators, Managed Ads launch saga, and the API’s `--size` fan-out. The same registry also defines `campaigns[type].requires`, the kit recipe used by [Launch Flow](/managed-ads/launch-flow#creative-kit-registry) to reject incomplete creative kits before the wallet reservation, and `textAssets`, the multi-asset text counts and per-asset character limits enforced by the launch ad-copy schemas, the readiness check, and the dashboard editor — headline and description rules that Responsive Search Ads and Performance Max share, plus a long-headline rule that only Performance Max carries. The creatable recipes are Search and Performance Max; the Display recipe is retained as a legacy entry for existing campaigns. Adding a new platform is a registry-only change.

## Supported Platforms
- **[Google Ads](/creative-engine/platform-specs/google)** — Performance Max asset groups (1200×628 landscape, 1200×1200 square)

## Quick Reference
| Platform | Primary Dimensions | Max File Size | Copy Limits |
| --- | --- | --- | --- |
| **Google** | 1200×628 landscape, 1200×1200 square | 5MB | Short headline: 30, Long: 90, Desc: 90 |

## Validation

Creatives validated before approval:
1. Dimensions match platform aspect ratios
2. File size under platform max
3. Format is JPG or PNG
4. Copy within character limits

**Auto-fix:** Compress large files, truncate copy 1-2 chars over limit, convert formats **Requires regeneration:** Wrong dimensions, copy significantly over, policy violations

### Comments
