"use client";

import { useMemo, useState } from "react";
import {
  PRECISIONS,
  precisionBounds,
  partsToValue,
  valueToParts,
  humanEndpoint,
  type Precision,
  type DatetimeParts,
} from "@/lib/datetimePrecision";
import type { DatetimeInputPayload } from "@/lib/timelines";

// The datetime entry element from §6.4 of the plan: enter a point or a range,
// pick a precision per endpoint, and see a live preview of the bar+whiskers the
// timeline will draw. Emits a DatetimeInputPayload (raw value strings +
// precisions); the server derives the authoritative bounds.

// Which raw fields each precision exposes (year is always present via the
// year+era row). Fields below a precision are hidden — pick Year and only a year
// box shows; pick Minute and date+time show.
const FIELDS: Record<Precision, Array<"month" | "day" | "hour" | "minute">> = {
  century: [],
  decade: [],
  year: [],
  month: ["month"],
  day: ["month", "day"],
  hour: ["month", "day", "hour"],
  minute: ["month", "day", "hour", "minute"],
};

// The editor's per-endpoint working state. `year` is the displayed (era-relative)
// year; combined with `era` it maps to an astronomical year for the bounds math.
type Endpoint = {
  prec: Precision;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  era: "AD" | "BC";
};

function blankEndpoint(prec: Precision): Endpoint {
  return {
    prec,
    year: new Date().getUTCFullYear(),
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    era: "AD",
  };
}

// Displayed endpoint → astronomical parts (0 = 1 BC, -1 = 2 BC, …).
function toParts(ep: Endpoint): DatetimeParts {
  const year = ep.era === "BC" ? 1 - ep.year : ep.year;
  return { year, month: ep.month, day: ep.day, hour: ep.hour, minute: ep.minute };
}

// Existing canonical value → endpoint working state (inverse of toParts).
function fromValue(value: string, prec: Precision): Endpoint {
  const p = valueToParts(value);
  const era = p.year <= 0 ? "BC" : "AD";
  const year = p.year <= 0 ? 1 - p.year : p.year;
  return {
    prec,
    year,
    month: p.month ?? 1,
    day: p.day ?? 1,
    hour: p.hour ?? 0,
    minute: p.minute ?? 0,
    era,
  };
}

const PREC_LABEL: Record<Precision, string> = {
  minute: "Minute",
  hour: "Hour",
  day: "Day",
  month: "Month",
  year: "Year",
  decade: "Decade",
  century: "Century",
};

type DatetimeEditorProps = {
  // Prefill for editing an existing datetime; omitted for a new one.
  initial?: DatetimeInputPayload | null;
  onSave: (payload: DatetimeInputPayload) => void | Promise<void>;
  onCancel: () => void;
};

export default function DatetimeEditor({
  initial,
  onSave,
  onCancel,
}: DatetimeEditorProps) {
  const [isRange, setIsRange] = useState<boolean>(initial?.isRange ?? false);
  const [start, setStart] = useState<Endpoint>(() =>
    initial
      ? fromValue(initial.startValue, initial.startPrecision)
      : blankEndpoint("year"),
  );
  const [end, setEnd] = useState<Endpoint>(() =>
    initial?.isRange && initial.endValue && initial.endPrecision
      ? fromValue(initial.endValue, initial.endPrecision)
      : blankEndpoint("year"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bounds for the preview (numbers; bigint isn't needed for on-screen pixels).
  const preview = useMemo(() => {
    const s = precisionBounds(toParts(start), start.prec);
    const sLo = Number(s.lowerMs);
    const sHi = Number(s.upperMs);
    if (!isRange) {
      return { valid: true, lo: sLo, hi: sHi, sLo, sHi, eLo: sLo, eHi: sHi };
    }
    const e = precisionBounds(toParts(end), end.prec);
    const eLo = Number(e.lowerMs);
    const eHi = Number(e.upperMs);
    const valid = eHi > sLo;
    return {
      valid,
      lo: Math.min(sLo, eLo),
      hi: Math.max(sHi, eHi),
      sLo,
      sHi,
      eLo,
      eHi,
    };
  }, [isRange, start, end]);

  const sentence = useMemo(() => {
    const s = humanEndpoint(toParts(start), start.prec);
    if (!isRange) {
      return `Point · ${s} — drawn as a faded band across its whole precision window.`;
    }
    const e = humanEndpoint(toParts(end), end.prec);
    return `Range · ${s} → ${e}. Solid where certain; each end's precision reaches outward independently.`;
  }, [isRange, start, end]);

  async function handleSave() {
    if (!preview.valid) {
      setError("The range end is before its start.");
      return;
    }
    const payload: DatetimeInputPayload = {
      isRange,
      startValue: partsToValue(toParts(start)),
      startPrecision: start.prec,
      endValue: isRange ? partsToValue(toParts(end)) : null,
      endPrecision: isRange ? end.prec : null,
    };
    setSaving(true);
    setError(null);
    try {
      await onSave(payload);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Failed to save date.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-black/[.12] bg-white p-3 shadow-lg dark:border-white/[.18] dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-black dark:text-zinc-50">
          {initial ? "Edit date" : "Add date"}
        </span>
        <Segmented
          options={[
            ["Point", false],
            ["Range", true],
          ]}
          value={isRange}
          onPick={(v) => setIsRange(v)}
          ariaLabel="Point or range"
        />
      </div>

      <EndpointBlock
        caption={isRange ? "Start" : "When"}
        ep={start}
        onChange={setStart}
      />
      {isRange && (
        <EndpointBlock caption="End" ep={end} onChange={setEnd} />
      )}

      {/* Live preview — mirrors what the timeline draws. */}
      <div className="rounded-md bg-zinc-50 p-2 dark:bg-white/[.04]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Preview
        </span>
        <PreviewBar preview={preview} isRange={isRange} />
        <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
          {sentence}
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-black/[.12] px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-black/[.04] dark:border-white/[.18] dark:text-zinc-300 dark:hover:bg-white/[.06]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !preview.valid}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save date"}
        </button>
      </div>
    </div>
  );
}

function Segmented<T extends string | boolean>({
  options,
  value,
  onPick,
  ariaLabel,
}: {
  options: Array<[string, T]>;
  value: T;
  onPick: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-white/[.06]"
    >
      {options.map(([label, v]) => (
        <button
          key={label}
          type="button"
          aria-pressed={value === v}
          onClick={() => onPick(v)}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === v
              ? "bg-blue-600 text-white"
              : "text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.08]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function EndpointBlock({
  caption,
  ep,
  onChange,
}: {
  caption: string;
  ep: Endpoint;
  onChange: (ep: Endpoint) => void;
}) {
  const set = (patch: Partial<Endpoint>) => onChange({ ...ep, ...patch });
  const num = (key: "year" | "month" | "day" | "hour" | "minute") => (
    <input
      type="number"
      aria-label={`${caption} ${key}`}
      value={ep[key]}
      onChange={(e) => set({ [key]: parseInt(e.target.value || "0", 10) } as Partial<Endpoint>)}
      className="w-14 rounded border border-black/[.12] bg-transparent px-1.5 py-1 text-xs text-black outline-none focus:border-black/[.3] dark:border-white/[.18] dark:text-zinc-50"
    />
  );
  const yearLabel =
    ep.prec === "decade" ? "Decade" : ep.prec === "century" ? "Century" : "Year";

  return (
    <div className="rounded-md border border-dashed border-black/[.12] p-2 dark:border-white/[.18]">
      <div className="mb-1.5 text-[11px] font-semibold text-black dark:text-zinc-50">
        {caption}
      </div>
      <Segmented
        options={PRECISIONS.map((p) => [PREC_LABEL[p], p] as [string, Precision])}
        value={ep.prec}
        onPick={(p) => set({ prec: p })}
        ariaLabel={`${caption} precision`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {yearLabel}
        </span>
        {num("year")}
        <select
          aria-label={`${caption} era`}
          value={ep.era}
          onChange={(e) => set({ era: e.target.value as "AD" | "BC" })}
          className="rounded border border-black/[.12] bg-transparent px-1.5 py-1 text-xs text-black outline-none dark:border-white/[.18] dark:text-zinc-50 dark:[&>option]:bg-zinc-900"
        >
          <option value="AD">AD</option>
          <option value="BC">BC</option>
        </select>
        {FIELDS[ep.prec].includes("month") && (
          <>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Mon</span>
            {num("month")}
          </>
        )}
        {FIELDS[ep.prec].includes("day") && (
          <>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Day</span>
            {num("day")}
          </>
        )}
        {FIELDS[ep.prec].includes("hour") && (
          <>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Hr</span>
            {num("hour")}
          </>
        )}
        {FIELDS[ep.prec].includes("minute") && (
          <>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Min</span>
            {num("minute")}
          </>
        )}
      </div>
    </div>
  );
}

function PreviewBar({
  preview,
  isRange,
}: {
  preview: {
    valid: boolean;
    lo: number;
    hi: number;
    sLo: number;
    sHi: number;
    eLo: number;
    eHi: number;
  };
  isRange: boolean;
}) {
  const W = 340;
  const span = preview.hi - preview.lo || 1;
  const margin = span * 0.08;
  const LO = preview.lo - margin;
  const HI = preview.hi + margin;
  const x = (ms: number) => 4 + ((ms - LO) / (HI - LO)) * (W - 8);
  const w = (a: number, b: number) => Math.max(x(b) - x(a), 2);

  if (!preview.valid) {
    return (
      <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
        End is before start.
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} 34`} width="100%" className="mt-1 block">
      {isRange ? (
        <>
          {/* start whisker (left), end whisker (right), solid certain span */}
          <rect x={x(preview.sLo)} y={15} width={w(preview.sLo, preview.sHi)} height={5} rx={2.5} fill="#2563eb" fillOpacity={0.35} />
          <rect x={x(preview.eLo)} y={15} width={w(preview.eLo, preview.eHi)} height={5} rx={2.5} fill="#2563eb" fillOpacity={0.35} />
          <rect x={x(preview.sHi)} y={10} width={w(preview.sHi, preview.eLo)} height={15} rx={3} fill="#2563eb" />
        </>
      ) : (
        <rect x={x(preview.sLo)} y={12} width={w(preview.sLo, preview.sHi)} height={11} rx={3} fill="#2563eb" fillOpacity={0.35} />
      )}
    </svg>
  );
}
