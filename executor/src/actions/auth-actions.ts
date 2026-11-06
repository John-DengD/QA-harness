import { expect, type Locator, type Page } from "@playwright/test";
import { goToAppPath } from "../tools/app-navigation";

type SignUpTransition = "challenge" | "deferred-password" | "verification-code";

interface SignUpTransitionSnapshot {
  challengeVisible: boolean;
  deferredPasswordEnabled: boolean;
  deferredPasswordValue: string;
  deferredPasswordVisible: boolean;
  verificationCodeVisible: boolean;
}

interface ResponseSnapshot {
  ok(): boolean;
  request(): { method(): string };
  url(): string;
}

export const isClerkVerificationPrepareResponse = (
  response: ResponseSnapshot
): boolean =>
  response.ok() &&
  response.request().method() === "POST" &&
  /prepare_(?:verification|first_factor|second_factor)/.test(response.url());

export const verificationPreparationFallback = (
  initialPrepared: boolean
): "continue" | "resend" => (initialPrepared ? "continue" : "resend");

export const classifySignUpTransition = ({
  challengeVisible,
  deferredPasswordEnabled,
  deferredPasswordValue,
  deferredPasswordVisible,
  verificationCodeVisible,
}: SignUpTransitionSnapshot): SignUpTransition | null => {
  if (verificationCodeVisible) return "verification-code";
  if (challengeVisible) return "challenge";
  if (
    deferredPasswordVisible &&
    deferredPasswordEnabled &&
    deferredPasswordValue.length === 0
  ) {
    return "deferred-password";
  }
  return null;
};

const firstVisible = async (locators: Locator[]): Promise<Locator> => {
  let match: Locator | null = null;
  await expect
    .poll(
      async () => {
        for (const locator of locators) {
          const candidate = locator.first();
          if (await candidate.isVisible().catch(() => false)) {
            match = candidate;
            return true;
          }
        }
        return false;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  if (!match) throw new Error("Expected authentication field is not visible");
  return match;
};

const continueButton = (page: Page): Locator =>
  page.getByRole("button", { name: /continue|sign up|sign in/i }).last();

const verificationCodeFields = (page: Page): Locator[] => [
  page.locator('input[name="code"]'),
  page.locator('input[autocomplete="one-time-code"]'),
  page.getByLabel(/verification code/i),
];

const signUpPreparation = new WeakMap<Page, Promise<boolean>>();

const ensureVerificationCodePrepared = async (
  page: Page,
  initialPreparation: Promise<boolean>
): Promise<"initial" | "resend"> => {
  const resend = await firstVisible([
    page.getByRole("button", { name: /resend/i }),
    page.getByRole("link", { name: /resend/i }),
  ]);

  const initialPrepared = await Promise.race([
    initialPreparation,
    expect
      .poll(() => resend.isEnabled().catch(() => false), {
        timeout: 35_000,
      })
      .toBe(true)
      .then(() => false),
  ]);
  if (verificationPreparationFallback(initialPrepared) === "continue") return "initial";

  await expect(resend).toBeEnabled({ timeout: 40_000 });
  await Promise.all([
    page.waitForResponse(isClerkVerificationPrepareResponse, {
      timeout: 30_000,
    }),
    resend.click(),
  ]);
  return "resend";
};

const waitForSignUpTransition = async (
  page: Page
): Promise<SignUpTransition> => {
  let transition: SignUpTransition | null = null;
  await expect
    .poll(
      async () => {
        const verificationCodeVisible = (
          await Promise.all(
            verificationCodeFields(page).map(async (locator) =>
              locator.first().isVisible().catch(() => false)
            )
          )
        ).some(Boolean);
        const deferredPassword = page.locator('input[name="password"]').first();
        const deferredPasswordVisible = await deferredPassword
          .isVisible()
          .catch(() => false);
        const deferredPasswordEnabled = deferredPasswordVisible
          ? await deferredPassword.isEnabled().catch(() => false)
          : false;
        const deferredPasswordValue = deferredPasswordVisible
          ? await deferredPassword.inputValue().catch(() => "")
          : "";

        transition = classifySignUpTransition({
          challengeVisible: page
            .frames()
            .some((frame) =>
              frame.url().startsWith("https://challenges.cloudflare.com/")
            ),
          deferredPasswordEnabled,
          deferredPasswordValue,
          deferredPasswordVisible,
          verificationCodeVisible,
        });
        return transition;
      },
      {
        message: "Expected the next Clerk sign-up step to become available",
        timeout: 30_000,
      }
    )
    .not.toBeNull();

  if (!transition) {
    throw new Error("Expected the next Clerk sign-up step to become available");
  }
  return transition;
};

export interface AuthNavigationFact {
  pageUrl: string;
}

export async function openSignUpForm(page: Page): Promise<AuthNavigationFact> {
  await goToAppPath(page, "/sign-up");
  await expect(page).toHaveURL(/\/sign-up/);
  return { pageUrl: page.url() };
}

export async function submitSignUpCredentials(
  page: Page,
  email: string,
  password: string
): Promise<{ transition: SignUpTransition }> {
  const emailField = await firstVisible([
    page.locator('input[name="emailAddress"]'),
    page.locator('input[name="identifier"]'),
    page.locator('input[type="email"]'),
    page.getByLabel(/email address/i),
  ]);
  await emailField.fill(email);

  const passwordField = page.locator('input[name="password"]');
  if (await passwordField.isVisible().catch(() => false)) {
    await passwordField.fill(password);
  }
  signUpPreparation.set(page, page
    .waitForResponse(isClerkVerificationPrepareResponse, {
      timeout: 45_000,
    })
    .then(
      () => true,
      () => false
    ));
  await continueButton(page).click();
  return { transition: await waitForSignUpTransition(page) };
}

export async function submitDeferredSignUpPassword(
  page: Page,
  password: string
): Promise<{ transition: SignUpTransition }> {
  const deferredPassword = page.locator('input[name="password"]').first();
  await expect(deferredPassword).toBeEnabled();
  await deferredPassword.fill(password);
  await continueButton(page).click();
  return { transition: await waitForSignUpTransition(page) };
}

export async function prepareSignUpVerificationCode(
  page: Page
): Promise<{ preparation: "initial" | "resend" }> {
  await firstVisible(verificationCodeFields(page));
  const preparation = await ensureVerificationCodePrepared(
    page,
    signUpPreparation.get(page) ?? Promise.resolve(false)
  );
  signUpPreparation.delete(page);
  return { preparation };
}

export async function submitSignUpVerificationCode(
  page: Page,
  code: string
): Promise<AuthNavigationFact> {
  await (await firstVisible(verificationCodeFields(page))).fill(code);
  const verify = page.getByRole("button", { name: /verify|continue/i });
  if (await verify.isVisible().catch(() => false)) {
    await verify.click();
  }
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 45_000 });
  return { pageUrl: page.url() };
}

export async function signOutAccount(page: Page): Promise<AuthNavigationFact> {
  const account = page.locator('[data-sidebar="footer"]').getByRole("button").last();
  await expect(account).toBeVisible({ timeout: 45_000 });
  await account.click();
  await page.getByRole("menuitem", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });
  return { pageUrl: page.url() };
}

export async function openSignInForm(page: Page): Promise<AuthNavigationFact> {
  await goToAppPath(page, "/sign-in");
  return { pageUrl: page.url() };
}

export async function submitSignInIdentifier(
  page: Page,
  email: string
): Promise<{ passwordVisible: boolean }> {
  const emailField = await firstVisible([
    page.locator('input[name="identifier"]'),
    page.locator('input[type="email"]'),
    page.getByLabel(/email address/i),
  ]);
  await emailField.fill(email);
  await continueButton(page).click();
  await firstVisible([
    page.locator('input[name="password"]'),
    page.getByLabel(/^password$/i),
  ]);
  return { passwordVisible: true };
}

export async function submitSignInPassword(
  page: Page,
  password: string
): Promise<{ next: "signed-in" | "factor-two"; pageUrl: string }> {
  const passwordField = await firstVisible([
    page.locator('input[name="password"]'),
    page.getByLabel(/^password$/i),
  ]);
  await passwordField.fill(password);
  await continueButton(page).click();

  const next = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
        timeout: 45_000,
      })
      .then(() => "signed-in" as const),
    page
      .waitForURL(/\/sign-in\/factor-two/, { timeout: 45_000 })
      .then(() => "factor-two" as const),
  ]);
  return { next, pageUrl: page.url() };
}

export async function submitSignInSecondFactor(
  page: Page,
  code: string
): Promise<AuthNavigationFact> {
  const secondFactor = await firstVisible(verificationCodeFields(page));
  await ensureVerificationCodePrepared(page, Promise.resolve(false));
  await secondFactor.fill(code);
  const verify = page.getByRole("button", { name: /continue|verify/i });
  if (await verify.isVisible().catch(() => false)) await verify.click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 45_000 });
  return { pageUrl: page.url() };
}

export async function inspectOrganizationSetupPrompt(
  page: Page
): Promise<{ visible: boolean }> {
  const organizationTask = page.getByRole("heading", {
    name: /setup your organization|choose an organization/i,
  });
  return {
    visible: await organizationTask
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
  };
}

export async function continueOrganizationSetup(
  page: Page
): Promise<AuthNavigationFact> {
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 45_000 });
  return { pageUrl: page.url() };
}

export async function inspectSignInNavigation(page: Page): Promise<AuthNavigationFact> {
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 45_000 });
  return { pageUrl: page.url() };
}
