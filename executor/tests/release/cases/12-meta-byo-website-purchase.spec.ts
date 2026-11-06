import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import {
  createMetaDraft,
  metaByoContext,
  readMetaBrandProfile,
  WEBSITE_PURCHASE_GOAL,
} from "./meta-byo-helpers";

test(
  "QA-1130 Meta BYO Website Purchase keeps exact intent",
  { tag: ["@case:meta-byo-website-purchase", "@qa:1130"] },
  async ({ page }, testInfo) => {
    const context = await metaByoContext(page, testInfo, "meta-byo-website-purchase");
    const profile = await readMetaBrandProfile(context);
    expect(profile.metaPixelId).not.toBe("");
    const fact = await createMetaDraft(
      context,
      WEBSITE_PURCHASE_GOAL,
      "website-purchase-draft"
    );

    expect(fact.url).toContain("/campaigns/new");
    expect(fact.campaignType).toMatch(/Sales/i);
    expect(fact.deliveryOptimization).toMatch(/Conversions/i);
    expect(fact.readiness).toMatch(/Website purchases\s+(?:ready|not ready)/i);
    expect(fact.agentStillRunning).toBe(false);
    expect(fact.pageText).not.toMatch(/optimize for website traffic instead/i);
  }
);
