import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  chooseOnboardingDailyBudget,
  chooseOnboardingObjective,
  chooseOnboardingRegion,
  observeSelectedOnboardingAdStyles,
  openForcedOnboarding,
  resetOnboardingDraft,
  selectNextOnboardingAdStyle,
  submitBrandResearch,
  submitOnboardingCreativeGeneration,
  submitOnboardingQuestions,
  waitForOnboardingBrandReview,
} from "../../src/actions/onboarding-actions";

it("captures the brand research response after one UI submission", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let submissions = 0;
    await page.route("http://test.local/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>Who are we growing?</h1><input id="identify-entry">
          <button id="research">Research</button>
          <script>document.querySelector('#research').onclick = () =>
            fetch('/api/v1/onboarding/research', { method: 'POST' });</script>`,
      })
    );
    await page.route("http://test.local/api/v1/onboarding/research", (route) => {
      submissions++;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ runId: "run-1" }),
      });
    });
    await page.goto("/");

    expect(await submitBrandResearch(page, "example.invalid")).toEqual({
      domain: "example.invalid",
      responseStatus: 200,
      runId: "run-1",
    });
    expect(await page.locator("#identify-entry").inputValue()).toBe("example.invalid");
    expect(submissions).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);

it("opening onboarding observes an existing draft without silently resetting it", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/onboarding?force=true", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<button id="reset">Start Over</button><button id="confirm" hidden>Start Over</button>
          <h1 id="entry" hidden>Who are we growing?</h1>
          <script>
            window.resets = 0;
            document.querySelector('#reset').onclick = () =>
              document.querySelector('#confirm').hidden = false;
            document.querySelector('#confirm').onclick = () => {
              window.resets++;
              document.querySelector('#reset').hidden = true;
              document.querySelector('#confirm').hidden = true;
              document.querySelector('#entry').hidden = false;
            };
          </script>`,
      })
    );
    expect(await openForcedOnboarding(page)).toMatchObject({ resumable: true });
    expect(await page.evaluate(() => (window as unknown as Window & { resets: number }).resets)).toBe(0);
    await resetOnboardingDraft(page);
    expect(await page.evaluate(() => (window as unknown as Window & { resets: number }).resets)).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);

it("reports stalled research without restarting it or submitting another request", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>We couldn't finish reading your site</h1>
          <button>Start Over</button><button disabled>Looks Right</button>
          <script>window.restarts = 0;
            document.querySelector('button').onclick = () => window.restarts++;</script>`,
      })
    );
    await page.goto("/");

    expect(await waitForOnboardingBrandReview(page)).toEqual({ state: "stalled" });
    expect(await page.evaluate(() => (window as unknown as Window & { restarts: number }).restarts))
      .toBe(0);
  } finally {
    await browser.close();
  }
}, 20_000);

it("selects brief inputs separately and submits generation only once", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<section id="brief"><h1>A few things about your ads</h1>
          <label><input type="radio" name="region">US</label>
          <label><input type="radio" name="objective">Signups</label>
          <label><input type="radio" name="budget">$20 / day</label>
          <button id="build">Build My Campaign</button></section>
          <section id="styles" hidden><h1>Pick the ad styles you like</h1>
          <button aria-pressed="false"><img alt="Alpha ad"></button>
          <button aria-pressed="false"><img alt="Beta ad"></button>
          <button aria-pressed="false"><img alt="Gamma ad"></button>
          <button id="generate">Generate My Ads</button></section>
          <script>
            window.submits = 0;
            document.querySelector('#build').onclick = () => {
              document.querySelector('#brief').hidden = true;
              document.querySelector('#styles').hidden = false;
            };
            document.querySelectorAll('#styles button[aria-pressed]').forEach(button => {
              button.onclick = () => button.setAttribute('aria-pressed', 'true');
            });
            document.querySelector('#generate').onclick = (event) => {
              window.submits++;
              event.target.textContent = 'Starting...';
            };
          </script>`,
      })
    );
    await page.goto("/");

    expect(await chooseOnboardingRegion(page, "US")).toEqual({ label: "US", selected: true });
    expect(await chooseOnboardingObjective(page, "Signups")).toEqual({ label: "Signups", selected: true });
    expect(await chooseOnboardingDailyBudget(page, "$20 / day")).toEqual({ label: "$20 / day", selected: true });
    await submitOnboardingQuestions(page);
    expect(await observeSelectedOnboardingAdStyles(page)).toEqual({ selectedCount: 0 });
    for (let selectedCount = 1; selectedCount <= 3; selectedCount++) {
      expect(await selectNextOnboardingAdStyle(page)).toEqual({ selectedCount });
    }
    expect(await submitOnboardingCreativeGeneration(page)).toEqual({ accepted: true });
    expect(await page.evaluate(() => (window as unknown as Window & { submits: number }).submits)).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);
