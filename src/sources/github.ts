import { ExternalError } from "../errors";
import type { ExecLike, PrInfo } from "./types";

export async function fetchPr(opts: { url: string; exec: ExecLike }): Promise<PrInfo> {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(opts.url);
  if (!m) throw new ExternalError(`not a GitHub pull request URL: ${opts.url}`);
  const r = await opts.exec("gh", [
    "pr", "view", opts.url, "--json", "number,state,headRefOid,baseRefOid,body,comments,url",
  ]);
  if (r.code !== 0) throw new ExternalError(`gh pr view failed for ${opts.url}: ${r.stderr.trim().slice(0, 200)}`);
  let j: any;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    throw new ExternalError(`gh returned invalid JSON for ${opts.url}`);
  }
  return {
    url: j.url ?? opts.url,
    number: j.number,
    repo: m[1]!,
    state: j.state,
    headSha: j.headRefOid,
    baseSha: j.baseRefOid,
    description: j.body ?? "",
    comments: (j.comments ?? []).map((c: any) => ({ author: c.author?.login ?? "", body: c.body ?? "", url: c.url ?? "" })),
  };
}
