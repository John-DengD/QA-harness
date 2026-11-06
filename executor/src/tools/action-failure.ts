import type { Page } from "@playwright/test";

/**
 * Why a library Action failed, read from the Playwright error alone.
 *
 * Script drift shows up as a locator that no longer finds, uniquely resolves
 * or reveals its element, or a wait for a route that never comes: the product
 * moved and the Action did not. Those failures are `driftSuspected`. A matcher
 * that found its element and read a different value (disabled, other text,
 * other count) is a business observation, and a 5xx, a dropped connection, a
 * page.goto timeout or a closed browser is the environment; neither is drift.
 */
export type ActionFailureCategory =
  | "locator_not_found"
  | "locator_timeout"
  | "locator_ambiguous"
  | "assertion"
  | "navigation_timeout"
  | "network"
  | "browser"
  | "origin"
  /** Not produced by the classifier: a drift reported by hand (Computer Use miss or a refuted read). */
  | "reported_drift"
  /** Not produced by the classifier: a completed read returned a declared drift sentinel (e.g. cardState "unrecognized"). */
  | "sentinel_drift"
  | "other";

export type ActionFailureClass = {
  category: ActionFailureCategory;
  driftSuspected: boolean;
  /** The Playwright locator the failure names, when it names one. */
  locator: string | null;
  timeoutMs: number | null;
  /** expect = an expect() wait, action = a locator action wait, navigation = a URL/route wait. */
  timeoutKind: "expect" | "action" | "navigation" | null;
};

const DRIFT_CATEGORIES = new Set<ActionFailureCategory>(["locator_not_found", "locator_timeout", "locator_ambiguous", "reported_drift", "sentinel_drift"]);
// Matchers whose failure means the element is not where the Action expects it.
const PRESENCE_MATCHERS = /^expect\(locator\)\.(?:not\.)?(?:toBeVisible|toBeAttached|toBeInViewport)\(/;

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match?.[1]?.trim() || null;
}

function result(category: ActionFailureCategory, locator: string | null,
  timeoutMs: number | null, timeoutKind: ActionFailureClass["timeoutKind"]): ActionFailureClass {
  return { category, driftSuspected: DRIFT_CATEGORIES.has(category), locator, timeoutMs, timeoutKind };
}

export function classifyActionFailure(error: string): ActionFailureClass {
  const text = error ?? "";
  const head = text.split("\n", 1)[0] ?? "";
  if (/Target (?:page, context or browser|closed)|browser has been closed|Browser closed|Session closed/i.test(text)) {
    return result("browser", null, null, null);
  }
  if (/net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|\b5\d\d (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b|\bstatus(?: code)?:? 5\d\d\b|\bHTTP 5\d\d\b/i.test(text)) {
    return result("network", null, null, null);
  }
  if (/left the expected app origin/.test(text)) return result("origin", null, null, null);

  const actionTimeout = /^(?:page|frame)\.(goto|reload|waitForURL|waitForNavigation|waitForLoadState|goBack|goForward): Timeout (\d+)ms exceeded/.exec(head);
  if (actionTimeout) {
    const ms = Number(actionTimeout[2]);
    // A route or redirect that never arrives is a moved page; a slow load is the environment.
    return actionTimeout[1] === "waitForURL" || actionTimeout[1] === "waitForNavigation"
      ? result("locator_timeout", null, ms, "navigation")
      : result("navigation_timeout", null, ms, "navigation");
  }

  const strict = /strict mode violation: (.+?) resolved to \d+ elements/.exec(text);
  if (strict) return result("locator_ambiguous", strict[1].trim(), null, null);

  // expect(locator, "custom message") puts the message first: look for the matcher line anywhere.
  const matcher = text.split("\n").map((line) => line.trim()).find((line) => /^expect\(locator\)/.test(line));
  if (matcher) {
    const locator = firstMatch(text, /^Locator: (.+)$/m);
    const timeout = firstMatch(text, /^Timeout: (\d+)ms$/m);
    const timeoutMs = timeout === null ? null : Number(timeout);
    // Zero matches is drift whatever the matcher (toBeEnabled, toHaveText...): the element the
    // Action relies on is gone or renamed. Only a found element in the wrong state is an assertion.
    if (/element\(s\) not found/.test(text)) return result("locator_not_found", locator, timeoutMs, "expect");
    if (PRESENCE_MATCHERS.test(matcher)) return result("locator_timeout", locator, timeoutMs, "expect");
    const neverResolved = /^\s*-\s*waiting for /m.test(text) && !/locator resolved to|unexpected value/.test(text) &&
      !/^Received(?: string| value)?:/m.test(text);
    if (neverResolved) return result("locator_not_found", locator, timeoutMs, "expect");
    return result("assertion", locator, timeoutMs, "expect");
  }

  const locatorTimeout = /^locator\.\w+: Timeout (\d+)ms exceeded/.exec(head);
  if (locatorTimeout || /^TimeoutError/.test(head)) {
    const locator = firstMatch(text, /waiting for (.+)$/m);
    return result("locator_timeout", locator, locatorTimeout ? Number(locatorTimeout[1]) : null, "action");
  }
  if (/^expect(?:\.poll)?\(|^expect\(received\)|Expected:|Received:/m.test(text)) return result("assertion", null, null, null);
  return result("other", null, null, null);
}

// Error text that shows Playwright did find the element (and then read another state or value).
const ELEMENT_FOUND = /locator resolved to|unexpected value|^Received(?: string| value)?: (?!<element\(s\) not found>|undefined\b)/m;

/**
 * Second look at an `assertion` once the failure page's aria snapshot is known.
 *
 * When the error text alone gives no sign the element was found, and every
 * accessible name / text the locator asks for (getByRole name, getByText,
 * getByLabel...) is absent from the snapshot, the control the Action relies on
 * is gone or renamed (e.g. "Switch to Traffic" became "Draft as Traffic"):
 * that is locator drift. A found element in another state stays an assertion,
 * and an unnamed locator (CSS, test id) is left as classified.
 */
export function refineFailureWithSnapshot(
  failure: ActionFailureClass, error: string, ariaSnapshot: string | null | undefined,
): ActionFailureClass {
  if (failure.category !== "assertion" || !failure.locator || !ariaSnapshot) return failure;
  if (ELEMENT_FOUND.test(error ?? "")) return failure;
  const names = locatorSearchTexts(failure.locator);
  if (!names.length) return failure;
  const snapshot = ariaSnapshot.toLowerCase();
  if (names.some((name) => snapshot.includes(name.toLowerCase()))) return failure;
  return result("locator_not_found", failure.locator, failure.timeoutMs, failure.timeoutKind ?? "expect");
}

/**
 * Keeps the readable part of a snapshot or error and drops what must not leave
 * the run: URL query strings and fragments, JWTs, API keys, cookies, bearer
 * tokens, password-like assignments and email addresses. Capped in size.
 */
export function redactSnapshotText(text: string, maxChars = 20_000): string {
  let out = text
    .replace(/\bhttps?:\/\/[^\s'"`<>)\]]+/g, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return url.replace(/[?#].*$/, "");
      }
    })
    .replace(/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted-jwt]")
    .replace(/\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+/g, "[redacted-key]")
    .replace(/\be2b_[A-Za-z0-9]{8,}/g, "[redacted-key]")
    .replace(/\b(set-cookie|cookie)\s*:\s*[^\n]*/gi, "$1: [redacted]")
    .replace(/\b(authorization)\s*:\s*[^\n]*/gi, "$1: [redacted]")
    .replace(/\bBearer\s+[\w.~+/=-]+/g, "Bearer [redacted]")
    .replace(/\b(password|passwd|secret|token|api[_-]?key|__clerk_\w+|__session)\s*[:=]\s*[^\s;,&]+/gi, "$1=[redacted]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[redacted-email]")
    .replace(/[?&][\w-]+=[^\s&'"]*/g, "");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n… [truncated ${out.length - maxChars} chars]`;
  return out;
}

export type FailureSnapshot = {
  /** Origin and path only. */
  url: string | null;
  title: string | null;
  /** The region the snapshot covers: main when the page has one, else body. */
  region: "main" | "body" | null;
  /** Playwright aria snapshot (roles and accessible names), redacted. */
  ariaSnapshot: string | null;
  capturedAt: string;
  captureError: string | null;
};

type SnapshotPage = Pick<Page, "url" | "title" | "locator">;

/** A redacted accessibility snapshot of the failure page, for drift diagnosis. Never throws. */
export async function captureFailureSnapshot(page: SnapshotPage): Promise<FailureSnapshot> {
  const capturedAt = new Date().toISOString();
  let url: string | null = null;
  let title: string | null = null;
  const errors: string[] = [];
  try {
    const parsed = new URL(page.url());
    url = `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    title = redactSnapshotText(await page.title(), 200);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  for (const region of ["main", "body"] as const) {
    try {
      const target = page.locator(region).first();
      if (!(await target.count())) continue;
      const snapshot = await target.ariaSnapshot({ timeout: 5_000 });
      return { url, title, region, ariaSnapshot: redactSnapshotText(snapshot), capturedAt, captureError: null };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { url, title, region: null, ariaSnapshot: null, capturedAt,
    captureError: redactSnapshotText(errors.join("; ") || "no main or body region", 500) };
}

/**
 * Texts worth searching the product source for: string arguments and the
 * alternatives of regex names in a Playwright locator. Role names are dropped.
 */
export function locatorSearchTexts(locator: string | null): string[] {
  if (!locator) return [];
  const texts: string[] = [];
  const add = (text: string) => {
    const clean = text.trim();
    if (clean.length > 1 && !texts.includes(clean)) texts.push(clean);
  };
  for (const match of locator.matchAll(/getBy(?:Text|Label|Placeholder|Title|AltText|TestId)\('((?:[^'\\]|\\.)*)'/g)) add(match[1]);
  for (const match of locator.matchAll(/name: '((?:[^'\\]|\\.)*)'/g)) add(match[1]);
  for (const match of locator.matchAll(/(?:name: |getBy\w+\()\/((?:[^/\\]|\\.)+)\/[a-z]*/g)) {
    const body = match[1].replace(/^\^/, "").replace(/\$$/, "").replace(/^\(\?:/, "").replace(/\)$/, "");
    for (const part of body.split("|")) {
      if (/^[\w ./&'-]+$/.test(part)) add(part.replace(/\\/g, ""));
    }
  }
  // Keep order of first appearance in the locator text.
  return texts.sort((a, b) => locator.indexOf(a) - locator.indexOf(b));
}

/** The operator's next move after a drift-suspected failure. */
export function driftNextStep(action: string): string {
  return `Suspected script drift (locator/timeout failure). Finish this intent now with Computer Use and log it as ` +
    `--miss-reason drift --miss-action ${action}; do not retry the Action blindly. At closeout run ` +
    `pnpm action:drift list, repair the Action against the target product source, then pnpm action:drift verify ${action}.`;
}
