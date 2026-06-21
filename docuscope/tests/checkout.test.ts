import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { injectOidcUser } from "./helpers";

// SVG fixtures used as uploads (mirrors project-features.test.ts).
const PUBLIC = path.join(__dirname, "..", "public");
const SVG = {
  globe: path.join(PUBLIC, "globe.svg"),
};

// ── shared helpers ────────────────────────────────────────────────────────────

/**
 * Signs in the given user (uid/email), creates one project, opens it, and
 * returns the project name so the same project can be reopened by another user.
 */
async function signUpAndOpenProject(
  page: Page,
  uid: string,
  email: string,
): Promise<string> {
  await injectOidcUser(page, uid, email);
  await expect(
    page.getByRole("heading", { name: "Your Projects" }),
  ).toBeVisible();

  const projectName = `Project ${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Title").fill(projectName);
  await page.locator("button[type='submit']").click();

  await page.getByRole("button", { name: projectName }).click();
  await expect(
    page.getByRole("button", { name: "Create Folder" }),
  ).toBeVisible();
  return projectName;
}

/** Uploads a file via the hidden file input and waits for it in the table. */
async function uploadFile(page: Page, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  await page.locator("input[type='file']").setInputFiles(filePath);
  await expect(page.getByText("Uploading…")).toBeHidden();
  await expect(page.getByRole("cell", { name: filename })).toBeVisible();
}

/** Opens the File Details sidebar for the named file and returns its locator. */
async function openFileSidebar(page: Page, filename: string) {
  await page.getByRole("cell", { name: filename }).click();
  const sidebar = page.locator("aside").last();
  await expect(sidebar.getByRole("heading", { name: filename })).toBeVisible();
  return sidebar;
}

/**
 * Builds the test-bypass bearer token (the same format injectOidcUser uses) and
 * resolves the project id and the first file's id, so a test can call the API
 * directly. Runs inside the page so it shares the app's origin.
 */
async function resolveProjectAndFile(
  page: Page,
  uid: string,
  email: string,
): Promise<{ token: string; projectId: string; fileId: string }> {
  const secret = process.env.TEST_AUTH_SECRET ?? "local-test-secret";
  const token = `test:${secret}:${uid}:${email}`;

  const { projectId, fileId } = await page.evaluate(async (bearer) => {
    const headers = { Authorization: `Bearer ${bearer}` };
    const projects = (await fetch("/api/projects", { headers }).then((r) =>
      r.json(),
    )) as { id: string }[];
    const projectId = projects[0].id;
    const files = (await fetch(`/api/projects/${projectId}/files`, {
      headers,
    }).then((r) => r.json())) as { id: string }[];
    return { projectId, fileId: files[0].id };
  }, token);

  return { token, projectId, fileId };
}

// ── Check-out UI ──────────────────────────────────────────────────────────────

test.describe("File check-out", () => {
  test("Check Out button is visible and fields are disabled before checkout", async ({
    page,
  }) => {
    const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await signUpAndOpenProject(page, uid, `checkout-before-${Date.now()}@test.com`);
    await uploadFile(page, SVG.globe);

    const sidebar = await openFileSidebar(page, "globe.svg");

    // The Check Out button exists, and editing is gated until checkout.
    await expect(
      sidebar.getByRole("button", { name: "Check Out" }),
    ).toBeVisible();
    await expect(
      sidebar.locator("input[placeholder='Unknown']"),
    ).toBeDisabled();
  });

  test("Check Out enables editing and button changes to Check In", async ({
    page,
  }) => {
    const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await signUpAndOpenProject(page, uid, `checkout-enable-${Date.now()}@test.com`);
    await uploadFile(page, SVG.globe);

    const sidebar = await openFileSidebar(page, "globe.svg");

    await sidebar.getByRole("button", { name: "Check Out" }).click();

    await expect(
      sidebar.getByRole("button", { name: "Check In" }),
    ).toBeVisible();
    await expect(
      sidebar.locator("input[placeholder='Unknown']"),
    ).toBeEnabled();
  });

  test("Check In disables editing and button reverts to Check Out", async ({
    page,
  }) => {
    const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await signUpAndOpenProject(page, uid, `checkout-revert-${Date.now()}@test.com`);
    await uploadFile(page, SVG.globe);

    const sidebar = await openFileSidebar(page, "globe.svg");

    await sidebar.getByRole("button", { name: "Check Out" }).click();
    await expect(
      sidebar.getByRole("button", { name: "Check In" }),
    ).toBeVisible();

    await sidebar.getByRole("button", { name: "Check In" }).click();

    await expect(
      sidebar.getByRole("button", { name: "Check Out" }),
    ).toBeVisible();
    await expect(
      sidebar.locator("input[placeholder='Unknown']"),
    ).toBeDisabled();
  });

  test("Another user cannot check out a file already checked out", async ({
    browser,
  }) => {
    // User A: create the project, upload a file, and check it out.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const uidA = `uid-a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emailA = `checkout-a-${Date.now()}@test.com`;
    const projectName = await signUpAndOpenProject(pageA, uidA, emailA);
    await uploadFile(pageA, SVG.globe);
    const sidebarA = await openFileSidebar(pageA, "globe.svg");
    await sidebarA.getByRole("button", { name: "Check Out" }).click();
    await expect(
      sidebarA.getByRole("button", { name: "Check In" }),
    ).toBeVisible();

    // User B: a separate context (so a different uid) opening the same project.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const uidB = `uid-b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emailB = `checkout-b-${Date.now()}@test.com`;
    await injectOidcUser(pageB, uidB, emailB);
    await expect(
      pageB.getByRole("heading", { name: "Your Projects" }),
    ).toBeVisible();
    // Add B as a contributor so they can see the project. The project list shows
    // only owned/contributed projects, so B must be invited first.
    await addContributor(pageA, emailB);
    // Reload so B picks up the newly shared project, then open it.
    await pageB.reload();
    await pageB.getByRole("button", { name: projectName }).click();
    const sidebarB = await openFileSidebar(pageB, "globe.svg");

    // B's Check Out button is disabled because A holds the lock.
    await expect(
      sidebarB.getByRole("button", { name: "Check Out" }),
    ).toBeDisabled();

    await contextA.close();
    await contextB.close();
  });

  test("Fields are read-only for the non-owning user while file is checked out", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const uidA = `uid-a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emailA = `ro-a-${Date.now()}@test.com`;
    const projectName = await signUpAndOpenProject(pageA, uidA, emailA);
    await uploadFile(pageA, SVG.globe);
    const sidebarA = await openFileSidebar(pageA, "globe.svg");
    await sidebarA.getByRole("button", { name: "Check Out" }).click();
    await expect(
      sidebarA.getByRole("button", { name: "Check In" }),
    ).toBeVisible();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const uidB = `uid-b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emailB = `ro-b-${Date.now()}@test.com`;
    await injectOidcUser(pageB, uidB, emailB);
    await expect(
      pageB.getByRole("heading", { name: "Your Projects" }),
    ).toBeVisible();
    await addContributor(pageA, emailB);
    await pageB.reload();
    await pageB.getByRole("button", { name: projectName }).click();
    const sidebarB = await openFileSidebar(pageB, "globe.svg");

    // B cannot edit Author while A holds the file.
    await expect(
      sidebarB.locator("input[placeholder='Unknown']"),
    ).toBeDisabled();

    await contextA.close();
    await contextB.close();
  });

  // ── Server-side enforcement ──────────────────────────────────────────────────

  test("Server rejects metadata PATCH when file is not checked out", async ({
    page,
  }) => {
    const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `srv-reject-${Date.now()}@test.com`;
    await signUpAndOpenProject(page, uid, email);
    await uploadFile(page, SVG.globe);

    const { token, projectId, fileId } = await resolveProjectAndFile(
      page,
      uid,
      email,
    );

    // The guard rejects a metadata write only when the file is checked out by
    // *another* user. So a second user grabs the lock first, then this user's
    // PATCH (without holding the checkout) must be refused with 409.
    const status = await page.evaluate(
      async ({ bearer, projectId, fileId, secret }) => {
        // A different user grabs the lock first.
        const otherUid = `other-${Date.now()}`;
        const otherToken = `test:${secret}:${otherUid}:${otherUid}@test.com`;
        await fetch(`/api/projects/${projectId}/files/${fileId}/checkout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${otherToken}` },
        });
        // Now our PATCH should be rejected with 409.
        const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({
            author: "Blocked",
            createdDate: null,
            overallBias: null,
            source: null,
            fileReliability: null,
            fileCredibility: null,
          }),
        });
        return res.status;
      },
      {
        bearer: token,
        projectId,
        fileId,
        secret: process.env.TEST_AUTH_SECRET ?? "local-test-secret",
      },
    );

    expect(status).toBe(409);
  });

  test("Server allows metadata PATCH when caller holds the checkout", async ({
    page,
  }) => {
    const uid = `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `srv-allow-${Date.now()}@test.com`;
    await signUpAndOpenProject(page, uid, email);
    await uploadFile(page, SVG.globe);

    const { token, projectId, fileId } = await resolveProjectAndFile(
      page,
      uid,
      email,
    );

    const status = await page.evaluate(
      async ({ bearer, projectId, fileId }) => {
        // Check the file out as this user, then PATCH.
        await fetch(`/api/projects/${projectId}/files/${fileId}/checkout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}` },
        });
        const res = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({
            author: "Allowed",
            createdDate: null,
            overallBias: null,
            source: null,
            fileReliability: null,
            fileCredibility: null,
          }),
        });
        return res.status;
      },
      { bearer: token, projectId, fileId },
    );

    expect(status).toBe(200);
  });
});

/**
 * Adds the given email as a contributor via the open Project Settings modal,
 * then closes it. Used to share a project with a second user.
 */
async function addContributor(page: Page, email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await page.getByRole("button", { name: "Project settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Project Settings" }),
  ).toBeVisible();
  await page.getByPlaceholder("name@example.com").fill(normalized);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The added contributor appears in the list once the write completes.
  await expect(page.getByText(normalized, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(
    page.getByRole("heading", { name: "Project Settings" }),
  ).toBeHidden();
}
