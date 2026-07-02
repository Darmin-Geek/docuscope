"use client";

import type { ReactNode } from "react";
import {
  RELIABILITY_OPTIONS,
  CREDIBILITY_OPTIONS,
  type AdmiraltyOption,
} from "@/lib/admiralty";

// The Admiralty-code dropdown shown next to the free-text Reliability /
// Credibility fields on files and information entries (issue #80). Starts blank
// (null) and offers the A-F / 1-6 options; the full definition of the selected
// code is shown beneath so the rater sees what the rating means. Reused by both
// FileSidebar and InformationSidebar.

type AdmiraltyCodeSelectProps = {
  label: string;
  kind: "reliability" | "credibility";
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  // Optional control rendered beside the label (e.g. a version-history button).
  labelAccessory?: ReactNode;
};

export default function AdmiraltyCodeSelect({
  label,
  kind,
  value,
  onChange,
  disabled = false,
  labelAccessory,
}: AdmiraltyCodeSelectProps) {
  const options: AdmiraltyOption[] =
    kind === "reliability" ? RELIABILITY_OPTIONS : CREDIBILITY_OPTIONS;
  const selected = options.find((o) => o.code === value) ?? null;

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs font-medium text-black dark:text-zinc-50">
        {label}
        {labelAccessory}
      </span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={disabled}
        className="h-7 min-w-0 rounded-md border border-black/[.08] bg-transparent px-2 text-xs text-black outline-none focus:border-black/[.25] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-50 dark:focus:border-white/[.4] dark:[color-scheme:dark]"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code} — {o.label}
          </option>
        ))}
      </select>
      {selected && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {selected.description}
        </span>
      )}
    </label>
  );
}
