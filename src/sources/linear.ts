import { ExternalError } from "../errors";
import type { FetchLike, SourceDoc } from "./types";

const QUERY = `query($id: String!) { issue(id: $id) { identifier title description comments { nodes { body } } } }`;

export async function fetchLinearIssue(opts: { id: string; apiKey: string; fetch: FetchLike }): Promise<SourceDoc> {
  const scrub = (s: string) => s.split(opts.apiKey).join("[REDACTED]");
  let res;
  try {
    res = await opts.fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: opts.apiKey },
      body: JSON.stringify({ query: QUERY, variables: { id: opts.id } }),
    });
  } catch (e) {
    throw new ExternalError(`Linear request failed for ${opts.id}: ${scrub((e as Error).message)}`);
  }
  if (!res.ok) throw new ExternalError(`Linear returned HTTP ${res.status} for ${opts.id}`);
  const body = await res.json();
  if (body?.errors?.length) {
    throw new ExternalError(`Linear error for ${opts.id}: ${scrub(String(body.errors[0]?.message ?? "unknown"))}`);
  }
  const issue = body?.data?.issue;
  if (!issue) throw new ExternalError(`Linear issue not found: ${opts.id}`);
  const comments: string[] = (issue.comments?.nodes ?? []).map((c: { body: string }) => c.body);
  const text = [`# ${issue.title}`, issue.description ?? "", ...comments].filter((p) => p !== "").join("\n\n");
  return { ref: `linear:${issue.identifier}`, title: issue.title, text };
}
