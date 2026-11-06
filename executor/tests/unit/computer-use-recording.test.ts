import { expect, it } from "vitest";

import { assertRecordingSandbox } from "../../src/tools/computer-use-recording";

it("rejects an unknown or wrong sandbox before touching a recorder PID", () => {
  expect(() => assertRecordingSandbox({ sandboxId: "current" }, "current")).not.toThrow();
  expect(() => assertRecordingSandbox({ sandboxId: "other" }, "current"))
    .toThrow("another or an unknown E2B sandbox");
  expect(() => assertRecordingSandbox({}, "current"))
    .toThrow("another or an unknown E2B sandbox");
});
