import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import {
  beginStudioSetGeneration,
  confirmStudioProductBrief,
  observeStudioGenerateGate,
  observeStudioLibraryRuns,
  openStudioCreateSheet,
  openStudioLibrary,
  readStudioProductBrief,
  reopenStudioProductBrief,
  returnToStudioLibrary,
  setStudioProductBrief,
} from "../../../src/actions/studio-actions";
import {
  observeStudioReferenceMedia,
  selectStudioReference,
} from "../../../src/actions/meta-availability-actions";
import { UserApiClient } from "../../../src/clients/user-api";

const OVER_LIMIT_TEXT = "X".repeat(2_100);
const API_BASE_URL = "https://api-server-pr-1168.up.railway.app";

test(
  "PE-600 Confirm follows prefilled, empty, over-limit and re-edit states",
  { tag: ["@case:pe600-confirm", "@qa:pe-600"] },
  async ({ page }, testInfo) => {
    await openStudioLibrary(page);
    await openStudioCreateSheet(page);
    const initial = await readStudioProductBrief(page);
    expect(initial.text.trim().length).toBeGreaterThan(0);
    expect(initial).toMatchObject({ locked: false, confirmVisible: true, confirmEnabled: true });

    const empty = await setStudioProductBrief(page, "");
    expect(empty.confirmEnabled).toBe(false);
    const long = await setStudioProductBrief(page, OVER_LIMIT_TEXT);
    expect(long.confirmEnabled).toBe(false);
    expect(long.limitWarning).toMatch(/Character limit exceeded/i);
    const restored = await setStudioProductBrief(page, initial.text);
    expect(restored).toMatchObject({ confirmVisible: true, confirmEnabled: true });

    const confirmed = await confirmStudioProductBrief(page);
    expect(confirmed.locked).toBe(true);
    const reopened = await reopenStudioProductBrief(page);
    expect(reopened).toMatchObject({ text: initial.text, locked: false, confirmEnabled: true });
    await expect(page.getByText("Brand profile could not be loaded.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit Key Message/i })).toHaveCount(0);
    await confirmStudioProductBrief(page);
    await testInfo.attach("pe600-confirm-facts", {
      body: JSON.stringify({
        prefilled: initial.text.length > 0,
        emptyDisabled: !empty.confirmEnabled,
        overLimitDisabled: !long.confirmEnabled,
        warning: long.limitWarning,
        confirmed: confirmed.locked,
        reopened: !reopened.locked,
      }, null, 2),
      contentType: "application/json",
    });
  }
);

test(
  "PE-600 planning placeholders survive a clean second composer and concurrent generation",
  { tag: ["@case:pe600-concurrent", "@qa:pe-600"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const api = new UserApiClient({ baseUrl: API_BASE_URL, getToken: getAccountJwt });
    const me = await api.me() as { primaryOrgId?: unknown; org?: { id?: unknown } };
    const orgId = typeof me.primaryOrgId === "string" ? me.primaryOrgId
      : typeof me.org?.id === "string" ? me.org.id : null;
    expect(orgId, "active test organization is required").toBeTruthy();

    const releases: Array<() => void> = [];
    let intercepted = 0;
    let forwarded = 0;
    const forwardErrors: string[] = [];
    const gates = [
      new Promise<void>((resolve) => { releases[0] = resolve; }),
      new Promise<void>((resolve) => { releases[1] = resolve; }),
    ];
    await page.route("**/api/v1/creative/plans", async (route) => {
      const order = intercepted++;
      if (order < gates.length) await gates[order];
      try {
        await route.continue();
        forwarded += 1;
      } catch (error) {
        forwardErrors.push(error instanceof Error ? error.name : "unknown");
      }
    });

    let firstSetId: string | null = null;
    let secondSetId: string | null = null;
    let pendingCount = 0;
    let failureStage: string | null = null;
    let firstTerminal: string | null = null;
    let secondTerminal: string | null = null;
    try {
      await openStudioLibrary(page);
      const baseline = await observeStudioLibraryRuns(page);
      await openStudioCreateSheet(page);
      const firstBrief = await readStudioProductBrief(page);
      expect(firstBrief.text.trim()).not.toBe("");
      if (!firstBrief.locked) await confirmStudioProductBrief(page);
      await selectStudioReference(page, 1);
      await observeStudioReferenceMedia(page);
      const first = await beginStudioSetGeneration(page);
      expect(first.setIds).toHaveLength(1);
      firstSetId = first.setIds[0]!;

      await returnToStudioLibrary(page);
      const afterFirst = await observeStudioLibraryRuns(page);
      expect(afterFirst.cardCount).toBeGreaterThanOrEqual(baseline.cardCount + 1);
      expect(afterFirst.generatingCardCount).toBeGreaterThanOrEqual(1);
      await openStudioCreateSheet(page);
      const clean = await readStudioProductBrief(page);
      expect(clean.locked).toBe(false);
      expect(await observeStudioGenerateGate(page)).toMatchObject({ enabled: false });
      await setStudioProductBrief(page, `${firstBrief.text}\n\nConcurrent QA set two`);
      await confirmStudioProductBrief(page);
      await selectStudioReference(page, 2);
      await observeStudioReferenceMedia(page);
      const second = await beginStudioSetGeneration(page);
      expect(second.setIds).toHaveLength(1);
      secondSetId = second.setIds[0]!;
      expect(secondSetId).not.toBe(firstSetId);

      await returnToStudioLibrary(page);
      const both = await observeStudioLibraryRuns(page);
      pendingCount = both.generatingCardCount;
      await page.screenshot({
        animations: "disabled", path: testInfo.outputPath("two-pending-sets.png"),
      });
      expect(both.cardCount).toBeGreaterThanOrEqual(baseline.cardCount + 2);
      expect(both.generatingCardCount).toBeGreaterThanOrEqual(2);
      releases[1]?.();
      releases[0]?.();
      await expect.poll(() => forwarded + forwardErrors.length, {
        timeout: 30_000,
      }).toBeGreaterThanOrEqual(2);
      expect(forwardErrors).toEqual([]);
    } catch (error) {
      failureStage = error instanceof Error ? error.message.slice(0, 220) : "unknown";
      throw error;
    } finally {
      releases[1]?.();
      releases[0]?.();
      await testInfo.attach("pe600-two-run-facts", {
        body: JSON.stringify({
          firstSuffix: firstSetId?.slice(-8) ?? null,
          secondSuffix: secondSetId?.slice(-8) ?? null,
          pendingCount,
          interceptedPlanRequests: intercepted,
          forwardedPlanRequests: forwarded,
          forwardErrors,
          failureStage,
        }, null, 2),
        contentType: "application/json",
      });
    }

    const token = await getAccountJwt();
    const headers = { authorization: `Bearer ${token}`, "X-Hellyeah-Org": orgId! };
    const readSet = async (id: string): Promise<string> => {
      try {
        const response = await page.request.get(`${API_BASE_URL}/api/v1/creative/sets/${id}`, {
          headers, timeout: 15_000,
        });
        if (response.status() === 404) return "planning";
        if (!response.ok) return `http_${response.status()}`;
        const body = await response.json() as { status?: unknown };
        return typeof body.status === "string" ? body.status : "unknown";
      } catch {
        return "api_transport_unknown";
      }
    };
    const observe = async () => {
      const [a, b] = await Promise.all([readSet(firstSetId!), readSet(secondSetId!)]);
      firstTerminal = a;
      secondTerminal = b;
      return { a, b };
    };
    await expect.poll(observe, {
      timeout: 4 * 60_000, intervals: [2_000, 5_000, 10_000],
    }).toEqual({
      a: expect.stringMatching(/^(?:complete|partial|failed)$/),
      b: expect.stringMatching(/^(?:complete|partial|failed)$/),
    });
    expect(firstTerminal).toBe("complete");
    expect(secondTerminal).toBe("complete");
    await page.reload();
    const final = await observeStudioLibraryRuns(page);
    expect(final.cardCount).toBeGreaterThanOrEqual(2);
    await testInfo.attach("pe600-terminal-facts", {
      body: JSON.stringify({
        firstSuffix: firstSetId?.slice(-8), secondSuffix: secondSetId?.slice(-8),
        firstTerminal, secondTerminal, finalCardCount: final.cardCount,
      }, null, 2),
      contentType: "application/json",
    });
  }
);

test(
  "PE-600 read-only set audit before any retry",
  { tag: ["@diagnostic:pe600-sets-audit"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const api = new UserApiClient({ baseUrl: API_BASE_URL, getToken: getAccountJwt });
    const me = await api.me() as { primaryOrgId?: unknown; org?: { id?: unknown } };
    const orgId = typeof me.primaryOrgId === "string" ? me.primaryOrgId
      : typeof me.org?.id === "string" ? me.org.id : null;
    expect(orgId).toBeTruthy();
    const response = await page.request.get(`${API_BASE_URL}/api/v1/creative/sets?limit=25`, {
      headers: {
        authorization: `Bearer ${await getAccountJwt()}`,
        "X-Hellyeah-Org": orgId!,
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json() as { sets?: Array<{
      creativeSetId?: string;
      createdAt?: string;
      status?: string;
    }> };
    const recent = (body.sets ?? []).slice(0, 8).map((set) => ({
      idSuffix: set.creativeSetId?.slice(-8) ?? null,
      createdAt: set.createdAt ?? null,
      status: set.status ?? null,
    }));
    const jobsResponse = await page.request.get(
      `${API_BASE_URL}/api/v1/creative/jobs?view=jobs&limit=100`, {
        headers: {
          authorization: `Bearer ${await getAccountJwt()}`,
          "X-Hellyeah-Org": orgId!,
        },
      }
    );
    const jobsBody = jobsResponse.ok()
      ? await jobsResponse.json() as { jobs?: Array<{ id?: string; createdAt?: string; status?: string }> }
      : null;
    const recentJobs = (jobsBody?.jobs ?? []).slice(0, 8).map((job) => ({
      idSuffix: job.id?.slice(-8) ?? null,
      createdAt: job.createdAt ?? null,
      status: job.status ?? null,
    }));
    const details = await Promise.all((body.sets ?? []).slice(0, 2).map(async (set) => {
      if (!set.creativeSetId) return { status: null, keys: [], bodyStatus: null };
      const detail = await page.request.get(
        `${API_BASE_URL}/api/v1/creative/sets/${set.creativeSetId}`, {
          headers: {
            authorization: `Bearer ${await getAccountJwt()}`,
            "X-Hellyeah-Org": orgId!,
          },
        }
      );
      const value = await detail.json().catch(() => null) as Record<string, unknown> | null;
      return {
        status: detail.status(),
        keys: value && typeof value === "object" ? Object.keys(value).slice(0, 12) : [],
        bodyStatus: typeof value?.status === "string" ? value.status : null,
        nestedStatus: value?.set && typeof value.set === "object" &&
          "status" in value.set ? (value.set as { status?: unknown }).status : null,
      };
    }));
    console.log(`PE600_READONLY_SET_AUDIT ${JSON.stringify({ recent, jobsStatus: jobsResponse.status(), recentJobs, details })}`);
    await testInfo.attach("pe600-read-only-set-audit", {
      body: JSON.stringify({ recent, jobsStatus: jobsResponse.status(), recentJobs, details }, null, 2), contentType: "application/json",
    });
  }
);

test(
  "PE-600 375px character warning stays readable beside Confirm",
  { tag: ["@case:pe600-mobile-warning", "@qa:pe-600"] },
  async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openStudioLibrary(page);
    await openStudioCreateSheet(page);
    const initial = await readStudioProductBrief(page);
    expect(initial.text.trim().length).toBeGreaterThan(0);
    const long = await setStudioProductBrief(page, OVER_LIMIT_TEXT);
    expect(long.confirmEnabled).toBe(false);
    expect(long.limitWarning).toMatch(/Character limit exceeded/i);
    const box = page.locator('[data-slot="brief-box"]');
    const actual = await box.getByRole("alert").evaluate((warning) => {
      const button = warning.parentElement?.querySelector('[data-slot="brief-mark"]');
      if (!(button instanceof HTMLElement)) throw new Error("Confirm button missing");
      const target = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(warning);
      const textRects = [...range.getClientRects()];
      const overlap = textRects.some((rect) =>
        rect.left < target.right && rect.right > target.left &&
        rect.top < target.bottom && rect.bottom > target.top);
      return { overlap, textLines: textRects.length, buttonDisabled: button.hasAttribute("disabled") };
    });
    await page.screenshot({
      animations: "disabled", path: testInfo.outputPath("mobile-confirm-warning.png"),
    });
    await testInfo.attach("pe600-mobile-warning-facts", {
      body: JSON.stringify(actual, null, 2), contentType: "application/json",
    });
    const restored = await setStudioProductBrief(page, initial.text);
    expect(restored.confirmEnabled).toBe(true);
    expect(actual.buttonDisabled).toBe(true);
    expect(actual.overlap, "warning text must not overlap Confirm at 375px").toBe(false);
  }
);
