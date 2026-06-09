import { test, expect } from "@playwright/test";
import { createEmulatorUser } from "./helpers";

test.describe("Authentication", () => {
  test("sign up brings user to projects list", async ({ page }) => {
    const email = `signup-${Date.now()}@test.com`;

    await page.goto("/");

    // Open the sign-up modal
    await page.getByRole("button", { name: "Sign Up" }).click();

    // Fill in credentials and submit
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("testpass123");
    await page.locator("button[type='submit']").click();

    // A newly created account has no projects; the heading confirms we're on
    // the projects list page
    await expect(
      page.getByRole("heading", { name: "Your Projects" })
    ).toBeVisible();
  });

  test("log in with existing account brings user to projects list", async ({
    page,
  }) => {
    const email = `login-${Date.now()}@test.com`;
    const password = "testpass123";

    // Seed the account directly via the emulator so the login test doesn't
    // depend on the sign-up flow working correctly
    await createEmulatorUser(email, password);

    await page.goto("/");

    // Open the log-in modal
    await page.getByRole("button", { name: "Log In" }).click();

    // Fill in credentials and submit
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.locator("button[type='submit']").click();

    await expect(
      page.getByRole("heading", { name: "Your Projects" })
    ).toBeVisible();
  });
});
