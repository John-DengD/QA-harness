import { describe, expect, it, vi } from "vitest";
import { UserApiClient } from "../../src/clients/user-api";

describe("new account identity readiness", () => {
  it("waits for organization synchronization and obtains a fresh token for each read", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: "E_NO_IDENTITY" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ id: "user" }));
    const getToken = vi.fn(async () => "test-jwt");
    const client = new UserApiClient({ baseUrl: "https://api-staging.example.com", fetcher, getToken });
    const result = await client.waitForNewAccountIdentity(5_000);
    expect(result.attempts).toBe(2);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it.each([[401, "E_UNAUTHORIZED"], [404, "E_NOT_FOUND"]])("does not hide %s %s", async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code }, { status }));
    const client = new UserApiClient({ baseUrl: "https://api-staging.example.com", fetcher, getToken: async () => "test-jwt" });
    await expect(client.waitForNewAccountIdentity()).rejects.toMatchObject({ status, code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails when identity never becomes ready", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ code: "E_NO_IDENTITY" }, { status: 404 }));
    const client = new UserApiClient({ baseUrl: "https://api-staging.example.com", fetcher, getToken: async () => "test-jwt" });
    await expect(client.waitForNewAccountIdentity(10)).rejects.toThrow("Timed out");
  });
});
