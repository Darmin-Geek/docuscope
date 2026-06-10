import { test, expect } from "@playwright/test";
import {
  groupFoldersByParent,
  flattenFolderTree,
  findFolderContainingFile,
} from "../lib/folderTree";

function f(id: string, folderName: string, parentId: string | null = null) {
  return { id, folderName, parentId };
}

test.describe("groupFoldersByParent", () => {
  test("empty input returns empty map", () => {
    expect(groupFoldersByParent([]).size).toBe(0);
  });

  test("root-level folders are grouped under null", () => {
    const result = groupFoldersByParent([f("1", "Alpha"), f("2", "Beta")]);
    expect(result.has(null)).toBe(true);
    expect(result.get(null)!.map((x) => x.id)).toEqual(["1", "2"]);
  });

  test("siblings are sorted alphabetically", () => {
    const result = groupFoldersByParent([
      f("1", "Zebra"),
      f("2", "Alpha"),
      f("3", "Mango"),
    ]);
    expect(result.get(null)!.map((x) => x.folderName)).toEqual([
      "Alpha",
      "Mango",
      "Zebra",
    ]);
  });

  test("child folders are grouped under their parentId", () => {
    const result = groupFoldersByParent([
      f("p", "Parent"),
      f("c1", "Child B", "p"),
      f("c2", "Child A", "p"),
    ]);
    expect(result.has("p")).toBe(true);
    expect(result.get("p")!.map((x) => x.folderName)).toEqual([
      "Child A",
      "Child B",
    ]);
  });
});

test.describe("flattenFolderTree", () => {
  test("empty input returns empty array", () => {
    expect(flattenFolderTree([])).toEqual([]);
  });

  test("single root folder with no children has depth 0", () => {
    const result = flattenFolderTree([f("1", "Only")]);
    expect(result).toHaveLength(1);
    expect(result[0].folder.id).toBe("1");
    expect(result[0].depth).toBe(0);
  });

  test("depth annotation is correct at each level", () => {
    const result = flattenFolderTree([
      f("root", "Root"),
      f("child", "Child", "root"),
      f("grand", "Grand", "child"),
    ]);
    expect(result.map((n) => ({ id: n.folder.id, depth: n.depth }))).toEqual([
      { id: "root", depth: 0 },
      { id: "child", depth: 1 },
      { id: "grand", depth: 2 },
    ]);
  });

  test("produces correct pre-order traversal across multiple root folders", () => {
    // Tree:  A Folder -> [A1 Sub, A2 Sub],  B Folder -> [B1 Sub]
    // Pre-order (alphabetical at each level): A, A1, A2, B, B1
    const result = flattenFolderTree([
      f("B", "B Folder"),
      f("A", "A Folder"),
      f("A2", "A2 Sub", "A"),
      f("B1", "B1 Sub", "B"),
      f("A1", "A1 Sub", "A"),
    ]);
    expect(result.map((n) => n.folder.id)).toEqual(["A", "A1", "A2", "B", "B1"]);
  });
});

test.describe("findFolderContainingFile", () => {
  test("returns null for an empty map", () => {
    expect(findFolderContainingFile(new Map(), "file1")).toBeNull();
  });

  test("returns null when file is not in any folder", () => {
    const map = new Map([["folder1", new Set(["fileA", "fileB"])]]);
    expect(findFolderContainingFile(map, "missing")).toBeNull();
  });

  test("returns the folder id when the file is found", () => {
    const map = new Map([["folder1", new Set(["fileA", "fileB"])]]);
    expect(findFolderContainingFile(map, "fileA")).toBe("folder1");
  });

  test("returns the correct folder when multiple folders exist", () => {
    const map = new Map([
      ["folder1", new Set(["fileA", "fileB"])],
      ["folder2", new Set(["fileC", "fileD"])],
      ["folder3", new Set(["fileE"])],
    ]);
    expect(findFolderContainingFile(map, "fileC")).toBe("folder2");
    expect(findFolderContainingFile(map, "fileE")).toBe("folder3");
    expect(findFolderContainingFile(map, "fileA")).toBe("folder1");
  });
});
