import { expect, type Locator, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

import {
  observeCampaignDraftStable,
  observeCampaignLaunchButton,
} from "./campaign-actions";

export interface MetaBrandProfileFact {
  appStoreUrl: string;
  metaApplicationId: string;
  metaPixelId: string;
}

export interface MetaCampaignFact {
  agentStillRunning: boolean;
  campaignType: string;
  deliveryOptimization: string;
  draftTitle: string;
  launchEnabled: boolean;
  pageText: string;
  readiness: string;
  url: string;
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const organizationName = (name: string): RegExp =>
  new RegExp(escapeRegExp(name), "i");

export async function selectOrganization(
  page: Page,
  name: string
): Promise<{ activeOrganization: string }> {
  await goToAppPath(page, "/");
  const switcher = page
    .locator('button:has(svg[class*="lucide-chevrons-up-down"])')
    .first();
  await expect(switcher, "The organization switcher must be available").toBeVisible({
    timeout: 30_000,
  });
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/proxy/api/v1/me");
    if (!response.ok) throw new Error("Cannot verify organization membership");
    return await response.json() as { orgs?: { id: string; name: string }[] };
  });
  const matches = (identity.orgs ?? []).filter((org) => org.name === name);
  if (matches.length !== 1) throw new Error(`Organization ${name} is missing or ambiguous`);
  const target = matches[0];
  const selection = () => page.evaluate(() => {
    const button = document.querySelector('button:has(svg[class*="lucide-chevrons-up-down"])');
    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith("hellyeah:active-org:"));
    return {
      name: button?.textContent?.trim() ?? "",
      id: keys.length === 1 ? sessionStorage.getItem(keys[0]) : null,
      menuOpen: button?.getAttribute("aria-expanded") === "true",
    };
  });
  const current = await selection();
  if (current.name !== target.name || current.id !== target.id) {
    if (!current.menuOpen) await switcher.click();
    const option = page.getByRole("menuitem", { name: organizationName(name) });
    await expect(option, `Organization ${name} must be available`).toBeVisible({timeout:15_000});
    await option.click();
  } else if (current.menuOpen) {
    await page.keyboard.press("Escape");
  }
  // The named button alone can match a transient menu choice or optimistic
  // render. Require the actual switcher and persisted active-org selection.
  let consecutive = 0;
  await expect.poll(async () => {
    const observed = await selection();
    consecutive = observed.name === target.name && observed.id === target.id && !observed.menuOpen
      ? consecutive + 1 : 0;
    return consecutive >= 3;
  }, {timeout:30_000,intervals:[250]}).toBe(true);
  return { activeOrganization: (await selection()).name };
}

export async function openMetaBrandEditor(
  page: Page
): Promise<{ pageUrl: string; assetsVisible: boolean }> {
  await goToAppPath(page, "/brand?edit=true");
  await expect(page.getByRole("heading", { name: "Edit Brand" })).toBeVisible({
    timeout: 30_000,
  });
  const assets = page.getByRole("region", { name: "Meta Campaign Assets" });
  await expect(assets).toBeVisible({ timeout: 60_000 });
  return { pageUrl: page.url(), assetsVisible: await assets.isVisible() };
}

const storeListing = (page: Page): Locator =>
  page.getByLabel("Store Listing").or(page.getByLabel("App Store Link"));

export async function inspectMetaBrandProfile(page: Page): Promise<MetaBrandProfileFact> {
  const app = page.getByLabel("App To Advertise");
  const store = storeListing(page);
  const pixel = page.getByLabel("Website Purchase Pixel");
  await expect(app).toBeVisible({ timeout: 30_000 });
  await expect(pixel).toBeVisible({ timeout: 30_000 });
  const pixelValue = await pixel.inputValue();
  const pixelOption = await pixel.locator("option:checked").innerText();
  return {
    appStoreUrl: await store.inputValue().catch(() => ""),
    metaApplicationId: await app.inputValue(),
    metaPixelId: pixelValue || (/^Automatic:/i.test(pixelOption) ? "automatic" : ""),
  };
}

const saveMetaSelection = async (page: Page): Promise<{ saveNoticeVisible: boolean }> => {
  await page.getByRole("button", { name: "Save Meta Selection" }).click();
  const notice = page.getByText(
    "Meta selection saved. Readiness is checking the updated setup."
  );
  await expect(notice).toBeVisible({ timeout: 30_000 });
  return { saveNoticeVisible: await notice.isVisible() };
};

export async function clearMetaBrandApp(
  page: Page
): Promise<{ metaApplicationId: string; saveNoticeVisible: boolean }> {
  const app = page.getByLabel("App To Advertise");
  await app.selectOption("");
  const saved = await saveMetaSelection(page);
  return { metaApplicationId: await app.inputValue(), ...saved };
}

export async function restoreMetaBrandProfile(
  page: Page,
  profile: MetaBrandProfileFact
): Promise<{ profile: MetaBrandProfileFact; saveNoticeVisible: boolean }> {
  await page.getByLabel("App To Advertise").selectOption(profile.metaApplicationId);
  const store = storeListing(page);
  await expect(store).toBeVisible({ timeout: 30_000 });
  if (await store.evaluate((element) => element.tagName === "SELECT")) {
    await store.selectOption(profile.appStoreUrl);
  } else {
    await store.fill(profile.appStoreUrl);
  }
  if (profile.metaPixelId !== "automatic") {
    await page.getByLabel("Website Purchase Pixel").selectOption(profile.metaPixelId);
  }
  const saved = await saveMetaSelection(page);
  return { profile: await inspectMetaBrandProfile(page), ...saved };
}

export async function openMetaDraftComposer(
  page: Page
): Promise<{ pageUrl: string; existingDraftVisible: boolean }> {
  await goToAppPath(page, "/campaigns/new");
  return {
    pageUrl: page.url(),
    existingDraftVisible: await page
      .getByRole("button", { name: "Discard Draft" })
      .isVisible()
      .catch(() => false),
  };
}

export async function discardMetaDraft(page: Page): Promise<{ discarded: boolean }> {
  const discard = page.getByRole("button", { name: "Discard Draft" });
  await expect(discard).toBeVisible();
  await discard.click();
  await expect(discard).toBeHidden({ timeout: 30_000 });
  return { discarded: true };
}

export async function selectMetaCampaign(
  page: Page
): Promise<{ goalInputVisible: boolean }> {
  const meta = page.getByRole("button", { name: "Run Meta campaign" });
  await expect(meta).toBeVisible({ timeout: 30_000 });
  await meta.click();
  const goal = page.getByPlaceholder("Launch a campaign to drive trial signups…");
  await expect(goal).toBeVisible({ timeout: 30_000 });
  return { goalInputVisible: await goal.isVisible() };
}

const metaRow = (page: Page, label: string): Locator =>
  page.getByText(label, { exact: true }).locator("../../../..");

export async function waitForMetaCampaignDraft(
  page: Page
): Promise<{ state: "settled" | "blocked" }> {
  let state: "settled" | "blocked" | "pending" = "pending";
  await expect
    .poll(
      async () => {
        if ((await observeCampaignDraftStable(page)).visible) return (state = "settled");
        if (
          await page
            .getByRole("link", { name: /(?:Edit|Review) Brand Profile/i })
            .isVisible()
            .catch(() => false)
        ) {
          return (state = "blocked");
        }
        return "pending";
      },
      { timeout: 7 * 60_000 }
    )
    .not.toBe("pending");
  if (state === "pending") throw new Error("Meta campaign draft did not settle");
  return { state };
}

export async function inspectMetaCampaignDraft(page: Page): Promise<MetaCampaignFact> {
  const campaignType = metaRow(page, "Campaign type");
  const delivery = metaRow(page, "Delivery Optimization");
  const readiness = page.locator('[data-slot="launch-readiness"]');
  return {
    agentStillRunning: await page
      .getByText(/Drafting|Working|Thinking/i)
      .first()
      .isVisible()
      .catch(() => false),
    campaignType: await campaignType.innerText().catch(() => ""),
    deliveryOptimization: await delivery.innerText().catch(() => ""),
    draftTitle: await page.locator("#launch-draft-heading").innerText().catch(() => ""),
    launchEnabled: (await observeCampaignLaunchButton(page)).enabled,
    pageText: await page.locator("body").innerText(),
    readiness: await readiness.innerText().catch(() => ""),
    url: page.url(),
  };
}
