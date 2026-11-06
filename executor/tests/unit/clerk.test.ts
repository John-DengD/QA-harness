import { describe, expect, it, vi } from "vitest";

import { ClerkTestClient } from "../../src/clients/clerk";

describe("ClerkTestClient", () => {
  it("creates a disposable verified email user with the test password", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        email_addresses: [{ email_address: "qa+clerk_test_login@example.com" }],
        id: "user_login",
      })
    );
    const client = new ClerkTestClient({ fetcher, secretKey: "sk_test_secret" });

    await client.createUser({
      email: "qa+clerk_test_login@example.com",
      password: "test-password-123",
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.clerk.com/v1/users");
    expect(JSON.parse(String(init?.body))).toEqual({
      email_address: ["qa+clerk_test_login@example.com"],
      password: "test-password-123",
      skip_legal_checks: true,
    });
  });

  it("finds the exact user and writes private scope metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            email_addresses: [
              { email_address: "qa+clerk_test_run@example.com" },
            ],
            id: "user_123",
          },
        ])
      )
      .mockResolvedValueOnce(Response.json({ id: "user_123" }));
    const client = new ClerkTestClient({ fetcher, secretKey: "sk_test_secret" });

    const user = await client.bindScopeMetadata(
      "qa+clerk_test_run@example.com",
      "scope_123"
    );

    expect(user.id).toBe("user_123");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "email_address=qa%2Bclerk_test_run%40example.com"
    );
    const [url, init] = fetcher.mock.calls[1] ?? [];
    expect(url).toBe("https://api.clerk.com/v1/users/user_123/metadata");
    expect(JSON.parse(String(init?.body))).toEqual({
      private_metadata: {
        cleanupScopeId: "scope_123",
        managedBy: "hy-ui-e2e",
      },
    });
  });

  it("treats an already deleted user as clean", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("missing", { status: 404 }));
    const client = new ClerkTestClient({ fetcher, secretKey: "sk_test_secret" });

    await expect(client.deleteUser("user_123")).resolves.toBeUndefined();
  });

  it("treats an already revoked session as clean", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("missing", { status: 404 }));
    const client = new ClerkTestClient({ fetcher, secretKey: "sk_test_secret" });

    await expect(client.revokeSession("session_123")).resolves.toBeUndefined();
  });

  it("returns null when a partially created identity is absent", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    const client = new ClerkTestClient({ fetcher, secretKey: "sk_test_secret" });

    await expect(
      client.findUserByEmailOrNull("qa+clerk_test_missing@example.com")
    ).resolves.toBeNull();
  });

  it("does not expose Clerk response bodies or keys in errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("sensitive sk_test_secret", { status: 500 })
      );
    const client = new ClerkTestClient({ fetcher, secretKey: "sk_test_secret" });

    await expect(
      client.findUserByEmail("qa+clerk_test_run@example.com")
    ).rejects.not.toThrow(/sensitive|sk_test_secret/);
  });
});
