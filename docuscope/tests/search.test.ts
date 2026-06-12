import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { getFiles } from "../lib/projects.server";
import { injectOidcUser } from "./helpers";
import { createTestProject, createTestFile, createTestFolder } from "./db-helpers";

// ── Server-side unit tests ────────────────────────────────────────────────────
// These call getFiles() directly against the test database without a browser.

test.describe("getFiles — full-text search", () => {
  test("returns a root file whose filename matches the query", async () => {
    const projectId = await createTestProject();
    const matchId = await createTestFile(projectId, { filename: "climate-report.pdf" });
    await createTestFile(projectId, { filename: "budget-2024.pdf" });

    const results = await getFiles(projectId, null, "climate");

    const ids = results.map((f) => f.id);
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(
      (await getFiles(projectId, null, "")).find((f) => f.filename === "budget-2024.pdf")?.id,
    );
  });

  test("returns a file in a folder whose filename matches the query", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "annual-review.pdf" });
    const folderId = await createTestFolder(projectId, "Reports", [fileId]);

    // Search with no folder filter.
    const results = await getFiles(projectId, null, "annual");

    expect(results.map((f) => f.id)).toContain(fileId);
    expect(results.find((f) => f.id === fileId)?.folderId).toBe(folderId);
  });

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
    await createTestFile(projectId, { filename: "some-document.pdf" });

    const results = await getFiles(projectId, null, "xyzzy");

    expect(results).toHaveLength(0);
  });

  test("search ignores the folderId filter and spans all project folders", async () => {
    const projectId = await createTestProject();

    const fileInA = await createTestFile(projectId, { filename: "needle.pdf" });
    const folderA = await createTestFolder(projectId, "Folder A", [fileInA]);

    const fileInB = await createTestFile(projectId, { filename: "haystack.pdf" });
    const folderB = await createTestFolder(projectId, "Folder B", [fileInB]);

    // Searching from folderB's perspective must still find needle.pdf (in folderA).
    const results = await getFiles(projectId, folderB, "needle");

    expect(results.map((f) => f.id)).toContain(fileInA);
    expect(results.map((f) => f.id)).not.toContain(fileInB);
    expect(results.find((f) => f.id === fileInA)?.folderId).toBe(folderA);
  });

  test("search with no folder finds files across all folders", async () => {
    const projectId = await createTestProject();

    const rootFile = await createTestFile(projectId, { filename: "rootneedle.pdf" });
    const folderFile = await createTestFile(projectId, { filename: "folderneedle.pdf" });
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

    await createTestFile(projectId, { filename: "beta.pdf" }); // root file, different project scope

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
  await expect(page.getByText("Uploading…")).toBeHidden();
  await expect(page.getByRole("cell", { name: filename })).toBeVisible();
}

test.describe("Full-text search UI", () => {
  test("typing in the search box shows matching files and hides non-matching ones", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `search-basic-${Date.now()}@test.com`);

    await uploadFile(page, SVG.file);    // file.svg
    await uploadFile(page, SVG.globe);   // globe.svg

    await page.getByLabel("Search files").fill("file");

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

    const searchBox = page.getByLabel("Search files");
    await searchBox.fill("file");
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

    // Upload window.svg into "Reports" folder.
    const folderA = `Reports ${Date.now()}`;
    await createFolder(page, folderA);
    await page.getByRole("button", { name: folderA }).click();
    await uploadFile(page, SVG.window);

    // Press Escape to deselect, then create "Media" folder and upload globe.svg into it.
    await page.keyboard.press("Escape");
    const folderB = `Media ${Date.now()}`;
    await createFolder(page, folderB);
    await page.getByRole("button", { name: folderB }).click();
    await uploadFile(page, SVG.globe);

    // "Media" folder is now selected. Search for "window" — must find the file
    // from "Reports" even though that folder is not selected.
    await page.getByLabel("Search files").fill("window");

    await expect(page.getByRole("cell", { name: "window.svg" })).toBeVisible();
    await expect(page.locator("td").filter({ hasText: "globe.svg" })).toHaveCount(0);
  });

  test("selecting a folder clears the active search", async ({ page }) => {
    await signUpAndOpenProject(page, `search-clear-on-nav-${Date.now()}@test.com`);

    const folderName = `Docs ${Date.now()}`;
    await createFolder(page, folderName);

    await uploadFile(page, SVG.file);

    const searchBox = page.getByLabel("Search files");
    await searchBox.fill("file");
    await expect(searchBox).toHaveValue("file");

    // Clicking a folder should reset the search input.
    await page.getByRole("button", { name: folderName }).click();
    await expect(searchBox).toHaveValue("");
  });
});
