import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import { openDashboardSettings, selectSettingsTab } from "../../../src/actions/settings-actions";
import { actionIndex, findActions, type ReuseEvent } from "../../../src/tools/action-index";

const runId = process.env.E2E_RUN_ID ?? "action-iteration-validation";
const root = path.resolve(import.meta.dirname, "../../..");
const hotlist = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
const indexStarted = performance.now();
const entries = await actionIndex(root, hotlist.actions);
const indexBuildMs = Math.round(performance.now() - indexStarted);

const matchedAction = (query: string, name: string) => {
  const started = performance.now();
  const match = entries.filter((entry) => entry.hot && entry.name === name).at(0) ??
    findActions(entries, query, "settings").find((entry) => entry.name === name);
  return { match, lookupMs: Math.max(1, Math.round(performance.now() - started)) };
};

async function useAction<T>(events: ReuseEvent[], caseId: string, intentId: string, intent: string,
  action: string, run: () => Promise<T>, verify: (fact: T) => void) {
  const { match, lookupMs } = matchedAction(intent, action);
  expect(match, `${action} must be indexed`).toBeTruthy();
  const started = performance.now();
  try {
    const fact = await run();
    verify(fact);
    events.push({ runId, caseId, intentId, intent, outcome: "hit", source: match!.hot ? "hot" : "index",
      action, lookupMs, executionMs: Math.round(performance.now() - started) });
    return fact;
  } catch (error) {
    events.push({ runId, caseId, intentId, intent, outcome: "miss", source: "playwright-explore",
      reason: "drift", lookupMs, executionMs: Math.round(performance.now() - started) });
    throw error;
  }
}

test("V1 Notification preferences agree with current read-only facts", async ({ page }, testInfo) => {
  const events: ReuseEvent[] = [];
  const started = performance.now();
  try {
    await useAction(events, "V1", "open-settings", "open Dashboard settings", "openDashboardSettings",
      () => openDashboardSettings(page), (fact) => { expect(fact.urlPath).toBe("/settings"); expect(fact.profileTabVisible).toBe(true); });
    const preferenceResponse = page.waitForResponse((response) => response.url().includes("/notifications/preferences") &&
      response.request().method() === "GET", { timeout: 20_000 });
    await useAction(events, "V1", "notifications-tab", "select notifications settings tab", "selectSettingsTab",
      () => selectSettingsTab(page, "Notifications"), (fact) => expect(fact.selected).toBe(true));
    await expect(page.getByRole("heading", { name: "Notification Types" })).toBeVisible();
    const uiEnabled = await page.getByRole("switch", { name: "Campaigns" }).getAttribute("data-state");
    const response = await preferenceResponse;
    expect(response.ok()).toBe(true);
    const data = await response.json() as { available: boolean; items: Array<{ category: string; enabled: boolean }> };
    const campaign = data.items.find((item) => item.category === "campaign");
    expect(campaign).toBeTruthy();
    expect(uiEnabled).toBe(campaign!.enabled ? "checked" : "unchecked");
    await writeFile(testInfo.outputPath("facts.json"), JSON.stringify({ available: data.available,
      campaignEnabled: campaign!.enabled, uiEnabled, indexBuildMs,
      elapsedMs: Math.round(performance.now() - started) }));
  } finally {
    await writeFile(testInfo.outputPath("action-events.json"), JSON.stringify(events));
  }
});

test("V2 Integrations status is visible without changing connection", async ({ page }, testInfo) => {
  const events: ReuseEvent[] = [];
  const started = performance.now();
  try {
    await useAction(events, "V2", "open-settings", "open Dashboard settings", "openDashboardSettings",
      () => openDashboardSettings(page), (fact) => { expect(fact.urlPath).toBe("/settings"); expect(fact.profileTabVisible).toBe(true); });
    await useAction(events, "V2", "integrations-tab", "select integrations settings tab", "selectSettingsTab",
      () => selectSettingsTab(page, "Integrations"), (fact) => expect(fact.selected).toBe(true));
    await expect(page.getByText("Stripe · Revenue Connect")).toBeVisible();
    await writeFile(testInfo.outputPath("facts.json"), JSON.stringify({ integrationVisible: true,
      indexBuildMs, elapsedMs: Math.round(performance.now() - started) }));
  } finally {
    await writeFile(testInfo.outputPath("action-events.json"), JSON.stringify(events));
  }
});
