import type { TestInfo } from "@playwright/test";

const SECRET_KEY = /authorization|email|password|secret|token|(^|[_-])id$|Id$/i;

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : sanitize(nested),
    ])
  );
};

export const attachApiEvidence = (
  testInfo: TestInfo,
  name: string,
  value: unknown
): Promise<void> =>
  testInfo.attach(`api-${name}`, {
    body: Buffer.from(JSON.stringify(sanitize(value), null, 2)),
    contentType: "application/json",
  });
