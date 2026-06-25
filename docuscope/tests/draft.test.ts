import { test, expect, type Page } from "@playwright/test";
import { injectOidcUser } from "./helpers";
import {
  createTestProject,
  addTestContributor,
  createTestFile,
} from "./db-helpers";

// Manual Save & Submit (issue #78). These tests avoid the S3 upload path by
// seeding files directly via Drizzle, then either driving the UI or calling the
// draft/submit API routes with the test-bypass bearer token.
//
// NOTE: the test process can't import the client module (lib/projects.ts uses
// import.meta via pdfText), so the snapshot type and the conflict predicate are
// mirrored locally here. The canonical predicate (app/useFileDraft.ts) is also
// exercised end-to-end by the UI conflict-modal tests below.

const SECRET = process.env.TEST_AUTH_SECRET ?? "local-test-secret";

type FileDraftSnapshot = {
  metadata: {
    author: string | null;
    createdDate: number | null;
    overallBias: string | null;
    source: string | null;
    fileReliability: string | null;
    fileCredibility: string | null;
  };
  information: Array<{
    id: string;
    informationTitle: string;
    informationText: string | null;
    overallBias: string | null;
    informationReliability: string | null;
    informationCredibility: string | null;
    selections: Array<{
      id: string;
      pageIndex: number;
      boundingTop: number;
      boundingLeft: number;
      rects: { x: number; y: number; width: number; height: number }[];
      text: string;
    }>;
  }>;
};

// Mirror of app/useFileDraft.ts:draftOverwritesFilledField.
function draftOverwritesFilledField(
  publishedMeta: FileDraftSnapshot["metadata"],
  publishedInformationCount: number,
  draft: FileDraftSnapshot,
): boolean {
  const fields = [
    "author",
    "createdDate",
    "overallBias",
    "source",
    "fileReliability",
    "fileCredibility",
  ] as const;
  const metaConflict = fields.some((f) => {
    const pub = publishedMeta[f];
    return pub != null && pub !== "" && draft.metadata[f] !== pub;
  });
  return metaConflict || publishedInformationCount > 0;
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bearer(uid: string, email: string): string {
  return `test:${SECRET}:${uid}:${email}`;
}

/** A minimal snapshot with the given author and no information. */
function metaSnapshot(author: string): FileDraftSnapshot {
  return {
    metadata: {
      author,
      createdDate: null,
      overallBias: null,
      source: null,
      fileReliability: null,
      fileCredibility: null,
    },
    information: [],
  };
}

/**
 * Seed a project the given user contributes to, plus one file, and sign the
 * user in. Returns the ids and a bearer token for direct API calls.
 */
async function seedSignedIn(
  page: Page,
  opts: { uid: string; email: string; file?: Parameters<typeof createTestFile>[1] } & {
    title?: string;
  },
): Promise<{ projectId: string; fileId: string; token: string }> {
  const projectId = await createTestProject(opts.title ?? unique("Draft Project"));
  await addTestContributor(projectId, opts.email);
  const fileId = await createTestFile(projectId, opts.file ?? { filename: "draft.pdf" });
  await injectOidcUser(page, opts.uid, opts.email);
  await expect(page.getByRole("heading", { name: "Your Projects" })).toBeVisible();
  return { projectId, fileId, token: bearer(opts.uid, opts.email) };
}

/** Run a fetch against the app origin (shares the dev server). */
async function apiFetch(
  page: Page,
  token: string,
  pathSuffix: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ token, pathSuffix, init }) => {
      const res = await fetch(pathSuffix, {
        method: init?.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    },
    { token, pathSuffix, init },
  );
}

// ── conflict predicate (pure unit) ──────────────────────────────────────────────

test.describe("draftOverwritesFilledField", () => {
  test("no conflict when the draft only fills empty published fields", () => {
    const published = metaSnapshot("").metadata;
    published.author = null;
    const draft = metaSnapshot("New Author");
    expect(draftOverwritesFilledField(published, 0, draft)).toBe(false);
  });

  test("conflict when the draft changes an already-filled field", () => {
    const published = metaSnapshot("Old Author").metadata;
    const draft = metaSnapshot("New Author");
    expect(draftOverwritesFilledField(published, 0, draft)).toBe(true);
  });

  test("no conflict when the draft matches the published filled field", () => {
    const published = metaSnapshot("Same").metadata;
    const draft = metaSnapshot("Same");
    expect(draftOverwritesFilledField(published, 0, draft)).toBe(false);
  });

  test("conflict when the file already has published information rows", () => {
    const published = metaSnapshot("").metadata;
    const draft = metaSnapshot("");
    expect(draftOverwritesFilledField(published, 1, draft)).toBe(true);
  });
});

// ── server enforcement & data semantics (no UI) ─────────────────────────────────

test.describe("Draft API", () => {
  test("Save stages to the draft store without touching the main tables", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    // Check out, then Save a snapshot.
    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    const put = await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("StagedOnly"),
    });
    expect(put.status).toBe(200);

    // Main table is unchanged…
    const file = (await apiFetch(page, token, base)).json as { author: string | null };
    expect(file.author).toBeNull();

    // …but the draft holds the staged value.
    const draft = (await apiFetch(page, token, `${base}/draft`))
      .json as FileDraftSnapshot;
    expect(draft.metadata.author).toBe("StagedOnly");
  });

  test("Submit publishes the snapshot and clears the draft", async ({ page }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("WillPublish"),
    });
    const submit = await apiFetch(page, token, `${base}/submit`, {
      method: "POST",
      body: metaSnapshot("WillPublish"),
    });
    expect(submit.status).toBe(200);

    const file = (await apiFetch(page, token, base)).json as { author: string | null };
    expect(file.author).toBe("WillPublish");
    const draft = (await apiFetch(page, token, `${base}/draft`)).json;
    expect(draft).toBeNull();
  });

  test("Submit stages information and selections only on submit", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    // Fresh UUIDs per run so a re-run can't collide with information.id rows
    // left by a previous run (the PK upsert would otherwise touch a stale row).
    const infoId = crypto.randomUUID();
    const selId = crypto.randomUUID();
    const snapshot: FileDraftSnapshot = {
      metadata: metaSnapshot("Author").metadata,
      information: [
        {
          id: infoId,
          informationTitle: "Claim",
          informationText: "evidence body",
          overallBias: null,
          informationReliability: null,
          informationCredibility: null,
          selections: [
            {
              id: selId,
              pageIndex: 0,
              boundingTop: 10,
              boundingLeft: 20,
              rects: [{ x: 1, y: 2, width: 3, height: 4 }],
              text: "highlighted",
            },
          ],
        },
      ],
    };

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    await apiFetch(page, token, `${base}/draft`, { method: "PUT", body: snapshot });

    // Not in the main tables before submit.
    const infoBefore = (await apiFetch(page, token, `${base}/information`))
      .json as unknown[];
    expect(infoBefore.length).toBe(0);

    // After submit they are present, including the selection.
    await apiFetch(page, token, `${base}/submit`, { method: "POST", body: snapshot });
    const infoAfter = (await apiFetch(page, token, `${base}/information`))
      .json as { id: string; informationTitle: string }[];
    expect(infoAfter.length).toBe(1);
    expect(infoAfter[0].informationTitle).toBe("Claim");
    const sels = (await apiFetch(page, token, `${base}/information/${infoId}/selections`))
      .json as { text: string }[];
    expect(sels.length).toBe(1);
    expect(sels[0].text).toBe("highlighted");
  });

  test("Server returns 409 on Save/Submit when another user holds the checkout", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    // A second contributor grabs the checkout.
    const otherUid = unique("other");
    const otherEmail = `${otherUid}@test.com`;
    await addTestContributor(projectId, otherEmail);
    const otherToken = bearer(otherUid, otherEmail);
    await apiFetch(page, otherToken, `${base}/checkout`, { method: "POST" });

    const put = await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("Blocked"),
    });
    expect(put.status).toBe(409);
    const submit = await apiFetch(page, token, `${base}/submit`, {
      method: "POST",
      body: metaSnapshot("Blocked"),
    });
    expect(submit.status).toBe(409);
  });

  test("A user's draft is not visible to another user", async ({ page }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("PrivateA"),
    });
    await apiFetch(page, token, `${base}/checkout`, { method: "DELETE" });

    const otherUid = unique("other");
    const otherEmail = `${otherUid}@test.com`;
    await addTestContributor(projectId, otherEmail);
    const otherToken = bearer(otherUid, otherEmail);
    const otherDraft = (await apiFetch(page, otherToken, `${base}/draft`)).json;
    expect(otherDraft).toBeNull();
  });

  test("Discard deletes the stored draft", async ({ page }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("ToDiscard"),
    });
    const del = await apiFetch(page, token, `${base}/draft`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = (await apiFetch(page, token, `${base}/draft`)).json;
    expect(after).toBeNull();
  });
});

// ── UI: button gating + Save/Submit + conflict modal ────────────────────────────

/** Open the seeded project and the file's File Details sidebar. */
async function openSeededFile(
  page: Page,
  projectTitle: string,
  filename: string,
) {
  await page.getByRole("button", { name: projectTitle }).click();
  await expect(page.getByRole("button", { name: "Create Folder" })).toBeVisible();
  await page.getByRole("cell", { name: filename }).click();
  const sidebar = page.locator("aside").last();
  await expect(sidebar.getByRole("heading", { name: filename })).toBeVisible();
  return sidebar;
}

test.describe("Draft UI", () => {
  test("Save and Submit are disabled before checkout and enabled after", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("UI Project");
    await seedSignedIn(page, { uid, email, title, file: { filename: "ui.pdf" } });

    const sidebar = await openSeededFile(page, title, "ui.pdf");

    await expect(sidebar.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(sidebar.getByRole("button", { name: "Submit" })).toBeDisabled();

    await sidebar.getByRole("button", { name: "Check Out" }).click();
    await expect(sidebar.getByRole("button", { name: "Check In" })).toBeVisible();

    await expect(sidebar.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(sidebar.getByRole("button", { name: "Submit" })).toBeEnabled();

    // Check back in: both disabled again.
    await sidebar.getByRole("button", { name: "Check In" }).click();
    await expect(sidebar.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(sidebar.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  test("Save stages without publishing; Submit publishes", async ({ page }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("UI Project");
    const { projectId, fileId, token } = await seedSignedIn(page, {
      uid,
      email,
      title,
      file: { filename: "ui.pdf" },
    });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    const sidebar = await openSeededFile(page, title, "ui.pdf");
    await sidebar.getByRole("button", { name: "Check Out" }).click();

    const authorInput = sidebar.locator("input[placeholder='Unknown']");
    await authorInput.fill("Ui Author");

    // Save → draft holds it, main table does not.
    await sidebar.getByRole("button", { name: "Save" }).click();
    await expect(sidebar.getByText("Saved.")).toBeVisible();
    const fileAfterSave = (await apiFetch(page, token, base)).json as {
      author: string | null;
    };
    expect(fileAfterSave.author).toBeNull();

    // Submit → main table now has it.
    await sidebar.getByRole("button", { name: "Submit" }).click();
    await expect(sidebar.getByText("Submitted.")).toBeVisible();
    const fileAfterSubmit = (await apiFetch(page, token, base)).json as {
      author: string | null;
    };
    expect(fileAfterSubmit.author).toBe("Ui Author");
    const draft = (await apiFetch(page, token, `${base}/draft`)).json;
    expect(draft).toBeNull();
  });

  test("A saved draft is shown again when the file is reopened", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("UI Project");
    await seedSignedIn(page, { uid, email, title, file: { filename: "ui.pdf" } });

    const sidebar = await openSeededFile(page, title, "ui.pdf");
    await sidebar.getByRole("button", { name: "Check Out" }).click();
    await sidebar.locator("input[placeholder='Unknown']").fill("Reloaded Author");
    await sidebar.getByRole("button", { name: "Save" }).click();
    await expect(sidebar.getByText("Saved.")).toBeVisible();

    // Reload the page; the file stays checked out by us, so reopening surfaces
    // the saved draft (no conflict — the published author was empty). The app
    // restores the last-opened project, so the file table is shown directly.
    await page.reload();
    await page.getByRole("cell", { name: "ui.pdf" }).click();
    const sidebar2 = page.locator("aside").last();
    await expect(
      sidebar2.getByRole("heading", { name: "ui.pdf" }),
    ).toBeVisible();
    await expect(sidebar2.locator("input[placeholder='Unknown']")).toHaveValue(
      "Reloaded Author",
    );
  });

  test("Conflict modal: Use my draft loads it; main table unchanged until submit", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("UI Project");
    // Seed a file that already has a published author so the draft conflicts.
    const { projectId, fileId, token } = await seedSignedIn(page, {
      uid,
      email,
      title,
      file: { filename: "ui.pdf", author: "Published Author" },
    });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    // Stage a conflicting draft directly (checkout then save then check in).
    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("Draft Author"),
    });
    await apiFetch(page, token, `${base}/checkout`, { method: "DELETE" });

    await page.reload();
    const sidebar = await openSeededFile(page, title, "ui.pdf");
    // Before checkout the published value shows.
    await expect(sidebar.locator("input[placeholder='Unknown']")).toHaveValue(
      "Published Author",
    );

    await sidebar.getByRole("button", { name: "Check Out" }).click();

    // The conflict modal appears; choose "Use my draft".
    await expect(
      page.getByRole("heading", { name: "Unsaved draft found" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use my draft" }).click();

    await expect(sidebar.locator("input[placeholder='Unknown']")).toHaveValue(
      "Draft Author",
    );
    // Main table still has the published value (nothing submitted yet).
    const file = (await apiFetch(page, token, base)).json as { author: string | null };
    expect(file.author).toBe("Published Author");
  });

  test("Conflict modal: Discard my draft removes it and keeps published values", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("UI Project");
    const { projectId, fileId, token } = await seedSignedIn(page, {
      uid,
      email,
      title,
      file: { filename: "ui.pdf", author: "Published Author" },
    });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });
    await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: metaSnapshot("Draft Author"),
    });
    await apiFetch(page, token, `${base}/checkout`, { method: "DELETE" });

    await page.reload();
    const sidebar = await openSeededFile(page, title, "ui.pdf");
    await sidebar.getByRole("button", { name: "Check Out" }).click();

    await expect(
      page.getByRole("heading", { name: "Unsaved draft found" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Discard my draft" }).click();

    await expect(sidebar.locator("input[placeholder='Unknown']")).toHaveValue(
      "Published Author",
    );
    const draft = (await apiFetch(page, token, `${base}/draft`)).json;
    expect(draft).toBeNull();
  });

  test("No conflict modal when the file has no draft", async ({ page }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("UI Project");
    await seedSignedIn(page, {
      uid,
      email,
      title,
      file: { filename: "ui.pdf", author: "Published Author" },
    });

    const sidebar = await openSeededFile(page, title, "ui.pdf");
    await sidebar.getByRole("button", { name: "Check Out" }).click();
    await expect(sidebar.getByRole("button", { name: "Check In" })).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Unsaved draft found" }),
    ).toBeHidden();
  });
});
