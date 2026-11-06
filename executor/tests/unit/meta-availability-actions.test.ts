import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  generateStudioSet,
  observeCampaignPlatformAvailability,
  observeStudioComposerPlatformSummary,
  observeStudioMetaVisibility,
  observeStudioReferenceMedia,
  selectStudioReference,
} from "../../src/actions/meta-availability-actions";

describe("Meta availability observation atoms", () => {
  it("reads an absent campaign switch and Google-only Studio affordances", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <main>
          <button>Send</button>
          <section aria-label="Studio">
            <article><p>Google</p><button>View Creative set</button></article>
            <article><p>Google</p><button>View Creative set 2</button></article>
          </section>
          <p>2 sets · Google</p>
          <div data-slot="studio-picks">
            <button aria-label="Select Reference 1" aria-pressed="false">
              <img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'%3E%3C/svg%3E">
            </button>
          </div>
          <script>
            document.querySelector('[aria-label="Select Reference 1"]').onclick = (event) =>
              event.currentTarget.setAttribute('aria-pressed', 'true');
          </script>
        </main>`);

      expect(await observeCampaignPlatformAvailability(page)).toEqual({
        switchVisible: false,
        googleOptionVisible: false,
        metaOptionVisible: false,
      });
      expect(await observeStudioMetaVisibility(page)).toMatchObject({
        cardCount: 2,
        metaCardSwitchVisible: false,
        metaCardLabelCount: 0,
        reviewMetaSwitchVisible: false,
      });
      expect(await observeStudioComposerPlatformSummary(page)).toEqual({
        summary: "2 sets · Google",
        googleOnlySummaryVisible: true,
        metaSummaryVisible: false,
      });
      expect(await selectStudioReference(page, 1)).toEqual({ selected: true, selectedCount: 1 });
      expect(await observeStudioReferenceMedia(page)).toEqual({
        selectedImageCount: 1, selectedImageLoaded: true,
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("records a planning failure without enqueueing a set", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route("http://test.local/api/v1/creative/plans", (route) =>
        route.fulfill({
          contentType: "application/json", status: 503,
          body: JSON.stringify({ code: "E_CREATIVE_PLAN_UNAVAILABLE" }),
        })
      );
      await page.route("http://test.local/", (route) => route.fulfill({
        contentType: "text/html",
        body: `<button onclick="fetch('/api/v1/creative/plans', {method: 'POST'})">Generate 1 Set</button>`,
      }));
      await page.goto("http://test.local/");
      expect(await generateStudioSet(page)).toMatchObject({
        clicked: true,
        planResponseStatus: 503,
        planErrorCode: "E_CREATIVE_PLAN_UNAVAILABLE",
        requestObserved: false,
        responseStatus: null,
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("records the Google bundle after a successful plan and set enqueue", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route("http://test.local/api/v1/creative/plans", (route) =>
        route.fulfill({ contentType: "application/json", status: 200, body: "{}" })
      );
      await page.route("http://test.local/api/v1/creative/sets", (route) =>
        route.fulfill({
          contentType: "application/json", status: 202,
          body: JSON.stringify({
            creativeSetId: "11111111-2222-4333-a444-555555555555",
            bundles: { google: { platform: "google" } },
            imageJobIds: ["a", "b"],
          }),
        })
      );
      await page.route("http://test.local/", (route) => route.fulfill({
        contentType: "text/html",
        body: `<button onclick="(async()=>{const plan=await fetch('/api/v1/creative/plans',{method:'POST'});if(plan.ok)await fetch('/api/v1/creative/sets',{method:'POST'})})()">Generate 1 Set</button>`,
      }));
      await page.goto("http://test.local/");
      expect(await generateStudioSet(page)).toMatchObject({
        clicked: true,
        planResponseStatus: 200,
        requestObserved: true,
        responseStatus: 202,
        creativeSetId: "11111111-2222-4333-a444-555555555555",
        googleBundleReturned: true,
        metaBundleReturned: false,
        imageJobCount: 2,
      });
    } finally {
      await browser.close();
    }
  }, 30_000);
});
