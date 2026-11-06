---
source: https://hellyeah-v2-docs.vercel.app/aima/specialists/campaign
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:38:41.258Z
---
# Campaign Specialist

> Full campaign lifecycle — from plan to launch to ongoing management.

## Purpose

The campaign specialist owns everything between “I want to launch ads” and a running campaign. It calls [Managed Ads](/managed-ads) for draft management (`create_draft`, `update_draft`), execution (`launch_campaign`, `pause_campaign`, `resume_campaign`, `cancel_campaign`), and query (`get_campaign_status`, `list_campaigns`). It calls [Creative Engine](/creative-engine) for first-campaign creative generation. It presents smart defaults composed from the business profile, collects confirmations, handles funding gates, and manages ongoing campaign adjustments.

This is the specialist most users interact with immediately after [onboarding](/aima/specialists/onboarding) — the supervisor suggests “Want to launch your first campaign?” and routes here.

See [User Flow](/aima/user-flow) for the canonical end-to-end sequence — this specialist owns steps 5–6 (plan), step 9–10 (budget), and step 13 (launch).

## Module Relationships
| Module | Role | When called |
| --- | --- | --- |
| **Managed Ads** | Draft management (create, edit), lifecycle (launch, pause, resume, cancel), and monitoring (status, list) | `PLANNING` → `LAUNCH` → ongoing management |
| **Creative Engine** | Generates ad creative when launching a new campaign | `CREATIVE` — after plan confirmed |
| **Payments** (via [Billing Specialist](/aima/specialists/billing)) | Top-up when balance is insufficient | `FUNDING` — pre-launch gate |
| **Guardrails** | Spending guard blocks launch without confirmation + funds; topic guard redirects off-topic | All states |

## Conversation Design

The campaign specialist follows the same principle as onboarding: **smart defaults over questions**. Instead of asking “What’s your daily budget? What location? What age range?”, the specialist composes a campaign plan from the business profile and goal, then presents a pre-filled plan for the user to confirm or adjust.

### What AIMA Asks

Four discrete confirmations in the happy path — plan, creative direction, budget, and (conditionally) top-up. Budget is a **separate confirmation turn** from the plan; see [Budget as a Separate Confirmation](#budget-as-a-separate-confirmation) below.
| # | Input | Why it can’t be automated |
| --- | --- | --- |
| 1 | **Confirm/adjust plan** (no budget) | Channels, campaign type, objective, targeting, keywords — presented as editable defaults. Budget is not asked here. |
| 2 | **Creative direction approval** | Search picks two of four angle candidates; Performance Max picks a single concept. The creative specialist then persists a `creative_draft` that the campaign specialist retrieves via `getCreativeDraft`; generated copy/images are previewed only on request. |
| 3 | **Confirm/adjust budget** | Every plan uses a single total amount over a date range (a hard spend cap). Asked after the generated creative draft is saved, not bundled with the plan. At this step the specialist also discloses the active delivery window, the review/setup buffer, and the resulting Google campaign window, and asks whether the end date is a hard deadline. |
| 4 | **Top-up amount** (only if wallet balance insufficient) | Spending decision — handled by the [Billing Specialist](/aima/specialists/billing) with the amount pre-set to the confirmed budget (seamless handoff, no re-asking) |

### What AIMA Infers
| Signal | Source |
| --- | --- |
| **Campaign type** | Search by default; Performance Max on explicit visual or image intent |
| **Campaign template** | Managed Ads selects from goal + industry (acquisition, remarketing, reach) |
| **Total budget** | Industry benchmarks via Managed Ads |
| **Location targeting** | Explicit user location first; otherwise business/profile geography, audience market, website/domain clues, and research metadata |
| **Age range** | Audience signals from business profile enrichment |
| **Timezone** | Phone country code or location |
| **Currency** | Phone country code or location |
| **Initial budget suggestion** | Default `$70` total over the date range; adjusted from industry benchmarks |

### Campaign Type Decision

The campaign specialist chooses a campaign type instead of asking the user to pick. It supports two types: Search and Performance Max. Search is the default. Explicit user intent wins: if the user asks for Search, text ads, keywords, or people already searching, AIMA uses Search; if they ask for Performance Max, PMax, banner ads, images, visuals, visual creative, or to run across all of Google’s inventory, AIMA uses Performance Max.

Performance Max is chosen on explicit visual or image intent — never inferred from goal or industry. When the user does not name a type or ask for visual creative, AIMA defaults to Search.

Simple rule: AIMA reaches for Performance Max only when visuals help users understand, trust, or want the offer. Otherwise it starts with search intent, copy, landing page, and tracking.

### Geo Targeting

The campaign specialist chooses locations before presenting or saving a plan. Explicit user location intent wins. If the user asks to target Canada, Singapore, the UK, or any other market, AIMA uses that instruction and re-presents the adjusted plan.

When the user does not name a market, AIMA infers locations from the brand profile: website/domain clues, business name, description, industry, target audience, goal, value proposition, and research metadata. Asia/SEA or APAC business signals should produce relevant regional targets such as Singapore, Malaysia, Indonesia, Thailand, the Philippines, Vietnam, or the specifically named countries. AIMA should not fall back to United States, Canada, United Kingdom, or Australia unless the user or profile indicates those are target markets.

### Budget as a Separate Confirmation

Budget is deliberately split from the plan confirmation. Step 5 of the [User Flow](/aima/user-flow) presents channels, campaign type, objective, targeting, and keywords — **no dollar amount**. The user commits to the plan (confirmation #2) and then to the creative direction (confirmation #3) before the specialist asks about money (confirmation #4, step 9). When the campaign specialist asks “Want to adjust anything?”, no-change replies in the user’s language such as “no”, “no thanks”, “no gracias”, “não obrigado”, “non merci”, and “nothing” mean keep the current plan or budget as-is, not reject it.

Every plan uses a single total amount over a date range — a hard spend cap, never a per-day figure. A bare amount such as “$50” always means the total; a per-day phrasing is converted to the equivalent total before saving.

#### Delivery Window, Buffer, and Google Campaign Window

End dates carry two meanings, and the specialist discloses both at the budget confirmation. The user’s requested dates are the **active delivery window** — the days the campaign is meant to spend. The date sent to Google is the **Google campaign window**, which extends the delivery end by a review/setup buffer of three calendar days by default. The buffer absorbs Google’s ad review (typically one to two days) and any early no-spend setup fixes, which can otherwise consume a tight window before delivery ramps. The extra calendar days only relax Google’s daily pacing; the total budget is unchanged — it remains a hard cap on lifetime spend, never increased by the buffer.

At confirmation #3 the specialist shows the active delivery window, the buffer days, and the resulting Google campaign window, and notes that review timing may shift the exact start of delivery within that window.

#### Hard Deadlines

When the user signals that the end date is firm — a launch tied to an event, sale, or fixed cutoff — the specialist marks the plan as a hard deadline. A hard-deadline campaign is **not** extended: the Google campaign window ends on the delivery end date with no buffer. Because review and setup still consume time, the specialist warns that this may leave fewer active delivery days, and lets the user keep the dates as-is or extend the window to preserve full delivery.

PM rationale: users don’t want to discuss budget upfront. Getting them committed via plan + creative first makes the spending decision concrete — they are paying for a plan they already agreed to, not reserving money for an abstract campaign. It also keeps the campaign specialist and billing specialist aligned on the amount by the time top-up happens.

## Campaign Flow

### First Campaign (New Launch)

### Ongoing Management

After a campaign is approved and active, the supervisor routes management requests to the same specialist:
| User intent | Action |
| --- | --- |
| ”Pause my campaign” | `pause_campaign` — immediate, reversible |
| ”Resume my ads” | `resume_campaign` — immediate |
| ”Cancel my campaign” | `cancel_campaign` — confirmation required, triggers refund flow |
| ”Show me my campaigns” | `list_campaigns` — list all org campaigns |
| ”How are my ads doing?” | `get_campaign_status` — basic status; deeper metrics via [Reporting Specialist](/aima/specialists/reporting) |
| ”Launch another campaign” | Start a new campaign flow |

### State Machine
| State | What happens | User input required |
| --- | --- | --- |
| `PLANNING` | Compose a Search or Performance Max campaign config from business profile, goal, and user intent, present a pre-filled plan — **no budget** | Confirm or adjust plan (channels, campaign type, objective, targeting, keywords/hooks). “No” to “Want to adjust anything?” means no adjustment. |
| `CREATIVE` | Creative specialist presents Search angle candidates or a single Performance Max concept, generates the selected direction, and persists a `creative_draft` with copy + job IDs. Campaign specialist retrieves the verified draft via `getCreativeDraft` — image URLs are backfilled from `creative_job` at read time. Generated copy/images are previewed only on request. | Pick direction or request revision (1–2 rounds) |
| `BUDGET` | Present recommended budget and duration as a single total over the date range, and disclose the active delivery window, the review/setup buffer, and the resulting Google campaign window. User confirms or adjusts. | Confirm or adjust budget. “No” to “Want to adjust anything?” means keep the recommended budget. If the end date is a hard deadline, the user is warned that review/setup may leave fewer active delivery days and may keep the dates or extend. |
| `FUNDING` | Detect shortfall; top-up routed to [Billing Specialist](/aima/specialists/billing) via seamless handoff (no extra user turn) | Top-up amount (only if wallet balance insufficient) |
| `LAUNCH` | Launch campaign after funding verified. Post-top-up resume enters here directly — budget is not re-confirmed. For Performance Max, launch waits on the silent square aspect variants and resumes automatically when the background completion event fires. | None (confirmation #4 already locked the amount) |
| `MANAGE` | Ongoing — pause, resume, cancel, list campaigns | Per-action confirmation |

Search and Performance Max campaigns both go through `CREATIVE`. Search campaigns present four angle candidates and generate Google Search copy for the two selected angles. Performance Max uses the shared landscape/square image pipeline with a single asset group: the user picks one concept, and the specialist generates RSA-style copy (three or more headlines, two or more descriptions, optional long headline) plus one landscape source image before budget, then one square aspect variant after budget/payment. The 1:1 logo is attached from the brand at launch. The square variant normally takes about 1–2 minutes because it reuses the completed landscape asset, and the completion job sends the final ready message before launch resumes. The creative specialist persists a `creative_draft`, and the campaign specialist retrieves the verified draft before launch.

## Scope

### In Scope
- Campaign planning with smart defaults from business profile
- Search and Performance Max campaign planning
- Budget recommendation and draft editing (budget, targeting, ad copy)
- Location and age targeting with editable defaults
- First-campaign creative generation and approval
- Pre-launch confirmation gate
- Funding verification — shortfall detection; top-up via [Billing Specialist](/aima/specialists/billing)
- Campaign launch via `launch_campaign`
- Ongoing management — pause, resume, cancel
- Campaign listing via `list_campaigns`
- Forward progression enforcement (plan → creative → fund → launch)

### Out of Scope
- Business profile collection — handled by [Onboarding](/aima/specialists/onboarding)
- Post-launch creative iteration (A/B variants, refreshes) — handled by [Creative Specialist](/aima/specialists/creative)
- Campaign performance metrics and reporting — handled by [Reporting Specialist](/aima/specialists/reporting)
- Direct memory access — receives context via [delegation hooks](/aima/agent-core#delegation-hooks)

## Tools
| Module | Tool | Used during |
| --- | --- | --- |
| **[Managed Ads](/managed-ads)** | `create_draft` | `PLANNING` — save campaign configuration as a draft |
| **[Managed Ads](/managed-ads)** | `update_draft` | `PLANNING` — edit draft campaign (budget, targeting, ad copy, name) |
| **[Managed Ads](/managed-ads)** | `launch_campaign` | `LAUNCH` — launch an existing draft on the ad platform (retry-safe) |
| **[Managed Ads](/managed-ads)** | `pause_campaign` | `MANAGE` — pause a running campaign |
| **[Managed Ads](/managed-ads)** | `resume_campaign` | `MANAGE` — resume a paused campaign |
| **[Managed Ads](/managed-ads)** | `cancel_campaign` | `MANAGE` — cancel a running or paused campaign |
| **[Managed Ads](/managed-ads)** | `get_campaign_status` | `MANAGE` — check current campaign state |
| **[Managed Ads](/managed-ads)** | `list_campaigns` | `MANAGE` — list campaigns for the organization |
| **[Managed Ads](/managed-ads)** | `list_ad_accounts` | `PLANNING` — get the org’s bound ad account (requires positive wallet balance; auto-assigns from pool if none bound; returns waitlist position if pool is empty) |
| **[Creative Engine](/creative-engine)** | `generate_creative`, `approve_creative`, `reject_creative` | `CREATIVE` — generate and approve ad creative |
| **[Payments](/shared/payments)** | *(none — top-up via [Billing Specialist](/aima/specialists/billing))* | `FUNDING` — shortfall detection triggers supervisor routing to billing |

## Supervisor Interaction

The supervisor routes to the campaign specialist when:
- **Intent matches campaign actions** — “launch a campaign”, “pause my ads”, “start advertising”
- **User just completed onboarding** — the supervisor suggests launching a campaign as the natural next step
- **Active campaign exists** — management requests (pause, resume, cancel, status) route here

The supervisor provides the business profile and goal from working memory in every delegation — the campaign specialist doesn’t need to re-collect this context.

## Design Considerations

### Smart Defaults Over Questions

Instead of asking “What’s your budget?”, the specialist reads the business profile and composes a campaign plan: “Search, $70 total over 7 days, New York, ages 25-40 — want to adjust anything?” This shifts the interaction from open-ended questions (high cognitive load) to confirmation of reasonable defaults (low cognitive load).

The specialist uses the business profile (industry, geography, audience signals) to infer platform, budget, and targeting defaults. Once confirmed, it saves the plan as a draft via `create_draft` and launches via `launch_campaign`.

### Creative in First Campaign

The first-campaign creative step lives inside the campaign flow (not delegated to the Creative Specialist) because first-time creative generation is tightly coupled to the campaign context — the specialist has just confirmed campaign type, targeting, and budget. Passing that context to a separate specialist would duplicate work. Post-launch creative iteration (A/B variants, refreshes) routes to the [Creative Specialist](/aima/specialists/creative).

### Pre-Launch as a Hard Gate

The `BUDGET → FUNDING → LAUNCH` sequence exists as a deliberate friction chain. The user makes two explicit commitments before spend begins: confirming the plan (`PLANNING` → `CREATIVE`) and confirming the budget (`BUDGET` → `FUNDING`). Combined with the [Spending Guard](/aima/guardrails#spending-guard--spending-protection), this ensures two independent checks: the user has seen and approved the targeting **and the dollar amount**, and the account has sufficient funds. AIMA never launches a campaign without both conditions met.

Post-top-up resume enters `LAUNCH` directly — budget is not re-confirmed because confirmation #4 already locked the amount. See [User Flow step 13](/aima/user-flow#steps).

### Unified Campaign Management

After launch, ongoing management (pause, resume, cancel, status checks) stays with the same specialist. This avoids context fragmentation — the specialist already knows the campaign configuration and can reference it when the user asks to adjust. The alternative (a separate “management specialist”) would need the same Managed Ads tools and campaign context, adding complexity for no user benefit.

### Pending Plan Persistence

Pending campaign plans are persisted to the `pending_campaign_plan` table; only the UUID lives in [working memory](/aima/memory#working-memory--business-context) under the `Pending Campaign Plan` field, so plans survive cross-specialist round-trips. When the user adjusts the budget, switches platforms, or tops up their wallet via the [Billing Specialist](/aima/specialists/billing), the campaign specialist’s next delegation reads the saved plan from the DB by ID (platform, budget, targeting, draft ID) and resumes from where it left off — instead of resetting to defaults. The specialist reports the plan via `reportState`’s `pendingPlanId` field after every adjustment, and the supervisor’s delegation hook persists it to working memory. The plan clears automatically when it materializes into a campaign draft, or when the specialist sets `pendingPlanId: null` on cancel.

### Comments
