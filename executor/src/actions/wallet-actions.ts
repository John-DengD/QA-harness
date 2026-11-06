import { expect, type Locator, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

export interface CardPaymentDetails {
  email: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvc: string;
  billingName?: string;
  billingPostalCode?: string;
}

export interface WalletDisplayFact {
  summaryText: string;
  transactionRows: string[];
}

export interface WalletActionFact {
  pageUrl: string;
  capturedAt: string;
}

const actionFact = (page: Page): WalletActionFact => ({
  pageUrl: page.url(),
  capturedAt: new Date().toISOString(),
});

const findInFrames = async (
  page: Page,
  selectors: string[],
  timeout = 45_000
): Promise<Locator> => {
  let match: Locator | null = null;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector).first();
        if (await locator.isVisible().catch(() => false)) {
          match = locator;
          return true;
        }
      }
    }
    return false;
  }, { timeout }).toBe(true);
  if (!match) throw new Error("Stripe payment field was not found");
  return match;
};

export const selectCardPaymentMethodIfPresent = async (page: Page): Promise<boolean> => {
  const card = page.getByRole("radio", { exact: true, name: "Card" });
  const visible = await card
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;
  if (!(await card.isChecked().catch(() => false))) {
    await card.click({ force: true });
  }
  return card.isChecked();
};

export const discloseAgentCheckoutIfPresent = async (page: Page): Promise<boolean> => {
  const disclosure = page.getByRole("checkbox", {
    name: /i am an ai agent acting on behalf of someone else/i,
  });
  const visible = await disclosure
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;
  if (!(await disclosure.isChecked())) {
    await disclosure.dispatchEvent("click");
    await expect.poll(() => disclosure.isChecked()).toBe(true);
  }
  return disclosure.isChecked();
};

const prepareCardCheckout = async (page: Page, checkoutEmail: string): Promise<void> => {
  const withoutLink = page.getByRole("button", { name: /pay without link/i });
  if (await withoutLink
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false)) {
    await withoutLink.click();
  }
  await discloseAgentCheckoutIfPresent(page);

  const email = await findInFrames(
    page,
    ['input[type="email"]', 'input[autocomplete="email"]'],
    5_000
  ).catch(() => null);
  if (email) await email.fill(checkoutEmail);

  const saveForLater = page.getByRole("checkbox", {
    name: /save my information for faster checkout/i,
  });
  const linkOptionVisible = await saveForLater
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (linkOptionVisible && (await saveForLater.isChecked())) {
    await saveForLater.uncheck({ force: true });
  }
  await selectCardPaymentMethodIfPresent(page);
};

const paymentButton = (page: Page): Locator =>
  page.getByRole("button", { name: /pay|submit/i }).last();

export async function openWalletTopUp(
  page: Page
): Promise<WalletActionFact & { amountEntryVisible: boolean }> {
  await goToAppPath(page, "/wallet");
  await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();
  await page.getByRole("button", { name: "Top Up", exact: true }).click();
  const amountEntry = page.getByLabel("Amount (USD)");
  await expect(amountEntry).toBeVisible();
  return { ...actionFact(page), amountEntryVisible: await amountEntry.isVisible() };
}

// Creates a checkout session. If navigation times out, inspect the current page before retrying.
export async function startWalletCheckout(
  page: Page,
  amountDollars: number
): Promise<WalletActionFact & { checkoutUrl: string }> {
  await page.getByLabel("Amount (USD)").fill(String(amountDollars));
  await page.getByRole("button", { name: "Continue to Payment" }).click();
  await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  return { ...actionFact(page), checkoutUrl: page.url() };
}

export async function prepareWalletCardPayment(
  page: Page,
  details: CardPaymentDetails
): Promise<WalletActionFact & { paymentReady: boolean }> {
  await prepareCardCheckout(page, details.email);
  await (await findInFrames(page, [
    'input[name="cardNumber"]', 'input[autocomplete="cc-number"]',
  ])).fill(details.cardNumber);
  await (await findInFrames(page, [
    'input[name="cardExpiry"]', 'input[autocomplete="cc-exp"]',
  ])).fill(details.cardExpiry);
  await (await findInFrames(page, [
    'input[name="cardCvc"]', 'input[autocomplete="cc-csc"]',
  ])).fill(details.cardCvc);

  if (details.billingName !== undefined) {
    const name = await findInFrames(page, [
      'input[name="billingName"]', 'input[autocomplete="cc-name"]',
    ], 2_000).catch(() => null);
    if (name) await name.fill(details.billingName);
  }
  if (details.billingPostalCode !== undefined) {
    const postal = await findInFrames(page, [
      'input[name="billingPostalCode"]', 'input[autocomplete="postal-code"]',
    ], 2_000).catch(() => null);
    if (postal) await postal.fill(details.billingPostalCode);
  }

  // Stripe may remount Contact information while card fields are filled.
  await prepareCardCheckout(page, details.email);
  const pay = paymentButton(page);
  await expect(pay).toBeEnabled({ timeout: 30_000 });
  return { ...actionFact(page), paymentReady: await pay.isEnabled() };
}

// Non-idempotent: a timeout after clicking Pay is action_unknown, never a reason to resubmit.
export async function submitWalletPayment(
  page: Page
): Promise<WalletActionFact & { returnedToWallet: boolean }> {
  const pay = paymentButton(page);
  await expect(pay).toBeEnabled({ timeout: 30_000 });
  await pay.click();
  await expect(page).toHaveURL(/\/wallet(?:\?|$)/, { timeout: 60_000 });
  return {
    ...actionFact(page),
    returnedToWallet: /\/wallet(?:\?|$)/.test(page.url()),
  };
}

export async function readWalletBalanceAndTransactions(
  page: Page
): Promise<WalletActionFact & WalletDisplayFact> {
  await goToAppPath(page, "/wallet");
  await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();
  const summary = page.locator('[data-slot="wallet-summary"]');
  const table = page.getByRole("table");
  await expect(summary).toBeVisible();
  return {
    ...actionFact(page),
    summaryText: (await summary.innerText()).trim(),
    transactionRows: (await table.isVisible().catch(() => false))
      ? (await table.getByRole("row").allTextContents()).map((row) => row.trim())
      : [],
  };
}
