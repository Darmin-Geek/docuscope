"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getFolders,
  createFolder,
  type Folder,
  type Label,
} from "@/lib/projects";
import CreateFolderModal from "./CreateFolderModal";
import FolderTree from "./FolderTree";
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

  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
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
        <label
          className="flex h-9 cursor-pointer items-center justify-center rounded-full border border-solid border-black/[.08] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          aria-disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload File"}
          <input
            type="file"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>
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
          <FolderTree
            folders={folders}
            selectedId={selectedId}
            onFolderClick={onSelectChange}
          />
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
