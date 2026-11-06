import { validateDispatchSource } from "../src/tools/dispatch-contract";

validateDispatchSource({
  actor: process.env.E2E_DISPATCH_ACTOR,
  appSlug: process.env.E2E_EXPECTED_APP_SLUG,
  baseUrl: process.env.E2E_BASE_URL,
  commitSha: process.env.E2E_COMMIT_SHA,
  contractVersion: process.env.E2E_CONTRACT_VERSION,
  correlationId: process.env.E2E_CORRELATION_ID,
  dispatchEventType: process.env.E2E_DISPATCH_EVENT_TYPE,
  environment: process.env.E2E_SOURCE_ENVIRONMENT,
  eventName: process.env.E2E_EVENT_NAME,
  sourceRepository: process.env.E2E_SOURCE_REPOSITORY,
});

console.log("Dispatch source accepted.");
