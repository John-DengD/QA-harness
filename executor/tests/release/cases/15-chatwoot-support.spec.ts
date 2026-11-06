import { expect, test } from "../../../src/fixtures";
import { accountTest } from "../../../src/account-fixtures";
import {
  openDashboardAccountMenu,
  openDashboardDocs,
  openDashboardSupport,
  openMarketingFooterContact,
  openMarketingFooterDocs,
  openMarketingSupport,
} from "../../../src/actions/support-actions";

const MARKETING_URL =
  "https://hellyeah-landing-page-git-mohit-pe-580-re-3c6e63-final-round-ai.vercel.app/";
const DASHBOARD_URL =
  "https://hellyeah-dashboard-git-mohit-pe-580-repla-3834b0-final-round-ai.vercel.app/";

test(
  "PE-599 marketing footer Support opens Chatwoot without a floating bubble",
  { tag: ["@case:chatwoot-marketing", "@qa:pe-599"] },
  async ({ page }, testInfo) => {
    await page.goto(MARKETING_URL);
    const support = await openMarketingSupport(page);
    expect(support, "marketing Support must be visible and Chatwoot-ready").toMatchObject({
      clicked: true,
      entryVisible: true,
      entryEnabled: true,
      sdkReady: true,
      widgetFrameVisible: true,
      widgetBrandVisible: true,
      floatingBubbleVisible: false,
    });

    const docs = await openMarketingFooterDocs(page);
    expect(docs).toMatchObject({
      openedInNewTab: true,
      openedUrl: expect.stringContaining("docs.hellyeahai.com"),
    });

    const contact = await openMarketingFooterContact(page);
    expect(contact.finalUrl).toMatch(/\/contact(?:$|[?#])/);
    await testInfo.attach("pe-599-marketing-facts", {
      body: JSON.stringify({ support, docs, contact }, null, 2),
      contentType: "application/json",
    });
  }
);

accountTest(
  "PE-599 dashboard account Support opens Chatwoot and Docs externally",
  { tag: ["@case:chatwoot-dashboard", "@qa:pe-599"] },
  async ({ page }, testInfo) => {
    await page.goto(DASHBOARD_URL);
    const menu = await openDashboardAccountMenu(page);
    expect(menu, "signed-in account menu must expose Support and Docs").toMatchObject({
      menuVisible: true,
      supportVisible: true,
      supportEnabled: true,
      docsVisible: true,
    });

    const support = await openDashboardSupport(page);
    expect(support, "dashboard Support must open Chatwoot").toMatchObject({
      clicked: true,
      entryVisible: true,
      entryEnabled: true,
      sdkReady: true,
      widgetFrameVisible: true,
      widgetBrandVisible: true,
      floatingBubbleVisible: false,
    });

    const docs = await openDashboardDocs(page);
    expect(docs).toMatchObject({
      openedInNewTab: true,
      openedUrl: expect.stringContaining("docs.hellyeahai.com"),
    });
    await testInfo.attach("pe-599-dashboard-facts", {
      body: JSON.stringify({ menu, support, docs }, null, 2),
      contentType: "application/json",
    });
  }
);
