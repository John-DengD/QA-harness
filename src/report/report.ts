import type { Acceptance } from "../contracts/acceptance";
import type { CaseReviewEntry } from "../contracts/case-review";
import type { Case } from "../contracts/cases";
import type { Env } from "../contracts/env";
import type { ExtractReport } from "../contracts/extract-report";
import type { GeneratorsFile } from "../contracts/generators";
import type { CaseResult } from "../contracts/result";
import type { RunSummary } from "../contracts/run-summary";
import { summaryExitCode } from "../run/verdict";

export const INDEPENDENCE_STATEMENT = "执行前的 case 清单经过一次独立审核;执行后的结论没有经过独立复核。";

export type ReportInput = {
  feature: string;
  runId: string;
  env: Env;
  acceptance: Acceptance;
  cases: Case[];
  review: CaseReviewEntry[];
  results: CaseResult[];
  summary: RunSummary | null;
  extractReport: ExtractReport | null;
  generators: GeneratorsFile | null;
};

const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const EXIT_MEANING: Record<number, string> = {
  0: "全部已执行,且均为 Pass 或 NotApplicable",
  10: "存在 ProductFail",
  20: "没有 ProductFail,但覆盖不完整(存在 Blocked、Inconclusive、Automation failure、未自动化或被跳过的 case)",
};

export function reportExitCode(i: ReportInput): number {
  return summaryExitCode(i.results, { notAutomated: i.summary?.notAutomated.length ?? 0, skipped: i.summary?.skipped.length ?? 0 });
}

/** Deterministic report: only aggregates what earlier stages wrote; never re-judges. */
export function buildReport(i: ReportInput): string {
  const byId = new Map(i.cases.map((c) => [c.id, c]));
  const resultById = new Map(i.results.map((r) => [r.caseId, r]));
  const count = (v: string) => i.results.filter((r) => r.verdict === v).length;
  const code = reportExitCode(i);
  const L: string[] = [];

  L.push(`# QA 报告:${i.feature} / ${i.runId}`, "");
  L.push("## 1. 总体结论", "");
  L.push(`- 退出码:${code}(${EXIT_MEANING[code] ?? ""})`);
  L.push(`- 环境:${i.env.kind} ${i.env.baseUrl}${i.env.prNumber ? ` (PR #${i.env.prNumber})` : ""}${i.env.headSha ? `,部署 SHA ${i.env.headSha}` : ""}`);
  L.push(`- 结果:Pass ${count("Pass")},ProductFail ${count("ProductFail")},Blocked ${count("Blocked")},Inconclusive ${count("Inconclusive")},Automation failure ${count("Automation failure")},NotApplicable ${count("NotApplicable")}`);
  if (i.summary) L.push(`- 未自动化 ${i.summary.notAutomated.length},被跳过 ${i.summary.skipped.length}(${i.summary.startedAt} 至 ${i.summary.finishedAt})`);
  L.push("");

  L.push("## 2. Case 总览", "", "| ID | 标题 | 生成器 | 结果 | 备注 |", "|---|---|---|---|---|");
  for (const c of i.cases) {
    const r = resultById.get(c.id);
    const rev = i.review.find((e) => e.caseId === c.id);
    const verdict = r ? r.verdict : rev && rev.verdict !== "keep" ? `已剔除(${rev.verdict})` : "未执行";
    const note = r ? `${r.generated ? "generated 脚本;" : ""}${r.evidenceDir ? `证据 ${r.evidenceDir}` : ""}` : "";
    L.push(`| ${c.id} | ${cell(c.title)} | ${c.generator} | ${verdict} | ${cell(note)} |`);
  }
  L.push("");

  const problem = i.results.filter((r) => ["ProductFail", "Blocked", "Inconclusive", "Automation failure"].includes(r.verdict));
  L.push("## 3. 失败与阻塞的 case(复现条件)", "");
  if (problem.length === 0) L.push("无。", "");
  for (const r of problem) {
    const c = byId.get(r.caseId);
    L.push(`### ${r.caseId} ${c?.title ?? ""} — ${r.verdict}${r.generated ? "(generated 脚本)" : ""}`, "");
    if (c) {
      L.push(`- 前置条件:${c.preconditions.length ? c.preconditions.join(";") : "无"}`);
      L.push(`- 预期:${c.expected.text}(出处 ${c.expected.sourceRef})`);
    }
    if (r.notes) L.push(`- 说明:${r.notes}`);
    if (r.evidenceDir) L.push(`- 证据目录:${r.evidenceDir}`);
    L.push("");
  }

  L.push("## 4. 未覆盖与被剔除", "");
  const dropped = i.review.filter((e) => e.verdict === "drop");
  L.push("### 评审剔除的 case", "");
  if (dropped.length === 0) L.push("无。");
  for (const e of dropped) L.push(`- ${e.caseId} ${byId.get(e.caseId)?.title ?? ""}:${e.reason}`);
  L.push("", "### 未自动化与被跳过", "");
  const na = i.summary?.notAutomated ?? [];
  const sk = i.summary?.skipped ?? [];
  if (na.length + sk.length === 0) L.push("无。");
  for (const n of na) L.push(`- ${n.caseId} ${byId.get(n.caseId)?.title ?? ""}(未自动化):${n.reason}`);
  for (const s of sk) L.push(`- ${s.caseId} ${byId.get(s.caseId)?.title ?? ""}(被跳过):${s.reason}`);
  L.push("", "### 设计阶段未进入计划", "");
  const trimmed = i.generators?.trimmed ?? [];
  const pool = i.generators?.candidatePool ?? [];
  if (trimmed.length + pool.length === 0) L.push("无。");
  for (const t of trimmed) L.push(`- ${t.title}:${t.reason}`);
  for (const p of pool) L.push(`- 候选池 ${p.mechanism}:${p.why}`);
  L.push("", "### 抽取阶段未落盘的验收点", "");
  const xd = i.extractReport?.dropped ?? [];
  if (xd.length === 0) L.push("无。");
  for (const d of xd) L.push(`- ${d.reason}:${cell(d.anchor.slice(0, 120))}(${d.sourceRef})`);
  L.push("");

  L.push("## 5. 覆盖统计", "");
  const kept = i.review.filter((e) => e.verdict === "keep").length;
  const executed = i.summary ? i.summary.executed.length : i.results.length;
  L.push(`- 验收点:${i.acceptance.atoms.length}`);
  L.push(`- 计划 case:${i.cases.length},评审后保留:${kept}`);
  L.push(`- 已执行:${executed}`);
  L.push(`- 通过(Pass):${count("Pass")}`);
  L.push("");

  L.push("## 6. 独立性说明", "", INDEPENDENCE_STATEMENT, "");
  return L.join("\n");
}
