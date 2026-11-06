import { z } from "zod";
import { callStructured, LlmError, LlmTransportError, type LlmRequest, type LlmTransport } from "../src/llm/structured";
import { makeOpenAiTransport } from "../src/llm/openai-transport";

const schema = z.object({ name: z.string(), n: z.number() });

function fake(outputs: (string | Error)[]) {
  const calls: LlmRequest[] = [];
  const transport: LlmTransport = {
    async complete(req) {
      calls.push(req);
      const o = outputs[Math.min(calls.length - 1, outputs.length - 1)]!;
      if (o instanceof Error) throw o;
      return o;
    },
  };
  return { transport, calls };
}
const run = (t: LlmTransport, maxRetries = 2) =>
  callStructured({ transport: t, schema, schemaName: "thing", system: "sys", user: "usr", maxRetries });

describe("callStructured", () => {
  it("returns the parsed object when the first answer is valid", async () => {
    const f = fake([JSON.stringify({ name: "a", n: 1 })]);
    expect(await run(f.transport)).toEqual({ name: "a", n: 1 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.jsonSchema).toMatchObject({ type: "object" });
    expect(f.calls[0]!.schemaName).toBe("thing");
  });

  it("retries after invalid JSON and succeeds on the second attempt", async () => {
    const f = fake(["not json", JSON.stringify({ name: "a", n: 1 })]);
    expect(await run(f.transport)).toEqual({ name: "a", n: 1 });
    expect(f.calls).toHaveLength(2);
  });

  it("treats a schema mismatch as invalid", async () => {
    const f = fake([JSON.stringify({ name: "a" }), JSON.stringify({ name: "a", n: 2 })]);
    expect((await run(f.transport)).n).toBe(2);
  });

  it("gives up after maxRetries + 1 attempts with an exit-3 LlmError", async () => {
    const f = fake(["x".repeat(500)]);
    const err = await run(f.transport, 2).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.exitCode).toBe(3);
    expect(f.calls).toHaveLength(3);
    expect(err.message).not.toContain("x".repeat(300));
  });

  it("does not retry forever on transport errors either", async () => {
    const f = fake([new LlmTransportError("boom")]);
    const err = await run(f.transport, 1).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(f.calls).toHaveLength(2);
    expect(err.message).toContain("boom");
  });

  it("with maxRetries 0 makes exactly one attempt", async () => {
    const f = fake(["bad"]);
    await run(f.transport, 0).catch(() => undefined);
    expect(f.calls).toHaveLength(1);
  });
});

describe("makeOpenAiTransport", () => {
  it("wraps SDK failures in LlmTransportError without leaking the key", async () => {
    const client = { chat: { completions: { create: async () => { throw new Error("401 Incorrect API key sk-live-abcdefghijklmnop"); } } } };
    const t = makeOpenAiTransport({ apiKey: "sk-live-abcdefghijklmnop", baseUrl: "https://example.test/v1", model: "m", client: client as never });
    const err = await t.complete({ system: "s", user: "u", schemaName: "x", jsonSchema: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmTransportError);
    expect(err.message).not.toContain("sk-live-abcdefghijklmnop");
  });

  it("returns the message content", async () => {
    const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: "{\"a\":1}" } }] }) } } };
    const t = makeOpenAiTransport({ apiKey: "k".repeat(10), baseUrl: "https://example.test/v1", model: "m", client: client as never });
    expect(await t.complete({ system: "s", user: "u", schemaName: "x", jsonSchema: {} })).toBe("{\"a\":1}");
  });
});
