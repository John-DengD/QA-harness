import { getFreshClerkSessionJwt } from "../../../src/session/clerk-session";
import { runLoginCase } from "./case-flows";
import { test } from "../../../src/fixtures";
import { caseRuntime } from "./helpers";

test(
  "login authenticates a disposable test account",
  { tag: "@case:login" },
  async ({ aiAssert, page, recordToReport }, testInfo) => {
    const { runId, runtime, stages } = caseRuntime(testInfo, "login");
    await runLoginCase(
      { aiAssert, page, recordToReport, runtime, stages, testInfo },
      () => getFreshClerkSessionJwt(page),
      runId
    );
  }
);
