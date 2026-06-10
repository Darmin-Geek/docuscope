"use client";

import { useState } from "react";
import { type Folder } from "@/lib/projects";
import FolderTree from "./FolderTree";

type MoveFileModalProps = {
  filename: string;
  folders: Folder[];
  currentFolderId: string | null;
  // Called with the chosen folder id (null = project root) when the user
  // confirms. The caller is responsible for the actual Firestore update.
  onMove: (toFolderId: string | null) => Promise<void>;
  onClose: () => void;
};

export default function MoveFileModal({
  filename,
  folders,
  currentFolderId,
  onMove,
  onClose,
}: MoveFileModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setMoving(true);
    setError(null);
    try {
      await onMove(selectedId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move file.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Move File
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            &times;
          </button>
        </div>

        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Moving{" "}
          <span className="font-medium text-black dark:text-zinc-50">
            {filename}
          </span>
        </p>

        {/* Folder picker — same tree UI as the left sidebar */}
        <div className="mb-4 max-h-64 overflow-y-auto rounded-md border border-black/[.08] dark:border-white/[.145]">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
              selectedId === null
                ? "bg-black/[.06] font-medium text-black dark:bg-white/[.1] dark:text-zinc-50"
                : "text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
            }`}
          >
            Project root
          </button>
          {folders.length > 0 && (
            <div className="border-t border-black/[.08] py-1 dark:border-white/[.145]">
              <FolderTree
                folders={folders}
                selectedId={selectedId}
                onFolderClick={setSelectedId}
              />
            </div>
          )}
        </div>

        {error && (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 flex-1 items-center justify-center rounded-full border border-solid border-black/[.08] text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={moving}
            className="flex h-10 flex-1 items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {moving ? "Moving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
