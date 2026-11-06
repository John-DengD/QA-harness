import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

export interface MemberPasswordPolicyFact {
  hint: string | null;
  minLength: number | null;
  required: boolean;
}

export interface AdminMemberPasswordPolicyObservation
  extends MemberPasswordPolicyFact {
  capturedAt: string;
  pageUrl: string;
}

export async function inspectAdminMemberPasswordPolicy(
  page: Page
): Promise<AdminMemberPasswordPolicyObservation> {
  await openAdminTeam(page);
  const dialog = await openCreateMemberDialog(page);
  const password = dialog.getByLabel("Password", { exact: true });
  const rawMinLength = await password.getAttribute("minlength");
  const parsedMinLength = rawMinLength === null ? null : Number(rawMinLength);

  return {
    hint: await password.getAttribute("placeholder"),
    minLength:
      parsedMinLength !== null && Number.isSafeInteger(parsedMinLength)
        ? parsedMinLength
        : null,
    required: (await password.getAttribute("required")) !== null,
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
  };
}

const openAdminTeam = async (page: Page): Promise<void> => {
  await goToAppPath(page, "/settings/team");
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
};

const openCreateMemberDialog = async (page: Page): Promise<Locator> => {
  const create = page.getByRole("button", { name: "Create Member", exact: true });
  await expect(create).toBeVisible();
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create Member" });
  await expect(dialog).toBeVisible();
  return dialog;
};

const findMemberRow = async (page: Page, email: string): Promise<Locator | null> => {
  await openAdminTeam(page);
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: email, exact: true }),
  });
  const pagination = page.getByRole("navigation", { name: "pagination" });

  for (let visited = 0; visited < 100; visited++) {
    if (await row.isVisible().catch(() => false)) return row;
    const next = pagination.getByRole("link", { name: "Go to next page" });
    if (!(await next.isVisible().catch(() => false))) return null;
    if ((await next.getAttribute("aria-disabled")) === "true") return null;

    const selected = pagination.locator('[aria-current="page"]');
    const currentPage = await selected.textContent();
    await next.click();
    await expect.poll(() => selected.textContent()).not.toBe(currentPage);
  }
  throw new Error("Admin Team pagination exceeded 100 pages");
};

export async function inspectAdminMember(
  page: Page,
  email: string
): Promise<{ memberVisible: boolean; rowText: string | null }> {
  const row = await findMemberRow(page, email);
  return {
    memberVisible: row !== null,
    rowText: row ? await row.innerText() : null,
  };
}

const openRemoveMemberDialog = async (
  page: Page,
  row: Locator,
  name: string,
  email: string
): Promise<Locator> => {
  await expect(row.getByRole("cell", { name: email, exact: true })).toBeVisible();
  await row.getByRole("button", { name: `Manage ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Member?" });
  await expect(dialog).toContainText(email);
  return dialog;
};

export interface AdminMemberInput {
  email: string;
  name: string;
  password: string;
}

export interface AdminMemberWriteFact {
  outcome: "created" | "recreated" | "removed" | "rejected" | "unknown" | "absent";
  responseStatus: number | null;
  memberVisible: boolean | null;
}

const confirmMemberVisibility = async (
  page: Page,
  email: string,
  expectedVisible: boolean
): Promise<boolean> => {
  let consecutiveMatches = 0;
  try {
    await expect
      .poll(
        async () => {
          try {
            const visible = (await findMemberRow(page, email)) !== null;
            consecutiveMatches = visible === expectedVisible ? consecutiveMatches + 1 : 0;
            return consecutiveMatches;
          } catch {
            consecutiveMatches = 0;
            return 0;
          }
        },
        { intervals: [150, 300, 600, 1_000], timeout: 6_000 }
      )
      .toBeGreaterThanOrEqual(2);
    return true;
  } catch {
    return false;
  }
};

const memberResponse = (page: Page, path: string): Promise<Response | null> =>
  page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        response.request().method() === "POST",
      { timeout: 20_000 }
    )
    .catch(() => null);

export async function createAdminMember(
  page: Page,
  input: AdminMemberInput
): Promise<AdminMemberWriteFact> {
  await openAdminTeam(page);
  const dialog = await openCreateMemberDialog(page);
  await dialog.getByLabel("Name", { exact: true }).fill(input.name);
  await dialog.getByLabel("Email", { exact: true }).fill(input.email);
  await dialog.getByLabel("Password", { exact: true }).fill(input.password);

  const responsePromise = memberResponse(page, "/api/admin/members");
  await dialog.getByRole("button", { name: "Create Member", exact: true }).click();
  const response = await responsePromise;
  const body = (await response?.json().catch(() => null)) as
    | { success?: boolean; created?: boolean; recreated?: boolean }
    | null;
  const accepted = response?.ok() && body?.success;
  const confirmedVisible = await confirmMemberVisibility(page, input.email, true);
  const outcome = !response
    ? "unknown"
    : !accepted
      ? "rejected"
      : !confirmedVisible
        ? "unknown"
        : body?.recreated
          ? "recreated"
          : body?.created
            ? "created"
            : "unknown";
  return {
    outcome,
    responseStatus: response?.status() ?? null,
    memberVisible: accepted && confirmedVisible ? true : null,
  };
}

export async function removeAdminMember(
  page: Page,
  input: Pick<AdminMemberInput, "email" | "name">
): Promise<AdminMemberWriteFact> {
  const row = await findMemberRow(page, input.email);
  if (!row) {
    const confirmedAbsent = await confirmMemberVisibility(page, input.email, false);
    return {
      outcome: confirmedAbsent ? "absent" : "unknown",
      responseStatus: null,
      memberVisible: confirmedAbsent ? false : null,
    };
  }
  const dialog = await openRemoveMemberDialog(page, row, input.name, input.email);
  const responsePromise = memberResponse(page, "/api/auth/organization/remove-member");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  const response = await responsePromise;
  const confirmedAbsent = await confirmMemberVisibility(page, input.email, false);
  return {
    outcome: !response
      ? "unknown"
      : !response.ok()
        ? "rejected"
        : confirmedAbsent
          ? "removed"
          : "unknown",
    responseStatus: response?.status() ?? null,
    memberVisible: response?.ok() && confirmedAbsent ? false : null,
  };
}
