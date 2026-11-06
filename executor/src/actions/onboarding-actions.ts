import { expect, type Locator, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

export interface OnboardingSelectionFact {
  label: string;
  selected: boolean;
}

export interface OnboardingResearchFact {
  domain: string;
  responseStatus: number | null;
  runId: string | null;
}

interface BrandResearchSnapshot {
  confirmEnabled: boolean;
  stalledHeadingVisible: boolean;
  startOverVisible: boolean;
}

interface DashboardReadinessSnapshot {
  checkingAccountVisible: boolean;
  dashboardVisible: boolean;
}

type BrandResearchState = "ready" | "stalled";
type DashboardReadinessAction = "continue" | "reload" | "wait";

export const getDashboardReadySignal = (page: Page): Locator =>
  page.locator('[data-sidebar="footer"]');

export const dashboardReadinessFallback = ({
  checkingAccountVisible,
  dashboardVisible,
}: DashboardReadinessSnapshot): DashboardReadinessAction => {
  if (dashboardVisible) return "continue";
  if (checkingAccountVisible) return "reload";
  return "wait";
};

export const classifyBrandResearchState = ({
  confirmEnabled,
  stalledHeadingVisible,
  startOverVisible,
}: BrandResearchSnapshot): BrandResearchState | null => {
  if (confirmEnabled) return "ready";
  if (stalledHeadingVisible && startOverVisible) return "stalled";
  return null;
};

const waitForEntry = async (page: Page): Promise<void> => {
  const heading = page.getByRole("heading", { name: "Who are we growing?" });
  const rendered = await heading
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (rendered) return;
  if ((await page.getByText("Checking your account", { exact: true }).count()) > 0) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(heading).toBeVisible({ timeout: 2 * 60_000 });
};

export async function openForcedOnboarding(
  page: Page
): Promise<{ url: string; resumable: boolean }> {
  await goToAppPath(page, "/onboarding?force=true");
  const startOver = page.getByRole("button", { name: /start over/i });
  const resumable = await startOver
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  return { url: page.url(), resumable };
}

// Explicitly destructive: this discards a resumable draft and must not be retried blindly.
export async function resetOnboardingDraft(page: Page): Promise<{ url: string }> {
  await page.getByRole("button", { name: /start over/i }).click();
  const confirm = page.getByRole("button", { name: /^start over$/i }).last();
  await expect(confirm).toBeVisible();
  await confirm.click();
  await waitForEntry(page);
  return { url: page.url() };
}

export async function waitForOnboardingEntry(page: Page): Promise<{ url: string }> {
  await waitForEntry(page);
  return { url: page.url() };
}

export async function submitBrandResearch(
  page: Page,
  domain: string
): Promise<OnboardingResearchFact> {
  await waitForEntry(page);
  const input = page.locator("#identify-entry");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(domain);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/onboarding/research"),
    { timeout: 60_000 }
  ).catch(() => null);
  await page.getByRole("button", { name: "Research" }).click();
  const response = await responsePromise;
  const body = await response?.json().catch(() => null) as { runId?: unknown } | null;
  return {
    domain,
    responseStatus: response?.status() ?? null,
    runId: typeof body?.runId === "string" ? body.runId : null,
  };
}

export async function waitForOnboardingBrandReview(
  page: Page
): Promise<{ state: BrandResearchState }> {
  const confirm = page.getByRole("button", { name: "Looks Right" });
  const startOver = page.getByRole("button", { name: "Start Over" });
  const stalledHeading = page.getByRole("heading", { name: /finish reading your site/i });
  let state: BrandResearchState | null = null;
  await expect.poll(async () => {
    state = classifyBrandResearchState({
      confirmEnabled: await confirm.isEnabled().catch(() => false),
      stalledHeadingVisible: await stalledHeading.isVisible().catch(() => false),
      startOverVisible: await startOver.isVisible().catch(() => false),
    });
    return state;
  }, { timeout: 3 * 60_000 }).not.toBeNull();
  if (!state) throw new Error("Brand review state could not be observed");
  return { state };
}

export async function confirmOnboardingBrand(page: Page): Promise<{ url: string }> {
  const confirm = page.getByRole("button", { name: "Looks Right" });
  await expect(confirm).toBeEnabled({ timeout: 3 * 60_000 });
  await confirm.click();
  return { url: page.url() };
}

export async function chooseOnboardingRegion(
  page: Page,
  region: string
): Promise<OnboardingSelectionFact> {
  await expect(page.getByRole("heading", { name: "A few things about your ads" })).toBeVisible();
  const choice = page.getByRole("radio", { exact: true, name: region });
  await choice.click();
  return { label: region, selected: await choice.isChecked() };
}

export async function chooseOnboardingObjective(
  page: Page,
  objective: string
): Promise<OnboardingSelectionFact> {
  const choice = page.getByRole("radio", { exact: true, name: objective });
  await choice.click();
  return { label: objective, selected: await choice.isChecked() };
}

export async function chooseOnboardingDailyBudget(
  page: Page,
  label: string
): Promise<OnboardingSelectionFact> {
  const choice = page.getByRole("radio", { exact: true, name: label });
  await choice.click();
  return { label, selected: await choice.isChecked() };
}

export async function submitOnboardingQuestions(page: Page): Promise<{ url: string }> {
  await page.getByRole("button", { name: "Build My Campaign" }).click();
  return { url: page.url() };
}

export async function observeSelectedOnboardingAdStyles(
  page: Page
): Promise<{ selectedCount: number }> {
  const selected = page.getByRole("button", { pressed: true }).filter({
    has: page.getByRole("img", { name: / ad$/ }),
  });
  return { selectedCount: await selected.count() };
}

export async function selectNextOnboardingAdStyle(
  page: Page
): Promise<{ selectedCount: number }> {
  await expect(page.getByRole("heading", { name: "Pick the ad styles you like" }))
    .toBeVisible({ timeout: 2 * 60_000 });
  const adImage = page.getByRole("img", { name: / ad$/ });
  const styles = page.getByRole("button", { pressed: false }).filter({ has: adImage });
  await expect(styles.first()).toBeEnabled({ timeout: 30_000 });
  await styles.first().click();
  return observeSelectedOnboardingAdStyles(page);
}

export async function submitOnboardingCreativeGeneration(
  page: Page
): Promise<{ accepted: boolean }> {
  const generate = page.getByRole("button", { name: "Generate My Ads" });
  await expect(generate).toBeEnabled();
  await generate.click();
  const started = page.getByRole("button", { name: /^Starting/i });
  const accepted = await started
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  return {
    accepted: accepted || await page.getByRole("button", { name: "Go to Campaign" })
      .isVisible().catch(() => false),
  };
}

export async function openOnboardingCampaign(page: Page): Promise<{ url: string }> {
  const goToCampaign = page.getByRole("button", { name: "Go to Campaign" });
  await expect(goToCampaign).toBeVisible({ timeout: 60_000 });
  await goToCampaign.click();
  return { url: page.url() };
}

export async function skipOnboardingInvite(page: Page): Promise<{ url: string }> {
  const skipInvite = page.getByRole("button", { name: "Skip for Now" });
  await expect(skipInvite).toBeVisible({ timeout: 45_000 });
  await skipInvite.click();
  await expect(page).toHaveURL(/\/campaigns(?:\?|$)/, { timeout: 45_000 });
  const dashboard = getDashboardReadySignal(page);
  const rendered = await dashboard
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  const fallback = dashboardReadinessFallback({
    checkingAccountVisible:
      (await page.getByText("Checking your account", { exact: true }).count()) > 0,
    dashboardVisible: rendered,
  });
  if (fallback === "reload") {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  if (fallback !== "continue") {
    await expect(dashboard).toBeVisible({ timeout: 2 * 60_000 });
  }
  return { url: page.url() };
}
