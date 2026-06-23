"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  addInformation,
  addLabelToInformation,
  deleteInformation,
  getInformation,
  newInformationId,
  removeLabelFromInformation,
  updateInformation,
  type FileDoc,
  type Information,
  type Label,
} from "@/lib/projects";
import type { FileLock } from "./useFileLock";
import DeleteInformationModal from "./DeleteInformationModal";
import LabelPill from "./LabelPill";

type InformationSidebarProps = {
  projectId: string;
  file: FileDoc;
  // The project's 'information'-kind labels, used to assign labels to individual
  // pieces of information (see issue #75).
  labels: Label[];
  // The file's shared check-out lock. Editing information here checks the whole
  // file out, which blocks other contributors from the file details too, and a
  // detail edit elsewhere likewise greys these fields out (see useFileLock).
  lock: FileLock;
  // Whether this file can be opened in the embedded PDF viewer (PDFs only).
  canOpenPdf: boolean;
  // Opens the PDF viewer with the given information made active, scrolled to its
  // first selection.
  onOpenPdfViewer: (informationId: string) => void;
  onClose: () => void;
  // Layout variant. "overlay" (default) renders the absolutely-positioned
  // sidebar used in ProjectView; "embedded" renders a plain full-height column
  // (no absolute positioning, no shadow, no header close button) so it can sit
  // as the left panel inside the PDF viewer modal.
  variant?: "overlay" | "embedded";
  // Preselect an entry on mount (used by the PDF viewer to open the item the
  // user came in on). Applied once.
  initialSelectedId?: string | null;
  // Reports the currently-selected entry id to the parent so it can keep its own
  // "active information" in sync (the PDF viewer marks selections against it).
  onSelectedIdChange?: (id: string | null) => void;
};

// Trim and collapse a blank field to null so cleared values are stored as
// "unset" rather than an empty string (mirrors FileSidebar / docs/dataModel.md).
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function InformationSidebar({
  projectId,
  file,
  labels,
  lock,
  canOpenPdf,
  onOpenPdfViewer,
  onClose,
  variant = "overlay",
  initialSelectedId = null,
  onSelectedIdChange,
}: InformationSidebarProps) {
  const { lockedByOther, isHeldByMe, editorName } = lock;
  const embedded = variant === "embedded";

  const [items, setItems] = useState<Information[]>([]);
  // Entries created locally that the server hasn't confirmed yet.
  // They let a new entry appear in the list and open for editing immediately,
  // without waiting for the POST response to come back.
  const [pending, setPending] = useState<Information[]>([]);

  // The list shown in the UI: live entries plus any pending creates not yet
  // present in the live data. Built through a Map keyed by id so every entry is
  // unique — an optimistic create and its echoed-back live copy share an id, so
  // this guarantees React never sees duplicate keys while they briefly coexist.
  const allItems = useMemo(() => {
    const byId = new Map<string, Information>();
    for (const entry of items) byId.set(entry.id, entry);
    for (const entry of pending) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    return [...byId.values()];
  }, [items, pending]);

  // The entry open in the editor; `selectedId` names the existing entry being
  // edited. With nothing selected (or when the selected entry has been deleted),
  // only the title list (top third) is shown. New entries are created up front
  // so they appear in the list immediately, so there is no unsaved-draft state.
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const selectedItem =
    selectedId != null
      ? allItems.find((entry) => entry.id === selectedId) ?? null
      : null;
  const editorOpen = selectedItem !== null;

  // Report the selected entry to the parent (the PDF viewer tracks it as the
  // active information for marking selections). No-op when no callback is given.
  const onSelectedIdChangeRef = useRef(onSelectedIdChange);
  useEffect(() => {
    onSelectedIdChangeRef.current = onSelectedIdChange;
  });
  useEffect(() => {
    onSelectedIdChangeRef.current?.(selectedId);
  }, [selectedId]);

  // The editor's fields. Title is always a plain string; the rest are paragraph
  // text areas, stored null when blank (see docs/dataModel.md).
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [bias, setBias] = useState("");
  const [reliability, setReliability] = useState("");
  const [credibility, setCredibility] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether the "add label" picker (the unassigned information labels) is open,
  // plus any error from assigning/removing a label.
  const [pickingLabel, setPickingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  // The entry awaiting delete confirmation, or null when the modal is closed.
  const [deleteTarget, setDeleteTarget] = useState<Information | null>(null);

  // Whether *we* are mid-edit in the form, so the live subscription doesn't
  // overwrite in-progress text (mirrors FileSidebar's editingFields guard).
  const editingInfo = useRef(false);

  // Fetch the current list and merge it with any pending optimistic creates.
  const refreshItems = useCallback(() => {
    return getInformation(projectId, file.id).then((live) => {
      setItems(live);
      setPending((prev) =>
        prev.filter((entry) => !live.some((entry2) => entry2.id === entry.id)),
      );
    });
  }, [projectId, file.id]);

  // Load the list on mount and whenever the file changes.
  useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  // Load the selected entry's saved values into the form. Skipped while we are
  // editing (so we don't clobber typing). If the open entry disappears (deleted
  // by another user) `selectedItem` becomes null, which closes the editor on its
  // own.
  useEffect(() => {
    if (selectedItem == null || editingInfo.current) return;
    setTitle(selectedItem.informationTitle);
    setText(selectedItem.informationText ?? "");
    setBias(selectedItem.overallBias ?? "");
    setReliability(selectedItem.informationReliability ?? "");
    setCredibility(selectedItem.informationCredibility ?? "");
  }, [selectedItem]);

  // If another user grabs the lock, stop guarding the fields so the live values
  // replace whatever we had typed and the disabled inputs show the truth.
  useEffect(() => {
    if (lockedByOther) editingInfo.current = false;
  }, [lockedByOther]);

  function openEntry(item: Information) {
    setError(null);
    setSelectedId(item.id);
  }

  // Create a blank entry and open it for editing right away. The entry is added
  // to `pending` so it appears in the list and the editor opens immediately.
  // Once the API call resolves, refreshItems replaces the pending entry with
  // the server copy.
  function startNew() {
    setError(null);
    const id = newInformationId(projectId, file.id);
    const draft: Information = {
      id,
      informationTitle: "",
      informationText: null,
      overallBias: null,
      informationReliability: null,
      informationCredibility: null,
      labels: [],
    };
    setPending((prev) => [...prev, draft]);
    setSelectedId(id);
    addInformation(projectId, file.id, {
      informationTitle: draft.informationTitle,
      informationText: draft.informationText,
      overallBias: draft.overallBias,
      informationReliability: draft.informationReliability,
      informationCredibility: draft.informationCredibility,
    }, id)
      .then(() => refreshItems())
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Failed to add information.",
        );
      });
  }

  // Check-out is now manual (the File Details toolbar button), so editing here no
  // longer acquires or releases the lock. Closing while a field is focused can't
  // rely on the editor's blur firing (the inputs unmount), so save here first.
  function handleClose() {
    if (isHeldByMe) {
      void handleSave();
    }
    onClose();
  }

  function handleGroupBlur(event: FocusEvent<HTMLDivElement>) {
    // Ignore blurs that just move focus between fields within the group.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void handleSave();
  }

  async function handleSave() {
    if (!selectedId) return;
    const fields = {
      informationTitle: title.trim(),
      informationText: trimmedOrNull(text),
      overallBias: trimmedOrNull(bias),
      informationReliability: trimmedOrNull(reliability),
      informationCredibility: trimmedOrNull(credibility),
    };

    setSaving(true);
    setError(null);
    try {
      await updateInformation(projectId, file.id, selectedId, fields);
      await refreshItems();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  // Enter submits from the single-line title input; the paragraph textareas keep
  // Enter for newlines and instead save on blur.
  function handleTitleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSave();
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    await deleteInformation(projectId, file.id, deleteTarget.id);
    if (selectedId === deleteTarget.id) {
      setSelectedId(null);
    }
    setDeleteTarget(null);
    await refreshItems();
  }

  // Apply a label add/remove to a piece of information in both the live and
  // pending lists, so the change shows immediately regardless of which list the
  // entry currently lives in.
  function applyLabelChange(
    infoId: string,
    next: (current: string[]) => string[],
  ) {
    const update = (entry: Information) =>
      entry.id === infoId ? { ...entry, labels: next(entry.labels) } : entry;
    setItems((prev) => prev.map(update));
    setPending((prev) => prev.map(update));
  }

  async function handleAddLabel(labelId: string) {
    if (!selectedId) return;
    setLabelError(null);
    setPickingLabel(false);
    applyLabelChange(selectedId, (current) =>
      current.includes(labelId) ? current : [...current, labelId],
    );
    try {
      await addLabelToInformation(projectId, file.id, selectedId, labelId);
    } catch (err: unknown) {
      applyLabelChange(selectedId, (current) =>
        current.filter((id) => id !== labelId),
      );
      setLabelError(err instanceof Error ? err.message : "Failed to add label.");
    }
  }

  async function handleRemoveLabel(labelId: string) {
    if (!selectedId) return;
    setLabelError(null);
    applyLabelChange(selectedId, (current) =>
      current.filter((id) => id !== labelId),
    );
    try {
      await removeLabelFromInformation(projectId, file.id, selectedId, labelId);
    } catch (err: unknown) {
      applyLabelChange(selectedId, (current) =>
        current.includes(labelId) ? current : [...current, labelId],
      );
      setLabelError(
        err instanceof Error ? err.message : "Failed to remove label.",
      );
    }
  }

  // Resolve the selected entry's label ids against the project's information
  // labels, preserving the project's order; the rest are offered in the picker.
  const appliedLabels = labels.filter((label) =>
    selectedItem?.labels.includes(label.id),
  );
  const availableLabels = labels.filter(
    (label) => !selectedItem?.labels.includes(label.id),
  );

  const fieldClass =
    "resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]";

  return (
    <aside
      className={
        embedded
          ? // Embedded in the PDF viewer modal: a plain full-height left column.
            "flex h-full w-[28rem] shrink-0 flex-col border-r border-black/[.08] bg-zinc-50 dark:border-white/[.145] dark:bg-black"
          : // Overlay used in ProjectView: absolutely positioned over the table.
            "absolute inset-y-0 right-96 z-10 flex w-[28rem] flex-col border-l border-r border-black/[.08] bg-zinc-50 shadow-xl dark:border-white/[.145] dark:bg-black"
      }
    >
      <header className="flex items-start justify-between gap-2 border-b border-black/[.08] p-4 dark:border-white/[.145]">
        <h2 className="min-w-0 break-words text-lg font-semibold text-black dark:text-zinc-50">
          Information
        </h2>
        {/* The modal supplies its own close control, so the header close button
            is only shown in the overlay variant. */}
        {!embedded && (
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close information view"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            ✕
          </button>
        )}
      </header>

      {lockedByOther && (
        <div
          role="status"
          className="m-4 mb-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {`${editorName ?? "Another user"} is currently editing this file. The information will unlock when that user is done.`}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Top third: the list of information titles plus the add button. */}
        <div
          className={`flex min-h-0 flex-col ${editorOpen ? "basis-1/3" : "flex-1"}`}
        >
          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {allItems.length === 0 ? (
              <li className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                No information yet.
              </li>
            ) : (
              allItems.map((item) => (
                <li key={item.id}>
                  <div
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${item.id === selectedId
                        ? "bg-black/[.06] dark:bg-white/[.08]"
                        : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                      }`}
                  >
                    <button
                      type="button"
                      onClick={() => openEntry(item)}
                      className="min-w-0 flex-1 truncate text-left text-xs text-black dark:text-zinc-50"
                      title={item.informationTitle || "Untitled"}
                    >
                      {item.informationTitle || "Untitled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      disabled={!isHeldByMe || lockedByOther}
                      aria-label={`Delete ${item.informationTitle || "Untitled"}`}
                      className="shrink-0 leading-none text-zinc-400 transition-colors hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-zinc-400 dark:text-zinc-500 dark:hover:text-zinc-300"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-black/[.08] p-2 dark:border-white/[.145]">
            <button
              type="button"
              onClick={startNew}
              disabled={!isHeldByMe || lockedByOther}
              className="flex h-8 w-full items-center justify-center rounded-md border border-dashed border-black/[.25] text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/[.25] dark:text-zinc-300 dark:hover:bg-white/[.06]"
            >
              + Add New Information
            </button>
          </div>
        </div>

        {/* Bottom two-thirds: the editor for the selected/new entry. */}
        {editorOpen && (
          <div className="flex min-h-0 basis-2/3 flex-col gap-3 overflow-y-auto border-t border-black/[.08] p-4 dark:border-white/[.145]">
            {canOpenPdf && selectedItem && (
              <button
                type="button"
                onClick={() => onOpenPdfViewer(selectedItem.id)}
                className="flex h-8 items-center justify-center rounded-md border border-black/[.08] text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
              >
                Open in PDF viewer
              </button>
            )}
            <div
              className="flex flex-col gap-3"
              onBlur={handleGroupBlur}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-black dark:text-zinc-50">
                  Title
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  disabled={!isHeldByMe || lockedByOther}
                  placeholder="Untitled"
                  className="h-7 min-w-0 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
                />
              </label>

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

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-black dark:text-zinc-50">
                  Information Text
                </span>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  disabled={!isHeldByMe || lockedByOther}
                  rows={4}
                  className={fieldClass}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-black dark:text-zinc-50">
                  Overall Bias
                </span>
                <textarea
                  value={bias}
                  onChange={(event) => setBias(event.target.value)}
                  disabled={!isHeldByMe || lockedByOther}
                  rows={3}
                  className={fieldClass}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-black dark:text-zinc-50">
                  Information Reliability
                </span>
                <textarea
                  value={reliability}
                  onChange={(event) => setReliability(event.target.value)}
                  disabled={!isHeldByMe || lockedByOther}
                  rows={3}
                  className={fieldClass}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-black dark:text-zinc-50">
                  Information Credibility
                </span>
                <textarea
                  value={credibility}
                  onChange={(event) => setCredibility(event.target.value)}
                  disabled={!isHeldByMe || lockedByOther}
                  rows={3}
                  className={fieldClass}
                />
              </label>
            </div>

            {saving && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Saving…</p>
            )}
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteInformationModal
          title={deleteTarget.informationTitle}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </aside>
  );
}
