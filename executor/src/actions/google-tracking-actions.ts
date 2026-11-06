import { expect, type Locator, type Page } from "@playwright/test";

import { readCampaignStrategySummary, type CampaignStrategySummaryFact } from "./campaign-actions";

export type TrackingCardState = "missing" | "waiting" | "live" | "traffic" | "absent" | "unrecognized";

export interface GoogleTrackingReadinessFact {
  capturedAt: string;
  cardState: TrackingCardState;
  conversionLoopLastStep: "not set up" | "waiting" | "live" | null;
  setupLinkVisible: boolean;
  trafficSwitchVisible: boolean;
  /**
   * The card's switch button text: "Draft as Traffic" on a PMax draft (it redrafts as Search),
   * "Switch to Traffic" on older builds; null when the card has no such button (a Search draft, live tracker).
   */
  trafficSwitchLabel: "Switch to Traffic" | "Draft as Traffic" | null;
  switchBackTo: "Sales" | "Signups" | null;
  checkingFirstVisitVisible: boolean;
  readiness: {
    present: boolean;
    resultsLoaded: boolean;
    stale: boolean | null;
    loading: boolean;
    error: boolean;
    /** The rail's status line, e.g. "1 thing to fix before you can launch." */
    summary: string | null;
    conversionTrackingRow: "required" | "not connected" | "unconfirmed" | "unrecognized" | "absent";
    /** The row's explanation lines (its tooltip text), e.g. "Install the tracker, or switch this campaign to Traffic." */
    conversionTrackingIssues: string[];
  };
}

/**
 * Reads the Google draft's tracking card and readiness rail without changing either.
 *
 * The Conversion tracking row is found by its label element, not by the row's
 * leading text: a blocking row starts with the Spinner state mark, whose
 * sr-only "Loading" comes first in textContent. The row's status is the first
 * text of the sr-only element that is not inside that Spinner.
 */
export async function readGoogleTrackingReadiness(page: Page): Promise<GoogleTrackingReadinessFact> {
  // No named helper functions inside evaluate: tsx/esbuild would wrap them in
  // __name(), which does not exist in the page.
  return page.evaluate(() => {
    const card = document.querySelector("#launch-tracking");
    const rail = document.querySelector('[data-slot="launch-readiness"]');
    const results = rail?.querySelector('[data-slot="readiness-results"]');
    const cardText = card?.textContent ?? "";
    const cardState = !card ? "absent"
      : cardText.includes("Running as Traffic") ? "traffic"
      // The missing chip read "Required to launch" before PR #1327 and reads "Not set up" since. The loop's
      // own lowercase "not set up" does not match (case-sensitive).
      : cardText.includes("Required to launch") || cardText.includes("Not set up") ? "missing"
      : cardText.includes("Waiting for first visit") ? "waiting"
      : cardText.includes("tracker live on") ? "live"
      : "unrecognized";
    const lastStep = card?.querySelector('ol[aria-label="How Google learns from this campaign"] li:last-child');
    const lastStepStatus = lastStep?.lastElementChild?.textContent?.trim();
    const conversionLoopLastStep =
      lastStepStatus === "not set up" || lastStepStatus === "waiting" || lastStepStatus === "live"
        ? lastStepStatus : null;
    const switchBackButton = [...(card?.querySelectorAll("button") ?? [])]
      .find((button) => /^Switch Back to (Sales|Signups)$/.test(button.textContent?.trim() ?? ""));
    const switchBackLabel = switchBackButton?.textContent?.trim();
    const trafficButton = [...(card?.querySelectorAll("button") ?? [])]
      .map((button) => button.textContent?.trim() ?? "")
      .find((text) => text === "Switch to Traffic" || text === "Draft as Traffic");

    let row: Element | undefined;
    for (const candidate of results?.querySelectorAll("[data-readiness-fix]") ?? []) {
      const labelElement = candidate.querySelector("span.flex-1");
      let label = labelElement?.textContent?.trim() ?? "";
      if (!labelElement) {
        const visibleText = candidate.cloneNode(true) as Element;
        visibleText.querySelectorAll(".sr-only").forEach((hidden) => hidden.remove());
        label = (visibleText.textContent ?? "").trim().split(/\s{2,}|\n/)[0]?.trim() ?? "";
      }
      if (label === "Conversion tracking") {
        row = candidate;
        break;
      }
    }
    const detailElement = row
      ? [...row.querySelectorAll(".sr-only")].find((element) => !element.closest('[data-slot="spinner"]'))
      : undefined;
    const detail = detailElement?.firstChild?.textContent?.trim();
    const conversionTrackingRow = !row ? "absent"
      : detail === "required" || detail === "not connected" || detail === "unconfirmed"
        ? detail : "unrecognized";
    const conversionTrackingIssues = detailElement
      ? [...detailElement.children].map((issue) => issue.textContent?.trim() ?? "").filter(Boolean)
      : [];

    return {
      capturedAt: new Date().toISOString(),
      cardState,
      conversionLoopLastStep,
      setupLinkVisible: Boolean(card?.querySelector('a[href^="/tracking/setup"]')),
      trafficSwitchVisible: trafficButton !== undefined,
      trafficSwitchLabel: trafficButton === "Switch to Traffic" || trafficButton === "Draft as Traffic"
        ? trafficButton : null,
      switchBackTo: switchBackLabel === "Switch Back to Sales" ? "Sales"
        : switchBackLabel === "Switch Back to Signups" ? "Signups" : null,
      checkingFirstVisitVisible: Boolean(card?.querySelector('[aria-live="polite"]')
        ?.textContent?.includes("Checking for the first visit")),
      readiness: {
        present: Boolean(rail),
        resultsLoaded: Boolean(results),
        stale: results ? results.getAttribute("data-stale") === "true" : null,
        loading: Boolean(rail?.querySelector('[data-slot="readiness-loading"]')),
        error: Boolean(rail?.querySelector('[data-slot="readiness-error"]')),
        summary: rail?.querySelector('[role="status"]')?.textContent?.replace(/\s+/g, " ").trim() || null,
        conversionTrackingRow,
        conversionTrackingIssues,
      },
    } satisfies GoogleTrackingReadinessFact;
  });
}

const getTrackingCard = (page: Page): Locator => page.locator("#launch-tracking");

// Search drafts (and older builds) ask "Run this campaign as Traffic?"; a PMax draft asks "Draft a Traffic campaign instead?".
const TRAFFIC_BUTTON = /^(?:Switch to|Draft as) Traffic$/;
const getTrafficDialog = (page: Page): Locator =>
  page.getByRole("alertdialog").filter({ hasText: /Run this campaign as Traffic\?|Draft a Traffic campaign instead\?/ });

export interface TrackingCardFocusFact {
  rowDetail: GoogleTrackingReadinessFact["readiness"]["conversionTrackingRow"];
  cardState: TrackingCardState;
  cardInViewport: boolean;
  focusInsideCard: boolean;
  focusedControl: string | null;
}

/** Clicks the readiness rail's Conversion tracking row, which points at the tracking card. */
export async function focusTrackingCardFromReadiness(page: Page): Promise<TrackingCardFocusFact> {
  const before = await readGoogleTrackingReadiness(page);
  const rail = page.locator('[data-slot="launch-readiness"]');
  const row = rail.locator("[data-readiness-fix]").filter({ hasText: "Conversion tracking" }).first();
  const viewChecks = rail.getByRole("button", { name: "View checks" });
  if (!(await row.isVisible().catch(() => false)) && await viewChecks.isVisible().catch(() => false)) {
    await viewChecks.click();
  }
  await expect(row, "The readiness rail must show a Conversion tracking row").toBeVisible({ timeout: 30_000 });
  await row.click();
  const focusInsideCard = await expect.poll(() => page.evaluate(() => {
    const card = document.querySelector("#launch-tracking");
    return Boolean(card && card.contains(document.activeElement));
  }), { timeout: 5_000 }).toBe(true).then(() => true, () => false);
  const placement = await page.evaluate(() => {
    const card = document.querySelector("#launch-tracking");
    const box = card?.getBoundingClientRect();
    const active = document.activeElement;
    return {
      cardInViewport: Boolean(box && box.bottom > 0 && box.top < window.innerHeight),
      focusedControl: card && active && card.contains(active)
        ? (active.textContent ?? "").replace(/\s+/g, " ").trim() || null : null,
    };
  });
  return {
    rowDetail: before.readiness.conversionTrackingRow,
    cardState: (await readGoogleTrackingReadiness(page)).cardState,
    cardInViewport: placement.cardInViewport,
    focusInsideCard,
    focusedControl: placement.focusedControl,
  };
}

export interface TrackingSetupLinkFact {
  visible: boolean;
  label: string | null;
  path: string | null;
  carriesOrgParam: boolean;
  /** Whether ?org= names this tab's active org (sessionStorage); null when the tab has none. */
  orgParamMatchesActiveOrg: boolean | null;
  opensNewTab: boolean;
  rel: string | null;
}

/**
 * Reads where the tracking card's setup link goes, without opening it. Opening
 * it creates a second app tab, which the shared E2B Action runner refuses to
 * act on; the org id itself is not returned.
 */
export async function readTrackingSetupLink(page: Page): Promise<TrackingSetupLinkFact> {
  return page.evaluate(() => {
    const link = document.querySelector('#launch-tracking a[href^="/tracking/setup"]');
    if (!link) {
      return { visible: false, label: null, path: null, carriesOrgParam: false,
        orgParamMatchesActiveOrg: null, opensNewTab: false, rel: null };
    }
    // Parsed against a placeholder base: only the path and the presence of ?org= are reported.
    const href = new URL(link.getAttribute("href") ?? "", "https://app.invalid");
    let activeOrgs: string[] = [];
    try {
      activeOrgs = Object.keys(sessionStorage).filter((key) => key.startsWith("hellyeah:active-org:"))
        .map((key) => sessionStorage.getItem(key) ?? "").filter(Boolean);
    } catch {
      activeOrgs = [];
    }
    const org = href.searchParams.get("org");
    return {
      visible: true,
      label: (link.textContent ?? "").replace(/\s+/g, " ").trim() || null,
      path: href.pathname,
      carriesOrgParam: org !== null,
      orgParamMatchesActiveOrg: org === null || !activeOrgs.length ? null : activeOrgs.includes(org),
      opensNewTab: link.getAttribute("target") === "_blank",
      rel: link.getAttribute("rel"),
    };
  });
}

export interface TrafficSwitchDialogFact {
  open: boolean;
  /** "redraft": a PMax draft, confirming redrafts it as a Search campaign; "switch": the goal changes in place. */
  kind: "switch" | "redraft";
  title: string | null;
  description: string | null;
  /** Body text besides the description (the PMax paragraph "Performance Max only bids for ..."). */
  explanation: string | null;
  changes: { label: string; from: string; to: string }[];
  keepLabel: string | null;
  confirmLabel: string | null;
}

async function readTrafficDialog(dialog: Locator): Promise<TrafficSwitchDialogFact> {
  return dialog.evaluate((element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const describedBy = element.getAttribute("aria-describedby");
    const title = (labelledBy && document.getElementById(labelledBy)?.textContent) ||
      element.querySelector("h2")?.textContent || "";
    const description = (describedBy && document.getElementById(describedBy)?.textContent) ||
      element.querySelector("p")?.textContent || "";
    const buttons = [...element.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
    const descriptionElement = (describedBy && document.getElementById(describedBy)) || element.querySelector("p");
    const explanation = [...element.querySelectorAll("p")]
      .filter((paragraph) => paragraph !== descriptionElement)
      .map((paragraph) => (paragraph.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean).join(" ");
    const confirmLabel = buttons.find((text) => text === "Switch to Traffic" || text === "Draft as Traffic") ?? null;
    return {
      open: true,
      kind: confirmLabel === "Draft as Traffic" ? "redraft" : "switch",
      explanation: explanation || null,
      title: title.replace(/\s+/g, " ").trim() || null,
      description: description.replace(/\s+/g, " ").trim() || null,
      changes: [...element.querySelectorAll("dl > div")].map((change) => ({
        label: change.querySelector("dt")?.textContent?.trim() ?? "",
        from: change.querySelector("dd > span:first-of-type")?.textContent?.trim() ?? "",
        to: change.querySelector("dd > span:last-of-type")?.textContent?.trim() ?? "",
      })),
      keepLabel: buttons.find((text) => /^Keep /.test(text)) ?? null,
      confirmLabel,
    };
  });
}

/**
 * Opens the tracking card's Switch to Traffic / Draft as Traffic confirmation and reads what it says. Changes
 * nothing. A PMax draft's dialog lists no changes (kind "redraft", the paragraph is in `explanation`).
 */
export async function openSwitchToTrafficDialog(page: Page): Promise<TrafficSwitchDialogFact> {
  const trigger = getTrackingCard(page).getByRole("button", { name: TRAFFIC_BUTTON }).first();
  await expect(trigger, "The tracking card must offer Switch to Traffic (Search) or Draft as Traffic (PMax)").toBeEnabled({ timeout: 30_000 });
  await trigger.click();
  const dialog = getTrafficDialog(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return readTrafficDialog(dialog);
}

export interface TrafficDialogKeepFact {
  open: boolean;
  keptGoal: string | null;
  cardState: TrackingCardState;
  strategy: CampaignStrategySummaryFact;
}

/** Dismisses the open Switch to Traffic / Draft as Traffic dialog with its "Keep <goal>" button. */
export async function keepGoalInTrafficDialog(page: Page): Promise<TrafficDialogKeepFact> {
  const dialog = getTrafficDialog(page);
  await expect(dialog, "The Switch to Traffic dialog must be open").toBeVisible({ timeout: 5_000 });
  const keep = dialog.getByRole("button", { name: /^Keep (?:Sales|Signups)$/ });
  const label = (await keep.innerText()).trim();
  await keep.click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  return {
    open: false,
    keptGoal: label.replace(/^Keep /, "") || null,
    cardState: (await readGoogleTrackingReadiness(page)).cardState,
    strategy: await readCampaignStrategySummary(page),
  };
}

export interface TrafficSwitchResultFact {
  cardState: TrackingCardState;
  /** True when the dialog was the PMax "Draft as Traffic" one: the agent redrafted the campaign as Search (no Switch Back). */
  redrafted: boolean;
  switchBackTo: "Sales" | "Signups" | null;
  strategy: CampaignStrategySummaryFact;
}

/**
 * Confirms the open Switch to Traffic / Draft as Traffic dialog. A Search draft switches in place and is
 * reversible with switchDraftBackFromTraffic while the draft is open. A PMax draft is redrafted by the agent as a
 * Search campaign (about a minute): there is no Switch Back, the way back is a new draft.
 */
export async function confirmSwitchToTraffic(page: Page): Promise<TrafficSwitchResultFact> {
  const dialog = getTrafficDialog(page);
  await expect(dialog, "The Switch to Traffic dialog must be open").toBeVisible({ timeout: 5_000 });
  const redrafted = (await readTrafficDialog(dialog)).kind === "redraft";
  await dialog.getByRole("button", { name: TRAFFIC_BUTTON }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(getTrackingCard(page)).toContainText("Running as Traffic", { timeout: redrafted ? 180_000 : 30_000 });
  const fact = await readGoogleTrackingReadiness(page);
  return {
    cardState: fact.cardState,
    redrafted,
    switchBackTo: fact.switchBackTo,
    strategy: await readCampaignStrategySummary(page),
  };
}

export interface TrafficSwitchBackFact {
  restoredFrom: "Sales" | "Signups";
  cardState: TrackingCardState;
  strategy: CampaignStrategySummaryFact;
}

/** Clicks "Switch Back to <goal>" on the Running as Traffic note. */
export async function switchDraftBackFromTraffic(page: Page): Promise<TrafficSwitchBackFact> {
  const back = getTrackingCard(page).getByRole("button", { name: /^Switch Back to (?:Sales|Signups)$/ });
  await expect(back, "The draft must be running as Traffic after a switch").toBeEnabled({ timeout: 30_000 });
  const restoredFrom = (await back.innerText()).trim().replace(/^Switch Back to /, "") as "Sales" | "Signups";
  await back.click();
  await expect.poll(async () => (await readGoogleTrackingReadiness(page)).cardState, { timeout: 30_000 })
    .not.toBe("traffic");
  return {
    restoredFrom,
    cardState: (await readGoogleTrackingReadiness(page)).cardState,
    strategy: await readCampaignStrategySummary(page),
  };
}
