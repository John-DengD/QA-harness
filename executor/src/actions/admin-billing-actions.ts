import { expect, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

export interface AdminLedgerRow {
  date: string;
  type: string;
  source: string;
  amount: string;
  balanceAfter: string;
  status: string;
  canReverse: boolean;
}

export interface AdminOrganizationLedgerFact {
  organization: string;
  balance: string;
  rows: AdminLedgerRow[];
  pageUrl: string;
  capturedAt: string;
}

export interface AdminTopUpFact extends AdminOrganizationLedgerFact {
  requestedAmount: string;
}

export interface AdminReversalFact extends AdminOrganizationLedgerFact {
  reversedAmount: string;
  reason: string;
}

export interface AdminAuditEntry {
  when: string;
  who: string;
  event: string;
  /**
   * Second line of the EVENT cell, where the console names the organization an
   * entry belongs to. Null when the entry carries no subject — which is itself
   * the observation behind bug-01, so this must not be collapsed into `event`.
   */
  subject: string | null;
  detail: string;
}

export interface AdminAuditLogFact {
  entries: AdminAuditEntry[];
  pageUrl: string;
  capturedAt: string;
}

const LEDGER_TAB = "Transactions";

/**
 * The ledger has no test ids, so rows are read positionally from the table.
 * Columns are DATE / TYPE / SOURCE / AMOUNT / BALANCE / STATUS, and the
 * reversal control lives in a trailing cell that only renders for eligible
 * rows — its presence is the observable form of "this row can be reversed",
 * which is what WALLET-010 asserts.
 */
async function readLedger(page: Page): Promise<AdminOrganizationLedgerFact> {
  const table = page.locator("table").first();
  await expect(table).toBeVisible({ timeout: 30_000 });
  // One DOM read for the whole table. Per-row locator calls cost ~0.5s each,
  // which made a 238-row ledger take over two minutes to read on staging.
  const raw = await table.locator("tbody tr").evaluateAll((elements) =>
    elements.map((element) => ({
      cells: Array.from(element.querySelectorAll("td")).map(
        (cell) => (cell as HTMLElement).innerText
      ),
      canReverse: Array.from(element.querySelectorAll("button")).some(
        (button) =>
          (button.textContent ?? "").trim() === "Reverse" &&
          (button as HTMLElement).offsetParent !== null
      ),
    }))
  );
  const rows: AdminLedgerRow[] = raw
    .filter((row) => row.cells.length >= 6)
    .map((row) => ({
      date: row.cells[0]!.trim(),
      type: row.cells[1]!.trim(),
      source: row.cells[2]!.trim(),
      amount: row.cells[3]!.trim(),
      balanceAfter: row.cells[4]!.trim(),
      status: row.cells[5]!.trim(),
      canReverse: row.canReverse,
    }));
  const heading = page.getByRole("heading", { level: 1 }).first();
  return {
    organization: (await heading.innerText().catch(() => "")).trim(),
    balance: (await page.getByText(/^\$[\d,]+\.\d{2}$/).first().innerText().catch(() => "")).trim(),
    rows,
    pageUrl: page.url(),
    capturedAt: new Date().toISOString(),
  };
}

/** Read-only. Opens an organization's ledger and returns every row. */
export async function openOrganizationTransactions(
  page: Page,
  organizationId: string
): Promise<AdminOrganizationLedgerFact> {
  await goToAppPath(page, `/organizations/${organizationId}`);
  await page.getByRole("tab", { name: LEDGER_TAB }).or(
    page.getByText(LEDGER_TAB, { exact: true })
  ).first().click();
  return readLedger(page);
}

/**
 * Credits an organization's wallet directly. This is the controllable way to
 * create observable money for a test — Stripe Checkout cannot be driven in
 * this environment. Financial side effect: reversible through
 * reverseAdminTopUp, which leaves both rows in the ledger by design.
 */
export async function adminTopUpOrganization(
  page: Page,
  organizationId: string,
  amount: string
): Promise<AdminTopUpFact> {
  await goToAppPath(page, `/organizations/${organizationId}`);
  await page.getByRole("button", { name: "Top Up", exact: true }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Top Up Balance" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // The amount field is type="number", so its role is spinbutton, not textbox.
  // Both dialogs are addressed by the ids the product sets, which survive
  // copy changes; the submit label does not, because it carries the amount.
  await dialog.locator("#custom-amount").fill(amount);
  await dialog.getByRole("button", { name: /^Top Up \$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByRole("tab", { name: LEDGER_TAB }).or(
    page.getByText(LEDGER_TAB, { exact: true })
  ).first().click();
  const ledger = await readLedger(page);
  return { ...ledger, requestedAmount: amount };
}

/**
 * Reverses the admin credit that is the newest ledger entry.
 *
 * Only the newest row is a valid target. Fixed QA organizations carry
 * preloaded balance that may itself be an older admin credit; "first eligible
 * row" would silently reverse that funding whenever the credit this test just
 * made is missing, already reversed, or followed by another entry. Throws
 * instead of clicking anything when the newest row is not reversible.
 */
export async function reverseAdminTopUp(
  page: Page,
  organizationId: string,
  reason: string
): Promise<AdminReversalFact> {
  const before = await openOrganizationTransactions(page, organizationId);
  const target = before.rows[0];
  if (!target?.canReverse) {
    throw new Error(
      "The newest ledger entry is not a reversible admin top-up; refusing to reverse an older credit"
    );
  }
  // Click inside the newest row only, the same row the guard above checked.
  await page
    .locator("table")
    .first()
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "Reverse", exact: true })
    .click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Reverse admin top-up" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator("#reversal-reason").fill(reason);
  await dialog.getByRole("button", { name: /^Reverse \$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const after = await readLedger(page);
  return { ...after, reversedAmount: target.amount, reason };
}

/** Read-only. Returns the newest audit entries, newest first. */
export async function readAuditLogEntries(
  page: Page,
  limit = 10
): Promise<AdminAuditLogFact> {
  await goToAppPath(page, "/audit");
  const table = page.locator("table").first();
  await expect(table).toBeVisible({ timeout: 30_000 });
  const entries: AdminAuditEntry[] = [];
  for (const row of (await table.locator("tbody tr").all()).slice(0, limit)) {
    const cells = await row.locator("td").allInnerTexts();
    if (cells.length < 4) continue;
    const eventLines = cells[2]!.split("\n").map((line) => line.trim()).filter(Boolean);
    entries.push({
      when: cells[0]!.trim(),
      who: cells[1]!.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "",
      event: eventLines[0] ?? "",
      subject: eventLines[1] ?? null,
      detail: cells[3]!.trim(),
    });
  }
  return { entries, pageUrl: page.url(), capturedAt: new Date().toISOString() };
}
