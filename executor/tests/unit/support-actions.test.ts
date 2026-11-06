import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  openDashboardAccountMenu,
  openDashboardDocs,
  openDashboardSupport,
  openMarketingFooterContact,
  openMarketingFooterDocs,
  openMarketingSupport,
} from "../../src/actions/support-actions";

const widgetFrame = `
  <html><body>
    <main>Support panel</main>
    <p>Powered by Chatwoot</p>
    <button id="start">Start Conversation</button>
    <script>document.querySelector('#start').onclick = () => parent.postMessage('message-sent', '*');</script>
  </body></html>`;

const widgetHost = `
  <div id="cw-bubble-holder" hidden>
  <button title="Open chat window" class="woot-widget-bubble">Bubble</button>
  </div>
  <iframe id="chatwoot" src="/widget" hidden title="Chatwoot"></iframe>
`;

const marketingPage = `
  <h1>Hellyeah</h1>
  <footer>
    <section><h2>Resources</h2>
      <button type="button" id="support">Support</button>
      <a href="https://docs.example.invalid" target="_blank" rel="noopener">Docs</a>
    </section>
    <section><a href="/contact">Contact</a></section>
  </footer>
  ${widgetHost}
  <script>
    window.sent = 0;
    window.addEventListener('message', (event) => { if (event.data === 'message-sent') window.sent += 1; });
    window.setTimeout(() => {
      window.$chatwoot = { toggle: () => { document.querySelector('#chatwoot').hidden = false; } };
    }, 30);
    document.querySelector('#support').onclick = () => window.$chatwoot.toggle('open');
  </script>`;

const dashboardPage = `
  <aside data-sidebar="footer" data-slot="sidebar-footer">
    <div><button type="button">Account</button></div>
  </aside>
  <div role="menu" hidden>
    <a role="menuitem" href="https://docs.example.invalid" target="_blank">Docs</a>
    <button role="menuitem" id="dashboard-support">Support</button>
  </div>
  ${widgetHost}
  <script>
    window.sent = 0;
    window.$chatwoot = { toggle: () => { document.querySelector('#chatwoot').hidden = false; } };
    const menu = document.querySelector('[role="menu"]');
    document.querySelector('[data-slot="sidebar-footer"] button').onclick = () => menu.hidden = false;
    document.querySelector('#dashboard-support').onclick = () => window.$chatwoot.toggle('open');
  </script>`;

async function installRoutes(page: import("@playwright/test").Page): Promise<void> {
  await page.route("http://test.local/widget", (route) =>
    route.fulfill({ contentType: "text/html", body: widgetFrame })
  );
}

describe("Support and Chatwoot single-intent actions", () => {
  it("opens marketing Support, preserves adjacent links, and sends no message", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: "http://test.local" });
      const page = await context.newPage();
      await installRoutes(page);
      await page.route("http://test.local/", (route) =>
        route.fulfill({ contentType: "text/html", body: marketingPage })
      );
      await page.route("http://test.local/contact", (route) =>
        route.fulfill({ contentType: "text/html", body: "<h1>Contact</h1>" })
      );
      await page.goto("/");

      expect(await openMarketingSupport(page)).toMatchObject({
        clicked: true,
        entryEnabled: true,
        entryVisible: true,
        sdkReady: true,
        widgetFrameVisible: true,
        widgetBrandVisible: true,
        floatingBubbleVisible: false,
      });
      expect(await openMarketingFooterDocs(page)).toMatchObject({
        destinationHref: "https://docs.example.invalid",
        openedInNewTab: true,
      });
      expect(await page.evaluate(() => (window as unknown as Window & { sent: number }).sent)).toBe(0);
      expect(await openMarketingFooterContact(page)).toMatchObject({
        destinationHref: "/contact",
        finalUrl: "http://test.local/contact",
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("opens dashboard Support only after the account menu is ready and keeps Docs external", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: "http://test.local" });
      const page = await context.newPage();
      await installRoutes(page);
      await page.route("http://test.local/dashboard", (route) =>
        route.fulfill({ contentType: "text/html", body: dashboardPage })
      );
      await page.goto("/dashboard");

      expect(await openDashboardAccountMenu(page)).toEqual({
        docsVisible: true,
        menuVisible: true,
        supportEnabled: true,
        supportVisible: true,
      });
      expect(await openDashboardSupport(page)).toMatchObject({
        clicked: true,
        entryEnabled: true,
        entryVisible: true,
        sdkReady: true,
        widgetFrameVisible: true,
        widgetBrandVisible: true,
        floatingBubbleVisible: false,
      });
      expect(await openDashboardDocs(page)).toMatchObject({
        destinationHref: "https://docs.example.invalid",
        openedInNewTab: true,
      });
      expect(await page.evaluate(() => (window as unknown as Window & { sent: number }).sent)).toBe(0);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
