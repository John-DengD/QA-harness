import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const FORBIDDEN = ["preview-sandbox", "github-actions", "hellyeahai.com", "railway.app", "vercel.app", "Sandbox ready", "Sandbox torn down"];
const ROOT = path.resolve(__dirname, "..");

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    statSync(p).isDirectory() ? files(p, out) : p.endsWith(".ts") && out.push(p);
  }
  return out;
}

describe("environment facts stay out of the code (spec §13)", () => {
  it("src/ contains no address, marker, bot name or status wording", () => {
    for (const f of files(path.join(ROOT, "src"))) {
      const text = readFileSync(f, "utf8");
      for (const w of FORBIDDEN) expect(text.includes(w), `${path.relative(ROOT, f)} contains "${w}"`).toBe(false);
    }
  });
  it("qa-harness.config.json contains none of them", () => {
    const text = readFileSync(path.join(ROOT, "qa-harness.config.json"), "utf8");
    for (const w of FORBIDDEN) expect(text.includes(w), w).toBe(false);
  });
});
