"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  addInformation,
  deleteInformation,
  newInformationId,
  subscribeToInformation,
  updateInformation,
  type FileDoc,
  type Information,
} from "@/lib/projects";
import type { FileLock } from "./useFileLock";
import DeleteInformationModal from "./DeleteInformationModal";

type InformationSidebarProps = {
  projectId: string;
  file: FileDoc;
  // The file's shared check-out lock. Editing information here checks the whole
  // file out, which blocks other contributors from the file details too, and a
  // detail edit elsewhere likewise greys these fields out (see useFileLock).
  lock: FileLock;
  onClose: () => void;
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
  lock,
  onClose,
}: InformationSidebarProps) {
  const { lockedByOther, editorName } = lock;

  const [items, setItems] = useState<Information[]>([]);
  // Entries created locally that the live subscription hasn't echoed back yet.
  // They let a new entry appear in the list and open for editing immediately,
  // without waiting for Firebase to acknowledge the create.
  const [pending, setPending] = useState<Information[]>([]);

  // The list shown in the UI: live entries plus any pending creates not yet
  // present in the live data (deduped by id, live winning).
  const allItems = useMemo(() => {
    const liveIds = new Set(items.map((entry) => entry.id));
    return [...items, ...pending.filter((entry) => !liveIds.has(entry.id))];
  }, [items, pending]);

  // The entry open in the editor; `selectedId` names the existing entry being
  // edited. With nothing selected (or when the selected entry has been deleted),
  // only the title list (top third) is shown. New entries are created up front
  // so they appear in the list immediately, so there is no unsaved-draft state.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem =
    selectedId != null
      ? allItems.find((entry) => entry.id === selectedId) ?? null
      : null;
  const editorOpen = selectedItem !== null;

  // The editor's fields. Title is always a plain string; the rest are paragraph
  // text areas, stored null when blank (see docs/dataModel.md).
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [bias, setBias] = useState("");
  const [reliability, setReliability] = useState("");
  const [credibility, setCredibility] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The entry awaiting delete confirmation, or null when the modal is closed.
  const [deleteTarget, setDeleteTarget] = useState<Information | null>(null);

  // Whether *we* are mid-edit in the form, so the live subscription doesn't
  // overwrite in-progress text (mirrors FileSidebar's editingFields guard).
  const editingInfo = useRef(false);

  // Keep the list of entries live so titles added/removed/renamed by any
  // contributor (or by us) show up without a refresh. Each update also drops any
  // optimistic creates the live data now includes, so `pending` doesn't grow
  // without bound and the live copy becomes the source of truth.
  useEffect(() => {
    return subscribeToInformation(projectId, file.id, (live) => {
      setItems(live);
      setPending((prev) =>
        prev.filter((entry) => !live.some((entry2) => entry2.id === entry.id)),
      );
    });
  }, [projectId, file.id]);

  // Release the file lock if the panel unmounts while we still hold it (e.g. the
  // user closes the view mid-edit), so the file doesn't stay checked out.
  useEffect(() => {
    return () => {
      if (editingInfo.current) {
        editingInfo.current = false;
        lock.release();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // to `pending` so it appears in the list and the editor opens immediately,
  // without waiting for Firebase to acknowledge the write.
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
    };
    setPending((prev) => [...prev, draft]);
    setSelectedId(id);
    void addInformation(projectId, file.id, {
      informationTitle: draft.informationTitle,
      informationText: draft.informationText,
      overallBias: draft.overallBias,
      informationReliability: draft.informationReliability,
      informationCredibility: draft.informationCredibility,
    }, id).catch((err: unknown) => {
      setError(
        err instanceof Error ? err.message : "Failed to add information.",
      );
    });
  }

  // Claim the lock when the form gains focus, releasing it once focus leaves the
  // whole group (after saving). Checking the file out here is what stops other
  // users from touching the file's details while information is being entered.
  function claimLock() {
    if (editingInfo.current || lockedByOther) return;
    editingInfo.current = true;
    lock.acquire();
  }

  function releaseLock() {
    if (!editingInfo.current) return;
    editingInfo.current = false;
    lock.release();
  }

  // Closing while a field is focused can't rely on the editor's blur firing
  // (the inputs unmount), so save and release here before closing the panel.
  function handleClose() {
    if (editingInfo.current) {
      void handleSave();
      releaseLock();
    }
    onClose();
  }

  function handleGroupBlur(event: FocusEvent<HTMLDivElement>) {
    // Ignore blurs that just move focus between fields within the group.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void handleSave();
    releaseLock();
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
  }

  const fieldClass =
    "resize-y rounded-md border border-black/[.08] bg-transparent px-2 py-1.5 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]";

  return (
    <aside className="absolute inset-y-0 right-96 z-10 flex w-[28rem] flex-col border-l border-r border-black/[.08] bg-zinc-50 shadow-xl dark:border-white/[.145] dark:bg-black">
      <header className="flex items-start justify-between gap-2 border-b border-black/[.08] p-4 dark:border-white/[.145]">
        <h2 className="min-w-0 break-words text-lg font-semibold text-black dark:text-zinc-50">
          Information
        </h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close information view"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
        >
          ✕
        </button>
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
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                      item.id === selectedId
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
                      disabled={lockedByOther}
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
              disabled={lockedByOther}
              className="flex h-8 w-full items-center justify-center rounded-md border border-dashed border-black/[.25] text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/[.25] dark:text-zinc-300 dark:hover:bg-white/[.06]"
            >
              + Add New Information
            </button>
          </div>
        </div>

        {/* Bottom two-thirds: the editor for the selected/new entry. */}
        {editorOpen && (
          <div className="flex min-h-0 basis-2/3 flex-col gap-3 overflow-y-auto border-t border-black/[.08] p-4 dark:border-white/[.145]">
            <div
              className="flex flex-col gap-3"
              onFocus={claimLock}
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
                  disabled={lockedByOther}
                  placeholder="Untitled"
                  className="h-7 min-w-0 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-black dark:text-zinc-50">
                  Information Text
                </span>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  disabled={lockedByOther}
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
                  disabled={lockedByOther}
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
                  disabled={lockedByOther}
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
                  disabled={lockedByOther}
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
