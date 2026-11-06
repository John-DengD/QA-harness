import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { canSupportProductFail, loadRunbook, REQUIRED_FILES, RunbookError } from "../src/runbook";

const REAL = path.resolve(__dirname, "../runbook");

function fm(status: string, extra = "version: 1\nlast_reviewed: 2026-09-20\n") {
  return `---\nid: hellyeah.x\nproduct: hellyeah\nstatus: ${status}\n${extra}---\n# X\n`;
}

function makeRunbook(opts: { skip?: string; moduleStatus?: string; moduleFm?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "qa-rb-"));
  for (const rel of REQUIRED_FILES) {
    if (rel === opts.skip) continue;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), rel.endsWith("core-journeys.md") ? fm("draft", "version: 2\nlast_reviewed: 2026-09-20\n") : "text\n");
  }
  mkdirSync(path.join(root, "QA-models/hellyeah"), { recursive: true });
  writeFileSync(path.join(root, "QA-models/hellyeah/x.md"), opts.moduleFm ?? fm(opts.moduleStatus ?? "pilot"));
  writeFileSync(path.join(root, "QA-models/hellyeah/index.md"), "# no frontmatter\n");
  return root;
}

describe("loadRunbook", () => {
  it("loads the real runbook: 17 modules, 12 pilot, 5 draft, none active", () => {
    const rb = loadRunbook(REAL);
    expect(rb.modules).toHaveLength(17);
    const count = (s: string) => rb.modules.filter((m) => m.status === s).length;
    expect([count("pilot"), count("draft"), count("active")]).toEqual([12, 5, 0]);
    expect(rb.modules.find((m) => m.id === "hellyeah.core-journeys")?.status).toBe("draft");
    expect(rb.modules.every((m) => !canSupportProductFail(m))).toBe(true);
    expect(typeof rb.modules[0]!.lastReviewed).toBe("string");
  });

  it("skips files without frontmatter (index.md)", () => {
    const rb = loadRunbook(makeRunbook());
    expect(rb.modules.map((m) => path.basename(m.path)).sort()).toEqual(["core-journeys.md", "x.md"]);
  });

  it("canSupportProductFail is true only for active", () => {
    const mk = (status: "active" | "pilot" | "draft") => ({ id: "a", path: "p", status, version: 1, lastReviewed: "d" });
    expect([mk("active"), mk("pilot"), mk("draft")].map(canSupportProductFail)).toEqual([true, false, false]);
  });

  it("names the file when status is not pilot|draft|active", () => {
    expect(() => loadRunbook(makeRunbook({ moduleStatus: "wip" }))).toThrow(/x\.md/);
  });

  it("names the file when version is missing", () => {
    expect(() => loadRunbook(makeRunbook({ moduleFm: fm("pilot", "last_reviewed: 2026-09-20\n") }))).toThrow(/x\.md/);
  });

  it("lists every missing required file", () => {
    const root = makeRunbook({ skip: "references/verdicts.md" });
    try {
      loadRunbook(root);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RunbookError);
      expect((e as RunbookError).exitCode).toBe(2);
      expect((e as Error).message).toContain("references/verdicts.md");
    }
  });

  it("fails when the runbook directory does not exist", () => {
    expect(() => loadRunbook("/nonexistent/qa-runbook")).toThrow(RunbookError);
  });

  it("text() reads inside the runbook and refuses to escape it", () => {
    const rb = loadRunbook(makeRunbook());
    expect(rb.text("references/verdicts.md")).toBe("text\n");
    expect(() => rb.text("../outside.md")).toThrow(RunbookError);
  });
});

afterAll(() => rmSync(path.join(tmpdir(), "qa-rb-none"), { force: true }));
