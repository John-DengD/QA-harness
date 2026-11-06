import { chromium } from "@playwright/test";
import { expect, it } from "vitest";
import { renameCampaignDraft, submitCampaignGoal, submitCampaignGoalFromChip } from "../../src/actions/campaign-actions";

it("restores a remounted composer and sends exactly once", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="composer"></div><script>
      window.sends = 0;
      let remounted = false;
      function mount() {
        document.querySelector('#composer').innerHTML = '<textarea placeholder="Launch a campaign to drive trial signups…"></textarea><button aria-label="Send" disabled>Send</button>';
        const input = document.querySelector('textarea');
        input.oninput = () => {
          if (!remounted) { remounted = true; mount(); return; }
          document.querySelector('button').disabled = !input.value;
        };
        input.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); window.sends++; input.value = ''; }
        };
      }
      mount();
    </script>`);
    await submitCampaignGoal(page, "Prepare a test campaign, do not launch");
    expect(await page.evaluate("window.sends")).toBe(1);
  } finally {
    await browser.close();
  }
}, 15_000);

// Markup mirrors apps/dashboard launch/screen.tsx (Suggestions chips) and launch/draft.tsx (Details toggle + Name field) on origin/staging.
const chipScreen = `<input placeholder="Launch a campaign to drive trial signups…"/><button aria-label="Send">Send</button>
  <div class="flex flex-wrap"><button type="button" id="c1">Drive more signups</button><button type="button" id="c2">Get more sales</button></div>
  <div id="launch-start-over" hidden><button>Start Over</button></div>
  <script>
    window.picked = [];
    for (const b of document.querySelectorAll('#c1,#c2')) b.onclick = () => {
      window.picked.push(b.textContent);
      document.querySelector('input').hidden = true;
      document.querySelector('#launch-start-over').hidden = false;
    };
  </script>`;

it("submits a quick-goal chip by its exact label and reports the draft started", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(chipScreen);
    const fact = await submitCampaignGoalFromChip(page, "Get more sales");
    expect(fact).toEqual({ chipLabel: "Get more sales", composerVisible: false, startOverVisible: true });
    expect(await page.evaluate("window.picked")).toEqual(["Get more sales"]);
    await expect(submitCampaignGoalFromChip(page, "No such chip")).rejects.toThrow();
  } finally {
    await browser.close();
  }
}, 60_000);

const detailsDraft = (open: boolean) => `<div><button aria-expanded="${open}" id="toggle"><span>Details</span><span>Recommended by your agent</span></button>
  <div id="panel" ${open ? "" : "inert"}><input aria-label="Campaign name" value="Old name" /></div></div>
  <script>
    const t = document.querySelector('#toggle'), panel = document.querySelector('#panel');
    t.onclick = () => { const o = t.getAttribute('aria-expanded') !== 'true'; t.setAttribute('aria-expanded', String(o)); panel.toggleAttribute('inert', !o); };
    window.blurs = 0; document.querySelector('input').onblur = () => window.blurs++;
  </script>`;

it("renames the draft through Details, opening it when collapsed, and can rename back", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(detailsDraft(false));
    const renamed = await renameCampaignDraft(page, "QA run Search Traffic");
    expect(renamed).toEqual({ previousName: "Old name", name: "QA run Search Traffic", detailsWasOpen: false });
    expect(await page.evaluate("window.blurs")).toBe(1);
    const back = await renameCampaignDraft(page, renamed.previousName);
    expect(back).toEqual({ previousName: "QA run Search Traffic", name: "Old name", detailsWasOpen: true });
    await page.setContent(detailsDraft(true));
    expect((await renameCampaignDraft(page, "Another")).detailsWasOpen).toBe(true);
  } finally {
    await browser.close();
  }
}, 60_000);
