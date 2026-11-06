import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "../../src/config";

const VALID_ENV = {
  CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_SECRET_KEY: "sk_test_example",
  E2E_BASE_URL: "https://app-staging.hellyeahai.com",
  E2E_CONTROL_URL: "https://api-staging.hellyeahai.com/internal/e2e",
  E2E_EMAIL_BASE: "qa@hellyeahai.com",
  E2E_TEST_PASSWORD: "Strong-test-password-123!",
  MIDSCENE_MODEL_API_KEY: "test-model-key",
  MIDSCENE_MODEL_BASE_URL: "https://models.dev.example/v1",
  MIDSCENE_MODEL_FAMILY: "gpt-5",
  MIDSCENE_MODEL_NAME: "gpt-test",
  STAGING_E2E_ADMIN_TOKEN: "staging-control-token-at-least-32-characters",
};

describe("parseRuntimeConfig", () => {
  it("normalizes URLs and accepts the staging contract", () => {
    const config = parseRuntimeConfig({
      ...VALID_ENV,
      E2E_BASE_URL: `${VALID_ENV.E2E_BASE_URL}/`,
    });

    expect(config.baseUrl).toBe(VALID_ENV.E2E_BASE_URL);
    expect(config.controlUrl).toBe(VALID_ENV.E2E_CONTROL_URL);
    expect(config.modelFamily).toBe("gpt-5");
  });

  it("rejects a non-staging target", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_BASE_URL: "https://app.hellyeahai.com",
      })
    ).toThrow(/staging/i);
  });

  it("accepts the Dashboard and API hostnames from a PR sandbox", () => {
    const config = parseRuntimeConfig({
      ...VALID_ENV,
      E2E_CONTROL_URL: undefined,
      E2E_API_URL: "https://api-server-pr-1117.up.railway.app",
      E2E_BASE_URL:
        "https://hellyeah-dashboard-eoh7m352n-final-round-ai.vercel.app",
    });

    expect(config.baseUrl).toContain("hellyeah-dashboard-eoh7m352n");
    expect(config.apiUrl).toBe("https://api-server-pr-1117.up.railway.app");
  });

  it("rejects unrelated Vercel and Railway targets", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_BASE_URL: "https://unrelated-final-round-ai.vercel.app",
      })
    ).toThrow(/PR sandbox/i);
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_API_URL: "https://api-server-production.up.railway.app",
      })
    ).toThrow(/PR sandbox/i);
  });

  it("rejects lookalike staging hosts for both control and user APIs", () => {
    for (const field of ["E2E_BASE_URL", "E2E_API_URL", "E2E_CONTROL_URL"] as const) {
      expect(() =>
        parseRuntimeConfig({
          ...VALID_ENV,
          [field]: "https://staging.attacker.example/internal/e2e",
        })
      ).toThrow(/known Hellyeah staging/i);
    }
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_API_URL: "https://api-staging.hellyeahai.com.attacker.example",
      })
    ).toThrow(/known Hellyeah staging/i);
  });

  it("accepts only the configured Hellyeah staging hosts", () => {
    const config = parseRuntimeConfig({
      ...VALID_ENV,
      E2E_API_URL: "https://api-staging.hellyeahai.com",
      E2E_BASE_URL: "https://ops-staging.hellyeahai.com",
    });
    expect(config.apiUrl).toBe("https://api-staging.hellyeahai.com");
    expect(config.baseUrl).toBe("https://ops-staging.hellyeahai.com");
  });

  it("accepts HTTP only for local development targets", () => {
    const config = parseRuntimeConfig({
      ...VALID_ENV,
      E2E_BASE_URL: "http://localhost:3001",
      E2E_CONTROL_URL: "http://127.0.0.1:8000/internal/e2e",
    });

    expect(config.baseUrl).toBe("http://localhost:3001");
    expect(config.controlUrl).toBe(
      "http://127.0.0.1:8000/internal/e2e"
    );
  });

  it("rejects HTTP for non-local targets", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_BASE_URL: "http://app-staging.hellyeahai.com",
      })
    ).toThrow(/HTTPS/i);
  });

  it("rejects a base inbox that already uses plus addressing", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_EMAIL_BASE: "qa+existing@hellyeahai.com",
      })
    ).toThrow(/plus addressing/i);
  });

  it("reports missing variables without exposing configured secrets", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        CLERK_SECRET_KEY: undefined,
      })
    ).toThrow(/CLERK_SECRET_KEY/);
  });

  it("requires the Clerk publishable key used by the testing token", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        CLERK_PUBLISHABLE_KEY: undefined,
      })
    ).toThrow(/CLERK_PUBLISHABLE_KEY/);
  });
});

describe("parseRuntimeConfig target-derived control and API URLs", () => {
  const LOCAL_DEFAULTS = {
    ...VALID_ENV,
    E2E_CONTROL_URL: "http://localhost:8000/internal/e2e",
  };
  const SANDBOX_DASHBOARD = "https://hellyeah-dashboard-eoh7m352n-final-round-ai.vercel.app";

  it("derives staging control and API from a staging target, ignoring local defaults", () => {
    const config = parseRuntimeConfig({
      ...LOCAL_DEFAULTS,
      E2E_BASE_URL: "https://app-staging.hellyeahai.com",
    });
    expect(config.apiUrl).toBe("https://api-staging.hellyeahai.com");
    expect(config.controlUrl).toBe("https://api-staging.hellyeahai.com/internal/e2e");
  });

  it("derives staging control for the staging Admin dashboard", () => {
    const config = parseRuntimeConfig({
      ...LOCAL_DEFAULTS,
      E2E_BASE_URL: "https://ops-staging.hellyeahai.com",
    });
    expect(config.controlUrl).toBe("https://api-staging.hellyeahai.com/internal/e2e");
  });

  it("derives sandbox control from the sandbox API URL, ignoring local defaults", () => {
    const config = parseRuntimeConfig({
      ...LOCAL_DEFAULTS,
      E2E_BASE_URL: SANDBOX_DASHBOARD,
      E2E_API_URL: "https://api-server-pr-1217.up.railway.app",
    });
    expect(config.apiUrl).toBe("https://api-server-pr-1217.up.railway.app");
    expect(config.controlUrl).toBe("https://api-server-pr-1217.up.railway.app/internal/e2e");
  });

  it("infers the sandbox API from an explicit sandbox control URL", () => {
    const config = parseRuntimeConfig({
      ...VALID_ENV,
      E2E_BASE_URL: SANDBOX_DASHBOARD,
      E2E_CONTROL_URL: "https://api-server-pr-1217.up.railway.app/internal/e2e",
    });
    expect(config.apiUrl).toBe("https://api-server-pr-1217.up.railway.app");
  });

  it("accepts the sandbox Admin dashboard hostname", () => {
    const config = parseRuntimeConfig({
      ...LOCAL_DEFAULTS,
      E2E_BASE_URL: "https://hellyeah-admin-k2j4h7-final-round-ai.vercel.app",
      E2E_API_URL: "https://api-server-pr-1273.up.railway.app",
    });
    expect(config.controlUrl).toBe("https://api-server-pr-1273.up.railway.app/internal/e2e");
  });

  it("requires the sandbox API URL from the preview-sandbox comment", () => {
    expect(() =>
      parseRuntimeConfig({ ...LOCAL_DEFAULTS, E2E_BASE_URL: SANDBOX_DASHBOARD })
    ).toThrow(/preview-sandbox/);
  });

  it("rejects a staging control URL for a sandbox target", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_BASE_URL: SANDBOX_DASHBOARD,
        E2E_API_URL: "https://api-server-pr-1217.up.railway.app",
      })
    ).toThrow(/same environment/);
  });

  it("rejects a sandbox API URL for a staging target", () => {
    expect(() =>
      parseRuntimeConfig({
        ...LOCAL_DEFAULTS,
        E2E_API_URL: "https://api-server-pr-1217.up.railway.app",
      })
    ).toThrow(/same environment/);
  });

  it("rejects control and API URLs from two different sandboxes", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_BASE_URL: SANDBOX_DASHBOARD,
        E2E_API_URL: "https://api-server-pr-1217.up.railway.app",
        E2E_CONTROL_URL: "https://api-server-pr-1273.up.railway.app/internal/e2e",
      })
    ).toThrow(/same environment/);
  });

  it("still requires an explicit control URL for a local target", () => {
    expect(() =>
      parseRuntimeConfig({
        ...VALID_ENV,
        E2E_BASE_URL: "http://localhost:3001",
        E2E_CONTROL_URL: undefined,
      })
    ).toThrow(/E2E_CONTROL_URL/);
  });
});
