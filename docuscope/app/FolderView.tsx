"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getFolders,
  createFolder,
  type Folder,
  type Label,
} from "@/lib/projects";
import CreateFolderModal from "./CreateFolderModal";
import LabelPill from "./LabelPill";

type FolderViewProps = {
  projectId: string;
  // The single selected folder, owned by the parent so the file table can show
  // the matching files. Creating a folder while one is selected nests the new
  // folder inside it; with nothing selected it goes to the root.
  selectedId: string | null;
  onSelectChange: (folderId: string | null) => void;
  onUpload: (file: File) => void | Promise<void>;
  // The project's labels and which are active as a filter. Toggling is owned by
  // the parent so the file table reflects the same selection. `additive` is
  // true when the user shift-clicks to combine labels.
  labels: Label[];
  selectedLabelIds: Set<string>;
  onToggleLabel: (labelId: string, additive: boolean) => void;
};

export default function FolderView({
  projectId,
  selectedId,
  onSelectChange,
  onUpload,
  labels,
  selectedLabelIds,
  onToggleLabel,
}: FolderViewProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Folders whose direct subfolders are currently revealed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Guard against a stale response from a previous projectId resolving after
    // this effect has been cleaned up.
    let active = true;
    getFolders(projectId)
      .then((result) => {
        if (!active) return;
        setFolders(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load folders.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // Pressing Esc deselects the current folder, so a newly created folder goes
  // back to the root. Expanded/collapsed state is intentionally left untouched.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onSelectChange(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSelectChange]);

  // The labels list can briefly contain the same label id more than once — e.g.
  // when a freshly created label is appended locally while an in-flight reload
  // also resolves with it. Render each label id exactly once so the filter pills
  // (and their titles) stay unique; otherwise Playwright's strict-mode locators
  // and React's key uniqueness both break.
  const uniqueLabels = useMemo(() => {
    const seen = new Set<string>();
    return labels.filter((label) => {
      if (seen.has(label.id)) return false;
      seen.add(label.id);
      return true;
    });
  }, [labels]);

  // Group folders by their parent so the tree can be rendered recursively.
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

  // Clicking a folder both selects it and toggles whether its direct
  // subfolders are shown.
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

  async function handleCreate(name: string) {
    const parentId = selectedId;
    const folder = await createFolder(projectId, name, parentId);
    // Append the new folder, guarding against a duplicate entry (e.g. a double
    // submit or React's dev-mode double-invocation) so the tree never renders
    // the same folder id twice and triggers a duplicate React key warning.
    setFolders((prev) =>
      prev.some((existing) => existing.id === folder.id)
        ? prev
        : [...prev, folder],
    );
    // Reveal the new folder by expanding its parent (if any).
    if (parentId) {
      setExpanded((prev) => new Set(prev).add(parentId));
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so selecting the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  const selectedFolder = folders.find((f) => f.id === selectedId) ?? null;

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
            className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors ${
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
    <aside className="flex w-1/4 min-w-56 flex-col border-r border-black/[.08] dark:border-white/[.145]">
      <div className="flex flex-col gap-2 border-b border-black/[.08] p-3 dark:border-white/[.145]">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex h-9 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Create Folder
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex h-9 items-center justify-center rounded-full border border-solid border-black/[.08] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          {uploading ? "Uploading…" : "Upload File"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">
            Loading folders…
          </p>
        ) : error ? (
          <p className="px-2 py-1 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : folders.length === 0 ? (
          <p className="px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">
            No folders yet.
          </p>
        ) : (
          renderFolders(null, 0)
        )}
      </div>

      {/* The bottom half of the sidebar lists the project's labels; clicking one
          filters the file table to files carrying it (shift-click combines). */}
      {uniqueLabels.length > 0 && (
        <div className="flex h-1/2 min-h-0 flex-col border-t border-black/[.08] dark:border-white/[.145]">
          <span className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Labels
          </span>
          <div className="flex flex-wrap content-start gap-1.5 overflow-y-auto px-3 pb-3">
            {uniqueLabels.map((label) => {
              const active = selectedLabelIds.has(label.id);
              return (
                <LabelPill
                  key={label.id}
                  label={label.label}
                  color={label.color}
                  filled={active}
                  onClick={(event) => onToggleLabel(label.id, event.shiftKey)}
                  title={
                    active
                      ? `Filtering by ${label.label}`
                      : `Filter by ${label.label}`
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {creating && (
        <CreateFolderModal
          parentFolderName={selectedFolder?.folderName ?? null}
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
        />
      )}
    </aside>
  );
}
