import { describe, expect, it, vi } from "vitest";

import { runReleaseGate } from "../../src/tools/release-gate";

const input = {
  baseUrl: "https://app-staging.hellyeahai.com",
  commitSha: "4585e9793a4a3399c608e163e765d93d5adf1701",
  correlationId: "dashboard-42-4585e97",
  release: "dashboard-42",
  repository: "finalroundai/hy_ui_autotest",
  sourceRepository: "finalroundai/hellyeah-v2",
  sourceRunAttempt: "1",
  sourceRunId: "42",
  token: "github-token",
  upstreamRunUrl: "https://github.com/finalroundai/hellyeah-v2/actions/runs/42",
};

const response = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

describe("runReleaseGate", () => {
  it("dispatches once and waits for the correlated successful run", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200, { workflow_runs: [] }))
      .mockResolvedValueOnce(
        response(200, {
          workflow_runs: [
            {
              conclusion: "success",
              display_title: "Release E2E / dashboard-42-4585e97",
              html_url:
                "https://github.com/finalroundai/hy_ui_autotest/actions/runs/99",
              id: 99,
              status: "completed",
            },
          ],
        })
      );

    const result = await runReleaseGate(input, {
      fetcher,
      pollIntervalMs: 0,
      sleep: vi.fn().mockResolvedValue(undefined),
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({ conclusion: "success", id: 99 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    ).toMatchObject({
      client_payload: {
        contractVersion: 1,
        correlationId: "dashboard-42-4585e97",
        environment: "staging",
        release: "dashboard-42",
        sourceRepository: "finalroundai/hellyeah-v2",
      },
      event_type: "staging-production-release",
    });
  });

  it("fails the upstream gate when the downstream run fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(
        response(200, {
          workflow_runs: [
            {
              conclusion: "failure",
              display_title: "Release E2E / dashboard-42-4585e97",
              html_url:
                "https://github.com/finalroundai/hy_ui_autotest/actions/runs/100",
              id: 100,
              status: "completed",
            },
          ],
        })
      );

    await expect(
      runReleaseGate(input, {
        fetcher,
        pollIntervalMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
        timeoutMs: 1_000,
      })
    ).rejects.toThrow("Release E2E concluded with failure");
  });

  it("returns the failed run instead of throwing when success is advisory", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(
        response(200, {
          workflow_runs: [
            {
              conclusion: "failure",
              display_title: "Release E2E / dashboard-42-4585e97",
              html_url:
                "https://github.com/finalroundai/hy_ui_autotest/actions/runs/100",
              id: 100,
              status: "completed",
            },
          ],
        })
      );

    const result = await runReleaseGate(input, {
      fetcher,
      pollIntervalMs: 0,
      requireSuccess: false,
      sleep: vi.fn().mockResolvedValue(undefined),
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({ conclusion: "failure", id: 100 });
  });

  it("rejects a non-release source before dispatching", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      runReleaseGate(
        { ...input, sourceRepository: "finalroundai/some-other-repo" },
        { fetcher }
      )
    ).rejects.toThrow("source repository is not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
