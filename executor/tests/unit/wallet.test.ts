import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import {
  discloseAgentCheckoutIfPresent,
  selectCardPaymentMethodIfPresent,
} from "../../src/actions/wallet-actions";

describe("selectCardPaymentMethodIfPresent", () => {
  it("selects Card when Stripe shows the payment-method picker", async () => {
    const card = {
      click: vi.fn().mockResolvedValue(undefined),
      isChecked: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      waitFor: vi.fn().mockResolvedValue(undefined),
    };
    const page = { getByRole: vi.fn().mockReturnValue(card) } as unknown as Page;

    await expect(selectCardPaymentMethodIfPresent(page)).resolves.toBe(true);
    expect(page.getByRole).toHaveBeenCalledWith("radio", {
      exact: true,
      name: "Card",
    });
    expect(card.waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 10_000,
    });
    expect(card.click).toHaveBeenCalledOnce();
    expect(card.click).toHaveBeenCalledWith({ force: true });
  });

  it("leaves checkout layouts with direct card fields unchanged", async () => {
    const card = {
      click: vi.fn(),
      waitFor: vi.fn().mockRejectedValue(new Error("not found")),
    };
    const page = { getByRole: vi.fn().mockReturnValue(card) } as unknown as Page;

    await expect(selectCardPaymentMethodIfPresent(page)).resolves.toBe(false);
    expect(card.click).not.toHaveBeenCalled();
  });
});

describe("discloseAgentCheckoutIfPresent", () => {
  it("checks Stripe's AI agent disclosure when Checkout requests it", async () => {
    const disclosure = {
      dispatchEvent: vi.fn().mockResolvedValue(undefined),
      isChecked: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      waitFor: vi.fn().mockResolvedValue(undefined),
    };
    const page = { getByRole: vi.fn().mockReturnValue(disclosure) } as unknown as Page;

    await expect(discloseAgentCheckoutIfPresent(page)).resolves.toBe(true);
    expect(disclosure.dispatchEvent).toHaveBeenCalledExactlyOnceWith("click");
  });
});
