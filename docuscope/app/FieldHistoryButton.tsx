"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldVersion } from "@/lib/projects";
import FieldHistoryPopover from "./FieldHistoryPopover";

type FieldHistoryButtonProps = {
  // Name of the field this history belongs to, used for the button's aria-label.
  fieldLabel: string;
  // Versions for this field, newest-first (as returned by the history API).
  versions: FieldVersion[];
  // Optional formatter for a version's stored value (e.g. render a timestamp as
  // a date). Receives the raw text value; null means the field was empty.
  formatValue?: (value: string | null) => string;
  // When true the field stores sanitised HTML (issue #81): the popover renders
  // each version as formatted rich text instead of escaped plain text.
  renderRich?: boolean;
  // When true the button renders nothing — used for information entries that
  // aren't persisted yet and therefore have no history to show.
  hidden?: boolean;
};

// A small clock icon shown beside a field label. Clicking it toggles a popover
// listing that field's version history (value + editor + time), newest first.
// Viewing history is read-only, so the button is always enabled regardless of
// the file's check-out state.
export default function FieldHistoryButton({
  fieldLabel,
  versions,
  formatValue,
  renderRich = false,
  hidden = false,
}: FieldHistoryButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open || hidden) return;
    function onPointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, hidden]);

  if (hidden) return null;

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        // Sits inside a <label> in the sidebars; stop the click from focusing
        // the field's input and toggle the popover instead.
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        // A generic accessible name on purpose: a field-specific one (e.g.
        // "…Author") would collide with getByLabel("Author") since the button
        // sits inside the field's <label>. The tooltip keeps the field context.
        aria-label="Version history"
        aria-expanded={open}
        title={`Version history for ${fieldLabel}`}
        className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-black/[.06] hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-white/[.08] dark:hover:text-zinc-300"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M12 8v4l2.5 2.5" />
          <path d="M3.05 11a9 9 0 1 1 .5 4" />
          <path d="M3 4v4h4" />
        </svg>
      </button>
      {open && (
        <FieldHistoryPopover
          versions={versions}
          formatValue={formatValue}
          renderRich={renderRich}
        />
      )}
    </span>
  );
}
