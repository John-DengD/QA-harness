import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { accountTest } from "../../../src/account-fixtures";
import { UserApiClient } from "../../../src/clients/user-api";
import {
  observeCampaignPlatformAvailability,
  observeStudioComposerPlatformSummary,
  observeStudioMetaVisibility,
  readMetaAvailabilityStatus,
  selectStudioReference,
  generateStudioSet,
  observeStudioReferenceMedia,
} from "../../../src/actions/meta-availability-actions";
import {
  observeCampaignDraftStable,
  observeCampaignType,
  observeCampaignTypeLabel,
  openCampaignComposer,
  openCampaignList,
  openExistingCampaignDetail,
  observeCampaignProtectiveActions,
  submitCampaignGoal,
  waitForCampaignDraft,
} from "../../../src/actions/campaign-actions";
import {
  confirmStudioProductBrief,
  observeStudioGenerateGate,
  observeStudioLibraryControls,
  openStudioCreateSheet,
  openStudioLibrary,
  openStudioSetReview,
  readStudioProductBrief,
} from "../../../src/actions/studio-actions";

const API_BASE_URL = "https://api-server-pr-1185.up.railway.app";

accountTest(
  "PE-606 Meta off hides campaign switch and drafts Google",
  { tag: ["@case:pe606-campaign-off", "@qa:pe-606"] },
  async ({ page }, testInfo) => {
    await openCampaignComposer(page);
    const status = await readMetaAvailabilityStatus(page, API_BASE_URL);
    const before = await observeCampaignPlatformAvailability(page);
    expect(status).toMatchObject({ responseStatus: 200, available: false });
    expect(before).toEqual({
      switchVisible: false,
      googleOptionVisible: false,
      metaOptionVisible: false,
    });
    expect(await observeCampaignTypeLabel(page)).toMatchObject({ visible: false });
    await testInfo.attach("campaign-off-reference-01", {
      body: await page.screenshot(), contentType: "image/png",
    });

    await submitCampaignGoal(page, "Drive trial signups for a productivity app");
    const draft = await waitForCampaignDraft(page);
    const stable = await observeCampaignDraftStable(page);
    const type = await observeCampaignType(page);
    expect(stable.visible).toBe(true);
    expect(type.selectedType).toBe("Search");
    await expect(page.getByRole("heading", { name: "New Google campaign" })).toBeVisible();
    expect(await observeCampaignPlatformAvailability(page)).toEqual({
      switchVisible: false,
      googleOptionVisible: false,
      metaOptionVisible: false,
    });
    await testInfo.attach("campaign-google-draft-reference-07", {
      body: await page.screenshot(), contentType: "image/png",
    });
    await testInfo.attach("pe-606-campaign-off-facts", {
      body: JSON.stringify({ status, before, draft, stable, type }, null, 2),
      contentType: "application/json",
    });
  }
);

accountTest(
  "PE-606 existing campaign list remains readable with Meta off",
  { tag: ["@case:pe606-existing-read", "@qa:pe-606"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const status = await readMetaAvailabilityStatus(page, API_BASE_URL);
    expect(status.available).toBe(false);
    const api = new UserApiClient({ baseUrl: API_BASE_URL, getToken: getAccountJwt });
    const campaigns = await api.campaigns(100);
    const list = await openCampaignList(page);
    await expect(page.getByRole("heading", { name: "Campaigns", exact: true })).toBeVisible();
    const statusCounts = campaigns.items.reduce<Record<string, number>>((counts, item) => {
      const key = `${item.platform}:${item.status}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const meta = campaigns.items.find((item) => item.platform === "meta" &&
      ["active", "paused"].includes(item.status)) ??
      campaigns.items.find((item) => item.platform === "meta");
    expect(meta, "a stored Meta campaign is required for this read-only check").toBeTruthy();
    const items = campaigns.items.slice(0, 10).map((item) => ({
      idSuffix: item.id.slice(-8), status: item.status, platform: item.platform,
    }));
    console.log(`PE606_EXISTING_CAMPAIGNS ${JSON.stringify({ count: campaigns.items.length, statusCounts, candidate: meta ? { idSuffix: meta.id.slice(-8), status: meta.status } : null, items })}`);
    let detail: { url: string } | null = null;
    let protective: Awaited<ReturnType<typeof observeCampaignProtectiveActions>> | null = null;
    if (meta) {
      detail = await openExistingCampaignDetail(page, meta.id);
      protective = await observeCampaignProtectiveActions(page);
      await page.screenshot({ path: testInfo.outputPath("existing-meta-campaign.png") });
    }
    await testInfo.attach("pe-606-existing-campaigns", {
      body: JSON.stringify({ status, list, count: campaigns.items.length, statusCounts, candidateStatus: meta?.status ?? null, detail, protective, items }, null, 2),
      contentType: "application/json",
    });
  }
);

accountTest(
  "PE-606 Meta off keeps Studio Google-only",
  { tag: ["@case:pe606-studio-off", "@qa:pe-606"] },
  async ({ page }, testInfo) => {
    const library = await openStudioLibrary(page);
    const controls = await observeStudioLibraryControls(page);
    const libraryMeta = await observeStudioMetaVisibility(page);
    expect(library.url).toMatch(/\/studio/);
    expect(controls).toMatchObject({ headingVisible: true, stateFilterVisible: true });
    expect(libraryMeta.metaCardSwitchVisible).toBe(false);
    expect(libraryMeta.metaCardLabelCount).toBe(0);
    await testInfo.attach("studio-library-reference-02", {
      body: await page.screenshot(), contentType: "image/png",
    });

    const create = await openStudioCreateSheet(page);
    expect(create.title).toMatch(/New Creative Sets?/i);
    const brief = await readStudioProductBrief(page);
    expect(brief.confirmVisible).toBe(true);
    const confirmed = brief.locked ? brief : await confirmStudioProductBrief(page);
    expect(confirmed.locked).toBe(true);
    const reference = await selectStudioReference(page, 1);
    expect(reference).toMatchObject({ selected: true, selectedCount: 1 });
    const media = await observeStudioReferenceMedia(page);
    expect(media).toMatchObject({ selectedImageCount: 1, selectedImageLoaded: true });
    const summary = await observeStudioComposerPlatformSummary(page);
    expect(summary).toMatchObject({ summary: "1 set · Google", googleOnlySummaryVisible: true, metaSummaryVisible: false });
    const generateGate = await observeStudioGenerateGate(page);
    expect(generateGate.enabled).toBe(true);
    await testInfo.attach("studio-composer-reference-03", {
      body: await page.screenshot(), contentType: "image/png",
    });
    await page.screenshot({ path: testInfo.outputPath("studio-composer-google-only.png") });

    await testInfo.attach("pe-606-studio-off-facts", {
      body: JSON.stringify({ library, controls, libraryMeta, create, brief, confirmed, reference, media, summary, generateGate }, null, 2),
      contentType: "application/json",
    });
  }
);

accountTest(
  "PE-606 existing Studio set review has no Meta preview choice",
  { tag: ["@case:pe606-studio-review-off", "@qa:pe-606"] },
  async ({ page }, testInfo) => {
    await openStudioLibrary(page);
    const library = await observeStudioMetaVisibility(page);
    expect(library.cardCount).toBeGreaterThan(0);
    expect(library.metaCardSwitchVisible).toBe(false);
    const review = await openStudioSetReview(page);
    const visibility = await observeStudioMetaVisibility(page);
    expect(review.reviewVisible).toBe(true);
    expect(visibility.reviewMetaSwitchVisible).toBe(false);
    await expect(page.getByRole("button", { name: "Show Meta creative", exact: true })).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("studio-set-review-google-only.png"),
    });
    await testInfo.attach("pe-606-studio-review-facts", {
      body: JSON.stringify({ library, review, visibility }, null, 2),
      contentType: "application/json",
    });
  }
);

accountTest(
  "PE-606 Meta off generates Google creative only and hides review Meta choice",
  { tag: ["@case:pe606-studio-generate-off", "@qa:pe-606"] },
  async ({ page }, testInfo) => {
    await openStudioLibrary(page);
    await openStudioCreateSheet(page);
    const brief = await readStudioProductBrief(page);
    if (!brief.locked) await confirmStudioProductBrief(page);
    await selectStudioReference(page, 1);
    const summary = await observeStudioComposerPlatformSummary(page);
    expect(summary.summary).toBe("1 set · Google");

    const generation = await generateStudioSet(page);
    await testInfo.attach("pe-606-studio-generation-facts", {
      body: JSON.stringify({ summary, generation }, null, 2),
      contentType: "application/json",
    });
    console.log(`PE606_STUDIO_GENERATION ${JSON.stringify(generation)}`);
    expect(generation.planResponseStatus).toBe(200);
    expect(generation.requestObserved).toBe(true);
    expect(generation.responseStatus).toBe(202);
    expect(generation.creativeSetId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(generation.metaBundleReturned).toBe(false);
    const review = await observeStudioMetaVisibility(page);
    expect(review.reviewMetaSwitchVisible).toBe(false);
    await testInfo.attach("pe-606-studio-generation-facts", {
      body: JSON.stringify({ summary, generation, review }, null, 2),
      contentType: "application/json",
    });
    await testInfo.attach("studio-review-google-only", {
      body: await page.screenshot(), contentType: "image/png",
    });
  }
);

accountTest(
  "PE-606 Meta set and image requests are refused before jobs or quota",
  { tag: ["@case:pe606-api-guarded-off", "@qa:pe-606"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const status = await readMetaAvailabilityStatus(page, API_BASE_URL);
    expect(status).toMatchObject({ responseStatus: 200, available: false });
    const jwt = await getAccountJwt();
    const me = await page.request.get(`${API_BASE_URL}/api/v1/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(me.status()).toBe(200);
    const identity = await me.json() as { primaryOrgId?: unknown; org?: { id?: unknown } };
    const orgId = typeof identity.primaryOrgId === "string"
      ? identity.primaryOrgId
      : typeof identity.org?.id === "string" ? identity.org.id : null;
    expect(orgId).not.toBeNull();
    const headers = { authorization: `Bearer ${jwt}`, "X-Hellyeah-Org": orgId! };
    const setId = randomUUID();
    const setUrl = `${API_BASE_URL}/api/v1/creative/sets/${setId}`;
    const jobsUrl = `${API_BASE_URL}/api/v1/creative/jobs?limit=100&offset=0`;
    const quotaUrl = `${API_BASE_URL}/api/v1/creative/rate-limit`;
    const [setBefore, jobsBefore, quotaBefore] = await Promise.all([
      page.request.get(setUrl, { headers }),
      page.request.get(jobsUrl, { headers }),
      page.request.get(quotaUrl, { headers }),
    ]);
    expect(setBefore.status()).toBe(404);
    expect(jobsBefore.status()).toBe(200);
    expect(quotaBefore.status()).toBe(200);
    const before = await jobsBefore.json() as { jobs?: Array<{ id?: string }> };
    const quotaStart = await quotaBefore.json();
    const setResponse = await page.request.post(`${API_BASE_URL}/api/v1/creative/sets`, {
      headers,
      data: {
        creativeSetId: setId,
        platform: "meta",
        referenceImageUrl: "https://assets.hellyeahai.com/global/assets/creative-reference-gallery/v1/01-beehiiv.jpg",
      },
    });
    const setBody = await setResponse.json().catch(() => null) as {
      code?: unknown; error?: { code?: unknown };
    } | null;
    const imageResponse = await page.request.post(`${API_BASE_URL}/api/v1/creative/images`, {
      headers,
      data: { platform: "meta", format: "square" },
    });
    const imageBody = await imageResponse.json().catch(() => null) as {
      code?: unknown; error?: { code?: unknown };
    } | null;
    const [setAfter, jobsAfter, quotaAfter] = await Promise.all([
      page.request.get(setUrl, { headers }),
      page.request.get(jobsUrl, { headers }),
      page.request.get(quotaUrl, { headers }),
    ]);
    const after = jobsAfter.ok()
      ? await jobsAfter.json() as { jobs?: Array<{ id?: string }> }
      : null;
    const quotaEnd = quotaAfter.ok() ? await quotaAfter.json() : null;
    const beforeIds = new Set((before.jobs ?? []).map((job) => job.id));
    const newJobSuffixes = (after?.jobs ?? [])
      .filter((job) => !beforeIds.has(job.id))
      .map((job) => job.id?.slice(-8) ?? null);
    const facts = {
      status,
      setStatus: setResponse.status(),
      setCode: setBody?.code ?? setBody?.error?.code ?? null,
      imageStatus: imageResponse.status(),
      imageCode: imageBody?.code ?? imageBody?.error?.code ?? null,
      exactSetBefore: setBefore.status(),
      exactSetAfter: setAfter.status(),
      beforeJobCount: before.jobs?.length ?? 0,
      afterJobCount: after?.jobs?.length ?? null,
      newJobSuffixes,
      quotaUnchanged: JSON.stringify(quotaStart) === JSON.stringify(quotaEnd),
    };
    console.log(`PE606_META_GUARDED_PROBE ${JSON.stringify(facts)}`);
    await testInfo.attach("pe-606-meta-guarded-facts", {
      body: JSON.stringify(facts, null, 2), contentType: "application/json",
    });
    expect(facts).toMatchObject({
      setStatus: 409, setCode: "E_META_UNAVAILABLE",
      imageStatus: 409, imageCode: "E_META_UNAVAILABLE",
      exactSetAfter: 404, newJobSuffixes: [],
    });
  }
);

accountTest(
  "PE-606 new Meta plan and launch are refused before campaign or wallet changes",
  { tag: ["@case:pe606-api-campaign-guarded-off", "@qa:pe-606"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const status = await readMetaAvailabilityStatus(page, API_BASE_URL);
    expect(status).toMatchObject({ responseStatus: 200, available: false });
    const jwt = await getAccountJwt();
    const identityResponse = await page.request.get(`${API_BASE_URL}/api/v1/me`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(identityResponse.status()).toBe(200);
    const identity = await identityResponse.json() as { primaryOrgId?: string; org?: { id?: string } };
    const orgId = identity.primaryOrgId ?? identity.org?.id;
    expect(orgId).toBeTruthy();
    const headers = { authorization: `Bearer ${jwt}`, "X-Hellyeah-Org": orgId! };
    const read = async (endpoint: string): Promise<unknown> => {
      const response = await page.request.get(`${API_BASE_URL}/api/v1${endpoint}`, { headers });
      expect(response.status(), endpoint).toBe(200);
      return response.json();
    };
    const endpoints = ["/campaigns/plans", "/campaigns?limit=100", "/wallet/balance", "/wallet/reservations"];
    const before = await Promise.all(endpoints.map(read));
    const plan = await page.request.post(`${API_BASE_URL}/api/v1/campaigns/plans`, {
      headers,
      data: { name: `Availability probe ${randomUUID()}`, platform: "meta", budgetAmount: 350 },
    });
    const planBody = await plan.json().catch(() => null) as { code?: string; error?: { code?: string } } | null;
    const launch = await page.request.post(`${API_BASE_URL}/api/v1/campaigns/launch`, {
      headers: { ...headers, "Idempotency-Key": `availability-probe-${randomUUID()}` },
      data: {
        platform: "meta",
        textJobId: randomUUID(),
        budgetCents: 35000,
        targeting: { schedule: { startDate: "2026-10-01" } },
      },
    });
    const launchBody = await launch.json().catch(() => null) as { code?: string; error?: { code?: string } } | null;
    const after = await Promise.all(endpoints.map(read));
    const facts = {
      status,
      planStatus: plan.status(), planCode: planBody?.code ?? planBody?.error?.code ?? null,
      launchStatus: launch.status(), launchCode: launchBody?.code ?? launchBody?.error?.code ?? null,
      plansUnchanged: JSON.stringify(before[0]) === JSON.stringify(after[0]),
      campaignsUnchanged: JSON.stringify(before[1]) === JSON.stringify(after[1]),
      walletUnchanged: JSON.stringify(before[2]) === JSON.stringify(after[2]),
      reservationsUnchanged: JSON.stringify(before[3]) === JSON.stringify(after[3]),
    };
    console.log(`PE606_META_CAMPAIGN_GUARD ${JSON.stringify(facts)}`);
    await testInfo.attach("pe-606-meta-campaign-guard-facts", {
      body: JSON.stringify(facts, null, 2), contentType: "application/json",
    });
    expect(facts).toMatchObject({
      planStatus: 409, planCode: "E_META_UNAVAILABLE",
      launchStatus: 409, launchCode: "E_META_UNAVAILABLE",
      plansUnchanged: true, campaignsUnchanged: true, walletUnchanged: true, reservationsUnchanged: true,
    });
  }
);
