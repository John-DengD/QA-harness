import { runRegistrationCase } from "./case-flows";
import { test } from "../../../src/fixtures";
import { caseRuntime } from "./helpers";

test(
  "registration creates a disposable Clerk account",
  { tag: "@case:registration" },
  async ({ aiAssert, page, recordToReport }, testInfo) => {
    const { runId, runtime, stages } = caseRuntime(testInfo, "registration");
    await runRegistrationCase(
      { aiAssert, page, recordToReport, runtime, stages, testInfo },
      runId
    );
  }
);
