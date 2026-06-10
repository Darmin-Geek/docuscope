import { test, expect } from "@playwright/test";
import { injectOidcUser } from "./helpers";

// Authentication is handled by Cognito's hosted UI (OIDC redirect flow), so
// we can't test the sign-up/login form directly. Instead we inject a pre-built
// OIDC user into localStorage — the same technique tests use to set up auth
// state for any test that needs a signed-in user.

test.describe("Authentication", () => {
  test("authenticated user is shown the projects list", async ({ page }) => {
    const uid = `uid-auth-${Date.now()}`;
    const email = `auth-${Date.now()}@test.com`;

    await injectOidcUser(page, uid, email);

    await expect(
      page.getByRole("heading", { name: "Your Projects" })
    ).toBeVisible();
  });

  test("unauthenticated user is shown Sign Up and Log In buttons", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Sign Up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();
  });

  test("Log Out clears the session and returns to the sign-in screen", async ({
    page,
  }) => {
    const uid = `uid-logout-${Date.now()}`;
    const email = `logout-${Date.now()}@test.com`;
    await injectOidcUser(page, uid, email);

    await expect(
      page.getByRole("heading", { name: "Your Projects" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Log Out" }).click();

    await expect(page.getByRole("button", { name: "Sign Up" })).toBeVisible();
  });
});
