import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

// hellyeah-v2 #1168 (519354555, 2026-10-09) renamed Studio to Ads: the library
// PageHeader is the h2 "Ads", the back button reads "All Ads", the search field
// is "Search ads by name or copy". Older names stay for older deployments.
const getStudioHeading = (page: Page): Locator =>
  page.getByRole("heading", { name: /^(?:Ads|Studio|Ad Library)$/ }).first();

const getStudioBackToLibrary = (page: Page): Locator =>
  page.getByRole("button", { name: /^(?:All Ads|All Creative Sets|Ad Library)$/ });

const getStudioCreateEntry = (page: Page): Locator =>
  page.getByRole("button", { name: /^(?:New Creative Sets?|No creative sets yet|Create Ads)$/i });

const getStudioCreateTitle = (page: Page): Locator =>
  page.getByRole("heading", { name: /^(?:New Creative Sets?|Create Ads)$/i });

const getStudioGenerateButton = (page: Page): Locator =>
  page.getByRole("button", { name: /^Generate(?: (?:\d+ )?Sets?)?$/ });

const getStudioProductBrief = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Key message" });

const getStudioBriefBox = (page: Page): Locator =>
  page.locator('[data-slot="brief-box"]');

const getStudioBriefConfirm = (page: Page): Locator =>
  getStudioBriefBox(page).locator('[data-slot="brief-mark"]')
    .or(getStudioBriefBox(page).getByRole("button", { name: "Confirm", exact: true })).first();

const getStudioStateFilter = (page: Page): Locator =>
  page.getByRole("combobox", { name: "Filter Sets by State" });

const getStudioSearch = (page: Page): Locator =>
  page.getByLabel(/^Search (?:ads by name or copy|creative sets)$/);

// Since #1168 the brief's Confirm (data-slot brief-mark) is the step that used
// to be Continue To Style: confirming the context deals the reference (style)
// picks in the next sheet row.
const getContinueToStyleButton = (page: Page): Locator => getStudioBriefConfirm(page);

const getStudioReferencesRow = (page: Page): Locator =>
  page.locator('[data-slot="studio-row-references"]');

const getStudioReferenceCards = (page: Page): Locator =>
  getStudioReferencesRow(page).getByRole("button", { name: /^Select Reference \d+$/ });

const getStudioShuffleButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Shuffle", exact: true });

// composer.tsx: the references row's actions hold a sr-only
// <input type="file" accept="image/png,image/jpeg"> and the round "Upload"
// button (RoundAction aria-label) that clicks it. Upload is disabled until the
// brief is confirmed and a hand is dealt, while an upload is in flight, and
// when three references are already picked.
const getUploadReferenceButton = (page: Page): Locator =>
  getStudioReferencesRow(page).getByRole("button", { name: "Upload", exact: true });

const getStudioFileChooser = (page: Page): Locator =>
  getStudioReferencesRow(page).locator('input[type="file"]');

const getPickedReferenceCards = (page: Page): Locator =>
  getStudioReferenceCards(page).and(page.locator('[aria-pressed="true"]'));

// selection.tsx: an uploaded card's image alt is the file name (dealt cards
// wear "Reference N" or the catalog name).
const getUploadedReferenceCard = (page: Page, fileName: string): Locator =>
  getStudioReferenceCards(page).filter({ has: page.getByRole("img", { name: fileName, exact: true }) });

// @hellyeah/ui/sonner: a failed import is reported as toast.error(...).
const getStudioErrorToast = (page: Page): Locator =>
  page.locator('[data-sonner-toast][data-type="error"]');

const UPLOAD_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

export interface StudioLibraryFact {
  createEntryVisible: boolean;
  url: string;
}

export interface StudioCreateSheetFact {
  continueToStyleEnabled: boolean;
  continueToStyleVisible: boolean;
  title: string;
}

export interface StudioVideoAdBriefFact {
  title: string;
  briefText: string;
  confirmEnabled: boolean;
}

export interface StudioStyleFact {
  briefLocked: boolean;
  referencesActive: boolean;
  referenceCount: number;
  shuffleEnabled: boolean;
  generateEnabled: boolean;
}

export interface StudioShuffleFact {
  referenceCount: number;
  /** Whether at least one dealt reference image changed. */
  changed: boolean;
}

export interface StudioUploadEntryFact {
  uploadEnabled: boolean;
  fileChooserAttached: boolean;
  /** The file input's accept list, e.g. "image/png,image/jpeg". */
  accept: string | null;
  /** References already picked (an upload needs fewer than three). */
  pickedCount: number;
}

export interface StudioImageFact {
  requestedFileName: string;
  /** 1-based slot the upload landed in ("Select Reference N"). */
  slot: number;
  /** The uploaded card is picked (aria-pressed). */
  selected: boolean;
  /** The import finished: not busy and showing the stored image, not the blob: preview. */
  stored: boolean;
  pickedCount: number;
  generateEnabled: boolean;
  generateLabel: string;
}

export interface StudioProductBriefFact {
  text: string;
  locked: boolean;
  confirmVisible: boolean;
  confirmEnabled: boolean;
  limitWarning: string | null;
}

export async function readStudioProductBrief(page: Page): Promise<StudioProductBriefFact> {
  const brief = getStudioProductBrief(page);
  const box = getStudioBriefBox(page);
  await expect(brief).toBeVisible();
  const confirm = getStudioBriefConfirm(page);
  const confirmVisible = await confirm.isVisible();
  const warning = box.getByRole("alert");
  return {
    text: await brief.inputValue(),
    locked: (await box.getAttribute("data-state")) === "locked",
    confirmVisible,
    confirmEnabled: confirmVisible && await confirm.isEnabled(),
    limitWarning: await warning.isVisible() ? await warning.innerText() : null,
  };
}

export async function setStudioProductBrief(
  page: Page,
  text: string
): Promise<StudioProductBriefFact> {
  const box = getStudioBriefBox(page);
  await expect(box).toHaveAttribute("data-state", "open");
  const brief = getStudioProductBrief(page);
  await brief.fill(text);
  await expect(brief).toHaveValue(text);
  return readStudioProductBrief(page);
}

export async function confirmStudioProductBrief(page: Page): Promise<StudioProductBriefFact> {
  const confirm = getStudioBriefConfirm(page);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(getStudioBriefBox(page)).toHaveAttribute("data-state", "locked");
  return readStudioProductBrief(page);
}

export async function reopenStudioProductBrief(page: Page): Promise<StudioProductBriefFact> {
  const box = getStudioBriefBox(page);
  await expect(box).toHaveAttribute("data-state", "locked");
  await getStudioProductBrief(page).click();
  await expect(box).toHaveAttribute("data-state", "open");
  return readStudioProductBrief(page);
}

export const openStudioLibrary = async (page: Page): Promise<StudioLibraryFact> => {
  await goToAppPath(page, "/studio");
  await expect(getStudioHeading(page)).toBeVisible({ timeout: 45_000 });
  await expect(getStudioCreateEntry(page)).toBeVisible({ timeout: 45_000 });
  return {
    createEntryVisible: await getStudioCreateEntry(page).isVisible(),
    url: page.url(),
  };
};

export const openStudioCreateSheet = async (
  page: Page
): Promise<StudioCreateSheetFact> => {
  const entry = getStudioCreateEntry(page);
  await expect(entry).toBeVisible({ timeout: 45_000 });
  await entry.click();
  const imageAds = page.getByRole("menuitem", { name: "Image ads" });
  if (await imageAds.isVisible()) await imageAds.click();
  await expect(getStudioCreateTitle(page)).toBeVisible({ timeout: 30_000 });
  const continueButton = getContinueToStyleButton(page);
  const continueToStyleVisible = await continueButton.isVisible().catch(() => false);
  return {
    continueToStyleEnabled: continueToStyleVisible && await continueButton.isEnabled(),
    continueToStyleVisible,
    title: (await getStudioCreateTitle(page).innerText()).trim(),
  };
};

export const openStudioVideoAdBrief = async (page: Page): Promise<StudioVideoAdBriefFact> => {
  const entry = getStudioCreateEntry(page);
  await expect(entry).toBeVisible({ timeout: 45_000 });
  await entry.click();
  const videoAd = page.getByRole("menuitem", { name: "Video ad" });
  await expect(videoAd).toBeVisible();
  await videoAd.click();
  const sheet = page.locator('[data-slot="studio-video-ad"]');
  await expect(sheet).toBeVisible();
  const heading = sheet.getByRole("heading", { name: "Create Video Ad" });
  const brief = sheet.getByRole("textbox", { name: "Key message" });
  await expect(heading).toBeVisible();
  await expect(brief).toBeVisible();
  const confirm = sheet.getByRole("button", { name: "Confirm" });
  return {
    title: (await heading.innerText()).trim(),
    briefText: await brief.inputValue(),
    confirmEnabled: await confirm.isEnabled(),
  };
};

export async function openStudioSetReview(page: Page): Promise<{ reviewVisible: boolean }> {
  const googleSet = page.locator("article").getByRole("button", {
    name: /^View .+ for Google$/,
  }).first();
  await expect(googleSet).toBeVisible({ timeout: 45_000 });
  await googleSet.press("Enter");
  const workspace = page.locator('[data-slot="studio-workspace"]');
  await expect(workspace).toBeVisible({ timeout: 30_000 });
  await expect(workspace.locator('[data-slot="studio-review-images"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-slot="studio-set-grid"]')).toHaveCount(0, { timeout: 30_000 });
  return { reviewVisible: await workspace.isVisible() };
}

// Confirm the context, then wait until the reference (style) picks are dealt.
// Undone by reopenStudioProductBrief, which reopens the brief and blanks the picks.
export const continueStudioToStyle = async (page: Page): Promise<StudioStyleFact> => {
  const confirm = getContinueToStyleButton(page);
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
  await expect(getStudioBriefBox(page)).toHaveAttribute("data-state", "locked", { timeout: 30_000 });
  const references = getStudioReferencesRow(page);
  await expect(references).toHaveAttribute("data-state", "active", { timeout: 30_000 });
  await expect(getStudioReferenceCards(page).first()).toBeVisible({ timeout: 60_000 });
  return {
    briefLocked: (await getStudioBriefBox(page).getAttribute("data-state")) === "locked",
    referencesActive: (await references.getAttribute("data-state")) === "active",
    referenceCount: await getStudioReferenceCards(page).count(),
    shuffleEnabled: await getStudioShuffleButton(page).isEnabled(),
    generateEnabled: await getStudioGenerateButton(page).isEnabled(),
  };
};

const readReferenceImages = (page: Page): Promise<string[]> =>
  getStudioReferenceCards(page).evaluateAll((cards) =>
    cards.map((card) => card.querySelector("img")?.getAttribute("src") ?? ""));

// Deal a new hand of unpicked references. Picks are kept; nothing is saved.
export async function shuffleStudioReferences(page: Page): Promise<StudioShuffleFact> {
  const shuffle = getStudioShuffleButton(page);
  await expect(shuffle).toBeEnabled({ timeout: 30_000 });
  await expect(getStudioReferenceCards(page).first()).toBeVisible({ timeout: 30_000 });
  const before = await readReferenceImages(page);
  await shuffle.click();
  let changed = true;
  try {
    await expect.poll(() => readReferenceImages(page), { timeout: 30_000 }).not.toEqual(before);
  } catch {
    changed = false;
  }
  await expect(shuffle).toBeEnabled({ timeout: 30_000 });
  return { referenceCount: await getStudioReferenceCards(page).count(), changed };
}

// Read-only: the references row is live and its Upload entry and file input
// are ready. Upload waits for the dealt hand, so this waits too.
export const prepareStudioReferenceUpload = async (
  page: Page
): Promise<StudioUploadEntryFact> => {
  await expect(getStudioReferencesRow(page)).toHaveAttribute("data-state", "active", { timeout: 30_000 });
  const upload = getUploadReferenceButton(page);
  await expect(upload).toBeVisible({ timeout: 30_000 });
  await expect(getStudioFileChooser(page)).toBeAttached({ timeout: 15_000 });
  await expect(upload).toBeEnabled({ timeout: 60_000 });
  return {
    uploadEnabled: await upload.isEnabled(),
    fileChooserAttached: (await getStudioFileChooser(page).count()) === 1,
    accept: await getStudioFileChooser(page).getAttribute("accept"),
    pickedCount: await getPickedReferenceCards(page).count(),
  };
};

// Uploads one image through the row's file input and waits until the import
// lands: the card named after the file is picked, no longer busy, and shows
// the stored image. The file is sent as bytes so it works on a remote browser.
// Writes to the backend (importCreativeImage creates a creative job).
export const uploadStudioReference = async (
  page: Page,
  filePath: string
): Promise<StudioImageFact> => {
  const name = path.basename(filePath);
  const mimeType = UPLOAD_MIME[path.extname(name).toLowerCase()];
  if (!mimeType) throw new Error(`Studio references accept PNG or JPEG only, got ${name}`);
  const buffer = await readFile(filePath);
  await expect(getUploadReferenceButton(page)).toBeEnabled({ timeout: 60_000 });
  const toastsBefore = await getStudioErrorToast(page).count();
  await getStudioFileChooser(page).setInputFiles({ name, mimeType, buffer });
  const card = getUploadedReferenceCard(page, name);
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  const settled = async () => {
    if ((await getStudioErrorToast(page).count()) > toastsBefore) return "failed";
    if ((await card.count()) === 0) return "failed";
    const busy = await card.getAttribute("aria-busy");
    const src = (await card.locator("img").first().getAttribute("src")) ?? "";
    return busy !== "true" && !src.startsWith("blob:") ? "stored" : "pending";
  };
  await expect.poll(settled, { timeout: 90_000 }).not.toBe("pending");
  if ((await settled()) === "failed") {
    const toast = getStudioErrorToast(page).last();
    const message = (await toast.count()) ? (await toast.innerText()).trim() : "uploaded card disappeared";
    throw new Error(`Studio reference upload failed: ${message}`);
  }
  const generate = getStudioGenerateButton(page);
  const slot = Number(/(\d+)$/.exec((await card.getAttribute("aria-label")) ?? "")?.[1] ?? 0);
  return {
    requestedFileName: name,
    slot,
    selected: (await card.getAttribute("aria-pressed")) === "true",
    stored: true,
    pickedCount: await getPickedReferenceCards(page).count(),
    generateEnabled: await generate.isEnabled(),
    generateLabel: (await generate.innerText()).trim(),
  };
};

export async function observeStudioLibraryControls(page: Page): Promise<{
  headingVisible: boolean;
  stateFilterVisible: boolean;
  searchVisible: boolean;
}> {
  return {
    headingVisible: await getStudioHeading(page).isVisible(),
    stateFilterVisible: await getStudioStateFilter(page).isVisible(),
    searchVisible: await getStudioSearch(page).first().isVisible(),
  };
}

export async function observeStudioCreateControls(page: Page): Promise<{
  titleVisible: boolean;
  continueEnabled: boolean;
}> {
  return {
    titleVisible: await getStudioCreateTitle(page).isVisible(),
    continueEnabled: await getContinueToStyleButton(page).isEnabled(),
  };
}

export async function observeStudioGenerateGate(page: Page): Promise<{ enabled: boolean }> {
  return { enabled: await getStudioGenerateButton(page).isEnabled() };
}

export interface StudioGenerationStartFact {
  started: boolean;
  setIds: string[];
}

// One Generate press only. A missing response is unknown; callers must read
// the persisted submission before deciding whether a retry is safe.
export async function beginStudioSetGeneration(page: Page): Promise<StudioGenerationStartFact> {
  const generate = getStudioGenerateButton(page);
  await expect(generate).toBeEnabled({ timeout: 30_000 });
  await generate.click();
  const readSetIds = () => page.evaluate(() => {
    const ids: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const value = localStorage.getItem(localStorage.key(index) ?? "");
      if (!value) continue;
      try {
        const draft = JSON.parse(value) as { submission?: { items?: Array<{ id?: unknown }> } };
        for (const item of draft.submission?.items ?? []) {
          if (typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id)) ids.push(item.id);
        }
      } catch {
        // Other apps or Clerk may have unrelated storage values.
      }
    }
    return [...new Set(ids)];
  });
  await expect.poll(readSetIds, { timeout: 10_000 }).not.toEqual([]);
  return { started: true, setIds: await readSetIds() };
}

export async function returnToStudioLibrary(page: Page): Promise<{ url: string }> {
  await getStudioBackToLibrary(page).click();
  await expect(getStudioHeading(page)).toBeVisible({ timeout: 30_000 });
  await expect(getStudioCreateEntry(page)).toBeVisible({ timeout: 30_000 });
  return { url: page.url() };
}

export async function observeStudioLibraryRuns(page: Page): Promise<{
  cardCount: number;
  generatingCardCount: number;
}> {
  const grid = page.locator('[data-slot="studio-set-grid"]');
  await expect(grid).toBeVisible({ timeout: 30_000 });
  const cards = grid.locator("article");
  return {
    cardCount: await cards.count(),
    generatingCardCount: await cards.filter({
      // card.tsx labels each image group "<alt> generating", e.g. "Square ad image generating".
      has: page.getByRole("group", { name: /(?:creative|ad image) generating$/i }),
    }).count(),
  };
}
