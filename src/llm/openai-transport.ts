import OpenAI from "openai";
import { type LlmRequest, type LlmTransport, LlmTransportError } from "./structured";

type ChatClient = {
  chat: { completions: { create(body: unknown): Promise<{ choices: { message: { content: string | null } }[] }> } };
};

/**
 * Thin adapter over the OpenAI SDK. JSON-schema output is requested non-strict: strict mode rejects
 * optional fields, and every answer is validated with zod by callStructured anyway.
 */
export function makeOpenAiTransport(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  client?: ChatClient;
}): LlmTransport {
  const client: ChatClient = opts.client ?? (new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl }) as unknown as ChatClient);
  return {
    async complete(req: LlmRequest): Promise<string> {
      try {
        const res = await client.chat.completions.create({
          model: opts.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: false },
          },
        });
        const content = res.choices[0]?.message.content;
        if (!content) throw new Error("empty completion");
        return content;
      } catch (e) {
        const msg = (e as Error).message.split(opts.apiKey).join("[REDACTED]");
        throw new LlmTransportError(msg);
      }
    },
  };
}
