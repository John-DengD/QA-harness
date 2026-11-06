import type { Page, TestInfo } from "@playwright/test";
import type { PlayWrightAiFixtureType } from "@midscene/web/playwright";

export const recordCheckpoint = async (
  stage: string,
  detail: string,
  page: Page,
  testInfo: TestInfo,
  recordToReport: PlayWrightAiFixtureType["recordToReport"]
): Promise<void> => {
  const screenshot = testInfo.outputPath(`stage-${stage}.png`);
  await page.screenshot({ fullPage: true, path: screenshot });
  await testInfo.attach(`stage-${stage}`, {
    contentType: "image/png",
    path: screenshot,
  });
  await recordToReport(`Stage: ${stage}`, { content: detail });
};

export const assertVisualCheckpoint = async (
  assertion: string,
  aiAssert: PlayWrightAiFixtureType["aiAssert"]
): Promise<void> => {
  await aiAssert(assertion, `Critical visual assertion failed: ${assertion}`);
};
