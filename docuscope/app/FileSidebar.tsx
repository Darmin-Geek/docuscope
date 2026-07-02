"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  getFileDownloadUrl,
  addLabelToFile,
  removeLabelFromFile,
  getFolders,
  getFolderFileIds,
  moveFile,
  checkOcrStatus,
  ocrFile,
  getFileHistory,
  type FileDoc,
  type Folder,
  type Label,
} from "@/lib/projects";
import { useFieldHistory } from "./useFieldHistory";
import FieldHistoryButton from "./FieldHistoryButton";
import {
  findFolderContainingFile,
} from "@/lib/folderTree";
import type { FileLock } from "./useFileLock";
import type { FileDraft } from "./useFileDraft";
import LabelPill from "./LabelPill";
import MoveFileModal from "./MoveFileModal";
import DraftConflictModal from "./DraftConflictModal";
import AdmiraltyCodeSelect from "./AdmiraltyCodeSelect";

type FileSidebarProps = {
  projectId: string;
  file: FileDoc;
  // Every label defined on the project, used to resolve the file's label ids
  // and to offer the ones not yet applied.
  labels: Label[];
  // The file's shared check-out lock, coordinated with the information sidebar
  // so editing either side checks the whole file out (see useFileLock).
  lock: FileLock;
  // The shared working draft for this file (metadata + information +
  // selections). Save stages it; Submit publishes it (see useFileDraft).
  draft: FileDraft;
  // Called after a successful Submit so the parent can refresh its file list to
  // show the now-published metadata.
  onSubmitted: () => void;
  // Opens the information sidebar to the left of this one.
  onOpenInformation: () => void;
  // Opens the embedded PDF viewer modal (only rendered for PDF files).
  onOpenPdfViewer: () => void;
  onClose: () => void;
  // Called after a successful save so the parent can refresh its file list.
  onSaved: (updated: FileDoc) => void;
  // Called after the file is moved to a different folder so the parent can
  // reload its file list (the file may now belong to a different folder than the
  // one being viewed).
  onMoved: () => void;
  // Called after a label is added to / removed from this file. Unlike onSaved,
  // this hands back a mutator so the parent can apply the change against the
  // freshest file state: adding two labels in quick succession must not lose the
  // first one to a stale `file` snapshot captured in this component's closure.
  onLabelsChanged: (fileId: string, nextLabels: (current: string[]) => string[]) => void;
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

// A blank field is stored as "unset" (null) rather than an empty string. The
// raw value is otherwise kept verbatim so the controlled input can hold
// interior/trailing spaces while the user is still typing.
function emptyToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

// Version history stores createdDate as its unix-seconds string; render it as a
// calendar date in the popover rather than the raw number.
function formatDateValue(value: string | null): string {
  if (!value) return "";
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return value;
  return new Date(seconds * 1000).toLocaleDateString();
}

export default function FileSidebar({
  projectId,
  file,
  labels,
  lock,
  draft,
  onSubmitted,
  onOpenInformation,
  onOpenPdfViewer,
  onClose,
  onSaved,
  onMoved,
  onLabelsChanged,
}: FileSidebarProps) {
  // Metadata fields read/write the shared working draft (issue #78) — no local
  // field state and no save-on-blur; only Save/Submit persist anything. The
  // <input>/<textarea> elements want strings, so null is shown as "".
  const meta = draft.snapshot.metadata;
  const author = meta.author ?? "";
  const dateValue = timestampToDateInput(meta.createdDate);
  const overallBias = meta.overallBias ?? "";
  const source = meta.source ?? "";
  const reliability = meta.fileReliability ?? "";
  const credibility = meta.fileCredibility ?? "";
  const reliabilityCode = meta.fileReliabilityCode;
  const credibilityCode = meta.fileCredibilityCode;

  // The shared lock state. `isHeldByMe` is true once this user has explicitly
  // checked the file out via the toolbar button; the detail fields are editable
  // only then. `lockedByOther` means a different user holds it.
  const { lockedByOther, isHeldByMe, editorName } = lock;

  // Single extensible predicate reserved for the future "disable submit until a
  // task is done" feature (issue #78). Default false; nothing feeds it yet.
  const submitLocked = false;

  // Field version history for this file's metadata. Bumped after a successful
  // Submit so the popovers show the edits that were just published.
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const history = useFieldHistory(
    useCallback(() => getFileHistory(projectId, file.id), [projectId, file.id]),
    `${file.id}:${historyReloadToken}`,
  );

  // Draft resolution while the file is checked out by us (issue #78 §4.2).
  // Whenever we hold the file and a stored draft exists, decide once what to do
  // with it:
  //   - no conflict (draft only fills empty fields): silently load the draft.
  //   - conflict (draft would overwrite a filled field): open the modal and let
  //     the user choose "Use my draft" or "Discard my draft".
  // This covers both a fresh check-out and reopening a file we already hold
  // (e.g. after a page reload). `resolved` guards against re-prompting; it
  // resets when the file is no longer held by us so the next check-out re-runs.
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const resolved = useRef(false);
  useEffect(() => {
    if (!isHeldByMe) {
      resolved.current = false;
      return;
    }
    // Wait until the draft has finished loading so hasDraft/conflict are known.
    if (draft.loading || resolved.current) return;
    // Resolve exactly once per checked-out session: applying or prompting only
    // for a draft that already existed when we entered this session. Saves the
    // user makes afterwards (which also set hasDraft) must not re-trigger this.
    resolved.current = true;
    if (!draft.hasDraft) return;
    if (draft.conflictsOnCheckout) {
      setConflictModalOpen(true);
    } else {
      // Nothing being overwritten — just bring the draft into the editor.
      draft.applyDraft();
    }
  }, [isHeldByMe, draft.loading, draft.hasDraft, draft.conflictsOnCheckout, draft]);

  // Whether the "add label" picker (the unassigned labels) is showing.
  const [pickingLabel, setPickingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  // The project's folders (for the "move to folder" picker) and the id of the
  // folder this file currently lives in — null means the project root, undefined
  // means the lookup hasn't resolved yet. Keeping these distinct prevents the
  // no-op guard in handleMove from treating "unknown" as "already at root".
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null | undefined>(undefined);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveModalOpen, setMoveModalOpen] = useState(false);

  const kind = previewKind(file.filename);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Bumped to force the preview to re-fetch when the underlying S3 object is
  // replaced in place (e.g. after OCR), which leaves the storage key unchanged.
  const [previewRefresh, setPreviewRefresh] = useState(0);

  // Whether a download is in flight, used to disable the button so a slow
  // network can't kick off several fetches at once.
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // OCR state for the "OCR this PDF" button.
  const [ocrState, setOcrState] = useState<
    'idle' | 'checking' | 'confirming' | 'running' | 'done' | 'error'
  >('idle');
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Fetch the file's bytes and save them under its original name. We download
  // the blob ourselves rather than linking straight to the storage URL because
  // the `download` attribute is ignored for cross-origin URLs, which would open
  // the file in the browser instead of saving it.
  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const url = await getFileDownloadUrl(projectId, file.id);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to download file.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: unknown) {
      setDownloadError(
        err instanceof Error ? err.message : "Failed to download file.",
      );
    } finally {
      setDownloading(false);
    }
  }

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
      onLabelsChanged(file.id, (current) =>
        current.includes(labelId) ? current : [...current, labelId],
      );
    } catch (err: unknown) {
      setLabelError(err instanceof Error ? err.message : "Failed to add label.");
    }
  }

  async function handleRemoveLabel(labelId: string) {
    setLabelError(null);
    try {
      await removeLabelFromFile(projectId, file.id, labelId);
      onLabelsChanged(file.id, (current) =>
        current.filter((id) => id !== labelId),
      );
    } catch (err: unknown) {
      setLabelError(
        err instanceof Error ? err.message : "Failed to remove label.",
      );
    }
  }

  // Load the project's folders and work out which one currently holds this file
  // so the picker can list every folder and pre-select the file's home. The
  // active guard discards a response that resolves after the sidebar is closed
  // or switched to another file.
  useEffect(() => {
    let active = true;
    Promise.all([getFolders(projectId), getFolderFileIds(projectId)])
      .then(([folderList, folderFileIds]) => {
        if (!active) return;
        setFolders(folderList);
        setCurrentFolderId(findFolderContainingFile(folderFileIds, file.id));
      })
      .catch(() => {
        // The picker just won't offer folders if this fails; not worth an error.
      });
    return () => {
      active = false;
    };
  }, [projectId, file.id]);

  async function handleMove(toFolderId: string | null) {
    if (currentFolderId !== undefined && toFolderId === currentFolderId) return;
    setMoving(true);
    setMoveError(null);
    try {
      await moveFile(projectId, file.id, toFolderId);
      setCurrentFolderId(toFolderId);
      onMoved();
    } catch (err: unknown) {
      setMoveError(err instanceof Error ? err.message : "Failed to move file.");
    } finally {
      setMoving(false);
    }
  }

  async function handleOcrClick() {
    setOcrState('checking');
    setOcrError(null);
    try {
      const { hasChunks, status } = await checkOcrStatus(projectId, file.id);
      if (status === 'pending' || status === 'running') {
        // A job is already in flight (e.g. started before this sidebar opened);
        // just resume polling for it.
        setOcrState('running');
      } else if (hasChunks) {
        setOcrState('confirming');
      } else {
        await runOcr();
      }
    } catch (err: unknown) {
      setOcrError(err instanceof Error ? err.message : 'Failed to check OCR status.');
      setOcrState('error');
    }
  }

  // Enqueue the OCR job. The work runs in the background; the polling effect
  // below drives the UI from 'running' to 'done'/'error'.
  async function runOcr() {
    setOcrState('running');
    setOcrError(null);
    try {
      await ocrFile(projectId, file.id);
    } catch (err: unknown) {
      // A 409 means a job is already active — stay in 'running' and let polling
      // pick it up. Anything else is a real failure.
      if (err instanceof Error && err.message === 'Conflict') return;
      setOcrError(err instanceof Error ? err.message : 'OCR failed.');
      setOcrState('error');
    }
  }

  // Poll job status while an OCR run is in flight. Converges the UI to
  // 'done' (refreshing the preview, whose S3 object was replaced in place) or
  // 'error'. Cleared on unmount or when we leave the 'running' state.
  useEffect(() => {
    if (ocrState !== 'running') return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const { status, error } = await checkOcrStatus(projectId, file.id);
        if (!active) return;
        if (status === 'done') {
          setOcrState('done');
          // Force the preview to reload — the S3 object was replaced in place,
          // so the storage key is unchanged and the fetch effect needs an
          // explicit nudge to request a fresh (cache-busting) signed URL.
          setPreviewUrl(null);
          setPreviewRefresh((n) => n + 1);
        } else if (status === 'error') {
          setOcrError(error ?? 'OCR failed.');
          setOcrState('error');
        }
      } catch (err: unknown) {
        if (!active) return;
        setOcrError(err instanceof Error ? err.message : 'OCR failed.');
        setOcrState('error');
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [ocrState, projectId, file.id]);

  // On open, resume tracking an OCR job that is already running for this PDF
  // (e.g. started in a previous session) so the UI reflects in-flight work.
  useEffect(() => {
    if (kind !== 'pdf') return;
    let active = true;
    checkOcrStatus(projectId, file.id)
      .then(({ status }) => {
        if (active && (status === 'pending' || status === 'running')) {
          setOcrState('running');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, file.id, kind]);

  // Fetch a download URL for previewable files. The component is remounted per
  // file (keyed by id in the parent), so the URL state starts fresh each time;
  // the active guard just discards a response that resolves after unmount.
  useEffect(() => {
    if (kind === "unsupported") return;
    let active = true;
    getFileDownloadUrl(projectId, file.id)
      .then((url) => {
        if (active) {
          setPreviewUrl(url);
          setPreviewError(null); // clear any stale error from a prior load
        }
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
  }, [projectId, file.id, file.storageReference, kind, previewRefresh]);

  // Field edits flow into the shared working draft. Save/Submit (the buttons
  // below) are the only things that persist; blur writes nothing (issue #78).
  function handleSave() {
    void draft.save();
  }

  async function handleSubmit() {
    await draft.submit();
    // Reflect the now-published metadata in the table and the parent list.
    if (!draft.error) {
      onSaved({
        ...file,
        author: draft.snapshot.metadata.author,
        createdDate: draft.snapshot.metadata.createdDate,
        overallBias: draft.snapshot.metadata.overallBias,
        source: draft.snapshot.metadata.source,
        fileReliability: draft.snapshot.metadata.fileReliability,
        fileCredibility: draft.snapshot.metadata.fileCredibility,
        fileReliabilityCode: draft.snapshot.metadata.fileReliabilityCode,
        fileCredibilityCode: draft.snapshot.metadata.fileCredibilityCode,
      });
      onSubmitted();
      // Published edits just landed — refresh the field history popovers.
      setHistoryReloadToken((n) => n + 1);
    }
  }

  // Enter commits a single-line input by triggering Save. The paragraph
  // textareas keep Enter for newlines.
  function handleInputKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSave();
    }
  }

  return (
    <>
    <aside className="flex w-96 shrink-0 flex-col border-l border-black/[.08] bg-zinc-50 dark:border-white/[.145] dark:bg-black">
      <header className="flex items-start justify-between gap-2 border-b border-black/[.08] p-4 dark:border-white/[.145]">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            File Details
          </p>
          <h2
            className="min-w-0 break-words text-lg font-semibold text-black dark:text-zinc-50"
            title={file.filename}
          >
            {file.filename}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Manual check-out: acquire the lock to edit, release it to let other
              contributors in. Disabled (greyed) while another user holds it —
              the amber banner below names who. */}
          <button
            type="button"
            onClick={() => (isHeldByMe ? lock.release() : lock.acquire())}
            disabled={lockedByOther}
            className="flex h-7 items-center justify-center rounded-md border border-black/[.08] px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
          >
            {isHeldByMe ? "Check In" : "Check Out"}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            aria-label="Download file"
            title="Download file"
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMoveModalOpen(true)}
            disabled={moving}
            aria-label="Move file to folder"
            title="Move file to folder"
            className="flex h-7 items-center justify-center rounded-full px-1 text-zinc-500 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/move_folder_icon.svg"
              alt=""
              aria-hidden="true"
              className="h-4 w-auto"
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            ✕
          </button>
        </div>
      </header>
      {downloadError && (
        <p className="border-b border-black/[.08] px-4 py-2 text-xs text-red-600 dark:border-white/[.145] dark:text-red-400">
          {downloadError}
        </p>
      )}

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
                  disabled={!isHeldByMe || lockedByOther}
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
                disabled={!isHeldByMe || lockedByOther}
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

        {moveError && (
          <p className="text-xs text-red-600 dark:text-red-400">{moveError}</p>
        )}

        {/* The text-entry fields write into the shared working draft; nothing
            is persisted until Save/Submit (issue #78). Editing requires the
            file to be checked out to this user (the toolbar button); every
            field is disabled and greyed out otherwise. */}
        <div className="contents">
          <label className="flex items-center gap-2">
            <span className="flex w-24 shrink-0 items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
              Author
              <FieldHistoryButton
                fieldLabel="Author"
                versions={history.versionsFor("author")}
              />
            </span>
            <input
              type="text"
              value={author}
              onChange={(event) =>
                draft.setMetadata({ author: emptyToNull(event.target.value) })
              }
              onKeyDown={handleInputKeyDown}
              disabled={!isHeldByMe || lockedByOther}
              placeholder="Unknown"
              className="h-7 min-w-0 flex-1 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="flex w-24 shrink-0 items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
              Date Created
              <FieldHistoryButton
                fieldLabel="Date Created"
                versions={history.versionsFor("createdDate")}
                formatValue={formatDateValue}
              />
            </span>
            <input
              type="date"
              value={dateValue}
              onChange={(event) =>
                draft.setMetadata({
                  createdDate: dateInputToTimestamp(event.target.value),
                })
              }
              onKeyDown={handleInputKeyDown}
              disabled={!isHeldByMe || lockedByOther}
              className="h-7 min-w-0 flex-1 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4] dark:[color-scheme:dark]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
              Source
              <FieldHistoryButton
                fieldLabel="Source"
                versions={history.versionsFor("source")}
              />
            </span>
            <textarea
              value={source}
              onChange={(event) =>
                draft.setMetadata({ source: emptyToNull(event.target.value) })
              }
              disabled={!isHeldByMe || lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
              Overall Bias
              <FieldHistoryButton
                fieldLabel="Overall Bias"
                versions={history.versionsFor("overallBias")}
              />
            </span>
            <textarea
              value={overallBias}
              onChange={(event) =>
                draft.setMetadata({ overallBias: emptyToNull(event.target.value) })
              }
              disabled={!isHeldByMe || lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <AdmiraltyCodeSelect
            label="Reliability Rating"
            kind="reliability"
            value={reliabilityCode}
            onChange={(code) => draft.setMetadata({ fileReliabilityCode: code })}
            disabled={!isHeldByMe || lockedByOther}
            labelAccessory={
              <FieldHistoryButton
                fieldLabel="Reliability Rating"
                versions={history.versionsFor("fileReliabilityCode")}
              />
            }
          />

          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
              Overall Reliability
              <FieldHistoryButton
                fieldLabel="Overall Reliability"
                versions={history.versionsFor("fileReliability")}
              />
            </span>
            <textarea
              value={reliability}
              onChange={(event) =>
                draft.setMetadata({
                  fileReliability: emptyToNull(event.target.value),
                })
              }
              disabled={!isHeldByMe || lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          <AdmiraltyCodeSelect
            label="Credibility Rating"
            kind="credibility"
            value={credibilityCode}
            onChange={(code) => draft.setMetadata({ fileCredibilityCode: code })}
            disabled={!isHeldByMe || lockedByOther}
            labelAccessory={
              <FieldHistoryButton
                fieldLabel="Credibility Rating"
                versions={history.versionsFor("fileCredibilityCode")}
              />
            }
          />

          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
              Overall Credibility
              <FieldHistoryButton
                fieldLabel="Overall Credibility"
                versions={history.versionsFor("fileCredibility")}
              />
            </span>
            <textarea
              value={credibility}
              onChange={(event) =>
                draft.setMetadata({
                  fileCredibility: emptyToNull(event.target.value),
                })
              }
              disabled={!isHeldByMe || lockedByOther}
              rows={3}
              className="resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
            />
          </label>

          {/* Save stages the working draft; Submit publishes it to the main
              tables and clears the draft. Both require holding the check-out
              (issue #78). Submit also respects submitLocked, the extensible
              flag reserved for the future "task in progress" feature, and is
              blocked while an Admiralty rating lacks its description (#80). */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!isHeldByMe || lockedByOther || draft.saving}
              className="flex h-9 flex-1 items-center justify-center rounded-md border border-black/[.08] text-sm font-medium text-zinc-700 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
            >
              {draft.saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={
                !isHeldByMe ||
                lockedByOther ||
                draft.submitting ||
                submitLocked ||
                draft.submitBlockReason != null
              }
              title={draft.submitBlockReason ?? undefined}
              className="flex h-9 flex-1 items-center justify-center rounded-md bg-black text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draft.submitting ? "Submitting…" : "Submit"}
            </button>
          </div>

          {/* Explain why Submit is disabled when an Admiralty rating is missing
              its description; only shown to the check-out holder (#80). */}
          {isHeldByMe && !lockedByOther && draft.submitBlockReason && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {draft.submitBlockReason}
            </p>
          )}

          <button
            type="button"
            data-no-lock="true"
            onClick={onOpenInformation}
            className="flex h-9 items-center justify-center rounded-md bg-black text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Open information view
          </button>
        </div>

        {draft.hasDraft && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Unsaved draft
          </p>
        )}
        {draft.status === "saved" && (
          <p className="text-xs text-green-600 dark:text-green-400">Saved.</p>
        )}
        {draft.status === "submitted" && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Submitted.
          </p>
        )}
        {draft.error && (
          <p className="text-xs text-red-600 dark:text-red-400">{draft.error}</p>
        )}

        <div className="mt-2 flex flex-1 flex-col gap-2 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-black dark:text-zinc-50">
              Preview
            </span>
            {kind === "pdf" && (
              <div className="flex items-center gap-2">
                {ocrState === "confirming" ? (
                  <div className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-300">
                    <p>This PDF already has extracted text. Running OCR will replace it.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={runOcr}
                        className="flex h-7 items-center justify-center rounded-md border border-black/[.08] px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => setOcrState("idle")}
                        className="flex h-7 items-center justify-center rounded-md border border-black/[.08] px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleOcrClick}
                    disabled={ocrState === "checking" || ocrState === "running"}
                    className="flex h-7 items-center justify-center rounded-md border border-black/[.08] px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                  >
                    {ocrState === "checking"
                      ? "Checking…"
                      : ocrState === "running"
                      ? "Running OCR…"
                      : "OCR this PDF"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenPdfViewer}
                  className="flex h-7 items-center justify-center rounded-md border border-black/[.08] px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                >
                  Open PDF viewer
                </button>
              </div>
            )}
          </div>

          {ocrState === "done" && (
            <p className="text-xs text-green-600 dark:text-green-400">OCR complete.</p>
          )}
          {ocrState === "error" && ocrError && (
            <p className="text-xs text-red-600 dark:text-red-400">{ocrError}</p>
          )}

          {kind === "unsupported" ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Preview not implemented yet for this file type
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

    {moveModalOpen && (
      <MoveFileModal
        filename={file.filename}
        folders={folders}
        currentFolderId={currentFolderId ?? null}
        onMove={handleMove}
        onClose={() => setMoveModalOpen(false)}
      />
    )}

    {conflictModalOpen && (
      <DraftConflictModal
        onUseDraft={() => {
          draft.applyDraft();
          setConflictModalOpen(false);
        }}
        onDiscardDraft={async () => {
          await draft.discardDraft();
          setConflictModalOpen(false);
        }}
        onClose={() => setConflictModalOpen(false)}
      />
    )}
    </>
  );
}
