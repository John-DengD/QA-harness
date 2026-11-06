import { z } from "zod";
import { type Runbook, RunbookError } from "./runbook";

const nonEmpty = z.string().min(1);

/** Environment rules live in the Runbook file runbook/environments.json (spec §13); code holds none of them. */
export const Environments = z.object({
  prSandbox: z.object({
    marker: nonEmpty,
    botAuthor: nonEmpty,
    status: z.object({ ready: nonEmpty, tornDown: nonEmpty }),
    footerShaPattern: nonEmpty.refine(
      (p) => {
        try {
          return new RegExp(p + "|").exec("")!.length === 2;
        } catch {
          return false;
        }
      },
      { message: "must be a valid RegExp with exactly one capture group" },
    ),
    urlLabels: z.object({ dashboard: nonEmpty, admin: nonEmpty.optional(), api: nonEmpty.optional() }),
  }),
});
export type Environments = z.infer<typeof Environments>;

export function loadEnvironments(runbook: Runbook): Environments {
  let raw: unknown;
  try {
    raw = JSON.parse(runbook.text("environments.json"));
  } catch (e) {
    throw new RunbookError(`environments.json is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = Environments.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new RunbookError(`invalid environments.json: ${why}`);
  }
  return parsed.data;
}
