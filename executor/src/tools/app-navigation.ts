import type { Page } from "@playwright/test";

export async function goToAppPath(page: Page, appPath: string) {
  const sharedOrigin = process.env.E2E_SHARED_BROWSER_ORIGIN;
  if (!sharedOrigin) return page.goto(appPath);

  if (!appPath.startsWith("/") || appPath.startsWith("//")) {
    throw new Error("Shared-browser navigation requires a same-origin absolute path");
  }

  let origin: URL;
  try {
    origin = new URL(sharedOrigin);
  } catch {
    throw new Error("E2E_SHARED_BROWSER_ORIGIN must be a valid HTTP origin");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username || origin.password || origin.pathname !== "/" ||
    origin.search || origin.hash
  ) {
    throw new Error("E2E_SHARED_BROWSER_ORIGIN must be a valid HTTP origin");
  }

  let current: URL;
  try {
    current = new URL(page.url());
  } catch {
    throw new Error("Shared-browser page is not on the expected app origin");
  }
  if (current.origin !== origin.origin) {
    throw new Error("Shared-browser page is not on the expected app origin");
  }

  const destination = new URL(appPath, origin.origin);
  if (destination.origin !== origin.origin) {
    throw new Error("Shared-browser navigation cannot leave the app origin");
  }
  return page.goto(destination.href);
}
