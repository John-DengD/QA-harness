import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError } from "../src/config";
import { createRunDir } from "../src/run-dir";

describe("createRunDir", () => {
  it("creates RUN_ROOT/<feature>/runs/<runId>", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-rd-"));
    const dir = createRunDir(root, "HEL-1", "r1", { force: false });
    expect(dir).toBe(path.join(root, "HEL-1", "runs", "r1"));
    expect(existsSync(dir)).toBe(true);
  });
  it("without force, an existing run dir throws and its files are untouched", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-rd-"));
    const dir = createRunDir(root, "HEL-1", "r1", { force: false });
    writeFileSync(path.join(dir, "marker"), "keep");
    expect(() => createRunDir(root, "HEL-1", "r1", { force: false })).toThrow(ConfigError);
    expect(readFileSync(path.join(dir, "marker"), "utf8")).toBe("keep");
  });
  it("with force, reuses the existing dir", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-rd-"));
    createRunDir(root, "HEL-1", "r1", { force: false });
    expect(() => createRunDir(root, "HEL-1", "r1", { force: true })).not.toThrow();
  });
  it("rejects feature or runId that could escape the run root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qa-rd-"));
    expect(() => createRunDir(root, "../evil", "r1", { force: false })).toThrow(ConfigError);
    expect(() => createRunDir(root, "HEL-1", "a/b", { force: false })).toThrow(ConfigError);
    expect(() => createRunDir(root, "HEL-1", "", { force: false })).toThrow(ConfigError);
  });
});
