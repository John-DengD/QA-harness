import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  expandCampaignCopyEditor,
  observeCampaignCopyActions,
  observeCampaignDraftStable,
  observeCampaignLaunchButton,
  observeCampaignLaunchConfirmation,
  observeCampaignPendingReview,
  observeCampaignTypeLabel,
  openCampaignDraft,
  openCampaignList,
  openCampaignOnboardingDraft,
  setCampaignDeliveryDays,
  waitForCampaignDraft,
} from "../../src/actions/campaign-actions";

describe("Campaign single-intent actions", () => {
  it("recognizes a settled draft, editor controls, and copy expansion", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<p id="status">Checking updated readiness…</p>
        <span>Campaign type</span>
        <button id="edit" aria-expanded="false">Edit copy</button>
        <button>Regenerate Copy</button>
        <button>Launch Campaign</button>
        <script>
          document.querySelector('#edit').onclick = event =>
            event.currentTarget.setAttribute('aria-expanded', 'true');
        </script>`);

      expect(await observeCampaignDraftStable(page)).toEqual({ visible: false });
      await page.locator("#status").evaluate((status) => {
        status.textContent = "Ready to launch — check the note below.";
      });
      expect(await waitForCampaignDraft(page)).toEqual({
        readinessText: "Ready to launch — check the note below.",
      });
      expect(await observeCampaignDraftStable(page)).toEqual({ visible: true });
      expect(await observeCampaignTypeLabel(page)).toEqual({ visible: true });
      expect(await observeCampaignCopyActions(page)).toEqual({
        editCopyVisible: true,
        regenerateCopyVisible: true,
      });
      expect(await expandCampaignCopyEditor(page)).toEqual({ expanded: true });
      expect(await observeCampaignLaunchButton(page)).toEqual({ enabled: true });
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("opens review and encoded draft routes through visible navigation", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: "http://campaign.test" });
      const page = await context.newPage();
      await page.route("http://campaign.test/campaigns", (route) => route.fulfill({
        contentType: "text/html",
        body: '<a href="/campaigns/new">Continue to launch</a>',
      }));
      await page.route("http://campaign.test/campaigns/new**", (route) => route.fulfill({
        contentType: "text/html",
        body: "<p>Import a creative and the readiness checks run automatically.</p>",
      }));

      expect((await openCampaignOnboardingDraft(page)).url).toBe("http://campaign.test/campaigns/new");
      expect((await openCampaignDraft(page, "draft+1?next")).url)
        .toBe("http://campaign.test/campaigns/new?draft=draft%2B1%3Fnext");
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("observes the reserved amount and a visible pending-review badge", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: "http://campaign.test" });
      const page = await context.newPage();
      await page.setContent(`<section role="region" aria-label="Campaign in review">
        <span>Reserved</span><span>$50</span>
      </section>`);
      expect(await observeCampaignLaunchConfirmation(page, 50)).toEqual({
        confirmationVisible: true,
        reservedAmountVisible: true,
      });
      await page.route("http://campaign.test/campaigns", (route) => route.fulfill({
        contentType: "text/html",
        body: `<span data-slot="status-badge" hidden>Pending</span>
          <span data-slot="status-badge">In review</span>`,
      }));
      expect((await openCampaignList(page)).url).toBe("http://campaign.test/campaigns");
      expect(await observeCampaignPendingReview(page)).toEqual({ visible: true });
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("sets an inclusive delivery end date across the month boundary", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<button aria-label="Start date: Sep 30, 2026">Start date</button>
        <button id="end" aria-label="End date: Oct 1, 2026">End date</button>
        <div role="grid" aria-label="September 2026" style="width: 100px; height: 100px" hidden>
          <button id="day" data-calendar-date="2026-10-09" hidden>9</button>
        </div>
        <button id="next">Next month</button>
        <script>
          const grid = document.querySelector('[role=grid]');
          document.querySelector('#end').onclick = () => grid.hidden = false;
          document.querySelector('#next').onclick = () => {
            grid.setAttribute('aria-label', 'October 2026');
            document.querySelector('#day').hidden = false;
          };
          document.querySelector('#day').onkeydown = event => {
            if (event.key !== 'Enter') return;
            document.querySelector('#end').setAttribute('aria-label', 'End date: Oct 9, 2026');
            grid.hidden = true;
          };
        </script>`);

      expect(await setCampaignDeliveryDays(page, 10)).toEqual({
        startDateButtonName: "Start date: Sep 30, 2026",
        endDateButtonName: "End date: Oct 9, 2026",
      });
      await page.getByRole("button", { name: "Start date: Sep 30, 2026" })
        .evaluate((button) => button.setAttribute("aria-label", "Start date: tomorrow"));
      await expect(setCampaignDeliveryDays(page, 10)).rejects.toThrow(/start date button name/i);
    } finally {
      await browser.close();
    }
  }, 20_000);
});
