import { chromium, type Browser, type Page } from "@playwright/test";
import type { Sandbox } from "@e2b/desktop";

type CdpSandbox = Pick<Sandbox, "getHost" | "trafficAccessToken">;

export function targetOrigin(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The shared browser target must be an HTTP(S) URL without credentials");
  }
  const staging = new Set([
    "app-staging.hellyeahai.com", "ops-staging.hellyeahai.com",
  ]);
  const preview = /^hellyeah-(dashboard|admin)-[a-z0-9-]+-final-round-ai\.vercel\.app$/;
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const extra = (process.env.QA_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (extra.includes(url.origin)) return url.origin;
  if (!(url.protocol === "https:" && (staging.has(url.hostname) || preview.test(url.hostname))) &&
      !(local.has(url.hostname) && (url.protocol === "http:" || url.protocol === "https:"))) {
    throw new Error("Shared browser target must be a known Hellyeah test origin");
  }
  return url.origin;
}

export function chromeLaunchCommand(display: string, initialUrl?: string): string {
  if (!/^:[0-9]+(?:\.[0-9]+)?$/.test(display)) {
    throw new Error("Unexpected E2B desktop display");
  }
  if (initialUrl) {
    const url = new URL(initialUrl);
    targetOrigin(initialUrl);
    if (url.search || url.hash) {
      throw new Error("The initial browser URL cannot contain a query or fragment");
    }
  }
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const args = [
    "google-chrome", "--disable-dev-shm-usage", "--no-first-run",
    "--no-default-browser-check", "--user-data-dir=/tmp/hy-qa-shared-chrome",
    "--remote-debugging-port=9223", "--new-window", initialUrl ?? "about:blank",
  ];
  const command = `DISPLAY=${quote(display)} setsid ${args.map(quote).join(" ")} ` +
    `>/tmp/hy-qa-shared-chrome.log 2>&1 < /dev/null & echo $!`;
  return `bash -lc ${quote(command)}`;
}

export async function discoverPrivateCdp(
  sandbox: CdpSandbox,
  request: typeof fetch = fetch
): Promise<{ endpoint: string; accessToken: string }> {
  const accessToken = sandbox.trafficAccessToken;
  if (!accessToken) throw new Error("E2B CDP requires private traffic authorization");
  const host = sandbox.getHost(9223);
  const discoveryUrl = `https://${host}/json/version`;
  const unauthenticated = await request(discoveryUrl, {
    signal: AbortSignal.timeout(8_000),
  });
  if (unauthenticated.status !== 403) {
    throw new Error(`E2B CDP public-access gate failed (${unauthenticated.status})`);
  }
  const response = await request(discoveryUrl, {
    headers: { "e2b-traffic-access-token": accessToken },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`E2B CDP discovery failed (${response.status})`);
  const details = await response.json() as { webSocketDebuggerUrl?: unknown };
  if (typeof details.webSocketDebuggerUrl !== "string") {
    throw new Error("E2B CDP did not expose a browser WebSocket");
  }
  const browserPath = new URL(details.webSocketDebuggerUrl).pathname;
  if (!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath)) {
    throw new Error("E2B CDP returned an unexpected browser endpoint");
  }
  return { endpoint: `wss://${host}${browserPath}`, accessToken };
}

export async function connectSharedChrome(sandbox: CdpSandbox): Promise<Browser> {
  const { endpoint, accessToken } = await discoverPrivateCdp(sandbox);
  return chromium.connectOverCDP(endpoint, {
    headers: { "e2b-traffic-access-token": accessToken },
    noDefaults: true,
  });
}

export function selectUniqueTargetPage(browser: Browser, expectedOrigin: string): Page {
  const origin = targetOrigin(expectedOrigin);
  const contexts = browser.contexts();
  if (contexts.length !== 1) {
    throw new Error(`Expected the shared Chrome default context, found ${contexts.length}`);
  }
  const matching = contexts[0].pages().filter((page) => {
    try {
      return new URL(page.url()).origin === origin;
    } catch {
      return false;
    }
  });
  if (matching.length !== 1) {
    throw new Error(`Expected one visible target tab for ${origin}, found ${matching.length}`);
  }
  return matching[0];
}
