import type { Page, TestInfo } from "@playwright/test";
import type { PlayWrightAiFixtureType } from "@midscene/web/playwright";

import { recordCheckpoint } from "../../../src/tools/checkpoints";
import { UserApiClient, UserApiRequestError } from "../../../src/clients/user-api";
import type { RuntimeConfig } from "../../../src/config";
import {
  expandCampaignCopyEditor,
  observeCampaignCopyActions,
  observeCampaignCreativeCards,
  observeCampaignType,
  observeCampaignTypeLabel,
  openCampaignComposer,
  openCampaignDraft,
  submitCampaignGoal,
  waitForCampaignDraft,
} from "../../../src/actions/campaign-actions";
import { attachApiEvidence } from "../../../src/report/evidence";
import { StageTracker } from "../../../src/tools/stage-tracker";
import {
  continueStudioToStyle,
  observeStudioCreateControls,
  observeStudioGenerateGate,
  observeStudioLibraryControls,
  openStudioCreateSheet,
  openStudioLibrary,
} from "../../../src/actions/studio-actions";

interface CaseContext {
  aiAssert: PlayWrightAiFixtureType["aiAssert"];
  page: Page;
  recordToReport: PlayWrightAiFixtureType["recordToReport"];
  runtime: RuntimeConfig;
  stages: StageTracker;
  testInfo: TestInfo;
}

export const runStudioCreateSheetCase = async (
  context: CaseContext
): Promise<void> => {
  const { page, recordToReport, stages, testInfo } = context;

  await stages.run("studio-library", async () => {
    await openStudioLibrary(page);
    if (!(await observeStudioLibraryControls(page)).headingVisible) {
      throw new Error("Studio library heading is missing");
    }
  });
  await recordCheckpoint(
    "studio-library",
    "Studio library loaded after skipping the password login form.",
    page,
    testInfo,
    recordToReport
  );

  await stages.run("studio-create-open", async () => {
    const fact = await openStudioCreateSheet(page);
    const controls = await observeStudioCreateControls(page);
    if (!controls.titleVisible || !fact.continueToStyleVisible || controls.continueEnabled) {
      throw new Error("Continue To Style must be gated until an angle is selected");
    }
  });

  await stages.run("studio-style-open", async () => {
    const fact = await continueStudioToStyle(page);
    if (!fact.referencesActive) throw new Error("Style selection is not visible");
  });

  await stages.run("studio-generate-gate", async () => {
    if ((await observeStudioGenerateGate(page)).enabled) {
      throw new Error("Generate Set enabled without a reference");
    }
  }, "assertion");

  await recordCheckpoint(
    "studio-create-sheet",
    "Brief-first create sheet reached Style with Generate Set gated until a reference is selected.",
    page,
    testInfo,
    recordToReport
  );

  await attachApiEvidence(testInfo, "studio-create-sheet", {
    generateGated: true,
    skippedLogin: true,
  });
};

export const runLaunchEditorRegressionCase = async (
  context: CaseContext,
  getToken: () => Promise<string>
): Promise<void> => {
  const { page, recordToReport, runtime, stages, testInfo } = context;
  const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken });
  let draftId: string | null = null;

  try {
    const draft = await stages.run("draft-create", () =>
      api
        .createDraft({
          budgetAmount: 50,
          campaignType: "search",
          keywords: ["AI interview preparation"],
          languages: ["English"],
          locations: ["United States"],
          name: `E2E Launch Editor ${Date.now()}`,
          objective: "Drive qualified signups for AI interview preparation",
          platform: "google",
        })
        .catch(async (error) => {
          if (
            !(
              error instanceof UserApiRequestError &&
              error.status === 409 &&
              error.message.includes("E_NO_AD_ACCOUNT")
            )
          ) {
            throw error;
          }
          testInfo.annotations.push({
            type: "warning",
            description:
              "No Google ad account assigned; open the product campaign composer instead of POST /campaigns/drafts.",
          });
          await attachApiEvidence(testInfo, "launch-editor-draft-warning", {
            code: "E_NO_AD_ACCOUNT",
            fallback: "product-campaign-composer",
          });
          return null;
        })
    );
    draftId = draft?.draft.id ?? null;
    await attachApiEvidence(testInfo, "launch-editor-draft", {
      created: draft !== null,
      platform: "google",
      type: "search",
    });

    const knownDraftId = draftId;
    if (knownDraftId) {
      await stages.run("draft-open", () => openCampaignDraft(page, knownDraftId));
    } else {
      await stages.run("composer-open", () => openCampaignComposer(page));
      await stages.run("composer-goal-submit", () => submitCampaignGoal(
        page,
        "Prepare a Google Search campaign for https://finalroundai.com to drive interview preparation signups in the United States, in English. Total budget $50 over 10 days. Save a pending plan if no ad account is assigned. Prepare it for my review; do not launch or submit it."
      ));
      await stages.run("draft-settle", () => waitForCampaignDraft(page));
    }

    await stages.run("launch-type-row", async () => {
      if (!(await observeCampaignTypeLabel(page)).visible) throw new Error("Campaign type row is absent");
      if (!/Search|Performance Max|Meta/i.test((await observeCampaignType(page)).selectedType)) {
        throw new Error("Campaign type is not displayed");
      }
    }, "assertion");

    await stages.run("launch-creative-card", async () => {
      if ((await observeCampaignCreativeCards(page)).creativeCardCount < 1) {
        throw new Error("Campaign creative card is absent");
      }
      if (!(await observeCampaignCopyActions(page)).editCopyVisible) {
        throw new Error("Edit copy control is absent");
      }
    }, "assertion");

    await stages.run("launch-edit-copy", async () => {
      const fact = await expandCampaignCopyEditor(page);
      if (!fact.expanded) throw new Error("Campaign copy editor did not expand");
    });

  await stages.runAdvisory("launch-regenerate", async () => {
      await observeCampaignCopyActions(page);
    });

    await recordCheckpoint(
      "launch-editor",
      "Google Search launch editor shows campaign type, creative card, and Edit copy after skipping login.",
      page,
      testInfo,
      recordToReport
    );
  } finally {
    if (draftId) {
      await api.discardDraft(draftId).then(
        () => attachApiEvidence(testInfo, "launch-editor-teardown", { discarded: true }),
        (error) =>
          attachApiEvidence(testInfo, "launch-editor-teardown-warning", {
            discarded: false,
            errorType: error instanceof Error ? error.name : "UnknownError",
          })
      );
    }
  }
};
