import { expect, type Page } from "@playwright/test";

const ensureCampaign = (page: Page, campaignId: string): void => {
  if (!new URL(page.url()).pathname.endsWith(`/campaigns/${campaignId}`)) {
    throw new Error(`The open Admin Campaign does not match ${campaignId}`);
  }
};

export async function openAdminCampaign(page: Page, campaignId: string): Promise<{ url: string }> {
  await page.goto(`/campaigns/${encodeURIComponent(campaignId)}`);
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}(?:[?#]|$)`));
  return { url: page.url() };
}

export async function selectAdminCampaignVersion(
  page: Page, version: number
): Promise<{ version: number; viewText: string }> {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid Campaign version");
  await page.getByRole("combobox", { name: "Campaign version" }).click();
  await page.getByRole("option", { name: `Campaign v${version}`, exact: false }).click();
  const viewText = await page.locator("body").innerText();
  return { version, viewText };
}

export async function readAdminMetaLeadForm(page: Page): Promise<{ formText: string }> {
  const form = page.locator('[data-slot="card"]')
    .filter({ has: page.getByText("Instant Form", { exact: true }) }).first();
  await expect(form).toBeVisible();
  return { formText: await form.innerText() };
}

export async function readAdminMetaPageCapability(page: Page): Promise<{
  pageText: string;
  leadWebhookText: string;
}> {
  const label = page.getByText("Lead webhook", { exact: true });
  await expect(label).toBeVisible();
  const row = label.locator("xpath=..");
  return { pageText: await page.locator("body").innerText(), leadWebhookText: await row.innerText() };
}

export async function readAdminAdAccount(page: Page): Promise<{ accountText: string }> {
  await page.getByRole("tab", { name: "Ad Account" }).click();
  return { accountText: await page.locator("body").innerText() };
}

export async function readAdminMetaResources(page: Page): Promise<{
  adSet: string;
  creative: string;
  ad: string;
}> {
  const card = page.locator('[data-slot="card"]')
    .filter({ has: page.getByText("Meta delivery", { exact: true }) }).first();
  await expect(card).toBeVisible();
  const readRow = async (label: string): Promise<string> => card.getByText(label, { exact: true })
    .locator("xpath=..").innerText();
  return {
    adSet: await readRow("Ad set"),
    creative: await readRow("Creative"),
    ad: await readRow("Ad"),
  };
}

export async function openAdminApprovalPreview(
  page: Page, campaignId: string
): Promise<{ readiness: string }> {
  ensureCampaign(page, campaignId);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Approve campaign" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Launch readiness")).toBeVisible();
  await expect(dialog.getByText(/^(?:Launchable|Not launchable|Check failed)$/)).toBeVisible({ timeout: 30_000 });
  return { readiness: await dialog.innerText() };
}

export async function fillAdminApprovalReason(page: Page, reason: string): Promise<{ reason: string }> {
  if (!reason.trim()) throw new Error("Approval reason must not be empty");
  const dialog = page.getByRole("dialog", { name: "Approve campaign" });
  await dialog.getByRole("textbox", { name: "Approval reason" }).fill(reason);
  return { reason };
}

// Commit once. The caller reads Campaign state before considering any retry.
export async function approveAdminCampaignOnce(page: Page, campaignId: string): Promise<{
  responseStatus: number | null;
  currentStatus: string;
}> {
  ensureCampaign(page, campaignId);
  const dialog = page.getByRole("dialog", { name: "Approve campaign" });
  await expect(dialog.getByRole("textbox", { name: "Approval reason" })).not.toBeEmpty();
  const submit = dialog.getByRole("button", { name: "Approve", exact: true });
  await expect(submit).toBeEnabled();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() !== "GET" &&
    new URL(response.url()).pathname.endsWith(
      `/api/admin/managed-ads/admin/campaigns/${campaignId}/approve`
    ),
  { timeout: 30_000 }).catch(() => null);
  await submit.click();
  const response = await responsePromise;
  const currentStatus = await page.locator("body").innerText();
  return { responseStatus: response?.status() ?? null, currentStatus };
}

export async function readAdminSetupOutcome(page: Page, campaignId: string): Promise<{
  setupPending: boolean;
  leadWebhookText: string;
  providerText: string;
  campaignText: string;
}> {
  ensureCampaign(page, campaignId);
  const campaignText = await page.locator("body").innerText();
  const leadWebhookText = await page.getByText("Lead webhook", { exact: true })
    .locator("xpath=..").innerText().catch(() => "");
  const providerText = await page.getByText("Provider operation", { exact: true })
    .locator("xpath=ancestor::section[1]").innerText().catch(() => "");
  return { setupPending: /Setup Pending/i.test(campaignText), leadWebhookText, providerText, campaignText };
}
