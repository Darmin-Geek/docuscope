"use client";

import { useState } from "react";
import type { FieldVersion } from "@/lib/projects";

type FieldHistoryPopoverProps = {
  // Versions newest-first.
  versions: FieldVersion[];
  formatValue?: (value: string | null) => string;
};

// How long a value can get before it's clamped behind a "Show more" toggle.
const CLAMP_CHARS = 140;

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function VersionValue({
  text,
  empty,
}: {
  text: string;
  empty: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (empty) {
    return <span className="italic text-zinc-400 dark:text-zinc-500">(empty)</span>;
  }
  const isLong = text.length > CLAMP_CHARS;
  const shown = isLong && !expanded ? `${text.slice(0, CLAMP_CHARS)}…` : text;
  return (
    <span className="whitespace-pre-wrap break-words">
      {shown}
      {isLong && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="ml-1 text-[11px] font-medium text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </span>
  );
}

// The popover body: a compact, newest-first list of a single field's versions,
// each showing the value, who made the edit, and when. Rendered absolutely
// beneath the clock button in FieldHistoryButton.
export default function FieldHistoryPopover({
  versions,
  formatValue,
}: FieldHistoryPopoverProps) {
  return (
    <div
      role="dialog"
      aria-label="Version history"
      className="absolute left-0 top-6 z-20 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-black/[.12] bg-white p-1 shadow-lg dark:border-white/[.18] dark:bg-zinc-900"
    >
      {versions.length === 0 ? (
        <p className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          No previous versions.
        </p>
      ) : (
        <ul>
          {versions.map((version, index) => {
            const empty = version.value === null || version.value === "";
            const text = empty
              ? ""
              : formatValue
                ? formatValue(version.value)
                : version.value ?? "";
            return (
              <li
                key={`${version.createdAt}-${index}`}
                className="border-b border-black/[.06] px-2 py-1.5 last:border-b-0 dark:border-white/[.08]"
              >
                <div className="text-xs text-black dark:text-zinc-50">
                  <VersionValue text={text} empty={empty} />
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {version.editorName} · {formatTimestamp(version.createdAt)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
