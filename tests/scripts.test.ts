import path from "node:path";
import { findExistingScript, gateSideEffects, loadAuthorizedSideEffects, loadBindings } from "../src/run/scripts";
import { loadRunbook } from "../src/runbook";

const runbook = loadRunbook(path.resolve(__dirname, "../runbook"));
const c = (title: string) => ({ id: "C01", title, generator: "G1", type: "happy", expected: { text: "e", sourceRef: "s", anchor: "a" }, preconditions: [], risk: "", testability: { state: "ready" } }) as never;

describe("findExistingScript", () => {
  const bindings = [{ title: "Open the campaign list", spec: "tests/release/cases/19-action-iteration-baseline.spec.ts", grep: "B1" }];
  it("matches ignoring case and whitespace", () => {
    expect(findExistingScript(c("  open   THE campaign list "), bindings)).toEqual({ spec: bindings[0]!.spec, grep: "B1" });
  });
  it("returns null without a match", () => expect(findExistingScript(c("something else"), bindings)).toBeNull());
});

describe("runbook files", () => {
  it("loads the real bindings and authorised side effects", () => {
    expect(Array.isArray(loadBindings(runbook))).toBe(true);
    expect(loadAuthorizedSideEffects(runbook)).toEqual(expect.arrayContaining(["disposable-account"]));
    expect(loadAuthorizedSideEffects(runbook)).not.toContain("wallet-top-up");
  });
});

describe("gateSideEffects", () => {
  it("accepts declared effects that are all authorised", () => expect(gateSideEffects(["disposable-account"], ["disposable-account", "campaign-draft"])).toEqual({ ok: true }));
  it("accepts no side effects", () => expect(gateSideEffects([], [])).toEqual({ ok: true }));
  it("names every unauthorised effect", () => {
    expect(gateSideEffects(["submit-payment", "campaign-draft", "launch"], ["campaign-draft"])).toEqual({ ok: false, unauthorized: ["submit-payment", "launch"] });
  });
});
