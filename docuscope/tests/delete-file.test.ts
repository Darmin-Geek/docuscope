import { test, expect } from "@playwright/test";
import { db } from "../lib/drizzle/db";
import { files } from "../lib/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  getFiles,
  getFolderFileIds,
  checkOutFile,
  deleteFile,
} from "../lib/projects.server";
import { getTimelineEntries } from "../lib/timelines.server";
import {
  createTestProject,
  createTestFile,
  createTestFolder,
  createTestInformation,
  createTestDatetime,
  createTestTimeline,
  addTestTimelineEntry,
} from "./db-helpers";

// ── Soft-delete (issue #100) ──────────────────────────────────────────────────
// deleteFile stamps files.deleted_on, checks the file back in, and every read
// path excludes deleted rows. These call the server functions directly against
// the test database without a browser.

const UID = "user-abc";
const OTHER_UID = "user-xyz";

/** Read the raw files row so tests can assert on deleted_on / checked_out_by. */
async function readFileRow(fileId: string) {
  const [row] = await db
    .select({ deletedOn: files.deletedOn, checkedOutBy: files.checkedOutBy })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);
  return row;
}

test.describe("deleteFile — checkout guard", () => {
  test("the checkout holder can delete: stamps deleted_on and checks in", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    expect(await checkOutFile(projectId, fileId, UID)).toBe(true);

    const before = Date.now();
    await deleteFile(projectId, fileId, UID);

    const row = await readFileRow(fileId);
    expect(row.deletedOn).not.toBeNull();
    expect(row.deletedOn!).toBeGreaterThanOrEqual(before);
    // Auto check-in: the lock is released as part of the delete.
    expect(row.checkedOutBy).toBeNull();
  });

  test("a non-holder cannot delete (Conflict) and the file is untouched", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await checkOutFile(projectId, fileId, UID);

    await expect(deleteFile(projectId, fileId, OTHER_UID)).rejects.toThrow(
      "Conflict",
    );

    const row = await readFileRow(fileId);
    expect(row.deletedOn).toBeNull();
    expect(row.checkedOutBy).toBe(UID);
  });

  test("a file that is not checked out cannot be deleted (Conflict)", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);

    await expect(deleteFile(projectId, fileId, UID)).rejects.toThrow("Conflict");

    const row = await readFileRow(fileId);
    expect(row.deletedOn).toBeNull();
  });

  test("deleting an already-deleted file is a Conflict (keeps the original timestamp)", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);
    const first = (await readFileRow(fileId)).deletedOn;

    // A second delete requires a fresh checkout, which is itself refused for a
    // deleted file — so the delete guard also fails.
    await expect(deleteFile(projectId, fileId, UID)).rejects.toThrow("Conflict");
    expect((await readFileRow(fileId)).deletedOn).toBe(first);
  });
});

test.describe("deleteFile — exclusion from reads", () => {
  test("a deleted file is absent from the root file list", async () => {
    const projectId = await createTestProject();
    const keep = await createTestFile(projectId, { filename: "keep.pdf" });
    const drop = await createTestFile(projectId, { filename: "drop.pdf" });
    await checkOutFile(projectId, drop, UID);
    await deleteFile(projectId, drop, UID);

    const ids = (await getFiles(projectId)).map((f) => f.id);
    expect(ids).toContain(keep);
    expect(ids).not.toContain(drop);
  });

  test("a deleted file is absent from a folder's file list", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "in-folder.pdf" });
    const folderId = await createTestFolder(projectId, "Folder", [fileId]);
    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);

    expect(await getFiles(projectId, folderId)).toHaveLength(0);
  });

  test("a deleted file is absent from search results", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "apollo.pdf" });
    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);

    expect(await getFiles(projectId, null, "apollo")).toHaveLength(0);
  });

  test("a deleted file does not inflate folder counts", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const folderId = await createTestFolder(projectId, "Folder", [fileId]);
    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);

    const counts = await getFolderFileIds(projectId);
    expect(counts.get(folderId)?.size ?? 0).toBe(0);
  });

  test("a deleted file cannot be checked out", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);

    // deleteFile released the lock; a fresh check-out must still be refused.
    expect(await checkOutFile(projectId, fileId, OTHER_UID)).toBe(false);
  });

  test("a deleted file's datetimes drop off the timeline", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId);
    const infoId = await createTestInformation(fileId);
    const datetimeId = await createTestDatetime(infoId);
    const timelineId = await createTestTimeline(projectId);
    await addTestTimelineEntry(timelineId, datetimeId);

    // Present before deletion.
    expect(await getTimelineEntries(projectId, timelineId)).toHaveLength(1);

    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);

    expect(await getTimelineEntries(projectId, timelineId)).toHaveLength(0);
  });
});

test.describe("deleteFile — admin recovery", () => {
  test("resetting deleted_on to NULL restores the file everywhere", async () => {
    const projectId = await createTestProject();
    const fileId = await createTestFile(projectId, { filename: "recover.pdf" });
    const folderId = await createTestFolder(projectId, "Folder", [fileId]);
    const infoId = await createTestInformation(fileId);
    const datetimeId = await createTestDatetime(infoId);
    const timelineId = await createTestTimeline(projectId);
    await addTestTimelineEntry(timelineId, datetimeId);

    await checkOutFile(projectId, fileId, UID);
    await deleteFile(projectId, fileId, UID);
    expect(await getFiles(projectId, folderId)).toHaveLength(0);

    // The admin-recovery path: clear the marker.
    await db.update(files).set({ deletedOn: null }).where(eq(files.id, fileId));

    expect((await getFiles(projectId, folderId)).map((f) => f.id)).toContain(
      fileId,
    );
    expect(await getFiles(projectId, null, "recover")).toHaveLength(1);
    expect(await getTimelineEntries(projectId, timelineId)).toHaveLength(1);
    expect(await checkOutFile(projectId, fileId, OTHER_UID)).toBe(true);
  });
});
