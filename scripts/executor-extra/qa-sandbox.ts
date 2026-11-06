/**
 * Sandbox helper used by qa-harness (`qa run`). Lives in scripts/executor-extra/ in the harness repo and is
 * copied into executor/scripts/ by scripts/migrate-executor.sh. It replaces the parts of the original
 * Computer Use CLI the harness needs: create a sandbox with a visible Chrome (CDP), record a case, read the
 * page, and kill the sandbox. All results are one JSON object on stdout; errors go to stderr, exit 1.
 */
import { Sandbox } from "@e2b/desktop";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildE2bTestenv } from "../src/e2b-testenv";
import { assertRegisteredRun } from "../src/loop/run-gate";
import { chromeLaunchCommand, connectSharedChrome, discoverPrivateCdp, selectUniqueTargetPage } from "../src/tools/e2b-shared-browser";
import { loadQaEnv } from "../src/tools/qa-env";
import { saveVerifiedVideoStream } from "../src/tools/video-transfer";

type Values = Record<string, string | boolean | undefined>;
const USAGE = `Usage: qa-sandbox <create|record-start|record-stop|snapshot|kill> [options]
  create --url <origin> [--width 1440] [--height 900] [--timeout-seconds 1800]
  record-start --sandbox-id <id> --case-dir <dir>
  record-stop --sandbox-id <id> --case-dir <dir>
  snapshot --sandbox-id <id> --origin <url>
  kill --sandbox-id <id>`;

const req = (v: string | boolean | undefined, name: string): string => {
  if (typeof v !== "string" || v === "") throw new Error(`Missing --${name}\n${USAGE}`);
  return v;
};
const int = (v: string | boolean | undefined, fallback: number, name: string): number => {
  if (v === undefined) return fallback;
  if (typeof v !== "string" || !/^[1-9]\d*$/.test(v)) throw new Error(`--${name} must be a positive integer`);
  return Number(v);
};
const out = (o: unknown) => console.log(JSON.stringify(o));

async function create(v: Values) {
  const width = int(v.width, 1440, "width");
  const height = int(v.height, 900, "height");
  if (width % 2 || height % 2) throw new Error("H.264 recording requires even width and height");
  const timeoutSeconds = int(v["timeout-seconds"], 1800, "timeout-seconds");
  const url = req(v.url, "url");
  const desktop = await Sandbox.create({
    envs: buildE2bTestenv(process.env),
    network: { allowPublicTraffic: false, maskRequestHost: "localhost" },
    resolution: [width, height] as [number, number],
    timeoutMs: timeoutSeconds * 1000,
  });
  try {
    const started = await desktop.commands.run(chromeLaunchCommand(desktop.display, url));
    if (!Number.isSafeInteger(Number(started.stdout.trim()))) throw new Error("Could not start the visible shared Chrome browser");
    let last: unknown;
    for (let i = 0; i < 25; i++) {
      try {
        await discoverPrivateCdp(desktop);
        last = undefined;
        break;
      } catch (e) {
        if (e instanceof Error && e.message.includes("public-access gate failed")) throw e;
        last = e;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (last) throw last;
  } catch (e) {
    await Sandbox.kill(desktop.sandboxId).catch(() => {});
    throw e;
  }
  out({ sandboxId: desktop.sandboxId });
}

type RecordingState = { sandboxId: string; pid: number; remotePath: string; startedAt: string; stoppedAt?: string };
const readState = async (file: string): Promise<RecordingState | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as RecordingState;
  } catch {
    return null;
  }
};

async function recordStart(v: Values) {
  const sandboxId = req(v["sandbox-id"], "sandbox-id");
  const caseDir = path.resolve(req(v["case-dir"], "case-dir"));
  await assertRegisteredRun(path.dirname(caseDir));
  await mkdir(caseDir, { recursive: true });
  const statePath = path.join(caseDir, "recording.json");
  const existing = await readState(statePath);
  if (existing && !existing.stoppedAt) throw new Error("A recording is already active for this case");
  const desktop = await Sandbox.connect(sandboxId);
  const screen = await desktop.getScreenSize();
  if (screen.width % 2 || screen.height % 2) throw new Error("H.264 recording requires even desktop dimensions");
  const remotePath = `/tmp/hy-qa-harness-${Date.now()}.mp4`;
  const cmd = [
    "setsid ffmpeg -y -loglevel error",
    `-f x11grab -video_size ${screen.width}x${screen.height}`,
    `-i ${desktop.display}`,
    "-an -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p",
    `${remotePath} >${remotePath}.log 2>&1 < /dev/null & echo $!`,
  ].join(" ");
  const res = await desktop.commands.run(`bash -lc '${cmd}'`);
  const pid = Number(res.stdout.trim());
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Failed to start the case video recorder");
  await desktop.wait(300);
  const alive = await desktop.commands.run(`bash -lc 'kill -0 ${pid} 2>/dev/null && echo alive || echo stopped'`);
  if (alive.stdout.trim() !== "alive") throw new Error("Case video recorder exited during startup");
  await writeFile(statePath, JSON.stringify({ sandboxId, pid, remotePath, startedAt: new Date().toISOString() } satisfies RecordingState));
  out({ status: "recording", pid });
}

async function recordStop(v: Values) {
  const sandboxId = req(v["sandbox-id"], "sandbox-id");
  const caseDir = path.resolve(req(v["case-dir"], "case-dir"));
  const statePath = path.join(caseDir, "recording.json");
  const state = await readState(statePath);
  if (!state) throw new Error("No recording state found for this case");
  if (state.stoppedAt) throw new Error("This case recording is already finalized");
  if (state.sandboxId !== sandboxId) throw new Error("The recording belongs to a different sandbox");
  if (!/^\/tmp\/hy-qa-harness-\d+\.mp4$/.test(state.remotePath)) throw new Error("The case recording path is invalid");
  if (!Number.isSafeInteger(state.pid) || state.pid < 1) throw new Error("The case recorder PID is invalid");
  const desktop = await Sandbox.connect(sandboxId);
  await desktop.commands.run(
    `bash -lc 'kill -INT ${state.pid} 2>/dev/null || true; for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 ${state.pid} 2>/dev/null || exit 0; sleep 1; done; kill -TERM ${state.pid} 2>/dev/null || true; sleep 1'`,
  );
  const probe = await desktop.commands.run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${state.remotePath}`);
  const durationSeconds = Number(probe.stdout.trim());
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("The finalized case video has no valid duration");
  const info = await desktop.files.getInfo(state.remotePath);
  const sum = await desktop.commands.run(`sha256sum ${state.remotePath}`);
  const sha = sum.stdout.trim().match(/^([a-f0-9]{64})\s/)?.[1];
  if (!sha) throw new Error("Could not verify the remote case video checksum");
  const stream = await desktop.files.read(state.remotePath, { format: "stream", requestTimeoutMs: 120_000, streamIdleTimeoutMs: 120_000 });
  const video = path.join(caseDir, "video.mp4");
  const bytes = await saveVerifiedVideoStream(stream, video, info.size, sha);
  await writeFile(statePath, JSON.stringify({ ...state, stoppedAt: new Date().toISOString() }));
  out({ video, bytes, durationSeconds });
}

async function snapshot(v: Values) {
  const sandboxId = req(v["sandbox-id"], "sandbox-id");
  const origin = req(v.origin, "origin");
  const desktop = await Sandbox.connect(sandboxId);
  const browser = await connectSharedChrome(desktop);
  try {
    const page = selectUniqueTargetPage(browser, origin);
    const aria = await page.locator("body").ariaSnapshot();
    out({ url: page.url(), title: await page.title(), snapshot: aria });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  loadQaEnv(true);
  const { values } = parseArgs({
    args: rest,
    options: {
      url: { type: "string" }, width: { type: "string" }, height: { type: "string" }, "timeout-seconds": { type: "string" },
      "sandbox-id": { type: "string" }, "case-dir": { type: "string" }, origin: { type: "string" },
    },
  });
  switch (command) {
    case "create": return create(values);
    case "record-start": return recordStart(values);
    case "record-stop": return recordStop(values);
    case "snapshot": return snapshot(values);
    case "kill": await Sandbox.kill(req(values["sandbox-id"], "sandbox-id")); return out({ killed: true });
    default: throw new Error(USAGE);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
