import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  observeCampaignProtectiveActions,
  openExistingCampaignDetail,
} from "../../src/actions/campaign-actions";
import { openStudioSetReview } from "../../src/actions/studio-actions";

it("opens an existing Campaign by its visible link and waits for the loaded detail body", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://availability.test" });
    const page = await context.newPage();
    await page.route("http://availability.test/campaigns", (route) => route.fulfill({
      contentType: "text/html",
      body: `<a href="/campaigns/campaign-606" hidden>Stale campaign link</a>
        <a href="/campaigns/campaign-606" id="campaign-link">Existing Campaign</a>
        <script>
          document.body.dataset.navigationCount = '0';
          document.querySelector('#campaign-link').onclick = event => {
            event.preventDefault();
            document.body.dataset.navigationCount = String(Number(document.body.dataset.navigationCount) + 1);
            history.pushState({}, '', event.currentTarget.getAttribute('href'));
            const detail = document.createElement('section');
            detail.dataset.slot = 'campaign-detail-body';
            detail.hidden = true;
            detail.innerHTML = '<h1>Existing Campaign</h1><button>Pause</button><button>Cancel</button>';
            document.body.append(detail);
            setTimeout(() => { detail.hidden = false; }, 150);
          };
        </script>`,
    }));
    await page.goto("/campaigns");

    expect(await openExistingCampaignDetail(page, "campaign-606")).toEqual({
      url: "http://availability.test/campaigns/campaign-606",
    });
    expect(await page.locator('[data-slot="campaign-detail-body"]').isVisible()).toBe(true);
    expect(await page.locator("body").getAttribute("data-navigation-count")).toBe("1");
    expect(await observeCampaignProtectiveActions(page)).toEqual({
      pauseVisible: true,
      pauseEnabled: true,
      cancelVisible: true,
      cancelEnabled: true,
    });
  } finally {
    await browser.close();
  }
}, 20_000);

it("reports enabled, disabled, hidden, and absent protective actions without clicking them", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const fixtures = [
      {
        buttons: "<button>Pause campaign</button><button>Cancel campaign</button>",
        fact: { pauseVisible: true, pauseEnabled: true, cancelVisible: true, cancelEnabled: true },
      },
      {
        buttons: "<button disabled>Pause</button><button disabled>Cancel</button>",
        fact: { pauseVisible: true, pauseEnabled: false, cancelVisible: true, cancelEnabled: false },
      },
      {
        buttons: "<button hidden>Pause</button><button>Cancel campaign</button>",
        fact: { pauseVisible: false, pauseEnabled: false, cancelVisible: true, cancelEnabled: true },
      },
      {
        buttons: "<button>Pause campaign</button><button hidden>Cancel</button>",
        fact: { pauseVisible: true, pauseEnabled: true, cancelVisible: false, cancelEnabled: false },
      },
      {
        buttons: "<button>Pause budget</button><button>Cancel selection</button>",
        fact: { pauseVisible: false, pauseEnabled: false, cancelVisible: false, cancelEnabled: false },
      },
    ];
    for (const fixture of fixtures) {
      await page.setContent(`${fixture.buttons}<script>
        document.body.dataset.protectiveActionCount = '0';
        document.querySelectorAll('button').forEach(button => button.onclick = () => {
          document.body.dataset.protectiveActionCount = String(Number(document.body.dataset.protectiveActionCount) + 1);
        });
      </script>`);

      expect(await observeCampaignProtectiveActions(page)).toEqual(fixture.fact);
      expect(await page.locator("body").getAttribute("data-protective-action-count")).toBe("0");
    }
  } finally {
    await browser.close();
  }
}, 20_000);

it("opens a Google Studio set and waits for review images and removal of the old grid", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section data-slot="studio-set-grid">
        <article><button id="meta-set">View Existing Set for Meta</button></article>
        <article style="position:relative;width:320px;height:180px"><button id="google-set" style="position:absolute;inset:0;z-index:0" aria-label="View Existing Set for Google"></button><button id="image-open" style="position:absolute;inset:0;z-index:10" aria-label="View Landscape ad image"></button></article>
      </section>
      <section data-slot="studio-workspace" hidden>
        <section data-slot="studio-review-images" hidden>Existing review images</section>
      </section>
      <script>
        document.body.dataset.reviewOpenCount = '0';
        document.body.dataset.metaOpenCount = '0';
        document.querySelector('#meta-set').onclick = () => {
          document.body.dataset.metaOpenCount = String(Number(document.body.dataset.metaOpenCount) + 1);
        };
        document.querySelector('#google-set').onclick = () => {
          document.body.dataset.reviewOpenCount = String(Number(document.body.dataset.reviewOpenCount) + 1);
          document.querySelector('[data-slot=studio-workspace]').hidden = false;
          setTimeout(() => {
            document.querySelector('[data-slot=studio-review-images]').hidden = false;
          }, 150);
          setTimeout(() => {
            document.querySelector('[data-slot=studio-set-grid]').remove();
          }, 300);
        };
        document.querySelector('#image-open').onclick = () => {
          document.body.dataset.reviewOpenCount = String(Number(document.body.dataset.reviewOpenCount) + 1);
        };
      </script>`);

    expect(await openStudioSetReview(page)).toEqual({ reviewVisible: true });
    expect(await page.locator('[data-slot="studio-review-images"]').isVisible()).toBe(true);
    expect(await page.locator('[data-slot="studio-set-grid"]').count()).toBe(0);
    expect(await page.locator("body").getAttribute("data-review-open-count")).toBe("1");
    expect(await page.locator("body").getAttribute("data-meta-open-count")).toBe("0");
  } finally {
    await browser.close();
  }
}, 20_000);

it("opens a Google video-only card without image overlay buttons", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section data-slot="studio-set-grid">
      <article><button aria-label="View Video ad for Google" onclick="document.querySelector('[data-slot=studio-set-grid]').remove();document.querySelector('[data-slot=studio-workspace]').hidden=false;document.querySelector('[data-slot=studio-review-images]').hidden=false"></button></article>
    </section><section data-slot="studio-workspace" hidden>
      <section data-slot="studio-review-images" hidden>Launch images follow the pick</section>
    </section>`);
    expect(await openStudioSetReview(page)).toEqual({ reviewVisible: true });
  } finally {
    await browser.close();
  }
}, 20_000);
