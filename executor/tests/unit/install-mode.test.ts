import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveInstallMode } from "../../src/tools/install-mode";

const roots: string[] = [];

async function skillAt(directory: string) {
  await mkdir(path.join(directory, "QA-models"), { recursive: true });
  await mkdir(path.join(directory, "QA-Knowledge"), { recursive: true });
  await mkdir(path.join(directory, "qa-env"), { recursive: true });
  await mkdir(path.join(directory, "hy_ui_autotest"), { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: linear-browser-qa\n---\n");
  await writeFile(path.join(directory, "hy_ui_autotest/package.json"), "{}");
  return directory;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("install mode resolution", () => {
  it("treats a plain installed snapshot as remote", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qa-skill-"));
    roots.push(root);
    const skillDir = await skillAt(path.join(root, "linear-browser-qa"));

    expect(resolveInstallMode({ skillDir, sourceDirEnv: "" })).toMatchObject({ mode: "remote" });
  });

  it("uses an explicit local maintenance directory without requiring Git", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qa-skill-"));
    roots.push(root);
    const skillDir = await skillAt(path.join(root, "installed"));
    const sourceDir = await skillAt(path.join(root, "editable"));
    await writeFile(path.join(skillDir, "qa-env/install-mode.json"), JSON.stringify({ mode: "local", sourceDir }));

    expect(resolveInstallMode({ skillDir, sourceDirEnv: "" })).toMatchObject({
      mode: "local", sourceDir: await realpath(sourceDir), reason: "local install-mode.json",
    });
  });

  it("recognizes the skill inside a writable repository checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qa-skill-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    const skillDir = await skillAt(path.join(root, "skills/hellyeah-qa/linear-browser-qa"));

    expect(resolveInstallMode({ skillDir, sourceDirEnv: "" })).toMatchObject({
      mode: "local", sourceDir: await realpath(skillDir), reason: "writable skill checkout",
    });
  });

  it("respects an explicit remote choice even inside a checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qa-skill-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", root]);
    const skillDir = await skillAt(path.join(root, "skills/hellyeah-qa/linear-browser-qa"));
    await writeFile(path.join(skillDir, "qa-env/install-mode.json"), JSON.stringify({ mode: "remote" }));

    expect(resolveInstallMode({ skillDir, sourceDirEnv: "" })).toMatchObject({
      mode: "remote", reason: "local install-mode.json selects remote mode",
    });
  });

  it("does not guess another path when explicit local configuration is invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qa-skill-"));
    roots.push(root);
    const skillDir = await skillAt(path.join(root, "installed"));

    expect(resolveInstallMode({ skillDir, sourceDirEnv: path.join(root, "missing") })).toMatchObject({
      mode: "remote", reason: "SKILL_SOURCE_DIR does not point to a writable skill directory",
    });
  });
});
