import { notImplemented, type Stage } from "./types";

export const reviewStage: Stage = {
  name: "review",
  needs: ["OPENAI_API_KEY"],
  requires: ["cases.json"],
  createsRunDir: false,
  run: notImplemented("review"),
};
