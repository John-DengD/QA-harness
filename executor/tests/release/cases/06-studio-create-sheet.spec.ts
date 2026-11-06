import { runStudioCreateSheetCase } from "./release-regression-flows";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "studio create sheet is brief-first and gates Generate Set",
  { tag: ["@case:studio-create-sheet", "@release"] },
  async ({ aiAssert, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "studio-create-sheet");
    await runStudioCreateSheetCase({
      aiAssert,
      page,
      recordToReport,
      runtime,
      stages,
      testInfo,
    });
  }
);
