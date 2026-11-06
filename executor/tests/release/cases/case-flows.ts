import type { Page, TestInfo } from "@playwright/test";
import type { PlayWrightAiFixtureType } from "@midscene/web/playwright";

import { pollApi } from "../../../src/tools/api-poll";
import { assertVisualCheckpoint, recordCheckpoint } from "../../../src/tools/checkpoints";
import { ClerkTestClient } from "../../../src/clients/clerk";
import { E2eControlClient } from "../../../src/clients/e2e-control";
import { UserApiClient, UserApiRequestError } from "../../../src/clients/user-api";
import type { RuntimeConfig } from "../../../src/config";
import { classifyConsistency } from "../../../src/tools/consistency";
import { buildTestEmail } from "../../../src/tools/identity";
import { attachApiEvidence } from "../../../src/report/evidence";
import { StageTracker } from "../../../src/tools/stage-tracker";
import {
  continueOrganizationSetup,
  inspectOrganizationSetupPrompt,
  inspectSignInNavigation,
  openSignInForm,
  openSignUpForm,
  prepareSignUpVerificationCode,
  submitDeferredSignUpPassword,
  submitSignInIdentifier,
  submitSignInPassword,
  submitSignInSecondFactor,
  submitSignUpCredentials,
  submitSignUpVerificationCode,
} from "../../../src/actions/auth-actions";
import {
  closeCampaignCreativePicker,
  confirmCampaignCreativeImport,
  observeCampaignCreativeCards,
  observeCampaignKeywords,
  observeCampaignLaunchConfirmation,
  observeCampaignLaunchReadiness,
  observeCampaignPendingReview,
  observeCampaignType,
  openCampaignComposer,
  openCampaignCreativePicker,
  openCampaignDraft,
  openCampaignList,
  selectCampaignGoogleSearchCreative,
  setCampaignBudget,
  setCampaignDeliveryDays,
  submitCampaignGoal,
  submitCampaignLaunch,
  waitForCampaignDraft,
} from "../../../src/actions/campaign-actions";
import { teardownCampaign } from "../../../src/cleanup/campaign-teardown";
import { setupClerkTestMode } from "../../../src/session/clerk-session";
import {
  chooseOnboardingDailyBudget,
  chooseOnboardingObjective,
  chooseOnboardingRegion,
  confirmOnboardingBrand,
  openForcedOnboarding,
  openOnboardingCampaign,
  observeSelectedOnboardingAdStyles,
  resetOnboardingDraft,
  selectNextOnboardingAdStyle,
  skipOnboardingInvite,
  submitBrandResearch,
  submitOnboardingCreativeGeneration,
  submitOnboardingQuestions,
  waitForOnboardingBrandReview,
  waitForOnboardingEntry,
} from "../../../src/actions/onboarding-actions";
import {
  openWalletTopUp,
  prepareWalletCardPayment,
  readWalletBalanceAndTransactions,
  startWalletCheckout,
  submitWalletPayment,
} from "../../../src/actions/wallet-actions";

interface CaseContext {
  aiAssert: PlayWrightAiFixtureType["aiAssert"];
  page: Page;
  recordToReport: PlayWrightAiFixtureType["recordToReport"];
  runtime: RuntimeConfig;
  stages: StageTracker;
  testInfo: TestInfo;
}

const controlClient = (runtime: RuntimeConfig) =>
  new E2eControlClient({
    baseUrl: runtime.controlUrl,
    token: runtime.controlToken,
  });

const createScope = async (
  context: CaseContext,
  email: string,
  runId: string
) => {
  const control = controlClient(context.runtime);
  const scope = await context.stages.run(
    "scope-create",
    () =>
      control.createScope({
        commitSha: process.env.E2E_COMMIT_SHA ?? "local000",
        email,
        release: process.env.E2E_RELEASE ?? "local",
        runId,
      }),
    "environment"
  );
  return { control, scopeId: scope.scopeId };
};

const cleanupScope = async (
  context: CaseContext,
  control: E2eControlClient,
  scopeId: string
) => {
  await context.stages.run("account-cleanup", async () => {
    const result = await control.cleanup(scopeId);
    await attachApiEvidence(context.testInfo, "account-cleanup", {
      status: result.status,
    });
    if (result.status !== "cleaned") {
      throw new Error(`Cleanup requires manual review: ${result.status}`);
    }
  }, "teardown");
};

const completeForcedOnboarding = async (
  context: CaseContext,
  api: UserApiClient,
  prefix = ""
): Promise<string> => {
  const { aiAssert, page, stages, testInfo } = context;
  const name = (stage: string) => `${prefix}${stage}`;
  const entry = await stages.run(name("entry-open"), () => openForcedOnboarding(page));
  if (entry.resumable) {
    await stages.run(name("entry-reset"), () => resetOnboardingDraft(page));
  } else {
    await stages.run(name("entry-ready"), () => waitForOnboardingEntry(page));
  }
  const previousResearch = await stages.run(name("brand-research-baseline"), () =>
    api.onboardingLatest(), "assertion"
  );
  const research = await stages.run(name("brand-research-submit"), () =>
    submitBrandResearch(page, "finalroundai.com")
  );
  let researchRunId = research.runId;
  if (!research.responseStatus) {
    testInfo.annotations.push({
      type: "action_unknown",
      description: "Brand research was clicked once; checking the latest run before any further action.",
    });
    try {
      const reconciled = await stages.run(name("brand-research-reconcile"), () => pollApi({
        read: () => api.onboardingLatest(),
        isComplete: (latest) => Boolean(
          latest && latest.runId !== previousResearch?.runId &&
          latest.draft?.domain === "finalroundai.com"
        ),
        timeoutMs: 30_000,
      }), "assertion");
      researchRunId = reconciled.value?.runId ?? null;
      await attachApiEvidence(testInfo, name("brand-research-recovered"), {
        runIdCaptured: Boolean(researchRunId),
        status: reconciled.value?.status,
      });
    } catch {
      throw new Error("Brand research outcome is unknown; latest-run read could not attribute the attempt. Do not resubmit.");
    }
  }
  if (!researchRunId || (research.responseStatus && research.responseStatus >= 300)) {
    throw new Error(`Brand research submission is unconfirmed (${research.responseStatus ?? "no response"})`);
  }
  let researchApiError: unknown;
  let researchUiError: unknown;
  try {
    await stages.run(name("brand-research-api"), () =>
      pollApi({
        describeFailure: (snapshot) =>
          ["failed", "superseded"].includes(String(snapshot.status))
            ? `Research entered ${String(snapshot.status)}`
            : null,
        isComplete: (snapshot) =>
          ["complete", "confirmed"].includes(String(snapshot.status)),
        onEvidence: (evidence) =>
          attachApiEvidence(testInfo, name("brand-research-poll"), evidence),
        read: () => api.onboardingResearch(researchRunId),
        timeoutMs: 5 * 60_000,
      }), "assertion");
  } catch (error) {
    researchApiError = error;
  }
  try {
    const review = await stages.run(name("brand-research-ui"), () =>
      waitForOnboardingBrandReview(page), "assertion");
    if (review.state !== "ready") throw new Error(`Brand research UI is ${review.state}`);
  } catch (error) {
    researchUiError = error;
  }
  const researchConsistency = classifyConsistency(
    Boolean(researchApiError),
    Boolean(researchUiError)
  );
  await attachApiEvidence(testInfo, name("brand-research-consistency"), {
    result: researchConsistency,
  });
  await stages.run(name("brand-research-consistency"), async () => {
    if (researchConsistency !== "CONSISTENT_PASS") {
      throw new Error(researchConsistency);
    }
  }, "assertion");
  await stages.runAdvisory(name("brand-visual"), () =>
    assertVisualCheckpoint(
      "The brand review is complete for Final Round AI, with readable company, logo, color, and theme information and no blocking error state.",
      aiAssert
    ));
  await stages.run(name("brand-confirm"), () => confirmOnboardingBrand(page));
  const choices = [
    ["campaign-region", () => chooseOnboardingRegion(page, "US")],
    ["campaign-objective", () => chooseOnboardingObjective(page, "Signups")],
    ["campaign-budget", () => chooseOnboardingDailyBudget(page, "$20 / day")],
  ] as const;
  for (const [stage, choose] of choices) {
    const fact = await stages.run(name(stage), choose);
    if (!fact.selected) throw new Error(`${fact.label} was not selected`);
  }
  await stages.run(name("campaign-questions-submit"), () =>
    submitOnboardingQuestions(page)
  );
  let styles = await stages.run(name("style-observe"), () =>
    observeSelectedOnboardingAdStyles(page)
  );
  if (styles.selectedCount > 3) throw new Error("More than three references are already selected");
  while (styles.selectedCount < 3) {
    const previous = styles.selectedCount;
    styles = await stages.run(name(`style-select-${previous + 1}`), () =>
      selectNextOnboardingAdStyle(page)
    );
    if (styles.selectedCount !== previous + 1) {
      throw new Error("Selecting a style did not add exactly one reference");
    }
  }
  const generation = await stages.run(name("creative-generation-submit"), () =>
    submitOnboardingCreativeGeneration(page)
  );
  await attachApiEvidence(testInfo, name("creative-generation-submit"), generation);
  await stages.run(name("creative-generation-wait"), () => openOnboardingCampaign(page));
  await stages.run(name("invite-skip"), () => skipOnboardingInvite(page));
  const draft = await stages.run(name("draft-ready"), () =>
    pollApi({
      describeFailure: (snapshot) =>
        snapshot?.runId === researchRunId &&
        ["failed", "superseded"].includes(snapshot.status)
          ? `Onboarding entered ${snapshot.status}`
          : null,
      isComplete: (snapshot) =>
        snapshot?.runId === researchRunId && Boolean(snapshot.campaignId),
      onEvidence: (evidence) =>
        attachApiEvidence(testInfo, name("draft-poll"), evidence),
      read: () => api.onboardingLatest(),
      timeoutMs: 2 * 60_000,
    })
  );
  if (!draft.value?.campaignId) throw new Error("Onboarding produced no campaign draft");
  await attachApiEvidence(testInfo, name("draft-ready"), {
    attempts: draft.attempts,
    campaignIdCaptured: true,
    elapsedMs: draft.elapsedMs,
    status: draft.value.status,
  });
  await stages.run(name("creative-api"), () =>
    pollApi({
      describeFailure: (campaign) =>
        campaign.creativeGeneration?.status === "failed"
          ? "Creative generation entered failed state"
          : null,
      isComplete: (campaign) =>
        Boolean(
          campaign.creativeGeneration &&
          ["complete", "partial"].includes(campaign.creativeGeneration.status) &&
          campaign.creativeGeneration.setCount > 0
        ),
      onEvidence: (evidence) =>
        attachApiEvidence(testInfo, name("creative-poll"), evidence),
      read: () => api.campaign(draft.value!.campaignId!),
      timeoutMs: 8 * 60_000,
    }), "assertion");
  return draft.value.campaignId;
};

export const runRegistrationCase = async (
  context: CaseContext,
  runId: string
): Promise<void> => {
  const { page, recordToReport, runtime, stages, testInfo } = context;
  const email = buildTestEmail(runtime.emailBase, runId);
  const clerk = new ClerkTestClient({ secretKey: runtime.clerkSecretKey });
  const { control, scopeId } = await createScope(context, email, runId);
  try {
    await stages.run("ui-registration", async () => {
      await setupClerkTestMode(page, runtime);
      await openSignUpForm(page);
      let { transition } = await submitSignUpCredentials(page, email, runtime.testPassword);
      if (transition === "deferred-password") {
        ({ transition } = await submitDeferredSignUpPassword(page, runtime.testPassword));
      }
      if (transition === "challenge") {
        throw new Error("Cloudflare verification is visible but no challenge solver is configured");
      }
      const prepared = await prepareSignUpVerificationCode(page);
      await attachApiEvidence(testInfo, "registration-verification-prepared", prepared);
      await submitSignUpVerificationCode(page, "424242");
    });
    await stages.run("identity-bind", async () => {
      const user = await clerk.bindScopeMetadata(email, scopeId);
      await control.bind(scopeId, user.id);
      await attachApiEvidence(testInfo, "registration", {
        clerkUserCreated: true,
        scopeBound: true,
      });
    });
    await recordCheckpoint("registration", "Disposable account registration and identity binding completed.", page, testInfo, recordToReport);
  } finally {
    await cleanupScope(context, control, scopeId);
  }
};

export const runLoginCase = async (
  context: CaseContext,
  getToken: () => Promise<string>,
  runId: string
): Promise<void> => {
  const { page, recordToReport, runtime, stages, testInfo } = context;
  const email = buildTestEmail(runtime.emailBase, runId);
  const clerk = new ClerkTestClient({ secretKey: runtime.clerkSecretKey });
  const { control, scopeId } = await createScope(context, email, runId);
  try {
    const user = await stages.run("account-provision", () =>
      clerk.createUser({ email, password: runtime.testPassword }), "environment");
    await stages.run("ui-login", async () => {
      await setupClerkTestMode(page, runtime);
      await openSignInForm(page);
      await submitSignInIdentifier(page, email);
      const password = await submitSignInPassword(page, runtime.testPassword);
      if (password.next === "factor-two") {
        if (!email.toLowerCase().includes("+clerk_test_")) {
          throw new Error("[stage:login] Fixed account requires a dedicated no-2FA login test account");
        }
        await submitSignInSecondFactor(page, "424242");
      }
      if ((await inspectOrganizationSetupPrompt(page)).visible) {
        await continueOrganizationSetup(page);
      }
      await inspectSignInNavigation(page);
    });
    await stages.run("identity-bind", async () => {
      await clerk.bindScopeMetadata(email, scopeId);
      await control.bind(scopeId, user.id);
    });
    await stages.run("session-api", async () => {
      const identity = await new UserApiClient({ baseUrl: runtime.apiUrl, getToken }).waitForNewAccountIdentity(
        60_000,
        (evidence) => attachApiEvidence(testInfo, "login-identity-readiness", evidence)
      );
      await attachApiEvidence(testInfo, "login", {
        sessionAuthenticated: true,
        attempts: identity.attempts,
        elapsedMs: identity.elapsedMs,
      });
    }, "assertion");
    await recordCheckpoint("login", "Disposable account password login and user API session completed.", page, testInfo, recordToReport);
  } finally {
    await cleanupScope(context, control, scopeId);
  }
};

export const runOnboardingCase = async (
  context: CaseContext,
  getToken: () => Promise<string>
): Promise<void> => {
  const api = new UserApiClient({ baseUrl: context.runtime.apiUrl, getToken });
  await completeForcedOnboarding(context, api);
  await recordCheckpoint("onboarding", "Forced onboarding completed and its new draft ID was confirmed.", context.page, context.testInfo, context.recordToReport);
};

export const runWalletTopupCase = async (
  context: CaseContext,
  getToken: () => Promise<string>
): Promise<void> => {
  const { aiAssert, page, recordToReport, runtime, stages, testInfo } = context;
  const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken });
  const startedAt = new Date().toISOString();
  const before = await stages.run("wallet-baseline", () => api.wallet(), "assertion");
  let sessionId = "";
  await stages.run("topup-open", () => openWalletTopUp(page));
  await stages.run("topup-checkout", async () => {
    const responsePromise = page.waitForResponse(
      (candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname.endsWith("/api/v1/wallet/topup"),
      { timeout: 60_000 }
    ).catch(() => null);
    let checkoutNavigationError: unknown = null;
    try {
      await startWalletCheckout(page, 50);
    } catch (error) {
      checkoutNavigationError = error;
    }
    const response = await responsePromise;
    sessionId = ((await response?.json().catch(() => null)) as { sessionId?: string } | null)?.sessionId ?? "";
    if (checkoutNavigationError || !response || !response.ok() || !sessionId) {
      testInfo.annotations.push({
        type: "action_unknown",
        description: "Checkout was requested once but its session was not confirmed; do not start another checkout.",
      });
      const [balance, transactions] = await Promise.allSettled([
        api.wallet(), api.transactions(startedAt),
      ]);
      await attachApiEvidence(testInfo, "topup-checkout-unknown", {
        checkoutHost: new URL(page.url()).hostname,
        responseStatus: response?.status() ?? null,
        sessionIdCaptured: Boolean(sessionId),
        navigationConfirmed: !checkoutNavigationError,
        balanceCents: balance.status === "fulfilled" ? balance.value.availableBalanceCents : null,
        recentTransactionCount: transactions.status === "fulfilled" ? transactions.value.transactions.length : null,
      });
      throw new Error("Checkout cannot be safely continued; payment must not be submitted or another checkout started");
    }
  });
  await stages.run("topup-card-prepare", () => prepareWalletCardPayment(page, {
    email: runtime.accountEmail,
    cardNumber: "4242424242424242",
    cardExpiry: "1234",
    cardCvc: "123",
    billingName: "Hellyeah E2E",
    billingPostalCode: "10001",
  }));
  let paymentSubmitError: unknown = null;
  try {
    await stages.run("topup-payment-submit", () => submitWalletPayment(page));
  } catch (error) {
    paymentSubmitError = error;
    testInfo.annotations.push({
      type: "action_unknown",
      description: "Pay was clicked once; the return navigation was not confirmed. Do not click Pay again.",
    });
  }
  let apiError: unknown;
  let uiError: unknown;
  let paymentVerified = false;
  try {
    const status = await stages.run("topup-settlement-api", () =>
      pollApi({
        describeFailure: (value) => value.status === "failed" ? "Top-up entered failed state" : null,
        isComplete: (value) => value.status === "completed",
        onEvidence: (evidence) => attachApiEvidence(testInfo, "topup-settlement-poll", evidence),
        read: () => api.topupStatus(sessionId).catch((error) => {
          if (error instanceof UserApiRequestError && error.status === 404) {
            return { status: "pending" };
          }
          throw error;
        }),
        timeoutMs: 2 * 60_000,
      }), "assertion");
    const reconciliation = await stages.run("wallet-reconciliation-api", () =>
      pollApi({
        isComplete: (value) => value.wallet.availableBalanceCents - before.availableBalanceCents === 5_000 && value.transactions.transactions.some((transaction) => ["topup", "topup_credit"].includes(transaction.type) && transaction.status === "completed" && transaction.amount === 5_000),
        onEvidence: (evidence) => attachApiEvidence(testInfo, "wallet-reconciliation-poll", evidence),
        read: async () => ({ wallet: await api.wallet(), transactions: await api.transactions(startedAt) }),
        timeoutMs: 2 * 60_000,
      }), "assertion");
    await attachApiEvidence(testInfo, "wallet", {
      attempts: status.attempts + reconciliation.attempts,
      balanceBeforeCents: before.availableBalanceCents,
      balanceAfterCents: reconciliation.value.wallet.availableBalanceCents,
      deltaCents: reconciliation.value.wallet.availableBalanceCents - before.availableBalanceCents,
      settlementStatus: status.value.status,
    });
    paymentVerified = true;
  } catch (error) {
    apiError = error;
  }
  if (paymentSubmitError && !paymentVerified) {
    await attachApiEvidence(testInfo, "topup-payment-unknown", {
      sessionIdCaptured: Boolean(sessionId),
      settlementConfirmed: false,
      currentHost: new URL(page.url()).hostname,
      readErrorType: apiError instanceof Error ? apiError.name : null,
    });
    throw new Error("Payment outcome remains unknown after read-only settlement checks; checkout is preserved for manual review");
  }
  try {
    await stages.run("wallet-result-ui", async () => {
      const display = await readWalletBalanceAndTransactions(page);
      const expectedBalance = `$${((before.availableBalanceCents + 5_000) / 100).toFixed(2)}`;
      if (!display.summaryText.includes(expectedBalance)) {
        throw new Error(`Wallet summary does not show ${expectedBalance}`);
      }
      if (!display.transactionRows.some((row) => row.includes("+$50.00"))) {
        throw new Error("Wallet does not show a +$50.00 top-up transaction");
      }
      await attachApiEvidence(testInfo, "wallet-ui-facts", {
        transactionRowCount: display.transactionRows.length,
        walletSummaryVisible: display.summaryText.length > 0,
      });
    }, "assertion");
  } catch (error) {
    uiError = error;
  }
  await stages.runAdvisory("wallet-visual", () => assertVisualCheckpoint("The wallet page shows the updated available balance and a successful $50.00 top-up transaction, with no payment error visible.", aiAssert));
  const walletConsistency = classifyConsistency(Boolean(apiError), Boolean(uiError));
  await attachApiEvidence(testInfo, "wallet-consistency", { result: walletConsistency });
  await stages.run("wallet-consistency", async () => {
    if (walletConsistency !== "CONSISTENT_PASS") throw new Error(walletConsistency);
    if (paymentSubmitError) {
      throw new Error("Payment settled, but Stripe return navigation was not confirmed");
    }
  }, "assertion");
  await recordCheckpoint("wallet", "UI and product APIs confirmed a $50 balance increase.", page, testInfo, recordToReport);
};

export const runCampaignLaunchCase = async (
  context: CaseContext,
  getToken: () => Promise<string>
): Promise<void> => {
  const { aiAssert, page, recordToReport, runtime, stages, testInfo } = context;
  const api = new UserApiClient({ baseUrl: runtime.apiUrl, getToken });
  let draftId: string | null = null;
  let launchedCampaignId: string | null = null;
  let launchOutcomeUnknown = false;
  let caseFailed = false;
  try {
    await stages.run("campaign-balance", async () => {
      if ((await api.wallet()).availableBalanceCents < 5_000) throw new Error("Fixed account requires at least $50");
    }, "assertion");
    const draft = await stages.run("draft-create", () =>
      api.createDraft({
        budgetAmount: 50,
        campaignType: "search",
        keywords: ["AI interview preparation"],
        languages: ["English"],
        locations: ["United States"],
        name: `E2E Search Launch ${Date.now()}`,
        objective: "Drive qualified signups for AI interview preparation",
        platform: "google",
      }).catch(async (error) => {
        if (!(error instanceof UserApiRequestError && error.status === 409 && error.message.includes("E_NO_AD_ACCOUNT"))) throw error;
        testInfo.annotations.push({ type: "warning", description: "No Google ad account assigned; prepare through the product campaign composer before submitting for review." });
        await attachApiEvidence(testInfo, "campaign-preparation-warning", { code: "E_NO_AD_ACCOUNT", fallback: "product-campaign-composer" });
        return null;
      }), "environment");
    draftId = draft?.draft.id ?? null;
    await attachApiEvidence(testInfo, "campaign-draft", {
      created: draft !== null,
      platform: "google",
      type: "search",
    });
    const knownDraftId = draftId;
    if (knownDraftId) {
      await stages.run("draft-open", () => openCampaignDraft(page, knownDraftId));
    } else {
      await stages.run("composer-open", () => openCampaignComposer(page));
      await stages.run("composer-goal-submit", () => submitCampaignGoal(
        page,
        "Prepare a Google Search campaign for https://finalroundai.com to drive interview preparation signups in the United States, in English. Total budget $50 over 10 days. Save a pending plan if no ad account is assigned. Prepare it for my review; do not launch or submit it."
      ));
      await stages.run("draft-settle", () => waitForCampaignDraft(page));
    }
    if (await page.getByText(/Creative job belongs to meta, not google/i).isVisible()) {
      testInfo.annotations.push({ type: "warning", description: "Product preselected a Meta creative for Google; test replaces it through the Studio picker." });
      await testInfo.attach("campaign-preselected-platform-mismatch", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
    const type = await stages.run("draft-type", () => observeCampaignType(page));
    if (type.selectedType !== "Search") throw new Error(`Agent drafted ${type.selectedType}, expected Search`);
    const keyword = await stages.run("draft-keyword", () => observeCampaignKeywords(page));
    if (!keyword.keywords.some((value) => value.toLowerCase().includes("ai interview preparation"))) {
      throw new Error("Agent draft is missing the requested Search keyword");
    }
    let creative = await stages.run("draft-creative-observe", () =>
      observeCampaignCreativeCards(page)
    );
    if (creative.creativeCardCount === 0) {
      await stages.run("creative-picker-open", () => openCampaignCreativePicker(page));
      const selected = await stages.run("creative-select-google", () =>
        selectCampaignGoogleSearchCreative(page)
      );
      if (!selected.selected) throw new Error("Google Search creative was not selected");
      creative = await stages.run("creative-import", () => confirmCampaignCreativeImport(page));
      await stages.run("creative-picker-close", () => closeCampaignCreativePicker(page));
    }
    if (creative.creativeCardCount < 1) throw new Error("No creative card is visible");
    const budget = await stages.run("draft-budget", () => setCampaignBudget(page, 50));
    if (budget.effectiveBudgetDollars !== 50) throw new Error("Campaign budget did not persist in the editor");
    await stages.run("draft-schedule", () => setCampaignDeliveryDays(page, 10));
    const readiness = await stages.run("draft-launch-readiness", () => observeCampaignLaunchReadiness(page));
    if (!readiness.enabled) throw new Error("Launch Campaign is disabled");
    await stages.runAdvisory("launch-visual", () => assertVisualCheckpoint("The campaign launch panel is ready and the Launch Campaign action is enabled for a $50 total budget.", aiAssert));
    let launchFunded = false;
    const launchStartedAt = Date.now();
    await stages.run("launch-submit", async () => {
      let launch: Awaited<ReturnType<typeof submitCampaignLaunch>> | null = null;
      try {
        launch = await submitCampaignLaunch(page);
      } catch (error) {
        launchOutcomeUnknown = true;
        await attachApiEvidence(testInfo, "campaign-launch-click-unknown", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
      if (!launch || !launch.responseStatus || launch.responseStatus >= 300 || !launch.campaignId) {
        launchOutcomeUnknown = true;
        testInfo.annotations.push({
          type: "action_unknown",
          description: "Launch may have been submitted once. Read-only reconciliation is required; no new click or speculative cleanup.",
        });
        const [list, wallet, reservations] = await Promise.allSettled([
          api.campaigns(), api.wallet(), api.reservations(),
        ]);
        const candidates = list.status === "fulfilled"
          ? list.value.items.filter((item) =>
              item.platform === "google" && item.budgetCents === 5_000 &&
              Date.parse(item.createdAt) >= launchStartedAt - 60_000 &&
              (!launch?.requestName || item.name === launch.requestName)
            )
          : [];
        await attachApiEvidence(testInfo, "campaign-launch-unknown-reconciliation", {
          requestObserved: launch?.requestObserved ?? false,
          idempotencyKey: launch?.idempotencyKey ?? null,
          responseStatus: launch?.responseStatus ?? null,
          candidateCampaigns: candidates.map(({ id, status }) => ({ id, status })),
          listTruncated: list.status === "fulfilled" && list.value.nextCursor !== null,
          listRead: list.status,
          walletBalanceCents: wallet.status === "fulfilled" ? wallet.value.availableBalanceCents : null,
          reservationCount: reservations.status === "fulfilled" ? reservations.value.reservations.length : null,
        });
        throw new Error("Campaign launch outcome is unknown; do not resubmit or infer ownership from name/time");
      }
      launchedCampaignId = launch.campaignId;
      launchFunded = launch.funded === true;
    });
    let apiError: unknown;
    let uiError: unknown;
    try {
      const verified = await stages.run("launch-reconciliation-api", () => pollApi({
        describeFailure: (value) => ["failed", "rejected", "cancelled"].includes(value.detail.status) ? `Campaign entered ${value.detail.status}` : null,
        isComplete: (value) => {
          const status = String(value.detail.status ?? "");
          const blocked = ["failed", "rejected", "cancelled"].includes(status);
          const reservedOnCampaign = value.detail.reservedCents === 5_000;
          const reservedOnWallet = value.reservations.reservations.some((reservation) => reservation.campaignId === launchedCampaignId && reservation.reservedCents === 5_000);
          return !blocked && (reservedOnCampaign || reservedOnWallet);
        },
        onEvidence: (evidence) => attachApiEvidence(testInfo, "campaign-reconciliation-poll", evidence),
        read: async () => ({ detail: await api.campaign(launchedCampaignId!), reservations: await api.reservations() }),
        timeoutMs: 2 * 60_000,
      }), "assertion");
      if (!launchFunded) throw new Error("Launch response did not confirm funding");
      await attachApiEvidence(testInfo, "campaign-launch", { attempts: verified.attempts, funded: true, pendingAdminReview: verified.value.detail.pendingAdminReview, reservedCents: verified.value.detail.reservedCents, status: verified.value.detail.status });
    } catch (error) {
      apiError = error;
    }
    try {
      await stages.run("launch-result-ui", async () => {
        const confirmation = await observeCampaignLaunchConfirmation(page, 50);
        if (!confirmation.confirmationVisible || !confirmation.reservedAmountVisible) {
          throw new Error("Campaign launch confirmation is missing the reserved amount");
        }
        await openCampaignList(page);
        if (!(await observeCampaignPendingReview(page)).visible) {
          throw new Error("Launched campaign is not pending review");
        }
      }, "assertion");
    } catch (error) {
      uiError = error;
    }
    const launchConsistency = classifyConsistency(Boolean(apiError), Boolean(uiError));
    await attachApiEvidence(testInfo, "campaign-consistency", { result: launchConsistency });
    await stages.run("launch-consistency", async () => {
      if (launchConsistency !== "CONSISTENT_PASS") throw new Error(launchConsistency);
    }, "assertion");
    await recordCheckpoint("campaign-launch", "UI and product APIs confirmed a funded $50 launch in review.", page, testInfo, recordToReport);
  } catch (error) {
    caseFailed = true;
    throw error;
  } finally {
    if (launchOutcomeUnknown) {
      await attachApiEvidence(testInfo, "campaign-teardown-deferred", {
        reason: "Unattributed launch may have funded; preserve all objects for read-only or manual reconciliation",
        draftIdCaptured: Boolean(draftId),
      });
    } else if (launchedCampaignId) {
      try {
        await teardownCampaign(api, launchedCampaignId, stages, testInfo);
      } catch (error) {
        if (!caseFailed) throw error;
      }
    } else if (draftId) {
      await api.discardDraft(draftId).then(
        () => attachApiEvidence(testInfo, "campaign-teardown", { discarded: true }),
        (error) => attachApiEvidence(testInfo, "campaign-teardown-warning", {
          discarded: false,
          errorType: error instanceof Error ? error.name : "UnknownError",
        })
      );
    }
  }
};
