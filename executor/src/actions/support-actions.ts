import type { Locator, Page } from "@playwright/test";

const widgetFrame = (page: Page): Locator =>
  page.locator('iframe[src*="/widget"]').first();

const marketingFooter = (page: Page): Locator => page.getByRole("contentinfo");

const dashboardAccountTrigger = (page: Page): Locator =>
  // The deployed dashboard wraps the account row in the shared SidebarFooter
  // primitive, while Radix's DropdownMenuTrigger is rendered as the plain
  // account button because of `asChild`. Keep this scoped to the footer and
  // select the last button so the atom follows the product DOM, not Radix's
  // internal data attributes.
  page.locator('[data-slot="sidebar-footer"] button').last();

const dashboardMenu = (page: Page): Locator => page.getByRole("menu");

const dashboardSupport = (page: Page): Locator =>
  dashboardMenu(page).getByRole("menuitem", { name: "Support", exact: true });

const dashboardDocs = (page: Page): Locator =>
  dashboardMenu(page).getByRole("menuitem", { name: "Docs", exact: true });

const isWidgetSdkReady = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    typeof (window as Window & { $chatwoot?: { toggle?: unknown } }).$chatwoot?.toggle ===
    "function"
  );

const waitForWidgetSdk = async (page: Page): Promise<boolean> => {
  try {
    await page.waitForFunction(
      () =>
        typeof (window as Window & { $chatwoot?: { toggle?: unknown } }).$chatwoot
          ?.toggle === "function",
      null,
      { timeout: 20_000 }
    );
    return true;
  } catch {
    return false;
  }
};

export interface SupportWidgetFact {
  sdkReady: boolean;
  bubbleHolderAttached: boolean;
  floatingBubbleVisible: boolean;
  widgetFrameVisible: boolean;
  widgetBrandVisible: boolean;
}

export interface SupportOpenFact extends SupportWidgetFact {
  entryVisible: boolean;
  entryEnabled: boolean;
  clicked: boolean;
}

export interface AccountSupportMenuFact {
  menuVisible: boolean;
  supportVisible: boolean;
  supportEnabled: boolean;
  docsVisible: boolean;
}

export interface SupportNavigationFact {
  destinationHref: string | null;
  openedUrl: string;
  openedInNewTab: boolean;
}

export interface ContactNavigationFact {
  destinationHref: string | null;
  finalUrl: string;
}

// Read-only: scope the negative launcher observation to Chatwoot itself.
export async function observeSupportWidget(page: Page): Promise<SupportWidgetFact> {
  const frame = widgetFrame(page);
  const frameVisible = await frame.isVisible();
  return {
    sdkReady: await isWidgetSdkReady(page),
    bubbleHolderAttached: (await page.locator("#cw-bubble-holder").count()) > 0,
    floatingBubbleVisible: await page
      .locator('#cw-bubble-holder button[title="Open chat window"]')
      .isVisible()
      .catch(() => false),
    widgetFrameVisible: frameVisible,
    widgetBrandVisible: frameVisible
      ? await frame.contentFrame().getByText("Powered by Chatwoot").isVisible().catch(() => false)
      : false,
  };
}

const observeOpenedWidget = async (page: Page): Promise<SupportWidgetFact> => {
  await widgetFrame(page).waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  return observeSupportWidget(page);
};

// Opens the widget only; never starts a conversation or sends a message.
export async function openMarketingSupport(page: Page): Promise<SupportOpenFact> {
  const entry = marketingFooter(page).getByRole("button", { name: "Support", exact: true });
  const sdkReady = await waitForWidgetSdk(page);
  const entryVisible = await entry.isVisible();
  const entryEnabled = entryVisible && await entry.isEnabled();
  const clicked = sdkReady && entryEnabled;
  if (clicked) await entry.click();
  return {
    ...(clicked ? await observeOpenedWidget(page) : await observeSupportWidget(page)),
    entryVisible,
    entryEnabled,
    clicked,
  };
}

export async function openDashboardAccountMenu(page: Page): Promise<AccountSupportMenuFact> {
  await dashboardAccountTrigger(page).click();
  const menu = dashboardMenu(page);
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  const support = dashboardSupport(page);
  return {
    menuVisible: await menu.isVisible(),
    supportVisible: await support.isVisible(),
    supportEnabled: await support.isEnabled(),
    docsVisible: await dashboardDocs(page).isVisible(),
  };
}

export async function openDashboardSupport(page: Page): Promise<SupportOpenFact> {
  const entry = dashboardSupport(page);
  const entryVisible = await entry.isVisible();
  const sdkReady = await waitForWidgetSdk(page);
  if (entryVisible && sdkReady) {
    await entry.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const menu = document.querySelector('[role="menu"]');
        const support = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])]
          .find((item) => item.textContent?.trim() === "Support");
        return support && !support.hasAttribute("disabled") &&
          support.getAttribute("aria-disabled") !== "true";
      },
      null,
      { timeout: 20_000 }
    ).catch(() => undefined);
  }
  const entryEnabled = entryVisible && await entry.isEnabled();
  const clicked = sdkReady && entryEnabled;
  if (clicked) await entry.click();
  return {
    ...(clicked ? await observeOpenedWidget(page) : await observeSupportWidget(page)),
    entryVisible,
    entryEnabled,
    clicked,
  };
}

const openDocs = async (page: Page, entry: Locator): Promise<SupportNavigationFact> => {
  const destinationHref = await entry.getAttribute("href");
  const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
  // Radix closes its menu on pointer-down. A normal Playwright click can
  // therefore detach the asChild anchor before its click event is dispatched;
  // invoke the same DOM click intent directly so target=_blank navigation is
  // observable without racing the menu teardown.
  await entry.evaluate((element) => (element as HTMLAnchorElement).click());
  const popup = await popupPromise;
  if (!popup) {
    return { destinationHref, openedUrl: page.url(), openedInNewTab: false };
  }
  try {
    await popup.waitForURL((url) => url.href !== "about:blank", { timeout: 10_000 })
      .catch(() => undefined);
    return { destinationHref, openedUrl: popup.url(), openedInNewTab: true };
  } finally {
    await popup.close();
  }
};

export async function openMarketingFooterDocs(page: Page): Promise<SupportNavigationFact> {
  return openDocs(page, marketingFooter(page).getByRole("link", { name: "Docs", exact: true }));
}

export async function openDashboardDocs(page: Page): Promise<SupportNavigationFact> {
  const menu = dashboardMenu(page);
  if (!(await menu.isVisible().catch(() => false))) {
    await dashboardAccountTrigger(page).click();
    await menu.waitFor({ state: "visible", timeout: 10_000 });
  }
  return openDocs(page, dashboardDocs(page));
}

export async function openMarketingFooterContact(page: Page): Promise<ContactNavigationFact> {
  const entry = marketingFooter(page).getByRole("link", { name: "Contact", exact: true });
  const destinationHref = await entry.getAttribute("href");
  await entry.click();
  if (destinationHref) {
    await page.waitForURL((url) => url.pathname === new URL(destinationHref, url).pathname, {
      timeout: 10_000,
    }).catch(() => undefined);
  }
  return { destinationHref, finalUrl: page.url() };
}
