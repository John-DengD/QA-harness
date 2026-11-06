import { notImplemented, type Stage } from "./types";

export const reportStage: Stage = {
  name: "report",
  needs: [],
  requires: ["results"],
  createsRunDir: false,
  run: notImplemented("report"),
};
