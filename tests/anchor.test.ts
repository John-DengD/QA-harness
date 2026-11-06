import { anchorInSource, normalizeForAnchor } from "../src/anchor";

const source = `# 登录页\n\n- 用户 **必须** 使用邮箱登录\n- 密码错误时 显示 \`Invalid password\`\n\nThe user sees a banner after saving.\nIt disappears after 5 seconds.`;

describe("anchorInSource", () => {
  it("finds an exact substring", () => {
    expect(anchorInSource(source, "The user sees a banner after saving.")).toBe(true);
  });
  it("ignores differences in line breaks and spacing", () => {
    expect(anchorInSource(source, "banner after saving. It disappears   after 5 seconds.")).toBe(true);
  });
  it("ignores Markdown marks", () => {
    expect(anchorInSource(source, "用户 必须 使用邮箱登录")).toBe(true);
    expect(anchorInSource(source, "显示 Invalid password")).toBe(true);
  });
  it("ignores list bullets and heading marks", () => {
    expect(anchorInSource(source, "密码错误时 显示 Invalid password")).toBe(true);
    expect(anchorInSource(source, "密码错误时 显示 Invalid")).toBe(true);
  });
  it("does not find a paraphrase", () => {
    expect(anchorInSource(source, "A banner is shown once the changes are saved")).toBe(false);
  });
  it("does not find an English translation of a Chinese sentence", () => {
    expect(anchorInSource(source, "Users must log in with email")).toBe(false);
  });
  it("is case sensitive", () => {
    expect(anchorInSource(source, "the user sees a banner after saving.")).toBe(false);
  });
  it("never finds an empty or blank anchor", () => {
    expect(anchorInSource(source, "")).toBe(false);
    expect(anchorInSource(source, "  \n ")).toBe(false);
    expect(anchorInSource(source, "**")).toBe(false);
  });
});

describe("normalizeForAnchor", () => {
  it("collapses whitespace and strips marks", () => {
    expect(normalizeForAnchor("  **a**\n\n  `b`  ")).toBe("a b");
  });
});

describe("anchor minimum length", () => {
  it("rejects a one-word or very short anchor even if the source contains it", () => {
    expect(anchorInSource(source, "banner")).toBe(false);
    expect(anchorInSource(source, "after")).toBe(false);
    expect(anchorInSource(source, "登录页")).toBe(false);
  });
  it("accepts a short but meaningful CJK sentence and a normal English sentence", () => {
    expect(anchorInSource("用户必须使用邮箱登录", "必须使用邮箱登录")).toBe(true);
    expect(anchorInSource(source, "It disappears after 5 seconds.")).toBe(true);
  });
});
