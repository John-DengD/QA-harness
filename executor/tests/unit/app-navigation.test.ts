import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

import { goToAppPath } from "../../src/tools/app-navigation";

let browser: Browser;
const originalOrigin = process.env.E2E_SHARED_BROWSER_ORIGIN;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.E2E_SHARED_BROWSER_ORIGIN;
  else process.env.E2E_SHARED_BROWSER_ORIGIN = originalOrigin;
});

async function localPage(baseURL?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  await page.route("**/*", (route) => route.fulfill({
    contentType: "text/html",
    body: "<main>app page</main>",
  }));
  return { context, page };
}

it("preserves Playwright baseURL navigation outside shared-browser mode", async () => {
  delete process.env.E2E_SHARED_BROWSER_ORIGIN;
  const { context, page } = await localPage("http://test.local");
  try {
    await goToAppPath(page, "/wallet?view=history");
    expect(page.url()).toBe("http://test.local/wallet?view=history");
  } finally {
    await context.close();
  }
});

it("resolves an app path on an existing CDP page without baseURL", async () => {
  process.env.E2E_SHARED_BROWSER_ORIGIN = "http://test.local";
  const { context, page } = await localPage();
  try {
    await page.goto("http://test.local/start");
    await goToAppPath(page, "/campaigns/new?draft=abc");
    expect(page.url()).toBe("http://test.local/campaigns/new?draft=abc");
  } finally {
    await context.close();
  }
});

it("rejects navigation from about:blank or a different origin", async () => {
  process.env.E2E_SHARED_BROWSER_ORIGIN = "http://test.local";
  const { context, page } = await localPage();
  try {
    await expect(goToAppPath(page, "/wallet")).rejects.toThrow("not on the expected app origin");
    expect(page.url()).toBe("about:blank");

    await page.goto("http://other.test/start");
    await expect(goToAppPath(page, "/wallet")).rejects.toThrow("not on the expected app origin");
    expect(page.url()).toBe("http://other.test/start");
  } finally {
    await context.close();
  }
});

it("rejects absolute and protocol-relative paths in shared-browser mode", async () => {
  process.env.E2E_SHARED_BROWSER_ORIGIN = "http://test.local";
  const { context, page } = await localPage();
  try {
    await page.goto("http://test.local/start");
    await expect(goToAppPath(page, "https://other.test/wallet")).rejects.toThrow("same-origin absolute path");
    await expect(goToAppPath(page, "//other.test/wallet")).rejects.toThrow("same-origin absolute path");
    await expect(goToAppPath(page, "/\\other.test/wallet")).rejects.toThrow("cannot leave the app origin");
    expect(page.url()).toBe("http://test.local/start");
  } finally {
    await context.close();
  }
});

it("rejects a shared origin with a path", async () => {
  process.env.E2E_SHARED_BROWSER_ORIGIN = "http://test.local/subpath";
  const { context, page } = await localPage();
  try {
    await page.goto("http://test.local/start");
    await expect(goToAppPath(page, "/wallet")).rejects.toThrow("must be a valid HTTP origin");
    expect(page.url()).toBe("http://test.local/start");
  } finally {
    await context.close();
  }
});
