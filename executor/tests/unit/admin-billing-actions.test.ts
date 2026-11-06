import { chromium, type Page } from "@playwright/test";
import { expect, it } from "vitest";

import { reverseAdminTopUp } from "../../src/actions/admin-billing-actions";

const ORG = "cc5f783f-6426-4fb8-b576-ae710eeb80e7";

function ledgerPage(rows: Array<{ type: string; source: string; status: string; reversible: boolean }>) {
  const body = rows.map((row) => `<tr><td>Oct 13</td><td>${row.type}</td><td>${row.source}</td>
    <td>+$1.00</td><td>$1.00</td><td>${row.status}</td>
    <td>${row.reversible ? "<button>Reverse</button>" : ""}</td></tr>`).join("");
  return `<h1>QA Org</h1><div role="tablist"><button role="tab">Transactions</button></div>
    <table><tbody>${body}</tbody></table>
    <script>document.querySelectorAll('td button').forEach((b) => b.onclick = () => { window.__clicked = true; });</script>`;
}

async function withLedger(html: string, run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ baseURL: "http://test.local" })).newPage();
    process.env.E2E_BASE_URL = "http://test.local";
    await page.route(`http://test.local/organizations/${ORG}`, (route) =>
      route.fulfill({ contentType: "text/html", body: html }));
    await run(page);
  } finally {
    await browser.close();
  }
}

it("refuses to reverse an older credit when the newest entry is not reversible", async () => {
  // The newest row is the already-reversed test credit; an older admin credit is
  // still eligible. Picking "first eligible" here would spend preloaded funding.
  await withLedger(ledgerPage([
    { type: "Reversal", source: "Admin", status: "Completed", reversible: false },
    { type: "Top-up", source: "Admin", status: "Reversed", reversible: false },
    { type: "Top-up", source: "Admin", status: "Completed", reversible: true },
  ]), async (page) => {
    await expect(reverseAdminTopUp(page, ORG, "QA guard check")).rejects.toThrow("newest ledger entry");
    expect(await page.evaluate(() => (window as { __clicked?: boolean }).__clicked ?? false)).toBe(false);
  });
}, 20_000);

it("reads every ledger row, including the reversal control, in one pass", async () => {
  await withLedger(ledgerPage([
    { type: "Top-up", source: "Admin", status: "Completed", reversible: true },
    { type: "Top-up", source: "User", status: "Completed", reversible: false },
  ]), async (page) => {
    const { openOrganizationTransactions } = await import("../../src/actions/admin-billing-actions");
    const fact = await openOrganizationTransactions(page, ORG);
    expect(fact.rows.map((row) => [row.source, row.canReverse])).toEqual([["Admin", true], ["User", false]]);
  });
}, 20_000);
