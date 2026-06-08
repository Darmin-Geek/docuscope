import { test, expect, type Page } from "@playwright/test";

async function signUpAndReachProjectsList(
  page: Page,
  email: string
): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("testpass123");
  await page.locator("button[type='submit']").click();
  await expect(
    page.getByRole("heading", { name: "Your Projects" })
  ).toBeVisible();
}

test.describe("Projects", () => {
  test("created project appears in the projects list", async ({ page }) => {
    const email = `projects-${Date.now()}@test.com`;
    await signUpAndReachProjectsList(page, email);

    const projectName = `My Test Project ${Date.now()}`;

    // Open the create-project modal
    await page.getByRole("button", { name: "Create Project" }).click();

    // Fill in the project title and submit
    await page.getByLabel("Title").fill(projectName);
    await page.locator("button[type='submit']").click();

    // The modal closes and the list refreshes; the new project should appear
    await expect(page.getByText(projectName)).toBeVisible();
  });
});
