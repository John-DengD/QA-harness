export type SourceDoc = { ref: string; title: string; text: string };

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export type ExecLike = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export type PrInfo = {
  url: string;
  number: number;
  repo: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  headSha: string;
  baseSha: string;
  description: string;
  comments: { author: string; body: string; url: string }[];
};
