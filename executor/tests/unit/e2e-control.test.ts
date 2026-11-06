import { describe, expect, it, vi } from "vitest";

import { E2eControlClient } from "../../src/clients/e2e-control";

describe("E2eControlClient", () => {
  it("creates a scope with bearer authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ expiresAt: "2026-09-01T10:00:00.000Z", scopeId: "scope_123" })
    );
    const client = new E2eControlClient({
      baseUrl: "https://api-staging.hellyeahai.com/internal/e2e",
      fetcher,
      token: "secret-token",
    });

    const result = await client.createScope({
      commitSha: "abc123",
      email: "qa+clerk_test_run@example.com",
      release: "dashboard-42",
      runId: "run-42",
    });

    expect(result.scopeId).toBe("scope_123");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api-staging.hellyeahai.com/internal/e2e/scopes");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret-token"
    );
  });

  it("returns an idempotent cleaned result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ scopeId: "scope_123", status: "cleaned" })
    );
    const client = new E2eControlClient({
      baseUrl: "https://api-staging.hellyeahai.com/internal/e2e",
      fetcher,
      token: "secret-token",
    });

    await expect(client.cleanup("scope_123")).resolves.toMatchObject({
      status: "cleaned",
    });
  });

  it("does not include the bearer token in request errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("denied secret-token", { status: 403 })
    );
    const client = new E2eControlClient({
      baseUrl: "https://api-staging.hellyeahai.com/internal/e2e",
      fetcher,
      token: "secret-token",
    });

    await expect(client.cleanup("scope_123")).rejects.not.toThrow(
      /secret-token/
    );
  });
});
