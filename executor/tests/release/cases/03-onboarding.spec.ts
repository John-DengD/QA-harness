import { runOnboardingCase } from "./case-flows";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "forced onboarding completes for the fixed account",
  { tag: "@case:onboarding" },
  async ({ aiAssert, getAccountJwt, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "onboarding");
    await runOnboardingCase(
      { aiAssert, page, recordToReport, runtime, stages, testInfo },
      getAccountJwt
    );
  }
);
