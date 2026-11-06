import { expect, type Page } from "@playwright/test";

type CopyPlatform = "google" | "meta";
type CopyGroup = "headlines" | "descriptions" | "longHeadlines";

// upload.tsx has no data-slot/data-testid; the component's own test suite
// (upload-interaction.test.ts) selects by aria-label, so these Actions do too.
// The label text flips from "Upload ... image" to "Replace ... image" once a
// file is already staged in that slot (upload.tsx renders a second, visible
// "Replace image" input instead of the empty-state one) -- match either so a
// re-upload onto an already-filled slot still resolves.
export async function uploadCreativeImage(
  page: Page,
  slot: "landscape" | "portrait" | "square",
  filePath: string
): Promise<{ slot: string }> {
  const input = page.getByLabel(new RegExp(`^(?:Upload|Replace) ${slot} image$`, "i"));
  await input.setInputFiles(filePath);
  return { slot };
}

export async function readCreativeUploadError(page: Page): Promise<{ error: string }> {
  const alert = page.getByRole("alert");
  const error = (await alert.isVisible().catch(() => false)) ? await alert.innerText() : "";
  return { error };
}

// Commit exactly once. Response body is { creativeSetId } on 201; a 400/409
// is a real refusal (invalid images/crop, or an upload conflict), not a
// transient failure -- inspect the error banner before retrying.
export async function saveCreativeUploadOnce(page: Page): Promise<{
  responseStatus: number | null;
  creativeSetId: string | null;
}> {
  const button = page.getByRole("button", { name: /^Save images for /i });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith("/api/v1/creative/sets/imports"),
  { timeout: 30_000 }).catch(() => null);
  await button.click();
  const response = await responsePromise;
  const status = response?.status() ?? null;
  let creativeSetId: string | null = null;
  if (status === 201) {
    const body = await response?.json().catch(() => null);
    creativeSetId = body?.creativeSetId ?? null;
  }
  return { responseStatus: status, creativeSetId };
}

// Headline/description/long-headline textareas have deterministic ids:
// `${platform}-${group}-${index}` (upload-review.tsx). No stable aria-label
// exists because the visible label text embeds a live character count.
export async function fillCreativeCopyField(
  page: Page,
  platform: CopyPlatform,
  group: CopyGroup,
  index: number,
  text: string
): Promise<{ value: string }> {
  const field = page.locator(`#${platform}-${group}-${index}`);
  await field.fill(text);
  return { value: text };
}

// Reads the app's own live counter ("Google Headline 1 · 12/30") so the
// assertion follows the app's real counting rule (Google counts full-width
// characters as 2 via googleAdsTextLength; Meta counts plain .length) instead
// of reimplementing it.
export async function readCreativeCopyCounter(
  page: Page,
  platform: CopyPlatform,
  group: CopyGroup,
  index: number
): Promise<{ count: number | null; max: number | null; label: string }> {
  const field = page.locator(`#${platform}-${group}-${index}`);
  const label = await field.locator("xpath=ancestor::label[1]/span").innerText();
  const match = /(\d+)\/(\d+)\s*$/.exec(label);
  return {
    count: match ? Number(match[1]) : null,
    max: match ? Number(match[2]) : null,
    label: label.trim(),
  };
}

export async function readCreativeCopyLimitBanner(page: Page): Promise<{ bannerText: string }> {
  const banners = page.getByRole("alert").filter({ hasText: /Shorten (Google|Meta)/ });
  const bannerText = (await banners.count()) > 0 ? await banners.first().innerText() : "";
  return { bannerText };
}

// Commit exactly once. Disabled (button stays "Save ad set for ...") while
// copyOverLimit is true -- callers must clear readCreativeCopyLimitBanner
// first rather than retrying a disabled click.
export async function saveCreativeCopyOnce(page: Page): Promise<{
  responseStatus: number | null;
  saved: boolean;
}> {
  const button = page.getByRole("button", { name: /^Save ad set for /i });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    /\/api\/v1\/creative\/sets\/[^/]+\/approve$/.test(new URL(response.url()).pathname),
  { timeout: 30_000 }).catch(() => null);
  await button.click();
  const response = await responsePromise;
  const status = response?.status() ?? null;
  return { responseStatus: status, saved: status !== null && status < 400 };
}

export async function retryCreativeCopyOnce(page: Page): Promise<{ responseStatus: number | null }> {
  const button = page.getByRole("button", { name: "Retry copy" });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    /\/api\/v1\/creative\/sets\/[^/]+\/retry$/.test(new URL(response.url()).pathname),
  { timeout: 30_000 }).catch(() => null);
  await button.click();
  const response = await responsePromise;
  return { responseStatus: response?.status() ?? null };
}

// Shared by both platforms: SearchPicker (campaignType="search", Google
// Search) and PmaxPicker (campaignType="pmax", Google PMax and Meta via
// strategy.platform) both render SetCard from the same SetLibrary, so this
// one Action covers "is an uploaded asset selectable" for either platform --
// there is no separate Meta-specific picker to target.
export async function selectCreativeSetInLibrary(
  page: Page,
  title: string,
  platformLabel: "Google" | "Meta"
): Promise<{ selected: boolean }> {
  const card = page.getByRole("button", { name: `Select ${title} for ${platformLabel}` });
  await expect(card).toBeVisible();
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  return { selected: true };
}

// Confirms the pick inside the picker dialog. This only closes the picker and
// stages the choice on the campaign launch draft -- it does not itself call
// an API, so there is no network wait here. Reversible: reopen the picker and
// select a different set before the campaign itself is launched.
export async function confirmCreativeSetSelection(page: Page): Promise<{ confirmed: boolean }> {
  const button = page.getByRole("button", { name: "Use Ad" });
  await button.click();
  await expect(button).toBeHidden({ timeout: 10_000 });
  return { confirmed: true };
}

export async function openCreativeSetActionsMenu(page: Page): Promise<{ menuVisible: boolean }> {
  await page.getByRole("button", { name: "Ad Actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return { menuVisible: true };
}

// Returns which destructive action is offered without committing it: "Delete
// Ad" once generation is complete, "Cancel Generation" while still running.
export async function openCreativeSetDeleteConfirmation(page: Page): Promise<{
  dialogTitle: string;
  isGenerating: boolean;
}> {
  const menu = page.getByRole("menu");
  await menu.getByRole("menuitem", { name: /^(?:Delete Ad|Cancel Generation)$/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const dialogTitle = (await dialog.innerText()).split("\n")[0] ?? "";
  return { dialogTitle, isGenerating: dialogTitle.includes("Cancel") };
}

// Commit exactly once. Irreversible per the dialog's own copy ("This action
// can't be undone") -- do not call without a prior
// openCreativeSetDeleteConfirmation in the same test.
export async function deleteCreativeSetOnce(page: Page): Promise<{
  responseStatus: number | null;
  deleted: boolean;
}> {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    /\/api\/v1\/creative\/sets\/[^/]+$/.test(new URL(response.url()).pathname),
  { timeout: 30_000 }).catch(() => null);
  await dialog.getByRole("button", { name: /^(?:Delete Ad|Cancel Generation|Deleting…|Cancelling…)$/ }).click();
  const response = await responsePromise;
  const status = response?.status() ?? null;
  return { responseStatus: status, deleted: status !== null && status < 400 };
}

type CreativeSetDetailStatus = "queued" | "processing" | "complete" | "partial" | "failed";

interface CreativeSetPollOutcome {
  creativeSetId: string;
  finalStatus: CreativeSetDetailStatus | "unknown";
  elapsedMs: number;
  timedOut: boolean;
}

// Reads the same session's own API (page.request shares cookies with the
// browser context) rather than scraping the library grid, because terminal
// status (queued/processing/complete/partial/failed) is only exposed in full
// on GET /sets/{id}; the grid only distinguishes "generating" vs not.
// Pure polling read, no mutation -- rollback: read.
export async function pollCreativeSetGenerationOutcome(
  page: Page,
  creativeSetId: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<CreativeSetPollOutcome> {
  const timeoutMs = options?.timeoutMs ?? 20 * 60 * 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 5_000;
  const startedAt = Date.now();
  let finalStatus: CreativeSetDetailStatus | "unknown" = "unknown";
  let timedOut = true;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await page.request.get(`/api/proxy/api/v1/creative/sets/${creativeSetId}`);
    if (response.ok()) {
      const body = (await response.json()) as { status?: CreativeSetDetailStatus };
      if (body.status === "complete" || body.status === "partial" || body.status === "failed") {
        finalStatus = body.status;
        timedOut = false;
        break;
      }
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  return { creativeSetId, finalStatus, elapsedMs: Date.now() - startedAt, timedOut };
}

interface CreativeGenerationSuccessRateFact {
  total: number;
  complete: number;
  partial: number;
  failed: number;
  timedOut: number;
  successRate: number;
  outcomes: CreativeSetPollOutcome[];
}

// Tabulates N generations without judging logo presence/absence -- QA-1185's
// corrected intent is success rate and elapsed time only, per the domain
// note in QA-Knowledge/domains/campaign.md. "Success" here counts complete
// and partial as non-failure; callers that want a stricter reading can
// recompute from `outcomes` (e.g. complete-only / total).
// timeoutMs is NOT defaulted to the ticket's stated "10 minutes": the real
// backend's own generate-job staleness window is 20 minutes
// (CREATIVE_JOB_STALE_AFTER_MS); pass timeoutMs explicitly once the 10-vs-20
// minute question is resolved with the user/PM instead of hard-coding either.
export async function measureCreativeGenerationSuccessRate(
  page: Page,
  creativeSetIds: string[],
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<CreativeGenerationSuccessRateFact> {
  const outcomes: CreativeSetPollOutcome[] = [];
  for (const id of creativeSetIds) {
    outcomes.push(await pollCreativeSetGenerationOutcome(page, id, options));
  }
  const total = outcomes.length;
  const complete = outcomes.filter((o) => o.finalStatus === "complete").length;
  const partial = outcomes.filter((o) => o.finalStatus === "partial").length;
  const failed = outcomes.filter((o) => o.finalStatus === "failed").length;
  const timedOut = outcomes.filter((o) => o.timedOut).length;
  return {
    total,
    complete,
    partial,
    failed,
    timedOut,
    successRate: total === 0 ? 0 : (complete + partial) / total,
    outcomes,
  };
}
