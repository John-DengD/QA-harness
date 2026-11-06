export const JEV_BROWSER_PACKAGE = "@jkudish/jev-browser@0.4.1";

export const READ_ONLY_EXPLORATION_GUARD = [
  "Explore this page only to discover a UI path for a later Playwright test.",
  "Do not submit forms or create, update, delete, approve, purchase, publish, invite, or launch anything.",
  "Stop before any action that could change application or third-party state.",
].join(" ");

export type ExplorationOutcome =
  | "completed"
  | "partial"
  | "failed"
  | "timed_out";

export type JevExplorationOptions = {
  task: string;
  startUrl: string;
  outputDir: string;
  maxSteps: number;
  maxSeconds: number;
};

export function buildGuardedTask(task: string): string {
  return `${READ_ONLY_EXPLORATION_GUARD}\n\nExploration goal: ${task.trim()}`;
}

export function buildJevCliArgs(options: JevExplorationOptions): string[] {
  return [
    "-y",
    JEV_BROWSER_PACKAGE,
    "run",
    buildGuardedTask(options.task),
    options.startUrl,
    "--format",
    "aria",
    "--max-steps",
    String(options.maxSteps),
    "--max-seconds",
    String(options.maxSeconds),
    "--no-typing",
    "--screenshot",
    `${options.outputDir}/final.jpg`,
  ];
}

export function classifyJevStatus(status: unknown): ExplorationOutcome {
  if (status === "done" || status === "goal_achieved") return "completed";
  if (status === "stuck" || status === "max_steps" || status === "timeout") {
    return "partial";
  }
  return "failed";
}

const PASSTHROUGH_ENV_KEYS = [
  "HOME",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CACHE_HOME",
  "PLAYWRIGHT_BROWSERS_PATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "TYPESAFE_API_KEY",
  "OPENROUTER_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "AI_GATEWAY_API_KEY",
  "JEV_PROVIDER",
  "JEV_BROWSER_MODEL",
  "JEV_BROWSER_HEADED",
  "JEV_BROWSER_SKIP_BROWSER_DOWNLOAD",
  "JEV_BROWSER_TYPE_PROVIDER",
  "JEV_BROWSER_TYPE_MODEL",
  "JEV_BROWSER_TYPE_BASE_URL",
  "JEV_BROWSER_TYPE_API_KEY",
] as const;

export function buildJevEnvironment(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    PASSTHROUGH_ENV_KEYS.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]]
    )
  );
}
