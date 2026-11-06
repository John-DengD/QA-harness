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

# package.json: drop scripts for removed entry points and the report app.
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
const drop=/^(computer-use|explore:case|qa:checker|omission:hook|human:review|pr:diff-inventory|report:|check$)/;
for(const k of Object.keys(j.scripts)) if(drop.test(k)) delete j.scripts[k];
j.name="qa-harness-executor";
fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");' "$DST/package.json"

# playwright.config.ts needs one small helper from the report app (which is not migrated): keep the helper, repoint the import.
cp "$SRC/hy_ui_autotest/apps/report/src/runtime-metadata.ts" "$DST/src/report/runtime-metadata.ts"
sed -i.bak 's#./apps/report/src/runtime-metadata#./src/report/runtime-metadata#' "$DST/playwright.config.ts" && rm "$DST/playwright.config.ts.bak"

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

## Kept although the spec said "do not migrate" (import closure)
\`src/loop/{checker,drift-gate,human-review,omission,pr-diff}.ts\` are imported by \`src/loop/state.ts\`; \`src/tools/{action-drift,action-table,silent-drift}.ts\` by the Action index; \`src/clients/clerk.ts\`, \`src/session/clerk-session.ts\` by the Clerk login code. They are not exposed as scripts. Trimming them out of \`state.ts\` is future work.

## Credentials
The executor reads credentials from \`<repo root>/qa-env/.env.local\` (path fixed in \`src/tools/qa-env.ts\`, gitignored) or from the process environment, which wins. \`pnpm test:list\` and Playwright need those variables at config load, so without them it reports \`Total: 0 tests\`; with placeholder values (including a known staging hostname for E2E_BASE_URL and a 32-character admin token) it lists the same 44 tests in 20 files as the source copy.

## Local change
\`playwright.config.ts\` imported \`./apps/report/src/runtime-metadata\`; that helper is copied to \`src/report/runtime-metadata.ts\` and the import repointed.
EOF
