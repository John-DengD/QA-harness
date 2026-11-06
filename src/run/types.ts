import type { Env } from "../contracts/env";
import type { ScriptValidator } from "./generate";

export interface SandboxDriver {
  create(opts: { url: string }): Promise<{ sandboxId: string }>;
  startRecording(sandboxId: string, caseDir: string): Promise<void>;
  stopRecording(sandboxId: string, caseDir: string): Promise<{ videoPath: string; bytes: number }>;
  snapshot(sandboxId: string, origin: string): Promise<string>;
  kill(sandboxId: string): Promise<void>;
}

export interface PlaywrightRunner {
  run(opts: {
    sandboxId: string;
    specPath: string;
    grep?: string;
    outputDir: string;
    timeoutMs: number;
  }): Promise<{ exitCode: number; stdout: string; stderr: string; reportJson: unknown | null; timedOut: boolean }>;
}

export interface RunRegistry {
  register(opts: { runDir: string; runId: string; feature: string; env: Env; taskModelRef: string }): Promise<void>;
}

export type RunDeps = {
  sandbox: SandboxDriver;
  playwright: PlaywrightRunner;
  registry: RunRegistry;
  validate: ScriptValidator;
};
