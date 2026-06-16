"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmbedPDF } from "@embedpdf/core/react";
import { createPluginRegistration } from "@embedpdf/core";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import { ViewportPluginPackage, Viewport } from "@embedpdf/plugin-viewport/react";
import {
  ScrollPluginPackage,
  Scroller,
  useScrollCapability,
  type PageLayout,
} from "@embedpdf/plugin-scroll/react";
import { RenderPluginPackage, RenderLayer } from "@embedpdf/plugin-render/react";
import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react";
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from "@embedpdf/plugin-interaction-manager/react";
import {
  SelectionPluginPackage,
  SelectionLayer,
  useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import { ZoomPluginPackage, useZoom } from "@embedpdf/plugin-zoom/react";

import {
  addSelection,
  deleteSelection,
  getFileDownloadUrl,
  getSelections,
  type FileDoc,
  type Selection,
} from "@/lib/projects";
import type { FileLock } from "./useFileLock";
import InformationSidebar from "./InformationSidebar";

// Each modal instance hosts a single EmbedPDF document; a constant id is fine.
const DOC_ID = "doc";

type PdfViewerModalProps = {
  projectId: string;
  file: FileDoc;
  // The file's shared check-out lock. Creating or deleting a selection is a
  // content edit, so it goes through the same lock as information editing: the
  // first edit checks the file out, and the lock is released when the modal
  // closes (see useFileLock / InformationSidebar).
  lock: FileLock;
  // The piece of information to make active on open (selected in the left
  // sidebar, scrolled to its first selection). Null opens with nothing active.
  initialInformationId: string | null;
  onClose: () => void;
};

export default function PdfViewerModal({
  projectId,
  file,
  lock,
  initialInformationId,
  onClose,
}: PdfViewerModalProps) {
  // The pdfium engine is a WASM module served from /public so the viewer works
  // offline and in tests; fontFallback is disabled to avoid CDN font requests.
  // The direct (main-thread) engine is used instead of the worker engine so no
  // worker chunk needs bundling — fine for the document-sized PDFs here.
  const { engine, isLoading: engineLoading, error: engineError } =
    usePdfiumEngine({ wasmUrl: "/pdfium.wasm", worker: false, fontFallback: null });

  // The PDF bytes, fetched once via a download URL and handed to the engine as a
  // buffer. Fetching the bytes ourselves (rather than pointing the engine at the
  // S3 URL) sidesteps cross-origin restrictions on the WASM fetch.
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getFileDownloadUrl(projectId, file.id)
      .then((url) => fetch(url))
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load PDF.");
        return res.arrayBuffer();
      })
      .then((bytes) => {
        if (active) setBuffer(bytes);
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : "Failed to load PDF.");
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, file.id]);

  // Close on Escape, matching the other modals' keyboard behaviour.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rebuild the plugin set once the bytes arrive so the document manager loads
  // the buffer. The selection/scroll/zoom plugins drive text selection, scroll
  // navigation and the highlight scaling.
  const plugins = useMemo(() => {
    if (!buffer) return null;
    return [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [{ buffer, name: file.filename, documentId: DOC_ID }],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(ZoomPluginPackage),
    ];
  }, [buffer, file.filename]);

  const ready = engine && plugins;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={`PDF viewer for ${file.filename}`}
    >
      {/* min-h-0 keeps this flex row from inflating to its content height so the
          definite height of the fixed overlay propagates down to the viewport;
          without it the EmbedPDF Viewport (which sizes itself to height:100% of
          its parent) resolves to 0 and renders a blank, scrollable page. */}
      <div className="m-4 flex min-h-0 flex-1 overflow-hidden rounded-lg bg-zinc-50 shadow-2xl dark:bg-black">
        {(engineError || loadError) ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <p className="text-sm text-red-600 dark:text-red-400">
              {loadError ?? "Failed to initialise the PDF viewer."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 items-center justify-center rounded-md border border-black/[.08] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
            >
              Close
            </button>
          </div>
        ) : !ready ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {engineLoading || !plugins ? "Loading PDF…" : "Preparing viewer…"}
            </p>
          </div>
        ) : (
          <EmbedPDF engine={engine} plugins={plugins}>
            <ViewerBody
              projectId={projectId}
              file={file}
              lock={lock}
              initialInformationId={initialInformationId}
              onClose={onClose}
            />
          </EmbedPDF>
        )}
      </div>
    </div>
  );
}

// ── inner body (runs inside the EmbedPDF provider) ─────────────────────────────

type ViewerBodyProps = Omit<PdfViewerModalProps, "lock"> & { lock: FileLock };

function ViewerBody({
  projectId,
  file,
  lock,
  initialInformationId,
  onClose,
}: ViewerBodyProps) {
  const { lockedByOther, editorName } = lock;
  const selectionApi = useSelectionCapability().provides;
  const scrollApi = useScrollCapability().provides;

  // The information entry currently selected in the embedded InformationSidebar
  // is the active one for marking selections, drawing highlights and prev/next
  // navigation. The sidebar reports it via onSelectedIdChange.
  const [activeId, setActiveId] = useState<string | null>(initialInformationId);

  // The active information's selections, ordered by document location, plus the
  // index the prev/next controls point at.
  const [selections, setSelections] = useState<Selection[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Whether the user currently has live text selected (enables "Mark").
  const [hasLiveSelection, setHasLiveSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether we still owe an initial scroll to the active info's first selection
  // once both the selections and the page layout are ready.
  const pendingInitialScroll = useRef(initialInformationId != null);

  // Lazily check the file out the first time the user edits selections, and
  // release it when the modal unmounts (mirrors InformationSidebar's lock use).
  const holdingLock = useRef(false);
  const releaseRef = useRef(lock.release);
  useEffect(() => {
    releaseRef.current = lock.release;
  });
  useEffect(() => {
    return () => {
      if (holdingLock.current) {
        holdingLock.current = false;
        releaseRef.current();
      }
    };
  }, []);
  function claimLock() {
    if (holdingLock.current || lockedByOther) return false;
    holdingLock.current = true;
    lock.acquire();
    return true;
  }

  const refreshSelections = useCallback(
    (infoId: string) =>
      getSelections(projectId, file.id, infoId).then((rows) => {
        setSelections(rows);
        return rows;
      }),
    [projectId, file.id],
  );

  // Centre a selection in the viewport. pageCoordinates are PDF-point values
  // (the scroll plugin applies the current scale itself).
  const scrollToSelection = useCallback(
    (selection: Selection) => {
      scrollApi?.scrollToPage({
        pageNumber: selection.pageIndex + 1,
        pageCoordinates: { x: selection.boundingLeft, y: selection.boundingTop },
        alignY: 30,
        behavior: "smooth",
      });
    },
    [scrollApi],
  );

  // Load the active info's selections whenever it changes. activeId only ever
  // goes from null → an id (the list never deselects), so there's no stale list
  // to clear synchronously here.
  useEffect(() => {
    if (activeId == null) return;
    void refreshSelections(activeId).then((rows) => {
      setCurrentIndex(0);
      // Honour the open-to-first-selection request once, after layout is ready.
      if (pendingInitialScroll.current && rows.length > 0) {
        pendingInitialScroll.current = false;
        // A short delay lets the first layout settle before scrolling.
        setTimeout(() => scrollToSelection(rows[0]), 300);
      }
    });
  }, [activeId, refreshSelections, scrollToSelection]);

  // Track whether there is a live selection so the Mark button can enable.
  useEffect(() => {
    if (!selectionApi) return;
    const unsub = selectionApi.onSelectionChange((event) => {
      setHasLiveSelection(event.selection != null);
    });
    return unsub;
  }, [selectionApi]);

  async function handleMark() {
    if (!selectionApi || activeId == null || lockedByOther) return;
    const formatted = selectionApi.getFormattedSelection(DOC_ID);
    if (formatted.length === 0) return;
    claimLock();
    setBusy(true);
    setError(null);
    try {
      const text = (await selectionApi.getSelectedText(DOC_ID).toPromise()).join("\n");
      // A selection spanning multiple pages is stored as one row per page, so
      // each highlight sits on the page whose coordinates it uses.
      for (const page of formatted) {
        await addSelection(projectId, file.id, activeId, {
          pageIndex: page.pageIndex,
          boundingTop: page.rect.origin.y,
          boundingLeft: page.rect.origin.x,
          rects: page.segmentRects.map((r) => ({
            x: r.origin.x,
            y: r.origin.y,
            width: r.size.width,
            height: r.size.height,
          })),
          text,
        });
      }
      selectionApi.clear(DOC_ID);
      await refreshSelections(activeId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to mark selection.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelection(selectionId: string) {
    if (activeId == null || lockedByOther) return;
    claimLock();
    setBusy(true);
    setError(null);
    try {
      await deleteSelection(projectId, file.id, activeId, selectionId);
      const rows = await refreshSelections(activeId);
      setCurrentIndex((i) => Math.min(i, Math.max(0, rows.length - 1)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete selection.");
    } finally {
      setBusy(false);
    }
  }

  function step(delta: number) {
    if (selections.length === 0) return;
    const next = (currentIndex + delta + selections.length) % selections.length;
    setCurrentIndex(next);
    scrollToSelection(selections[next]);
  }

  const currentSelection = selections[currentIndex] ?? null;

  return (
    <>
      {/* Left: the project's real information-editing UI, embedded so the user
          can read text in the PDF and edit the matching information's fields
          side by side. The entry selected here is the active one for marking. */}
      <InformationSidebar
        projectId={projectId}
        file={file}
        lock={lock}
        // Already inside the PDF viewer, so no "open in PDF viewer" affordance.
        canOpenPdf={false}
        onOpenPdfViewer={() => {}}
        // The modal owns the close control; the embedded header hides its own.
        onClose={onClose}
        variant="embedded"
        initialSelectedId={initialInformationId}
        onSelectedIdChange={setActiveId}
      />

      {/* Right: the PDF viewer. min-h-0 lets this column shrink to the row's
          height so the viewport below gets a real (non-zero) height to fill. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-black/[.08] px-4 py-3 dark:border-white/[.145]">
          <h2
            className="min-w-0 truncate text-sm font-semibold text-black dark:text-zinc-50"
            title={file.filename}
          >
            {file.filename}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            ✕
          </button>
        </header>

        {/* Slim selection toolbar: the marking + navigation controls for the
            active information (the one selected in the sidebar). Relocated here
            from the old bespoke left list, which is now the InformationSidebar. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[.08] px-4 py-2 dark:border-white/[.145]">
          <button
            type="button"
            onClick={() => void handleMark()}
            disabled={
              activeId == null || !hasLiveSelection || lockedByOther || busy
            }
            className="flex h-8 items-center justify-center rounded-md bg-black px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark selection
          </button>

          {activeId != null && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={selections.length === 0}
                aria-label="Previous selection"
                className="flex h-8 items-center justify-center rounded-md border border-black/[.08] px-3 text-xs transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[.145] dark:hover:bg-white/[.06]"
              >
                ← Prev
              </button>
              <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {selections.length === 0
                  ? "0 / 0"
                  : `${currentIndex + 1} / ${selections.length}`}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={selections.length === 0}
                aria-label="Next selection"
                className="flex h-8 items-center justify-center rounded-md border border-black/[.08] px-3 text-xs transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[.145] dark:hover:bg-white/[.06]"
              >
                Next →
              </button>
              {currentSelection && (
                <button
                  type="button"
                  onClick={() => void handleDeleteSelection(currentSelection.id)}
                  disabled={lockedByOther || busy}
                  className="flex h-8 items-center justify-center rounded-md border border-black/[.08] px-3 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[.145] dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Delete current selection
                </button>
              )}
            </div>
          )}

          {lockedByOther && (
            <span
              role="status"
              className="text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              {`${editorName ?? "Another user"} is editing this file, so selections can't be changed right now.`}
            </span>
          )}
          {error && (
            <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
          )}
        </div>

        {/* This wrapper is the remaining space below the header and owns a
            definite height (flex-1 + min-h-0). The Viewport sizes itself to
            height:100% of its parent, so it must fill a parent with a real
            height — anchoring it to this wrapper (rather than the whole column,
            which also holds the header) is what makes the pages render instead
            of collapsing to a blank, scrollable area. */}
        <div className="relative min-h-0 flex-1">
          <Viewport
            documentId={DOC_ID}
            className="h-full w-full overflow-auto bg-zinc-200 dark:bg-zinc-800"
          >
          <Scroller
            documentId={DOC_ID}
            renderPage={(layout: PageLayout) => (
              <PagePointerProvider
                documentId={DOC_ID}
                pageIndex={layout.pageIndex}
                style={{
                  width: layout.width,
                  height: layout.height,
                  position: "relative",
                }}
              >
                <RenderLayer
                  documentId={DOC_ID}
                  pageIndex={layout.pageIndex}
                  // The page bitmap is a real <img>, which browsers make
                  // draggable by default — a click-drag to select text would
                  // otherwise also start a native image drag (a ghost
                  // thumbnail trailing the cursor). Disable it on the element
                  // (draggable={false}) and via CSS (WebkitUserDrag) so the
                  // gesture only selects text; selection still works as the
                  // SelectionLayer sits above this.
                  draggable={false}
                  style={
                    {
                      position: "absolute",
                      inset: 0,
                      userSelect: "none",
                      WebkitUserDrag: "none",
                    } as React.CSSProperties
                  }
                />
                <SelectionLayer documentId={DOC_ID} pageIndex={layout.pageIndex} />
                <StoredHighlights
                  pageIndex={layout.pageIndex}
                  selections={selections}
                  currentId={currentSelection?.id ?? null}
                />
              </PagePointerProvider>
            )}
          />
          </Viewport>
        </div>
      </div>
    </>
  );
}

// Draws the active information's saved selections on a single page, scaled by
// the current zoom. The selection at the prev/next cursor is emphasised.
function StoredHighlights({
  pageIndex,
  selections,
  currentId,
}: {
  pageIndex: number;
  selections: Selection[];
  currentId: string | null;
}) {
  // Falls back to 1 before the document's zoom state is registered.
  const scale = useZoom(DOC_ID).state?.currentZoomLevel ?? 1;
  const onThisPage = selections.filter((s) => s.pageIndex === pageIndex);
  if (onThisPage.length === 0) return null;

  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      {onThisPage.flatMap((selection) =>
        selection.rects.map((rect, i) => (
          <div
            key={`${selection.id}-${i}`}
            style={{
              position: "absolute",
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.width * scale,
              height: rect.height * scale,
              backgroundColor:
                selection.id === currentId
                  ? "rgba(245, 158, 11, 0.45)"
                  : "rgba(245, 158, 11, 0.25)",
              outline:
                selection.id === currentId
                  ? "1px solid rgba(217, 119, 6, 0.9)"
                  : "none",
              borderRadius: 1,
            }}
          />
        )),
      )}
    </div>
  );
}
