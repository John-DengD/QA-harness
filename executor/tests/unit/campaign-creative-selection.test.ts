import { chromium } from "@playwright/test";
import { expect, it } from "vitest";
import {
  confirmCampaignCreativeImport,
  selectCampaignGoogleSearchCreative,
} from "../../src/actions/campaign-actions";

it("selects Google Search even when a Meta creative is already selected first", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section role="region" aria-label="Import from Studio">
      <div role="group" aria-label="Search creatives">
        <button aria-label="Select Similar ad for Meta" aria-pressed="true" onclick="window.metaClicked=true">Meta</button>
        <button aria-label="Select Similar ad for Google" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');document.querySelector('#use').disabled=false;window.selected='google'">Google</button>
      </div>
      <button id="use" disabled onclick="window.confirmed=window.selected;document.body.insertAdjacentHTML('beforeend','<div data-slot=&quot;launch-creative-card&quot;>Google</div>')">Use Creative</button>
    </section>`);
    expect(await selectCampaignGoogleSearchCreative(page)).toEqual({ selected: true });
    expect(await confirmCampaignCreativeImport(page)).toEqual({ creativeCardCount: 1 });
    expect(await page.evaluate("window.confirmed")).toBe("google");
    expect(await page.evaluate("Boolean(window.metaClicked)")).toBe(false);
  } finally {
    await browser.close();
  }
});
