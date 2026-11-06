import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { teardownCampaign } from "../../src/cleanup/campaign-teardown";
import type { UserApiClient } from "../../src/clients/user-api";
import { StageTracker } from "../../src/tools/stage-tracker";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "campaign-teardown-"));
  const output = path.join(dir, "stages.json");
  const attachments: Array<{ name: string; value: Record<string, unknown> }> = [];
  const testInfo = {
    annotations: [] as Array<{ type: string; description: string }>,
    attach: vi.fn(async (name: string, options: { body: Buffer }) => {
      attachments.push({ name, value: JSON.parse(options.body.toString()) });
    }),
  } as unknown as TestInfo;
  return { attachments, output, stages: new StageTracker(output), testInfo };
}

describe("campaign teardown", () => {
  it("records an unresolved cancellation without assuming the refund timing or retrying", async () => {
    const { attachments, output, stages, testInfo } = await fixture();
    const api = {
      cancelCampaign: vi.fn().mockRejectedValue(new Error("cancel request failed")),
      campaign: vi.fn().mockResolvedValue({
        status: "pending_internal_review", pendingAdminReview: true, activatedAt: null,
        reservedCents: 5_000, refundStatus: null, refundEligibleAt: null,
      }),
      reservations: vi.fn().mockResolvedValue({
        reservations: [{ campaignId: "campaign-123", reservedCents: 5_000, status: "pending_internal_review" }],
      }),
    } as unknown as UserApiClient;

    await expect(teardownCampaign(api, "campaign-123", stages, testInfo)).rejects.toThrow("cancel request failed");
    expect(api.cancelCampaign).toHaveBeenCalledTimes(1);
    expect(api.campaign).toHaveBeenCalledWith("campaign-123");
    expect(attachments[0]).toMatchObject({
      name: "campaign-teardown-observation",
      value: { campaignId: "campaign-123", campaignStatus: "pending_internal_review", refundEligibleAt: null, reservationCents: 5_000 },
    });
    expect(testInfo.annotations).toHaveLength(1);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject([
      { name: "campaign-teardown", failureType: "teardown", status: "failed" },
      { name: "campaign-teardown-verification", failureType: "teardown", status: "failed" },
    ]);
  });

  it("accepts a cancelled pre-review request without requiring a 48-hour wait", async () => {
    const { attachments, stages, testInfo } = await fixture();
    const api = {
      cancelCampaign: vi.fn().mockResolvedValue({}),
      campaign: vi.fn().mockResolvedValue({
        status: "cancelled", pendingAdminReview: false, activatedAt: null,
        reservedCents: 5_000, refundStatus: "completed", refundEligibleAt: null,
      }),
      reservations: vi.fn().mockResolvedValue({ reservations: [] }),
    } as unknown as UserApiClient;

    await teardownCampaign(api, "campaign-123", stages, testInfo);
    expect(attachments[0].value).toMatchObject({ campaignStatus: "cancelled", refundStatus: "completed" });
    expect(testInfo.annotations).toHaveLength(0);
  });

  it("accepts a cancelled activated campaign with a pending 48-hour refund", async () => {
    const { attachments, stages, testInfo } = await fixture();
    const api = {
      cancelCampaign: vi.fn().mockResolvedValue({}),
      campaign: vi.fn().mockResolvedValue({
        status: "cancelled", pendingAdminReview: false, activatedAt: "2026-09-23T12:00:00.000Z",
        reservedCents: 5_000, refundStatus: "pending",
        refundEligibleAt: "2026-09-25T12:00:00.000Z",
      }),
      reservations: vi.fn().mockResolvedValue({ reservations: [] }),
    } as unknown as UserApiClient;

    await teardownCampaign(api, "campaign-123", stages, testInfo);
    expect(attachments[0].value).toMatchObject({
      campaignStatus: "cancelled",
      activatedAt: "2026-09-23T12:00:00.000Z",
      refundStatus: "pending",
      refundEligibleAt: "2026-09-25T12:00:00.000Z",
    });
    expect(testInfo.annotations).toHaveLength(0);
  });

  it("fails when the cancellation response succeeds but state remains unverified", async () => {
    const { stages, testInfo } = await fixture();
    const api = {
      cancelCampaign: vi.fn().mockResolvedValue({}),
      campaign: vi.fn().mockResolvedValue({ status: "active", pendingAdminReview: false, reservedCents: 5_000 }),
      reservations: vi.fn().mockResolvedValue({ reservations: [] }),
    } as unknown as UserApiClient;

    await expect(teardownCampaign(api, "campaign-123", stages, testInfo)).rejects.toThrow(/could not be verified/);
    expect(testInfo.annotations).toHaveLength(1);
  });
});
