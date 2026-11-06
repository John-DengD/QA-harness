import { expect, type Page, type TestInfo } from "@playwright/test";

import {
  clearMetaBrandApp,
  inspectMetaBrandProfile,
  inspectMetaCampaignDraft,
  openMetaBrandEditor,
  openMetaDraftComposer,
  restoreMetaBrandProfile,
  selectMetaCampaign,
  selectOrganization,
  waitForMetaCampaignDraft,
  type MetaBrandProfileFact,
  type MetaCampaignFact,
} from "../../../src/actions/meta-byo-actions";
import { submitCampaignGoal } from "../../../src/actions/campaign-actions";
import { attachApiEvidence } from "../../../src/report/evidence";
import { caseRuntime } from "./helpers";

export const APP_INSTALL_GOAL =
  "Prepare a Meta campaign for app installs using the app in my brand profile. Keep it as App Promotion optimized for App Installs. Prepare the draft for review; do not launch or submit it.";

export const IAP_GOAL =
  "Prepare a Meta campaign optimized for in-app purchases using the app and PURCHASE event available to my connected Meta ad account. Keep it as App Promotion with In-app purchases. Prepare the draft for review; do not launch or submit it.";

export const WEBSITE_PURCHASE_GOAL =
  "Prepare a Meta Sales campaign optimized for website purchases using the eligible Pixel from my connected Meta ad account. Keep it as Sales with Website Purchase. Prepare the draft for review; do not launch or submit it.";

export const metaByoContext = async (
  page: Page,
  testInfo: TestInfo,
  caseId: string
) => {
  const { stages } = caseRuntime(testInfo, caseId);
  const context = { page, stages, testInfo };
  const organization = await stages.run(
    "organization-select",
    () => selectOrganization(page, "fr-test"),
    "environment"
  );
  expect(organization.activeOrganization).toBe("fr-test");
  return context;
};

export const readMetaBrandProfile = async (
  context: Awaited<ReturnType<typeof metaByoContext>>
): Promise<MetaBrandProfileFact> => {
  await context.stages.run("brand-open", () => openMetaBrandEditor(context.page));
  const fact = await context.stages.run("brand-meta-profile", () =>
    inspectMetaBrandProfile(context.page)
  );
  await attachApiEvidence(context.testInfo, "brand-meta-profile", {
    appStoreConfigured: fact.appStoreUrl.length > 0,
    metaApplicationConfigured: fact.metaApplicationId.length > 0,
    metaPixelConfigured: fact.metaPixelId.length > 0,
  });
  return fact;
};

export const requireAppProfile = readMetaBrandProfile;

export const createMetaDraft = async (
  context: Awaited<ReturnType<typeof metaByoContext>>,
  goal: string,
  evidenceName: string
): Promise<MetaCampaignFact> => {
  const opened = await context.stages.run(`${evidenceName}-open`, () =>
    openMetaDraftComposer(context.page)
  );
  if (opened.existingDraftVisible) {
    context.testInfo.annotations.push({
      type: "blocked",
      description: "An existing draft in fr-test has unknown ownership; this Case will not discard it.",
    });
    context.testInfo.skip(true, "Existing shared-organization draft must be resolved by its owner before this Case can create another");
  }
  await context.stages.run(`${evidenceName}-select-meta`, () =>
    selectMetaCampaign(context.page)
  );
  await context.stages.run(`${evidenceName}-submit-goal`, () =>
    submitCampaignGoal(context.page, goal)
  );
  await context.stages.run(`${evidenceName}-wait`, () =>
    waitForMetaCampaignDraft(context.page)
  );
  const fact = await context.stages.run(evidenceName, () =>
    inspectMetaCampaignDraft(context.page)
  );
  await attachApiEvidence(context.testInfo, evidenceName, {
    agentStillRunning: fact.agentStillRunning,
    campaignType: fact.campaignType,
    deliveryOptimization: fact.deliveryOptimization,
    launchEnabled: fact.launchEnabled,
    readiness: fact.readiness,
    url: fact.url,
  });
  return fact;
};

export const withMissingMetaApp = async (
  context: Awaited<ReturnType<typeof metaByoContext>>,
  original: MetaBrandProfileFact,
  task: () => Promise<void>
): Promise<void> => {
  try {
    await context.stages.run("brand-meta-app-clear", async () => {
      await openMetaBrandEditor(context.page);
      return clearMetaBrandApp(context.page);
    });
    await task();
  } finally {
    await context.stages.run(
      "brand-meta-app-restore",
      async () => {
        await openMetaBrandEditor(context.page);
        await restoreMetaBrandProfile(context.page, original);
        await openMetaBrandEditor(context.page);
        const restored = await inspectMetaBrandProfile(context.page);
        if (
          restored.metaApplicationId !== original.metaApplicationId ||
          restored.appStoreUrl !== original.appStoreUrl
        ) {
          throw new Error("Meta App selection was not restored");
        }
      },
      "teardown"
    );
  }
};

export const isAppEnvironmentBlocked = (readiness: string): boolean =>
  /not available to this BYO ad account|Meta isn't receiving.*PURCHASE|app.*not ready/i.test(
    readiness
  );
