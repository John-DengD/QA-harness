import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import type { PlayWrightAiFixtureType } from "@midscene/web/playwright";

import { recordCheckpoint } from "../../../src/tools/checkpoints";
import type { RuntimeConfig } from "../../../src/config";
import {
  openStudioCreateSheet,
  openStudioLibrary,
} from "../../../src/actions/studio-actions";
import { attachApiEvidence } from "../../../src/report/evidence";
import { StageTracker } from "../../../src/tools/stage-tracker";

interface CaseContext {
  aiAssert: PlayWrightAiFixtureType["aiAssert"];
  page: Page;
  recordToReport: PlayWrightAiFixtureType["recordToReport"];
  runtime: RuntimeConfig;
  stages: StageTracker;
  testInfo: TestInfo;
}

const sampleImage = path.resolve(
  process.cwd(),
  "tests/fixtures/studio/sample-upload.png"
);

export const runStudioUploadCropSmoke = async (
  context: CaseContext
): Promise<void> => {
  const { page, recordToReport, stages, testInfo } = context;

  await stages.run("studio-library", () => openStudioLibrary(page));
  await stages.run("studio-create-open", () => openStudioCreateSheet(page));

  // Exploratory candidate only: this crop flow has not been seen on the deployed Studio.
  const legacyUpload = page.getByRole("button", { name: "Upload Creatives", exact: true });
  const uploadVisible = await legacyUpload.isVisible().catch(() => false);
  if (!uploadVisible) {
    await attachApiEvidence(testInfo, "studio-upload-crop", {
      deployed: false,
      environment: "staging",
    });
    testInfo.skip(
      true,
      "The legacy Upload Creatives crop flow is not deployed; Studio reference upload is a separate flow."
    );
    return;
  }

  await stages.run("upload-entry", async () => {
    await legacyUpload.click();
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
  });

  await stages.run("choose-local-image", async () => {
    await page.locator('input[type="file"]').first().setInputFiles(sampleImage);
    await expect(page.getByRole("button", { name: "Remove Upload", exact: true }))
      .toBeVisible({ timeout: 30_000 });
  });

  await stages.run("google-crop-sizes", async () => {
    await expect(page.getByText(/1200\s*[×x]\s*628/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1200\s*[×x]\s*1200/).first()).toBeVisible();
  }, "assertion");

  await recordCheckpoint(
    "studio-upload-crop",
    "Upload Creatives accepted a local PNG and showed Google crop sizes.",
    page,
    testInfo,
    recordToReport
  );

  await stages.run("remove-upload", async () => {
    await page.getByRole("button", { name: "Remove Upload", exact: true }).click();
    await expect(page.getByRole("button", { name: "Confirm Brief", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Generate(?: Set)?$/ })).toBeDisabled();
  });

  await attachApiEvidence(testInfo, "studio-upload-crop", {
    file: "sample-upload.png",
    removed: true,
  });
};
