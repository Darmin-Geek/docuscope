import { test, expect, type Page } from "@playwright/test";
import path from "path";

// SVG files used as uploads in these tests (vercel.svg excluded).
const PUBLIC = path.join(__dirname, "..", "public");
const SVG = {
  file: path.join(PUBLIC, "file.svg"),
  globe: path.join(PUBLIC, "globe.svg"),
  window: path.join(PUBLIC, "window.svg"),
  next: path.join(PUBLIC, "next.svg"),
};

// ── shared helpers ────────────────────────────────────────────────────────────

/** Signs up a fresh account, creates one project, and opens it. */
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

  // Open the newly created project.
  await page.getByRole("button", { name: projectName }).click();
  await expect(
    page.getByRole("button", { name: "Create Folder" })
  ).toBeVisible();
}

/** Opens the Create Folder modal, names the folder, submits, and waits for it. */
async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Create Folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  // The modal's submit button is the only button[type=submit] while it is open.
  await page.locator("button[type='submit']").click();
  await expect(page.getByRole("button", { name: name })).toBeVisible();
}

/** Uploads a file via the hidden file input and waits for it in the table. */
async function uploadFile(page: Page, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  await page.locator("input[type='file']").setInputFiles(filePath);
  await expect(page.getByRole("cell", { name: filename })).toBeVisible();
}

/**
 * Opens Project Settings, adds a label with the given name, and waits for it
 * to appear as a filter pill in the folder sidebar.
 */
async function createLabel(page: Page, labelName: string): Promise<void> {
  await page.getByRole("button", { name: "Project settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Project Settings" })
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Add label" }).click();
  // The new label row is appended last and is seeded with the value "New label";
  // wait for that input rather than getByText("Done") (a default label whose text
  // renders both here and as a FolderView filter pill, tripping strict mode).
  const newLabelInput = page.locator("input[type='text']").last();
  await expect(newLabelInput).toHaveValue("New label");
  await newLabelInput.fill(labelName);
  await newLabelInput.press("Enter");
  await page.getByRole("button", { name: "Close" }).click();
  // Wait for the filter pill to appear in the FolderView labels section.
  await expect(page.getByTitle(`Filter by ${labelName}`)).toBeVisible();
}

/**
 * Applies a label from the label picker that is open in the FileSidebar.
 * Scoped to the last <aside> so it does not accidentally click the FolderView
 * filter pills, which have the same visible text.
 */
async function addLabelInSidebar(page: Page, labelName: string): Promise<void> {
  const sidebar = page.locator("aside").last();
  await sidebar.getByRole("button", { name: "+ Label" }).click();
  await sidebar.getByRole("button", { name: labelName }).click();
}

// ── Folders ───────────────────────────────────────────────────────────────────

test.describe("Folders", () => {
  test("created folder appears in the folder list", async ({ page }) => {
    await signUpAndOpenProject(page, `folder-create-${Date.now()}@test.com`);

    const folderName = `Documents ${Date.now()}`;
    await page.getByRole("button", { name: "Create Folder" }).click();
    await expect(
      page.getByRole("heading", { name: "New Folder" })
    ).toBeVisible();
    await page.getByLabel("Folder name").fill(folderName);
    await page.locator("button[type='submit']").click();

    await expect(page.getByRole("button", { name: folderName })).toBeVisible();
  });

  test("file uploaded while a folder is selected goes into that folder", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `folder-upload-${Date.now()}@test.com`);

    const folderName = `Assets ${Date.now()}`;
    await createFolder(page, folderName);

    // Select the folder before uploading so the file lands inside it.
    await page.getByRole("button", { name: folderName }).click();
    await uploadFile(page, SVG.file);

    // Pressing Escape deselects the folder; the all-files view still shows it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();

    // Re-selecting the folder confirms the file is stored there.
    await page.getByRole("button", { name: folderName }).click();
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
  });
});

// ── File metadata ─────────────────────────────────────────────────────────────

test.describe("File metadata", () => {
  test("author, date created, and labels can be edited on a file", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `metadata-${Date.now()}@test.com`);

    // A label must exist on the project before it can be applied to a file.
    await createLabel(page, "Important");
    await uploadFile(page, SVG.globe);

    // Open the file sidebar.
    await page.getByRole("cell", { name: "globe.svg" }).click();
    const sidebar = page.locator("aside").last();
    await expect(
      sidebar.getByRole("heading", { name: "globe.svg" })
    ).toBeVisible();

    // Edit Author — the input uses the placeholder "Unknown".
    await sidebar.locator("input[placeholder='Unknown']").fill("Jane Smith");

    // Edit Date Created. Clicking "+ Label" afterwards moves focus out of the
    // field group, triggering the group-blur save for both author and date.
    await sidebar.locator("input[type='date']").fill("2024-06-01");
    await expect(sidebar.locator("input[type='date']")).toHaveValue("2024-06-01");

    // Add the "Important" label; this also triggers the field-group blur save.
    await addLabelInSidebar(page, "Important");

    // Close the sidebar.
    await sidebar.getByRole("button", { name: "Close" }).click();

    // Author should now be visible in the table's Author column.
    await expect(page.getByRole("cell", { name: "Jane Smith" })).toBeVisible();

    // The label pill should appear on the globe.svg row.
    const row = page.getByRole("row").filter({ hasText: "globe.svg" });
    await expect(row.getByText("Important")).toBeVisible();
  });
});

// ── Filtering ─────────────────────────────────────────────────────────────────

test.describe("Filtering", () => {
  test("selecting a folder shows only that folder's files", async ({ page }) => {
    await signUpAndOpenProject(page, `filter-folder-${Date.now()}@test.com`);

    const folderA = `Reports ${Date.now()}`;
    const folderB = `Media ${Date.now()}`;
    await createFolder(page, folderA);
    await createFolder(page, folderB);

    // Upload window.svg into folder A.
    await page.getByRole("button", { name: folderA }).click();
    await uploadFile(page, SVG.window);

    // Upload next.svg into folder B.
    await page.getByRole("button", { name: folderB }).click();
    await uploadFile(page, SVG.next);

    // Folder A: only window.svg should be visible.
    await page.getByRole("button", { name: folderA }).click();
    await expect(page.getByRole("cell", { name: "window.svg" })).toBeVisible();
    await expect(
      page.locator("td").filter({ hasText: "next.svg" })
    ).toHaveCount(0);

    // Folder B: only next.svg should be visible.
    await page.getByRole("button", { name: folderB }).click();
    await expect(page.getByRole("cell", { name: "next.svg" })).toBeVisible();
    await expect(
      page.locator("td").filter({ hasText: "window.svg" })
    ).toHaveCount(0);
  });

  test("clicking one label filter shows only files tagged with that label", async ({
    page,
  }) => {
    await signUpAndOpenProject(
      page,
      `filter-label-single-${Date.now()}@test.com`
    );

    await createLabel(page, "Alpha");
    await createLabel(page, "Beta");

    // Upload three files: file.svg → Alpha, globe.svg → Beta, window.svg → none.
    await uploadFile(page, SVG.file);
    await uploadFile(page, SVG.globe);
    await uploadFile(page, SVG.window);

    await page.getByRole("cell", { name: "file.svg" }).click();
    await addLabelInSidebar(page, "Alpha");
    await page.locator("aside").last().getByRole("button", { name: "Close" }).click();

    await page.getByRole("cell", { name: "globe.svg" }).click();
    await addLabelInSidebar(page, "Beta");
    await page.locator("aside").last().getByRole("button", { name: "Close" }).click();

    // Activate the Alpha filter.
    await page.getByTitle("Filter by Alpha").click();

    // Only file.svg (tagged Alpha) should appear.
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
    await expect(
      page.locator("td").filter({ hasText: "globe.svg" })
    ).toHaveCount(0);
    await expect(
      page.locator("td").filter({ hasText: "window.svg" })
    ).toHaveCount(0);
  });

  test("shift-clicking a second label filter shows only files with both labels", async ({
    page,
  }) => {
    await signUpAndOpenProject(
      page,
      `filter-label-multi-${Date.now()}@test.com`
    );

    await createLabel(page, "Alpha");
    await createLabel(page, "Beta");

    // Upload two files: file.svg → Alpha only, globe.svg → Alpha + Beta.
    await uploadFile(page, SVG.file);
    await uploadFile(page, SVG.globe);

    await page.getByRole("cell", { name: "file.svg" }).click();
    await addLabelInSidebar(page, "Alpha");
    await page.locator("aside").last().getByRole("button", { name: "Close" }).click();

    await page.getByRole("cell", { name: "globe.svg" }).click();
    await addLabelInSidebar(page, "Alpha");
    await addLabelInSidebar(page, "Beta");
    await page.locator("aside").last().getByRole("button", { name: "Close" }).click();

    // Clicking Alpha alone: both files are visible (both carry the Alpha label).
    await page.getByTitle("Filter by Alpha").click();
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "globe.svg" })).toBeVisible();

    // Shift-clicking Beta adds it to the filter; only globe.svg has both labels.
    await page.getByTitle("Filter by Beta").click({ modifiers: ["Shift"] });
    await expect(page.getByRole("cell", { name: "globe.svg" })).toBeVisible();
    await expect(
      page.locator("td").filter({ hasText: "file.svg" })
    ).toHaveCount(0);
  });
});
