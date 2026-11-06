import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  bindSelectedMetaPage,
  fillInstantFormPolicyUrl,
  openCustomerCancelConfirmation,
  openInstantFormEditor,
  readInstantFormReadiness,
  readMetaPageBinding,
  saveInstantForm,
  selectMetaPage,
  setFullAutoEnrollment,
  cancelCustomerCampaignOnce,
} from "../../src/actions/meta-leads-actions";
import {
  approveAdminCampaignOnce,
  fillAdminApprovalReason,
  openAdminApprovalPreview,
  readAdminSetupOutcome,
  selectAdminCampaignVersion,
} from "../../src/actions/admin-meta-leads-actions";
import { submitCampaignLaunch } from "../../src/actions/campaign-actions";

it("selects a parameterized Page and saves a policy URL without submitting a Campaign", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section data-slot="meta-page-panel">
      <div role="radiogroup" aria-label="Facebook Page">
        <label role="radio" aria-checked="false" tabindex="0">Demo Page</label>
      </div><button id="bind">Use This Page</button>
    </section>
    <section data-slot="instant-form">
      <button id="edit">Edit Form</button>
      <div data-slot="instant-form-editor" hidden><label>Policy URL<input></label></div>
      <button id="save">Save Changes</button><p role="status"></p>
    </section>
    <div data-slot="launch-readiness">Draft ready for review. Instant Form Ready</div>
    <button role="switch" aria-label="Enroll in Full-Auto Optimization" aria-checked="true"></button>
    <script>
      const radio = document.querySelector('[role=radio]');
      radio.onclick = () => radio.setAttribute('aria-checked', 'true');
      document.querySelector('#bind').onclick = () => document.querySelector('[data-slot=meta-page-panel]').innerHTML = 'Facebook Page · Demo Page';
      document.querySelector('#edit').onclick = () => document.querySelector('[data-slot=instant-form-editor]').hidden = false;
      document.querySelector('#save').onclick = () => document.querySelector('[role=status]').textContent = 'Form saved';
      const toggle = document.querySelector('[role=switch]');
      toggle.onclick = () => toggle.setAttribute('aria-checked', 'false');
    </script>`);

    expect((await selectMetaPage(page, "Demo Page")).selectedPage).toBe("Demo Page");
    expect((await bindSelectedMetaPage(page, "Demo Page")).boundPage).toBe("Demo Page");
    expect((await readMetaPageBinding(page)).pageName).toBe("Demo Page");
    await openInstantFormEditor(page);
    expect((await fillInstantFormPolicyUrl(page, "https://example.com/privacy")).policyUrl)
      .toBe("https://example.com/privacy");
    expect((await saveInstantForm(page)).saved).toBe(true);
    expect((await readInstantFormReadiness(page)).ready).toBe(true);
    expect((await setFullAutoEnrollment(page, false)).enabled).toBe(false);
  } finally {
    await browser.close();
  }
}, 35_000);

it("approves and attempts cancellation exactly once on the requested Campaign", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: "https://admin.test" });
    let approvals = 0;
    let cancellations = 0;
    await page.route("https://admin.test/campaigns/campaign-1", route => route.fulfill({
      contentType: "text/html",
      body: `<button id="approve-open">Approve</button>
        <div role="dialog" aria-label="Approve campaign" hidden>
          <div>Launch readiness</div><div>Launchable</div>
          <label>Approval reason<textarea></textarea></label><button id="approve-submit">Approve</button>
        </div>
        <button role="combobox" aria-label="Campaign version">Campaign v2</button>
        <div role="option" hidden>Campaign v1</div>
        <div>Setup Pending</div><div><span>Lead webhook</span><span>DENIED</span></div>
        <section><h3>Provider operation</h3>No provider operation yet</section>
        <script>
          document.querySelector('#approve-open').onclick = () => document.querySelector('[role=dialog]').hidden = false;
          document.querySelector('[role=combobox]').onclick = () => document.querySelector('[role=option]').hidden = false;
          document.querySelector('[role=option]').onclick = () => document.querySelector('[role=combobox]').textContent = 'Campaign v1';
          document.querySelector('#approve-submit').onclick = () => fetch('/api/admin/managed-ads/admin/campaigns/campaign-1/approve', {method:'POST'});
        </script>`,
    }));
    await page.route("**/campaigns/campaign-1/approve", route => {
      approvals += 1;
      return route.fulfill({ status: 200, body: "{}" });
    });
    await page.goto("/campaigns/campaign-1");
    expect((await openAdminApprovalPreview(page, "campaign-1")).readiness).toContain("Launchable");
    await fillAdminApprovalReason(page, "Controlled test review");
    expect((await approveAdminCampaignOnce(page, "campaign-1")).responseStatus).toBe(200);
    expect(approvals).toBe(1);
    expect((await readAdminSetupOutcome(page, "campaign-1")).leadWebhookText).toContain("DENIED");
    expect((await selectAdminCampaignVersion(page, 1)).version).toBe(1);

    await page.route("https://admin.test/campaigns/campaign-2", route => route.fulfill({
      contentType: "text/html",
      body: `<button id="open">Cancel Campaign</button>
        <div role="alertdialog" aria-label="Cancel This Campaign?" hidden>
          Refund $50 now <button id="commit">Cancel Campaign</button>
        </div>
        <script>
          document.querySelector('#open').onclick = () => document.querySelector('[role=alertdialog]').hidden = false;
          document.querySelector('#commit').onclick = () => fetch('/api/v1/campaigns/campaign-2/cancel', {method:'POST'});
        </script>`,
    }));
    await page.route("**/campaigns/campaign-2/cancel", route => {
      cancellations += 1;
      return route.fulfill({ status: 409, body: "{}" });
    });
    await page.goto("/campaigns/campaign-2");
    expect((await openCustomerCancelConfirmation(page)).dialogText).toContain("$50");
    await expect(cancelCustomerCampaignOnce(page, "campaign-1")).rejects.toThrow(/does not match/);
    expect((await cancelCustomerCampaignOnce(page, "campaign-2")).responseStatus).toBe(409);
    expect(cancellations).toBe(1);
  } finally {
    await browser.close();
  }
}, 45_000);

it("submits a ready Instant Form for review through the existing one-shot launch action", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: "https://customer.test" });
    let submissions = 0;
    await page.route("https://customer.test/campaigns/new", route => route.fulfill({
      contentType: "text/html",
      body: `<button id="submit">Submit for Review</button>
        <script>document.querySelector('#submit').onclick = () => fetch('/api/v1/campaigns/launch', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: 'Controlled Leads campaign'})
        });</script>`,
    }));
    await page.route("https://customer.test/api/v1/campaigns/launch", route => {
      submissions += 1;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ id: "campaign-leads-1", funded: true }),
      });
    });
    await page.goto("/campaigns/new");
    const result = await submitCampaignLaunch(page);
    expect(result).toMatchObject({ campaignId: "campaign-leads-1", responseStatus: 202 });
    expect(submissions).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);
