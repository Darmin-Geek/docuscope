import { test, expect, type Page } from "@playwright/test";
import { injectOidcUser } from "./helpers";
import {
  createTestProject,
  addTestContributor,
  createTestFile,
} from "./db-helpers";
import { validateDraftForSubmit } from "../lib/draftValidation";

// Admiralty-code dropdowns for Reliability and Credibility (issue #80). The
// rule layered on the #78 save/submit flow: a Reliability/Credibility code set
// without its matching free-text description blocks Submit, but never Save.
//
// Files are seeded directly via Drizzle (no S3 upload path). The submit-gate
// helper is pure, so it is also exercised as a plain unit below.

const SECRET = process.env.TEST_AUTH_SECRET ?? "local-test-secret";

type FileDraftSnapshot = {
  metadata: {
    author: string | null;
    createdDate: number | null;
    overallBias: string | null;
    source: string | null;
    fileReliability: string | null;
    fileCredibility: string | null;
    fileReliabilityCode: string | null;
    fileCredibilityCode: string | null;
  };
  information: Array<{
    id: string;
    informationTitle: string;
    informationText: string | null;
    overallBias: string | null;
    informationReliability: string | null;
    informationCredibility: string | null;
    informationReliabilityCode: string | null;
    informationCredibilityCode: string | null;
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

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bearer(uid: string, email: string): string {
  return `test:${SECRET}:${uid}:${email}`;
}

// An empty (all-null) snapshot the tests patch field by field.
function emptySnapshot(): FileDraftSnapshot {
  return {
    metadata: {
      author: null,
      createdDate: null,
      overallBias: null,
      source: null,
      fileReliability: null,
      fileCredibility: null,
      fileReliabilityCode: null,
      fileCredibilityCode: null,
    },
    information: [],
  };
}

function infoEntry(
  overrides: Partial<FileDraftSnapshot["information"][number]> = {},
): FileDraftSnapshot["information"][number] {
  return {
    id: unique("info"),
    informationTitle: "Untitled",
    informationText: null,
    overallBias: null,
    informationReliability: null,
    informationCredibility: null,
    informationReliabilityCode: null,
    informationCredibilityCode: null,
    selections: [],
    ...overrides,
  };
}

async function seedSignedIn(
  page: Page,
  opts: { uid: string; email: string; title?: string; filename?: string },
): Promise<{ projectId: string; fileId: string; token: string }> {
  const projectId = await createTestProject(opts.title ?? unique("Admiralty Project"));
  await addTestContributor(projectId, opts.email);
  const fileId = await createTestFile(projectId, {
    filename: opts.filename ?? "admiralty.pdf",
  });
  await injectOidcUser(page, opts.uid, opts.email);
  await expect(page.getByRole("heading", { name: "Your Projects" })).toBeVisible();
  return { projectId, fileId, token: bearer(opts.uid, opts.email) };
}

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

// ── submit-gate (pure unit) ─────────────────────────────────────────────────────

test.describe("validateDraftForSubmit", () => {
  test("passes when nothing is rated", () => {
    expect(validateDraftForSubmit(emptySnapshot())).toBeNull();
  });

  test("blocks a file reliability code with no description", () => {
    const s = emptySnapshot();
    s.metadata.fileReliabilityCode = "A";
    expect(validateDraftForSubmit(s)).toMatch(/Reliability/);
  });

  test("blocks a file credibility code with no description", () => {
    const s = emptySnapshot();
    s.metadata.fileCredibilityCode = "1";
    expect(validateDraftForSubmit(s)).toMatch(/Credibility/);
  });

  test("passes once the matching description is filled", () => {
    const s = emptySnapshot();
    s.metadata.fileReliabilityCode = "B";
    s.metadata.fileReliability = "Usually right.";
    s.metadata.fileCredibilityCode = "2";
    s.metadata.fileCredibility = "Probably true.";
    expect(validateDraftForSubmit(s)).toBeNull();
  });

  test("treats a whitespace-only description as blank", () => {
    const s = emptySnapshot();
    s.metadata.fileReliabilityCode = "C";
    s.metadata.fileReliability = "   ";
    expect(validateDraftForSubmit(s)).not.toBeNull();
  });

  test("blocks an information row's rating with no description", () => {
    const s = emptySnapshot();
    s.information = [
      infoEntry({ informationTitle: "Claim", informationCredibilityCode: "3" }),
    ];
    expect(validateDraftForSubmit(s)).toContain("Claim");
  });

  test("passes when an information rating has its description", () => {
    const s = emptySnapshot();
    s.information = [
      infoEntry({
        informationReliabilityCode: "A",
        informationReliability: "Solid source.",
      }),
    ];
    expect(validateDraftForSubmit(s)).toBeNull();
  });
});

// ── server enforcement & round-trip (no UI) ─────────────────────────────────────

test.describe("Admiralty submit gate (API)", () => {
  test("Save accepts a rating without a description; Submit rejects it", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });

    const snap = emptySnapshot();
    snap.metadata.fileReliabilityCode = "A"; // no description

    // Save is never gated.
    const save = await apiFetch(page, token, `${base}/draft`, {
      method: "PUT",
      body: snap,
    });
    expect(save.status).toBe(200);

    // Submit is rejected with 400, and the main table is untouched.
    const submit = await apiFetch(page, token, `${base}/submit`, {
      method: "POST",
      body: snap,
    });
    expect(submit.status).toBe(400);
    const file = (await apiFetch(page, token, base)).json as {
      fileReliabilityCode: string | null;
    };
    expect(file.fileReliabilityCode).toBeNull();
  });

  test("Submit publishes the codes once their descriptions are filled", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });

    const snap = emptySnapshot();
    snap.metadata.fileReliabilityCode = "B";
    snap.metadata.fileReliability = "Usually reliable in practice.";
    snap.metadata.fileCredibilityCode = "2";
    snap.metadata.fileCredibility = "Consistent with other sources.";

    const submit = await apiFetch(page, token, `${base}/submit`, {
      method: "POST",
      body: snap,
    });
    expect(submit.status).toBe(200);

    const file = (await apiFetch(page, token, base)).json as {
      fileReliabilityCode: string | null;
      fileCredibilityCode: string | null;
    };
    expect(file.fileReliabilityCode).toBe("B");
    expect(file.fileCredibilityCode).toBe("2");
  });

  test("information-level ratings gate and round-trip on submit", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const { projectId, fileId, token } = await seedSignedIn(page, { uid, email });
    const base = `/api/projects/${projectId}/files/${fileId}`;

    await apiFetch(page, token, `${base}/checkout`, { method: "POST" });

    const snap = emptySnapshot();
    snap.information = [
      infoEntry({
        informationTitle: "Rated claim",
        informationCredibilityCode: "4", // no description → blocked
      }),
    ];

    const blocked = await apiFetch(page, token, `${base}/submit`, {
      method: "POST",
      body: snap,
    });
    expect(blocked.status).toBe(400);

    // Fill the description and resubmit.
    snap.information[0].informationCredibility = "Doubtful but plausible.";
    const ok = await apiFetch(page, token, `${base}/submit`, {
      method: "POST",
      body: snap,
    });
    expect(ok.status).toBe(200);

    const info = (await apiFetch(page, token, `${base}/information`)).json as Array<{
      informationCredibilityCode: string | null;
    }>;
    expect(info[0].informationCredibilityCode).toBe("4");
  });
});

// ── UI: dropdowns + submit gating ───────────────────────────────────────────────

async function openSeededFile(page: Page, projectTitle: string, filename: string) {
  await page.getByRole("button", { name: projectTitle }).click();
  await expect(page.getByRole("button", { name: "Create Folder" })).toBeVisible();
  await page.getByRole("cell", { name: filename }).click();
  const sidebar = page.locator("aside").last();
  await expect(sidebar.getByRole("heading", { name: filename })).toBeVisible();
  return sidebar;
}

test.describe("Admiralty dropdowns (UI)", () => {
  test("setting a rating without a description blocks Submit but not Save", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("Admiralty UI");
    await seedSignedIn(page, { uid, email, title, filename: "ui.pdf" });

    const sidebar = await openSeededFile(page, title, "ui.pdf");
    await sidebar.getByRole("button", { name: "Check Out" }).click();
    await expect(sidebar.getByRole("button", { name: "Check In" })).toBeVisible();

    // Both buttons start enabled (nothing rated yet).
    await expect(sidebar.getByRole("button", { name: "Submit" })).toBeEnabled();

    // Pick a reliability code; its definition appears and Submit is blocked
    // while the description is empty. Save stays available.
    const reliability = sidebar.getByLabel("Reliability Rating");
    await reliability.selectOption("A");
    await expect(
      sidebar.getByText("No doubt of authenticity", { exact: false }),
    ).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Submit" })).toBeDisabled();
    await expect(sidebar.getByRole("button", { name: "Save" })).toBeEnabled();

    // Fill the matching description → Submit re-enables.
    await sidebar.getByText("Overall Reliability").locator("xpath=following-sibling::textarea").fill(
      "Reliable in our experience.",
    );
    await expect(sidebar.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  test("the reliability dropdown offers the blank option plus A-F", async ({
    page,
  }) => {
    const uid = unique("uid");
    const email = `${uid}@test.com`;
    const title = unique("Admiralty UI");
    await seedSignedIn(page, { uid, email, title, filename: "ui.pdf" });

    const sidebar = await openSeededFile(page, title, "ui.pdf");
    await sidebar.getByRole("button", { name: "Check Out" }).click();

    const options = sidebar.getByLabel("Reliability Rating").locator("option");
    // 1 blank + 6 codes.
    await expect(options).toHaveCount(7);
  });
});
