import { runLaunchEditorRegressionCase } from "./release-regression-flows";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "launch editor keeps campaign type, creative card, and edit copy",
  { tag: ["@case:launch-editor", "@release"] },
  async ({ aiAssert, getAccountJwt, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "launch-editor");
    await runLaunchEditorRegressionCase(
      { aiAssert, page, recordToReport, runtime, stages, testInfo },
      getAccountJwt
    );
  }
);
