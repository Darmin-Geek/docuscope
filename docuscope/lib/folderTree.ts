import { type Folder } from "./projects";

/**
 * Shared helpers for turning the flat `Folder[]` we load from Firestore into the
 * tree the UI renders. Both the folder sidebar (which renders the tree with
 * expand/collapse) and the file sidebar's "move to folder" picker (which renders
 * a flat, indented list) build on these so they agree on ordering.
 */

/**
 * Group folders by their `parentId` (null for root-level folders). Each sibling
 * list is sorted by name so the tree renders in a stable, alphabetical order.
 */
export function groupFoldersByParent(
  folders: Folder[],
): Map<string | null, Folder[]> {
  const map = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const siblings = map.get(folder.parentId) ?? [];
    siblings.push(folder);
    map.set(folder.parentId, siblings);
  }
  for (const siblings of map.values()) {
    siblings.sort((a, b) => a.folderName.localeCompare(b.folderName));
  }
  return map;
}

/** A folder paired with its depth in the tree (root folders are depth 0). */
export type FolderTreeNode = { folder: Folder; depth: number };

/**
 * Flatten the folder tree into a pre-order list, annotating each folder with its
 * depth so a flat control (e.g. a <select>) can indent it to show nesting.
 * Siblings follow the same alphabetical order as {@link groupFoldersByParent}.
 */
export function flattenFolderTree(folders: Folder[]): FolderTreeNode[] {
  const childrenByParent = groupFoldersByParent(folders);
  const result: FolderTreeNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      result.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

/**
 * Find the id of the folder that currently contains the given file, or null when
 * the file sits at the project root (no folder lists it). `folderFileIds` maps a
 * folder id to the set of file ids in its `subfiles`.
 */
export function findFolderContainingFile(
  folderFileIds: Map<string, Set<string>>,
  fileId: string,
): string | null {
  for (const [folderId, fileIds] of folderFileIds) {
    if (fileIds.has(fileId)) return folderId;
  }
  return null;
}
