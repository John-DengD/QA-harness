import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import {
  classifyBrandResearchState,
  dashboardReadinessFallback,
  getDashboardReadySignal,
} from "../../src/actions/onboarding-actions";

describe("getDashboardReadySignal", () => {
  it("uses the rendered dashboard sidebar instead of URL navigation as readiness", () => {
    const ready = {};
    const page = {
      locator: vi.fn().mockReturnValue(ready),
    } as unknown as Page;

    expect(getDashboardReadySignal(page)).toBe(ready);
    expect(page.locator).toHaveBeenCalledWith('[data-sidebar="footer"]');
  });
});

describe("dashboardReadinessFallback", () => {
  it("continues when the dashboard rendered after onboarding", () => {
    expect(
      dashboardReadinessFallback({
        checkingAccountVisible: false,
        dashboardVisible: true,
      })
    ).toBe("continue");
  });

  it("reloads only when the account-checking loader is stuck", () => {
    expect(
      dashboardReadinessFallback({
        checkingAccountVisible: true,
        dashboardVisible: false,
      })
    ).toBe("reload");
  });

  it("keeps waiting when neither a dashboard nor the known loader is visible", () => {
    expect(
      dashboardReadinessFallback({
        checkingAccountVisible: false,
        dashboardVisible: false,
      })
    ).toBe("wait");
  });
});

describe("classifyBrandResearchState", () => {
  it("prefers a completed brand review over a stale error control", () => {
    expect(
      classifyBrandResearchState({
        confirmEnabled: true,
        stalledHeadingVisible: true,
        startOverVisible: true,
      })
    ).toBe("ready");
  });

  it("marks the explicit research-stalled screen as retryable", () => {
    expect(
      classifyBrandResearchState({
        confirmEnabled: false,
        stalledHeadingVisible: true,
        startOverVisible: true,
      })
    ).toBe("stalled");
  });

  it("does not treat a normal in-progress Start Over control as failure", () => {
    expect(
      classifyBrandResearchState({
        confirmEnabled: false,
        stalledHeadingVisible: false,
        startOverVisible: true,
      })
    ).toBeNull();
  });

  it("keeps polling while research is still in progress", () => {
    expect(
      classifyBrandResearchState({
        confirmEnabled: false,
        stalledHeadingVisible: false,
        startOverVisible: false,
      })
    ).toBeNull();
  });
});
