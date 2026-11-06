---
source: https://hellyeah-v2-docs.vercel.app/aima/user-flow
site_timestamp: 1785395625000
synced_at: 2026-08-05T01:38:33.044Z
---
# User Flow

> The canonical 14-step AIMA user journey — Search and Performance Max campaigns, four confirmations, conditional top-up.

## Purpose

This page is the source of truth for AIMA’s end-to-end user journey, from first contact to a launched campaign. For domain detail see [Onboarding](/aima/specialists/onboarding), [Campaign](/aima/specialists/campaign), [Creative](/aima/specialists/creative), and [Billing](/aima/specialists/billing). The flow covers **Search** and **Performance Max** launches; the branching point is the creative step.

## Flow

## Steps

Each step notes which specialist owns it. The **four user confirmations** are bolded — they are the only blocking user inputs in the happy path.
1. **Ask for website.** Supervisor delegates the first message to the onboarding specialist, which asks for a website or business name. *(Onboarding)*
2. **Crawl context.** The onboarding specialist runs identity verification (Exa search) then delegates to the brand-researcher sub-agent to extract branding, audience, channels, and campaign-type signals. *(Onboarding)*
3. **Present business profile.** The specialist generates a visual brand preview (HTML → R2 → CDN link) and presents a text summary alongside the preview. *(Onboarding)*
4. **CONFIRMATION #1 — profile.** User confirms or corrects the profile. Profile is persisted via `saveBrandProfile`. *(Onboarding → Supervisor)*
5. **Send marketing plan (no budget).** Supervisor delegates to the campaign specialist, which composes a Search or Performance Max plan from the profile: platform, campaign type, objective, targeting, and keywords or hooks. Search is the default. Performance Max is used only when the user explicitly asks for it (PMax, banner ads, visual creative, or running across all of Google’s inventory) — never inferred from goal or industry. **Budget is intentionally not presented here** — it is split into its own confirmation at step 9. *(Campaign)*
6. **CONFIRMATION #2 — plan.** User accepts or adjusts the plan. When the campaign specialist asks “Want to adjust anything?”, no-change replies in the user’s language (for example “no”, “no thanks”, “no gracias”, “não obrigado”, “non merci”, or “nothing”) mean no adjustment — keep the plan as-is and proceed. On confirmation, the campaign specialist persists the confirmed plan via `savePendingPlan` and reports `pendingPlanId` with `handoffTo=creative`. No campaign draft exists yet. *(Campaign → Supervisor → Creative)*
7. **Present creative direction.** The supervisor silently relays to the creative specialist, which loads the confirmed plan via `getPendingPlan` and presents four angle candidates for Search or four style concepts for Performance Max. Images are created only when visuals help users understand, trust, or want the offer; otherwise AIMA starts with search intent, copy, landing page, and tracking. Search asks the user to pick exactly two options; Performance Max asks for exactly one concept for its single asset group. *(Creative)*
8. **CONFIRMATION #3 — creative direction.** Search: user chooses two of the four angle candidates or requests changes, then the creative specialist generates and saves two copy variants via `saveCreativeDraft`. Performance Max: user chooses one of the four concepts, then creative generates and saves one RSA-style copy set (three or more headlines, two or more descriptions) plus one silent landscape source image. AIMA sends an initial text-only progress update, then one halfway text-only update while the image runs, without revealing it. The final image message only sends after the landscape file is complete: “All done — your creatives are ready. Would you like to review the images and copy, or continue to launch?” Images and copy are shown only on explicit request. The square variant waits until budget/payment/top-up. *(Creative → Supervisor → Campaign)*
9. **Send budget suggestion.** The campaign specialist proposes a budget and asks the user to confirm or adjust. Every plan uses a single `$70` total over the date range — a hard spend cap, never a per-day figure. The specialist also discloses the schedule: the active delivery window (the user’s requested dates), the review/setup buffer (three calendar days by default), and the resulting Google campaign window (delivery end plus buffer), noting that review timing may shift exactly when delivery starts. The buffer relaxes Google’s daily pacing only — the total stays a hard cap. If the user signals a hard deadline, the specialist marks the schedule as a hard deadline (no buffer, Google window ends on the delivery end date) and warns that review/setup may leave fewer active delivery days, letting the user keep the dates or extend the window. For Performance Max, the landscape image is complete, but the square launch variant is not generated yet. If the user suggests a total below the product minimum, AIMA explains it and recommends updating the budget to `$70`. *(Campaign)*
10. **CONFIRMATION #4 — budget.** User accepts or adjusts. When the campaign specialist asks “Want to adjust anything?”, no-change replies in the user’s language mean no budget adjustment — keep the recommended amount. If the user changes the amount or duration, the campaign specialist updates the persisted plan via `savePendingPlan(mode="update")`. The confirmed budget is locked here, before any launch attempt. *(Campaign)*
11. **Send top-up link — conditional.** After budget confirmation, the campaign specialist calls `checkCampaignEligibility`. Only emitted when the wallet balance is insufficient to cover the confirmed budget. When balance already covers the budget, steps 11–12 are skipped and the flow proceeds straight to draft creation + launch. When the user has zero balance, the transition from step 10 to step 11 is **seamless** — campaign specialist reports the pre-set `topupAmount`, supervisor routes to billing, and billing emits a pre-filled Stripe Checkout link. Delivered as ≤2 assistant messages with no user turn in between. *(Billing — conditional)*
12. **User pays.** Stripe webhook credits the wallet. Skipped when step 11 was skipped. *(Billing — conditional)*
13. **Final creative + campaign review.** Search: post-top-up resume (or direct path when balance was sufficient) jumps straight to launch using the saved `creativeDraftId`. Performance Max: before budget/top-up, creative has already saved the RSA-style copy set plus one landscape source image job from the user-selected concept. Post-top-up resume (or direct eligible path) returns to creative only to queue the missing square aspect variant from that saved landscape source, and the 1:1 logo is attached from the brand at launch. The square variant usually takes about 1–2 minutes because the landscape source already exists; when complete, a background completion turn tells the user the final images are ready and resumes launch without re-confirming budget. *(Creative → Campaign)*
14. **Assistant mode.** Supervisor takes over, available for follow-up (“I can do X, Y, Z for you — just let me know”). *(Supervisor)*

## Scope

### In Scope
- Search and Performance Max campaigns end-to-end (profile → plan → creative → budget → fund → launch)
- Four explicit user confirmations
- Conditional top-up (only when balance insufficient)
- Seamless ≤2-message handoff for zero-balance users
- Post-top-up resume at launch (step 13)
- Pending-plan → creative-draft → materialized-draft flow

### Out of Scope
- **Budget re-confirmation after top-up** — intentionally omitted per the “resume at launch” rule above.

### Comments
