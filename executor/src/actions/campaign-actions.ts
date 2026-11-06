import { expect, type Locator, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

const CAMPAIGN_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const CAMPAIGN_MONEY = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  style: "currency",
});

const CAMPAIGN_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const CAMPAIGN_LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
] as const;

const CAMPAIGN_CALENDAR_MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const campaignReservedAmountText = (dollars: number): string =>
  CAMPAIGN_MONEY.format(dollars);

const campaignDateButtonName = (label: string, iso: string): string =>
  `${label}: ${CAMPAIGN_DATE.format(new Date(`${iso}T00:00:00Z`))}`;

const campaignMonthDistance = (currentMonthLabel: string, targetIso: string): number => {
  const current = /^([A-Z][a-z]+) (\d{4})$/.exec(currentMonthLabel);
  const currentMonth = current
    ? CAMPAIGN_LONG_MONTHS.indexOf(current[1] as (typeof CAMPAIGN_LONG_MONTHS)[number])
    : -1;
  const target = /^(\d{4})-(\d{2})-\d{2}$/.exec(targetIso);
  const targetMonth = target ? Number(target[2]) - 1 : -1;
  if (!(current && currentMonth >= 0 && target && targetMonth >= 0 && targetMonth < 12)) {
    throw new Error(`Invalid campaign calendar month: ${currentMonthLabel} -> ${targetIso}`);
  }
  return Number(target[1]) * 12 + targetMonth - (Number(current[2]) * 12 + currentMonth);
};

const deliveryEndFromStartButtonName = (buttonName: string, activeDays: number): string => {
  if (!Number.isInteger(activeDays) || activeDays < 1) {
    throw new Error("activeDays must be a positive integer");
  }
  const match = /^Start date: ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(buttonName);
  const month = match
    ? CAMPAIGN_MONTHS.indexOf(match[1] as (typeof CAMPAIGN_MONTHS)[number])
    : -1;
  if (!(match && month >= 0)) {
    throw new Error(`Invalid start date button name: ${buttonName}`);
  }
  const day = Number(match[2]);
  const year = Number(match[3]);
  const start = new Date(Date.UTC(year, month, day));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month || start.getUTCDate() !== day) {
    throw new Error(`Invalid start date button name: ${buttonName}`);
  }
  start.setUTCDate(start.getUTCDate() + activeDays - 1);
  return start.toISOString().slice(0, 10);
};

const getCampaignReviewEntry = (page: Page): Locator => {
  const name = /continue to launch|press to review/i;
  return page.getByRole("link", { name }).or(page.getByRole("button", { name })).first();
};

const getCampaignDraftStableSignal = (page: Page): Locator =>
  page.getByText(
    /^(?:Import a creative and the readiness checks run automatically\.|\d+ things? to fix before you can launch\.|Ready to launch\.?|Ready to launch — check the note (?:on your ad account|below)\.|Everything checks out\. Launch when it looks right\.)$/i
  );

const getCampaignCreativeCard = (page: Page): Locator =>
  page.locator('[data-slot="launch-creative-card"]');

// The creative slot was renamed to "Ad" on staging (Import Ad / Change Ad(s));
// the older Studio labels are kept for deployments that still render them.
const getCampaignCreativeImportButton = (page: Page): Locator =>
  page.getByRole("button", { name: /(?:Import from Studio|^Import Ads?)$/i });

const getCampaignCreativeChangeButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^Change (?:creative|Ads?)$/ });

const getCampaignCreativePicker = (page: Page): Locator =>
  page.getByRole("region", { name: "Import from Studio" });

const isCampaignCreativePickerOpen = (page: Page): Promise<boolean> =>
  page.locator('[data-slot="launch-creative-panel"]')
    .evaluate((panel) => panel.closest("[inert]") === null).catch(() => false);

const getCampaignLaunchButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^(?:Launch Campaign|Submit for Review)$/ });

const getEditCopyToggle = (page: Page): Locator =>
  page.getByRole("button", { name: /Edit copy/i });

const getRegenerateCopyAction = (page: Page): Locator =>
  page.getByRole("button", { name: /Regenerate Copy/i });

const getVisiblePendingReviewBadge = (page: Page): Locator =>
  page.locator('[data-slot="status-badge"]:visible')
    .filter({ hasText: /^(?:In review|Pending|Launching)$/i }).first();

const getStrategyRowValue = (page: Page, label: string): Locator =>
  page.getByText(label, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'lg:grid-cols-')][1]")
    .locator(":scope > div").last();

const readCampaignDateButtonName = async (page: Page, label: string): Promise<string> => {
  const name = await page.getByRole("button", { name: new RegExp(`^${label}:`) })
    .getAttribute("aria-label");
  if (!name) throw new Error(`Campaign ${label.toLowerCase()} button has no accessible name`);
  return name;
};

const pickCampaignDate = async (page: Page, label: string, iso: string): Promise<void> => {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const calendar = page.getByRole("grid", { name: /^[A-Z][a-z]+ \d{4}$/ }).first();
  await expect(calendar).toBeVisible();
  const currentMonth = await calendar.getAttribute("aria-label");
  if (!currentMonth) throw new Error("Campaign calendar has no accessible month label");
  const monthDistance = campaignMonthDistance(currentMonth, iso);
  if (Math.abs(monthDistance) > 24) throw new Error(`Campaign date is more than 24 months away: ${iso}`);
  const monthNavigation = page.getByRole("button", {
    name: monthDistance < 0 ? "Previous month" : "Next month",
  });
  for (let offset = 0; offset < Math.abs(monthDistance); offset += 1) {
    const previousMonth = await calendar.getAttribute("aria-label");
    await monthNavigation.click();
    await expect.poll(() => calendar.getAttribute("aria-label")).not.toBe(previousMonth);
  }
  await expect(calendar).toHaveAttribute(
    "aria-label", CAMPAIGN_CALENDAR_MONTH.format(new Date(`${iso}T00:00:00Z`))
  );
  const day = page.locator(`[data-calendar-date="${iso}"]`);
  await expect(day).toBeVisible();
  await day.press("Enter");
  await expect(page.getByRole("button", { exact: true, name: campaignDateButtonName(label, iso) }))
    .toBeVisible();
};

export async function openCampaignOnboardingDraft(page: Page): Promise<{ url: string }> {
  await goToAppPath(page, "/campaigns");
  const reviewEntry = getCampaignReviewEntry(page);
  await expect(reviewEntry).toBeVisible({ timeout: 45_000 });
  await reviewEntry.click();
  await expect(page).toHaveURL(/\/campaigns\/new/, { timeout: 45_000 });
  return { url: page.url() };
}

export async function openCampaignDraft(page: Page, draftId: string): Promise<{ url: string }> {
  await goToAppPath(page, `/campaigns/new?draft=${encodeURIComponent(draftId)}`);
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname === "/campaigns/new" ? url.searchParams.get("draft") : null;
  }, { timeout: 45_000 }).toBe(draftId);
  await waitForCampaignDraft(page);
  return { url: page.url() };
}

export async function openCampaignComposer(page: Page): Promise<{ composerVisible: boolean }> {
  const identityReady = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith("/api/v1/me") &&
      response.request().method() === "GET" && response.ok(),
    { timeout: 30_000 }
  ).then(() => true, () => false);
  await goToAppPath(page, "/campaigns/new");
  await expect(await identityReady, "Campaign page identity must initialize before composing").toBe(true);
  const goal = page.getByPlaceholder("Launch a campaign to drive trial signups…");
  await expect(goal).toBeVisible({ timeout: 30_000 });
  return { composerVisible: await goal.isVisible() };
}

const getCampaignGoalComposer = (page: Page): Locator =>
  page.getByPlaceholder("Launch a campaign to drive trial signups…");

const getCampaignStartOver = (page: Page): Locator =>
  page.locator("#launch-start-over").getByRole("button", { name: "Start Over" });

const getSavedCampaignDraftCard = (page: Page): Locator =>
  page.getByText("Saved draft", { exact: true });

export interface CampaignGoalSubmissionFact {
  composerVisible: boolean;
  startOverVisible: boolean;
}

// Preparation can retry across composer remounts; pressing Enter is attempted exactly once.
// The fact says whether the page left the goal composer for a draft; drafting
// itself continues after this returns (see waitForCampaignDraft).
export async function submitCampaignGoal(page: Page, text: string): Promise<CampaignGoalSubmissionFact> {
  const goal = getCampaignGoalComposer(page);
  await expect(async () => {
    await goal.fill(text, { timeout: 2_000 });
    await expect(goal).toHaveValue(text, { timeout: 1_000 });
    await expect(page.getByRole("button", { name: "Send", exact: true }))
      .toBeEnabled({ timeout: 1_000 });
    await expect(goal).toHaveValue(text, { timeout: 1_000 });
  }).toPass({ timeout: 10_000, intervals: [250, 500] });
  await goal.press("Enter");
  return observeCampaignGoalSubmission(page);
}

// Shared tail of both goal entries: whether the page left the goal composer for a draft.
async function observeCampaignGoalSubmission(page: Page): Promise<CampaignGoalSubmissionFact> {
  const goal = getCampaignGoalComposer(page);
  const startOver = getCampaignStartOver(page);
  await expect.poll(async () =>
    await startOver.isVisible().catch(() => false) ||
    !(await goal.isVisible().catch(() => false)) ||
    (await goal.inputValue().catch(() => "")) === "",
  { timeout: 15_000 }).toBe(true).catch(() => undefined);
  return {
    composerVisible: await goal.isVisible().catch(() => false),
    startOverVisible: await startOver.isVisible().catch(() => false),
  };
}

export interface CampaignGoalChipSubmissionFact extends CampaignGoalSubmissionFact {
  chipLabel: string;
}

/**
 * Starts a draft by clicking one of the quick-goal chips under the goal composer
 * (e.g. "Get more sales", "Drive more signups", or a profile-derived one such as
 * "Reach <audience>"); the chip's own text is the goal, so nothing is typed.
 * Same persistent effect as submitCampaignGoal: it creates a draft and starts
 * one Agent generation (see waitForCampaignDraft). The chip is matched by its
 * exact visible label, which differs per organization profile.
 */
export async function submitCampaignGoalFromChip(page: Page, chipLabel: string): Promise<CampaignGoalChipSubmissionFact> {
  const chip = page.getByRole("button", { name: chipLabel, exact: true });
  await expect(chip, `The goal screen must offer a quick-goal chip "${chipLabel}"`).toBeVisible({ timeout: 30_000 });
  await expect(chip).toBeEnabled({ timeout: 5_000 });
  await chip.click();
  return { chipLabel, ...(await observeCampaignGoalSubmission(page)) };
}

export interface CampaignDraftRenameFact {
  /** The Name field's value before the change (pass it back to undo the rename). */
  previousName: string;
  name: string;
  /** True when the Details panel was already open; otherwise this Action opened it. */
  detailsWasOpen: boolean;
}

/**
 * Renames the open draft through the Name field in the Details panel (opened if
 * it is collapsed). The new name is committed by moving focus off the field.
 * Rename back by calling it again with previousName.
 */
export async function renameCampaignDraft(page: Page, name: string): Promise<CampaignDraftRenameFact> {
  const nameField = page.getByRole("textbox", { name: "Campaign name", exact: true });
  const toggle = page.locator("button[aria-expanded]").filter({ has: page.getByText("Details", { exact: true }) });
  // A collapsed panel keeps the field in the DOM (inert, zero height), so the toggle's state decides.
  await expect(toggle, "The draft's Details panel must be on the page").toBeVisible({ timeout: 30_000 });
  const detailsWasOpen = (await toggle.getAttribute("aria-expanded")) === "true";
  if (!detailsWasOpen) await toggle.click();
  await expect(nameField).toBeVisible({ timeout: 10_000 });
  await expect(nameField).toBeEditable({ timeout: 10_000 });
  const previousName = await nameField.inputValue();
  await nameField.fill(name);
  await expect(nameField).toHaveValue(name);
  await nameField.press("Tab");
  await expect(nameField).toHaveValue(name);
  return { previousName, name: await nameField.inputValue(), detailsWasOpen };
}

export interface CampaignStrategySummaryFact {
  goal: string | null;
  campaignType: string | null;
  bidding: string | null;
}

/**
 * Reads the draft's Goal, Campaign type and Bidding values as shown. Bidding
 * sits in the collapsed Details panel; it is read from the DOM without
 * expanding it. A value that is not rendered (Meta drafts have no Goal or
 * Bidding row) is null.
 */
export async function readCampaignStrategySummary(page: Page): Promise<CampaignStrategySummaryFact> {
  // No named helper functions inside evaluate: tsx/esbuild would wrap them in
  // __name(), which does not exist in the page.
  return page.evaluate(() => {
    const cells: Record<string, Element | null> = {};
    for (const label of ["Campaign type", "Bidding"]) {
      let row: Element | null = [...document.querySelectorAll("span")]
        .find((span) => span.children.length === 0 && span.textContent?.trim() === label) ?? null;
      while (row && !(row.getAttribute("class") ?? "").includes("lg:grid-cols-")) row = row.parentElement;
      cells[label] = row?.lastElementChild ?? null;
    }
    const typeCell = document.querySelector("#launch-campaign-type")?.lastElementChild ?? cells["Campaign type"];
    const biddingValue = cells.Bidding?.querySelector("span");
    const bidding = biddingValue
      ? [...biddingValue.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "").join("").replace(/\s+/g, " ").trim()
      : "";
    return {
      goal: document.querySelector('[data-testid="campaign-goal"]')?.textContent?.trim() || null,
      campaignType: typeCell?.querySelector('[role="combobox"][aria-label="Campaign type"]')?.textContent?.trim() ||
        typeCell?.querySelector("span.font-medium")?.textContent?.trim() || null,
      bidding: bidding || null,
    };
  });
}

export interface CampaignStartOverFact {
  composerVisible: boolean;
  savedDraftCardVisible: boolean;
}

/** Start Over parks the current draft (it stays resumable) and returns to the goal composer. */
export async function startOverCampaignDraft(page: Page): Promise<CampaignStartOverFact> {
  const startOver = getCampaignStartOver(page);
  await expect(startOver).toBeVisible({ timeout: 30_000 });
  await startOver.click();
  const composer = getCampaignGoalComposer(page);
  await expect(composer).toBeVisible({ timeout: 30_000 });
  return {
    composerVisible: await composer.isVisible(),
    savedDraftCardVisible: await getSavedCampaignDraftCard(page).isVisible().catch(() => false),
  };
}

export interface CampaignResumeFact {
  resumed: boolean;
  savedDraftCardVisible: boolean;
  startOverVisible: boolean;
  strategy: CampaignStrategySummaryFact;
}

/** Resumes the parked draft offered on the goal screen's Saved draft card. */
export async function resumeSavedCampaignDraft(page: Page): Promise<CampaignResumeFact> {
  const resume = page.getByRole("button", { name: "Resume Draft", exact: true });
  await expect(resume, "A Saved draft card with Resume Draft is required").toBeVisible({ timeout: 30_000 });
  await resume.click();
  const startOver = getCampaignStartOver(page);
  await expect(startOver).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#launch-campaign-type")).toBeVisible({ timeout: 30_000 });
  return {
    resumed: true,
    savedDraftCardVisible: await getSavedCampaignDraftCard(page).isVisible().catch(() => false),
    startOverVisible: await startOver.isVisible(),
    strategy: await readCampaignStrategySummary(page),
  };
}

export interface CampaignSaveRetryFact {
  requestObserved: boolean;
  responseStatus: number | null;
  saveFailedVisible: boolean;
}

/**
 * Clicks "Retry saving" once on the "Changes could not be saved." alert and
 * reports the plan save it triggered. A missing response is unknown, not
 * permission to click again.
 */
export async function retryCampaignChangesSave(page: Page): Promise<CampaignSaveRetryFact> {
  const failed = page.getByRole("alert").filter({ hasText: "Changes could not be saved." }).first();
  await expect(failed, "The failed-save alert must be showing").toBeVisible({ timeout: 15_000 });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() !== "GET" &&
    new URL(response.url()).pathname.includes("/campaigns/plans/"), { timeout: 30_000 }).catch(() => null);
  await failed.getByRole("button", { name: "Retry saving", exact: true }).click();
  const response = await responsePromise;
  // The alert leaves while the save runs and comes back if it fails again, so
  // wait for the state the response implies before reading it.
  if (response?.ok()) {
    await expect(failed).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  } else if (response) {
    await expect(failed).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
  }
  return {
    requestObserved: response !== null,
    responseStatus: response?.status() ?? null,
    saveFailedVisible: await failed.isVisible().catch(() => false),
  };
}

export async function waitForCampaignDraft(page: Page): Promise<{ readinessText: string }> {
  const signal = getCampaignDraftStableSignal(page);
  await expect(signal).toBeVisible({ timeout: 2 * 60_000 });
  return { readinessText: (await signal.innerText()).trim() };
}

export async function observeCampaignDraftStable(page: Page): Promise<{ visible: boolean }> {
  return { visible: await getCampaignDraftStableSignal(page).isVisible().catch(() => false) };
}

export async function observeCampaignTypeLabel(page: Page): Promise<{ visible: boolean }> {
  return { visible: await page.getByText("Campaign type", { exact: true }).isVisible() };
}

export async function expandCampaignCopyEditor(page: Page): Promise<{ expanded: boolean }> {
  const toggle = getEditCopyToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return { expanded: (await toggle.getAttribute("aria-expanded")) === "true" };
}

export async function observeCampaignCopyActions(page: Page): Promise<{
  editCopyVisible: boolean;
  regenerateCopyVisible: boolean;
}> {
  return {
    editCopyVisible: await getEditCopyToggle(page).first().isVisible(),
    regenerateCopyVisible: await getRegenerateCopyAction(page).isVisible(),
  };
}

export interface CampaignTypeFact { selectedType: string }

export async function observeCampaignType(page: Page): Promise<CampaignTypeFact> {
  const value = getStrategyRowValue(page, "Campaign type").locator("span").first();
  await expect(value).toBeVisible({ timeout: 60_000 });
  return { selectedType: (await value.innerText()).trim() };
}

export interface CampaignKeywordFact { keywords: string[] }

export async function observeCampaignKeywords(page: Page): Promise<CampaignKeywordFact> {
  const details = page.getByRole("button", { name: /Details/i });
  if (await details.isVisible().catch(() => false) &&
      (await details.getAttribute("aria-expanded")) !== "true") {
    await details.click();
  }
  const row = getStrategyRowValue(page, "Keywords");
  await expect(row).toBeVisible({ timeout: 30_000 });
  return {
    keywords: await row.locator('[data-slot="chip"]').evaluateAll((chips) =>
      chips.map((chip) => Array.from(chip.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "").join("").trim())
        .filter(Boolean)),
  };
}

export interface CampaignCreativeFact { creativeCardCount: number }

export async function observeCampaignCreativeCards(page: Page): Promise<CampaignCreativeFact> {
  return { creativeCardCount: await getCampaignCreativeCard(page).count() };
}

export async function observeCampaignCreativePicker(page: Page): Promise<{ open: boolean }> {
  return { open: await isCampaignCreativePickerOpen(page) };
}

export async function openCampaignCreativePicker(page: Page): Promise<{ open: boolean }> {
  if (!(await isCampaignCreativePickerOpen(page))) {
    const openPicker = getCampaignCreativeImportButton(page)
      .or(getCampaignCreativeChangeButton(page)).first();
    await expect(openPicker).toBeVisible({ timeout: 60_000 });
    await openPicker.click({ force: true, timeout: 15_000 });
  }
  await expect.poll(() => isCampaignCreativePickerOpen(page), { timeout: 30_000 }).toBe(true);
  return { open: true };
}

export async function selectCampaignGoogleSearchCreative(page: Page): Promise<{ selected: boolean }> {
  const google = getCampaignCreativePicker(page)
    .getByRole("group", { name: "Search creatives", exact: true })
    .getByRole("button", { name: /^Select .+ for Google$/ }).first();
  await expect(google, "A Google Search creative is required; Meta cannot substitute")
    .toBeVisible({ timeout: 30_000 });
  await google.click();
  await expect(google).toHaveAttribute("aria-pressed", "true");
  return { selected: (await google.getAttribute("aria-pressed")) === "true" };
}

export async function confirmCampaignCreativeImport(page: Page): Promise<CampaignCreativeFact> {
  const useCreative = getCampaignCreativePicker(page).getByRole("button", {
    name: "Use Creative", exact: true,
  });
  await expect(useCreative).toBeEnabled({ timeout: 30_000 });
  await useCreative.click();
  await expect(getCampaignCreativeCard(page).first()).toBeVisible({ timeout: 2 * 60_000 });
  return observeCampaignCreativeCards(page);
}

export async function closeCampaignCreativePicker(page: Page): Promise<{ open: boolean }> {
  if (await isCampaignCreativePickerOpen(page)) {
    await page.locator('[data-slot="launch-creative-panel"]')
      .getByRole("button", { name: /^Close (?:Creative|Ad) Picker$/ }).click();
  }
  await expect.poll(() => isCampaignCreativePickerOpen(page)).toBe(false);
  return { open: false };
}

export interface CampaignBudgetFact { effectiveBudgetDollars: number | null }

export async function observeCampaignBudget(page: Page): Promise<CampaignBudgetFact> {
  const selectedPreset = page.getByRole("group", { name: "Budget presets" })
    .getByRole("button", { pressed: true });
  if (await selectedPreset.isVisible().catch(() => false)) {
    const amount = Number((await selectedPreset.innerText()).replace(/[$,]/g, ""));
    return { effectiveBudgetDollars: Number.isFinite(amount) ? amount : null };
  }
  const custom = (await page.getByLabel("Campaign budget in dollars").inputValue()).trim();
  if (!custom) return { effectiveBudgetDollars: null };
  const amount = Number(custom.replace(/[$,]/g, ""));
  return { effectiveBudgetDollars: Number.isFinite(amount) ? amount : null };
}

export async function setCampaignBudget(page: Page, dollars: number): Promise<CampaignBudgetFact> {
  const budget = page.getByLabel("Campaign budget in dollars");
  await expect(budget).toBeEnabled({ timeout: 2 * 60_000 });
  const preset = page.getByRole("group", { name: "Budget presets" })
    .getByRole("button", { name: `$${dollars}`, exact: true });
  if (await preset.isVisible().catch(() => false)) {
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
  } else {
    await budget.fill(String(dollars));
    await budget.blur();
    await expect(budget).toHaveValue(String(dollars));
  }
  return observeCampaignBudget(page);
}

export interface CampaignDeliveryFact {
  startDateButtonName: string;
  endDateButtonName: string;
}

export async function setCampaignDeliveryDays(
  page: Page, activeDays: number
): Promise<CampaignDeliveryFact> {
  const startDateButtonName = await readCampaignDateButtonName(page, "Start date");
  await pickCampaignDate(page, "End date", deliveryEndFromStartButtonName(startDateButtonName, activeDays));
  return {
    startDateButtonName,
    endDateButtonName: await readCampaignDateButtonName(page, "End date"),
  };
}

export async function observeCampaignLaunchReadiness(page: Page): Promise<{ enabled: boolean }> {
  const launch = getCampaignLaunchButton(page);
  await expect(launch).toBeEnabled({ timeout: 3 * 60_000 });
  return { enabled: await launch.isEnabled() };
}

export async function observeCampaignLaunchButton(page: Page): Promise<{ enabled: boolean }> {
  return { enabled: await getCampaignLaunchButton(page).isEnabled().catch(() => false) };
}

export interface CampaignLaunchSubmissionFact {
  campaignId: string | null;
  funded: boolean | null;
  idempotencyKey: string | null;
  requestName: string | null;
  requestObserved: boolean;
  responseStatus: number | null;
  responseUrl: string | null;
}

// Launch is a single side-effect attempt. A missing response is unknown, not permission to retry.
export async function submitCampaignLaunch(page: Page): Promise<CampaignLaunchSubmissionFact> {
  const launch = getCampaignLaunchButton(page);
  await expect(launch).toBeEnabled({ timeout: 3 * 60_000 });
  const requestPromise = page.waitForRequest(
    (request) => request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/v1/campaigns/launch"),
    { timeout: 60_000 }
  ).catch(() => null);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/campaigns/launch"),
    { timeout: 60_000 }
  ).catch(() => null);
  await launch.click();
  const request = await requestPromise;
  const response = await responsePromise;
  const requestBody = (request
    ? (() => {
        try { return request.postDataJSON(); } catch { return null; }
      })()
    : null) as { name?: unknown } | null;
  const body = await response?.json().catch(() => null) as
    | { funded?: unknown; id?: unknown }
    | null;
  return {
    campaignId: typeof body?.id === "string" ? body.id : null,
    funded: typeof body?.funded === "boolean" ? body.funded : null,
    idempotencyKey: request?.headers()["idempotency-key"] ?? null,
    requestName: typeof requestBody?.name === "string" ? requestBody.name : null,
    requestObserved: request !== null,
    responseStatus: response?.status() ?? null,
    responseUrl: response?.url() ?? null,
  };
}

export async function observeCampaignLaunchConfirmation(
  page: Page, budgetDollars: number
): Promise<{ confirmationVisible: boolean; reservedAmountVisible: boolean }> {
  const confirmation = page.getByRole("region", { name: /Campaign (?:in review|launching)/i });
  await expect(confirmation).toBeVisible({ timeout: 60_000 });
  await expect(confirmation.getByText("Reserved")).toBeVisible();
  const reservedAmount = confirmation.getByText(campaignReservedAmountText(budgetDollars), {
    exact: true,
  });
  await expect(reservedAmount).toBeVisible();
  return {
    confirmationVisible: await confirmation.isVisible(),
    reservedAmountVisible: await reservedAmount.isVisible(),
  };
}

export async function openCampaignList(page: Page): Promise<{ url: string }> {
  await goToAppPath(page, "/campaigns");
  return { url: page.url() };
}

export async function openExistingCampaignDetail(
  page: Page,
  campaignId: string
): Promise<{ url: string }> {
  const href = `/campaigns/${encodeURIComponent(campaignId)}`;
  const link = page.locator(`a[href="${href}"]:visible`).first();
  await expect(link).toBeVisible({ timeout: 45_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}(?:$|[?#])`), {
    timeout: 30_000,
  });
  await expect(page.locator('[data-slot="campaign-detail-body"]')).toBeVisible({ timeout: 45_000 });
  return { url: page.url() };
}

export async function observeCampaignProtectiveActions(page: Page): Promise<{
  pauseVisible: boolean;
  pauseEnabled: boolean;
  cancelVisible: boolean;
  cancelEnabled: boolean;
}> {
  const pause = page.getByRole("button", { name: /^(?:Pause|Pause campaign)$/i }).first();
  const cancel = page.getByRole("button", { name: /^(?:Cancel|Cancel campaign)$/i }).first();
  const pauseVisible = await pause.isVisible().catch(() => false);
  const cancelVisible = await cancel.isVisible().catch(() => false);
  return {
    pauseVisible,
    pauseEnabled: pauseVisible && await pause.isEnabled(),
    cancelVisible,
    cancelEnabled: cancelVisible && await cancel.isEnabled(),
  };
}

export async function observeCampaignPendingReview(page: Page): Promise<{ visible: boolean }> {
  const badge = getVisiblePendingReviewBadge(page);
  await expect(badge).toBeVisible({ timeout: 45_000 });
  return { visible: await badge.isVisible() };
}

// QA-1183 case matrix: the launch screen's "Create" tile (preview-card.tsx)
// swaps the recommendation card for CampaignTypesCard (types.tsx, headed
// "What should this campaign do?"), the real entry point for choosing a
// platform then a campaign type/method deterministically -- as opposed to a
// free-text goal routed through the drafting Agent. The tile itself has no
// aria-label or data-slot; its own visible text starts with "Create".
export type CampaignCreateTypeId = "branding" | "traffic" | "leads" | "conversions" | "apps";
export type CampaignCreateMethodId =
  | "google_search" | "google_pmax"
  | "meta_reach" | "meta_traffic" | "meta_instant_form" | "meta_sales" | "meta_app";

const getCampaignCreateTypesCard = (page: Page): Locator =>
  page.locator('[data-slot="launch-types"]');

export async function openCampaignCreateCard(page: Page): Promise<{ opened: boolean }> {
  await page.getByRole("button", { name: /^Create/ }).click();
  const card = getCampaignCreateTypesCard(page);
  await expect(card).toBeVisible({ timeout: 15_000 });
  return { opened: await card.isVisible() };
}

// Platform toggle inside the Create card (types.tsx PlatformSegment):
// role="group" aria-label="Platform", one button per platform with
// data-platform="google"|"meta" and visible text "Google"/"Meta". Google is
// selected by default; Meta's button carries aria-disabled (and no onClick)
// until the org has a connected Meta Page, so this reports that instead of
// silently no-opping the click.
export async function selectCampaignCreatePlatform(
  page: Page,
  platform: "google" | "meta"
): Promise<{ platform: string; selected: boolean; disabled: boolean }> {
  const button = getCampaignCreateTypesCard(page)
    .getByRole("group", { name: "Platform" })
    .locator(`[data-platform="${platform}"]`);
  await expect(button).toBeVisible({ timeout: 15_000 });
  const disabled = (await button.getAttribute("aria-disabled")) === "true";
  if (!disabled) {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  return {
    platform,
    selected: (await button.getAttribute("aria-pressed")) === "true",
    disabled,
  };
}

// One campaign type card in the Create flow (types.tsx TypeCard). Per
// campaign-methods.ts, Google has no "branding" (Awareness) or "apps" (App
// installs) method -- those two types render Meta-only and are absent from
// the list entirely when platform=google, not merely disabled. A type with
// one method on the chosen platform starts drafting straight from the
// header click and the whole Create card unmounts; a type with several
// methods (Traffic/Leads/Conversions, which both platforms offer) instead
// opens its fold (aria-expanded flips true) and a method must be chosen
// separately via chooseCampaignCreateMethod. A type unavailable on the
// chosen platform is absent from the DOM, not merely disabled -- callers
// should confirm with observeCampaignCreateTypes first.
export async function chooseCampaignCreateType(
  page: Page,
  typeId: CampaignCreateTypeId
): Promise<{ typeId: string; opened: boolean; cardLeft: boolean }> {
  const card = getCampaignCreateTypesCard(page);
  const header = card.locator(`[data-type-header="${typeId}"]`);
  await expect(header).toBeVisible({ timeout: 15_000 });
  await header.click();
  // Either the fold opens (multi-method type) or the whole card unmounts
  // (single-method type started drafting) -- never both, never neither.
  await expect.poll(async () =>
    (await header.getAttribute("aria-expanded")) === "true" ||
    !(await card.isVisible().catch(() => false)),
  { timeout: 15_000 }).toBe(true).catch(() => undefined);
  const cardLeft = !(await card.isVisible().catch(() => false));
  return {
    typeId,
    opened: !cardLeft && (await header.getAttribute("aria-expanded")) === "true",
    cardLeft,
  };
}

// The types currently on the Create card for whichever platform is active,
// in CAMPAIGN_TYPES order -- confirms Google's missing Awareness/App
// installs rows without hardcoding the omission into a caller's assertions.
export async function observeCampaignCreateTypes(page: Page): Promise<{ typeIds: string[] }> {
  const headers = getCampaignCreateTypesCard(page).locator("[data-type-header]");
  await expect(headers.first()).toBeVisible({ timeout: 15_000 });
  return { typeIds: await headers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-type-header") ?? "")) };
}

// A method row under an opened type fold (types.tsx MethodRow): data-method
// is the CampaignMethod id from campaign-methods.ts. Choosing it starts the
// Agent with campaignMethodAsk's drafted sentence, which unmounts the whole
// Create card the same way a single-method type's header click does. A
// method the organization cannot run yet (e.g. meta_sales without a pixel)
// carries aria-disabled and does nothing on click.
export async function chooseCampaignCreateMethod(
  page: Page,
  methodId: CampaignCreateMethodId
): Promise<{ methodId: string; available: boolean; cardLeft: boolean }> {
  const card = getCampaignCreateTypesCard(page);
  const row = card.locator(`[data-method="${methodId}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const available = (await row.getAttribute("aria-disabled")) !== "true";
  if (available) {
    await row.click();
    await expect(card).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  }
  return { methodId, available, cardLeft: !(await card.isVisible().catch(() => false)) };
}
