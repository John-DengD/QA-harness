import { Sandbox } from "@e2b/desktop";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { buildE2bTestenv } from "../src/e2b-testenv";
import { ClerkTestClient } from "../src/clients/clerk";
import { parseRuntimeConfig } from "../src/config";
import { setupClerkTestMode } from "../src/session/clerk-session";
import { getFreshClerkSessionJwt } from "../src/session/clerk-session";
import { chromeLaunchCommand, connectSharedChrome, discoverPrivateCdp, selectUniqueTargetPage, targetOrigin } from "../src/tools/e2b-shared-browser";
import { loadQaEnv } from "../src/tools/qa-env";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const baseUrl = process.env.E2E_SMOKE_BASE_URL;
const runDir = process.env.E2E_SMOKE_RUN_DIR;

async function cli(args: string[]): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await run("pnpm", args, { cwd: root, timeout: 120_000, maxBuffer: 1024 * 1024 }));
  } catch {
    throw new Error(`${args[0]} command failed; inspect local Case facts`);
  }
  const start = stdout.indexOf("\n{");
  if (start < 0) throw new Error(`Could not parse ${args[0]} result`);
  return JSON.parse(stdout.slice(start + 1));
}

async function main(): Promise<void> {
  if (!baseUrl || !runDir) throw new Error("Set E2E_SMOKE_BASE_URL and E2E_SMOKE_RUN_DIR");
  // Infrastructure smoke, not a QA run: exempt from the .qa-loop registration gate.
  process.env.QA_LOOP_GATE = "smoke";
  const origin = targetOrigin(baseUrl);
  loadQaEnv(true);
  const fixtureMode = process.env.E2E_SMOKE_MODE === "fixture";
  const email = process.env.E2E_SMOKE_EMAIL ?? process.env.E2E_ACCOUNT_EMAIL;
  const code = process.env.E2E_SMOKE_EMAIL_CODE;
  if (!fixtureMode && !email) throw new Error("Set E2E_SMOKE_EMAIL or E2E_ACCOUNT_EMAIL");
  const caseDir = path.resolve(runDir, "evidence", "shared-browser");
  const reuseLog = path.resolve(runDir, "run-state", "action-reuse.jsonl");
  const runId = `shared-e2b-${Date.now()}`;
  await cli(["action:reuse", "--", "preflight", "--log", reuseLog, "--run-id", runId]);

  const desktop = await Sandbox.create({
    envs: buildE2bTestenv(process.env),
    network: { allowPublicTraffic: false, maskRequestHost: "localhost" },
    resolution: [1440, 900],
    timeoutMs: 7_200_000,
  });
  let browser: Awaited<ReturnType<typeof connectSharedChrome>> | null = null;
  let recording = false;
  let clerkSessionId: string | null = null;
  let draftId: string | null = null;
  let chosenOrganization: string | null = null;
  let originalOrganization: string | null = null;
  let stage = "chrome-bootstrap";
  const finishCase = async () => {
    const stopped = await cli(["computer-use", "--", "record-stop",
      "--sandbox-id", desktop.sandboxId, "--case-dir", caseDir]) as { video: string; bytes: number };
    recording = false;
    if (!stopped.video.endsWith(".mp4") || stopped.bytes < 1024) {
      throw new Error("Shared-browser Case MP4 was missing or empty");
    }
    const summary = await cli(["action:reuse", "--", "summary", "--log", reuseLog]);
    console.log(JSON.stringify({ videoFormat: "mp4", videoBytes: stopped.bytes, summary }));
  };
  try {
    await desktop.commands.run(chromeLaunchCommand(desktop.display, origin));
    let cdpReady = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        await discoverPrivateCdp(desktop);
        cdpReady = true;
        break;
      } catch (error) {
        if (error instanceof Error && error.message.includes("public-access gate failed")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    if (!cdpReady) throw new Error("Visible Chrome CDP did not start");
    browser = await connectSharedChrome(desktop);
    const page = selectUniqueTargetPage(browser, origin);
    if (fixtureMode) {
      stage = "same-tab-DOM-fixture";
      await page.setContent(`<section id="launch-tracking">
        <p>Conversion tracking <span>Required to launch</span></p>
        <ol aria-label="How Google learns from this campaign"><li>Click</li><li>Purchase</li>
          <li>Site reports purchase <span>not set up</span></li></ol>
        <button>Switch to Traffic</button><a href="/tracking/setup">Set Up Tracking</a>
      </section><aside data-slot="launch-readiness">
        <div data-slot="readiness-results" data-stale="false">
          <button data-readiness-fix>Conversion tracking <span class="sr-only">required</span></button>
        </div>
      </aside>`);
      await browser.close();
      browser = null;
      await cli(["computer-use", "--", "record-start", "--sandbox-id", desktop.sandboxId,
        "--case-dir", caseDir]);
      recording = true;
      stage = "fixture-tracking-action";
      const result = await cli(["e2b:action", "--", "--sandbox-id", desktop.sandboxId,
        "--case-dir", caseDir, "--origin", origin, "--action", "readGoogleTrackingReadiness",
        "--domain", "google-tracking", "--reuse-log", reuseLog,
        "--run-id", runId, "--case-id", "shared-browser-fixture", "--intent-id", "read-tracking"]) as {
          status: string; factPath: string; lookupMs: number; executionMs: number;
          invocationId: string; factRef: string; factSha256: string;
        };
      const fact = JSON.parse(await readFile(result.factPath, "utf8")) as {
        fact: { cardState: string; readiness: { conversionTrackingRow: string } };
      };
      if (result.status !== "completed" || fact.fact.cardState !== "missing" ||
          fact.fact.readiness.conversionTrackingRow !== "required") {
        throw new Error("Same-tab tracking fixture did not produce expected facts");
      }
      // e2b:action already logged this invocation's hit to the reuse log.
      console.log(JSON.stringify({ validation: "isolated DOM fixture, not product Case",
        action: "readGoogleTrackingReadiness", cardState: fact.fact.cardState }));
      await finishCase();
      return;
    }
    if (!email) throw new Error("A test account email is required");
    if (code) {
      stage = "email-entry";
      await page.getByPlaceholder("Enter your email address").fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      stage = "alternate-method";
      await page.getByText("Use another method").click();
      stage = "email-code-method";
      await page.getByText(/^Email code to/).click();
      stage = "email-code-entry";
      await page.locator('input[inputmode="numeric"]').first().pressSequentially(code);
    } else {
      stage = "clerk-test-sign-in";
      const runtime = parseRuntimeConfig({ ...process.env, E2E_BASE_URL: origin });
      await setupClerkTestMode(page, runtime);
      const clerk = new ClerkTestClient({ secretKey: runtime.clerkSecretKey });
      const user = await clerk.findUserByEmail(email);
      const ticket = await clerk.createSignInToken(user.id);
      const url = new URL("/sign-in", origin);
      url.searchParams.set("__clerk_ticket", ticket.token);
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
    }
    stage = "signed-in-navigation";
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 45_000 });
    const token = await getFreshClerkSessionJwt(page);
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as
      { sid?: unknown };
    if (typeof payload.sid !== "string") throw new Error("Clerk session could not be identified for cleanup");
    clerkSessionId = payload.sid;
    await browser.close();
    browser = null;

    await cli(["computer-use", "--", "record-start", "--sandbox-id", desktop.sandboxId,
      "--case-dir", caseDir]);
    recording = true;
    stage = "shared-actions";
    for (const [intentId, action, domain] of [
      ["open-list", "openCampaignList", "campaign"],
      ["open-draft", "openCampaignDraft", "campaign"],
      ["read-tracking", "readGoogleTrackingReadiness", "google-tracking"],
    ]) {
      if (action === "openCampaignDraft" && !draftId) {
        stage = "find-current-org-google-draft";
        const searchStarted = Date.now();
        const attached = await connectSharedChrome(desktop);
        try {
          const page = selectUniqueTargetPage(attached, origin);
          await page.waitForFunction(() =>
            document.body.textContent?.includes("Campaigns") &&
            !document.body.textContent?.includes("Please sign in to continue"),
            undefined, { timeout: 30_000 });
          const match = await page.evaluate(async () => {
            const response = await fetch("/api/proxy/api/v1/me");
            if (!response.ok) throw new Error("Identity unavailable");
            const identity = await response.json() as { orgs?: { id: string; name: string }[] };
            const selectedKeys = Object.keys(sessionStorage).filter((key) =>
              key.startsWith("hellyeah:active-org:"));
            if (selectedKeys.length > 1) throw new Error("Selected organization is ambiguous");
            const selected = selectedKeys.length === 1
              ? sessionStorage.getItem(selectedKeys[0])
              : identity.orgs?.length === 1 ? identity.orgs[0].id : null;
            const active = identity.orgs?.find((org) => org.id === selected);
            if (!active) {
              throw new Error("Selected organization is not in identity response");
            }
            const orgs = [active, ...(identity.orgs ?? []).filter((org) => org.id !== active.id)]
              .filter((org, _, all) => all.filter((candidate) => candidate.name === org.name).length === 1);
            for (const org of orgs.slice(0, 12)) {
              let cursor: string | undefined;
              let inspectedDetails = 0;
              for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
                const query = new URLSearchParams({ limit: "100" });
                if (cursor) query.set("cursor", cursor);
                const campaigns = await fetch(`/api/proxy/api/v1/campaigns?${query}`, {
                  headers: { "X-Hellyeah-Org": org.id },
                });
                if (!campaigns.ok) break;
                const body = await campaigns.json() as {
                  items?: { id: string; platform: string; status: string; campaignType?: string }[];
                  nextCursor?: string;
                };
                for (const candidate of body.items ?? []) {
                  if (candidate.platform !== "google" || candidate.status !== "draft" ||
                      candidate.campaignType !== "pmax") continue;
                  if (++inspectedDetails > 50) break;
                  const detailResponse = await fetch(
                    `/api/proxy/api/v1/campaigns/${encodeURIComponent(candidate.id)}`,
                    { headers: { "X-Hellyeah-Org": org.id } }
                  );
                  if (!detailResponse.ok) continue;
                  const detail = await detailResponse.json() as {
                    conversionDecision?: { primaryEvent?: string } | null;
                    objective?: string | null;
                  };
                  const event = detail.conversionDecision?.primaryEvent ?? "";
                  const objective = detail.objective ?? "";
                  if (!/purchase|signup/i.test(event) && !/\bsales\b|\bsignups\b/i.test(objective)) continue;
                  return {
                    draftId: candidate.id, orgName: org.name, originalOrgName: active.name,
                  };
                }
                if (inspectedDetails > 50) break;
                if (!body.nextCursor) break;
                cursor = body.nextCursor;
              }
            }
            return null;
          });
          draftId = match?.draftId ?? null;
          chosenOrganization = match?.orgName ?? null;
          originalOrganization = match?.originalOrgName ?? null;
        } finally {
          await attached.close();
        }
        if (!draftId || !chosenOrganization || !originalOrganization) {
          await cli(["action:reuse", "--", "record", "--log", reuseLog, "--event", JSON.stringify({
            runId, caseId: "shared-browser", intentId: "read-tracking",
            intent: "readGoogleTrackingReadiness", outcome: "miss", source: "playwright-explore",
            reason: "precondition", lookupMs: Date.now() - searchStarted, executionMs: 0,
          })]);
          console.log(JSON.stringify({ tracking: "not verified: no suitable existing draft" }));
          await finishCase();
          process.exitCode = 3;
          return;
        }
        if (chosenOrganization !== originalOrganization) {
          stage = "select-org-with-existing-draft";
          const switched = await cli(["e2b:action", "--", "--sandbox-id", desktop.sandboxId,
            "--case-dir", caseDir, "--origin", origin, "--action", "selectOrganization",
            "--domain", "meta-byo", "--reuse-log", reuseLog,
            "--run-id", runId, "--case-id", "shared-browser", "--intent-id", "select-org",
            "--args-json", JSON.stringify([chosenOrganization])]) as {
              status: string; factPath: string; lookupMs: number; executionMs: number;
              invocationId: string; factRef: string; factSha256: string;
            };
          if (switched.status !== "completed") {
            throw new Error("Organization switch did not complete; inspect local Case facts");
          }
          // e2b:action already logged this invocation's hit to the reuse log.
          console.log(JSON.stringify({ action: "selectOrganization", status: switched.status }));
        }
      }
      stage = action;
      const result = await cli(["e2b:action", "--", "--sandbox-id", desktop.sandboxId,
        "--case-dir", caseDir, "--origin", origin, "--action", action,
        "--domain", domain, "--reuse-log", reuseLog,
        "--run-id", runId, "--case-id", "shared-browser", "--intent-id", intentId,
        "--args-json", JSON.stringify(action === "openCampaignDraft" ? [draftId] : [])]) as {
          status: string; factPath: string; lookupMs: number; executionMs: number;
          invocationId: string; factRef: string; factSha256: string;
        };
      if (result.status !== "completed") throw new Error(`${action} failed; read its local fact file`);
      const fact = JSON.parse(await readFile(result.factPath, "utf8")) as {
        status: string; fact: Record<string, unknown>;
      };
      if (action === "readGoogleTrackingReadiness" &&
          (fact.fact.cardState === "absent" || fact.fact.readiness == null)) {
        console.log(JSON.stringify({ tracking: "not verified: existing draft has no tracking card" }));
        await finishCase();
        process.exitCode = 3;
        return;
      }
      // e2b:action already logged this invocation's hit to the reuse log.
      console.log(JSON.stringify({ action, status: fact.status,
        ...(action === "readGoogleTrackingReadiness" ? {
          cardState: fact.fact.cardState,
          readiness: fact.fact.readiness,
        } : {}) }));
    }
    await finishCase();
  } catch (error) {
    await mkdir(caseDir, { recursive: true });
    await writeFile(path.join(caseDir, "failure.png"), await desktop.screenshot(), { mode: 0o600 })
      .catch(() => {});
    console.error(`Shared E2B stage: ${stage}`);
    throw error;
  } finally {
    let cleanupFailed = false;
    if (chosenOrganization && originalOrganization && chosenOrganization !== originalOrganization &&
        clerkSessionId) {
      const attached = await connectSharedChrome(desktop).catch(() => null);
      if (attached) {
        try {
          const page = selectUniqueTargetPage(attached, origin);
          process.env.E2E_SHARED_BROWSER_ORIGIN = origin;
          const { selectOrganization } = await import("../src/actions/meta-byo-actions");
          await selectOrganization(page, originalOrganization);
          console.log(JSON.stringify({ cleanup: "original organization restored" }));
        } catch {
          cleanupFailed = true;
          console.error("Original organization restoration could not be verified");
        } finally {
          delete process.env.E2E_SHARED_BROWSER_ORIGIN;
          await attached.close();
        }
      } else {
        cleanupFailed = true;
        console.error("Original organization restoration could not be attempted");
      }
    }
    if (recording) {
      await cli(["computer-use", "--", "record-stop", "--sandbox-id", desktop.sandboxId,
        "--case-dir", caseDir]).catch(() => {
          cleanupFailed = true;
          console.error("Active Case video could not be finalized");
        });
    }
    await browser?.close().catch(() => { cleanupFailed = true; });
    if (clerkSessionId) {
      if (!process.env.CLERK_SECRET_KEY) {
        cleanupFailed = true;
        console.error("Clerk session could not be revoked without a test key");
      } else {
        try {
          await new ClerkTestClient({ secretKey: process.env.CLERK_SECRET_KEY })
            .revokeSession(clerkSessionId);
          console.log(JSON.stringify({ cleanup: "test session revoked" }));
        } catch {
          cleanupFailed = true;
          console.error("Clerk session revoke failed");
        }
      }
    }
    try {
      await Sandbox.kill(desktop.sandboxId);
      console.log(JSON.stringify({ cleanup: "E2B sandbox stopped" }));
    } catch {
      cleanupFailed = true;
      console.error("E2B sandbox stop could not be verified");
    }
    if (cleanupFailed) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Shared E2B smoke failed");
  process.exitCode = 1;
});
