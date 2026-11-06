import { ExitCode } from "./exit-codes";

/** Failure of an external service (OpenAI, Linear, GitHub, E2B): exit code 3 (spec §7). */
export class ExternalError extends Error {
  readonly exitCode = ExitCode.EXTERNAL;
  constructor(message: string) {
    super(message);
    this.name = "ExternalError";
  }
}

/** Input or state that makes the stage impossible (no live sandbox, merged PR, SHA mismatch...): exit code 2. */
export class InputError extends Error {
  readonly exitCode = ExitCode.CONFIG;
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
