import { test, expect } from "@playwright/test";
import {
  submitDraft,
  createFileRecord,
  getFileHistory,
  getInformationHistory,
} from "../lib/projects.server";
import type { FileDraftSnapshot } from "../lib/projects";
import { createTestProject, createTestFile } from "./db-helpers";

// Build a submit snapshot with sensible empty defaults, overriding only the
// metadata / information the test cares about. Mirrors the shape the client
// sends (see FileDraftSnapshot).
function snapshot(
  overrides: {
    metadata?: Partial<FileDraftSnapshot["metadata"]>;
    information?: FileDraftSnapshot["information"];
  } = {},
): FileDraftSnapshot {
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
      ...overrides.metadata,
    },
    information: overrides.information ?? [],
  };
}

function infoRow(
  id: string,
  fields: Partial<FileDraftSnapshot["information"][number]> = {},
): FileDraftSnapshot["information"][number] {
  return {
    id,
    informationTitle: "",
    informationText: null,
    overallBias: null,
    informationReliability: null,
    informationCredibility: null,
    informationReliabilityCode: null,
    informationCredibilityCode: null,
    labels: [],
    datetimes: [],
    selections: [],
    ...fields,
  };
}

// ── file metadata history ─────────────────────────────────────────────────────

test.describe("field version history — file metadata", () => {
  test("records a version only for fields that changed", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { author: null, source: null });

    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({ metadata: { author: "Ada Lovelace" } }),
      "Ada Lovelace",
    );

    const history = await getFileHistory(projectId, fileId);
    expect(history.author).toHaveLength(1);
    expect(history.author[0]).toMatchObject({
      value: "Ada Lovelace",
      editorName: "Ada Lovelace",
    });
    // Unchanged fields get no version row.
    expect(history.source).toBeUndefined();
    expect(history.overallBias).toBeUndefined();
  });

  test("a no-op submit records nothing new", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    await submitDraft(projectId, fileId, "uid-1", snapshot({ metadata: { author: "Grace" } }), "Grace");
    // Resubmit with the same value — no change, so no new version.
    await submitDraft(projectId, fileId, "uid-1", snapshot({ metadata: { author: "Grace" } }), "Grace");

    const history = await getFileHistory(projectId, fileId);
    expect(history.author).toHaveLength(1);
  });

  test("orders versions newest-first and attributes each editor", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    await submitDraft(projectId, fileId, "uid-a", snapshot({ metadata: { author: "First" } }), "Alice");
    await submitDraft(projectId, fileId, "uid-b", snapshot({ metadata: { author: "Second" } }), "Bob");

    const history = await getFileHistory(projectId, fileId);
    expect(history.author.map((v) => v.value)).toEqual(["Second", "First"]);
    expect(history.author.map((v) => v.editorName)).toEqual(["Bob", "Alice"]);
  });

  test("clearing a field records a null value", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { author: "Set" });

    // First publish a value, then clear it.
    await submitDraft(projectId, fileId, "uid-1", snapshot({ metadata: { author: "Set" } }), "Ed");
    await submitDraft(projectId, fileId, "uid-1", snapshot({ metadata: { author: null } }), "Ed");

    const history = await getFileHistory(projectId, fileId);
    expect(history.author[0].value).toBeNull();
  });

  test("createFileRecord seeds a baseline version for populated fields", async () => {
    const projectId = await createTestProject();
    const file = await createFileRecord(
      projectId,
      "seed.pdf",
      "",
      "Original Author",
      null,
      null,
      { uid: "uid-creator", name: "Creator" },
    );

    const history = await getFileHistory(projectId, file.id);
    expect(history.author).toHaveLength(1);
    expect(history.author[0]).toMatchObject({
      value: "Original Author",
      editorName: "Creator",
    });
  });
});

// ── information history ────────────────────────────────────────────────────────

test.describe("field version history — information", () => {
  test("seeds a baseline for a new information row and appends on edit", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = crypto.randomUUID();

    // New row → baseline version for its non-empty fields.
    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({ information: [infoRow(infoId, { informationTitle: "Claim v1" })] }),
      "Alice",
    );
    // Edit the title → appended version.
    await submitDraft(
      projectId,
      fileId,
      "uid-2",
      snapshot({ information: [infoRow(infoId, { informationTitle: "Claim v2" })] }),
      "Bob",
    );

    const history = await getInformationHistory(projectId, fileId, infoId);
    expect(history.informationTitle.map((v) => v.value)).toEqual([
      "Claim v2",
      "Claim v1",
    ]);
    expect(history.informationTitle.map((v) => v.editorName)).toEqual([
      "Bob",
      "Alice",
    ]);
  });

  test("history cascade-deletes with its information row", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = crypto.randomUUID();

    await submitDraft(
      projectId,
      fileId,
      "uid-1",
      snapshot({ information: [infoRow(infoId, { informationTitle: "Temp" })] }),
      "Alice",
    );
    // Submit again without the row → it is deleted, and so is its history.
    await submitDraft(projectId, fileId, "uid-1", snapshot({ information: [] }), "Alice");

    const history = await getInformationHistory(projectId, fileId, infoId);
    expect(history).toEqual({});
  });
});
