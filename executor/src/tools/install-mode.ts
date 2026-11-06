import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type InstallMode = {
  mode: "local" | "remote";
  skillDir: string;
  sourceDir?: string;
  reason: string;
};

function validSkillDirectory(candidate: string): string | null {
  try {
    const sourceDir = realpathSync(candidate);
    for (const file of ["SKILL.md", "QA-models", "QA-Knowledge", "hy_ui_autotest/package.json"]) {
      if (!existsSync(path.join(sourceDir, file))) return null;
    }
    accessSync(sourceDir, constants.W_OK);
    return sourceDir;
  } catch {
    return null;
  }
}

export function resolveInstallMode(options: {
  skillDir: string;
  sourceDirEnv?: string;
  markerPath?: string;
}): InstallMode {
  const skillDir = realpathSync(options.skillDir);
  const remote = (reason: string): InstallMode => ({ mode: "remote", skillDir, reason });
  const configuredSource = options.sourceDirEnv?.trim();

  if (configuredSource) {
    const sourceDir = validSkillDirectory(configuredSource);
    return sourceDir
      ? { mode: "local", skillDir, sourceDir, reason: "SKILL_SOURCE_DIR" }
      : remote("SKILL_SOURCE_DIR does not point to a writable skill directory");
  }

  const markerPath = options.markerPath ?? path.join(skillDir, "qa-env/install-mode.json");
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      if (marker.mode === "remote") return remote("local install-mode.json selects remote mode");
      if (marker.mode === "local" && typeof marker.sourceDir === "string") {
        const sourceDir = validSkillDirectory(marker.sourceDir);
        if (sourceDir) return { mode: "local", skillDir, sourceDir, reason: "local install-mode.json" };
      }
      return remote("local install-mode.json has an invalid sourceDir");
    } catch {
      return remote("local install-mode.json cannot be read");
    }
  }

  try {
    const repoRoot = realpathSync(
      execFileSync("git", ["-C", skillDir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    );
    const relative = path.relative(repoRoot, skillDir).split(path.sep).join("/");
    if (relative === "skills/hellyeah-qa/linear-browser-qa") {
      const sourceDir = validSkillDirectory(skillDir);
      if (sourceDir) return { mode: "local", skillDir, sourceDir, reason: "writable skill checkout" };
    }
  } catch {
    // A remote installer may create a local directory or symlink without a Git checkout.
  }
  return remote("installed snapshot; no local maintenance checkout selected");
}
