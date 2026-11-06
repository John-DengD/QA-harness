import { notImplemented, type Stage } from "./types";

export const runStage: Stage = {
  name: "run",
  needs: ["E2B_API_KEY", "OPENAI_API_KEY"],
  requires: ["cases.reviewed.json"],
  createsRunDir: false,
  run: notImplemented("run"),
};
