import type { TestInfo } from "@playwright/test";

import { UserApiClient, UserApiRequestError } from "../clients/user-api";
import { StageTracker } from "../tools/stage-tracker";

type CampaignReadClient = Pick<UserApiClient, "campaign" | "cancelCampaign" | "reservations">;

const errorFacts = (error: unknown) => ({
  type: error instanceof Error ? error.name : "UnknownError",
  ...(error instanceof UserApiRequestError
    ? { httpStatus: error.status, code: error.code ?? null }
    : {}),
});

export async function teardownCampaign(
  api: CampaignReadClient,
  campaignId: string,
  stages: StageTracker,
  testInfo: TestInfo
): Promise<void> {
  let cancelError: unknown;
  try {
    await stages.run("campaign-teardown", () => api.cancelCampaign(campaignId), "teardown");
  } catch (error) {
    cancelError = error;
  }

  // A failed response may follow a committed cancellation. Observe; never retry the mutation blindly.
  const [campaignRead, reservationsRead] = await Promise.allSettled([
    api.campaign(campaignId),
    api.reservations(),
  ]);
  const campaign = campaignRead.status === "fulfilled" ? campaignRead.value : null;
  const reservation = reservationsRead.status === "fulfilled"
    ? reservationsRead.value.reservations.find((item) => item.campaignId === campaignId)
    : null;
  const observation = {
    campaignId,
    campaignStatus: campaign?.status ?? null,
    activatedAt: campaign?.activatedAt ?? null,
    pendingAdminReview: campaign?.pendingAdminReview ?? null,
    refundAmountCents: campaign?.refundAmountCents ?? null,
    refundEligibleAt: campaign?.refundEligibleAt ?? null,
    refundStatus: campaign?.refundStatus ?? null,
    reservedCents: campaign?.reservedCents ?? null,
    reservationCents: reservation?.reservedCents ?? null,
    cancelError: cancelError === undefined ? null : errorFacts(cancelError),
    campaignReadError: campaignRead.status === "rejected" ? errorFacts(campaignRead.reason) : null,
    reservationsReadError: reservationsRead.status === "rejected" ? errorFacts(reservationsRead.reason) : null,
  };
  await testInfo.attach("campaign-teardown-observation", {
    body: Buffer.from(JSON.stringify(observation, null, 2)),
    contentType: "application/json",
  });

  let verificationError: unknown;
  try {
    await stages.run("campaign-teardown-verification", async () => {
      if (!campaign || campaign.status !== "cancelled" || reservationsRead.status === "rejected") {
        throw new Error("Cancellation state or reservation could not be verified");
      }
    }, "teardown");
  } catch (error) {
    verificationError = error;
  }

  if (cancelError !== undefined || verificationError !== undefined) {
    testInfo.annotations.push({
      type: "teardown",
      description: "Campaign cancellation needs review. See campaign-teardown-observation for the campaign ID, current state, refund timing, and reservation read; do not retry cancellation blindly.",
    });
    throw cancelError ?? verificationError;
  }
}
