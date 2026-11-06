import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

import { accountTest as test } from "../../../src/account-fixtures";
import { UserApiClient } from "../../../src/clients/user-api";
import { parseRuntimeConfig } from "../../../src/config";
import {
  openCampaignList,
  openExistingCampaignDetail,
  observeCampaignProtectiveActions,
  openCampaignComposer,
  submitCampaignGoal,
  waitForCampaignDraft,
  observeCampaignType,
} from "../../../src/actions/campaign-actions";
import {
  openStudioLibrary,
  observeStudioLibraryControls,
  openStudioCreateSheet,
  readStudioProductBrief,
  confirmStudioProductBrief,
  prepareStudioReferenceUpload,
  uploadStudioReference,
  observeStudioGenerateGate,
  beginStudioSetGeneration,
  returnToStudioLibrary,
  observeStudioLibraryRuns,
} from "../../../src/actions/studio-actions";
import { selectStudioReference, observeStudioReferenceMedia } from "../../../src/actions/meta-availability-actions";
import { readWalletBalanceAndTransactions } from "../../../src/actions/wallet-actions";

const runtime = parseRuntimeConfig(process.env);
const runId = process.env.E2E_RUN_ID ?? "staging-action-reuse-20261009";

type ReuseEvent = {
  runId: string;
  caseId: string;
  intentId: string;
  intent: string;
  outcome: "hit" | "miss";
  source: "hot" | "index" | "playwright-explore";
  action?: string;
  reason?: "drift" | "precondition" | "not_found";
  lookupMs: number;
  executionMs: number;
};

function collector(caseId: string) {
  const events: ReuseEvent[] = [];
  return {
    events,
    async action<T>(intentId: string, intent: string, name: string,
      source: "hot" | "index", run: () => Promise<T>, verify: (fact: T) => void,
      missReason: "drift" | "precondition" = "drift"): Promise<T> {
      const started = performance.now();
      try {
        const fact = await run();
        verify(fact);
        events.push({ runId, caseId, intentId, intent, outcome: "hit", source,
          action: name, lookupMs: 0, executionMs: Math.round(performance.now() - started) });
        return fact;
      } catch (error) {
        events.push({ runId, caseId, intentId, intent, outcome: "miss",
          source: "playwright-explore", reason: missReason, lookupMs: 0,
          executionMs: Math.round(performance.now() - started) });
        throw error;
      }
    },
  };
}

async function attachEvents(testInfo: Parameters<Parameters<typeof test>[2]>[1], events: ReuseEvent[]) {
  await writeFile(testInfo.outputPath("action-reuse-events.json"), JSON.stringify(events, null, 2));
  await testInfo.attach("action-reuse-events", {
    body: JSON.stringify(events, null, 2), contentType: "application/json",
  });
}

async function attachFacts(testInfo: Parameters<Parameters<typeof test>[2]>[1], name: string, facts: unknown) {
  await writeFile(testInfo.outputPath(`${name}.json`), JSON.stringify(facts, null, 2));
  await testInfo.attach(name, { body: JSON.stringify(facts, null, 2), contentType: "application/json" });
}

test("S1 Studio Library retains existing completed ads", { tag: ["@case:reuse-s1", "@reuse"] },
  async ({ page }, testInfo) => {
    const log = collector("S1");
    try {
      await log.action("open-library", "open Studio ads library", "openStudioLibrary", "hot",
        () => openStudioLibrary(page), (fact) => expect(fact.createEntryVisible).toBe(true));
      await log.action("read-controls", "observe library search and state filter",
        "observeStudioLibraryControls", "index", () => observeStudioLibraryControls(page),
        (fact) => expect(fact).toEqual({ headingVisible: true, stateFilterVisible: true, searchVisible: true }));
      const ready = page.locator("article").filter({ has: page.getByRole("group", { name: "Landscape ad image ready" }) });
      expect(await ready.count(), "at least one existing completed ad is required").toBeGreaterThan(0);
      const name = (await ready.first().getByRole("heading").innerText()).trim();
      await page.reload();
      await expect(page.locator("article").getByRole("heading", { name, exact: true }).first()).toBeVisible();
      await attachFacts(testInfo, "studio-facts", { name, persisted: true });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("C1 existing Campaign opens from list with matching state", { tag: ["@case:reuse-c1", "@reuse"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const log = collector("C1");
    try {
      const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
      const list = await api.campaigns(100);
      expect(list.items.length, "an existing campaign is required").toBeGreaterThan(0);
      const candidate = list.items[0]!;
      await log.action("open-list", "open campaign list", "openCampaignList", "hot",
        () => openCampaignList(page), (fact) => expect(fact.url).toContain("/campaigns"));
      await log.action("open-detail", "open existing campaign detail", "openExistingCampaignDetail", "hot",
        () => openExistingCampaignDetail(page, candidate.id),
        (fact) => expect(fact.url).toContain(candidate.id));
      const actions = await log.action("read-actions", "observe allowed campaign actions",
        "observeCampaignProtectiveActions", "index",
        () => observeCampaignProtectiveActions(page), (fact) => expect(fact).toBeDefined());
      const persisted = await api.campaign(candidate.id);
      expect(persisted.status).toBe(candidate.status);
      await attachFacts(testInfo, "campaign-facts", { status: persisted.status, hasAllowedActions: !!actions,
        idSuffix: candidate.id.slice(-8) });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("W1 wallet balance is visible for the active organization", { tag: ["@case:reuse-w1", "@reuse"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const log = collector("W1");
    try {
      const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
      const me = await api.me();
      const wallet = await api.wallet();
      const display = await log.action("read-wallet", "read wallet balance", "readWalletBalanceAndTransactions", "hot",
        () => readWalletBalanceAndTransactions(page),
        (fact) => expect(fact.summaryText.length).toBeGreaterThan(0));
      const available = (wallet.availableBalanceCents / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      expect(display.summaryText).toContain(available);
      await attachFacts(testInfo, "wallet-facts", { availableBalanceCents: wallet.availableBalanceCents,
        activeOrgKnown: Boolean(me.primaryOrgId ?? (me.org as { id?: string } | undefined)?.id) });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("W2 existing wallet transaction is stable after re-entry", { tag: ["@case:reuse-w2", "@reuse"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const log = collector("W2");
    try {
      const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
      const transactions = await api.transactions();
      expect(transactions.transactions.length, "an existing transaction is required").toBeGreaterThan(0);
      const selected = transactions.transactions[0]!;
      const before = await log.action("read-ledger", "read wallet transaction ledger", "readWalletBalanceAndTransactions", "hot",
        () => readWalletBalanceAndTransactions(page),
        (fact) => expect(fact.transactionRows.length).toBeGreaterThan(0));
      await page.reload();
      const after = await api.transactions();
      expect(after.transactions.some((item) => item.createdAt === selected.createdAt &&
        item.amount === selected.amount && item.type === selected.type && item.status === selected.status)).toBe(true);
      await attachFacts(testInfo, "ledger-facts", { visibleRows: before.transactionRows.length,
        type: selected.type, status: selected.status, amount: selected.amount, stable: true });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("S2 uploaded reference becomes a selected, stored reference", { tag: ["@case:reuse-s2", "@reuse"] },
  async ({ page }, testInfo) => {
    const log = collector("S2");
    try {
      await log.action("open-library", "open ads library", "openStudioLibrary", "hot",
        () => openStudioLibrary(page), (fact) => expect(fact.createEntryVisible).toBe(true));
      await log.action("create-sheet", "open ad creation", "openStudioCreateSheet", "hot",
        () => openStudioCreateSheet(page), (fact) => expect(fact.title).toMatch(/Create Ads/i));
      await expect(page.getByRole("textbox", { name: "Key message" })).not.toHaveValue("", { timeout: 30_000 });
      await log.action("read-brief", "read product brief", "readStudioProductBrief", "hot",
        () => readStudioProductBrief(page), (fact) => expect(fact.text.length).toBeGreaterThan(0),
        "precondition");
      await log.action("confirm-brief", "confirm product brief", "confirmStudioProductBrief", "index",
        () => confirmStudioProductBrief(page), (fact) => expect(fact.locked).toBe(true));
      await log.action("upload-entry", "prepare reference file upload", "prepareStudioReferenceUpload", "index",
        () => prepareStudioReferenceUpload(page), (fact) => expect(fact.fileChooserAttached).toBe(true));
      const filePath = path.resolve("tests/fixtures/studio/sample-upload.png");
      const uploaded = await log.action("upload-reference", "upload test reference", "uploadStudioReference", "index",
        () => uploadStudioReference(page, filePath),
        (fact) => expect(fact).toMatchObject({ requestedFileName: "sample-upload.png", selected: true, stored: true }));
      // Ads composer (#1168): the upload takes the first free reference slot, arrives selected,
      // and the Generate button counts the picked references. Brief was just confirmed, so this is the only pick.
      expect(uploaded.pickedCount).toBe(1);
      expect(uploaded.generateEnabled).toBe(true);
      expect(uploaded.generateLabel).toBe("Generate 1 Set");
      await attachFacts(testInfo, "upload-facts", { uploaded: true, slot: uploaded.slot,
        selected: uploaded.selected, stored: uploaded.stored, generateLabel: uploaded.generateLabel,
        fileName: uploaded.requestedFileName });
      // Generate is not clicked, so no Creative Set is created. The import itself is stored in the
      // organization and has no delete entry in the UI.
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("S3 one Studio generation reaches an identifiable persisted set", { tag: ["@case:reuse-s3", "@reuse"] },
  async ({ page }, testInfo) => {
    const log = collector("S3");
    try {
      await log.action("open-library", "open ads library", "openStudioLibrary", "hot",
        () => openStudioLibrary(page), (fact) => expect(fact.createEntryVisible).toBe(true));
      const baseline = await observeStudioLibraryRuns(page);
      await log.action("create-sheet", "open ad creation", "openStudioCreateSheet", "hot",
        () => openStudioCreateSheet(page), (fact) => expect(fact.title).toMatch(/Create Ads/i));
      await expect(page.getByRole("textbox", { name: "Key message" })).not.toHaveValue("", { timeout: 30_000 });
      await log.action("confirm-brief", "confirm product brief", "confirmStudioProductBrief", "index",
        () => confirmStudioProductBrief(page), (fact) => expect(fact.locked).toBe(true));
      await log.action("select-reference", "select first Gallery reference", "selectStudioReference", "index",
        () => selectStudioReference(page, 1), (fact) => expect(fact.selected).toBe(true));
      const media = await observeStudioReferenceMedia(page);
      expect(media.selectedImageLoaded).toBe(true);
      expect((await observeStudioGenerateGate(page)).enabled).toBe(true);
      const started = await log.action("start-generation", "start one Creative Set generation",
        "beginStudioSetGeneration", "index", () => beginStudioSetGeneration(page),
        (fact) => expect(fact.setIds.length).toBeGreaterThan(0));
      const id = started.setIds[0]!;
      await log.action("return-library", "return to ads library", "returnToStudioLibrary", "index",
        () => returnToStudioLibrary(page), (fact) => expect(fact.url).toContain("/studio"));
      await expect.poll(async () => (await observeStudioLibraryRuns(page)).cardCount,
        { timeout: 3 * 60_000 }).toBeGreaterThan(baseline.cardCount);
      await attachFacts(testInfo, "generation-facts", { setIdSuffix: id.slice(-8),
        baselineCards: baseline.cardCount, currentCards: (await observeStudioLibraryRuns(page)).cardCount,
        terminalStateUnverified: true });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("C2 explicit Search goal produces one identifiable Draft", { tag: ["@case:reuse-c2", "@reuse"] },
  async ({ page }, testInfo) => {
    const log = collector("C2");
    try {
      await log.action("open-composer", "open campaign composer", "openCampaignComposer", "hot",
        () => openCampaignComposer(page), (fact) => expect(fact.composerVisible).toBe(true));
      await log.action("submit-goal", "submit Google Search objective", "submitCampaignGoal", "index",
        () => submitCampaignGoal(page,
          "Prepare one Google Search campaign draft for Final Round AI interview preparation in the United States. Total budget $50. Do not launch or submit for review."),
        () => expect(page.url()).toContain("/campaigns"));
      await log.action("await-draft", "wait for a campaign Draft", "waitForCampaignDraft", "index",
        () => waitForCampaignDraft(page), (fact) => expect(fact.readinessText.length).toBeGreaterThan(0));
      const type = await log.action("read-type", "observe selected campaign type", "observeCampaignType", "index",
        () => observeCampaignType(page), (fact) => expect(fact.selectedType).toMatch(/Search/i));
      const url = page.url();
      await page.reload();
      await expect(page).toHaveURL(/\/campaigns/);
      await attachFacts(testInfo, "draft-facts", { type: type.selectedType,
        urlPath: new URL(url).pathname, persistedAfterReload: true });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("S3 read-only reconcile the single submitted generation", { tag: ["@case:reuse-s3-reconcile", "@reconcile"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const after = Date.parse(process.env.S3_GENERATION_AFTER ?? "");
    expect(Number.isFinite(after), "S3_GENERATION_AFTER must bound the original submission").toBe(true);
    const log = collector("S3-reconcile");
    try {
      const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
      const me = await api.me() as { primaryOrgId?: string; org?: { id?: string } };
      const orgId = me.primaryOrgId ?? me.org?.id;
      expect(orgId).toBeTruthy();
      const readSets = async () => {
        const response = await fetch(`${runtime.apiUrl}/api/v1/creative/sets?limit=50`, {
          headers: { Authorization: `Bearer ${await getAccountJwt()}`, "X-Hellyeah-Org": orgId! },
        });
        expect(response.ok, `Creative Set read failed with ${response.status}`).toBe(true);
        return (await response.json()) as { sets: Array<{ creativeSetId: string; status: string; createdAt: string }> };
      };
      const firstRead = await readSets();
      await attachFacts(testInfo, "recent-generation-snapshot", {
        count: firstRead.sets.length,
        recent: firstRead.sets.slice(0, 8).map((set) => ({
          idSuffix: set.creativeSetId.slice(-8), status: set.status, createdAt: set.createdAt,
        })),
      });
      let matching: Array<{ creativeSetId: string; status: string; createdAt: string }> = [];
      await expect.poll(async () => {
        matching = (await readSets()).sets.filter((set) => Date.parse(set.createdAt) >= after);
        return matching.length;
      }, { timeout: 60_000 }).toBeGreaterThan(0);
      await log.action("read-library-after-submit", "read existing ads without resubmission",
        "openStudioLibrary", "hot", () => openStudioLibrary(page),
        (fact) => expect(fact.createEntryVisible).toBe(true));
      await expect.poll(async () => {
        matching = (await readSets()).sets.filter((set) => Date.parse(set.createdAt) >= after);
        return matching.length === 1 && ["complete", "partial", "failed"].includes(matching[0]!.status);
      }, { timeout: 5 * 60_000 }).toBe(true);
      await attachFacts(testInfo, "generation-reconciliation", {
        matchingCount: matching.length, status: matching[0]?.status,
        setIdSuffix: matching[0]?.creativeSetId.slice(-8), terminal: true,
      });
    } finally {
      await attachEvents(testInfo, log.events);
    }
  });

test("C2 read-only inspect candidate Drafts before dependent cases", { tag: ["@case:reuse-c2-reconcile", "@reconcile"] },
  async ({ page, getAccountJwt }, testInfo) => {
    const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
    const items = await api.campaigns(30);
    await page.goto("/campaigns/new");
    await attachFacts(testInfo, "draft-candidates", {
      currentUrlPath: new URL(page.url()).pathname,
      currentDraftSuffix: new URL(page.url()).searchParams.get("draft")?.slice(-8) ?? null,
      recent: items.items.slice(0, 15).map((item) => ({ idSuffix: item.id.slice(-8),
        name: item.name, status: item.status, createdAt: item.createdAt })),
    });
  });

test("prepare one uniquely named C3/C4 Draft fixture", { tag: ["@case:reuse-fixture", "@prep"] },
  async ({ getAccountJwt }, testInfo) => {
    const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
    const name = `QA Action Reuse ${runId}`;
    const created = await api.createDraft({
      budgetAmount: 50, campaignType: "search", keywords: ["AI interview preparation"],
      languages: ["English"], locations: ["United States"], name,
      objective: "Drive qualified interview-prep signups", platform: "google",
    });
    expect(created.draft.id).toBeTruthy();
    await writeFile(testInfo.outputPath("fixture-draft.json"), JSON.stringify({
      id: created.draft.id, name, createdAt: new Date().toISOString(), cleanup: "discardDraft",
    }));
  });

test("C5 read-only reconcile cancelled launch and wallet", { tag: ["@case:reuse-c5-reconcile", "@reconcile"] },
  async ({ getAccountJwt }, testInfo) => {
    const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken: getAccountJwt });
    const after = process.env.C5_LAUNCH_AFTER ?? "2026-10-09T11:50:00Z";
    const [list, wallet, reservations, transactions] = await Promise.all([
      api.campaigns(100), api.wallet(), api.reservations(), api.transactions(after),
    ]);
    const candidates = list.items.filter((item) => Date.parse(item.createdAt) >= Date.parse(after));
    const details = await Promise.all(candidates.map((item) => api.campaign(item.id)));
    await attachFacts(testInfo, "launch-cancel-reconciliation", {
      candidateCount: candidates.length,
      candidates: candidates.map((item, index) => ({
        idSuffix: item.id.slice(-8), name: item.name, status: details[index]?.status,
        activated: Boolean(details[index]?.activatedAt),
        refundStatus: details[index]?.refundStatus ?? null,
        refundAmountCents: details[index]?.refundAmountCents ?? null,
        reservedCents: details[index]?.reservedCents ?? null,
      })),
      availableBalanceCents: wallet.availableBalanceCents,
      reservationCount: reservations.reservations.length,
      recentTransactions: transactions.transactions.map((item) => ({
        type: item.type, amount: item.amount, status: item.status, createdAt: item.createdAt,
      })),
    });
    expect(candidates.length, "one newly launched Campaign should be attributable").toBe(1);
    expect(details[0]?.status).toBe("cancelled");
  });

test("S2 read-only inspect current upload controls", { tag: ["@case:reuse-s2-probe", "@reconcile"] },
  async ({ page }, testInfo) => {
    await openStudioLibrary(page);
    await openStudioCreateSheet(page);
    await expect(page.getByRole("textbox", { name: "Key message" })).not.toHaveValue("", { timeout: 30_000 });
    await confirmStudioProductBrief(page);
    const controls = await page.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll("button"))
        .filter((button) => /upload|choose file|shuffle/i.test([
          button.textContent, button.ariaLabel, button.title,
        ].join(" ")))
        .map((button) => ({ text: button.textContent?.trim().slice(0, 80),
          ariaLabel: button.ariaLabel, title: button.title,
          html: button.outerHTML.slice(0, 450) })),
      files: Array.from(document.querySelectorAll('input[type="file"]'))
        .map((input) => ({ html: input.outerHTML.slice(0, 450),
          parent: input.parentElement?.outerHTML.slice(0, 650) })),
    }));
    await attachFacts(testInfo, "upload-control-probe", controls);
  });

test("S3 read-only inspect current Ads list after generation", { tag: ["@case:reuse-s3-ads", "@reconcile"] },
  async ({ page }, testInfo) => {
    await openStudioLibrary(page);
    const cards = page.locator("article");
    await expect(cards.first()).toBeVisible();
    const snapshot = await cards.evaluateAll((nodes) => nodes.slice(0, 12).map((node) => ({
      title: node.querySelector("h2,h3")?.textContent?.trim() ?? null,
      text: node.textContent?.trim().slice(0, 180) ?? null,
      buttons: Array.from(node.querySelectorAll("button"))
        .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim())
        .filter(Boolean).slice(0, 6),
    })));
    await attachFacts(testInfo, "ads-after-generation", { cardCount: await cards.count(), recentCards: snapshot });
  });
