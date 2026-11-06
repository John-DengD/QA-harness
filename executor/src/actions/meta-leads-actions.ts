import { expect, type Page } from "@playwright/test";

const pagePanel = (page: Page) => page.locator('[data-slot="meta-page-panel"]');
const formPanel = (page: Page) => page.locator('[data-slot="instant-form"]');

export interface MockGrantedMetaPage {
  id: string;
  name: string;
}

/**
 * Stand in for the real Nango OAuth popup: the popup is third-party UI
 * outside this app's DOM, so the only driveable boundary is the API response
 * our app reads right after it closes. Fulfills the authorized-pages read
 * with a fixed { pages } body (same shape the real backend returns), so
 * openMetaPagePicker finds Pages to choose from without a real customer
 * completing Meta authorization.
 */
export async function mockMetaCustomerAuthorization(
  page: Page,
  pages: MockGrantedMetaPage[]
): Promise<{ mocked: true }> {
  await page.route(
    "**/api/v1/integrations/meta/page/authorized-pages",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ pages }),
      }),
    { times: 1 }
  );
  return { mocked: true };
}

export async function openMetaPagePicker(page: Page): Promise<{ pickerVisible: boolean }> {
  const panel = pagePanel(page);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: /^(?:Choose Page|Connect Facebook Page|Change Page)$/ }).click();
  const picker = panel.getByRole("radiogroup", { name: "Facebook Page" });
  await expect(picker).toBeVisible();
  return { pickerVisible: true };
}

export async function selectMetaPage(page: Page, name: string): Promise<{ selectedPage: string }> {
  const panel = pagePanel(page);
  const picker = panel.getByRole("radiogroup", { name: "Facebook Page" });
  const search = panel.getByRole("textbox", { name: "Search Facebook Pages" });
  if (await search.isVisible().catch(() => false)) await search.fill(name);
  const choice = picker.getByRole("radio").filter({ hasText: name });
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(choice).toHaveAttribute("aria-checked", "true");
  return { selectedPage: name };
}

// Binding changes the organization's Page; callers must choose the intended org first.
export async function bindSelectedMetaPage(page: Page, name: string): Promise<{ boundPage: string }> {
  const panel = pagePanel(page);
  await expect(panel.getByRole("radio").filter({ hasText: name }))
    .toHaveAttribute("aria-checked", "true");
  await panel.getByRole("button", { name: /^(?:Use This Page|Change to This Page)$/ }).click();
  await expect(panel).toContainText(`Facebook Page · ${name}`, { timeout: 30_000 });
  return { boundPage: name };
}

export async function readMetaPageBinding(page: Page): Promise<{ pageName: string; connected: boolean }> {
  const panel = pagePanel(page);
  await expect(panel).toBeVisible();
  const text = await panel.innerText();
  const pageName = /Facebook Page\s*·\s*([^\n]+)/.exec(text)?.[1]?.trim() ?? "";
  return { pageName, connected: pageName !== "" };
}

export async function openInstantFormEditor(page: Page): Promise<{ editorVisible: boolean }> {
  const form = formPanel(page);
  await form.getByRole("button", { name: "Edit Form" }).click();
  await expect(form.locator('[data-slot="instant-form-editor"]')).toBeVisible();
  return { editorVisible: true };
}

export async function fillInstantFormPolicyUrl(page: Page, url: string): Promise<{ policyUrl: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Policy URL must use HTTPS");
  const input = formPanel(page).getByRole("textbox", { name: "Policy URL" });
  await input.fill(url);
  await expect(input).toHaveValue(url);
  return { policyUrl: url };
}

export async function saveInstantForm(page: Page): Promise<{ saved: boolean; message: string }> {
  const form = formPanel(page);
  const save = form.getByRole("button", { name: "Save Changes" });
  await expect(save).toBeEnabled();
  await save.click();
  const status = form.getByRole("status");
  await expect(status).toContainText("Form saved", { timeout: 30_000 });
  return { saved: true, message: (await status.innerText()).trim() };
}

export async function readInstantFormReadiness(page: Page): Promise<{
  ready: boolean;
  summary: string;
  formText: string;
}> {
  const summary = await page.locator('[data-slot="launch-readiness"]').innerText();
  const formText = await formPanel(page).innerText();
  return { ready: /Draft ready for review/i.test(summary) && /Instant Form\s+Ready/i.test(summary), summary, formText };
}

export async function setFullAutoEnrollment(page: Page, enabled: boolean): Promise<{ enabled: boolean }> {
  const toggle = page.getByRole("switch", { name: "Enroll in Full-Auto Optimization" });
  await expect(toggle).toBeVisible();
  if ((await toggle.isChecked()) !== enabled) await toggle.click();
  await expect.poll(() => toggle.isChecked()).toBe(enabled);
  return { enabled: await toggle.isChecked() };
}

export async function openCustomerCampaign(page: Page, campaignId: string): Promise<{ url: string }> {
  await page.goto(`/campaigns/${encodeURIComponent(campaignId)}`);
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}(?:[?#]|$)`));
  return { url: page.url() };
}

export async function readCustomerCampaignAndWallet(page: Page): Promise<{
  status: string;
  reserved: string;
  available: string;
}> {
  const body = await page.locator("body").innerText();
  return {
    status: /\b(LAUNCHING|IN REVIEW|ACTIVE|CANCELLED)\b/i.exec(body)?.[1] ?? "",
    reserved: /RESERVED\s*(\$[\d,.]+)/i.exec(body)?.[1] ?? "",
    available: /AVAILABLE\s*(\$[\d,.]+)/i.exec(body)?.[1] ?? "",
  };
}

export async function openCustomerCancelConfirmation(page: Page): Promise<{ dialogText: string }> {
  await page.getByRole("button", { name: "Cancel Campaign" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel This Campaign?" });
  await expect(dialog).toBeVisible();
  return { dialogText: await dialog.innerText() };
}

// Commit exactly once. A missing response is action_unknown; inspect the Campaign before any retry.
export async function cancelCustomerCampaignOnce(page: Page, campaignId: string): Promise<{
  responseStatus: number | null;
  dialogText: string;
}> {
  if (!new URL(page.url()).pathname.endsWith(`/campaigns/${campaignId}`)) {
    throw new Error(`The open Campaign does not match ${campaignId}`);
  }
  const dialog = page.getByRole("alertdialog", { name: "Cancel This Campaign?" });
  await expect(dialog).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() !== "GET" &&
    new URL(response.url()).pathname.endsWith(`/api/v1/campaigns/${campaignId}/cancel`),
  { timeout: 30_000 }).catch(() => null);
  await dialog.getByRole("button", { name: "Cancel Campaign" }).click();
  const response = await responsePromise;
  return { responseStatus: response?.status() ?? null, dialogText: await dialog.innerText().catch(() => "") };
}

export async function openMetaPageDisconnectConfirmation(page: Page): Promise<{ dialogText: string }> {
  const panel = pagePanel(page);
  await panel.getByRole("button", { name: "Disconnect Page" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Disconnect Facebook Page?" });
  await expect(dialog).toBeVisible();
  return { dialogText: await dialog.innerText() };
}

// Commit exactly once. Reversible: re-run openMetaPagePicker -> selectMetaPage -> bindSelectedMetaPage
// to rebind a Page; Hellyeah's own Meta-side grant is left intact by the backend regardless of outcome.
// A 409 here is a real refusal (Page changed, or still in use by a dependent campaign/lead flow/other
// org) -- not a transient failure -- so do not retry without first calling readMetaPageBinding.
export async function disconnectMetaPageOnce(page: Page): Promise<{
  responseStatus: number | null;
  disconnected: boolean;
  dialogText: string;
}> {
  const dialog = page.getByRole("alertdialog", { name: "Disconnect Facebook Page?" });
  await expect(dialog).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() !== "GET" &&
    new URL(response.url()).pathname.endsWith("/api/v1/integrations/meta/page/disconnect"),
  { timeout: 30_000 }).catch(() => null);
  await dialog.getByRole("button", { name: "Disconnect Page" }).click();
  const response = await responsePromise;
  const status = response?.status() ?? null;
  if (status !== null && status >= 400) {
    return { responseStatus: status, disconnected: false, dialogText: await dialog.innerText().catch(() => "") };
  }
  const panel = pagePanel(page);
  await expect(panel.getByRole("button", { name: /^(?:Choose Page|Connect Facebook Page)$/ }))
    .toBeVisible({ timeout: 30_000 });
  return { responseStatus: status, disconnected: true, dialogText: "" };
}
