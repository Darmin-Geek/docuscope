"use client";

import { useEffect, useMemo, useState } from "react";
import { getFolders, type Folder } from "@/lib/projects";

type FolderTreeProps = {
  projectId: string;
  selectedId: string | null;
  onSelectChange: (folderId: string | null) => void;
};

export default function FolderTree({
  projectId,
  selectedId,
  onSelectChange,
}: FolderTreeProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    getFolders(projectId).then((result) => {
      if (active) setFolders(result);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const childrenByParent = useMemo(() => {
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
  }, [folders]);

  function handleFolderClick(folderId: string) {
    onSelectChange(folderId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
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
          <button
            type="button"
            onClick={() => handleFolderClick(folder.id)}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors ${
              isSelected
                ? "bg-black/[.06] font-medium text-black dark:bg-white/[.1] dark:text-zinc-50"
                : "text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
            }`}
          >
            <span className="w-3 shrink-0 text-zinc-400">
              {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
            </span>
            <span className="truncate">{folder.folderName || "Untitled"}</span>
          </button>
          {isExpanded && renderFolders(folder.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectChange(null)}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
          selectedId === null
            ? "bg-black/[.06] font-medium text-black dark:bg-white/[.1] dark:text-zinc-50"
            : "text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
        }`}
      >
        (root / All files)
      </button>
      {renderFolders(null, 0)}
    </div>
  );
}
