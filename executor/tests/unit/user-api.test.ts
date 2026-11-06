import { describe, expect, it, vi } from "vitest";

import { UserApiClient } from "../../src/clients/user-api";

describe("UserApiClient", () => {
  it("resolves the fixed account primary org before scoped reads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ org: { id: "org-fallback" }, primaryOrgId: "org-primary" })
      )
      .mockResolvedValueOnce(
        Response.json({
          availableBalanceCents: 5000,
          balanceCents: 5000,
          pendingDebitCents: 0,
        })
      );
    const client = new UserApiClient({
      baseUrl: "https://api-staging.hellyeahai.com",
      fetcher,
      getToken: () => Promise.resolve("session-jwt"),
    });

    await client.wallet();

    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/me$/);
    expect(
      new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("X-Hellyeah-Org")
    ).toBe("org-primary");
  });

  it("cancels only the supplied campaign through the product API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const client = new UserApiClient({
      baseUrl: "https://api-staging.hellyeahai.com",
      fetcher,
      getToken: () => Promise.resolve("session-jwt"),
      orgId: "org-123",
    });

    await client.cancelCampaign("campaign-123");

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api-staging.hellyeahai.com/api/v1/campaigns/campaign-123/cancel"
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer session-jwt"
    );
    expect(new Headers(init?.headers).get("X-Hellyeah-Org")).toBe("org-123");
    expect(JSON.parse(String(init?.body))).toEqual({
      reason: "Automated staging E2E teardown",
    });
  });

  it("creates a standalone Google Search draft through the product API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ draft: { id: "draft-123" } }, { status: 201 })
    );
    const client = new UserApiClient({
      baseUrl: "https://api-staging.hellyeahai.com",
      fetcher,
      getToken: () => Promise.resolve("session-jwt"),
      orgId: "org-123",
    });
    const input = {
      budgetAmount: 50,
      campaignType: "search" as const,
      keywords: ["AI interview preparation"],
      languages: ["English"],
      locations: ["United States"],
      name: "E2E Search Launch 123",
      objective: "Drive qualified signups for AI interview preparation",
      platform: "google" as const,
    };

    await expect(client.createDraft(input)).resolves.toEqual({
      draft: { id: "draft-123" },
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api-staging.hellyeahai.com/api/v1/campaigns/drafts"
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it("discards only the supplied draft through the product API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const client = new UserApiClient({
      baseUrl: "https://api-staging.hellyeahai.com",
      fetcher,
      getToken: () => Promise.resolve("session-jwt"),
      orgId: "org-123",
    });

    await client.discardDraft("draft-123");

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api-staging.hellyeahai.com/api/v1/campaigns/draft-123"
    );
    expect(init?.method).toBe("DELETE");
  });
});
