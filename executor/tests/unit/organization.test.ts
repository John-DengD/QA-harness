import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { selectOrganization } from "../../src/actions/meta-byo-actions";

it("switches to the requested organization and returns the observed name", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/api/proxy/api/v1/me", route => route.fulfill({json:{orgs:[{id:"target-org",name:"fr-test"}]}}));
    await page.route("http://test.local/", (route) =>
      route.fulfill({
        body: `<button>fr-test</button><button id="switcher"><span>other-org</span><svg class="lucide lucide-chevrons-up-down"></svg></button>
      <div id="menu" role="menu" hidden>
        <button role="menuitem"><img alt="fr-test"><span>fr-test</span><span>Owner</span></button>
      </div>
      <script>
        document.querySelector('#switcher').onclick = () => document.querySelector('#menu').hidden = false;
        document.querySelector('[role=menuitem]').onclick = () => {
          document.querySelector('#switcher span').textContent = 'fr-test';
          sessionStorage.setItem('hellyeah:active-org:user', 'target-org');
          document.querySelector('#menu').hidden = true;
        };
      </script>`,
        contentType: "text/html",
      })
    );
    await expect(selectOrganization(page, "fr-test")).resolves.toEqual({
      activeOrganization: "fr-test",
    });
  } finally {
    await browser.close();
  }
}, 20_000);
