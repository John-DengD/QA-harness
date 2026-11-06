import { expect, it, vi } from "vitest";

import { provisionDisposableAccount } from "../../src/session/disposable-account";
import type { RuntimeConfig } from "../../src/config";

const runtime: RuntimeConfig = {
  accountEmail: "fixed@example.com",
  apiUrl: "https://api-staging.example.com",
  baseUrl: "https://app-staging.example.com",
  clerkPublishableKey: "pk_test_example",
  clerkSecretKey: "sk_test_example",
  controlToken: "control-token",
  controlUrl: "https://api-staging.example.com/internal/e2e",
  emailBase: "qa@example.com",
  modelApiKey: "model-key",
  modelBaseUrl: "https://models.example.com",
  modelFamily: "gpt-5",
  modelName: "model",
  testPassword: "Strong-test-password-123!",
};

it("provisions, binds, and cleans a disposable account scope", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/internal/e2e/scopes")) {
      return Response.json({ expiresAt: new Date().toISOString(), scopeId: "scope-1" });
    }
    if (url.endsWith("/v1/users")) {
      return Response.json({ email_addresses: [], id: "user-1" });
    }
    if (url.includes("/v1/users?") || url.endsWith("/v1/users/user-1/metadata")) {
      return Response.json(
        url.includes("?")
          ? [{ email_addresses: [{ email_address: "qa+clerk_test_run-1@example.com" }], id: "user-1" }]
          : { id: "user-1" }
      );
    }
    if (url.endsWith("/internal/e2e/scopes/scope-1/bind")) {
      return Response.json({ scopeId: "scope-1", status: "bound" });
    }
    if (url.endsWith("/internal/e2e/scopes/scope-1/cleanup")) {
      return Response.json({ scopeId: "scope-1", status: "cleaned" });
    }
    return new Response(null, { status: 404 });
  });

  try {
    const lease = await provisionDisposableAccount(runtime, "run-1");
    expect(lease.email).toBe("qa+clerk_test_run-1@example.com");
    await expect(lease.cleanup()).resolves.toMatchObject({ status: "cleaned" });
    await expect(lease.cleanup()).resolves.toMatchObject({ status: "cleaned" });
    expect(
      fetcher.mock.calls.filter(([input]) => String(input).endsWith("/cleanup"))
    ).toHaveLength(1);
  } finally {
    fetcher.mockRestore();
  }
});
