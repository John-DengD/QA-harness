import type { LlmRequest, LlmTransport } from "../src/llm/structured";
import { extractFromSources } from "../src/extract/extract";
import type { Runbook } from "../src/runbook";
import type { SourceDoc } from "../src/sources/types";

const runbook: Runbook = { root: "/rb", modules: [], text: () => "KNOWLEDGE-SOURCES-RULES" };
const source: SourceDoc = {
  ref: "linear:DEV-1",
  title: "Banner",
  text: "# Banner\n\n- 保存后 **必须** 显示成功横幅\n- The banner disappears after 5 seconds.",
};
const changeModel = { surfaces: ["dashboard"], entities: ["banner"], transitions: [], sideEffects: [] };

function transportReturning(atoms: { text: string; sourceRef: string; anchor: string }[]) {
  const seen: LlmRequest[] = [];
  const t: LlmTransport = { async complete(req) { seen.push(req); return JSON.stringify({ atoms, changeModel }); } };
  return { t, seen };
}
const run = (t: LlmTransport, sources = [source]) => extractFromSources({ transport: t, runbook, sources, maxRetries: 0 });

describe("extractFromSources", () => {
  it("keeps an atom whose anchor is verbatim and numbers it A01", async () => {
    const { t } = transportReturning([{ text: "banner after save", sourceRef: "linear:DEV-1", anchor: "The banner disappears after 5 seconds." }]);
    const r = await run(t);
    expect(r.acceptance.atoms).toEqual([{ id: "A01", text: "banner after save", sourceRef: "linear:DEV-1", anchor: "The banner disappears after 5 seconds." }]);
    expect(r.report.dropped).toEqual([]);
    expect(r.changeModel.surfaces).toEqual(["dashboard"]);
  });

  it("drops a paraphrased or translated anchor and records why", async () => {
    const { t } = transportReturning([
      { text: "x", sourceRef: "linear:DEV-1", anchor: "A success banner is shown after saving" },
      { text: "y", sourceRef: "linear:DEV-1", anchor: "must show a success banner after saving" },
    ]);
    const r = await run(t);
    expect(r.acceptance.atoms).toEqual([]);
    expect(r.report.dropped.map((d) => d.reason)).toEqual(["anchor not found in source", "anchor not found in source"]);
    expect(r.report.dropped[0]).toMatchObject({ sourceRef: "linear:DEV-1", anchor: "A success banner is shown after saving" });
  });

  it("accepts an anchor that differs only by Markdown marks", async () => {
    const { t } = transportReturning([{ text: "z", sourceRef: "linear:DEV-1", anchor: "保存后 必须 显示成功横幅" }]);
    expect((await run(t)).acceptance.atoms).toHaveLength(1);
  });

  it("drops an atom citing a sourceRef that was not supplied", async () => {
    const { t } = transportReturning([{ text: "z", sourceRef: "linear:OTHER-9", anchor: "The banner disappears after 5 seconds." }]);
    const r = await run(t);
    expect(r.acceptance.atoms).toEqual([]);
    expect(r.report.dropped[0]!.reason).toBe("unknown sourceRef");
  });

  it("numbers survivors consecutively even when earlier atoms were dropped", async () => {
    const { t } = transportReturning([
      { text: "bad", sourceRef: "linear:DEV-1", anchor: "nonsense not in source" },
      { text: "ok1", sourceRef: "linear:DEV-1", anchor: "The banner disappears after 5 seconds." },
      { text: "ok2", sourceRef: "linear:DEV-1", anchor: "保存后 必须 显示成功横幅" },
    ]);
    expect((await run(t)).acceptance.atoms.map((a) => a.id)).toEqual(["A01", "A02"]);
  });

  it("lists the sources it was given in the report", async () => {
    const { t } = transportReturning([]);
    expect((await run(t)).report.sources).toEqual([{ ref: "linear:DEV-1", title: "Banner" }]);
  });

  it("puts the no-translation rule and the runbook rules in the prompt, and nothing else from the machine", async () => {
    const { t, seen } = transportReturning([]);
    await run(t);
    expect(seen[0]!.system).toContain("never translate");
    expect(seen[0]!.system).toContain("KNOWLEDGE-SOURCES-RULES");
    expect(seen[0]!.user).toContain("linear:DEV-1");
    expect(seen[0]!.user).toContain("The banner disappears after 5 seconds.");
    expect(seen[0]!.system + seen[0]!.user).not.toContain("/rb");
  });
});
