"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  getTimelines,
  createTimeline,
  updateTimeline,
  deleteTimeline,
  getTimelineEntries,
  addTimelineEntry,
  removeTimelineEntry,
  type Timeline,
  type TimelineEntry,
} from "@/lib/timelines";
import { getFiles, getInformation } from "@/lib/projects";
import { getDatetimes, type InformationDatetime } from "@/lib/timelines";
import {
  ticks,
  tickUnitForSpan,
  assignLanes,
  MS_MIN,
} from "@/lib/timelineRender";
import { humanDatetime, valueToParts } from "@/lib/datetimePrecision";

// Full-screen timeline workspace (see §6 of the timeline plan). Left rail lists
// the project's timelines; the main pane draws the selected timeline's entries
// on a zoomable, pannable canvas above a black time axis.

// SVG coordinate space. The <svg> scales to its container via width:100%, but
// all geometry/lane-packing is done in these fixed viewBox units.
const VB_W = 1000;
const VB_H = 440;
const PADX = 48;
const AXIS_Y = 380;
const LANE_H = 30;
const BAR_H = 15;
const WHISKER_H = 5;
const LANE_GAP = 6;

type TimelineViewProps = {
  projectId: string;
  onClose: () => void;
  // Open the information view for a clicked entry (file + information id).
  onOpenInformation: (fileId: string, informationId: string) => void;
};

export default function TimelineView({
  projectId,
  onClose,
  onOpenInformation,
}: TimelineViewProps) {
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The visible window [viewLo, viewHi] in epoch ms. null until the first
  // timeline/entries load computes a default.
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const selected = timelines.find((t) => t.id === selectedId) ?? null;

  // ── loading ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    getTimelines(projectId)
      .then((rows) => {
        if (!active) return;
        setTimelines(rows);
        setSelectedId((cur) => cur ?? rows[0]?.id ?? null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load timelines."),
      );
    return () => {
      active = false;
    };
  }, [projectId]);

  const dataBounds = useMemo(() => {
    if (entries.length === 0) return null;
    const lo = Math.min(...entries.map((e) => e.lowerMs));
    const hi = Math.max(...entries.map((e) => e.upperMs));
    const margin = (hi - lo) * 0.06 || 365 * 24 * 3600 * 1000; // 1yr if all-equal
    return { lo, hi, margin };
  }, [entries]);

  // The timeline's persisted default view, or fit-all when unset.
  const defaultView = useCallback(
    (tl: Timeline | null, data: typeof dataBounds): { lo: number; hi: number } => {
      if (tl?.defaultStartMs != null && tl.defaultSpanMs != null) {
        return { lo: tl.defaultStartMs, hi: tl.defaultStartMs + tl.defaultSpanMs };
      }
      if (data) return { lo: data.lo - data.margin, hi: data.hi + data.margin };
      // Empty timeline with no saved view — show the last ~decade around now.
      const now = Date.now();
      return { lo: now - 5 * 365 * 24 * 3600 * 1000, hi: now + 5 * 365 * 24 * 3600 * 1000 };
    },
    [],
  );

  const loadEntries = useCallback(
    async (timelineId: string) => {
      const rows = await getTimelineEntries(projectId, timelineId);
      setEntries(rows);
      return rows;
    },
    [projectId],
  );

  // On selecting a timeline, load its entries and reset to its default view.
  useEffect(() => {
    if (!selectedId) {
      setEntries([]);
      setView(null);
      return;
    }
    let active = true;
    getTimelineEntries(projectId, selectedId)
      .then((rows) => {
        if (!active) return;
        setEntries(rows);
        const tl = timelines.find((t) => t.id === selectedId) ?? null;
        const data =
          rows.length === 0
            ? null
            : (() => {
                const lo = Math.min(...rows.map((e) => e.lowerMs));
                const hi = Math.max(...rows.map((e) => e.upperMs));
                return { lo, hi, margin: (hi - lo) * 0.06 || 365 * 24 * 3600 * 1000 };
              })();
        setView(defaultView(tl, data));
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load entries."),
      );
    return () => {
      active = false;
    };
    // timelines intentionally omitted: selecting reloads; a title edit shouldn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedId, defaultView]);

  // ── view transforms ───────────────────────────────────────────────────────────
  const maxSpan = dataBounds
    ? (dataBounds.hi - dataBounds.lo + 2 * dataBounds.margin) * 50
    : 500 * 365 * 24 * 3600 * 1000;

  const zoom = useCallback(
    (factor: number) => {
      setView((v) => {
        if (!v) return v;
        const c = (v.lo + v.hi) / 2;
        let span = (v.hi - v.lo) * factor;
        span = Math.max(MS_MIN, Math.min(span, maxSpan));
        return { lo: c - span / 2, hi: c + span / 2 };
      });
    },
    [maxSpan],
  );

  const pan = useCallback((frac: number) => {
    setView((v) => {
      if (!v) return v;
      const d = (v.hi - v.lo) * frac;
      return { lo: v.lo + d, hi: v.hi + d };
    });
  }, []);

  const fitAll = useCallback(() => {
    if (dataBounds) {
      setView({ lo: dataBounds.lo - dataBounds.margin, hi: dataBounds.hi + dataBounds.margin });
    }
  }, [dataBounds]);

  async function handleSetDefault() {
    if (!selected || !view) return;
    setError(null);
    try {
      await updateTimeline(projectId, selected.id, {
        defaultStartMs: Math.round(view.lo),
        defaultSpanMs: Math.round(view.hi - view.lo),
      });
      setTimelines((prev) =>
        prev.map((t) =>
          t.id === selected.id
            ? { ...t, defaultStartMs: Math.round(view.lo), defaultSpanMs: Math.round(view.hi - view.lo) }
            : t,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save default view.");
    }
  }

  function handleResetDefault() {
    setView(defaultView(selected, dataBounds));
  }

  async function handleCreate() {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const tl = await createTimeline(projectId, { title });
      setTimelines((prev) => [...prev, tl]);
      setSelectedId(tl.id);
      setNewTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create timeline.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteTimeline(id: string) {
    setError(null);
    try {
      await deleteTimeline(projectId, id);
      setTimelines((prev) => prev.filter((t) => t.id !== id));
      setSelectedId((cur) => (cur === id ? null : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete timeline.");
    }
  }

  async function handleRemoveEntry(datetimeId: string) {
    if (!selectedId) return;
    setEntries((prev) => prev.filter((e) => e.datetimeId !== datetimeId));
    try {
      await removeTimelineEntry(projectId, selectedId, datetimeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove entry.");
      void loadEntries(selectedId);
    }
  }

  async function handleAddEntry(datetimeId: string) {
    if (!selectedId) return;
    setError(null);
    try {
      await addTimelineEntry(projectId, selectedId, datetimeId);
      await loadEntries(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add entry.");
    }
  }

  // ── drag-to-pan ───────────────────────────────────────────────────────────────
  const dragRef = useRef<number | null>(null);
  function onPointerDown(ev: ReactPointerEvent<SVGSVGElement>) {
    dragRef.current = ev.clientX;
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }
  function onPointerMove(ev: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current == null) return;
    const dpx = ev.clientX - dragRef.current;
    dragRef.current = ev.clientX;
    const width = svgRef.current?.clientWidth || VB_W;
    setView((v) => {
      if (!v) return v;
      const dms = (-dpx / width) * (v.hi - v.lo);
      return { lo: v.lo + dms, hi: v.hi + dms };
    });
  }
  function onPointerUp(ev: ReactPointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
  }
  function onWheel(ev: ReactWheelEvent<SVGSVGElement>) {
    if (ev.shiftKey) pan(ev.deltaY > 0 ? 0.12 : -0.12);
    else zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15);
  }
  function onKeyDown(ev: ReactKeyboardEvent<SVGSVGElement>) {
    if (ev.key === "ArrowLeft") {
      pan(ev.shiftKey ? -1 : -0.2);
      ev.preventDefault();
    } else if (ev.key === "ArrowRight") {
      pan(ev.shiftKey ? 1 : 0.2);
      ev.preventDefault();
    }
  }

  const scaleUnit = view ? tickUnitForSpan(view.hi - view.lo) : "years";

  return (
    <div className="absolute inset-0 z-20 flex bg-white dark:bg-black">
      {/* Left rail */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-black/[.08] bg-zinc-50 dark:border-white/[.145] dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            Timelines
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close timelines"
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            ✕
          </button>
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {timelines.length === 0 ? (
            <li className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              No timelines yet.
            </li>
          ) : (
            timelines.map((tl) => (
              <li key={tl.id}>
                <div
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                    tl.id === selectedId
                      ? "bg-black/[.06] dark:bg-white/[.08]"
                      : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(tl.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm text-black dark:text-zinc-50"
                    title={tl.title}
                  >
                    {tl.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteTimeline(tl.id)}
                    aria-label={`Delete ${tl.title}`}
                    className="shrink-0 leading-none text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
        <div className="flex flex-col gap-2 border-t border-black/[.08] p-2 dark:border-white/[.145]">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            placeholder="New timeline title"
            aria-label="New timeline title"
            className="h-8 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] dark:border-white/[.145] dark:text-zinc-50"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !newTitle.trim()}
            className="flex h-8 items-center justify-center rounded-md border border-dashed border-black/[.25] text-xs font-medium text-zinc-600 hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[.25] dark:text-zinc-300 dark:hover:bg-white/[.06]"
          >
            + New timeline
          </button>
        </div>
      </aside>

      {/* Main canvas */}
      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div
            role="alert"
            className="m-4 mb-0 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </div>
        )}
        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h1 className="mr-2 text-xl font-semibold text-black dark:text-zinc-50">
                {selected.title}
              </h1>
              <ToolbarButton onClick={() => pan(-0.33)}>◀ Earlier</ToolbarButton>
              <ToolbarButton onClick={() => pan(0.33)}>Later ▶</ToolbarButton>
              <ToolbarButton onClick={() => zoom(0.6)}>+ Zoom in</ToolbarButton>
              <ToolbarButton onClick={() => zoom(1 / 0.6)}>− Zoom out</ToolbarButton>
              <ToolbarButton onClick={fitAll} disabled={entries.length === 0}>
                Fit all
              </ToolbarButton>
              <ToolbarButton onClick={() => void handleSetDefault()}>
                ☆ Set default view
              </ToolbarButton>
              <ToolbarButton onClick={handleResetDefault}>Default view</ToolbarButton>
              <ToolbarButton onClick={() => setPickerOpen(true)}>
                + Add information
              </ToolbarButton>
            </div>

            {entries.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
                <p>This timeline is empty.</p>
                <p>
                  Use <span className="font-medium">+ Add information</span> to pin a
                  dated piece of information.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/[.08] dark:border-white/[.145]">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${VB_W} ${VB_H}`}
                  width="100%"
                  role="img"
                  aria-label={`${selected.title} timeline`}
                  tabIndex={0}
                  className="block cursor-grab touch-none select-none focus:outline-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onWheel={onWheel}
                  onKeyDown={onKeyDown}
                >
                  {view && (
                    <Canvas
                      view={view}
                      entries={entries}
                      onOpenInformation={onOpenInformation}
                    />
                  )}
                </svg>
              </div>
            )}
            {view && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Scale: {scaleUnit} · drag or use ◀ ▶ / arrow keys to pan, wheel to
                zoom · click a bar to open its information.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <p>Select a timeline, or create one to get started.</p>
          </div>
        )}
      </main>

      {pickerOpen && selected && (
        <AddInformationPicker
          projectId={projectId}
          existing={new Set(entries.map((e) => e.datetimeId))}
          onAdd={handleAddEntry}
          onRemove={handleRemoveEntry}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-black/[.08] px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]"
    >
      {children}
    </button>
  );
}

// ── canvas contents ─────────────────────────────────────────────────────────────

function Canvas({
  view,
  entries,
  onOpenInformation,
}: {
  view: { lo: number; hi: number };
  entries: TimelineEntry[];
  onOpenInformation: (fileId: string, informationId: string) => void;
}) {
  const x = (ms: number) =>
    PADX + ((ms - view.lo) / (view.hi - view.lo)) * (VB_W - 2 * PADX);
  const clampW = (w: number) => Math.max(w, 2);

  // Pixel-positioned, lane-packed entries (rightPx includes the label width so
  // labels don't collide — mirrors §7 of the plan).
  const packable = entries
    .map((e) => {
      const labelW = e.title.length * 6.5 + 10;
      const leftPx = x(e.lowerMs);
      const rightPx = Math.max(x(e.upperMs), leftPx + labelW);
      return { ...e, leftPx, rightPx };
    })
    .filter((e) => e.rightPx > PADX && e.leftPx < VB_W - PADX);

  const { packed } = assignLanes(packable, LANE_GAP);
  const tickList = ticks(view.lo, view.hi);

  return (
    <>
      {/* axis */}
      <line x1={PADX} y1={AXIS_Y} x2={VB_W - PADX} y2={AXIS_Y} stroke="currentColor" strokeWidth={2} className="text-black dark:text-zinc-100" />
      {tickList.map((tk, i) => {
        const px = x(tk.ms);
        if (px < PADX - 1 || px > VB_W - PADX + 1) return null;
        return (
          <g key={i} className="text-black dark:text-zinc-300">
            <line
              x1={px}
              y1={AXIS_Y}
              x2={px}
              y2={AXIS_Y + (tk.major ? 9 : 5)}
              stroke="currentColor"
              strokeWidth={tk.major ? 1.5 : 1}
            />
            <text
              x={px}
              y={AXIS_Y + 22}
              textAnchor="middle"
              fontSize={tk.major ? 11 : 10}
              fontWeight={tk.major ? 600 : 400}
              fill="currentColor"
              className={tk.major ? "text-black dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}
            >
              {tk.label}
            </text>
          </g>
        );
      })}

      {/* entries */}
      {packed.map((e) => {
        const y = AXIS_Y - (e.lane + 1) * LANE_H;
        const isRange = e.coreLowerMs != null && e.coreUpperMs != null;
        return (
          <g
            key={e.datetimeId}
            className="cursor-pointer"
            onClick={() => onOpenInformation(e.fileId, e.informationId)}
          >
            {isRange ? (
              <>
                <rect
                  x={x(e.lowerMs)}
                  y={y + 9}
                  width={clampW(x(e.coreLowerMs as number) - x(e.lowerMs))}
                  height={WHISKER_H}
                  rx={2.5}
                  fill="#2563eb"
                  fillOpacity={0.35}
                />
                <rect
                  x={x(e.coreUpperMs as number)}
                  y={y + 9}
                  width={clampW(x(e.upperMs) - x(e.coreUpperMs as number))}
                  height={WHISKER_H}
                  rx={2.5}
                  fill="#2563eb"
                  fillOpacity={0.35}
                />
                <rect
                  x={x(e.coreLowerMs as number)}
                  y={y + 4}
                  width={clampW(x(e.coreUpperMs as number) - x(e.coreLowerMs as number))}
                  height={BAR_H}
                  rx={3}
                  fill="#2563eb"
                />
              </>
            ) : (
              <rect
                x={x(e.lowerMs)}
                y={y + 9}
                width={clampW(x(e.upperMs) - x(e.lowerMs))}
                height={WHISKER_H}
                rx={2.5}
                fill="#2563eb"
                fillOpacity={0.35}
              />
            )}
            <text
              x={Math.max(x(e.lowerMs), PADX) + 3}
              y={y + 1}
              fontSize={11}
              fontWeight={600}
              fill="currentColor"
              className="text-black dark:text-zinc-100"
            >
              {e.title || "Untitled"}
            </text>
            <title>{summaryFor(e)}</title>
          </g>
        );
      })}
    </>
  );
}

function summaryFor(e: TimelineEntry): string {
  return e.title || "Untitled";
}

// ── add-information picker ───────────────────────────────────────────────────────

function AddInformationPicker({
  projectId,
  existing,
  onAdd,
  onRemove,
  onClose,
}: {
  projectId: string;
  existing: Set<string>;
  onAdd: (datetimeId: string) => void | Promise<void>;
  onRemove: (datetimeId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ id: string; filename: string }[]>([]);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  // datetimes per information for the opened file, keyed by information id.
  const [infoRows, setInfoRows] = useState<
    { id: string; title: string; datetimes: InformationDatetime[] }[]
  >([]);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      getFiles(projectId, null, query)
        .then((rows) => {
          if (active) setFiles(rows.map((f) => ({ id: f.id, filename: f.filename })));
        })
        .catch(() => {
          if (active) setFiles([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [projectId, query]);

  async function openFile(fileId: string) {
    setOpenFileId(fileId);
    setLoadingFile(true);
    setInfoRows([]);
    try {
      const info = await getInformation(projectId, fileId);
      const withDates = await Promise.all(
        info.map(async (i) => ({
          id: i.id,
          title: i.informationTitle,
          datetimes: await getDatetimes(projectId, fileId, i.id),
        })),
      );
      setInfoRows(withDates.filter((r) => r.datetimes.length > 0));
    } finally {
      setLoadingFile(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[32rem] flex-col rounded-lg border border-black/[.08] bg-white shadow-2xl dark:border-white/[.145] dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-black/[.08] p-4 dark:border-white/[.145]">
          <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
            Add information to timeline
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </header>
        <div className="p-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            aria-label="Search files"
            className="h-9 w-full rounded-md border border-black/[.08] bg-transparent px-3 text-sm text-black outline-none focus:border-black/[.25] dark:border-white/[.145] dark:text-zinc-50"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {openFileId ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpenFileId(null);
                  setInfoRows([]);
                }}
                className="self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                ← Back to files
              </button>
              {loadingFile ? (
                <p className="text-xs text-zinc-500">Loading…</p>
              ) : infoRows.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No dated information in this file.
                </p>
              ) : (
                infoRows.map((row) => (
                  <div key={row.id} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-black dark:text-zinc-50">
                      {row.title || "Untitled"}
                    </span>
                    {row.datetimes.map((dt) => {
                      const already = existing.has(dt.id);
                      return (
                        <div
                          key={dt.id}
                          className="flex items-center gap-2 rounded-md border border-black/[.08] px-2 py-1 dark:border-white/[.145]"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-300">
                            {pickerSummary(dt)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void (already ? onRemove(dt.id) : onAdd(dt.id))
                            }
                            className="shrink-0 rounded border border-black/[.08] px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-white/[.145] dark:text-blue-400 dark:hover:bg-white/[.06]"
                          >
                            {already ? "Remove" : "Add"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          ) : files.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">No files.</p>
          ) : (
            <ul className="flex flex-col">
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => void openFile(f.id)}
                    className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-black hover:bg-black/[.04] dark:text-zinc-50 dark:hover:bg-white/[.06]"
                  >
                    {f.filename}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function pickerSummary(dt: InformationDatetime): string {
  return humanDatetime({
    isRange: dt.isRange,
    start: valueToParts(dt.startValue),
    startPrecision: dt.startPrecision,
    end: dt.isRange && dt.endValue ? valueToParts(dt.endValue) : undefined,
    endPrecision: dt.isRange ? dt.endPrecision ?? undefined : undefined,
  });
}
