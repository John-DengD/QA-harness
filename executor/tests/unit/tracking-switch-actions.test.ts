import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  confirmSwitchToTraffic,
  focusTrackingCardFromReadiness,
  keepGoalInTrafficDialog,
  openSwitchToTrafficDialog,
  readGoogleTrackingReadiness,
  readTrackingSetupLink,
  switchDraftBackFromTraffic,
} from "../../src/actions/google-tracking-actions";

// Markup mirrors apps/dashboard launch/tracking.tsx, launch/readiness.tsx and
// launch/draft.tsx on origin/staging (PR #1217). The blocking row's StateMark is
// the house Spinner, whose sr-only "Loading" comes first in the row text: the
// exact shape that made the old row lookup return "absent".
const spinner = '<output data-slot="spinner"><span class="sr-only">Loading</span></output>';
const railRow = (detail: string, issue: string) => `
  <button class="flex min-h-10" data-readiness-fix type="button"><span class="flex items-center gap-2.5">
    <span class="grid size-4 shrink-0 place-items-center text-spark">${spinner}</span>
    <span class="flex-1 text-[13px] text-cream">Conversion tracking</span>
    <span class="grid size-5 shrink-0 place-items-center text-spark"><svg aria-hidden="true"></svg>
      <span class="sr-only">${detail}<span> ${issue}</span></span></span>
  </span></button>`;
const okRow = (label: string) => `<div class="flex min-h-10"><span class="flex items-center gap-2.5">
  <span class="grid size-4"><span class="rounded-pill bg-mint/12"></span></span>
  <span class="flex-1 text-[13px] text-cream">${label}</span><span class="sr-only">ready</span></span></div>`;
const rail = (summary: string, rows: string) => `<div data-slot="launch-readiness">
  <div><span>Launch readiness</span><p role="status">${summary}</p></div>
  <div data-slot="readiness-checks"><div data-slot="readiness-results"><div class="flex flex-col">${rows}</div></div></div>
</div>`;
const strategy = (goal: string, type: string, bidding: string) => `
  <div class="grid gap-2 px-5 py-4 lg:grid-cols-[180px_1fr]"><div class="flex flex-col gap-1 pt-1.5"><div><span>
    <span class="font-mono uppercase">Goal</span></span></div></div>
    <div class="min-w-0"><span data-testid="campaign-goal">${goal}</span></div></div>
  <div class="grid gap-2 px-5 py-4 lg:grid-cols-[180px_1fr]" id="launch-campaign-type"><div class="flex flex-col gap-1 pt-1.5">
    <div><span><span class="font-mono uppercase">Campaign type</span></span></div></div>
    <div class="min-w-0"><div class="flex flex-col gap-2"><div class="flex min-h-10 items-center gap-1">
      <span class="font-medium text-[13px] text-cream">${type}</span><button type="button">How it reaches people</button></div>
      <p>Explainer</p></div></div></div>
  <div inert class="grid gap-2 px-5 py-4 lg:grid-cols-[180px_1fr]"><div class="flex flex-col gap-1 pt-1.5">
    <div><span><span class="font-mono uppercase">Bidding</span></span></div>
    <span class="text-[11.5px]">Set automatically for your goal</span></div>
    <div class="min-w-0"><span class="inline-flex items-center gap-2 text-[14px] text-cream">${bidding}<span data-slot="chip">Auto</span></span></div></div>`;
const loop = (status: string) => `<ol aria-label="How Google learns from this campaign">
  <li><span></span><span>Someone clicks your ad</span></li><li><span></span><span>They buy on your site</span></li>
  <li><span></span><span>Your site tells Google</span><span class="font-mono">${status}</span></li></ol>`;
const missingCard = `<div class="scroll-mt-4" id="launch-tracking" tabindex="-1">
  <div><svg></svg><span class="flex-1">Conversion tracking</span><span data-slot="chip">Required to launch</span></div>
  <div><p>This campaign asks Google to find people who buy.</p><p>Nothing on private.example reports purchases yet.</p>${loop("not set up")}</div>
  <div class="grid gap-3"><div><span>Install the tracker</span><a href="/tracking/setup?org=private-org" rel="noopener" target="_blank">Set Up Tracking</a></div>
    <div><span>Run as Traffic instead</span><button type="button" id="open-switch">Switch to Traffic</button></div></div></div>`;
const waitingCard = `<div class="scroll-mt-4" id="launch-tracking">
  <div><span class="flex-1">Conversion tracking</span><span data-slot="chip">Waiting for first visit</span></div>
  <div><p>Your tracker is installed on private.example but hasn't reported a visit yet.</p>${loop("waiting")}
    <a href="https://private.example" rel="noopener noreferrer" target="_blank">Open private.example</a>
    <span aria-live="polite">${spinner}Checking for the first visit…</span></div>
  <div><span>Rather not wait?</span><button type="button" id="open-switch">Switch to Traffic</button></div></div>`;
const liveCard = `<div class="scroll-mt-4" id="launch-tracking"><p><span>Conversion tracking</span>
  <span class="font-mono">tracker live on private.example</span></p><p>Your tracker is receiving visits.</p></div>`;
const dialog = `<div role="alertdialog" aria-labelledby="t" id="dialog" hidden>
  <h2 id="t">Run this campaign as Traffic?</h2>
  <p>Google will send people to your site, but it won't know who buys, so it can't aim for buyers.</p>
  <dl>${[["Goal", "Sales", "Traffic"], ["Bidding", "Maximize conversions", "Maximize clicks"],
    ["Campaign type", "Performance Max", "Search"], ["Keywords", "None", "Chosen from Google data for your site"],
    ["Ads", "Images and text", "Text ads"]].map(([label, from, to]) => `<div><dt>${label}</dt><dd>
      <span class="line-through">${from}</span><svg aria-label="becomes"></svg><span>${to}</span></dd></div>`).join("")}</dl>
  <p>Search shows text ads to people searching for what you sell.</p>
  <div><button type="button" id="keep">Keep Sales</button><button type="button" id="confirm">Switch to Traffic</button></div></div>`;

const page = (html: string, script = "") => `<main>${html}</main><script>${script}</script>`;
// Block-scoped: setContent reuses the window, so a top-level const would be redeclared.
const behaviour = `{
  const $ = (s) => document.querySelector(s);
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'open-switch') $('#dialog').hidden = false;
    if (target.id === 'keep') $('#dialog').hidden = true;
    if (target.id === 'confirm') {
      $('#dialog').hidden = true;
      setTimeout(() => {
        $('#launch-tracking').outerHTML = '<div class="scroll-mt-4" id="launch-tracking"><p>Running as Traffic</p>' +
          '<p>Google bids for clicks.</p><button type="button" id="back">Switch Back to Sales</button></div>';
        $('[data-testid="campaign-goal"]').textContent = 'Traffic';
        $('#launch-campaign-type span.font-medium').textContent = 'Search';
        $('[data-slot="chip"]').previousSibling.textContent = 'Maximize clicks';
      }, 50);
    }
    if (target.id === 'back') {
      setTimeout(() => {
        $('#launch-tracking').outerHTML = window.cardHtml;
        $('[data-testid="campaign-goal"]').textContent = 'Sales';
        $('#launch-campaign-type span.font-medium').textContent = 'Performance Max';
      }, 50);
    }
    if (target.hasAttribute('data-readiness-fix')) {
      requestAnimationFrame(() => {
        const card = $('#launch-tracking');
        card.scrollIntoView();
        card.querySelector('a, button').focus();
      });
    }
  });
  window.cardHtml = document.querySelector('#launch-tracking')?.outerHTML;
}`;

vi.setConfig({ testTimeout: 30_000 });

let browser: Browser;
let tab: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  tab = await browser.newPage({ viewport: { width: 1280, height: 700 } });
});
afterAll(async () => browser.close());

describe("readGoogleTrackingReadiness", () => {
  it("finds the blocking row behind the Spinner's sr-only Loading and reads its text", async () => {
    await tab.setContent(page(missingCard + rail("1 thing to fix before you can launch.",
      okRow("Ad") + railRow("required", "Install the tracker, or switch this campaign to Traffic."))));
    const fact = await readGoogleTrackingReadiness(tab);
    expect(fact).toMatchObject({
      cardState: "missing", conversionLoopLastStep: "not set up", setupLinkVisible: true,
      trafficSwitchVisible: true, checkingFirstVisitVisible: false,
      readiness: {
        summary: "1 thing to fix before you can launch.",
        conversionTrackingRow: "required",
        conversionTrackingIssues: ["Install the tracker, or switch this campaign to Traffic."],
      },
    });
    expect(JSON.stringify(fact)).not.toMatch(/private\.example|private-org/);
  });

  it("reads the waiting card and the row text it shows while waiting", async () => {
    await tab.setContent(page(waitingCard + rail("1 thing to fix before you can launch.",
      railRow("required", "Install the tracker, or switch this campaign to Traffic."))));
    expect(await readGoogleTrackingReadiness(tab)).toMatchObject({
      cardState: "waiting", conversionLoopLastStep: "waiting", checkingFirstVisitVisible: true,
      setupLinkVisible: false, trafficSwitchVisible: true,
      readiness: { conversionTrackingRow: "required",
        conversionTrackingIssues: ["Install the tracker, or switch this campaign to Traffic."] },
    });
  });

  it("reads live and Traffic without a tracking row", async () => {
    await tab.setContent(page(liveCard + rail("Everything checks out. Launch when it looks right.", okRow("Ad"))));
    expect(await readGoogleTrackingReadiness(tab)).toMatchObject({
      cardState: "live", readiness: { conversionTrackingRow: "absent", conversionTrackingIssues: [] },
    });
    await tab.setContent(page(`<div id="launch-tracking"><p>Running as Traffic</p>
      <button>Switch Back to Signups</button></div>` + rail("Readiness checks run once your draft is ready.", "")));
    expect(await readGoogleTrackingReadiness(tab)).toMatchObject({
      cardState: "traffic", switchBackTo: "Signups",
      readiness: { summary: "Readiness checks run once your draft is ready.", conversionTrackingRow: "absent" },
    });
  });
});

describe("tracking card Actions", () => {
  it("moves from the readiness row to the tracking card", async () => {
    await tab.setContent(page(`<div style="height:2000px"></div>` + missingCard +
      rail("1 thing to fix", railRow("required", "Install the tracker.")), behaviour));
    expect(await focusTrackingCardFromReadiness(tab)).toEqual({
      rowDetail: "required", cardState: "missing", cardInViewport: true,
      focusInsideCard: true, focusedControl: "Set Up Tracking",
    });
  });

  it("reads the setup link without opening it or exposing the org id", async () => {
    await tab.setContent(page(missingCard));
    const fact = await readTrackingSetupLink(tab);
    expect(fact).toEqual({ visible: true, label: "Set Up Tracking", path: "/tracking/setup",
      carriesOrgParam: true, orgParamMatchesActiveOrg: null, opensNewTab: true, rel: "noopener" });
  });

  it("compares the setup link's org with the tab's active org without returning either", async () => {
    const context = await browser.newContext({ baseURL: "http://campaign.test" });
    const other = await context.newPage();
    await other.route("http://campaign.test/campaigns/new", (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: page(missingCard) }));
    await other.goto("/campaigns/new");
    await other.evaluate(() => sessionStorage.setItem("hellyeah:active-org:user_1", "private-org"));
    expect(await readTrackingSetupLink(other)).toMatchObject({ carriesOrgParam: true, orgParamMatchesActiveOrg: true });
    await other.evaluate(() => sessionStorage.setItem("hellyeah:active-org:user_1", "another-org"));
    const fact = await readTrackingSetupLink(other);
    expect(fact.orgParamMatchesActiveOrg).toBe(false);
    expect(JSON.stringify(fact)).not.toMatch(/private-org|another-org/);
    await context.close();
  });

  it("opens the Switch to Traffic dialog and reads every listed change", async () => {
    await tab.setContent(page(missingCard + dialog + strategy("Sales", "Performance Max", "Maximize conversions"), behaviour));
    expect(await openSwitchToTrafficDialog(tab)).toEqual({
      open: true,
      kind: "switch",
      explanation: "Search shows text ads to people searching for what you sell.",
      title: "Run this campaign as Traffic?",
      description: "Google will send people to your site, but it won't know who buys, so it can't aim for buyers.",
      changes: [
        { label: "Goal", from: "Sales", to: "Traffic" },
        { label: "Bidding", from: "Maximize conversions", to: "Maximize clicks" },
        { label: "Campaign type", from: "Performance Max", to: "Search" },
        { label: "Keywords", from: "None", to: "Chosen from Google data for your site" },
        { label: "Ads", from: "Images and text", to: "Text ads" },
      ],
      keepLabel: "Keep Sales",
      confirmLabel: "Switch to Traffic",
    });
    expect(await keepGoalInTrafficDialog(tab)).toEqual({
      open: false, keptGoal: "Sales", cardState: "missing",
      strategy: { goal: "Sales", campaignType: "Performance Max", bidding: "Maximize conversions" },
    });
  });

  it("confirms the switch and switches back, reading the strategy each time", async () => {
    await tab.setContent(page(missingCard + dialog + strategy("Sales", "Performance Max", "Maximize conversions"), behaviour));
    await openSwitchToTrafficDialog(tab);
    expect(await confirmSwitchToTraffic(tab)).toEqual({
      cardState: "traffic", switchBackTo: "Sales", redrafted: false,
      strategy: { goal: "Traffic", campaignType: "Search", bidding: "Maximize clicks" },
    });
    expect(await switchDraftBackFromTraffic(tab)).toMatchObject({
      restoredFrom: "Sales", cardState: "missing",
      strategy: { goal: "Sales", campaignType: "Performance Max" },
    });
  });

  it("refuses to confirm when no dialog is open", async () => {
    await tab.setContent(page(missingCard));
    await expect(confirmSwitchToTraffic(tab)).rejects.toThrow(/dialog/i);
  });
});

// PR #1327 (origin/staging apps/dashboard launch/tracking.tsx): a PMax draft's card button is "Draft as Traffic"
// and its dialog is "Draft a Traffic campaign instead?" with a paragraph instead of the change list; its
// confirm button is "Draft as Traffic" and redrafts the campaign as Search (no Switch Back). A Search draft
// has no switch button at all. The header chip of a missing card reads "Not set up".
const pmaxCard = `<div class="scroll-mt-4" id="launch-tracking" tabindex="-1">
  <div><span class="flex-1">Conversion tracking</span><span data-slot="chip">Not set up</span></div>
  <div><p>Google can't see your purchases yet, so a Sales campaign would spend without learning.</p>${loop("not set up")}</div>
  <div class="grid gap-3"><div><span>Start with Traffic</span><span data-slot="chip">Launch today</span>
    <button type="button" id="open-switch">Draft as Traffic</button><span>Your agent redrafts it in about a minute.</span></div>
    <div><span>Set up tracking</span><a href="/tracking/setup?org=private-org" rel="noopener" target="_blank">Set Up Tracking</a></div></div></div>`;
const pmaxDialog = `<div role="alertdialog" aria-labelledby="t2" aria-describedby="d2" id="dialog" hidden>
  <h2 id="t2">Draft a Traffic campaign instead?</h2>
  <p id="d2">Google still sends real visitors, which helps most while few people find your site. It just won't know which ones buy.</p>
  <p>Performance Max only bids for purchases, so your agent redrafts this as a Search campaign that brings visitors.</p>
  <div><button type="button" id="keep">Keep Sales</button><button type="button" id="confirm">Draft as Traffic</button></div></div>`;
// A redraft is not in place: after the agent finishes, the draft is a Search + Traffic draft with a note and no Switch Back.
const redraftBehaviour = `{
  const $ = (s) => document.querySelector(s);
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'open-switch') $('#dialog').hidden = false;
    if (target.id === 'keep') $('#dialog').hidden = true;
    if (target.id === 'confirm') {
      $('#dialog').hidden = true;
      setTimeout(() => {
        $('#launch-tracking').outerHTML = '<div class="scroll-mt-4" id="launch-tracking"><p>Running as Traffic</p>' +
          '<a href="/tracking/setup">Set Up Tracking</a></div>';
        $('[data-testid="campaign-goal"]').textContent = 'Traffic';
        $('#launch-campaign-type span.font-medium').textContent = 'Search';
        $('[data-slot="chip"]').previousSibling.textContent = 'Maximize clicks';
      }, 50);
    }
  });
}`;

describe("PMax Draft as Traffic (PR #1327)", () => {
  it("reads a missing card chip 'Not set up' as missing and tells Draft as Traffic from no button", async () => {
    await tab.setContent(page(pmaxCard + rail("1 thing to fix before you can launch.",
      railRow("required", "Install the tracker, or switch this campaign to Traffic."))));
    expect(await readGoogleTrackingReadiness(tab)).toMatchObject({
      cardState: "missing", trafficSwitchVisible: true, trafficSwitchLabel: "Draft as Traffic", setupLinkVisible: true,
      readiness: { conversionTrackingRow: "required" },
    });
    await tab.setContent(page(missingCard));
    expect(await readGoogleTrackingReadiness(tab)).toMatchObject({
      cardState: "missing", trafficSwitchVisible: true, trafficSwitchLabel: "Switch to Traffic",
    });
    // A Search draft: the tracker is still missing but the draft already runs as Traffic with no switch button.
    await tab.setContent(page(`<div id="launch-tracking"><p>Running as Traffic</p><a href="/tracking/setup">Set Up Tracking</a></div>`));
    expect(await readGoogleTrackingReadiness(tab)).toMatchObject({
      cardState: "traffic", trafficSwitchVisible: false, trafficSwitchLabel: null, switchBackTo: null,
    });
  });

  it("opens the Draft a Traffic campaign instead dialog, reads its explanation and keeps the goal", async () => {
    await tab.setContent(page(pmaxCard + pmaxDialog + strategy("Sales", "Performance Max", "Maximize conversions"), behaviour));
    expect(await openSwitchToTrafficDialog(tab)).toEqual({
      open: true,
      kind: "redraft",
      title: "Draft a Traffic campaign instead?",
      description: "Google still sends real visitors, which helps most while few people find your site. It just won't know which ones buy.",
      explanation: "Performance Max only bids for purchases, so your agent redrafts this as a Search campaign that brings visitors.",
      changes: [],
      keepLabel: "Keep Sales",
      confirmLabel: "Draft as Traffic",
    });
    expect(await keepGoalInTrafficDialog(tab)).toEqual({
      open: false, keptGoal: "Sales", cardState: "missing",
      strategy: { goal: "Sales", campaignType: "Performance Max", bidding: "Maximize conversions" },
    });
  });

  it("still reads the old Switch to Traffic dialog as a switch with its change list", async () => {
    await tab.setContent(page(missingCard + dialog + strategy("Sales", "Performance Max", "Maximize conversions"), behaviour));
    expect(await openSwitchToTrafficDialog(tab)).toMatchObject({ kind: "switch", confirmLabel: "Switch to Traffic",
      explanation: "Search shows text ads to people searching for what you sell." });
  });

  it("confirms the redraft and reports it as a redraft with no Switch Back", async () => {
    await tab.setContent(page(pmaxCard + pmaxDialog + strategy("Sales", "Performance Max", "Maximize conversions"), redraftBehaviour));
    await openSwitchToTrafficDialog(tab);
    expect(await confirmSwitchToTraffic(tab)).toEqual({
      cardState: "traffic", switchBackTo: null, redrafted: true,
      strategy: { goal: "Traffic", campaignType: "Search", bidding: "Maximize clicks" },
    });
  });
});
