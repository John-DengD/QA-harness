import { pollApi } from "../tools/api-poll";

interface UserApiClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetcher?: typeof fetch;
  orgId?: string;
}

export interface WalletSnapshot {
  availableBalanceCents: number;
  balanceCents: number;
  pendingDebitCents: number;
}

export interface WalletTransaction {
  amount: number;
  balanceAfter: number | null;
  createdAt: string;
  status: string;
  type: string;
}

export interface WalletReservation {
  campaignId: string;
  reservedCents: number;
  status: string;
}

export interface CampaignSummary {
  activatedAt?: string | null;
  creativeGeneration?: {
    setCount: number;
    status: "complete" | "failed" | "partial" | "processing" | "queued";
  };
  id: string;
  pendingAdminReview: boolean;
  refundAmountCents?: number | null;
  refundEligibleAt?: string | null;
  refundStatus?: string | null;
  reservedCents: number | null;
  status: string;
}

export interface CampaignDraftCreateInput {
  budgetAmount: number;
  campaignType: "search";
  keywords: string[];
  languages: string[];
  locations: string[];
  name: string;
  objective: string;
  platform: "google";
}

export interface CampaignDraftCreateResult {
  draft: {
    id: string;
  };
}

export class UserApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "UserApiRequestError";
  }
}

export interface OnboardingResearchSnapshot {
  campaignId: string | null;
  draft?: { domain: string };
  runId: string;
  status: string;
}

export interface CampaignListItem {
  budgetCents: number;
  createdAt: string;
  id: string;
  name: string;
  platform: string;
  status: string;
}

export class UserApiClient {
  readonly #baseUrl: string;
  readonly #fetcher: typeof fetch;
  readonly #getToken: () => Promise<string>;
  #orgId?: string;

  constructor(options: UserApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetcher = options.fetcher ?? fetch;
    this.#getToken = options.getToken;
    this.#orgId = options.orgId;
  }

  async #request<T>(
    path: string,
    init: RequestInit = {},
    resolveOrg = true
  ): Promise<T> {
    if (resolveOrg && path !== "/me" && !this.#orgId) {
      const me = await this.#request<{
        org?: { id?: string };
        primaryOrgId?: string;
      }>("/me", {}, false);
      this.#orgId = me.primaryOrgId ?? me.org?.id;
      if (!this.#orgId) {
        throw new Error("[stage:api-assertion] Fixed account has no active organization");
      }
    }
    const token = await this.#getToken();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (this.#orgId) headers.set("X-Hellyeah-Org", this.#orgId);
    const response = await this.#fetcher(`${this.#baseUrl}/api/v1${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        code?: unknown;
        error?: { code?: unknown } | string;
      } | null;
      const code =
        typeof body?.code === "string"
          ? body.code
          : typeof body?.error === "object" &&
              typeof body.error?.code === "string"
            ? body.error.code
            : null;
      throw new UserApiRequestError(
        `[stage:api-assertion] ${init.method ?? "GET"} ${path} failed (${response.status}${code ? `:${code}` : ""})`,
        response.status,
        code ?? undefined
      );
    }
    return (await response.json()) as T;
  }

  #get<T>(path: string): Promise<T> {
    return this.#request(path);
  }

  me(): Promise<Record<string, unknown>> {
    return this.#get("/me");
  }

  waitForNewAccountIdentity(timeoutMs = 60_000, onEvidence?: (evidence: unknown) => Promise<void>) {
    return pollApi({
      timeoutMs,
      onEvidence,
      isComplete: (value) => value.ready,
      read: async () => {
        try {
          await this.me();
          return { ready: true, status: 200, code: "OK" };
        } catch (error) {
          if (!(error instanceof UserApiRequestError && error.status === 404 && error.code === "E_NO_IDENTITY")) throw error;
          return { ready: false, status: error.status, code: error.code };
        }
      },
    });
  }

  onboardingResearch(runId: string): Promise<Record<string, unknown>> {
    return this.#get(`/onboarding/research/${encodeURIComponent(runId)}`);
  }

  onboardingLatest(): Promise<OnboardingResearchSnapshot | null> {
    return this.#get("/onboarding/research/latest");
  }

  wallet(): Promise<WalletSnapshot> {
    return this.#get("/wallet/balance");
  }

  topupStatus(sessionId: string): Promise<{ status: string }> {
    return this.#get(`/wallet/topup/${encodeURIComponent(sessionId)}/status`);
  }

  transactions(since?: string): Promise<{ transactions: WalletTransaction[] }> {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.#get(`/wallet/transactions${query}`);
  }

  reservations(): Promise<{ reservations: WalletReservation[] }> {
    return this.#get("/wallet/reservations");
  }

  campaign(id: string): Promise<CampaignSummary> {
    return this.#get(`/campaigns/${encodeURIComponent(id)}`);
  }

  campaigns(limit = 100): Promise<{ items: CampaignListItem[]; nextCursor: string | null }> {
    return this.#get(`/campaigns?limit=${limit}`);
  }

  createDraft(
    input: CampaignDraftCreateInput
  ): Promise<CampaignDraftCreateResult> {
    return this.#request("/campaigns/drafts", {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }

  discardDraft(id: string): Promise<Record<string, unknown>> {
    return this.#request(`/campaigns/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  cancelCampaign(id: string): Promise<Record<string, unknown>> {
    return this.#request(`/campaigns/${encodeURIComponent(id)}/cancel`, {
      body: JSON.stringify({ reason: "Automated staging E2E teardown" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }
}
