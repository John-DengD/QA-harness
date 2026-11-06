import { describe, expect, it, vi } from "vitest";

import {
  chromeLaunchCommand,
  discoverPrivateCdp,
  selectUniqueTargetPage,
  targetOrigin,
} from "../../src/tools/e2b-shared-browser";

describe("E2B shared browser", () => {
  it("starts visible Chrome with an isolated profile and no target query", () => {
    const command = chromeLaunchCommand(":0", "https://app-staging.hellyeahai.com/");
    expect(command).toContain("remote-debugging-port=9223");
    expect(command).toContain("hy-qa-shared-chrome");
    expect(command).toContain("DISPLAY=");
    expect(command).not.toContain("--no-sandbox");
    expect(() => chromeLaunchCommand(":0", "https://app-staging.hellyeahai.com/?token=abc")).toThrow();
    expect(() => chromeLaunchCommand("; rm -rf /", "https://app-staging.hellyeahai.com")).toThrow();
  });

  it("enforces the E2B private traffic gate before exposing CDP", async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: "ws://localhost/devtools/browser/abcdef" }),
      });
    const sandbox = { trafficAccessToken: "private", getHost: () => "private.e2b.test" };
    await expect(discoverPrivateCdp(sandbox as never, request as never)).resolves.toEqual({
      endpoint: "wss://private.e2b.test/devtools/browser/abcdef",
      accessToken: "private",
    });
    expect(request.mock.calls[0][1].headers).toBeUndefined();
    expect(request.mock.calls[1][1].headers).toEqual({ "e2b-traffic-access-token": "private" });
    await expect(discoverPrivateCdp(sandbox as never,
      vi.fn().mockResolvedValue({ status: 200 }) as never)).rejects.toThrow("public-access gate");
  });

  it("only adopts one tab on the expected origin in the default context", () => {
    const page = { url: () => "https://app-staging.hellyeahai.com/campaigns" };
    const browser = { contexts: () => [{ pages: () => [page, { url: () => "about:blank" }] }] };
    expect(selectUniqueTargetPage(browser as never, "https://app-staging.hellyeahai.com/")).toBe(page);
    expect(() => selectUniqueTargetPage({ contexts: () => [{ pages: () => [page, page] }] } as never,
      "https://app-staging.hellyeahai.com/")).toThrow("found 2");
    expect(() => selectUniqueTargetPage(browser as never, "https://ops-staging.hellyeahai.com/")).toThrow("found 0");
    expect(() => selectUniqueTargetPage({ contexts: () => [{}, {}] } as never,
      "https://app-staging.hellyeahai.com/")).toThrow("default context");
    expect(() => targetOrigin("https://user:secret@app-staging.hellyeahai.com/")).toThrow("without credentials");
    expect(() => targetOrigin("https://app.hellyeahai.com/")).toThrow("known Hellyeah test origin");
  });
});
