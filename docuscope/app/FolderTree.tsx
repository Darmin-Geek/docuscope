"use client";

import { useMemo, useState } from "react";
import { type Folder } from "@/lib/projects";
import { groupFoldersByParent } from "@/lib/folderTree";

type FolderTreeProps = {
  folders: Folder[];
  selectedId: string | null;
  // Called when a folder name is clicked. The effect (select for navigation,
  // pick as move destination, etc.) is determined by the caller.
  onFolderClick: (folderId: string) => void;
};

export default function FolderTree({
  folders,
  selectedId,
  onFolderClick,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const childrenByParent = useMemo(
    () => groupFoldersByParent(folders),
    [folders],
  );

  function toggleExpanded(folderId: string, event: React.MouseEvent) {
    // Stop propagation so clicking the expand triangle never triggers the
    // parent row's folder-select action.
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function renderFolders(parentId: string | null, depth: number) {
    const children = childrenByParent.get(parentId) ?? [];
    return children.map((folder) => {
      const hasChildren = (childrenByParent.get(folder.id) ?? []).length > 0;
      const isExpanded = expanded.has(folder.id);
      const isSelected = folder.id === selectedId;

      return (
        <div key={folder.id}>
          {/* The row is a div (not a button) so we can have two independent
              click targets: the expand triangle and the folder name. */}
          <div
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            className={`flex w-full items-center rounded-md pr-2 text-sm transition-colors ${
              isSelected
                ? "bg-black/[.06] font-medium text-black dark:bg-white/[.1] dark:text-zinc-50"
                : "text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
            }`}
          >
            {/* Expand/collapse triangle — larger hit area and font size so it is
                easy to click and clearly distinct from the folder name. Clicking
                it only toggles the subfolder list; it never selects the folder. */}
            <button
              type="button"
              onClick={(e) => toggleExpanded(folder.id, e)}
              tabIndex={hasChildren ? 0 : -1}
              aria-label={isExpanded ? "Collapse subfolders" : "Expand subfolders"}
              className="flex h-7 w-7 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              {hasChildren && (
                <span className="text-lg leading-none">
                  {isExpanded ? "▾" : "▸"}
                </span>
              )}
            </button>

            {/* Folder name — clicking this is the only action that triggers
                onFolderClick (select, pick destination, etc.). */}
            <button
              type="button"
              onClick={() => onFolderClick(folder.id)}
              className="min-w-0 flex-1 truncate py-1.5 text-left"
            >
              {folder.folderName || "Untitled"}
            </button>
          </div>

          {isExpanded && renderFolders(folder.id, depth + 1)}
        </div>
      );
    });
  }

  return <div>{renderFolders(null, 0)}</div>;
}
