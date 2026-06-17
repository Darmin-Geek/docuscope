import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { injectOidcUser } from "./helpers";

const PUBLIC = path.join(__dirname, "..", "public");
const SAMPLE_PDF = path.join(__dirname, "fixtures", "sample.pdf");
const SAMPLE_SVG = path.join(PUBLIC, "file.svg");

/** Signs in a fresh user, creates one project, and opens it. */
async function signUpAndOpenProject(page: Page, email: string): Promise<void> {
  const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await injectOidcUser(page, uid, email);
  await expect(
    page.getByRole("heading", { name: "Your Projects" }),
  ).toBeVisible();

  const projectName = `Project ${Date.now()}`;
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Title").fill(projectName);
  await page.locator("button[type='submit']").click();

  await page.getByRole("button", { name: projectName }).click();
  await expect(
    page.getByRole("button", { name: "Create Folder" }),
  ).toBeVisible();
}

/** Uploads a file via the hidden file input and waits for it in the table. */
async function uploadFile(page: Page, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  await page.locator("input[type='file']").setInputFiles(filePath);
  await expect(page.getByText("Uploading…")).toBeHidden();
  await expect(page.getByRole("cell", { name: filename })).toBeVisible();
}

test.describe("Embedded PDF viewer", () => {
  test("the Open PDF viewer button shows only for PDF files", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `pdf-button-${Date.now()}@test.com`);

    // A non-PDF file offers no PDF viewer button.
    await uploadFile(page, SAMPLE_SVG);
    await page.getByRole("cell", { name: "file.svg" }).click();
    let sidebar = page.locator("aside").last();
    await expect(sidebar.getByRole("heading", { name: "file.svg" })).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Open PDF viewer" }),
    ).toHaveCount(0);
    await sidebar.getByRole("button", { name: "Close" }).click();

    // A PDF file does.
    await uploadFile(page, SAMPLE_PDF);
    await page.getByRole("cell", { name: "sample.pdf" }).click();
    sidebar = page.locator("aside").last();
    await expect(
      sidebar.getByRole("heading", { name: "sample.pdf" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Open PDF viewer" }),
    ).toBeVisible();
  });

  test("opening the viewer shows the information panel and selection controls", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `pdf-open-${Date.now()}@test.com`);
    await uploadFile(page, SAMPLE_PDF);

    await page.getByRole("cell", { name: "sample.pdf" }).click();
    const sidebar = page.locator("aside").last();
    await sidebar.getByRole("button", { name: "Open PDF viewer" }).click();

    // The viewer modal opens with the information panel and marking controls.
    const dialog = page.getByRole("dialog", { name: /PDF viewer for sample\.pdf/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Information" })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Mark selection" }),
    ).toBeVisible();

    // The page eventually renders (the engine loads the bytes); the loading
    // placeholder disappears.
    await expect(dialog.getByText("Loading PDF…")).toBeHidden({ timeout: 20_000 });

    // Close with Escape.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a selection can be marked against a piece of information and navigated", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `pdf-mark-${Date.now()}@test.com`);
    await uploadFile(page, SAMPLE_PDF);

    // Create a piece of information first via the information sidebar.
    await page.getByRole("cell", { name: "sample.pdf" }).click();
    const fileSidebar = page.locator("aside").last();
    await fileSidebar.getByRole("button", { name: "Open information view" }).click();
    const infoSidebar = page.locator("aside").filter({
      has: page.getByRole("heading", { name: "Information" }),
    });
    await infoSidebar.getByRole("button", { name: "+ Add New Information" }).click();
    await infoSidebar.locator("input[placeholder='Untitled']").fill("Claim A");
    await infoSidebar.locator("input[placeholder='Untitled']").press("Enter");
    await expect(
      infoSidebar.getByRole("button", { name: "Claim A", exact: true }),
    ).toBeVisible();

    // Open the viewer for that information item.
    await infoSidebar.getByRole("button", { name: "Open in PDF viewer" }).click();
    const dialog = page.getByRole("dialog", { name: /PDF viewer for sample\.pdf/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Loading PDF…")).toBeHidden({ timeout: 20_000 });

    // The active item is preselected; before any selection the counter is 0 / 0.
    await expect(dialog.getByText("0 / 0")).toBeVisible();

    // Select all text on the page, then mark it against the active information.
    const pageImage = dialog.locator("img").first();
    await expect(pageImage).toBeVisible({ timeout: 20_000 });
    const box = await pageImage.boundingBox();
    if (!box) throw new Error("Could not locate the rendered PDF page.");
    // Drag across the page to select its text.
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.55, {
      steps: 10,
    });
    await page.mouse.up();

    const markButton = dialog.getByRole("button", { name: "Mark selection" });
    await expect(markButton).toBeEnabled({ timeout: 10_000 });
    await markButton.click();

    // The marked selection becomes the first of one.
    await expect(dialog.getByText("1 / 1")).toBeVisible({ timeout: 10_000 });
    await expect(
      dialog.getByRole("button", { name: "Delete current selection" }),
    ).toBeVisible();
  });
});
