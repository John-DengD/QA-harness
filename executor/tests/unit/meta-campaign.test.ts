import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  discardMetaDraft,
  inspectMetaCampaignDraft,
  openMetaDraftComposer,
  selectMetaCampaign,
  waitForMetaCampaignDraft,
} from "../../src/actions/meta-byo-actions";

it("returns campaign type, delivery, readiness, and launch facts", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<h2 id="launch-draft-heading">Prepare an IAP campaign</h2>
      <div><div><span><span>Campaign type</span></span></div><div>In-app purchases</div></div>
      <div><div><span><span>Delivery Optimization</span></span></div><div>In-app purchases Auto</div></div>
      <aside data-slot="launch-readiness">App campaign ready</aside>
      <button disabled>Launch Campaign</button>`);
    const fact = await inspectMetaCampaignDraft(page);
    expect(fact.campaignType).toContain("In-app purchases");
    expect(fact.deliveryOptimization).toContain("In-app purchases");
    expect(fact.readiness).toContain("App campaign ready");
    expect(fact.launchEnabled).toBe(false);
    expect(fact.agentStillRunning).toBe(false);
  } finally {
    await browser.close();
  }
});

it("separates draft navigation, discard, and Meta selection while observing a blocked draft", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/campaigns/new", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<button id="discard">Discard Draft</button>
          <button id="meta">Run Meta campaign</button>
          <input hidden placeholder="Launch a campaign to drive trial signups…">
          <a href="/brand?edit=true">Edit Brand Profile</a>
          <script>
            window.discardCount = 0;
            window.metaCount = 0;
            document.querySelector('#discard').onclick = () => {
              window.discardCount++;
              document.querySelector('#discard').hidden = true;
            };
            document.querySelector('#meta').onclick = () => {
              window.metaCount++;
              document.querySelector('input').hidden = false;
            };
          </script>`,
      })
    );

    expect(await openMetaDraftComposer(page)).toEqual({
      pageUrl: "http://test.local/campaigns/new",
      existingDraftVisible: true,
    });
    expect(await discardMetaDraft(page)).toEqual({ discarded: true });
    expect(await page.locator("input").count()).toBe(1);
    expect(await page.locator("input").getAttribute("placeholder")).toBe(
      "Launch a campaign to drive trial signups…"
    );
    expect(await selectMetaCampaign(page)).toEqual({ goalInputVisible: true });
    expect(await waitForMetaCampaignDraft(page)).toEqual({ state: "blocked" });
    expect(await page.evaluate(() => ({
      discard: (window as typeof window & { discardCount: number }).discardCount,
      meta: (window as typeof window & { metaCount: number }).metaCount,
    }))).toEqual({ discard: 1, meta: 1 });
  } finally {
    await browser.close();
  }
}, 20_000);
