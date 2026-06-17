import { test, expect } from "@playwright/test";
import {
  getSelections,
  addSelection,
  deleteSelection,
  deleteInformation,
} from "../lib/projects.server";
import type { SelectionFields } from "../lib/projects";
import {
  createTestProject,
  createTestFile,
  createTestInformation,
} from "./db-helpers";

// ── Server-side unit tests for selection CRUD + ownership scoping ──────────────
// These call the selection server functions directly against the test database
// without a browser, S3, or Cognito. Each test self-seeds a fresh project so the
// shared single-worker DB stays isolated test-to-test.

/** Seed a fresh project → file → information and return the three ids. */
async function seedInfo(): Promise<{
  projectId: string;
  fileId: string;
  informationId: string;
}> {
  const projectId = await createTestProject();
  const fileId = await createTestFile(projectId, { filename: "doc.pdf" });
  const informationId = await createTestInformation(fileId);
  return { projectId, fileId, informationId };
}

/** A SelectionFields builder with sensible defaults so tests stay terse. */
function sel(overrides: Partial<SelectionFields> = {}): SelectionFields {
  return {
    pageIndex: 0,
    boundingTop: 0,
    boundingLeft: 0,
    rects: [{ x: 1, y: 2, width: 3, height: 4 }],
    text: "passage",
    ...overrides,
  };
}

test.describe("selections — CRUD + ownership scoping", () => {
  test("getSelections returns [] for an information row with no selections", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    const rows = await getSelections(projectId, fileId, informationId);

    expect(rows).toEqual([]);
  });

  test("addSelection returns an ids array of the same length and getSelections returns the rows", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    const fields = [
      sel({ pageIndex: 0, boundingTop: 10, text: "first" }),
      sel({ pageIndex: 0, boundingTop: 20, text: "second" }),
      sel({ pageIndex: 1, boundingTop: 5, text: "third" }),
    ];

    const ids = await addSelection(projectId, fileId, informationId, fields);
    expect(ids).toHaveLength(fields.length);

    const rows = await getSelections(projectId, fileId, informationId);
    expect(rows).toHaveLength(fields.length);
    // Every returned id is one of the ids addSelection reported.
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(ids));
  });

  test("addSelection with an empty array returns [] and inserts nothing", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    const ids = await addSelection(projectId, fileId, informationId, []);

    expect(ids).toEqual([]);
    expect(await getSelections(projectId, fileId, informationId)).toEqual([]);
  });

  test("getSelections orders by pageIndex, then boundingTop, then boundingLeft", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    // Inserted deliberately out of order.
    await addSelection(projectId, fileId, informationId, [
      sel({ pageIndex: 2, boundingTop: 5, boundingLeft: 5, text: "E" }),
      sel({ pageIndex: 0, boundingTop: 50, boundingLeft: 10, text: "C" }),
      sel({ pageIndex: 0, boundingTop: 10, boundingLeft: 90, text: "B" }),
      sel({ pageIndex: 0, boundingTop: 10, boundingLeft: 5, text: "A" }),
      sel({ pageIndex: 1, boundingTop: 0, boundingLeft: 0, text: "D" }),
    ]);

    const rows = await getSelections(projectId, fileId, informationId);

    // Expected order: page 0 (top 10 left 5, top 10 left 90, top 50), page 1, page 2.
    expect(rows.map((r) => r.text)).toEqual(["A", "B", "C", "D", "E"]);
  });

  test("per-page text persists distinctly and rects round-trip through jsonb", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    const fields = [
      sel({
        pageIndex: 0,
        boundingTop: 1,
        text: "page one text",
        rects: [{ x: 1, y: 1, width: 10, height: 2 }],
      }),
      sel({
        pageIndex: 1,
        boundingTop: 1,
        text: "page two text",
        rects: [
          { x: 5, y: 6, width: 7, height: 8 },
          { x: 9, y: 10, width: 11, height: 12 },
        ],
      }),
    ];

    await addSelection(projectId, fileId, informationId, fields);
    const rows = await getSelections(projectId, fileId, informationId);

    // Each row keeps its own text (not one value duplicated across rows).
    expect(rows.map((r) => r.text)).toEqual(["page one text", "page two text"]);

    // rects survive the jsonb round-trip exactly.
    expect(rows[0].rects).toEqual([{ x: 1, y: 1, width: 10, height: 2 }]);
    expect(rows[1].rects).toEqual([
      { x: 5, y: 6, width: 7, height: 8 },
      { x: 9, y: 10, width: 11, height: 12 },
    ]);
  });

  test("deleteSelection removes only the targeted row", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    const ids = await addSelection(projectId, fileId, informationId, [
      sel({ boundingTop: 10, text: "keep-a" }),
      sel({ boundingTop: 20, text: "delete-me" }),
      sel({ boundingTop: 30, text: "keep-b" }),
    ]);

    const before = await getSelections(projectId, fileId, informationId);
    expect(before).toHaveLength(3);

    await deleteSelection(projectId, fileId, informationId, ids[1]);

    const after = await getSelections(projectId, fileId, informationId);
    // Row count drops by exactly one and the right rows remain.
    expect(after).toHaveLength(2);
    expect(after.map((r) => r.id).sort()).toEqual([ids[0], ids[2]].sort());
    expect(after.map((r) => r.text)).not.toContain("delete-me");
  });

  test("ownership scoping: getSelections/addSelection/deleteSelection reject a mismatched path", async () => {
    const a = await seedInfo();
    const b = await seedInfo();

    // Project A's path but project B's informationId — the IDOR guard must reject.
    await expect(
      getSelections(a.projectId, a.fileId, b.informationId),
    ).rejects.toThrow(/Not found/);
    await expect(
      addSelection(a.projectId, a.fileId, b.informationId, [sel()]),
    ).rejects.toThrow(/Not found/);
    await expect(
      deleteSelection(a.projectId, a.fileId, b.informationId, crypto.randomUUID()),
    ).rejects.toThrow(/Not found/);

    // The right info id but under the wrong file (B's file) is also rejected.
    await expect(
      getSelections(a.projectId, b.fileId, a.informationId),
    ).rejects.toThrow(/Not found/);
    await expect(
      addSelection(a.projectId, b.fileId, a.informationId, [sel()]),
    ).rejects.toThrow(/Not found/);
    await expect(
      deleteSelection(a.projectId, b.fileId, a.informationId, crypto.randomUUID()),
    ).rejects.toThrow(/Not found/);

    // The right file+info but under the wrong project (B's project) is rejected.
    await expect(
      getSelections(b.projectId, a.fileId, a.informationId),
    ).rejects.toThrow(/Not found/);
  });

  test("a mismatched path does not insert anything into the correct information row", async () => {
    const a = await seedInfo();
    const b = await seedInfo();

    await expect(
      addSelection(a.projectId, a.fileId, b.informationId, [sel(), sel()]),
    ).rejects.toThrow(/Not found/);

    // Neither A's nor B's information picked up the rejected rows.
    expect(await getSelections(a.projectId, a.fileId, a.informationId)).toEqual([]);
    expect(await getSelections(b.projectId, b.fileId, b.informationId)).toEqual([]);
  });

  test("deleting the information cascades and removes its selections", async () => {
    const { projectId, fileId, informationId } = await seedInfo();

    await addSelection(projectId, fileId, informationId, [
      sel({ text: "one" }),
      sel({ boundingTop: 5, text: "two" }),
    ]);
    expect(await getSelections(projectId, fileId, informationId)).toHaveLength(2);

    await deleteInformation(projectId, fileId, informationId);

    // The information row is gone, so the guard now rejects — confirming both
    // that the info was deleted and (via FK cascade) its selections went with it.
    await expect(
      getSelections(projectId, fileId, informationId),
    ).rejects.toThrow(/Not found/);
  });
});
