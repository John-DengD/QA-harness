import { parseRuntimeConfig } from "../src/config";
import { loadQaEnv } from "../src/tools/qa-env";

loadQaEnv();
const runtime = parseRuntimeConfig(process.env);

const check = async (
  name: string,
  url: string,
  headers?: HeadersInit
): Promise<Response> => {
  const response = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 500 || response.status === 404) {
    throw new Error(`[stage:healthcheck] ${name} returned ${response.status}`);
  }
  console.log(`${name}: reachable (${response.status})`);
  return response;
};

await check("dashboard", runtime.baseUrl);
await check("Clerk Backend API", "https://api.clerk.com/v1/users?limit=1", {
  authorization: `Bearer ${runtime.clerkSecretKey}`,
});
