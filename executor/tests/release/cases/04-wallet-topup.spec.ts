import { runWalletTopupCase } from "./case-flows";
import { accountTest as test } from "../../../src/account-fixtures";
import { caseRuntime } from "./helpers";

test(
  "wallet top-up adds $50 to the fixed account",
  { tag: "@case:wallet" },
  async ({ aiAssert, getAccountJwt, page, recordToReport }, testInfo) => {
    const { runtime, stages } = caseRuntime(testInfo, "wallet");
    await runWalletTopupCase(
      { aiAssert, page, recordToReport, runtime, stages, testInfo },
      getAccountJwt
    );
  }
);
