import { test, expect } from "@playwright/test";
import { moveFile, getFolderFileIds } from "../lib/projects";
import {
  createTestFile,
  createTestFolder,
  getSubfileIds,
} from "./firestore-helpers";

// Each test gets its own project id to avoid state leaking between tests.
function pid(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test.describe("moveFile", () => {
  test("root → folder: file is added to the target folder's subfiles", async () => {
    const projectId = pid();
    const fileId = await createTestFile(projectId);
    const folderId = await createTestFolder(projectId, "Folder A");

    await moveFile(projectId, fileId, folderId);

    const subfiles = await getSubfileIds(projectId, folderId);
    expect(subfiles).toContain(fileId);
  });

  test("folder → root: file is removed from the source folder, ends up in no folder", async () => {
    const projectId = pid();
    const fileId = await createTestFile(projectId);
    const folderId = await createTestFolder(projectId, "Folder A", [fileId]);

    await moveFile(projectId, fileId, null);

    const subfiles = await getSubfileIds(projectId, folderId);
    expect(subfiles).not.toContain(fileId);
  });

  test("folder → folder: removed from source, added to destination in one batch", async () => {
    const projectId = pid();
    const fileId = await createTestFile(projectId);
    const srcId = await createTestFolder(projectId, "Source", [fileId]);
    const dstId = await createTestFolder(projectId, "Destination");

    await moveFile(projectId, fileId, dstId);

    const srcSubfiles = await getSubfileIds(projectId, srcId);
    const dstSubfiles = await getSubfileIds(projectId, dstId);
    expect(srcSubfiles).not.toContain(fileId);
    expect(dstSubfiles).toContain(fileId);
  });

  test("no-op: if file is already in the destination folder, the document is not written", async () => {
    const projectId = pid();
    const fileId = await createTestFile(projectId);
    const folderId = await createTestFolder(projectId, "Folder A", [fileId]);

    await moveFile(projectId, fileId, folderId);

    const subfiles = await getSubfileIds(projectId, folderId);
    // File is still present and was not duplicated.
    expect(subfiles.filter((id) => id === fileId)).toHaveLength(1);
  });

  test("cleanup: file in multiple folders is removed from all non-destination folders", async () => {
    const projectId = pid();
    const fileId = await createTestFile(projectId);
    // Simulate the corrupt state where the file ended up in two folders.
    const folder1Id = await createTestFolder(projectId, "Folder 1", [fileId]);
    const folder2Id = await createTestFolder(projectId, "Folder 2", [fileId]);
    const dstId = await createTestFolder(projectId, "Destination");

    await moveFile(projectId, fileId, dstId);

    const sub1 = await getSubfileIds(projectId, folder1Id);
    const sub2 = await getSubfileIds(projectId, folder2Id);
    const subDst = await getSubfileIds(projectId, dstId);
    expect(sub1).not.toContain(fileId);
    expect(sub2).not.toContain(fileId);
    expect(subDst).toContain(fileId);
  });
});

test.describe("getFolderFileIds", () => {
  test("returns the correct set of file ids per folder", async () => {
    const projectId = pid();
    const file1 = await createTestFile(projectId);
    const file2 = await createTestFile(projectId);
    const file3 = await createTestFile(projectId);
    const folder1Id = await createTestFolder(projectId, "Folder 1", [
      file1,
      file2,
    ]);
    const folder2Id = await createTestFolder(projectId, "Folder 2", [file3]);

    const result = await getFolderFileIds(projectId);

    expect(result.get(folder1Id)?.has(file1)).toBe(true);
    expect(result.get(folder1Id)?.has(file2)).toBe(true);
    expect(result.get(folder1Id)?.has(file3)).toBe(false);
    expect(result.get(folder2Id)?.has(file3)).toBe(true);
    expect(result.get(folder2Id)?.has(file1)).toBe(false);
  });

  test("returns an empty set for folders with no subfiles", async () => {
    const projectId = pid();
    const folderId = await createTestFolder(projectId, "Empty Folder");

    const result = await getFolderFileIds(projectId);

    expect(result.get(folderId)).toBeDefined();
    expect(result.get(folderId)?.size).toBe(0);
  });
});
