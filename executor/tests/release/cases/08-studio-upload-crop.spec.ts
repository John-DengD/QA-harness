import { runStudioUploadCropSmoke } from "./studio-upload-flow";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "studio upload creatives shows google crop sizes and can be removed",
  { tag: ["@case:studio-upload-crop", "@release"] },
  async ({ aiAssert, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "studio-upload-crop");
    await runStudioUploadCropSmoke({
      aiAssert,
      page,
      recordToReport,
      runtime,
      stages,
      testInfo,
    });
  }
);
