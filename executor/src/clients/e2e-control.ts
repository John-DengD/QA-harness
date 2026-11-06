export type ScopeStatus =
  | "created"
  | "bound"
  | "cleaning"
  | "cleaned"
  | "manual_review"
  | "expired";

export interface CreateScopeInput {
  commitSha: string;
  email: string;
  release: string;
  runId: string;
}

export interface CreateScopeResult {
  expiresAt: string;
  scopeId: string;
}

export interface ScopeResult {
  scopeId: string;
  status: ScopeStatus;
  evidence?: string[];
}

export class E2eControlRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "E2eControlRequestError";
  }
}

interface E2eControlClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  token: string;
}

export class E2eControlClient {
  readonly #baseUrl: string;
  readonly #fetcher: typeof fetch;
  readonly #token: string;

  constructor(options: E2eControlClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetcher = options.fetcher ?? fetch;
    this.#token = options.token;
  }

  async #request<T>(
    stage: string,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new E2eControlRequestError(
        `[stage:${stage}] E2E control request failed: ${message}`
      );
    }

    if (!response.ok) {
      throw new E2eControlRequestError(
        `[stage:${stage}] E2E control request failed (${response.status})`,
        response.status
      );
    }
    return (await response.json()) as T;
  }

  createScope(input: CreateScopeInput): Promise<CreateScopeResult> {
    return this.#request("scope-create", "/scopes", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  bind(scopeId: string, clerkUserId: string): Promise<ScopeResult> {
    return this.#request("scope-bind", `/scopes/${encodeURIComponent(scopeId)}/bind`, {
      body: JSON.stringify({ clerkUserId }),
      method: "POST",
    });
  }

  cleanup(scopeId: string): Promise<ScopeResult> {
    return this.#request(
      "cleanup",
      `/scopes/${encodeURIComponent(scopeId)}/cleanup`,
      {
        method: "POST",
        signal: AbortSignal.timeout(3 * 60_000),
      }
    );
  }
}
