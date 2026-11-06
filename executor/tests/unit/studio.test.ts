import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  observeStudioGenerateGate,
  observeStudioLibraryControls,
  openStudioCreateSheet,
  openStudioLibrary,
} from "../../src/actions/studio-actions";

// Pre-#1168 composer (Continue To Style, "Generate Set"). The Ads composer after
// #1168 — Confirm, the references row, Shuffle and Upload — is covered in
// studio-ads-library.test.ts. The Problem / fix angle step and its Action are
// gone from the product and from the library.
describe("Studio single-intent actions (pre-#1168 composer)", () => {
  it("opens the library and reads the Generate gate", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: "http://test.local" });
      const page = await context.newPage();
      await page.route("http://test.local/studio", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<h1>Studio</h1><button id="create">New Creative Set</button>
            <section id="sheet" hidden>
              <h2>New Creative Set</h2>
              <div id="brief"><button id="continue">Continue To Style</button></div>
              <div id="style" hidden>
                <button>Back to Brief</button><button disabled>Generate Set</button>
              </div>
            </section>
            <script>
              document.querySelector('#create').onclick = () =>
                document.querySelector('#sheet').hidden = false;
              document.querySelector('#continue').onclick = () => {
                document.querySelector('#brief').hidden = true;
                document.querySelector('#style').hidden = false;
              };
            </script>`,
        })
      );

      expect(await openStudioLibrary(page)).toEqual({
        createEntryVisible: true,
        url: "http://test.local/studio",
      });
      expect(await observeStudioLibraryControls(page)).toEqual({
        headingVisible: true,
        searchVisible: false,
        stateFilterVisible: false,
      });
      // No brief Confirm in this markup: the context step reads as absent.
      expect(await openStudioCreateSheet(page)).toEqual({
        continueToStyleEnabled: false,
        continueToStyleVisible: false,
        title: "New Creative Set",
      });
      await page.getByRole("button", { name: "Continue To Style" }).click();
      expect(await observeStudioGenerateGate(page)).toEqual({ enabled: false });
    } finally {
      await browser.close();
    }
  }, 45_000);
});
