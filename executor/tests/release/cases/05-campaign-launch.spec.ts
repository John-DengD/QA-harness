import { runCampaignLaunchCase } from "./case-flows";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "campaign launch reserves and submits $50",
  { tag: "@case:campaign-launch" },
  async ({ aiAssert, getAccountJwt, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "campaign-launch");
    await runCampaignLaunchCase(
      { aiAssert, page, recordToReport, runtime, stages, testInfo },
      getAccountJwt
    );
  }
);
