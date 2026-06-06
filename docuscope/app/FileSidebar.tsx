"use client";

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  getFileDownloadUrl,
  updateFileMetadata,
  addLabelToFile,
  removeLabelFromFile,
  subscribeToFile,
  type FileDoc,
  type Label,
} from "@/lib/projects";
import type { FileLock } from "./useFileLock";
import LabelPill from "./LabelPill";

type FileSidebarProps = {
  projectId: string;
  file: FileDoc;
  // Every label defined on the project, used to resolve the file's label ids
  // and to offer the ones not yet applied.
  labels: Label[];
  // The file's shared check-out lock, coordinated with the information sidebar
  // so editing either side checks the whole file out (see useFileLock).
  lock: FileLock;
  // Opens the information sidebar to the left of this one.
  onOpenInformation: () => void;
  onClose: () => void;
  // Called after a successful save so the parent can refresh its file list.
  onSaved: (updated: FileDoc) => void;
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

type PreviewKind = "image" | "pdf" | "unsupported";

function previewKind(filename: string): PreviewKind {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  return "unsupported";
}

// `createdDate` is a unix timestamp in seconds (see docs/dataModel.md); the
// <input type="date"> wants a local "YYYY-MM-DD" string. These convert between
// the two, treating the timestamp as a calendar day in the viewer's timezone.
function timestampToDateInput(createdDate: number | null): string {
  if (createdDate == null) return "";
  const date = new Date(createdDate * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToTimestamp(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

export default function FileSidebar({
  projectId,
  file,
  labels,
  lock,
  onOpenInformation,
  onClose,
  onSaved,
}: FileSidebarProps) {
  const [author, setAuthor] = useState(file.author ?? "");
  const [dateValue, setDateValue] = useState(
    timestampToDateInput(file.createdDate),
  );
  const [overallBias, setOverallBias] = useState(file.overallBias ?? "");
  const [source, setSource] = useState(file.source ?? "");
  const [reliability, setReliability] = useState(file.fileReliability ?? "");
  const [credibility, setCredibility] = useState(file.fileCredibility ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The shared lock state (who, if anyone else, currently holds the file).
  const { lockedByOther, editorName } = lock;

  // Whether *we* are currently editing these file-detail fields (between
  // focusing a field and focus leaving the group). A ref so the live
  // subscription can avoid overwriting our in-progress edits.
  const editingFields = useRef(false);

  // Whether the "add label" picker (the unassigned labels) is showing.
  const [pickingLabel, setPickingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  const kind = previewKind(file.filename);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Resolve the file's label ids against the project's labels, preserving the
  // project's label order. Ids without a matching label (e.g. deleted) drop out.
  const appliedLabels = labels.filter((label) => file.labels.includes(label.id));
  const availableLabels = labels.filter(
    (label) => !file.labels.includes(label.id),
  );

  async function handleAddLabel(labelId: string) {
    setLabelError(null);
    setPickingLabel(false);
    try {
      await addLabelToFile(projectId, file.id, labelId);
      onSaved({ ...file, labels: [...file.labels, labelId] });
    } catch (err: unknown) {
      setLabelError(err instanceof Error ? err.message : "Failed to add label.");
    }
  }

  async function handleRemoveLabel(labelId: string) {
    setLabelError(null);
    try {
      await removeLabelFromFile(projectId, file.id, labelId);
      onSaved({
        ...file,
        labels: file.labels.filter((id) => id !== labelId),
      });
    } catch (err: unknown) {
      setLabelError(
        err instanceof Error ? err.message : "Failed to remove label.",
      );
    }
  }

  // Fetch a download URL for previewable files. The component is remounted per
  // file (keyed by id in the parent), so the URL state starts fresh each time;
  // the active guard just discards a response that resolves after unmount.
  useEffect(() => {
    if (kind === "unsupported") return;
    let active = true;
    getFileDownloadUrl(file.storageReference)
      .then((url) => {
        if (active) setPreviewUrl(url);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPreviewError(
          err instanceof Error ? err.message : "Failed to load preview.",
        );
      });
    return () => {
      active = false;
    };
  }, [file.storageReference, kind]);

  // Subscribe to the file so the text another editor leaves behind shows up
  // here live. We only adopt the saved values into the form when we aren't
  // mid-edit ourselves, so this both mirrors another editor's changes and
  // refreshes the fields the moment they release the lock.
  useEffect(() => {
    const unsubscribe = subscribeToFile(projectId, file.id, (live) => {
      if (!editingFields.current) {
        setAuthor(live.author ?? "");
        setDateValue(timestampToDateInput(live.createdDate));
        setOverallBias(live.overallBias ?? "");
        setSource(live.source ?? "");
        setReliability(live.fileReliability ?? "");
        setCredibility(live.fileCredibility ?? "");
      }
    });
    return unsubscribe;
  }, [projectId, file.id]);

  // If another user grabs the lock (e.g. we lost a claim race), stop guarding
  // the fields so the incoming snapshot can replace whatever we had typed.
  useEffect(() => {
    if (lockedByOther) editingFields.current = false;
  }, [lockedByOther]);

  // Claim the lock the first time the user focuses a field. Skipped when
  // someone else holds it (their fields are disabled, so this can't fire) or
  // when we are already editing.
  function claimLock() {
    if (editingFields.current || lockedByOther) return;
    editingFields.current = true;
    lock.acquire();
  }

  // The "open information view" button sits inside the field group for layout
  // only; focusing or clicking it must not check the file out.
  function handleGroupFocus(event: FocusEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).dataset.noLock != null) return;
    claimLock();
  }

  // Release the lock once focus leaves the whole field group. `handleGroupBlur`
  // first saves the edit, so the latest text is in Firestore before the lock
  // frees and other users' screens update.
  function releaseLock() {
    if (!editingFields.current) return;
    editingFields.current = false;
    lock.release();
  }

  function handleGroupBlur(event: FocusEvent<HTMLDivElement>) {
    // Ignore blurs that just move focus between fields within the group.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void handleSave();
    releaseLock();
  }

  // Trim and collapse a blank field to null so cleared values are stored as
  // "unset" rather than an empty string (see docs/dataModel.md).
  function trimmedOrNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const metadata = {
      author: trimmedOrNull(author),
      createdDate: dateInputToTimestamp(dateValue),
      overallBias: trimmedOrNull(overallBias),
      source: trimmedOrNull(source),
      fileReliability: trimmedOrNull(reliability),
      fileCredibility: trimmedOrNull(credibility),
    };
    try {
      await updateFileMetadata(projectId, file.id, metadata);
      onSaved({ ...file, ...metadata });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  // Enter submits from any single-line input. The paragraph textareas keep Enter
  // for newlines and instead submit when they lose focus (see onBlur below).
  function handleInputKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSave();
    }
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-black/[.08] bg-zinc-50 dark:border-white/[.145] dark:bg-black">
      <header className="flex items-start justify-between gap-2 border-b border-black/[.08] p-4 dark:border-white/[.145]">
        <h2
          className="min-w-0 break-words text-lg font-semibold text-black dark:text-zinc-50"
          title={file.filename}
        >
          {file.filename}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {lockedByOther && (
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {`${editorName ?? "Another user"} is currently editing these fields. They'll unlock when that user is done.`}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-black dark:text-zinc-50">
            Labels
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {appliedLabels.map((label) => (
              <LabelPill key={label.id} label={label.label} color={label.color}>
                <button
                  type="button"
                  onClick={() => void handleRemoveLabel(label.id)}
                  disabled={lockedByOther}
                  aria-label={`Remove ${label.label}`}
                  className="leading-none opacity-70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40"
                >
                  ×
                </button>
              </LabelPill>
            ))}
            {availableLabels.length > 0 && (
              <button
                type="button"
                onClick={() => setPickingLabel((open) => !open)}
                disabled={lockedByOther}
                className="rounded-full border border-dashed border-black/[.25] px-2 py-0.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/[.25] dark:text-zinc-300 dark:hover:bg-white/[.06]"
              >
                + Label
              </button>
            )}
          </div>
          {pickingLabel && availableLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-black/[.08] p-2 dark:border-white/[.145]">
              {availableLabels.map((label) => (
                <LabelPill
                  key={label.id}
                  label={label.label}
                  color={label.color}
                  onClick={() => void handleAddLabel(label.id)}
                />
              ))}
            </div>
          )}
          {labelError && (
            <p className="text-xs text-red-600 dark:text-red-400">{labelError}</p>
          )}
        </div>

        {/* The text-entry fields share one focus/blur boundary: focusing any of
            them checks the file out to this user, and focus leaving the whole
            group saves and checks it back in. While another user holds the lock
            every field is disabled and greyed out. */}
        <div className="contents" onFocus={handleGroupFocus} onBlur={handleGroupBlur}>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-black dark:text-zinc-50">
              Author
            </span>
            <input
              type="text"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={lockedByOther}
              placeholder="Unknown"
              className="h-7 min-w-0 flex-1 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-black dark:text-zinc-50">
              Date Created
            </span>
            <input
              type="date"
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={lockedByOther}
              className="h-7 min-w-0 flex-1 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4] dark:[color-scheme:dark]"
            />
          </label>

          <button
            type="button"
            data-no-lock="true"
            onClick={onOpenInformation}
            className="flex h-8 items-center justify-center rounded-md border border-black/[.08] bg-transparent text-xs font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.06]"
          >
            Open information view
          </button>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-black dark:text-zinc-50">
              Overall Bias
            </span>
            <textarea
              value={overallBias}
              onChange={(event) => setOverallBias(event.target.value)}
              disabled={lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-black dark:text-zinc-50">
              Source
            </span>
            <textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              disabled={lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-black dark:text-zinc-50">
              Reliability
            </span>
            <textarea
              value={reliability}
              onChange={(event) => setReliability(event.target.value)}
              disabled={lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-black dark:text-zinc-50">
              Credibility
            </span>
            <textarea
              value={credibility}
              onChange={(event) => setCredibility(event.target.value)}
              disabled={lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>
        </div>

        {saving && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Saving…</p>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-2 flex flex-1 flex-col gap-2 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
          <span className="text-sm font-medium text-black dark:text-zinc-50">
            Preview
          </span>
          {kind === "unsupported" ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Preview not implemented yet
            </p>
          ) : previewError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {previewError}
            </p>
          ) : !previewUrl ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Loading preview…
            </p>
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={file.filename}
              className="max-w-full rounded-md border border-black/[.08] dark:border-white/[.145]"
            />
          ) : (
            <iframe
              src={previewUrl}
              title={file.filename}
              className="h-96 w-full rounded-md border border-black/[.08] dark:border-white/[.145]"
            />
          )}
        </div>
      </div>
    </aside>
  );
}
