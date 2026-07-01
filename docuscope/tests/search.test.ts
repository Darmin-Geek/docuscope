import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { getFiles, chunkText } from "../lib/projects.server";
import { injectOidcUser } from "./helpers";
import {
  createTestProject,
  createTestFile,
  createTestFolder,
  createTestInformation,
  insertChunks,
} from "./db-helpers";

// ── chunkText unit tests ──────────────────────────────────────────────────────

test.describe("chunkText", () => {
  test("returns no chunks for blank input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t ")).toEqual([]);
  });

  test("returns a single chunk for text shorter than the chunk size", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    expect(chunkText(text)).toEqual([text]);
  });

  test("splits long text into overlapping chunks (default 1000/100 words)", () => {
    // 1500 distinct words → two chunks: [0,1000) and [900,1500).
    const words = Array.from({ length: 1500 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(" "));

    expect(chunks).toHaveLength(2);

    const first = chunks[0].split(" ");
    const second = chunks[1].split(" ");
    expect(first).toHaveLength(1000);
    expect(second).toHaveLength(600);

    // The trailing 100 words of chunk 0 are the leading 100 words of chunk 1.
    expect(first.slice(-100)).toEqual(second.slice(0, 100));
  });
});

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

  test("matches on PDF chunk content, not just metadata", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "report.pdf" });
    await insertChunks(fileId, [
      "The committee discussed photosynthesis in marine phytoplankton at length.",
    ]);

    await createTestFile(projectId, { filename: "other.pdf" });

    const results = await getFiles(projectId, null, "phytoplankton");

    expect(results.map((f) => f.id)).toContain(fileId);
    expect(results).toHaveLength(1);
  });

  test("surfaces a file once even when multiple chunks match", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "long.pdf" });
    await insertChunks(fileId, [
      "alpha beta gravitational waves were detected",
      "later sections revisit gravitational waves in detail",
    ]);

    const results = await getFiles(projectId, null, "gravitational");

    expect(results.map((f) => f.id)).toEqual([fileId]);
  });

  test("matches on information title", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "analysis.pdf" });
    await createTestInformation(fileId, {
      informationTitle: "Quantitative easing overview",
    });
    await createTestFile(projectId, { filename: "other.pdf" });

    const results = await getFiles(projectId, null, "quantitative");

    expect(results.map((f) => f.id)).toContain(fileId);
    expect(results).toHaveLength(1);
  });

  test("matches on information text body", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "notes.pdf" });
    await createTestInformation(fileId, {
      informationTitle: "Key finding",
      informationText: "The mitochondria is the powerhouse of the cell.",
    });
    await createTestFile(projectId, { filename: "unrelated.pdf" });

    const results = await getFiles(projectId, null, "mitochondria");

    expect(results.map((f) => f.id)).toContain(fileId);
    expect(results).toHaveLength(1);
  });

  test("surfaces a file once even when multiple information entries match", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "multi.pdf" });
    await createTestInformation(fileId, {
      informationTitle: "First neuroplasticity note",
    });
    await createTestInformation(fileId, {
      informationTitle: "Second neuroplasticity finding",
    });

    const results = await getFiles(projectId, null, "neuroplasticity");

    expect(results.map((f) => f.id)).toEqual([fileId]);
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

// ── Scoped search (issue #27) ─────────────────────────────────────────────────
// getFiles' fourth argument restricts the search to a subset of fields. Undefined
// or a full set means "search everything" (the default, back-compatible path).

test.describe("getFiles — search scope", () => {
  // Seed three files that each carry the same needle in a different place, so a
  // scope can be shown to include/exclude each independently.
  async function seedNeedles(projectId: string) {
    const inAuthor = await createTestFile(projectId, {
      filename: "author.pdf",
      author: "needleword",
    });
    const inContents = await createTestFile(projectId, {
      filename: "contents.pdf",
    });
    await insertChunks(inContents, ["a passage mentioning needleword in the body"]);
    const inInfo = await createTestFile(projectId, { filename: "info.pdf" });
    await createTestInformation(inInfo, { informationTitle: "needleword summary" });
    return { inAuthor, inContents, inInfo };
  }

  test("scoping to author matches only the author field", async () => {
    const projectId = await createTestProject();
    const { inAuthor, inContents, inInfo } = await seedNeedles(projectId);

    const results = await getFiles(projectId, null, "needleword", ["author"]);
    const ids = results.map((f) => f.id);

    expect(ids).toContain(inAuthor);
    expect(ids).not.toContain(inContents);
    expect(ids).not.toContain(inInfo);
  });

  test("scoping to contents matches only PDF body text", async () => {
    const projectId = await createTestProject();
    const { inAuthor, inContents, inInfo } = await seedNeedles(projectId);

    const results = await getFiles(projectId, null, "needleword", ["contents"]);
    const ids = results.map((f) => f.id);

    expect(ids).toEqual([inContents]);
    expect(ids).not.toContain(inAuthor);
    expect(ids).not.toContain(inInfo);
  });

  test("scoping to information title matches only information", async () => {
    const projectId = await createTestProject();
    const { inAuthor, inContents, inInfo } = await seedNeedles(projectId);

    const results = await getFiles(projectId, null, "needleword", ["infoTitle"]);
    const ids = results.map((f) => f.id);

    expect(ids).toEqual([inInfo]);
    expect(ids).not.toContain(inAuthor);
    expect(ids).not.toContain(inContents);
  });

  test("a multi-field scope returns the union of matches", async () => {
    const projectId = await createTestProject();
    const { inAuthor, inContents, inInfo } = await seedNeedles(projectId);

    const results = await getFiles(projectId, null, "needleword", [
      "author",
      "contents",
    ]);
    const ids = results.map((f) => f.id);

    expect(ids).toContain(inAuthor);
    expect(ids).toContain(inContents);
    expect(ids).not.toContain(inInfo);
  });

  test("an undefined scope searches every field (default behaviour)", async () => {
    const projectId = await createTestProject();
    const { inAuthor, inContents, inInfo } = await seedNeedles(projectId);

    const results = await getFiles(projectId, null, "needleword");
    const ids = results.map((f) => f.id);

    expect(ids).toContain(inAuthor);
    expect(ids).toContain(inContents);
    expect(ids).toContain(inInfo);
    expect(ids).toHaveLength(3);
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
// A small PDF whose body text contains the word "phytoplankton".
const PDF_FIXTURE = path.join(__dirname, "fixtures", "sample.pdf");

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

  test("a PDF's extracted body text is searchable", async ({ page }) => {
    await signUpAndOpenProject(page, `search-pdf-${Date.now()}@test.com`);

    await uploadFile(page, PDF_FIXTURE); // sample.pdf — body contains "phytoplankton"

    // The word never appears in the filename or any metadata field, so a hit
    // can only come from the indexed chunk content.
    await page.getByLabel("Search files").fill("phytoplankton");

    await expect(page.getByRole("cell", { name: "sample.pdf" })).toBeVisible();
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

  test("narrowing the search scope excludes matches from other fields", async ({
    page,
  }) => {
    await signUpAndOpenProject(page, `search-scope-${Date.now()}@test.com`);

    await uploadFile(page, SVG.file); // file.svg
    await setFileAuthor(page, "file.svg", "uniquescopeauthor");

    // Everything scope: the author match is found.
    const searchBox = page.getByLabel("Search files");
    await searchBox.fill("uniquescopeauthor");
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();

    // Restrict to "File contents" — an SVG has no body text, so the author match
    // must drop out.
    await page.getByRole("button", { name: "Search scope" }).click();
    await page.getByRole("button", { name: "Scope preset: File contents" }).click();
    await expect(page.getByText("No files match your search.")).toBeVisible();

    // Reset back to everything — the file reappears.
    await page.getByRole("button", { name: "Search everything" }).click();
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
  });

  test("the chosen scope persists across a reload", async ({ page }) => {
    await signUpAndOpenProject(page, `search-scope-persist-${Date.now()}@test.com`);

    await uploadFile(page, SVG.file);
    await setFileAuthor(page, "file.svg", "persistauthor");

    // Narrow to File details so the scope is non-default, then reload.
    await page.getByRole("button", { name: "Search scope" }).click();
    await page.getByRole("button", { name: "Scope preset: File details" }).click();
    await page.keyboard.press("Escape");
    await page.reload();

    // The narrowed scope survives: the button shows a field count, and an
    // author search still matches (File details includes author).
    await expect(page.getByRole("button", { name: "Search scope" })).toContainText(
      "5",
    );
    await page.getByLabel("Search files").fill("persistauthor");
    await expect(page.getByRole("cell", { name: "file.svg" })).toBeVisible();
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
