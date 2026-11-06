import { execFile } from "node:child_process";
import { ConfigError, requireSecrets } from "../config";
import { resolvePrEnv, selectCandidates, stagingEnv } from "../env-resolve";
import { loadEnvironments } from "../environments";
import { InputError } from "../errors";
import { extractFromSources } from "../extract/extract";
import { makeOpenAiTransport } from "../llm/openai-transport";
import type { LlmTransport } from "../llm/structured";
import { writeArtifact } from "../run-dir";
import { fetchPr } from "../sources/github";
import { fetchLinearIssue } from "../sources/linear";
import { loadTicketFile } from "../sources/ticket-file";
import type { ExecLike, FetchLike, PrInfo, SourceDoc } from "../sources/types";
import type { CommandContext, Stage } from "./types";
import type { Env } from "../contracts/env";

export type ExtractDeps = { transport: LlmTransport; fetch: FetchLike; exec: ExecLike };

const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g;
const INPUTS = ["ticket", "ticketFile", "pr", "goal"] as const;

const str = (v: string | boolean | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

async function gather(ctx: CommandContext, deps: ExtractDeps): Promise<{ sources: SourceDoc[]; env: Env }> {
  const given = INPUTS.filter((k) => str(ctx.args[k]) !== undefined);
  if (given.length !== 1) {
    throw new ConfigError("provide exactly one of --ticket <LINEAR-ID>, --ticket-file <path>, --pr <url>, --goal <text>");
  }
  const rules = loadEnvironments(ctx.runbook).prSandbox;

  if (given[0] === "ticketFile") {
    return { sources: [loadTicketFile(str(ctx.args.ticketFile)!)], env: stagingEnv(ctx.env) };
  }

  if (given[0] === "goal") {
    const journeysPath = "QA-models/hellyeah/core-journeys.md";
    const env = stagingEnv(ctx.env);
    return {
      env,
      sources: [
        { ref: "goal:text", title: "Goal", text: str(ctx.args.goal)! },
        { ref: `runbook:${journeysPath}`, title: "Core journeys", text: ctx.runbook.text(journeysPath) },
      ],
    };
  }

  if (given[0] === "pr") {
    const pr = await fetchPr({ url: str(ctx.args.pr)!, exec: deps.exec });
    const { open, excluded } = selectCandidates([pr]);
    if (open.length === 0) throw new InputError(excluded[0]!.reason);
    return {
      sources: [{ ref: `pr:${pr.url}#description`, title: `PR #${pr.number}`, text: pr.description }],
      env: resolvePrEnv(open[0]!, rules),
    };
  }

  // --ticket
  requireSecrets(["LINEAR_API_KEY"], ctx.env);
  const id = str(ctx.args.ticket)!;
  const doc = await fetchLinearIssue({ id, apiKey: ctx.env.LINEAR_API_KEY!, fetch: deps.fetch });
  const urls = [...new Set(doc.text.match(PR_URL) ?? [])];
  if (urls.length === 0) return { sources: [doc], env: stagingEnv(ctx.env) };
  const prs: PrInfo[] = [];
  for (const url of urls) prs.push(await fetchPr({ url, exec: deps.exec }));
  const { open, excluded } = selectCandidates(prs);
  if (open.length === 0) throw new InputError(excluded.map((e) => e.reason).join("; "));
  if (open.length > 1) {
    throw new InputError(`${id} links ${open.length} open PRs (${open.map((p) => p.url).join(", ")}); run qa extract once per PR with --pr`);
  }
  return { sources: [doc], env: resolvePrEnv(open[0]!, rules) };
}

export async function runExtract(ctx: CommandContext, deps: ExtractDeps): Promise<number> {
  try {
    const { sources, env } = await gather(ctx, deps);
    const result = await extractFromSources({
      transport: deps.transport,
      runbook: ctx.runbook,
      sources,
      maxRetries: ctx.config.llm.maxRetries,
    });
    const force = { force: ctx.force };
    writeArtifact(ctx.runDir, "extract-report.json", result.report, force);
    writeArtifact(ctx.runDir, "sources.json", { sources }, force);
    if (result.acceptance.atoms.length === 0) {
      const why = result.report.dropped.map((d) => `- ${d.reason}: ${d.anchor.slice(0, 80)}`).join("\n");
      console.error(`extract: no acceptance atom survived verification${why ? `\n${why}` : " (the sources stated none)"}`);
      return 2;
    }
    writeArtifact(ctx.runDir, "env.json", env, force);
    writeArtifact(ctx.runDir, "acceptance.json", result.acceptance, force);
    writeArtifact(ctx.runDir, "change-model.json", result.changeModel, force);
    console.log(`extract: ${result.acceptance.atoms.length} atom(s), ${result.report.dropped.length} dropped, env ${env.kind} ${env.baseUrl}`);
    return 0;
  } catch (e) {
    const code = (e as { exitCode?: unknown }).exitCode;
    if (typeof code !== "number") throw e;
    console.error((e as Error).message);
    return code;
  }
}

const realExec: ExecLike = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
  });

export const extractStage: Stage = {
  name: "extract",
  needs: ["OPENAI_API_KEY"],
  requires: [],
  createsRunDir: true,
  run: (ctx) =>
    runExtract(ctx, {
      transport: makeOpenAiTransport({ apiKey: ctx.env.OPENAI_API_KEY!, baseUrl: ctx.config.llm.baseUrl, model: ctx.config.llm.model }),
      fetch: (url, init) => fetch(url, init) as never,
      exec: realExec,
    }),
};
