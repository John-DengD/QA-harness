import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { RunStatus } from "./manifest";

export interface LocalArtifact {
  absolutePath: string;
  relativePath: string;
  size: number;
}

export const shouldPublishArtifact = (
  _artifactPath: string,
  _status: RunStatus
): boolean => true;

const walk = async (root: string, current = root): Promise<LocalArtifact[]> => {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  const artifacts: LocalArtifact[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await walk(root, absolutePath)));
    } else if (entry.isFile()) {
      artifacts.push({
        absolutePath,
        relativePath: path.relative(process.cwd(), absolutePath),
        size: (await stat(absolutePath)).size,
      });
    }
  }
  return artifacts;
};

export const collectArtifacts = async (
  roots: string[],
  status: RunStatus
): Promise<LocalArtifact[]> => {
  const nested = await Promise.all(
    roots.map((root) => walk(path.resolve(root)))
  );
  return nested
    .flat()
    .filter((artifact) => shouldPublishArtifact(artifact.relativePath, status))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};
