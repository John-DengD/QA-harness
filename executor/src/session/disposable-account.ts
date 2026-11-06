import type { Browser } from "@playwright/test";

import { E2eControlClient, type ScopeResult } from "../clients/e2e-control";
import { ClerkTestClient } from "../clients/clerk";
import type { RuntimeConfig } from "../config";
import { buildTestEmail } from "../tools/identity";
import {
  createClerkUserStorageState,
  type FixedAccountSession,
} from "./clerk-session";

export interface DisposableAccountLease {
  cleanup(): Promise<ScopeResult>;
  createStorageState(browser: Browser): Promise<FixedAccountSession>;
  email: string;
  scopeId: string;
  userId: string;
}

export const provisionDisposableAccount = async (
  runtime: RuntimeConfig,
  runId: string
): Promise<DisposableAccountLease> => {
  const email = buildTestEmail(runtime.emailBase, runId);
  const control = new E2eControlClient({
    baseUrl: runtime.controlUrl,
    token: runtime.controlToken,
  });
  const clerk = new ClerkTestClient({ secretKey: runtime.clerkSecretKey });
  const scope = await control.createScope({
    commitSha: process.env.E2E_COMMIT_SHA ?? "local000",
    email,
    release: process.env.E2E_RELEASE ?? "local",
    runId,
  });

  let userId = "";
  try {
    const user = await clerk.createUser({
      email,
      password: runtime.testPassword,
    });
    userId = user.id;
    await clerk.bindScopeMetadata(email, scope.scopeId);
    const bound = await control.bind(scope.scopeId, user.id);
    if (bound.status !== "bound") {
      throw new Error(`Disposable account bind requires review: ${bound.status}`);
    }
  } catch (error) {
    const cleanup = await control.cleanup(scope.scopeId).catch(() => null);
    if (cleanup?.status !== "cleaned") {
      throw new AggregateError(
        [error, new Error("Disposable account provisioning cleanup was not confirmed")],
        "Disposable account provisioning failed"
      );
    }
    throw error;
  }

  const sessionIds = new Set<string>();
  let cleaned: ScopeResult | null = null;
  return {
    email,
    scopeId: scope.scopeId,
    userId,
    async createStorageState(browser) {
      if (cleaned) throw new Error("Disposable account lease is already cleaned");
      const session = await createClerkUserStorageState(browser, runtime, userId);
      sessionIds.add(session.sessionId);
      return session;
    },
    async cleanup() {
      if (cleaned) return cleaned;
      for (const sessionId of sessionIds) {
        await clerk.revokeSession(sessionId).catch(() => undefined);
      }
      cleaned = await control.cleanup(scope.scopeId);
      if (cleaned.status !== "cleaned") {
        throw new Error(`Disposable account cleanup requires review: ${cleaned.status}`);
      }
      return cleaned;
    },
  };
};
