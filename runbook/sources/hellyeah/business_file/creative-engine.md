---
source: https://hellyeah-v2-docs.vercel.app/creative-engine
site_timestamp: 1785361273000
synced_at: 2026-08-05T01:40:00.826Z
---
# Creative Engine

> AI-powered ad creative generation with spend-tier defaults.

## Team

@Bing, @Josh Locke

## Purpose

Generates campaign-ready image creatives and ad copy variants through structured prompt engineering. Takes business context + audience and produces platform-specific images, headlines, descriptions, and CTAs using **OpenAI GPT Image 2**.

## Generation Flow

Text Workflow

Image Workflow

Fail — inject violations

Pass

Score < 0.7

Score ≥ 0.7

Score < 0.7

Score ≥ 0.7

Score < 0.75

Score ≥ 0.75

Fail — inject violations

Pass

hook + tone + visual style

hook + tone

Business Context + Brand

Angle Planner

Prompt Assembly

GPT Image 2 Generation

Platform Policy Check

Founder Critique

Designer Critique

Finalize Image

Caption Agent
10 variants

Founder Critique

CTA Agent

Copy Policy Check

Finalize Copy + CTA

R2 Storage

Deliver to AIMA

**Key stages:**
1. **Prompt engineering** — Assemble structured prompt with hook, brand elements, platform specs
2. **AI generation** — Images via GPT Image 2; copy via persona-aware caption agent (10 variants/pass)
3. **Policy guardrails** — Platform ad policy checked after each generation; violations injected into next prompt as constraints
4. **Agent critique loops** — Founder + designer agents score images (founder threshold: 0.7, designer threshold: 0.72); founder agent scores copy (threshold: 0.75)
5. **CTA placement** — Dedicated agent decides button label, inline CTA, and placement per platform
6. **Copy policy check** — Copy + CTA text checked against platform content rules; retries up to 2×
7. **Storage & delivery** — Images saved to R2, metadata tracked, creative bundle surfaced via AIMA

## Scope

**In Scope:**
- Prompt-driven image generation (OpenAI GPT Image 2)
- Ad copy variants per platform character limits
- Platform-specific format validation
- Asset storage (R2) and CDN delivery
- Generation parameter tracking for performance correlation

**Out of Scope:**
- Video production pipeline
- Dynamic creative optimization
- Automated A/B testing
- Enterprise-scale creative generation

## AI Framework

Creative Engine uses **Mastra workflows** to orchestrate image and text generation pipelines. Mastra provides structured workflow orchestration with built-in observability (via Langfuse) and [guardrails](https://mastra.ai/docs/agents/guardrails) for quality control and safety validation.

**Integration points:**
- **Image generation** — Mastra workflow coordinates brand fetch → prompt assembly → AI generation → validation loop
- **Copy generation** — Mastra workflow handles prompt assembly → LLM generation → character limit validation → retry logic
- **Guardrails** — Content safety checks, brand policy compliance, platform policy validation

## Core Components
| Component | What it does |
| --- | --- |
| **Copy Planner** | Analyzes business context, audience, and campaign goal to recommend the sharpest copy angle before text generation runs. Returns a primary angle + alternatives (hook, tone, visual style, novelty, concepts) as structured JSON. Consumed by AIMA’s `planCreativeCopy` tool. |
| **Image Style Planner** | Classifies the business against the style-reference industry library and returns four numbered sample creative images. Consumed by AIMA’s `planCreativeImg` tool so users choose a style before image generation. |
| **Image Generation (Autonomous)** | Fully autonomous prompt-driven image generation via GPT Image 2. Two-stage critique loop (founder threshold 0.7 → designer threshold 0.72). Platform policy guardrail runs after each generation; violations feed back as prompt constraints. Two source-specific Inngest background jobs (`generate-creative-image-channel` for AIMA, `generate-creative-image-api` for CLI) delegate to a shared runner that executes each phase as a separate durable step — a designer-phase failure replays from there without re-running the founder loop. Progress events (`creative/image.progress`) are emitted at each stage and handled by a dedicated function that writes DB state for every source and pushes localized channel messages for AIMA-originated jobs only. |
| **Image Generation (Human-in-the-Loop)** | Suspend/resume workflow that pauses after each image for user approval. Rejection feedback is classified by an LLM and routed to either the founder agent (conversion feedback) or the designer agent (visual feedback) before the next generation. |
| **Text Generation** | Generates 10 copy variants per pass using a persona-aware caption agent. Founder critique loop (threshold 0.75). CTA agent decides button label, inline CTA, and placement. Copy policy check retries up to 2× on violations. |
| **CTA Agent** | Decides CTA strategy after copy is finalized — button label (from Google’s valid list), inline copy (≤30 chars), and placement (button/inline/both/none). |
| **Guardrails** | Platform ad policy checks for both images and copy. Image guardrail uses vision; copy guardrail checks text for false claims, misleading CTAs, and industry-specific rules. Both inject violations as constraints into the next generation. |
| **Creative Versioning** | Tracks generation parameters (hook, colors, tone, novelty) and correlates with performance metrics for optimization. |
| **Platform Specs** | Format requirements for Google Ads. Validates dimensions, file sizes, and character limits. |

## Dependencies

### Needs (consumes from other modules)
| Module | What Creative Engine needs | Interface |
| --- | --- | --- |
| **AIMA** | Surface creatives for user approval in chat, or auto-launch after angle approval when `SKIP_APPROVAL=true` | AIMA Messaging Gateway (via Tools/MCPs) |
| **Managed Ads** | Platform-specific format requirements | Platform Specs from connectors |
| **Admin Dashboard** | Ops review and approval for higher spend tiers | Dashboard entity views |
| **Shared: Auth** | API access control | Auth tokens |

### Provides (other modules consume)
- **Angle Planner Agent** (`anglePlannerAgent`, `buildAnglePlannerPrompt`, `parseAnglePlan`) — called by AIMA’s `planCreativeCopy` tool before copy generation runs
- **Style reference helpers** (`classifyStyleReferenceIndustry`, `getStyleReferenceOptions`) — called by AIMA’s `planCreativeImg` tool before image generation runs
- **Text workflow** (`textGenerationWorkflow`) — called by AIMA’s `generateCreativeCopy` tool when text generation runs as part of a multi-step AIMA flow
- **Sync text generator** (`generateText`) — called directly by the API’s `POST /api/v1/creative/text` handler so the CLI gets variants back in a single round trip
- **Image phase workflows** (`founderPhaseWorkflow`, `designerPhaseWorkflow`) — invoked as two separate durable Inngest steps by both the `generate-creative-image-channel` job (triggered by AIMA’s `enqueueCreativeImage` tool via `creative/image.enqueued.aima`) and the `generate-creative-image-api` job (triggered by the CLI’s `POST /api/v1/creative/images` via `creative/image.enqueued.cli`). Splitting into phase-level workflows is how a designer-phase failure replays without re-running the founder loop.
- **Combined image workflow** (`imageGenerationWorkflow`) — single-call variant available for direct integrations that don’t need per-phase durability
- **Human-loop image workflow** (`imageGenerationHumanLoopWorkflow`) — for direct integrations that need per-image user approval
- **Approved creative bundles → Managed Ads** Campaign Manager (for campaign creation)
- **Creative status + assets** → Admin Dashboard (ops visibility)

## Key Contracts

Creative Engine produces creative bundles consumed by Managed Ads Campaign Manager. Bundles include platform-specific assets (correct dimensions, file types, copy within character limits).

**Flow:** Creative Engine plans angles → AIMA asks the user to approve or swap angles → Creative Engine generates the batch → AIMA either surfaces generated assets for approval or, when `SKIP_APPROVAL=true`, saves the generated batch and hands it directly to Managed Ads for launch. @Josh Locke owns end-to-end (Creative Engine + AIMA).

## Documentation
- [Image Generation](/creative-engine/image-generation) — Prompt engineering, style guidelines, asset storage
- [Text Generation](/creative-engine/text-generation) — Platform-specific ad copy, message clarity, winning examples, workflow integration
- [Creative Versioning](/creative-engine/creative-versioning) — Parameter tracking, performance correlation
- [Platform Specs](/creative-engine/platform-specs) — Format requirements (Google Ads)

### Comments
