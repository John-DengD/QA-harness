import { isIP } from "node:net";

const PUBLISHABLE_KEY_PREFIX = /^pk_(?:test|live)_/;

const clerkFrontendApiHost = (publishableKey: string): string => {
  const encoded = publishableKey.replace(PUBLISHABLE_KEY_PREFIX, "");
  if (encoded === publishableKey) {
    throw new Error("Clerk publishable key has an unsupported format");
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const host = decoded.endsWith("$") ? decoded.slice(0, -1) : decoded;
  const parsed = new URL(`https://${host}`);
  if (parsed.hostname !== host || parsed.port || parsed.pathname !== "/") {
    throw new Error("Clerk publishable key does not contain a valid FAPI host");
  }
  return host;
};

export const buildClerkHostResolverArgs = (
  publishableKey: string | undefined,
  fallbackIp?: string
): string[] => {
  const ip = fallbackIp?.trim();
  if (!ip) return [];
  if (!isIP(ip)) throw new Error("E2E_CLERK_FAPI_IP must be a valid IP address");
  if (!publishableKey) {
    throw new Error(
      "CLERK_PUBLISHABLE_KEY is required when E2E_CLERK_FAPI_IP is set"
    );
  }

  return [
    `--host-resolver-rules=MAP ${clerkFrontendApiHost(publishableKey)} ${ip}`,
  ];
};
