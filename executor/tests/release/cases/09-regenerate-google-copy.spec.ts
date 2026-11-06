import { runLaunchEditorRegressionCase } from "./release-regression-flows";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "google launch editor exposes edit copy and regenerate action",
  { tag: ["@case:regenerate-google-copy", "@release"] },
  async ({ aiAssert, getAccountJwt, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "regenerate-google-copy");
    await runLaunchEditorRegressionCase(
      {
        aiAssert,
        page,
        recordToReport,
        runtime,
        stages,
        testInfo,
      },
      getAccountJwt
    );
  }
);
