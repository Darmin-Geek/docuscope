import { test, expect, type Page } from "@playwright/test";
import { injectOidcUser } from "./helpers";

async function signInAndReachProjectsList(
  page: Page,
  uid: string,
  email: string,
): Promise<void> {
  await injectOidcUser(page, uid, email);
  await expect(
    page.getByRole("heading", { name: "Your Projects" })
  ).toBeVisible();
}

test.describe("Projects", () => {
  test("created project appears in the projects list", async ({ page }) => {
    const uid = `uid-projects-${Date.now()}`;
    const email = `projects-${Date.now()}@test.com`;
    await signInAndReachProjectsList(page, uid, email);

    const projectName = `My Test Project ${Date.now()}`;

    await page.getByRole("button", { name: "Create Project" }).click();
    await page.getByLabel("Title").fill(projectName);
    await page.locator("button[type='submit']").click();

    await expect(page.getByText(projectName)).toBeVisible();
  });
});
