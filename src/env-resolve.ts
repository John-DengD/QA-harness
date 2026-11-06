import type { Env } from "./contracts/env";
import { InputError } from "./errors";
import type { Environments } from "./environments";
import type { PrInfo } from "./sources/types";

type Rules = Environments["prSandbox"];

export class EnvError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/** Merged and closed PRs are not test targets (intake-routing §2.1). */
export function selectCandidates(prs: PrInfo[]): { open: PrInfo[]; excluded: { pr: PrInfo; reason: string }[] } {
  const open: PrInfo[] = [];
  const excluded: { pr: PrInfo; reason: string }[] = [];
  for (const pr of prs) {
    if (pr.state === "OPEN") open.push(pr);
    else excluded.push({ pr, reason: `${pr.url} is ${pr.state.toLowerCase()}; only open PRs are test targets` });
  }
  return { open, excluded };
}

export type SandboxComment = {
  status: "ready" | "torn_down";
  footerSha: string | null;
  dashboardUrl?: string;
  adminUrl?: string;
  apiUrl?: string;
};

function linkUrl(body: string, label: string | undefined): string | undefined {
  if (!label) return undefined;
  for (const m of body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (m[1]!.trim() === label) return m[2];
  }
  return undefined;
}

export function parseSandboxComment(body: string, rules: Rules): SandboxComment | null {
  if (!body.includes(rules.marker)) return null;
  const status = body.includes(rules.status.tornDown) ? "torn_down" : body.includes(rules.status.ready) ? "ready" : null;
  if (!status) return null;
  const footer = new RegExp(rules.footerShaPattern).exec(body);
  return {
    status,
    footerSha: footer?.[1] ?? null,
    dashboardUrl: linkUrl(body, rules.urlLabels.dashboard),
    adminUrl: linkUrl(body, rules.urlLabels.admin),
    apiUrl: linkUrl(body, rules.urlLabels.api),
  };
}

/** Equal, or a prefix of at least 7 characters (a short footer SHA counts only as a prefix of the head). */
export function shaMatches(footerSha: string, headSha: string): boolean {
  if (footerSha === headSha) return true;
  return footerSha.length >= 7 && headSha.startsWith(footerSha);
}

export function resolvePrEnv(pr: PrInfo, rules: Rules): Env {
  const mine = pr.comments
    .filter((c) => c.author === rules.botAuthor)
    .map((c) => parseSandboxComment(c.body, rules))
    .filter((c): c is SandboxComment => c !== null);
  const latest = mine.at(-1);
  if (!latest) throw new EnvError(`no sandbox comment found on ${pr.url}; creating a sandbox is not authorised`);
  if (latest.status === "torn_down") throw new EnvError(`the sandbox on ${pr.url} is torn down; refresh it before testing`);
  if (!latest.footerSha) throw new EnvError(`the sandbox comment on ${pr.url} has no deployed commit SHA`);
  if (!shaMatches(latest.footerSha, pr.headSha)) {
    throw new EnvError(`sandbox on ${pr.url} is behind the PR head: deployed ${latest.footerSha}, head ${pr.headSha.slice(0, 7)}`);
  }
  if (!latest.dashboardUrl) throw new EnvError(`the sandbox comment on ${pr.url} has no dashboard URL`);
  return {
    kind: "pr-sandbox",
    baseUrl: latest.dashboardUrl,
    prNumber: pr.number,
    headSha: pr.headSha,
    ...(latest.adminUrl ? { adminUrl: latest.adminUrl } : {}),
    ...(latest.apiUrl ? { apiUrl: latest.apiUrl } : {}),
  };
}

export function stagingEnv(env: NodeJS.ProcessEnv): Env {
  const baseUrl = env.E2E_BASE_URL?.trim();
  if (!baseUrl) throw new EnvError("E2E_BASE_URL is not set; set it in the environment or in .env.local / qa-env/.env.local");
  const apiUrl = env.E2E_API_URL?.trim();
  return { kind: "staging", baseUrl, ...(apiUrl ? { apiUrl } : {}) };
}
