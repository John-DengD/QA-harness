import { expect, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

export interface AdminSignInFact {
  footerText: string;
  pageUrl: string;
}

export async function signInAdmin(
  page: Page,
  email: string,
  password: string
): Promise<AdminSignInFact> {
  await goToAppPath(page, "/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  const footer = page.locator('[data-sidebar="footer"]');
  await expect(footer).toBeVisible();
  return {
    footerText: await footer.innerText(),
    pageUrl: page.url(),
  };
}

async function signInAdminWithEnv(
  page: Page,
  emailKey: string,
  passwordKey: string
): Promise<AdminSignInFact> {
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  if (!email || !password) {
    throw new Error(`${emailKey} and ${passwordKey} must be set in qa-env/.env.local`);
  }
  return signInAdmin(page, email, password);
}

/**
 * Shared-E2B entry point for admin sign-in.
 *
 * Takes no arguments on purpose: `signInAdmin` needs a password, and anything
 * passed through `e2b:action --args-json` lands in the shell history and the
 * host process list. Reading the credentials from the already-loaded qa-env
 * keeps them inside this process, so this is the variant that is safe to audit
 * for shared execution.
 */
export async function signInAdminFromEnv(page: Page): Promise<AdminSignInFact> {
  return signInAdminWithEnv(page, "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD");
}

/**
 * Second write operator (`qa-admin-2`). Exists for the two-operator race on the
 * same object; one variant per account instead of an account argument, so the
 * audited policy never accepts a caller-chosen identity.
 */
export async function signInSecondAdminFromEnv(page: Page): Promise<AdminSignInFact> {
  return signInAdminWithEnv(page, "E2E_ADMIN_EMAIL2", "E2E_ADMIN_PASSWORD2");
}

/**
 * Read-only operator (`qa-admin-ro`). Signing in proves nothing about the role:
 * the role is product-side configuration and drifts, so callers must read the
 * effective permission before asserting a denial.
 */
export async function signInReadOnlyAdminFromEnv(page: Page): Promise<AdminSignInFact> {
  return signInAdminWithEnv(page, "E2E_ADMIN_EMAIL3", "E2E_ADMIN_PASSWORD3");
}
