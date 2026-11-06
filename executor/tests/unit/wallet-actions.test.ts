import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  openWalletTopUp,
  prepareWalletCardPayment,
  readWalletBalanceAndTransactions,
  startWalletCheckout,
  submitWalletPayment,
} from "../../src/actions/wallet-actions";

it("composes wallet atoms, records UI facts, and submits checkout only once", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let paid = false;
    let checkoutSubmissions = 0;
    let paymentSubmissions = 0;

    await page.route("http://test.local/wallet**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>Wallet</h1><div data-slot="wallet-summary">Available $${paid ? "50.00" : "0.00"}</div>
          <table><tr><td>${paid ? "Top Up +$50.00" : "No transactions"}</td></tr></table>
          <button id="top-up">Top Up</button>
          <form hidden><label>Amount (USD)<input name="amount"></label>
            <button type="button" id="continue">Continue to Payment</button></form>
          <script>
            document.querySelector('#top-up').onclick = () =>
              document.querySelector('form').hidden = false;
            document.querySelector('#continue').onclick = () =>
              fetch('/api/v1/wallet/topup', { method: 'POST' }).then(() =>
                location.href = 'https://checkout.stripe.com/c/test');
          </script>`,
      })
    );
    await page.route("http://test.local/api/v1/wallet/topup", (route) => {
      checkoutSubmissions++;
      return route.fulfill({ status: 200, body: "{}" });
    });
    await page.route("https://checkout.stripe.com/c/test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<button>Pay without Link</button>
          <label><input type="checkbox">I am an AI agent acting on behalf of someone else</label>
          <input type="email"><label><input type="checkbox" checked>
            Save my information for faster checkout</label>
          <label><input type="radio" name="method">Card</label>
          <input name="cardNumber"><input name="cardExpiry"><input name="cardCvc">
          <input name="billingName"><input name="billingPostalCode">
          <button id="pay">Pay $50</button>
          <script>document.querySelector('#pay').onclick = () =>
            fetch('http://test.local/charge', { method: 'POST' }).then(() =>
              location.href = 'http://test.local/wallet?topup=success');</script>`,
      })
    );
    await page.route("http://test.local/charge", (route) => {
      paymentSubmissions++;
      paid = true;
      return route.fulfill({ status: 200, body: "{}" });
    });

    const opened = await openWalletTopUp(page);
    expect(opened).toMatchObject({
      amountEntryVisible: true,
      pageUrl: "http://test.local/wallet",
    });
    expect(opened.capturedAt).toBeTruthy();

    const checkout = await startWalletCheckout(page, 50);
    expect(checkout.checkoutUrl).toBe("https://checkout.stripe.com/c/test");
    expect(checkoutSubmissions).toBe(1);

    const details = {
      email: "qa@example.test",
      cardNumber: "4242424242424242",
      cardExpiry: "1234",
      cardCvc: "123",
      billingName: "Test QA",
      billingPostalCode: "10001",
    };
    const prepared = await prepareWalletCardPayment(page, details);
    expect(prepared.paymentReady).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain(details.cardNumber);
    expect(await page.locator('input[name="cardNumber"]').inputValue()).toBe(details.cardNumber);
    expect(await page.getByRole("checkbox", { name: /i am an ai agent/i }).isChecked()).toBe(true);
    expect(await page.getByRole("checkbox", { name: /save my information/i }).isChecked()).toBe(false);

    const payment = await submitWalletPayment(page);
    expect(payment.returnedToWallet).toBe(true);
    expect(paymentSubmissions).toBe(1);

    const display = await readWalletBalanceAndTransactions(page);
    expect(display).toMatchObject({
      summaryText: "Available $50.00",
      transactionRows: ["Top Up +$50.00"],
      pageUrl: "http://test.local/wallet",
    });
    expect(display).not.toHaveProperty("pass");
  } finally {
    await browser.close();
  }
}, 30_000);
