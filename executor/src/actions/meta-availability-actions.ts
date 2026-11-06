import { expect, type Page } from "@playwright/test";

export interface CampaignPlatformAvailabilityFact {
  switchVisible: boolean;
  googleOptionVisible: boolean;
  metaOptionVisible: boolean;
}

export interface StudioMetaVisibilityFact {
  cardCount: number;
  metaCardSwitchVisible: boolean;
  metaCardLabelCount: number;
  reviewMetaSwitchVisible: boolean;
}

export interface StudioComposerPlatformFact {
  summary: string | null;
  googleOnlySummaryVisible: boolean;
  metaSummaryVisible: boolean;
}

export interface MetaAvailabilityStatusFact {
  responseStatus: number;
  available: boolean | null;
}

export interface StudioGenerationFact {
  clicked: boolean;
  requestObserved: boolean;
  planResponseStatus: number | null;
  planErrorCode: string | null;
  responseStatus: number | null;
  creativeSetId: string | null;
  googleBundleReturned: boolean;
  metaBundleReturned: boolean;
  imageJobCount: number;
}

export interface StudioReferenceSelectionFact {
  selected: boolean;
  selectedCount: number;
}

export interface StudioReferenceMediaFact {
  selectedImageCount: number;
  selectedImageLoaded: boolean;
}

const readVisible = async (locator: ReturnType<Page["getByRole"]>): Promise<boolean> =>
  (await locator.filter({ visible: true }).count()) > 0;

/** Reads the campaign composer platform choices without selecting either one. */
export async function observeCampaignPlatformAvailability(
  page: Page
): Promise<CampaignPlatformAvailabilityFact> {
  const google = page.getByRole("button", { name: "Run Google campaign", exact: true });
  const meta = page.getByRole("button", { name: "Run Meta campaign", exact: true });
  const googleOptionVisible = await readVisible(google);
  const metaOptionVisible = await readVisible(meta);
  return {
    switchVisible: googleOptionVisible || metaOptionVisible,
    googleOptionVisible,
    metaOptionVisible,
  };
}

/** Reads library/review Meta affordances without opening or mutating a set. */
export async function observeStudioMetaVisibility(
  page: Page
): Promise<StudioMetaVisibilityFact> {
  const cards = page.locator("article");
  const cardMetaSwitch = page
    .locator('[data-slot="studio-set-platform"]')
    .getByRole("button", { name: "Show Meta creative", exact: true });
  const reviewMetaSwitch = page
    .locator('[data-slot="studio-review-platform-switch"]')
    .getByRole("button", { name: "Show Meta creative", exact: true });
  return {
    cardCount: await cards.count(),
    metaCardSwitchVisible: await readVisible(cardMetaSwitch),
    metaCardLabelCount: await cards.getByText("Meta", { exact: true }).count(),
    reviewMetaSwitchVisible: await readVisible(reviewMetaSwitch),
  };
}

/** Reads the composer footer's platform summary without clicking Generate. */
export async function observeStudioComposerPlatformSummary(
  page: Page
): Promise<StudioComposerPlatformFact> {
  const summary = page.getByText(/^\d+ sets? · (?:Google|Google \+ Meta)$/).first();
  const summaryText = await summary.textContent().catch(() => null);
  const normalized = summaryText?.trim() ?? null;
  return {
    summary: normalized,
    googleOnlySummaryVisible: normalized?.endsWith("· Google") ?? false,
    metaSummaryVisible: normalized?.endsWith("· Google + Meta") ?? false,
  };
}

/** Reads the shared status stream exposed through the dashboard proxy. */
export async function readMetaAvailabilityStatus(
  page: Page,
  apiBaseUrl: string
): Promise<MetaAvailabilityStatusFact> {
  const response = await page.request.get(new URL("/api/v1/system/status", apiBaseUrl).href);
  const body = await response.json().catch(() => null) as {
    platforms?: { meta?: { available?: unknown } };
  } | null;
  return {
    responseStatus: response.status(),
    available: typeof body?.platforms?.meta?.available === "boolean"
      ? body.platforms.meta.available
      : null,
  };
}

/** Starts the selected Studio generation once and returns only transport facts. */
export async function generateStudioSet(page: Page): Promise<StudioGenerationFact> {
  const generate = page.getByRole("button", { name: /^Generate(?: \d+)? Sets?$/, exact: true });
  await expect(generate).toBeEnabled({ timeout: 30_000 });
  const planPromise = page.waitForResponse(
    (response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/creative/plans"),
    { timeout: 180_000 }
  ).catch(() => null);
  const setRequestPromise = page.waitForRequest(
    (request) => request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/v1/creative/sets"),
    { timeout: 300_000 }
  ).catch(() => null);
  const setPromise = page.waitForResponse(
    (response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/v1/creative/sets"),
    { timeout: 300_000 }
  ).catch(() => null);
  await generate.click();
  const plan = await planPromise;
  const planError = plan && !plan.ok()
    ? await plan.json().catch(() => null) as { code?: unknown; error?: { code?: unknown } } | null
    : null;
  const request = plan?.ok() ? await setRequestPromise : null;
  const response = request ? await setPromise : null;
  const body = await response?.json().catch(() => null) as {
    creativeSetId?: unknown;
    bundles?: { google?: unknown; meta?: unknown };
    imageJobIds?: unknown;
  } | null;
  return {
    clicked: true,
    requestObserved: request !== null,
    planResponseStatus: plan?.status() ?? null,
    planErrorCode: typeof planError?.code === "string" ? planError.code
      : typeof planError?.error?.code === "string" ? planError.error.code : null,
    responseStatus: response?.status() ?? null,
    creativeSetId: typeof body?.creativeSetId === "string" ? body.creativeSetId : null,
    googleBundleReturned: Boolean(body?.bundles?.google),
    metaBundleReturned: Boolean(body?.bundles?.meta),
    imageJobCount: Array.isArray(body?.imageJobIds) ? body.imageJobIds.length : 0,
  };
}

/** Selects one recommended Studio reference and returns the resulting selection state. */
export async function selectStudioReference(
  page: Page,
  slot: number
): Promise<StudioReferenceSelectionFact> {
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    throw new Error("Studio reference slot must be 1, 2, or 3");
  }
  const reference = page.getByRole("button", { name: `Select Reference ${slot}`, exact: true });
  await expect(reference).toBeVisible({ timeout: 45_000 });
  await reference.click();
  await expect(reference).toHaveAttribute("aria-pressed", "true");
  return {
    selected: (await reference.getAttribute("aria-pressed")) === "true",
    selectedCount: await page.locator('[data-slot="studio-picks"] button[aria-pressed="true"]').count(),
  };
}

/** Waits for the selected reference's visible media, separate from selection itself. */
export async function observeStudioReferenceMedia(page: Page): Promise<StudioReferenceMediaFact> {
  const images = page.locator('[data-slot="studio-picks"] button[aria-pressed="true"] img');
  const loaded = await expect.poll(async () =>
    images.first().evaluate((node) => (node as HTMLImageElement).naturalWidth > 0)
      .catch(() => false),
  { timeout: 30_000 }).toBe(true).then(() => true, () => false);
  return {
    selectedImageCount: await images.count(),
    selectedImageLoaded: loaded,
  };
}
