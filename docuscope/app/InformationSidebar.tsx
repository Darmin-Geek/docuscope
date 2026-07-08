"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  addLabelToInformation,
  getInformation,
  getInformationHistory,
  newInformationId,
  removeLabelFromInformation,
  type FileDoc,
  type Label,
} from "@/lib/projects";
import type { FileLock } from "./useFileLock";
import type { FileDraft } from "./useFileDraft";
import DeleteInformationModal from "./DeleteInformationModal";
import LabelPill from "./LabelPill";
import AdmiraltyCodeSelect from "./AdmiraltyCodeSelect";
import { useFieldHistory } from "./useFieldHistory";
import FieldHistoryButton from "./FieldHistoryButton";
import RichTextEditor from "./RichTextEditor";
import { htmlOrNull } from "@/lib/richText";

// One entry in the working draft's information list, including its staged
// selections. The editor shows/edits the Information fields; selections are
// carried through unchanged so a Save/Submit persists them alongside.
type DraftInformation = FileDraft["snapshot"]["information"][number];

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
  // The shared working draft. Information add/edit/delete mutate this in memory;
  // nothing is persisted until Save/Submit in the File Details sidebar.
  draft: FileDraft;
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

export default function InformationSidebar({
  projectId,
  file,
  labels,
  lock,
  draft,
  canOpenPdf,
  onOpenPdfViewer,
  onClose,
  variant = "overlay",
  initialSelectedId = null,
  onSelectedIdChange,
}: InformationSidebarProps) {
  const { lockedByOther, isHeldByMe, editorName } = lock;
  const embedded = variant === "embedded";

  // The information list comes straight from the shared working draft (issue
  // #78). Add/edit/delete mutate that snapshot in memory; nothing is persisted
  // until Save/Submit in the File Details sidebar.
  const allItems = draft.snapshot.information;

  // The entry open in the editor; `selectedId` names the existing entry being
  // edited. With nothing selected (or when the selected entry has been deleted),
  // only the title list (top third) is shown.
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

  // The editor reads its field values straight from the selected snapshot row;
  // an edit writes the updated row back through draft.upsertInformation. The
  // raw value is kept verbatim (blank → null) so the controlled inputs hold
  // interior/trailing spaces while typing.
  const title = selectedItem?.informationTitle ?? "";
  const text = selectedItem?.informationText ?? "";
  const bias = selectedItem?.overallBias ?? "";
  const reliability = selectedItem?.informationReliability ?? "";
  const credibility = selectedItem?.informationCredibility ?? "";
  const reliabilityCode = selectedItem?.informationReliabilityCode ?? null;
  const credibilityCode = selectedItem?.informationCredibilityCode ?? null;

  // Label ids per information id, kept separate from the draft because labels
  // are persisted immediately via the label API (not through save/submit).
  const [itemLabels, setItemLabels] = useState<Map<string, string[]>>(new Map());
  // IDs that exist in the database. New entries created via startNew() are
  // client-side only until Save/Submit, so the label API will 404 for them.
  const [persistedIds, setPersistedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    getInformation(projectId, file.id)
      .then((rows) => {
        if (!active) return;
        setItemLabels(new Map(rows.map((r) => [r.id, r.labels])));
        setPersistedIds(new Set(rows.map((r) => r.id)));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, file.id]);

  // Whether the "add label" picker (the unassigned information labels) is open,
  // plus any error from assigning/removing a label.
  const [pickingLabel, setPickingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  // The entry awaiting delete confirmation, or null when the modal is closed.
  const [deleteTarget, setDeleteTarget] = useState<DraftInformation | null>(null);

  // Bumped after a successful Submit so the field history popovers refresh with
  // the just-published edits.
  const [historyReloadToken, setHistoryReloadToken] = useState(0);

  function patchSelected(fields: Partial<Omit<DraftInformation, "id" | "selections">>) {
    if (!selectedItem) return;
    draft.upsertInformation({ ...selectedItem, ...fields });
  }

  function openEntry(item: DraftInformation) {
    setSelectedId(item.id);
  }

  // Create a blank entry in the snapshot and open it for editing immediately.
  // The client UUID lets the row carry selections before it is ever persisted.
  function startNew() {
    const id = newInformationId(projectId, file.id);
    draft.upsertInformation({
      id,
      informationTitle: "",
      informationText: null,
      overallBias: null,
      informationReliability: null,
      informationCredibility: null,
      informationReliabilityCode: null,
      informationCredibilityCode: null,
      selections: [],
    });
    setItemLabels((prev) => { const m = new Map(prev); m.set(id, []); return m; });
    setSelectedId(id);
  }

  // Check-out is manual (the File Details toolbar button); closing just hides
  // the view — edits are already in the working draft, persisted only by
  // Save/Submit.
  function handleClose() {
    onClose();
  }

  // Enter commits the single-line title input (a no-op beyond losing focus now
  // that edits write straight to the draft); the paragraph textareas keep Enter
  // for newlines.
  function handleTitleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    draft.removeInformation(deleteTarget.id);
    if (selectedId === deleteTarget.id) {
      setSelectedId(null);
    }
    setDeleteTarget(null);
  }

  function applyLabelChange(
    infoId: string,
    next: (current: string[]) => string[],
  ) {
    setItemLabels((prev) => {
      const m = new Map(prev);
      m.set(infoId, next(m.get(infoId) ?? []));
      return m;
    });
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

  // Submit publishes the whole snapshot's information rows to the database
  // (Save only stages a draft), so as soon as a submit succeeds every current
  // entry is persisted — unlock their label pickers immediately rather than
  // waiting for a re-fetch on the next mount.
  useEffect(() => {
    if (draft.status === "submitted") {
      setPersistedIds(new Set(allItems.map((item) => item.id)));
      setHistoryReloadToken((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.status]);

  // True when the selected entry was created client-side and not yet saved to
  // the database. The label API requires the row to exist, so labels are blocked
  // until the user saves/submits.
  const isUnsaved = selectedId !== null && !persistedIds.has(selectedId);

  // Field version history for the selected entry. Disabled (no fetch) when
  // nothing is selected or the entry is unsaved — an unsaved row has no id in
  // the database and thus no history yet (mirrors the label-picker gate).
  const historyLoader = useCallback(
    () => getInformationHistory(projectId, file.id, selectedId as string),
    [projectId, file.id, selectedId],
  );
  const history = useFieldHistory(
    selectedId !== null && !isUnsaved ? historyLoader : null,
    `${selectedId}:${historyReloadToken}`,
  );

  // Resolve the selected entry's label ids against the project's information
  // labels, preserving the project's order; the rest are offered in the picker.
  const currentLabels = itemLabels.get(selectedId ?? "") ?? [];
  const appliedLabels = labels.filter((label) =>
    currentLabels.includes(label.id),
  );
  const availableLabels = labels.filter(
    (label) => !currentLabels.includes(label.id),
  );

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
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
                  Title
                  <FieldHistoryButton
                    fieldLabel="Title"
                    versions={history.versionsFor("informationTitle")}
                    hidden={isUnsaved}
                  />
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) =>
                    patchSelected({ informationTitle: event.target.value })
                  }
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
                      disabled={!isHeldByMe || lockedByOther || isUnsaved}
                      title={isUnsaved ? "Save this entry before adding labels" : undefined}
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
                <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
                  Information Text
                  <FieldHistoryButton
                    fieldLabel="Information Text"
                    versions={history.versionsFor("informationText")}
                    renderRich
                    hidden={isUnsaved}
                  />
                </span>
                <RichTextEditor
                  ariaLabel="Information Text"
                  value={text}
                  onChange={(html) =>
                    patchSelected({ informationText: htmlOrNull(html) })
                  }
                  disabled={!isHeldByMe || lockedByOther}
                  minRows={4}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
                  Overall Bias
                  <FieldHistoryButton
                    fieldLabel="Overall Bias"
                    versions={history.versionsFor("overallBias")}
                    renderRich
                    hidden={isUnsaved}
                  />
                </span>
                <RichTextEditor
                  ariaLabel="Overall Bias"
                  value={bias}
                  onChange={(html) =>
                    patchSelected({ overallBias: htmlOrNull(html) })
                  }
                  disabled={!isHeldByMe || lockedByOther}
                  minRows={3}
                />
              </label>

              <AdmiraltyCodeSelect
                label="Reliability Rating"
                kind="reliability"
                value={reliabilityCode}
                onChange={(code) =>
                  patchSelected({ informationReliabilityCode: code })
                }
                disabled={!isHeldByMe || lockedByOther}
                labelAccessory={
                  <FieldHistoryButton
                    fieldLabel="Reliability Rating"
                    versions={history.versionsFor("informationReliabilityCode")}
                    hidden={isUnsaved}
                  />
                }
              />

              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
                  Information Reliability
                  <FieldHistoryButton
                    fieldLabel="Information Reliability"
                    versions={history.versionsFor("informationReliability")}
                    renderRich
                    hidden={isUnsaved}
                  />
                </span>
                <RichTextEditor
                  ariaLabel="Information Reliability"
                  value={reliability}
                  onChange={(html) =>
                    patchSelected({ informationReliability: htmlOrNull(html) })
                  }
                  disabled={!isHeldByMe || lockedByOther}
                  minRows={3}
                />
              </label>

              <AdmiraltyCodeSelect
                label="Credibility Rating"
                kind="credibility"
                value={credibilityCode}
                onChange={(code) =>
                  patchSelected({ informationCredibilityCode: code })
                }
                disabled={!isHeldByMe || lockedByOther}
                labelAccessory={
                  <FieldHistoryButton
                    fieldLabel="Credibility Rating"
                    versions={history.versionsFor("informationCredibilityCode")}
                    hidden={isUnsaved}
                  />
                }
              />

              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
                  Information Credibility
                  <FieldHistoryButton
                    fieldLabel="Information Credibility"
                    versions={history.versionsFor("informationCredibility")}
                    renderRich
                    hidden={isUnsaved}
                  />
                </span>
                <RichTextEditor
                  ariaLabel="Information Credibility"
                  value={credibility}
                  onChange={(html) =>
                    patchSelected({ informationCredibility: htmlOrNull(html) })
                  }
                  disabled={!isHeldByMe || lockedByOther}
                  minRows={3}
                />
              </label>
            </div>
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
