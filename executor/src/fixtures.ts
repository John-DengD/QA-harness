import { chromium, test as base } from "@playwright/test";
import {
  PlaywrightAiFixture,
  type PlayWrightAiFixtureType,
} from "@midscene/web/playwright";

const midscene = PlaywrightAiFixture({
  cache: false,
  waitForNetworkIdleTimeout: 2_000,
});

export const test = base.extend<PlayWrightAiFixtureType>({
  ...midscene,
  browser: async ({ browser }, use) => {
    const cdpUrl = process.env.E2E_CDP_URL;
    if (!cdpUrl) {
      await use(browser);
      return;
    }
    const accessToken = process.env.E2E_CDP_ACCESS_TOKEN;
    const remote = await chromium.connectOverCDP(cdpUrl, {
      headers: accessToken ? { "e2b-traffic-access-token": accessToken } : undefined,
    });
    try {
      await use(remote);
    } finally {
      await remote.close();
    }
  },
});

export { expect } from "@playwright/test";
