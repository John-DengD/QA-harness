import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  confirmStudioProductBrief,
  readStudioProductBrief,
  reopenStudioProductBrief,
  setStudioProductBrief,
} from "../../src/actions/studio-actions";

it("reads, edits, confirms and reopens product text without generating a set", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section data-slot="brief-box" data-state="open">
        <label for="campaign-context-keyMessage">Key message</label>
        <textarea id="campaign-context-keyMessage" aria-label="Key message">Product details</textarea>
        <p role="alert" hidden></p>
        <button aria-label="Confirm">Confirm</button>
      </section>
      <script>
        const box = document.querySelector('[data-slot="brief-box"]');
        const text = box.querySelector('textarea');
        const button = box.querySelector('button');
        const warning = box.querySelector('[role="alert"]');
        const update = () => {
          const excess = Math.max(0, text.value.length - 2000);
          button.disabled = text.value.trim().length === 0 || excess > 0;
          warning.hidden = excess === 0;
          warning.textContent = excess ? 'Character limit exceeded. Remove ' + excess + ' characters to continue.' : '';
        };
        text.oninput = update;
        text.onclick = () => {
          if (box.dataset.state === 'locked') {
            box.dataset.state = 'open';
            text.readOnly = false;
            button.hidden = false;
          }
        };
        button.onclick = () => {
          box.dataset.state = 'locked';
          text.readOnly = true;
          button.hidden = true;
        };
        update();
      </script>
    `);

    expect(await readStudioProductBrief(page)).toMatchObject({
      text: "Product details", locked: false, confirmEnabled: true,
    });
    expect(await setStudioProductBrief(page, "")).toMatchObject({
      text: "", locked: false, confirmEnabled: false,
    });
    expect(await setStudioProductBrief(page, "A".repeat(2001))).toMatchObject({
      confirmEnabled: false,
      limitWarning: "Character limit exceeded. Remove 1 characters to continue.",
    });
    expect(await setStudioProductBrief(page, "Product details")).toMatchObject({
      text: "Product details", confirmEnabled: true, limitWarning: null,
    });
    expect(await confirmStudioProductBrief(page)).toMatchObject({
      locked: true, confirmVisible: false,
    });
    expect(await reopenStudioProductBrief(page)).toMatchObject({
      text: "Product details", locked: false, confirmVisible: true,
    });
  } finally {
    await browser.close();
  }
}, 40_000);
