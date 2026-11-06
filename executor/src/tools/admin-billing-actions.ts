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
  const rows: AdminLedgerRow[] = [];
  for (const row of await table.locator("tbody tr").all()) {
    const cells = await row.locator("td").allInnerTexts();
    if (cells.length < 6) continue;
    rows.push({
      date: cells[0]!.trim(),
      type: cells[1]!.trim(),
      source: cells[2]!.trim(),
      amount: cells[3]!.trim(),
      balanceAfter: cells[4]!.trim(),
      status: cells[5]!.trim(),
      canReverse: await row
        .getByRole("button", { name: "Reverse", exact: true })
        .isVisible()
        .catch(() => false),
    });
  }
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
  await dialog.getByRole("textbox").first().fill(amount);
  await dialog.getByRole("button", { name: "Top Up", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByRole("tab", { name: LEDGER_TAB }).or(
    page.getByText(LEDGER_TAB, { exact: true })
  ).first().click();
  const ledger = await readLedger(page);
  return { ...ledger, requestedAmount: amount };
}

/**
 * Reverses the newest reversible admin credit.
 *
 * Deliberately targets the first eligible row rather than taking a row index:
 * the ledger is newest-first and eligibility is what the product controls, so
 * an index would silently drift onto the wrong row when a test adds entries.
 * Throws when nothing is reversible instead of clicking something else.
 */
export async function reverseAdminTopUp(
  page: Page,
  organizationId: string,
  reason: string
): Promise<AdminReversalFact> {
  const before = await openOrganizationTransactions(page, organizationId);
  const target = before.rows.find((row) => row.canReverse);
  if (!target) {
    throw new Error("No reversible admin top-up in this organization's ledger");
  }
  await page
    .locator("table tbody tr")
    .filter({ has: page.getByRole("button", { name: "Reverse", exact: true }) })
    .first()
    .getByRole("button", { name: "Reverse", exact: true })
    .click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Reverse admin top-up" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("textbox").first().fill(reason);
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
    entries.push({
      when: cells[0]!.trim(),
      who: cells[1]!.trim().split("\n")[0]!.trim(),
      event: cells[2]!.trim().split("\n")[0]!.trim(),
      detail: cells[3]!.trim(),
    });
  }
  return { entries, pageUrl: page.url(), capturedAt: new Date().toISOString() };
}
