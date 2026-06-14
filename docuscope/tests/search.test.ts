import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { getFiles } from "../lib/projects.server";
import { injectOidcUser } from "./helpers";
import { createTestProject, createTestFile, createTestFolder } from "./db-helpers";

// ── Server-side unit tests ────────────────────────────────────────────────────
// These call getFiles() directly against the test database without a browser.

test.describe("getFiles — full-text search", () => {
  test("matches on author field", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, {
      filename: "doc.pdf",
      author: "Josephine Müller",
    });
    await createTestFile(projectId, { filename: "other.pdf", author: "Bob Smith" });

    const results = await getFiles(projectId, null, "josephine");

    expect(results.map((f) => f.id)).toContain(fileId);
    expect(results).toHaveLength(1);
  });

  test("matches on source field", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, {
      filename: "report.pdf",
      source: "Reuters news agency",
    });
    await createTestFile(projectId, { filename: "other.pdf", source: "BBC" });

    const results = await getFiles(projectId, null, "reuters");

    expect(results.map((f) => f.id)).toContain(fileId);
    expect(results).toHaveLength(1);
  });

  test("returns no files when query matches nothing", async () => {
    const projectId = await createTestProject();
    await createTestFile(projectId, { filename: "some-document.pdf", source: "Reuters" });

    const results = await getFiles(projectId, null, "xyzzy");

    expect(results).toHaveLength(0);
  });

  test("search ignores the folderId filter and spans all project folders", async () => {
    const projectId = await createTestProject();

    const fileInA = await createTestFile(projectId, {
      filename: "a.pdf",
      author: "needle author",
    });
    const folderA = await createTestFolder(projectId, "Folder A", [fileInA]);

    const fileInB = await createTestFile(projectId, {
      filename: "b.pdf",
      author: "haystack author",
    });
    const folderB = await createTestFolder(projectId, "Folder B", [fileInB]);

    // Searching from folderB's perspective must still find the file in folderA.
    const results = await getFiles(projectId, folderB, "needle");

    expect(results.map((f) => f.id)).toContain(fileInA);
    expect(results.map((f) => f.id)).not.toContain(fileInB);
    expect(results.find((f) => f.id === fileInA)?.folderId).toBe(folderA);
  });

  test("search with no folder finds files across all folders", async () => {
    const projectId = await createTestProject();

    const rootFile = await createTestFile(projectId, {
      filename: "root.pdf",
      source: "needle source",
    });
    const folderFile = await createTestFile(projectId, {
      filename: "folder.pdf",
      source: "needle source",
    });
    const folderId = await createTestFolder(projectId, "Archive", [folderFile]);

    const results = await getFiles(projectId, null, "needle");

    const ids = results.map((f) => f.id);
    expect(ids).toContain(rootFile);
    expect(ids).toContain(folderFile);
    expect(results.find((f) => f.id === rootFile)?.folderId).toBeNull();
    expect(results.find((f) => f.id === folderFile)?.folderId).toBe(folderId);
  });

  test("empty query with a folder selected returns only that folder's files", async () => {
    const projectId = await createTestProject();

    const fileA = await createTestFile(projectId, { filename: "alpha.pdf" });
    const folderId = await createTestFolder(projectId, "Folder A", [fileA]);

    await createTestFile(projectId, { filename: "beta.pdf" });

    const results = await getFiles(projectId, folderId, "");

    expect(results.map((f) => f.id)).toContain(fileA);
    expect(results).toHaveLength(1);
  });
});

// ── UI / Playwright tests ─────────────────────────────────────────────────────

const PUBLIC = path.join(__dirname, "..", "public");
const SVG = {
  file: path.join(PUBLIC, "file.svg"),
  globe: path.join(PUBLIC, "globe.svg"),
  window: path.join(PUBLIC, "window.svg"),
  next: path.join(PUBLIC, "next.svg"),
};

async function signUpAndOpenProject(page: Page, email: string): Promise<void> {
  const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await injectOidcUser(page, uid, email);
  await expect(page.getByRole("heading", { name: "Your Projects" })).toBeVisible();

  const projectName = `Search Project ${Date.now()}`;
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Title").fill(projectName);
  await page.locator("button[type='submit']").click();
  await page.getByRole("button", { name: projectName }).click();
  await expect(page.getByRole("button", { name: "Create Folder" })).toBeVisible();
}

async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Create Folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.locator("button[type='submit']").click();
  await expect(page.getByRole("button", { name: name })).toBeVisible();
}

async function uploadFile(page: Page, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  await page.locator("input[type='file']").setInputFiles(filePath);
  await expect(page.getByText("Uploading…")).toBeHidden({timeout:30000});
  await expect(page.getByRole("cell", { name: filename })).toBeVisible();
}

/** Click a file row to open its sidebar, set the Author field, and save. */
async function setFileAuthor(page: Page, filename: string, author: string): Promise<void> {
  await page.getByRole("cell", { name: filename }).click();
  await page.getByLabel("Author").fill(author);
  await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes("/files/") && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Enter"),
  ]);
}

test.describe("Full-text search UI", () => {
  test("typing in the search box shows files matching metadata and hides others", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `search-basic-${Date.now()}@test.com`);

    await uploadFile(page, SVG.file);    // file.svg
    await uploadFile(page, SVG.globe);   // globe.svg

    // Tag only file.svg with a distinctive author so the search matches it.
    await setFileAuthor(page, "file.svg", "uniquefileauthor");

    await page.getByLabel("Search files").fill("uniquefileauthor");

    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
    await expect(page.locator("td").filter({ hasText: "globe.svg" })).toHaveCount(0);
  });

  test("shows the no-results message when nothing matches", async ({ page }) => {
    await signUpAndOpenProject(page, `search-empty-${Date.now()}@test.com`);

    await uploadFile(page, SVG.globe);

    await page.getByLabel("Search files").fill("xyzzy");

    await expect(page.getByText("No files match your search.")).toBeVisible();
    await expect(page.locator("td").filter({ hasText: "globe.svg" })).toHaveCount(0);
  });

  test("clearing the search restores the folder's files", async ({ page }) => {
    await signUpAndOpenProject(page, `search-clear-${Date.now()}@test.com`);

    await uploadFile(page, SVG.file);
    await uploadFile(page, SVG.globe);

    // Tag only file.svg so the search term discriminates between the two files.
    await setFileAuthor(page, "file.svg", "uniqueclearauthor");

    const searchBox = page.getByLabel("Search files");
    await searchBox.fill("uniqueclearauthor");
    await expect(page.locator("td").filter({ hasText: "globe.svg" })).toHaveCount(0);

    // Clear the search — both files should reappear.
    await searchBox.fill("");
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "globe.svg" })).toBeVisible();
  });

  test("search crosses folder boundaries: finds a file in another folder", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `search-cross-folder-${Date.now()}@test.com`);

    // Upload window.svg into "Reports" folder and tag it with a distinctive author.
    const folderA = `Reports ${Date.now()}`;
    await createFolder(page, folderA);
    await page.getByRole("button", { name: folderA }).click();
    await uploadFile(page, SVG.window);
    await setFileAuthor(page, "window.svg", "uniquecrossauthor");

    // Press Escape to deselect, then create "Media" folder and upload globe.svg into it.
    await page.keyboard.press("Escape");
    const folderB = `Media ${Date.now()}`;
    await createFolder(page, folderB);
    await page.getByRole("button", { name: folderB }).click();
    await uploadFile(page, SVG.globe);

    // "Media" folder is now selected. Search must find window.svg (in "Reports").
    await page.getByLabel("Search files").fill("uniquecrossauthor");

    await expect(page.getByRole("cell", { name: "window.svg" })).toBeVisible();
    await expect(page.locator("td").filter({ hasText: "globe.svg" })).toHaveCount(0);
  });

  test("selecting a folder clears the active search", async ({ page }) => {
    await signUpAndOpenProject(page, `search-clear-on-nav-${Date.now()}@test.com`);

    const folderName = `Docs ${Date.now()}`;
    await createFolder(page, folderName);

    await uploadFile(page, SVG.file);

    const searchBox = page.getByLabel("Search files");
    await searchBox.fill("xyzzy");
    await expect(searchBox).toHaveValue("xyzzy");

    // Clicking a folder should reset the search input.
    await page.getByRole("button", { name: folderName }).click();
    await expect(searchBox).toHaveValue("");
  });
});
