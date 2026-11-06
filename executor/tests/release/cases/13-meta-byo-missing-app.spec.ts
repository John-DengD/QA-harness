import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import {
  APP_INSTALL_GOAL,
  createMetaDraft,
  metaByoContext,
  requireAppProfile,
  withMissingMetaApp,
} from "./meta-byo-helpers";

test(
  "QA-1130 inaccessible Meta app blocks with actionable readiness",
  { tag: ["@case:meta-byo-missing-app", "@qa:1130"] },
  async ({ page }, testInfo) => {
    const context = await metaByoContext(page, testInfo, "meta-byo-missing-app");
    const profile = await requireAppProfile(context);
    const verifyMissingApp = async () => {
      const fact = await createMetaDraft(
        context,
        APP_INSTALL_GOAL,
        "missing-app-readiness"
      );

      expect(fact.url).toContain("/campaigns/new");
      expect(fact.agentStillRunning).toBe(false);
      expect(fact.pageText).toMatch(/Meta campaign draft/i);
      expect(fact.pageText).toMatch(/App|Brand Profile/i);
      expect(fact.launchEnabled).toBe(false);
    };
    if (profile.metaApplicationId && profile.appStoreUrl) {
      await withMissingMetaApp(context, profile, verifyMissingApp);
    } else {
      await verifyMissingApp();
    }
  }
);
