import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import {
  IAP_GOAL,
  createMetaDraft,
  isAppEnvironmentBlocked,
  metaByoContext,
  requireAppProfile,
} from "./meta-byo-helpers";

test(
  "QA-1130 Meta BYO IAP keeps exact intent",
  { tag: ["@case:meta-byo-iap", "@qa:1130"] },
  async ({ page }, testInfo) => {
    const context = await metaByoContext(page, testInfo, "meta-byo-iap");
    const profile = await requireAppProfile(context);
    if (!(profile.metaApplicationId && profile.appStoreUrl)) {
      testInfo.annotations.push({
        type: "blocked",
        description: "fr-test requires an explicit App To Advertise and Store Listing selection.",
      });
      test.skip(true, "Meta App selection precondition is not satisfied in fr-test");
    }
    const fact = await createMetaDraft(context, IAP_GOAL, "iap-draft");

    expect(fact.url).toContain("/campaigns/new");
    expect(fact.campaignType).toMatch(/App purchases/i);
    expect(fact.deliveryOptimization).toMatch(/In-app purchases/i);
    expect(fact.agentStillRunning).toBe(false);
    expect(fact.pageText).not.toMatch(/optimize for installs|website traffic instead/i);

    if (isAppEnvironmentBlocked(fact.readiness)) {
      testInfo.annotations.push({
        type: "blocked",
        description: "App access or PURCHASE eligibility is not satisfied in fr-test.",
      });
      test.skip(true, "IAP eligibility precondition is not satisfied in fr-test");
    }
  }
);
