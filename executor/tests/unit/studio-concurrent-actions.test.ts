import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  beginStudioSetGeneration,
  observeStudioLibraryRuns,
  openStudioCreateSheet,
  openStudioLibrary,
  returnToStudioLibrary,
} from "../../src/actions/studio-actions";

const firstSetId = "11111111-2222-4333-8444-555555555555";

it("starts one set once, returns to Ad Library and counts generating cards", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/studio", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>Ad Library</h1>
          <button id="create">Create Ads</button>
          <section id="composer" hidden>
            <h2>Create Ads</h2>
            <button id="generate">Generate 1 Set</button>
            <button id="back">Ad Library</button>
          </section>
          <div data-slot="studio-set-grid">
            <article><div role="group" aria-label="Creative generating">Generating</div></article>
            <article><div role="group" aria-label="Creative complete">Complete</div></article>
          </div>
          <script>
            window.generateClicks = 0;
            document.querySelector('#create').onclick = () =>
              document.querySelector('#composer').hidden = false;
            document.querySelector('#back').onclick = () =>
              document.querySelector('#composer').hidden = true;
            document.querySelector('#generate').onclick = () => {
              window.generateClicks += 1;
              localStorage.setItem('unrelated', 'not-json');
              localStorage.setItem('studioDraft', JSON.stringify({
                submission: { items: [
                  { id: '${firstSetId}' }, { id: '${firstSetId}' }, { id: 'not-a-uuid' },
                ] },
              }));
            };
          </script>`,
      })
    );

    await openStudioLibrary(page);
    expect(await observeStudioLibraryRuns(page)).toEqual({
      cardCount: 2,
      generatingCardCount: 1,
    });
    await openStudioCreateSheet(page);
    expect(await beginStudioSetGeneration(page)).toEqual({
      started: true,
      setIds: [firstSetId],
    });
    expect(await page.evaluate(() => (window as unknown as { generateClicks: number }).generateClicks)).toBe(1);
    expect(await returnToStudioLibrary(page)).toEqual({ url: "http://test.local/studio" });
    expect(await page.locator("#composer").isVisible()).toBe(false);

    await page.getByRole("group", { name: "Creative generating" })
      .evaluate((group) => group.setAttribute("aria-label", "Creative complete"));
    expect(await observeStudioLibraryRuns(page)).toEqual({
      cardCount: 2,
      generatingCardCount: 0,
    });
  } finally {
    await browser.close();
  }
}, 30_000);
