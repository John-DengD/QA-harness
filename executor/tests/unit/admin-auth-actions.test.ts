import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  signInAdmin,
  signInAdminFromEnv,
  signInReadOnlyAdminFromEnv,
  signInSecondAdminFromEnv,
} from "../../src/actions/admin-auth-actions";

it("signs in once and returns the visible identity without exposing the password", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let submissions = 0;
    await page.route("http://test.local/login", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<label>Email<input type="email"></label>
          <label>Password<input type="password"></label>
          <button>Sign in</button>
          <script>document.querySelector('button').onclick = () => {
            fetch('/api/sign-in', { method: 'POST' }).then((response) => {
              if (response.ok) location.href = '/dashboard';
            });
          };</script>`,
      })
    );
    await page.route("http://test.local/api/sign-in", (route) => {
      submissions++;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.route("http://test.local/dashboard", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<footer data-sidebar="footer">qa@example.invalid</footer>',
      })
    );

    const fact = await signInAdmin(page, "qa@example.invalid", "not-a-real-password");
    expect(fact).toEqual({
      footerText: "qa@example.invalid",
      pageUrl: "http://test.local/dashboard",
    });
    expect(JSON.stringify(fact)).not.toContain("not-a-real-password");
    expect(submissions).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);

it("refuses to sign in from env when the admin credentials are absent", async () => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  delete process.env.E2E_ADMIN_EMAIL;
  delete process.env.E2E_ADMIN_PASSWORD;
  try {
    await expect(signInAdminFromEnv(undefined as never)).rejects.toThrow(
      "E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD"
    );
  } finally {
    if (email !== undefined) process.env.E2E_ADMIN_EMAIL = email;
    if (password !== undefined) process.env.E2E_ADMIN_PASSWORD = password;
  }
});

it.each([
  [signInSecondAdminFromEnv, "E2E_ADMIN_EMAIL2", "E2E_ADMIN_PASSWORD2"],
  [signInReadOnlyAdminFromEnv, "E2E_ADMIN_EMAIL3", "E2E_ADMIN_PASSWORD3"],
] as const)("binds each operator variant to its own env pair (%#)", async (action, emailKey, passwordKey) => {
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  delete process.env[emailKey];
  delete process.env[passwordKey];
  try {
    await expect(action(undefined as never)).rejects.toThrow(`${emailKey} and ${passwordKey}`);
  } finally {
    if (email !== undefined) process.env[emailKey] = email;
    if (password !== undefined) process.env[passwordKey] = password;
  }
});
