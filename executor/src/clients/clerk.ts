const CLERK_API_URL = "https://api.clerk.com/v1";

interface ClerkEmailAddress {
  email_address: string;
}

export interface ClerkUser {
  email_addresses: ClerkEmailAddress[];
  id: string;
}

interface CreateClerkUserInput {
  email: string;
  password: string;
}

interface ClerkTestClientOptions {
  fetcher?: typeof fetch;
  secretKey: string;
}

interface ClerkSignInToken {
  id: string;
  token: string;
  url: string;
}

export class ClerkTestClient {
  readonly #fetcher: typeof fetch;
  readonly #secretKey: string;

  constructor(options: ClerkTestClientOptions) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#secretKey = options.secretKey;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetcher(`${CLERK_API_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#secretKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`[stage:signup] Clerk request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async findUserByEmailOrNull(email: string): Promise<ClerkUser | null> {
    const query = new URLSearchParams();
    query.set("email_address", email);
    const users = await this.#request<ClerkUser[]>(`/users?${query}`);
    const normalized = email.toLowerCase();
    return (
      users.find((entry) =>
      entry.email_addresses.some(
        (address) => address.email_address.toLowerCase() === normalized
      )
      ) ?? null
    );
  }

  async findUserByEmail(email: string): Promise<ClerkUser> {
    const user = await this.findUserByEmailOrNull(email);
    if (!user) {
      throw new Error("[stage:signup] Clerk user was not found by exact email");
    }
    return user;
  }

  createUser(input: CreateClerkUserInput): Promise<ClerkUser> {
    return this.#request("/users", {
      body: JSON.stringify({
        email_address: [input.email],
        password: input.password,
        skip_legal_checks: true,
      }),
      method: "POST",
    });
  }

  async bindScopeMetadata(email: string, scopeId: string): Promise<ClerkUser> {
    const user = await this.findUserByEmail(email);
    await this.#request(`/users/${encodeURIComponent(user.id)}/metadata`, {
      body: JSON.stringify({
        private_metadata: {
          cleanupScopeId: scopeId,
          managedBy: "hy-ui-e2e",
        },
      }),
      method: "PATCH",
    });
    return user;
  }

  createSignInToken(userId: string): Promise<ClerkSignInToken> {
    return this.#request("/sign_in_tokens", {
      body: JSON.stringify({ expires_in_seconds: 300, user_id: userId }),
      method: "POST",
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    const response = await this.#fetcher(
      `${CLERK_API_URL}/sessions/${encodeURIComponent(sessionId)}/revoke`,
      {
        headers: { authorization: `Bearer ${this.#secretKey}` },
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (response.ok || response.status === 404) return;
    throw new Error(
      `[stage:cleanup] Clerk session revoke failed (${response.status})`
    );
  }

  async deleteUser(userId: string): Promise<void> {
    const response = await this.#fetcher(
      `${CLERK_API_URL}/users/${encodeURIComponent(userId)}`,
      {
        headers: { authorization: `Bearer ${this.#secretKey}` },
        method: "DELETE",
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (response.ok || response.status === 404) return;
    throw new Error(
      `[stage:cleanup] Clerk delete request failed (${response.status})`
    );
  }
}
