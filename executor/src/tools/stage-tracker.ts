import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { redactEmail } from "./identity";
import type { FailureType, StageManifest } from "../report/manifest";
import { runStage } from "./stages";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const safeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(EMAIL_PATTERN, (email) => redactEmail(email))
    .replace(UUID_PATTERN, "[redacted-id]")
    .slice(0, 240);

export class StageTracker {
  readonly #outputPath: string;
  readonly #stages: StageManifest[] = [];
  readonly #context: Pick<StageManifest, "caseId" | "tag">;

  constructor(
    outputPath: string,
    context: Pick<StageManifest, "caseId" | "tag"> = {}
  ) {
    this.#outputPath = outputPath;
    this.#context = context;
  }

  async run<T>(
    name: string,
    task: () => Promise<T>,
    failureType: FailureType = "product"
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await runStage(name, task);
      this.#stages.push({
        ...this.#context,
        durationMs: Date.now() - startedAt,
        name,
        status: "passed",
      });
      await this.#persist();
      return result;
    } catch (error) {
      this.#stages.push({
        ...this.#context,
        durationMs: Date.now() - startedAt,
        error: safeError(error),
        failureType,
        name,
        status: "failed",
      });
      await this.#persist();
      throw error;
    }
  }

  async runAdvisory(name: string, task: () => Promise<void>): Promise<void> {
    const startedAt = Date.now();
    try {
      await task();
      this.#stages.push({
        ...this.#context,
        durationMs: Date.now() - startedAt,
        name,
        status: "passed",
      });
    } catch (error) {
      this.#stages.push({
        ...this.#context,
        durationMs: Date.now() - startedAt,
        error: safeError(error),
        failureType: "visual",
        name,
        status: "warning",
      });
    }
    await this.#persist();
  }

  async #persist(): Promise<void> {
    await mkdir(path.dirname(this.#outputPath), { recursive: true });
    await writeFile(this.#outputPath, JSON.stringify(this.#stages, null, 2));
  }
}
