import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import { openDashboardSettings, selectSettingsTab } from "../../../src/actions/settings-actions";
import { openDashboardAccountMenu, openDashboardDocs } from "../../../src/actions/support-actions";
import { actionIndex, findActions } from "../../../src/tools/action-index";

const runId = process.env.E2E_RUN_ID ?? "action-iteration-regression";
const root = path.resolve(import.meta.dirname, "../../..");
const hotlist = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
const indexStarted = performance.now();
const entries = await actionIndex(root, hotlist.actions);
const indexBuildMs = Math.round(performance.now() - indexStarted);
const lookup = (intent: string, action: string, domain: string) => {
  const started = performance.now();
  const match = entries.filter((entry) => entry.hot && entry.domain === domain && entry.name === action)
    .at(0) ?? findActions(entries, intent, domain).find((entry) => entry.name === action);
  return { match, lookupMs: Math.max(1, Math.round(performance.now() - started)) };
};

test("B1 Dashboard documentation from account menu", async ({ page }, testInfo) => {
  const events: unknown[] = [];
  const started = performance.now();
  try {
    await page.goto("/");
    const menuLookup = lookup("open dashboard account menu", "openDashboardAccountMenu", "support");
    expect(menuLookup.match).toBeTruthy();
    const menuStart = performance.now();
    const menu = await openDashboardAccountMenu(page);
    expect(menu.supportVisible || menu.docsVisible).toBe(true);
    events.push({ runId, caseId: "B1", intentId: "account-menu", intent: "open account menu",
      outcome: "hit", source: "index", action: "openDashboardAccountMenu", lookupMs: menuLookup.lookupMs,
      executionMs: Math.round(performance.now() - menuStart) });
    const docsLookup = lookup("open dashboard docs", "openDashboardDocs", "support");
    expect(docsLookup.match).toBeTruthy();
    const docsStart = performance.now();
    const docs = await openDashboardDocs(page);
    expect(docs.openedInNewTab).toBe(true);
    expect(new URL(docs.openedUrl).protocol).toBe("https:");
    events.push({ runId, caseId: "B1", intentId: "docs", intent: "open documentation",
      outcome: "hit", source: "index", action: "openDashboardDocs", lookupMs: docsLookup.lookupMs,
      executionMs: Math.round(performance.now() - docsStart) });
    await writeFile(testInfo.outputPath("facts.json"), JSON.stringify({ menu,
      docs: { openedInNewTab: docs.openedInNewTab, destinationHost: new URL(docs.openedUrl).hostname },
      indexBuildMs, elapsedMs: Math.round(performance.now() - started) }));
  } finally {
    await writeFile(testInfo.outputPath("action-events.json"), JSON.stringify(events));
  }
});

test("B2 Settings profile and organization are inspectable with current Actions", async ({ page }, testInfo) => {
  const events: unknown[] = [];
  const started = performance.now();
  try {
    const settingsLookup = lookup("open dashboard settings", "openDashboardSettings", "settings");
    expect(settingsLookup.match).toBeTruthy();
    const openStart = performance.now();
    const settings = await openDashboardSettings(page);
    expect(settings.urlPath).toBe("/settings");
    expect(settings.profileTabVisible).toBe(true);
    events.push({ runId, caseId: "B2", intentId: "open-settings", intent: "open Dashboard settings",
      outcome: "hit", source: settingsLookup.match!.hot ? "hot" : "index", action: "openDashboardSettings",
      lookupMs: settingsLookup.lookupMs,
      executionMs: Math.round(performance.now() - openStart) });
    const profileVisible = await page.locator('[data-slot="settings-clerk-panel"]').isVisible();
    const orgLookup = lookup("open organization settings", "selectSettingsTab", "settings");
    expect(orgLookup.match).toBeTruthy();
    const orgStart = performance.now();
    const organization = await selectSettingsTab(page, "Organization");
    expect(organization.selected).toBe(true);
    events.push({ runId, caseId: "B2", intentId: "organization-tab", intent: "open organization settings",
      outcome: "hit", source: orgLookup.match!.hot ? "hot" : "index", action: "selectSettingsTab",
      lookupMs: orgLookup.lookupMs,
      executionMs: Math.round(performance.now() - orgStart) });
    await writeFile(testInfo.outputPath("facts.json"), JSON.stringify({ profileVisible,
      organizationTabActive: true, urlPath: new URL(page.url()).pathname,
      indexBuildMs, elapsedMs: Math.round(performance.now() - started) }));
  } finally {
    await writeFile(testInfo.outputPath("action-events.json"), JSON.stringify(events));
  }
});
