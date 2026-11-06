import { readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../config";
import type { SourceDoc } from "./types";

export function loadTicketFile(file: string): SourceDoc {
  const abs = path.resolve(file);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read ticket file ${abs}: ${(e as Error).message}`);
  }
  if (text.trim() === "") throw new ConfigError(`ticket file is empty: ${abs}`);
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return { ref: `file:${abs}`, title: first.replace(/^#+\s*/, "").trim(), text };
}
