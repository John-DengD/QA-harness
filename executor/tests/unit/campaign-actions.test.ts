import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  closeCampaignCreativePicker,
  confirmCampaignCreativeImport,
  observeCampaignKeywords,
  observeCampaignCreativeCards,
  observeCampaignLaunchReadiness,
  observeCampaignType,
  openCampaignCreativePicker,
  selectCampaignGoogleSearchCreative,
  setCampaignBudget,
  setCampaignDeliveryDays,
  submitCampaignLaunch,
} from "../../src/actions/campaign-actions";

it("returns observed facts for Campaign editor actions without repeating a launch", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://campaign.test" });
    const page = await context.newPage();
    let launches = 0;
    await page.route("http://campaign.test/campaigns/new", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<p>Ready to launch.</p>
          <div class="grid lg:grid-cols-[180px_1fr]">
            <div><div><span><span>Campaign type</span></span></div></div>
            <div><div><span id="type">Search</span></div></div>
          </div>
          <button id="details" aria-expanded="false">Details</button>
          <div id="details-panel" hidden>
            <div class="grid lg:grid-cols-[180px_1fr]">
              <div><div><span><span>Keywords</span></span></div></div>
              <div><div id="chips">
                <span data-slot="chip">AI interview preparation<span>10/mo · $1.20</span></span>
                <span data-slot="chip">toy collectibles<span>Low volume</span></span>
              </div></div>
            </div>
          </div>
          <div role="group" aria-label="Budget presets">
            <button aria-pressed="false" id="preset-50">$50</button>
            <button aria-pressed="false" id="preset-100">$100</button>
          </div>
          <label>Campaign budget in dollars<input id="budget" type="number"></label>
          <button aria-label="Start date: Oct 2, 2026">Start date</button>
          <button aria-label="End date: Oct 3, 2026" id="end">End date</button>
          <div role="grid" aria-label="October 2026" hidden>
            <button data-calendar-date="2026-10-11">11</button>
          </div>
          <div data-slot="launch-creative-card">Creative</div>
          <button id="launch">Launch Campaign</button>
          <script>
            const details = document.querySelector('#details');
            details.onclick = () => {
              details.setAttribute('aria-expanded', 'true');
              document.querySelector('#details-panel').hidden = false;
            };
            const presets = document.querySelectorAll('[aria-label="Budget presets"] button');
            presets.forEach(preset => preset.onclick = () => {
              presets.forEach(button => button.setAttribute('aria-pressed', String(button === preset)));
              document.querySelector('#budget').value = '';
            });
            document.querySelector('#budget').onblur = event => {
              const value = Number(event.target.value);
              presets.forEach(button => button.setAttribute('aria-pressed', String(Number(button.textContent.slice(1)) === value)));
              if ([50, 100].includes(value)) event.target.value = '';
            };
            document.querySelector('#end').onclick = () => document.querySelector('[role=grid]').hidden = false;
            document.querySelector('[data-calendar-date]').onkeydown = event => {
              if (event.key !== 'Enter') return;
              document.querySelector('#end').setAttribute('aria-label', 'End date: Oct 11, 2026');
              document.querySelector('[role=grid]').hidden = true;
            };
            document.querySelector('#launch').onclick = () => fetch('/api/v1/campaigns/launch', {
              method: 'POST',
              headers: {'Content-Type': 'application/json', 'Idempotency-Key': 'qa-key-1'},
              body: JSON.stringify({name: 'E2E Search Launch'}),
            });
          </script>`,
      })
    );
    await page.route("http://campaign.test/api/v1/campaigns/launch", (route) => {
      launches += 1;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ id: "campaign-test-1", funded: true }),
      });
    });
    await page.goto("/campaigns/new");

    expect(await observeCampaignType(page)).toEqual({ selectedType: "Search" });
    expect(await observeCampaignKeywords(page)).toEqual({
      keywords: ["AI interview preparation", "toy collectibles"],
    });
    expect(await page.getByRole("combobox", { name: /Campaign type/i }).count()).toBe(0);
    expect(await page.getByRole("textbox", { name: /Keywords/i }).count()).toBe(0);
    expect(await setCampaignBudget(page, 50)).toEqual({ effectiveBudgetDollars: 50 });
    expect(await page.getByLabel("Campaign budget in dollars").inputValue()).toBe("");
    expect(await setCampaignBudget(page, 75)).toEqual({ effectiveBudgetDollars: 75 });
    expect(await page.getByLabel("Campaign budget in dollars").inputValue()).toBe("75");
    expect(await setCampaignBudget(page, 50)).toEqual({ effectiveBudgetDollars: 50 });
    expect(await setCampaignDeliveryDays(page, 10)).toEqual({
      startDateButtonName: "Start date: Oct 2, 2026",
      endDateButtonName: "End date: Oct 11, 2026",
    });
    expect(await observeCampaignCreativeCards(page)).toEqual({ creativeCardCount: 1 });
    expect(await observeCampaignLaunchReadiness(page)).toEqual({ enabled: true });
    expect(await submitCampaignLaunch(page)).toEqual({
      campaignId: "campaign-test-1",
      funded: true,
      idempotencyKey: "qa-key-1",
      requestName: "E2E Search Launch",
      requestObserved: true,
      responseStatus: 202,
      responseUrl: "http://campaign.test/api/v1/campaigns/launch",
    });
    expect(launches).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);

it("composes the picker, selection, and import confirmation atoms", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<button id="import">Import from Studio</button>
      <section role="region" aria-label="Import from Studio">
      <div data-slot="launch-creative-panel" inert>
        <div role="group" aria-label="Search creatives">
          <button aria-label="Select Demo for Google" aria-pressed="false" id="select">Demo</button>
        </div>
        <button disabled id="use">Use Creative</button>
        <button aria-label="Close Creative Picker" id="close">Close</button>
      </div>
    </section><script>
      document.querySelector('#import').onclick = () =>
        document.querySelector('[data-slot=launch-creative-panel]').removeAttribute('inert');
      document.querySelector('#select').onclick = event => {
        event.target.setAttribute('aria-pressed', 'true');
        document.querySelector('#use').disabled = false;
      };
      document.querySelector('#use').onclick = () => {
        const card = document.createElement('div');
        card.dataset.slot = 'launch-creative-card';
        card.textContent = 'Demo';
        document.body.append(card);
      };
      document.querySelector('#close').onclick = () => {
        document.querySelector('[data-slot=launch-creative-panel]').setAttribute('inert', '');
      };
    </script>`);

    expect(await observeCampaignCreativeCards(page)).toEqual({ creativeCardCount: 0 });
    expect(await openCampaignCreativePicker(page)).toEqual({ open: true });
    expect(await selectCampaignGoogleSearchCreative(page)).toEqual({ selected: true });
    expect(await confirmCampaignCreativeImport(page)).toEqual({ creativeCardCount: 1 });
    expect(await closeCampaignCreativePicker(page)).toEqual({ open: false });
    expect(await observeCampaignCreativeCards(page)).toEqual({ creativeCardCount: 1 });
  } finally {
    await browser.close();
  }
}, 20_000);

it("reports an agent-drafted Performance Max type with no Search keywords without editing either field", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="grid lg:grid-cols-[180px_1fr]">
      <div><div><span><span>Campaign type</span></span></div></div>
      <div><div><span>Performance Max</span></div></div>
    </div><div class="grid lg:grid-cols-[180px_1fr]">
      <div><div><span><span>Keywords</span></span></div></div>
      <div><p>Performance Max finds audiences automatically — no keywords needed.</p></div>
    </div>`);

    expect(await observeCampaignType(page)).toEqual({ selectedType: "Performance Max" });
    expect(await observeCampaignKeywords(page)).toEqual({ keywords: [] });
  } finally {
    await browser.close();
  }
}, 20_000);
