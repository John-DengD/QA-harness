import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  closeCampaignCreativePicker,
  openCampaignCreativePicker,
  readCampaignStrategySummary,
  resumeSavedCampaignDraft,
  retryCampaignChangesSave,
  startOverCampaignDraft,
  submitCampaignGoal,
} from "../../src/actions/campaign-actions";

// Mirrors launch/screen.tsx GoalEntry (Saved draft card, composer), the draft
// header's Start Over, and the "Changes could not be saved. Retry saving" alert.
const goalScreen = (saved: boolean) => `<section id="goal">
  ${saved ? `<div><span>Saved draft</span><p class="truncate">Drive purchases for the shop</p>
    <button type="button" id="discard">Discard Draft</button><button type="button" id="resume">Resume Draft</button></div>` : ""}
  <textarea placeholder="Launch a campaign to drive trial signups…"></textarea><button aria-label="Send" disabled>Send</button>
</section>`;
const draftScreen = `<section id="draft"><div id="launch-start-over"><button type="button" id="over">Start Over</button></div>
  <div class="grid lg:grid-cols-[180px_1fr]"><div><div><span><span>Goal</span></span></div></div>
    <div class="min-w-0"><span data-testid="campaign-goal">Sales</span></div></div>
  <div class="grid lg:grid-cols-[180px_1fr]" id="launch-campaign-type"><div><div><span><span>Campaign type</span></span></div></div>
    <div class="min-w-0"><div><div><span class="font-medium">Performance Max</span><button>i</button></div></div></div></div>
  <div class="grid lg:grid-cols-[180px_1fr]"><div><div><span><span>Bidding</span></span></div><span>Set automatically for your goal</span></div>
    <div class="min-w-0"><span class="inline-flex">Maximize conversions<span data-slot="chip">Auto</span></span></div></div>
  <div class="text-destructive" role="alert" id="failed">Changes could not be saved.<button type="button" id="retry">Retry saving</button></div>
</section>`;
const app = `<main id="app"></main><script>
  const app = document.querySelector('#app');
  const render = (html) => { app.innerHTML = html; };
  window.goal = ${JSON.stringify(goalScreen(true))};
  window.draft = ${JSON.stringify(draftScreen)};
  render(window.goal);
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'resume') setTimeout(() => render(window.draft), 50);
    if (button.id === 'over') setTimeout(() => render(window.goal), 50);
    if (button.id === 'retry') {
      // Like screen.tsx, the alert leaves while the save runs and returns if it fails again.
      const alert = document.querySelector('#failed');
      const parent = alert.parentElement;
      alert.remove();
      setTimeout(async () => {
        const response = await fetch('/api/proxy/api/v1/campaigns/plans/11111111-2222-4333-8444-555555555555', { method: 'PUT', body: '{}' });
        if (!response.ok) setTimeout(() => parent.appendChild(alert), 300);
      }, 700);
    }
  });
</script>`;

let browser: Browser;
let context: BrowserContext;
beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ baseURL: "http://campaign.test" });
});
afterAll(async () => browser.close());

it("resumes a saved draft, reads its strategy, and parks it again with Start Over", async () => {
  const page = await context.newPage();
  await page.route("http://campaign.test/campaigns/new", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: app }));
  await page.goto("/campaigns/new");
  expect(await resumeSavedCampaignDraft(page)).toEqual({
    resumed: true, savedDraftCardVisible: false, startOverVisible: true,
    strategy: { goal: "Sales", campaignType: "Performance Max", bidding: "Maximize conversions" },
  });
  expect(await readCampaignStrategySummary(page)).toEqual({
    goal: "Sales", campaignType: "Performance Max", bidding: "Maximize conversions",
  });
  expect(await startOverCampaignDraft(page)).toEqual({ composerVisible: true, savedDraftCardVisible: true });
  await page.close();
}, 20_000);

it("retries a failed save once and reports the response it got", async () => {
  const page = await context.newPage();
  let saves = 0;
  await page.route("http://campaign.test/campaigns/new", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: app.replace("render(window.goal);", "render(window.draft);") }));
  await page.route("http://campaign.test/api/proxy/api/v1/campaigns/plans/*", (route) => {
    saves += 1;
    return route.fulfill({ status: 409, contentType: "application/json", body: '{"message":"updated elsewhere"}' });
  });
  await page.goto("/campaigns/new");
  expect(await retryCampaignChangesSave(page)).toEqual({
    requestObserved: true, responseStatus: 409, saveFailedVisible: true,
  });
  expect(saves).toBe(1);
  await page.close();
}, 20_000);

it("reports that a submitted goal left the composer", async () => {
  const page = await context.newPage();
  await page.setContent(`<div id="c"><textarea placeholder="Launch a campaign to drive trial signups…"></textarea>
    <button aria-label="Send" disabled>Send</button></div><script>
    const input = document.querySelector('textarea');
    input.oninput = () => { document.querySelector('button').disabled = !input.value; };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault();
      document.querySelector('#c').innerHTML = '<div id="launch-start-over"><button>Start Over</button></div>'; } };
  </script>`);
  expect(await submitCampaignGoal(page, "Drive purchases for the shop")).toEqual({
    composerVisible: false, startOverVisible: true,
  });
  await page.close();
}, 20_000);

it("opens and closes the Ad picker under its current labels (Change Ads / Close Ad Picker)", async () => {
  const page = await context.newPage();
  // launch/creatives.tsx: the picker and the card swap layers; the hidden one is inert.
  await page.setContent(`<div id="picker-layer" inert><div><section data-slot="launch-creative-panel">
      <button type="button" id="close"><svg aria-hidden="true"></svg><span class="sr-only">Close Ad Picker</span></button></section></div></div>
    <div id="card-layer"><div data-slot="launch-creative-card"><span>Ads</span><button type="button" id="change">Change Ads</button></div></div>
    <script>
      const picker = document.querySelector('#picker-layer'); const card = document.querySelector('#card-layer');
      document.querySelector('#change').onclick = () => { picker.inert = false; card.inert = true; };
      document.querySelector('#close').onclick = () => { picker.inert = true; card.inert = false; };
    </script>`);
  expect(await openCampaignCreativePicker(page)).toEqual({ open: true });
  expect(await closeCampaignCreativePicker(page)).toEqual({ open: false });
  await page.close();
}, 20_000);
