import { describe, expect, it } from "vitest";

import {
  buildGuardedTask,
  buildJevCliArgs,
  buildJevEnvironment,
  classifyJevStatus,
} from "../../src/tools/jev-exploration";

describe("Jev exploration isolation", () => {
  it("classifies early-stop statuses as partial exploration, not case failure", () => {
    expect(classifyJevStatus("stuck")).toBe("partial");
    expect(classifyJevStatus("max_steps")).toBe("partial");
    expect(classifyJevStatus("timeout")).toBe("partial");
    expect(classifyJevStatus("goal_achieved")).toBe("completed");
  });

  it("forces no-typing and a separate screenshot artifact", () => {
    const args = buildJevCliArgs({
      task: "Find the campaign creation entry",
      startUrl: "https://example.com",
      outputDir: "/tmp/jev-run",
      maxSteps: 8,
      maxSeconds: 30,
    });

    expect(args).toContain("--no-typing");
    expect(args).toContain("/tmp/jev-run/final.jpg");
    expect(args.join(" ")).toContain("Do not submit forms");
  });

  it("adds a read-only guard to every task", () => {
    const task = buildGuardedTask("Open settings");
    expect(task).toContain("Stop before any action");
    expect(task).toContain("Exploration goal: Open settings");
  });

  it("does not expose unrelated test secrets to the explorer process", () => {
    const env = buildJevEnvironment({
      PATH: "/bin",
      TYPESAFE_API_KEY: "jev-key",
      CLERK_SECRET_KEY: "clerk-key",
      STAGING_E2E_ADMIN_TOKEN: "admin-token",
    });

    expect(env.PATH).toBe("/bin");
    expect(env.TYPESAFE_API_KEY).toBe("jev-key");
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.STAGING_E2E_ADMIN_TOKEN).toBeUndefined();
  });
});
