"use client";

import { useEffect, useState } from "react";
import {
  getFiles,
  getInformationList,
  type FileDoc,
  type Information,
} from "@/lib/projects";
import FolderTree from "./FolderTree";

type AddRelationshipModalProps = {
  projectId: string;
  sourceFileId: string;
  sourceInfoId: string;
  type: "corroborates" | "conflicts";
  onClose: () => void;
  onConfirm: (targetFileId: string, targetInfoId: string) => Promise<void>;
};

export default function AddRelationshipModal({
  projectId,
  sourceFileId,
  sourceInfoId,
  type,
  onClose,
  onConfirm,
}: AddRelationshipModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [infoItems, setInfoItems] = useState<Information[]>([]);
  const [selectedInfoId, setSelectedInfoId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getFiles(projectId, selectedFolderId)
      .then((result) => {
        if (!active) return;
        setFiles(result);
        setSelectedFileId(null);
        setSelectedInfoId(null);
      })
      .catch(() => {
        if (active) setFiles([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, selectedFolderId]);

  useEffect(() => {
    if (!selectedFileId) {
      setInfoItems([]);
      setSelectedInfoId(null);
      return;
    }
    let active = true;
    getInformationList(projectId, selectedFileId)
      .then((result) => {
        if (!active) return;
        const filtered = result.filter(
          (item) =>
            !(selectedFileId === sourceFileId && item.id === sourceInfoId),
        );
        setInfoItems(filtered);
        setSelectedInfoId(null);
      })
      .catch(() => {
        if (active) setInfoItems([]);
      });
    return () => {
      active = false;
    };
  }, [projectId, selectedFileId, sourceFileId, sourceInfoId]);

  async function handleConfirm() {
    if (!selectedFileId || !selectedInfoId) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(selectedFileId, selectedInfoId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const selectedInfo =
    infoItems.find((item) => item.id === selectedInfoId) ?? null;
  const heading =
    type === "corroborates"
      ? "Add corroborating information"
      : "Add conflicting information";

  const itemClass = (isSelected: boolean) =>
    `flex w-full items-start rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
      isSelected
        ? "bg-black/[.06] font-medium text-black dark:bg-white/[.1] dark:text-zinc-50"
        : "text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[32rem] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            ✕
          </button>
        </div>

        {/* Three panels */}
        <div className="flex min-h-0 flex-1 divide-x divide-black/[.08] overflow-hidden dark:divide-white/[.145]">
          {/* Folders */}
          <div className="flex w-1/3 flex-col overflow-hidden">
            <p className="shrink-0 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Folders
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <FolderTree
                projectId={projectId}
                selectedId={selectedFolderId}
                onSelectChange={setSelectedFolderId}
              />
            </div>
          </div>

          {/* Files */}
          <div className="flex w-1/3 flex-col overflow-hidden">
            <p className="shrink-0 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Files
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {files.length === 0 ? (
                <p className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  No files.
                </p>
              ) : (
                files.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedFileId(file.id)}
                    className={itemClass(file.id === selectedFileId)}
                  >
                    <span className="truncate">{file.filename}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Information */}
          <div className="flex w-1/3 flex-col overflow-hidden">
            <p className="shrink-0 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Information
            </p>
            {!selectedFileId ? (
              <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                Select a file.
              </p>
            ) : infoItems.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                No information entries.
              </p>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {infoItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedInfoId(item.id)}
                      className={itemClass(item.id === selectedInfoId)}
                    >
                      <span className="truncate">
                        {item.informationTitle || "Untitled"}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedInfo && (
                  <div className="shrink-0 border-t border-black/[.08] p-3 dark:border-white/[.145]">
                    <p className="line-clamp-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {selectedInfo.informationText ?? "(No text)"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {error && (
          <p className="px-6 pt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t border-black/[.08] px-6 py-4 dark:border-white/[.145]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-10 items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium text-black transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!selectedInfoId || submitting}
            className="flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Confirming…" : "Confirm relationship"}
          </button>
        </div>
      </div>
    </div>
  );
}
