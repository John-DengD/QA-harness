import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import {
  createAdminMember,
  inspectAdminMember,
  inspectAdminMemberPasswordPolicy,
  removeAdminMember,
} from "../../src/actions/admin-team-actions";

it("observes the Admin Team password hint without deciding the policy", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/settings/team", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>Team</h1><button id="open">Create Member</button>
          <div role="dialog" aria-label="Create Member" hidden>
            <label for="password">Password</label>
            <input id="password" type="password" minlength="8" required placeholder="Minimum 8 characters">
          </div>
          <script>document.querySelector('#open').onclick = () => {
            document.querySelector('[role=dialog]').hidden = false;
          };</script>`,
      })
    );

    const observed = await inspectAdminMemberPasswordPolicy(page);
    expect(observed).toMatchObject({
      hint: "Minimum 8 characters",
      minLength: 8,
      pageUrl: "http://test.local/settings/team",
      required: true,
    });
    expect(new Date(observed.capturedAt).toString()).not.toBe("Invalid Date");
  } finally {
    await browser.close();
  }
}, 20_000);

it("finds a member by exact email across Team pages", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    await page.route("http://test.local/settings/team", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<h1>Team</h1>
          <table><tbody id="members"><tr><td>Other</td><td>other@example.invalid</td></tr></tbody></table>
          <nav aria-label="pagination">
            <a aria-current="page">1</a><a>2</a>
            <a href="#" aria-label="Go to next page">Next</a>
          </nav>
          <script>document.querySelector('[aria-label="Go to next page"]').onclick = (event) => {
            event.preventDefault();
            document.querySelector('[aria-current="page"]').removeAttribute('aria-current');
            document.querySelectorAll('nav a')[1].setAttribute('aria-current', 'page');
            document.querySelector('#members').innerHTML =
              '<tr><td>QA Member</td><td>qa@example.invalid</td><td>read</td></tr>';
          };</script>`,
      })
    );

    const member = await inspectAdminMember(page, "qa@example.invalid");
    expect(member.memberVisible).toBe(true);
    expect(member.rowText).toContain("QA Member");
    expect(await page.locator('[aria-current="page"]').textContent()).toBe("2");
  } finally {
    await browser.close();
  }
}, 20_000);

it("creates and removes only the exact synthetic member", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    const input = {
      email: "qa@example.invalid",
      name: "QA Member",
      password: "synthetic-password-123",
    };
    let present = false;
    let creates = 0;
    let removes = 0;
    let staleCreateReads = 2;
    let staleRemoveReads = 2;
    await page.route("http://test.local/settings/team", (route) => {
      const listed = removes
        ? staleRemoveReads-- > 0
        : creates
          ? staleCreateReads-- > 0
            ? false
            : present
          : present;
      return route.fulfill({
        contentType: "text/html",
        body: `<h1>Team</h1><button id="open">Create Member</button>
          <table><tbody>${listed ? `<tr><td>${input.name}</td><td>${input.email}</td>
            <td>read</td><td><button aria-label="Manage ${input.name}">Manage</button></td></tr>` : ""}</tbody></table>
          <div role="dialog" aria-label="Create Member" hidden><form id="create">
            <label>Name<input name="name" required></label>
            <label>Email<input name="email" type="email" required></label>
            <label>Password<input name="password" type="password" required></label>
            <button>Create Member</button></form></div>
          <div role="menu" hidden><button role="menuitem">Remove</button></div>
          <div role="dialog" aria-label="Remove Member?" hidden>
            Remove ${input.name} (${input.email})?<button>Remove</button></div>
          <script>
            const createDialog = document.querySelector('[aria-label="Create Member"]');
            const removeDialog = document.querySelector('[aria-label="Remove Member?"]');
            document.querySelector('#open').onclick = () => createDialog.hidden = false;
            document.querySelector('#create').onsubmit = async (event) => {
              event.preventDefault();
              const response = await fetch('/api/admin/members', { method: 'POST' });
              if (response.ok) createDialog.hidden = true;
            };
            const manage = document.querySelector('[aria-label="Manage ${input.name}"]');
            if (manage) manage.onclick = () => document.querySelector('[role="menu"]').hidden = false;
            document.querySelector('[role="menuitem"]').onclick = () => removeDialog.hidden = false;
            removeDialog.querySelector('button').onclick = async () => {
              const response = await fetch('/api/auth/organization/remove-member', { method: 'POST' });
              if (response.ok) removeDialog.hidden = true;
            };
          </script>`,
      });
    });
    await page.route("http://test.local/api/admin/members", (route) => {
      creates++;
      present = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, created: true }),
      });
    });
    await page.route("http://test.local/api/auth/organization/remove-member", (route) => {
      removes++;
      present = false;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });

    expect(await createAdminMember(page, input)).toMatchObject({
      outcome: "created",
      memberVisible: true,
    });
    expect(await removeAdminMember(page, input)).toMatchObject({
      outcome: "removed",
      memberVisible: false,
    });
    expect({ creates, removes }).toEqual({ creates: 1, removes: 1 });
    expect(staleCreateReads).toBeLessThan(0);
    expect(staleRemoveReads).toBeLessThan(0);
  } finally {
    await browser.close();
  }
}, 20_000);

it("returns unknown after a successful removal whose absence never becomes observable", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let removes = 0;
    let reads = 0;
    await page.route("http://test.local/settings/team", (route) => {
      reads++;
      return route.fulfill({
        contentType: "text/html",
        body: `<h1>Team</h1><table><tr><td>QA Member</td><td>qa@example.invalid</td>
          <td><button aria-label="Manage QA Member">Manage</button></td></tr></table>
          <div role="menu" hidden><button role="menuitem">Remove</button></div>
          <div role="dialog" aria-label="Remove Member?" hidden>
            Remove qa@example.invalid?<button>Remove</button></div>
          <script>
            document.querySelector('[aria-label="Manage QA Member"]').onclick = () =>
              document.querySelector('[role="menu"]').hidden = false;
            document.querySelector('[role="menuitem"]').onclick = () =>
              document.querySelector('[role="dialog"]').hidden = false;
            document.querySelector('[role="dialog"] button').onclick = () =>
              fetch('/api/auth/organization/remove-member', { method: 'POST' });
          </script>`,
      });
    });
    await page.route("http://test.local/api/auth/organization/remove-member", (route) => {
      removes++;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });

    expect(await removeAdminMember(page, { email: "qa@example.invalid", name: "QA Member" })).toEqual({
      outcome: "unknown",
      responseStatus: 200,
      memberVisible: null,
    });
    expect(removes).toBe(1);
    expect(reads).toBeGreaterThan(2);
  } finally {
    await browser.close();
  }
}, 20_000);

it("returns unknown after a successful creation whose membership never becomes observable", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let creates = 0;
    let reads = 0;
    await page.route("http://test.local/settings/team", (route) => {
      reads++;
      return route.fulfill({
        contentType: "text/html",
        body: `<h1>Team</h1><button id="open">Create Member</button><table></table>
          <div role="dialog" aria-label="Create Member" hidden><form id="create">
            <label>Name<input name="name"></label>
            <label>Email<input name="email" type="email"></label>
            <label>Password<input name="password" type="password"></label>
            <button>Create Member</button></form></div>
          <script>
            document.querySelector('#open').onclick = () =>
              document.querySelector('[role="dialog"]').hidden = false;
            document.querySelector('#create').onsubmit = (event) => {
              event.preventDefault();
              fetch('/api/admin/members', { method: 'POST' });
            };
          </script>`,
      });
    });
    await page.route("http://test.local/api/admin/members", (route) => {
      creates++;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, created: true }),
      });
    });

    expect(
      await createAdminMember(page, {
        email: "qa@example.invalid",
        name: "QA Member",
        password: "synthetic-password-123",
      })
    ).toEqual({ outcome: "unknown", responseStatus: 200, memberVisible: null });
    expect(creates).toBe(1);
    expect(reads).toBeGreaterThan(2);
  } finally {
    await browser.close();
  }
}, 20_000);

it("confirms an already absent member with fresh reads and without a removal request", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let reads = 0;
    let removes = 0;
    await page.route("http://test.local/settings/team", (route) => {
      reads++;
      return route.fulfill({ contentType: "text/html", body: "<h1>Team</h1><table></table>" });
    });
    await page.route("http://test.local/api/auth/organization/remove-member", (route) => {
      removes++;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });

    expect(await removeAdminMember(page, { email: "qa@example.invalid", name: "QA Member" })).toEqual({
      outcome: "absent",
      responseStatus: null,
      memberVisible: false,
    });
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(removes).toBe(0);
  } finally {
    await browser.close();
  }
}, 20_000);
