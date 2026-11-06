import { actionTableEntry, type ActionTableEntry, type RollbackLevel } from "./action-table";

/**
 * Shared E2B execution is default-allow. `e2b:action` only drives a page whose
 * origin `targetOrigin` (e2b-shared-browser.ts) has pinned to staging or a PR
 * sandbox, so no Action in the library can reach production, and money spent
 * there is test money. What stays out is what that origin pin cannot make safe.
 *
 * Every entry says why and what to use instead; the refusal prints both.
 * A denied Action still has its row in the Action table (action-catalog.json),
 * whose `denied` field repeats why; the table describes, this list decides.
 *
 * Not in the library yet, but must be added here when it is written: the
 * Google tracker *install* Action. Installing the tracker cannot be undone on
 * staging and would spend the shared QA organizations' tracking setup.
 */
const SECRET_ARGS = "its arguments are secrets, and --args-json puts them into the shell history and the host process list";

export const SHARED_ACTION_DENYLIST: Readonly<Record<string, string>> = {
  signInAdmin: `${SECRET_ARGS} (email + password). Use signInAdminFromEnv / signInSecondAdminFromEnv / signInReadOnlyAdminFromEnv, which read qa-env inside the process`,
  submitSignInPassword: `${SECRET_ARGS} (password). Sign in with a *FromEnv Action or a Clerk sign-in token, or type it through Computer Use`,
  submitSignUpCredentials: `${SECRET_ARGS} (email + password). Create the account through the disposable-account control API or Computer Use`,
  submitDeferredSignUpPassword: `${SECRET_ARGS} (password). Use the disposable-account control API or Computer Use`,
  submitSignInSecondFactor: `${SECRET_ARGS} (one-time code). Enter the code through Computer Use`,
  submitSignUpVerificationCode: `${SECRET_ARGS} (verification code). Enter the code through Computer Use`,
  createAdminMember: `${SECRET_ARGS} (the new member's password). Create the member through Computer Use`,
  prepareWalletCardPayment: `${SECRET_ARGS} (card number, expiry and CVC). Fill the card through Computer Use`,
  submitWalletPayment: "it only completes the card flow that prepareWalletCardPayment fills from --args-json card details (card number, expiry, CVC), which would sit in the shell history and the host process list. Pay through Computer Use, or top up with adminTopUpOrganization",
};

/** Organization ids are UUIDs; anything else is a redirect or injection attempt. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const EMAIL = /^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/;

/** Why an Action may not run in a shared E2B browser, or undefined when it may. */
export function sharedActionDenial(name: string): string | undefined {
  return Object.hasOwn(SHARED_ACTION_DENYLIST, name) ? SHARED_ACTION_DENYLIST[name] : undefined;
}

/** Throws the denial reason; call it before reading anything else for the run. */
export function assertSharedActionNotDenied(name: string): void {
  const reason = sharedActionDenial(name);
  if (reason) throw new Error(`Action ${name} is denied for shared E2B execution: ${reason}`);
}

/** The Action's table row; throws when the library Action has none. */
export function sharedActionRow(name: string): ActionTableEntry {
  const row = actionTableEntry(name);
  if (!row) {
    throw new Error(`Action ${name} has no row in the Action table (src/tools/action-catalog.json); add its intent and rollback level first`);
  }
  return row;
}

/** The rollback level the Action's author wrote in the table. Callers never supply it. */
export function sharedActionRollback(name: string): RollbackLevel {
  return sharedActionRow(name).rollback;
}

/** The fixed QA accounts in qa-env (E2E_ACCOUNT_EMAIL*, E2E_ADMIN_EMAIL*), lower-cased. */
export function sharedQaAccountEmails(env: Readonly<Record<string, string | undefined>>): Set<string> {
  return new Set(Object.entries(env)
    .filter(([key, value]) => /^E2E_(?:ACCOUNT|ADMIN)_EMAIL\d*$/.test(key) && value?.trim())
    .map(([, value]) => value!.trim().toLowerCase()));
}

/**
 * Throws unless the Action may run in a shared E2B browser with these
 * arguments. A denied Action never runs. The rollback level is not checked
 * here: it is a property in the table, not a permission. A row that fixes
 * `args` must get exactly that many; otherwise the imported function's formal
 * parameters (minus page) bound the count. The per-Action argument checks
 * below (UUIDs, money caps, free-text limits, shared accounts) always apply.
 */
export function validateSharedAction(
  name: string,
  args: readonly unknown[],
  action?: (...params: never[]) => unknown,
  env: Readonly<Record<string, string | undefined>> = process.env
): void {
  assertSharedActionNotDenied(name);
  const row = sharedActionRow(name);
  if (row.args === undefined) {
    if (typeof action !== "function") {
      throw new Error(`Action ${name} fixes no argument count: its formal parameters are needed to bound the arguments`);
    }
    const maxArgs = Math.max(0, action.length - 1);
    if (args.length > maxArgs) {
      throw new Error(`Action ${name} accepts at most ${maxArgs} argument(s) after page`);
    }
  } else if (args.length !== row.args) {
    throw new Error(`Action ${name} requires ${row.args} argument(s) after page`);
  }
  if (name === "openExistingCampaignDetail" &&
      (typeof args[0] !== "string" || !UUID.test(args[0]))) {
    throw new Error("Campaign detail Action requires a campaign UUID");
  }
  // The goal is free text handed to the Campaign Agent. Shared execution keeps
  // it to one short line of plain words: Enter submits, so a newline would
  // split it; a URL or email would point the Agent at outside content or put
  // personal data into the draft and the evidence; markup has no place in a goal.
  if (name === "submitCampaignGoal" &&
      (typeof args[0] !== "string" || args[0].trim().length < 8 || args[0].length > 300 ||
       /[\x00-\x1f\x7f<>]|:\/\/|\bwww\.|@/i.test(args[0]))) {
    throw new Error("Campaign goal Action requires one plain line of 8 to 300 characters without URLs, emails or markup");
  }
  // Quick-goal chip: the label is matched against visible button text, so keep it a short plain phrase.
  if (name === "submitCampaignGoalFromChip" &&
      (typeof args[0] !== "string" || args[0].trim().length < 3 || args[0].length > 120 ||
       /[\x00-\x1f\x7f<>]|:\/\/|\bwww\.|@/i.test(args[0]))) {
    throw new Error("Campaign goal chip Action requires one plain chip label of 3 to 120 characters without URLs, emails or markup");
  }
  // Draft name: one plain line within the product's 255-character limit; the name lands in the draft and the evidence.
  if (name === "renameCampaignDraft" &&
      (typeof args[0] !== "string" || !args[0].trim() || args[0].length > 255 ||
       /[\x00-\x1f\x7f<>]|:\/\/|\bwww\.|@/i.test(args[0]))) {
    throw new Error("Campaign rename Action requires one plain line of 1 to 255 characters without URLs, emails or markup");
  }
  if (name === "openCampaignDraft" &&
      (typeof args[0] !== "string" || !/^[a-f0-9-]{36}$/i.test(args[0]))) {
    throw new Error("Campaign draft Action requires a UUID");
  }
  if (name === "selectOrganization" &&
      (typeof args[0] !== "string" || !args[0] || args[0].length > 100 ||
       /[\r\n\x00-\x1f]|:\/\/|@/.test(args[0]))) {
    throw new Error("Organization Action requires a short organization name");
  }
  if ((name === "openOrganizationTransactions" || name === "adminTopUpOrganization" ||
       name === "reverseAdminTopUp") &&
      (typeof args[0] !== "string" || !UUID.test(args[0]))) {
    throw new Error(`${name} requires an organization UUID`);
  }
  // Caps the blast radius of a money-moving Action driven from a shared browser:
  // two decimals, at most 999.99, and nothing that could ride along as a second value.
  if (name === "adminTopUpOrganization" &&
      (typeof args[1] !== "string" || !/^\d{1,3}(\.\d{1,2})?$/.test(args[1]) ||
       Number(args[1]) <= 0)) {
    throw new Error("Admin top-up Action requires an amount of at most 999.99");
  }
  if (name === "reverseAdminTopUp" &&
      (typeof args[1] !== "string" || args[1].trim().length < 8 || args[1].length > 300 ||
       /[\r\n\x00-\x1f]/.test(args[1]))) {
    throw new Error("Reversal Action requires a single-line reason of 8 to 300 characters");
  }
  if (name === "inspectAdminMember" &&
      (typeof args[0] !== "string" || args[0].length > 254 || !EMAIL.test(args[0]))) {
    throw new Error("Admin member Action requires an email address");
  }
  if (name === "removeAdminMember") {
    const input = args[0] as { email?: unknown; name?: unknown } | null;
    const email = typeof input?.email === "string" ? input.email.trim() : "";
    if (!input || typeof input !== "object" || !email || email.length > 254 || !EMAIL.test(email) ||
        typeof input.name !== "string" || !input.name.trim() || input.name.length > 100 ||
        /[\r\n\x00-\x1f]/.test(input.name)) {
      throw new Error("Remove-member Action requires { email, name } with an email address and a short name");
    }
    const shared = sharedQaAccountEmails(env);
    if (!shared.size) {
      throw new Error("Remove-member Action needs qa-env loaded to know the shared QA accounts it must not remove");
    }
    if (shared.has(email.toLowerCase())) {
      throw new Error("Remove-member Action refuses to remove a shared QA account registered in qa-env (E2E_ACCOUNT_EMAIL*/E2E_ADMIN_EMAIL*); remove a disposable member instead");
    }
  }
}

export function sanitizeSharedActionFact(value: unknown, key = ""): unknown {
  if (typeof value === "string" && /url/i.test(key)) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value.split(/[?#]/, 1)[0];
    }
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSharedActionFact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) =>
      [name, sanitizeSharedActionFact(item, name)]));
  }
  return value;
}
