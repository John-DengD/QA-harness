import { notImplemented, type Stage } from "./types";

export const designStage: Stage = {
  name: "design",
  needs: ["OPENAI_API_KEY"],
  requires: ["acceptance.json"],
  createsRunDir: false,
  run: notImplemented("design"),
};
