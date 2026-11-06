import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";

import type { RuntimeConfig } from "../config";
import { ClerkTestClient } from "../clients/clerk";

type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface FixedAccountSession {
  sessionId: string;
  storageState: BrowserStorageState;
}

interface ClerkWindowShape {
  Clerk?: {
    session?: {
      getToken(): Promise<string | null>;
    };
  };
}

export const setupClerkTestMode = async (
  page: Page,
  runtime: RuntimeConfig
): Promise<void> => {
  await clerkSetup({
    dotenv: false,
    publishableKey: runtime.clerkPublishableKey,
    secretKey: runtime.clerkSecretKey,
  });
  await setupClerkTestingToken({ page });
};

export const createFixedAccountStorageState = async (
  browser: Browser,
  runtime: RuntimeConfig
): Promise<FixedAccountSession> => {
  const clerk = new ClerkTestClient({ secretKey: runtime.clerkSecretKey });
  const user = await clerk.findUserByEmail(runtime.accountEmail);
  return createClerkUserStorageState(browser, runtime, user.id);
};

export const createClerkUserStorageState = async (
  browser: Browser,
  runtime: RuntimeConfig,
  clerkUserId: string
): Promise<FixedAccountSession> => {
  const context = await browser.newContext({
    baseURL: runtime.baseUrl,
    storageState: undefined,
  });
  const page = await context.newPage();
  try {
    await setupClerkTestMode(page, runtime);
    const clerk = new ClerkTestClient({ secretKey: runtime.clerkSecretKey });
    const signInToken = await clerk.createSignInToken(clerkUserId);
    const ticketUrl = new URL("/sign-in", runtime.baseUrl);
    ticketUrl.searchParams.set("__clerk_ticket", signInToken.token);
    await page.goto(ticketUrl.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForURL(
      (url) => !url.pathname.startsWith("/sign-in") && !url.searchParams.has("__clerk_ticket"),
      { timeout: 45_000 }
    );
    const jwt = await getFreshClerkSessionJwt(page);
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { sid?: unknown };
    if (typeof payload.sid !== "string") {
      throw new Error("[stage:account-session] Clerk JWT has no session id");
    }
    return { sessionId: payload.sid, storageState: await context.storageState() };
  } finally {
    await context.close();
  }
};

const jwtExpiresInSeconds = (token: string): number | null => {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { exp?: unknown };
    return typeof parsed.exp === "number"
      ? parsed.exp - Math.floor(Date.now() / 1000)
      : null;
  } catch {
    return null;
  }
};

export const getFreshClerkSessionJwt = async (page: Page): Promise<string> => {
  const sdkToken = await page
    .waitForFunction(
      () => Boolean((window as unknown as ClerkWindowShape).Clerk?.session),
      undefined,
      { timeout: 10_000 }
    )
    .then(() =>
      page.evaluate(() =>
        (window as unknown as ClerkWindowShape).Clerk?.session?.getToken()
      )
    )
    .catch(() => null);
  const cookieToken = sdkToken
    ? null
    : (await page.context().cookies()).find(
        (cookie) =>
          cookie.name === "__session" || cookie.name.startsWith("__session_")
      )?.value;
  const token = sdkToken ?? cookieToken;
  if (!token || token.split(".").length !== 3) {
    throw new Error("[stage:account-session] Clerk did not return a session JWT");
  }
  const remaining = jwtExpiresInSeconds(token);
  if (remaining !== null && remaining < 15) {
    throw new Error("[stage:account-session] Clerk returned an expiring session JWT");
  }
  return token;
};
