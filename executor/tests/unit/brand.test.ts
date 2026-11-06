import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  clearMetaBrandApp,
  inspectMetaBrandProfile,
  restoreMetaBrandProfile,
} from "../../src/actions/meta-byo-actions";

it("reads automatic Meta asset selections as reusable facts", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section aria-label="Meta Campaign Assets">
      <label for="app">App To Advertise</label>
      <select id="app"><option value="app-1" selected>Interview App</option></select>
      <label for="store">Store Listing</label>
      <select id="store"><option value="https://apps.example/app" selected>iOS</option></select>
      <label for="pixel">Website Purchase Pixel</label>
      <select id="pixel"><option value="" selected>Automatic: Purchase Pixel</option></select>
    </section>`);

    await expect(inspectMetaBrandProfile(page)).resolves.toEqual({
      appStoreUrl: "https://apps.example/app",
      metaApplicationId: "app-1",
      metaPixelId: "automatic",
    });
  } finally {
    await browser.close();
  }
});

it("saves each Meta App selection once and returns its observed form state", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<label for="app">App To Advertise</label>
      <select id="app"><option value="">None</option><option value="app-1" selected>Interview App</option></select>
      <label for="store">Store Listing</label>
      <select id="store"><option value="https://apps.example/app" selected>iOS</option></select>
      <label for="pixel">Website Purchase Pixel</label>
      <select id="pixel"><option value="" selected>Automatic: Purchase Pixel</option></select>
      <button id="save">Save Meta Selection</button>
      <p hidden id="notice">Meta selection saved. Readiness is checking the updated setup.</p>
      <script>
        window.saveCount = 0;
        document.querySelector('#save').onclick = () => {
          window.saveCount++;
          document.querySelector('#notice').hidden = false;
        };
      </script>`);
    const original = await inspectMetaBrandProfile(page);
    expect(await clearMetaBrandApp(page)).toEqual({
      metaApplicationId: "",
      saveNoticeVisible: true,
    });
    expect(await restoreMetaBrandProfile(page, original)).toEqual({
      profile: original,
      saveNoticeVisible: true,
    });
    expect(await page.evaluate(() => (window as typeof window & { saveCount: number }).saveCount)).toBe(2);
  } finally {
    await browser.close();
  }
});
