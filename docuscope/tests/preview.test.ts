import { test, expect, type Page } from "@playwright/test";
import path from "path";

const TEST_FILES = path.join(__dirname, "..", "..", "testFiles");
const PDF_FILE = path.join(TEST_FILES, "PreviewDemo.pdf");
const DOCX_FILE = path.join(TEST_FILES, "PreviewDemo.docx");
const SVG_FILE = path.join(TEST_FILES, "move_folder_icon.svg");

async function signUpAndOpenProject(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("testpass123");
  await page.locator("button[type='submit']").click();
  await expect(
    page.getByRole("heading", { name: "Your Projects" })
  ).toBeVisible();

  const projectName = `Project ${Date.now()}`;
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Title").fill(projectName);
  await page.locator("button[type='submit']").click();
  await page.getByRole("button", { name: projectName }).click();
  await expect(
    page.getByRole("button", { name: "Create Folder" })
  ).toBeVisible();
}

async function uploadAndOpenSidebar(page: Page, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  await page.locator("input[type='file']").setInputFiles(filePath);
  await expect(page.getByRole("cell", { name: filename })).toBeVisible();
  await page.getByRole("cell", { name: filename }).click();
  const sidebar = page.locator("aside").last();
  await expect(sidebar.getByRole("heading", { name: filename })).toBeVisible();
}

test.describe("File preview", () => {
  test("PDF file shows an iframe in the preview section", async ({ page }) => {
    await signUpAndOpenProject(page, `preview-pdf-${Date.now()}@test.com`);
    await uploadAndOpenSidebar(page, PDF_FILE);

    const sidebar = page.locator("aside").last();
    // Wait for the preview URL to resolve — the iframe replaces "Loading preview…"
    await expect(
      sidebar.locator("iframe[title='PreviewDemo.pdf']")
    ).toBeVisible({ timeout: 20_000 });

    // The iframe must have a non-empty src (the Firebase Storage download URL)
    const src = await sidebar
      .locator("iframe[title='PreviewDemo.pdf']")
      .getAttribute("src");
    expect(src).toBeTruthy();
  });

  test("DOCX file shows rendered HTML content in the preview section", async ({ page }) => {
    await signUpAndOpenProject(page, `preview-docx-${Date.now()}@test.com`);
    await uploadAndOpenSidebar(page, DOCX_FILE);

    const sidebar = page.locator("aside").last();

    // mammoth fetches the file and converts it client-side; wait for the
    // "Loading preview…" placeholder to be replaced by the rendered content.
    await expect(
      sidebar.locator("text=Loading preview…")
    ).not.toBeVisible({ timeout: 20_000 });

    // The rendered DOCX content lands in a scrollable div inside the Preview
    // section. Verify it exists and contains some text.
    const previewDiv = sidebar.locator("div.max-h-96.overflow-y-auto");
    await expect(previewDiv).toBeVisible();
    const content = await previewDiv.textContent();
    expect(content?.trim().length).toBeGreaterThan(0);
  });

  test("SVG file shows an image in the preview section", async ({ page }) => {
    await signUpAndOpenProject(page, `preview-svg-${Date.now()}@test.com`);
    await uploadAndOpenSidebar(page, SVG_FILE);

    const sidebar = page.locator("aside").last();
    // The image preview renders as <img alt="move_folder_icon.svg"> once the
    // Storage download URL resolves.
    const previewImg = sidebar.getByRole("img", { name: "move_folder_icon.svg" });
    await expect(previewImg).toBeVisible({ timeout: 20_000 });

    const src = await previewImg.getAttribute("src");
    expect(src).toBeTruthy();
  });
});
