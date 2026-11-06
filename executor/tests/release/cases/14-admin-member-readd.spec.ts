import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { test, expect } from "@playwright/test";

import { signInAdmin } from "../../../src/actions/admin-auth-actions";
import {
  createAdminMember,
  removeAdminMember,
} from "../../../src/actions/admin-team-actions";

const adminUrl = process.env.E2E_BASE_URL ?? "";
const operatorEmail = process.env.E2E_ADMIN_EMAIL ?? "";
const operatorPassword = process.env.E2E_ADMIN_PASSWORD ?? "";

test.use({ baseURL: adminUrl, screenshot: "off", trace: "off", video: "on" });

test("re-adding an Admin member preserves the original password", async ({ browser, page }, testInfo) => {
  test.skip(
    !adminUrl || !operatorEmail || !operatorPassword,
    "Admin sandbox URL and test operator credentials are required"
  );
  const host = new URL(adminUrl).hostname;
  if (!/^hellyeah-admin-[a-z0-9-]+\.vercel\.app$/.test(host)) {
    throw new Error("This member lifecycle test only runs against a PR Admin sandbox");
  }

  const email = `qa-member-readd-${randomBytes(6).toString("hex")}@example.invalid`;
  const name = "QA Member Re-add";
  const originalPassword = `${randomBytes(20).toString("base64url")}A1!`;
  const replacementPassword = `${randomBytes(20).toString("base64url")}B2!`;
  const input = { email, name };
  const statePath = testInfo.outputPath("member-run.json");
  const recordState = async (stage: string, memberVisible: boolean | null) =>
    writeFile(
      statePath,
      `${JSON.stringify({ email, stage, memberVisible, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 }
    );

  expect((await signInAdmin(page, operatorEmail, operatorPassword)).footerText).toContain(operatorEmail);
  await recordState("before-create", false);
  let primaryFailure: unknown = null;
  try {
    const first = await createAdminMember(page, { ...input, password: originalPassword });
    await recordState("after-create", first.memberVisible);
    expect(first, "initial creation must be confirmed before removal").toMatchObject({
      outcome: "created",
      memberVisible: true,
    });

    const removed = await removeAdminMember(page, input);
    await recordState("after-first-remove", removed.memberVisible);
    expect(removed, "membership must be absent before re-add").toMatchObject({
      outcome: "removed",
      memberVisible: false,
    });

    const readded = await createAdminMember(page, { ...input, password: replacementPassword });
    await recordState("after-readd", readded.memberVisible);
    expect(readded, "existing account must be reactivated, not created anew").toMatchObject({
      outcome: "recreated",
      memberVisible: true,
    });

    const subject = await browser.newContext({
      baseURL: adminUrl,
      recordVideo: { dir: testInfo.outputPath("subject-video") },
      storageState: undefined,
    });
    try {
      const subjectPage = await subject.newPage();
      expect((await signInAdmin(subjectPage, email, originalPassword)).footerText).toContain(email);
      await expect(subjectPage.locator('[data-sidebar="footer"]')).toContainText(email);
      await recordState("original-password-verified", true);
    } finally {
      await subject.close();
    }
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      const cleanup = await removeAdminMember(page, input);
      expect(["removed", "absent"], "cleanup must have a confirmed outcome")
        .toContain(cleanup.outcome);
      expect(cleanup.memberVisible, "synthetic membership must be cleaned up").toBe(false);
      await recordState("cleanup-verified", false);
    } catch (cleanupError) {
      await recordState("cleanup-unknown", null);
      if (!primaryFailure) throw cleanupError;
      console.error("Synthetic Admin member cleanup also failed", cleanupError);
    }
  }
});
