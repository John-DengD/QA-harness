import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import {
  APP_INSTALL_GOAL,
  createMetaDraft,
  isAppEnvironmentBlocked,
  metaByoContext,
  requireAppProfile,
} from "./meta-byo-helpers";

test(
  "QA-1130 Meta BYO App Install keeps exact intent",
  { tag: ["@case:meta-byo-app-install", "@qa:1130"] },
  async ({ page }, testInfo) => {
    const context = await metaByoContext(page, testInfo, "meta-byo-app-install");
    const profile = await requireAppProfile(context);
    if (!(profile.metaApplicationId && profile.appStoreUrl)) {
      testInfo.annotations.push({
        type: "blocked",
        description: "fr-test requires an explicit App To Advertise and Store Listing selection.",
      });
      test.skip(true, "Meta App selection precondition is not satisfied in fr-test");
    }
    const fact = await createMetaDraft(context, APP_INSTALL_GOAL, "app-install-draft");

    expect(fact.url).toContain("/campaigns/new");
    expect(fact.campaignType).toMatch(/App installs/i);
    expect(fact.deliveryOptimization).toMatch(/App installs/i);
    expect(fact.agentStillRunning).toBe(false);
    expect(fact.pageText).toMatch(/Facebook Page/i);
    expect(fact.pageText).not.toMatch(/optimize for website traffic instead/i);

    if (isAppEnvironmentBlocked(fact.readiness)) {
      testInfo.annotations.push({
        type: "blocked",
        description: "The configured Meta app is not eligible for the fr-test BYO ad account.",
      });
      test.skip(true, "App eligibility precondition is not satisfied in fr-test");
    }
  }
);
