#!/usr/bin/env bash
# One-off copy of hy_ui_autotest from the linear-browser-qa install copy into ./executor.
# Re-running overwrites executor/ from the source; see executor/MIGRATION.md for what was removed.
set -euo pipefail
SRC="${1:-$HOME/.codex/skills/linear-browser-qa}"
DST="$(cd "$(dirname "$0")/.." && pwd)/executor"
mkdir -p "$DST"

rsync -a --delete \
  --exclude node_modules --exclude playwright-report --exclude apps --exclude midscene_run \
  --exclude .qa-runs --exclude 'src/computer-use' --exclude 'src/exploration' \
  --exclude pnpm-workspace.yaml --exclude '.env' --exclude '.env.*' --exclude .DS_Store \
  "$SRC/hy_ui_autotest/" "$DST/"

# Non-goal entry points (spec §2): post-execution review, omission hook, human review, computer-use, exploration, Autoloop glue, report app.
for f in e2b-computer-use explore-case human-review omission-hook qa-checker pr-diff-inventory \
         autoloop-brief autoloop-events autoloop-weekly-digest; do rm -f "$DST/scripts/$f.ts"; done
rm -f "$DST/scripts/bundle-agent-qa-report.mjs"

# Tests whose subject is one of the removed entry points above (they shell out to the removed scripts).
REMOVED_TESTS="qa-checker-case qa-checker agent-qa-report human-review omission-hook lane-merge pr-diff-inventory computer-use-miss-cli"
for t in $REMOVED_TESTS; do rm -f "$DST/tests/unit/$t.test.ts"; done

# Dead code (imported by nothing but its own test) that belongs to the non-goals: lane merge, Computer Use, exploration, scheduling.
REMOVED_DEAD="src/loop/lane-merge.ts src/tools/computer-use-contract.ts src/tools/computer-use-recording.ts src/tools/jev-exploration.ts src/tools/schedule.ts"
REMOVED_DEAD_TESTS="computer-use-contract computer-use-recording jev-exploration schedule"
for f in $REMOVED_DEAD; do rm -f "$DST/$f"; done
for t in $REMOVED_DEAD_TESTS; do rm -f "$DST/tests/unit/$t.test.ts"; done

# package.json: drop scripts for removed entry points and the report app.
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
const drop=/^(computer-use|explore:case|qa:checker|omission:hook|human:review|pr:diff-inventory|report:|check$)/;
for(const k of Object.keys(j.scripts)) if(drop.test(k)) delete j.scripts[k];
j.name="qa-harness-executor";
fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");' "$DST/package.json"

# Harness-owned scripts that live next to the executor scripts (sandbox create / record / snapshot / kill).
cp "$(cd "$(dirname "$0")" && pwd)/executor-extra/qa-sandbox.ts" "$DST/scripts/qa-sandbox.ts"
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.scripts["qa:sandbox"]="tsx scripts/qa-sandbox.ts";
fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");' "$DST/package.json"

# Origin allow-list: the executor hard-codes which hosts the shared browser may open. The harness resolves the
# test origin itself and passes it in QA_ALLOWED_ORIGINS; patch the executor to honour that (fails loudly if the
# executor source changed and the anchor is gone), and carry the test for the patch.
python3 - "$DST/src/tools/e2b-shared-browser.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
anchor='  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);\n'
assert anchor in s, "e2b-shared-browser.ts changed: update the QA_ALLOWED_ORIGINS patch in scripts/migrate-executor.sh"
if "QA_ALLOWED_ORIGINS" not in s:
    s=s.replace(anchor, anchor+'  const extra = (process.env.QA_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);\n  if (extra.includes(url.origin)) return url.origin;\n')
open(p,'w').write(s)
PY
cp "$(cd "$(dirname "$0")" && pwd)/executor-extra/e2b-shared-browser-origins.test.ts" "$DST/tests/unit/e2b-shared-browser-origins.test.ts"

# playwright.config.ts needs one small helper from the report app (which is not migrated): keep the helper, repoint the import.
cp "$SRC/hy_ui_autotest/apps/report/src/runtime-metadata.ts" "$DST/src/report/runtime-metadata.ts"
sed -i.bak 's#./apps/report/src/runtime-metadata#./src/report/runtime-metadata#' "$DST/playwright.config.ts" && rm "$DST/playwright.config.ts.bak"

# The runner spawned Playwright with the caller's cwd; pin it to the executor directory so config lookup never depends on where it was launched from.
sed -i.bak 's#cwd: process.cwd(),#cwd: path.resolve(import.meta.dirname, ".."),#' "$DST/scripts/run-e2b-playwright.ts" && rm "$DST/scripts/run-e2b-playwright.ts.bak"
if ! grep -q '^import path' "$DST/scripts/run-e2b-playwright.ts"; then
  { echo 'import path from "node:path";'; cat "$DST/scripts/run-e2b-playwright.ts"; } > "$DST/scripts/run-e2b-playwright.ts.tmp" && mv "$DST/scripts/run-e2b-playwright.ts.tmp" "$DST/scripts/run-e2b-playwright.ts"
fi

HEAD_SHA="$(git -C "$SRC" rev-parse --short HEAD)"
DIRTY="$(git -C "$SRC" status --porcelain | wc -l | tr -d ' ')"
cat > "$DST/MIGRATION.md" <<EOF
# Executor migration record

- Source: \`$SRC/hy_ui_autotest\` (a git checkout)
- Source HEAD: $HEAD_SHA — the working tree had $DIRTY uncommitted changes when copied; the copy includes them (they are the newest content)
- Copied by: \`scripts/migrate-executor.sh\` (re-running overwrites \`executor/\`)

## Not copied
\`node_modules\`, \`playwright-report\`, \`apps/\` (report app), \`midscene_run/\`, \`src/computer-use/\`, \`src/exploration/\`, \`pnpm-workspace.yaml\`, every \`.env*\` file (credentials stay out of this repo).

## Removed after copy (non-goals, spec §2)
- Scripts: e2b-computer-use, explore-case, human-review, omission-hook, qa-checker, pr-diff-inventory, autoloop-brief, autoloop-events, autoloop-weekly-digest, bundle-agent-qa-report.mjs
- package.json scripts: computer-use, explore:case, qa:checker, omission:hook, human:review, pr:diff-inventory, report:*, check
- Unit tests of those removed scripts: $REMOVED_TESTS
- Dead code and its tests (nothing imported it but its own test): $REMOVED_DEAD

## Kept although the spec said "do not migrate" (import closure)
\`src/loop/{checker,drift-gate,human-review,omission,pr-diff}.ts\` are imported by \`src/loop/state.ts\`; \`src/tools/{action-drift,action-table,silent-drift}.ts\` by the Action index; \`src/clients/clerk.ts\`, \`src/session/clerk-session.ts\` by the Clerk login code. They are not exposed as scripts. Trimming them out of \`state.ts\` is future work.

## Kept beyond the spec (not required by the import closure)
Spec §10 names only \`run-e2b-playwright\`, \`e2b-action\`, \`action-select\` as scripts to migrate. These additional scripts were copied and are still exposed in \`package.json\`; they are Action-maintenance and release tooling, not needed by the five \`qa\` commands, and are candidates for trimming: action-reuse, action-drift, action-heal, action-prune, check-install-mode, check-qa-env, qa-env-root, qa-init, healthcheck, release-gate, validate-dispatch, validate-env, spec-assert-lock, verify-shared-e2b.

## Runner cwd
\`scripts/run-e2b-playwright.ts\` originally spawned Playwright with \`cwd: process.cwd()\`; it is now pinned to the executor directory. Other \`process.cwd()\` uses in the executor only build display paths.

## Credentials
The executor reads credentials from \`<repo root>/qa-env/.env.local\` (path fixed in \`src/tools/qa-env.ts\`, gitignored) or from the process environment, which wins. \`pnpm test:list\` and Playwright need those variables at config load, so without them it reports \`Total: 0 tests\`; with placeholder values (including a known staging hostname for E2E_BASE_URL and a 32-character admin token) it lists the same 44 tests in 20 files as the source copy.

## Local change
\`playwright.config.ts\` imported \`./apps/report/src/runtime-metadata\`; that helper is copied to \`src/report/runtime-metadata.ts\` and the import repointed.
EOF
