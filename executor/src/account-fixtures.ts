import {
  createFixedAccountStorageState,
  getFreshClerkSessionJwt,
} from "./session/clerk-session";
import { parseRuntimeConfig } from "./config";
import { ClerkTestClient } from "./clients/clerk";
import { test as base } from "./fixtures";

interface AccountFixtures {
  getAccountJwt: () => Promise<string>;
}

export const accountTest = base.extend<AccountFixtures>({
  storageState: async ({ browser }, use) => {
    const runtime = parseRuntimeConfig(process.env);
    const session = await createFixedAccountStorageState(browser, runtime);
    try {
      await use(session.storageState);
    } finally {
      await new ClerkTestClient({ secretKey: runtime.clerkSecretKey }).revokeSession(
        session.sessionId
      );
    }
  },
  getAccountJwt: async ({ page }, use) => {
    await page.goto("/");
    await use(() => getFreshClerkSessionJwt(page));
  },
});

export { expect } from "./fixtures";
