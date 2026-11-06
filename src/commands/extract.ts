import { notImplemented, type Stage } from "./types";

export const extractStage: Stage = {
  name: "extract",
  needs: ["OPENAI_API_KEY"],
  requires: [],
  createsRunDir: true,
  run: notImplemented("extract"),
};
