import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  captureFailureSnapshot,
  classifyActionFailure,
  driftNextStep,
  locatorSearchTexts,
  redactSnapshotText,
} from "../../src/tools/action-failure";

// The exact error the staging run produced for openStudioLibrary (r-20261014-1630).
const studioHeadingMissing = "expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: /^(?:Studio|Ad Library)$/ }).or(getByText('Studio', { exact: true })).first()\nExpected: visible\nTimeout: 45000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"to.be.visible\" with timeout 45000ms\n  - waiting for getByRole('heading', { name: /^(?:Studio|Ad Library)$/ }).or(getByText('Studio', { exact: true })).first()\n";

describe("classifyActionFailure: which failures suggest script drift", () => {
  it("marks an expect(locator) whose element is not found as drift and keeps locator and timeout", () => {
    const result = classifyActionFailure(studioHeadingMissing);
    expect(result).toMatchObject({
      category: "locator_not_found",
      driftSuspected: true,
      timeoutMs: 45_000,
      timeoutKind: "expect",
    });
    expect(result.locator).toBe("getByRole('heading', { name: /^(?:Studio|Ad Library)$/ }).or(getByText('Studio', { exact: true })).first()");
  });

  it("marks a locator action that timed out waiting for its element as drift", () => {
    const result = classifyActionFailure("locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Ad Library', exact: true })\n");
    expect(result).toMatchObject({
      category: "locator_timeout", driftSuspected: true, timeoutMs: 30_000, timeoutKind: "action",
      locator: "getByRole('button', { name: 'Ad Library', exact: true })",
    });
  });

  it("marks a hidden element and an ambiguous locator as drift", () => {
    expect(classifyActionFailure("expect(locator).toBeVisible() failed\n\nLocator: getByRole('dialog')\nExpected: visible\nReceived: hidden\nTimeout: 5000ms\n"))
      .toMatchObject({ category: "locator_timeout", driftSuspected: true, locator: "getByRole('dialog')" });
    expect(classifyActionFailure("locator.click: Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:\n"))
      .toMatchObject({ category: "locator_ambiguous", driftSuspected: true, locator: "getByRole('button', { name: 'Save' })" });
  });

  it("marks waitForURL timeouts (route or redirect changed) as drift", () => {
    expect(classifyActionFailure("page.waitForURL: Timeout 15000ms exceeded.\n=========================== logs ===========================\nwaiting for navigation to \"**/studio\" until \"load\""))
      .toMatchObject({ category: "locator_timeout", driftSuspected: true, timeoutKind: "navigation", timeoutMs: 15_000 });
  });

  // The exact error PR-1327 r-20261015-1415 produced: the PMax card's button was renamed
  // "Draft as Traffic", and the custom expect message pushed expect(locator) off the first line.
  const renamedButton = "The tracking card must offer Switch to Traffic\n\nexpect(locator).toBeEnabled() failed\n\nLocator: locator('#launch-tracking').getByRole('button', { name: 'Switch to Traffic', exact: true }).first()\nExpected: enabled\nTimeout: 30000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"to.be.enabled\" with timeout 30000ms\n  - waiting for locator('#launch-tracking').getByRole('button', { name: 'Switch to Traffic', exact: true }).first()\n";

  it("marks a renamed button whose toBeEnabled wait found no element as drift, even with a custom message", () => {
    expect(classifyActionFailure(renamedButton)).toMatchObject({
      category: "locator_not_found", driftSuspected: true, timeoutMs: 30_000, timeoutKind: "expect",
      locator: "locator('#launch-tracking').getByRole('button', { name: 'Switch to Traffic', exact: true }).first()",
    });
  });

  it("marks any state matcher that only ever waited for its locator (never resolved) as drift", () => {
    const neverResolved = "Custom: tracking chip\n\nexpect(locator).toHaveText(expected) failed\n\nLocator: getByText('Required to launch')\nExpected string: \"Required to launch\"\nTimeout: 5000ms\n\nCall log:\n  - Expect \"toHaveText\" with timeout 5000ms\n  - waiting for getByText('Required to launch')\n";
    expect(classifyActionFailure(neverResolved)).toMatchObject({ category: "locator_not_found", driftSuspected: true,
      locator: "getByText('Required to launch')" });
  });

  it("keeps a disabled but present button as a business assertion, also with a custom message", () => {
    const disabled = "The Generate button must be enabled\n\nexpect(locator).toBeEnabled() failed\n\nLocator: getByRole('button', { name: 'Generate' })\nExpected: enabled\nReceived: disabled\nTimeout: 30000ms\n\nCall log:\n  - Expect \"to.be.enabled\" with timeout 30000ms\n  - waiting for getByRole('button', { name: 'Generate' })\n    34 × locator resolved to <button disabled>Generate</button>\n       - unexpected value \"disabled\"\n";
    expect(classifyActionFailure(disabled)).toMatchObject({ category: "assertion", driftSuspected: false,
      locator: "getByRole('button', { name: 'Generate' })" });
  });

  it("does not mark business assertions on a found element as drift", () => {
    for (const error of [
      "expect(locator).toBeEnabled() failed\n\nLocator: getByRole('button', { name: 'Generate' })\nExpected: enabled\nReceived: disabled\nTimeout: 30000ms\n",
      "expect(locator).toHaveAttribute(expected) failed\n\nLocator: locator('[data-slot=\"brief-box\"]')\nExpected: \"locked\"\nReceived: \"open\"\nTimeout: 5000ms\n",
      "expect(received).toEqual(expected) // deep equality\n\nExpected: 3\nReceived: 2",
      "expect.poll(...).not.toEqual(expected) failed after 10000ms",
    ]) {
      const result = classifyActionFailure(error);
      expect(result.driftSuspected, error).toBe(false);
      expect(result.category, error).toBe("assertion");
    }
  });

  it("does not mark network 5xx, page.goto timeouts, closed browsers or origin escapes as drift", () => {
    expect(classifyActionFailure("Studio request failed with status 503 Service Unavailable"))
      .toMatchObject({ category: "network", driftSuspected: false });
    expect(classifyActionFailure("page.goto: net::ERR_CONNECTION_RESET at https://app-staging.hellyeahai.com/studio"))
      .toMatchObject({ category: "network", driftSuspected: false });
    expect(classifyActionFailure("page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to \"https://app/studio\""))
      .toMatchObject({ category: "navigation_timeout", driftSuspected: false, timeoutMs: 30_000, timeoutKind: "navigation" });
    expect(classifyActionFailure("locator.click: Target page, context or browser has been closed"))
      .toMatchObject({ category: "browser", driftSuspected: false });
    expect(classifyActionFailure("Read-only Action left the expected app origin"))
      .toMatchObject({ category: "origin", driftSuspected: false });
    expect(classifyActionFailure("Something else broke")).toMatchObject({ category: "other", driftSuspected: false });
  });
});

describe("failure evidence is redacted", () => {
  it("drops URL queries, tokens, keys, cookies and emails", () => {
    const text = redactSnapshotText([
      "- link \"Studio\" [url=https://app-staging.hellyeahai.com/sign-in?__clerk_ticket=abc.def#x]",
      `token ${"eyJ"}hbGciOiJub25lIn0.eyJzdWIiOiIxIn0.ZmFrZS1zaWduYXR1cmU here`,
      `key ${"sk_"}test_51abcDEF and ${"e2b_"}0123456789abcdef0123456789`,
      "Cookie: __session=secretvalue; other=1",
      "Authorization: Bearer abc.def.ghi",
      "- text: qa.owner@example.test",
      "password=hunter2",
    ].join("\n"));
    expect(text).toContain("https://app-staging.hellyeahai.com/sign-in");
    expect(text).not.toMatch(/__clerk_ticket|abc\.def|#x/);
    expect(text).not.toMatch(/eyJhbGci|sk_test_51|e2b_0123|secretvalue|hunter2|qa\.owner@/);
    expect(text).toContain("[redacted");
  });

  it("caps the snapshot size", () => {
    expect(redactSnapshotText("x ".repeat(50_000), 1000).length).toBeLessThanOrEqual(1000 + 40);
  });

  it("captures the main region's accessibility snapshot without the URL query", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route("http://test.local/**", (route) => route.fulfill({
        contentType: "text/html",
        body: `<title>Hellyeah</title><nav><a href="/x">Nav only</a></nav>
          <main><h2>Ads</h2><input aria-label="Search ads by name or copy">
          <p>owner qa@example.com</p><button>Create Ads</button></main>`,
      }));
      await page.goto("http://test.local/studio?__clerk_ticket=secret");
      const snapshot = await captureFailureSnapshot(page);
      expect(snapshot.url).toBe("http://test.local/studio");
      expect(snapshot.region).toBe("main");
      expect(snapshot.title).toBe("Hellyeah");
      expect(snapshot.ariaSnapshot).toContain("heading \"Ads\"");
      expect(snapshot.ariaSnapshot).toContain("Search ads by name or copy");
      expect(snapshot.ariaSnapshot).not.toContain("Nav only");
      expect(snapshot.ariaSnapshot).not.toContain("qa@example.com");
      expect(JSON.stringify(snapshot)).not.toContain("secret");
    } finally {
      await browser.close();
    }
  });

  it("falls back to an error note when the page is gone", async () => {
    const snapshot = await captureFailureSnapshot({
      url: () => { throw new Error("closed"); },
      title: async () => { throw new Error("closed"); },
      locator: () => { throw new Error("closed"); },
    } as never);
    expect(snapshot.ariaSnapshot).toBeNull();
    expect(snapshot.captureError).toMatch(/closed/);
  });
});

describe("drift hints", () => {
  it("pulls the visible texts out of a locator for a product source search", () => {
    expect(locatorSearchTexts("getByRole('heading', { name: /^(?:Studio|Ad Library)$/ }).or(getByText('Studio', { exact: true })).first()"))
      .toEqual(["Studio", "Ad Library"]);
    expect(locatorSearchTexts("getByRole('button', { name: 'Ad Library', exact: true })")).toEqual(["Ad Library"]);
    expect(locatorSearchTexts("getByLabel('Search creative sets')")).toEqual(["Search creative sets"]);
    expect(locatorSearchTexts(null)).toEqual([]);
  });

  it("tells the operator to finish the intent with Computer Use as drift and repair at closeout", () => {
    const hint = driftNextStep("openStudioLibrary");
    expect(hint).toContain("Computer Use");
    expect(hint).toContain("--miss-reason drift --miss-action openStudioLibrary");
    expect(hint).toContain("pnpm action:drift list");
  });
});

describe("e2b:action next step after a drift-suspected failure", () => {
  it("adds the drift hint to a failed read and keeps the read-only check first for an unknown outcome", async () => {
    const { sharedActionNextStep } = await import("../../src/tools/shared-action-evidence");
    expect(sharedActionNextStep("failed", "read", null)).toBe("The read-only Action changed nothing; fix the precondition and retry it.");
    const read = sharedActionNextStep("failed", "read", null, "openStudioLibrary")!;
    expect(read).toContain("--miss-reason drift --miss-action openStudioLibrary");
    expect(read).not.toContain("retry it");
    const unknown = sharedActionNextStep("action_unknown", "reversible", "reopenStudioProductBrief", "continueStudioToStyle")!;
    expect(unknown.indexOf("Outcome unknown")).toBe(0);
    expect(unknown).toContain("reopenStudioProductBrief");
    expect(unknown).toContain("pnpm action:drift verify continueStudioToStyle");
    expect(sharedActionNextStep("completed", "read", null, "x")).toBeNull();
  });
});

describe("refineFailureWithSnapshot: a named control absent from the failure page is drift", () => {
  // Modeled on PR-1327 r-20261015-1415 case-3: the PMax card renamed "Switch to Traffic" to
  // "Draft as Traffic". Here the error lost its "element(s) not found" / call-log lines (as a
  // wrapped or truncated error does), so the error text alone reads like a business assertion.
  const truncated = "The tracking card must offer Switch to Traffic\n\nexpect(locator).toBeEnabled() failed\n\nLocator: locator('#launch-tracking').getByRole('button', { name: 'Switch to Traffic', exact: true }).first()\nExpected: enabled\nTimeout: 30000ms\n";
  const renamedSnapshot = "- main:\n  - text: Conversion tracking Not set up\n  - text: Start with Traffic Launch today\n  - button \"Draft as Traffic\"\n  - button \"Start Over\"\n";

  it("upgrades an assertion on a role/text-named locator whose name is absent from the aria snapshot", async () => {
    const { refineFailureWithSnapshot } = await import("../../src/tools/action-failure");
    const base = classifyActionFailure(truncated);
    expect(base.category).toBe("assertion");
    expect(refineFailureWithSnapshot(base, truncated, renamedSnapshot)).toMatchObject({
      category: "locator_not_found", driftSuspected: true, timeoutKind: "expect",
      locator: "locator('#launch-tracking').getByRole('button', { name: 'Switch to Traffic', exact: true }).first()",
    });
  });

  it("keeps a found control in a different state as an assertion", async () => {
    const { refineFailureWithSnapshot } = await import("../../src/tools/action-failure");
    const present = "- main:\n  - button \"Switch to Traffic\" [disabled]\n";
    expect(refineFailureWithSnapshot(classifyActionFailure(truncated), truncated, present))
      .toMatchObject({ category: "assertion", driftSuspected: false });
    const disabled = "expect(locator).toBeEnabled() failed\n\nLocator: getByRole('button', { name: 'Generate' })\nExpected: enabled\nReceived: disabled\nTimeout: 30000ms\n";
    expect(refineFailureWithSnapshot(classifyActionFailure(disabled), disabled, "- main:\n  - text: nothing\n"))
      .toMatchObject({ category: "assertion", driftSuspected: false });
  });

  it("leaves unnamed locators, missing snapshots and non-assertion failures alone", async () => {
    const { refineFailureWithSnapshot } = await import("../../src/tools/action-failure");
    const unnamed = "expect(locator).toHaveAttribute(expected) failed\n\nLocator: locator('[data-slot=\"brief-box\"]')\nExpected: \"locked\"\nTimeout: 5000ms\n";
    expect(refineFailureWithSnapshot(classifyActionFailure(unnamed), unnamed, "- main:\n").category).toBe("assertion");
    expect(refineFailureWithSnapshot(classifyActionFailure(truncated), truncated, null).category).toBe("assertion");
    const network = classifyActionFailure("page.goto: net::ERR_CONNECTION_RESET at https://app");
    expect(refineFailureWithSnapshot(network, "page.goto: net::ERR_CONNECTION_RESET", "- main:\n")).toEqual(network);
  });
});
