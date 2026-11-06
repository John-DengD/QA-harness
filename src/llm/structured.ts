import { z } from "zod";
import { ExternalError } from "../errors";

export type LlmRequest = { system: string; user: string; schemaName: string; jsonSchema: object };

export interface LlmTransport {
  complete(req: LlmRequest): Promise<string>;
}

export class LlmTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmTransportError";
  }
}

export class LlmError extends ExternalError {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);

/**
 * Asks the model for JSON matching `schema`, validates it with zod, and retries (maxRetries more
 * times) on invalid output or transport failure. Never returns partial or unvalidated data.
 */
export async function callStructured<T>(opts: {
  transport: LlmTransport;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  user: string;
  maxRetries: number;
}): Promise<T> {
  const jsonSchema = z.toJSONSchema(opts.schema) as object;
  let last = "no attempt made";
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    let raw: string;
    try {
      raw = await opts.transport.complete({
        system: opts.system,
        user: opts.user,
        schemaName: opts.schemaName,
        jsonSchema,
      });
    } catch (e) {
      last = `transport: ${clip((e as Error).message)}`;
      continue;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      last = `invalid JSON: ${clip(raw, 80)}`;
      continue;
    }
    const checked = opts.schema.safeParse(parsedJson);
    if (checked.success) return checked.data;
    last = `schema mismatch: ${clip(checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))}`;
  }
  throw new LlmError(`LLM call "${opts.schemaName}" failed after ${opts.maxRetries + 1} attempt(s): ${last}`);
}
