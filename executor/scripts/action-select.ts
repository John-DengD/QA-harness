import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { actionIndex } from "../src/tools/action-index";
import { ROLLBACK_LEVELS, resolveIntent } from "../src/tools/action-table";
import { loadActionCatalog, selectActions, validateActionCatalog, type ActionSelector } from "../src/tools/action-select";
import { actionCodeHashes, annotateCandidatesWithHealth, noticeFor, readActionHealth } from "../src/tools/action-health";

const USAGE = "Usage: action:select select --intent <text> [--domain <domain>] [--surface <surface>] [--role <role>] [--page <page>] [--required-fact <fact>] [--rollback-allowed read|reversible|irreversible] [--shared-execution] [--strict-context] [--limit N] [--qa-root QA_ROOT]\n" +
  "       action:select resolve --intent <table intent>   (prints the one Action whose intent or alias is exactly this text)";
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"), allowPositionals: true,
  options: {
    intent: { type: "string" }, domain: { type: "string" }, surface: { type: "string" },
    role: { type: "string" }, page: { type: "string" }, state: { type: "string" },
    "required-fact": { type: "string", multiple: true }, "rollback-allowed": { type: "string" },
    // Removed; kept only to refuse it with an explanation.
    "side-effect-allowed": { type: "string" },
    "shared-execution": { type: "boolean" }, "strict-context": { type: "boolean" }, limit: { type: "string" },
    // Action health (QA_ROOT/.qa-loop/action-health.json): adds a drift notice, never filters.
    "qa-root": { type: "string" },
  },
});
if (positionals.length !== 1 || !["select", "resolve"].includes(positionals[0])) throw new Error(USAGE);
if (values["side-effect-allowed"] !== undefined) {
  throw new Error("--side-effect-allowed was removed: filter by the Action table's rollback level with --rollback-allowed read|reversible|irreversible");
}
if (values["rollback-allowed"] && !(ROLLBACK_LEVELS as readonly string[]).includes(values["rollback-allowed"])) {
  throw new Error("--rollback-allowed must be read|reversible|irreversible");
}
const root = path.resolve(import.meta.dirname, "..");
const hotlist = JSON.parse(await readFile(path.join(root, "src/tools/action-hotlist.json"), "utf8")) as { actions: string[] };
const entries = await actionIndex(root, hotlist.actions);
const catalog = await loadActionCatalog(root);
validateActionCatalog(entries, catalog);
const qaRoot = values["qa-root"] ?? process.env.QA_ROOT;
const health = qaRoot ? {
  status: await readActionHealth(path.resolve(qaRoot)),
  codeHashes: actionCodeHashes(root, entries.map((entry) => entry.file)),
} : undefined;
if (positionals[0] === "resolve") {
  if (!values.intent) throw new Error(USAGE);
  const name = resolveIntent(catalog, values.intent);
  if (!name) {
    console.log(JSON.stringify({ query: values.intent, action: null }, null, 2));
    process.exitCode = 1;
  } else {
    const entry = entries.find((item) => item.name === name)!;
    console.log(JSON.stringify({ query: values.intent, action: name, domain: entry.domain, ...catalog[name],
      health: noticeFor(health, entry) }, null, 2));
  }
} else {
  const selector: ActionSelector = {
    ...(values.intent ? { intent: values.intent } : {}), ...(values.domain ? { domain: values.domain } : {}),
    ...(values.surface ? { surface: values.surface } : {}), ...(values.role ? { role: values.role } : {}),
    ...(values.page ? { page: values.page } : {}), ...(values.state ? { state: values.state } : {}),
    ...(values["required-fact"] ? { requiredFacts: values["required-fact"] } : {}),
    ...(values["rollback-allowed"] ? { rollbackAllowed: values["rollback-allowed"] as ActionSelector["rollbackAllowed"] } : {}),
    ...(values["shared-execution"] === true ? { sharedExecution: true } : {}),
    ...(values["strict-context"] === true ? { strictContext: true } : {}),
    ...(values.limit ? { limit: Number(values.limit) } : {}),
  };
  const selected = selectActions(entries, catalog, selector);
  const matches = health ? annotateCandidatesWithHealth(selected, health.status, health.codeHashes) : selected;
  console.log(JSON.stringify({ indexed: entries.length, matched: matches.length, selector,
    health: health ? "QA_ROOT/.qa-loop/action-health.json" : "not read: pass --qa-root or set QA_ROOT",
    matches }, null, 2));
}
