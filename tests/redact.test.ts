import { makeRedactor } from "../src/redact";

describe("makeRedactor", () => {
  it("replaces a secret inside a longer line", () => {
    expect(makeRedactor(["sk-abcdef123456"])("x sk-abcdef123456 y")).toBe("x [REDACTED] y");
  });
  it("replaces every occurrence", () => {
    expect(makeRedactor(["sk-abcdef123456"])("sk-abcdef123456/sk-abcdef123456")).toBe("[REDACTED]/[REDACTED]");
  });
  it("ignores short values so ordinary text is not corrupted", () => {
    expect(makeRedactor(["abc"])("abc def")).toBe("abc def");
    expect(makeRedactor(["", "1234567"])("1234567")).toBe("1234567");
  });
  it("treats regex metacharacters literally", () => {
    expect(makeRedactor(["pa$$w.rd+(1)"])("a pa$$w.rd+(1) b")).toBe("a [REDACTED] b");
  });
  it("redacts the longer secret first when one contains the other", () => {
    expect(makeRedactor(["secret-token", "secret-token-extended"])("secret-token-extended")).toBe("[REDACTED]");
  });
});
