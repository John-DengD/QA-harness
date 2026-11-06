import { expect, type Page } from "@playwright/test";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Authorize Meta account" });

export interface MockByoAdAccount {
  alreadyConnected: boolean;
  businessId: string | null;
  businessName: string | null;
  name: string;
  platformAccountId: string;
  platformStatus: string;
}

export interface MockByoPage {
  id: string;
  name: string;
}

/**
 * Stand in for the real Meta OAuth popup: the popup is third-party UI outside
 * this app's DOM, so the only driveable boundary is the API response our app
 * reads right after it. Fulfills the resolve-session poll with a fixed
 * ByoMetaResolveResult-shaped body (same fields the real backend returns),
 * so ConnectMetaByoDialog advances from "waiting" straight to "review"
 * without a real customer completing authorization.
 */
export async function mockMetaByoAuthorization(
  page: Page,
  orgId: string,
  options: {
    adAccounts: MockByoAdAccount[];
    pages: MockByoPage[];
    authorizedBy?: { id: string; name: string };
    connectionId?: string;
  }
): Promise<{ mocked: true }> {
  const connectionId = options.connectionId ?? "mock-connection-id";
  const authorizedBy = options.authorizedBy ?? { id: "mock-user-id", name: "Mock Authorizer" };
  await page.route(
    `**/api/proxy/api/admin/managed-ads/admin/organizations/${orgId}/meta-byo/resolve`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          adAccounts: options.adAccounts,
          authorizedBy,
          connectionId,
          pages: options.pages,
          providerConfigKey: "meta-byo",
        }),
      }),
    { times: 1 }
  );
  return { mocked: true };
}

export async function openMetaByoAuthorizationDialog(page: Page): Promise<{ dialogVisible: boolean }> {
  await page.getByRole("button", { name: /^(?:Connect Meta Account|Authorize Meta account)$/ }).click();
  await expect(dialog(page)).toBeVisible();
  return { dialogVisible: true };
}

export async function startMetaByoAuthorizationLink(page: Page): Promise<{ waiting: boolean }> {
  await dialog(page).getByRole("button", { name: "Create authorization link" }).click();
  await expect(dialog(page).getByText("Waiting for the customer to finish authorizing...")).toBeVisible({
    timeout: 15_000,
  });
  return { waiting: true };
}

// Depends on mockMetaByoAuthorization's route having been installed first; otherwise this
// polls the real backend, which has no session to resolve and never reaches "review".
export async function waitForMockedMetaByoReview(page: Page): Promise<{ reviewVisible: boolean }> {
  await expect(dialog(page).getByRole("combobox", { name: "Ad account" })).toBeVisible({ timeout: 15_000 });
  await expect(dialog(page).getByRole("combobox", { name: "Facebook Page" })).toBeVisible();
  return { reviewVisible: true };
}

export async function selectMetaByoAdAccount(page: Page, name: string): Promise<{ selected: string }> {
  await dialog(page).getByRole("combobox", { name: "Ad account" }).click();
  await page.getByRole("option", { name, exact: false }).click();
  return { selected: name };
}

export async function selectMetaByoPage(page: Page, name: string): Promise<{ selected: string }> {
  await dialog(page).getByRole("combobox", { name: "Facebook Page" }).click();
  await page.getByRole("option", { name, exact: false }).click();
  return { selected: name };
}

export async function confirmMetaByoAdoptExistingAccount(page: Page): Promise<{ confirmed: boolean }> {
  const checkbox = dialog(page).getByRole("checkbox", { name: /already connected/i });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  return { confirmed: true };
}

// Commit exactly once. No existing Action undoes an import; removing the resulting ad
// account/Page binding is an admin-only manual step outside this dialog.
export async function importMetaByoAdAccountOnce(page: Page, orgId: string): Promise<{
  responseStatus: number | null;
  imported: boolean;
}> {
  const importButton = dialog(page).getByRole("button", { name: "Import" });
  await expect(importButton).toBeEnabled();
  const responsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() !== "GET" &&
        new URL(response.url()).pathname.endsWith(
          `/api/admin/managed-ads/admin/organizations/${orgId}/meta-byo/import`
        ),
      { timeout: 30_000 }
    )
    .catch(() => null);
  await importButton.click();
  const response = await responsePromise;
  const status = response?.status() ?? null;
  const imported = status !== null && status < 400;
  if (imported) await expect(dialog(page)).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
  return { responseStatus: status, imported };
}
