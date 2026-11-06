import { describe, expect, it } from "vitest";
import { chromium } from "@playwright/test";

import {
  classifySignUpTransition,
  isClerkVerificationPrepareResponse,
  openSignUpForm,
  prepareSignUpVerificationCode,
  submitSignUpCredentials,
  submitSignUpVerificationCode,
  verificationPreparationFallback,
} from "../../src/actions/auth-actions";

describe("classifySignUpTransition", () => {
  it("continues with verification when a code field is visible", () => {
    expect(
      classifySignUpTransition({
        challengeVisible: true,
        deferredPasswordEnabled: true,
        deferredPasswordValue: "",
        deferredPasswordVisible: true,
        verificationCodeVisible: true,
      })
    ).toBe("verification-code");
  });

  it("requests the challenge solver when Cloudflare is visible", () => {
    expect(
      classifySignUpTransition({
        challengeVisible: true,
        deferredPasswordEnabled: false,
        deferredPasswordValue: "existing-password",
        deferredPasswordVisible: true,
        verificationCodeVisible: false,
      })
    ).toBe("challenge");
  });

  it("uses only an empty enabled password field as a deferred step", () => {
    expect(
      classifySignUpTransition({
        challengeVisible: false,
        deferredPasswordEnabled: true,
        deferredPasswordValue: "",
        deferredPasswordVisible: true,
        verificationCodeVisible: false,
      })
    ).toBe("deferred-password");
  });

  it("ignores a stale password field that already contains the password", () => {
    expect(
      classifySignUpTransition({
        challengeVisible: false,
        deferredPasswordEnabled: true,
        deferredPasswordValue: "existing-password",
        deferredPasswordVisible: true,
        verificationCodeVisible: false,
      })
    ).toBeNull();
  });
});

describe("isClerkVerificationPrepareResponse", () => {
  it("accepts successful Clerk verification preparation responses", () => {
    expect(
      isClerkVerificationPrepareResponse({
        ok: () => true,
        request: () => ({ method: () => "POST" }),
        url: () =>
          "https://example.clerk.accounts.dev/v1/client/sign_ups/sua_123/prepare_verification",
      })
    ).toBe(true);
  });

  it("rejects attempts, failed responses, and non-POST requests", () => {
    const response = (url: string, method = "POST", ok = true) => ({
      ok: () => ok,
      request: () => ({ method: () => method }),
      url: () => url,
    });

    expect(
      isClerkVerificationPrepareResponse(
        response("https://example.test/attempt_verification")
      )
    ).toBe(false);
    expect(
      isClerkVerificationPrepareResponse(
        response("https://example.test/prepare_verification", "GET")
      )
    ).toBe(false);
    expect(
      isClerkVerificationPrepareResponse(
        response("https://example.test/prepare_verification", "POST", false)
      )
    ).toBe(false);
  });
});

describe("verificationPreparationFallback", () => {
  it("continues after the initial prepare request succeeds", () => {
    expect(verificationPreparationFallback(true)).toBe("continue");
  });

  it("requests a fresh code only when initial preparation was not observed", () => {
    expect(verificationPreparationFallback(false)).toBe("resend");
  });
});

it("keeps the initial verification response across registration atoms without resending", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: "http://test.local" });
    const page = await context.newPage();
    let prepareCount = 0;
    await page.route("http://test.local/sign-up", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<label>Email<input name="emailAddress" type="email"></label>
          <label>Password<input name="password" type="password"></label>
          <button id="continue">Continue</button>
          <section hidden id="verify">
            <input name="code" autocomplete="one-time-code">
            <button id="resend">Resend code</button>
            <button id="submit">Verify</button>
          </section>
          <script>
            document.querySelector('#continue').onclick = async () => {
              await fetch('/prepare_verification', { method: 'POST' });
              document.querySelector('#continue').hidden = true;
              document.querySelector('#verify').hidden = false;
            };
            document.querySelector('#resend').onclick = () => fetch('/prepare_verification', { method: 'POST' });
            document.querySelector('#submit').onclick = () => location.href = '/onboarding';
          </script>`,
      })
    );
    await page.route("http://test.local/prepare_verification", (route) => {
      prepareCount++;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.route("http://test.local/onboarding", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Onboarding</h1>" })
    );

    await openSignUpForm(page);
    expect(await submitSignUpCredentials(page, "qa@example.invalid", "synthetic-password")).toEqual({
      transition: "verification-code",
    });
    expect(await prepareSignUpVerificationCode(page)).toEqual({ preparation: "initial" });
    expect(await submitSignUpVerificationCode(page, "424242")).toEqual({
      pageUrl: "http://test.local/onboarding",
    });
    expect(prepareCount).toBe(1);
  } finally {
    await browser.close();
  }
}, 20_000);
