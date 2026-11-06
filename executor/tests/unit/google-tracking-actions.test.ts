import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { readGoogleTrackingReadiness } from "../../src/actions/google-tracking-actions";

it.each([
  {
    state: "missing", badge: "Required to launch", loop: "not set up",
    body: "Nothing on private.example reports purchases yet.", detail: "required",
    expected: { setupLinkVisible: true, trafficSwitchVisible: true, checkingFirstVisitVisible: false },
  },
  {
    state: "waiting", badge: "Waiting for first visit", loop: "waiting",
    body: "Your tracker is installed on private.example but hasn't reported a visit yet.", detail: "required",
    expected: { setupLinkVisible: false, trafficSwitchVisible: true, checkingFirstVisitVisible: true },
  },
  {
    state: "live", badge: "tracker live on private.example", loop: "live",
    body: "Your tracker is receiving visits.", detail: null,
    expected: { setupLinkVisible: false, trafficSwitchVisible: false, checkingFirstVisitVisible: false },
  },
])("reads a $state tracking card as facts without exposing its domain", async (fixture) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const railRow = fixture.detail ? `<button data-readiness-fix>Conversion tracking
      <span class="sr-only">${fixture.detail}<span>Install the tracker, or switch this campaign to Traffic.</span></span>
    </button>` : "";
    await page.setContent(`<section id="launch-tracking">
      <p>Conversion tracking <span>${fixture.badge}</span></p><p>${fixture.body}</p>
      <ol aria-label="How Google learns from this campaign"><li>Someone clicks your ad</li>
        <li>They buy on your site</li><li>Your site tells Google<span>${fixture.loop}</span></li></ol>
      ${fixture.state === "missing" ? '<a href="/tracking/setup?org=private-org">Set Up Tracking</a>' : ""}
      ${fixture.state === "waiting" ? '<span aria-live="polite">Checking for the first visit…</span>' : ""}
      ${fixture.state !== "live" ? "<button>Switch to Traffic</button>" : ""}
    </section><aside data-slot="launch-readiness"><div data-slot="readiness-results">${railRow}</div></aside>`);

    const fact = await readGoogleTrackingReadiness(page);
    expect(fact).toMatchObject({
      cardState: fixture.state,
      conversionLoopLastStep: fixture.loop,
      switchBackTo: null,
      readiness: {
        present: true, resultsLoaded: true, stale: false, loading: false, error: false,
        conversionTrackingRow: fixture.detail ?? "absent",
      },
      ...fixture.expected,
    });
    expect(Number.isNaN(Date.parse(fact.capturedAt))).toBe(false);
    expect(JSON.stringify(fact)).not.toMatch(/private\.example|private-org/);
  } finally {
    await browser.close();
  }
}, 20_000);

it("distinguishes Traffic, stale rail, and a card missing while readiness loads", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section id="launch-tracking">
      <p>Running as Traffic</p><button>Switch Back to Sales</button>
    </section><aside data-slot="launch-readiness"><div data-slot="readiness-results" data-stale="true">
      <button data-readiness-fix>Conversion tracking <span class="sr-only">unconfirmed</span></button>
    </div></aside>`);

    expect(await readGoogleTrackingReadiness(page)).toMatchObject({
      cardState: "traffic", conversionLoopLastStep: null, switchBackTo: "Sales",
      readiness: { stale: true, conversionTrackingRow: "unconfirmed" },
    });
    await page.setContent(`<aside data-slot="launch-readiness">
      <div data-slot="readiness-error">Could not refresh</div>
      <div data-slot="readiness-loading"></div>
    </aside>`);
    expect(await readGoogleTrackingReadiness(page)).toMatchObject({
      cardState: "absent", switchBackTo: null,
      readiness: {
        present: true, resultsLoaded: false, stale: null, loading: true, error: true,
        conversionTrackingRow: "absent",
      },
    });
  } finally {
    await browser.close();
  }
}, 20_000);

it.each([
  { badge: "Not set up", button: "Draft as Traffic", label: "Draft as Traffic" },
  { badge: "Not set up", button: "Switch to Traffic", label: "Switch to Traffic" },
  { badge: "Required to launch", button: "Switch to Traffic", label: "Switch to Traffic" },
])("reads a missing card with chip '$badge' and button '$button' as missing", async ({ badge, button, label }) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section id="launch-tracking">
      <p>Conversion tracking <span data-slot="chip">${badge}</span></p>
      <ol aria-label="How Google learns from this campaign"><li>Someone clicks your ad</li>
        <li>They buy on your site</li><li>Your site tells Google<span>not set up</span></li></ol>
      <a href="/tracking/setup?org=private-org">Set Up Tracking</a><button>${button}</button>
    </section>`);
    expect(await readGoogleTrackingReadiness(page)).toMatchObject({
      cardState: "missing", trafficSwitchVisible: true, trafficSwitchLabel: label,
    });
  } finally {
    await browser.close();
  }
}, 20_000);

it("reports no switch button on a card without one", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section id="launch-tracking"><p>Conversion tracking <span>tracker live on private.example</span></p></section>`);
    expect(await readGoogleTrackingReadiness(page)).toMatchObject({
      cardState: "live", trafficSwitchVisible: false, trafficSwitchLabel: null,
    });
  } finally {
    await browser.close();
  }
}, 20_000);
