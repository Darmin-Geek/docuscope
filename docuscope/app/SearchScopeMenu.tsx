"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SEARCH_FIELD_GROUPS,
  ALL_SEARCH_FIELDS,
  type SearchField,
  type SearchFieldGroup,
} from "@/lib/searchScope";

// The "Scope" control shown beside the search box (issue #27, UI idea A). It
// lets the user narrow the full-text search to any subset of fields. The scope
// is a set of enabled field keys; a set covering every field means "search
// everything" (the default). This is a controlled component — all state lives
// in the parent, which persists it.

type SearchScopeMenuProps = {
  scope: Set<SearchField>;
  onChange: (next: Set<SearchField>) => void;
};

// Tri-state of a group's parent checkbox given how many of its fields are on.
type GroupState = "all" | "some" | "none";

function groupState(group: SearchFieldGroup, scope: Set<SearchField>): GroupState {
  const on = group.fields.filter((f) => scope.has(f.key)).length;
  if (on === 0) return "none";
  if (on === group.fields.length) return "all";
  return "some";
}

// A checkbox box rendered by state: on (✓), partial (–), or off (empty).
function Box({ state }: { state: "on" | "partial" | "off" }) {
  const base =
    "flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] font-bold";
  if (state === "off") {
    return <span className={`${base} border-zinc-400 dark:border-zinc-500`} />;
  }
  return (
    <span
      className={`${base} border-blue-600 bg-blue-600 text-white ${
        state === "partial" ? "bg-blue-400 dark:bg-blue-500" : ""
      }`}
    >
      {state === "on" ? "✓" : "–"}
    </span>
  );
}

export default function SearchScopeMenu({ scope, onChange }: SearchScopeMenuProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const isEverything = scope.size >= ALL_SEARCH_FIELDS.length;
  const enabledCount = scope.size;

  // Close on outside click or Escape while the popover is open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleField(field: SearchField) {
    const next = new Set(scope);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    onChange(next);
  }

  function toggleGroup(group: SearchFieldGroup) {
    const next = new Set(scope);
    const state = groupState(group, scope);
    if (state === "all") {
      for (const f of group.fields) next.delete(f.key);
    } else {
      for (const f of group.fields) next.add(f.key);
    }
    onChange(next);
  }

  function setPreset(fields: SearchField[]) {
    onChange(new Set(fields));
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The preset segment: "Everything" plus one preset per group.
  const presets = useMemo(
    () => [
      { key: "all", label: "Everything", fields: ALL_SEARCH_FIELDS },
      ...SEARCH_FIELD_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        fields: g.fields.map((f) => f.key),
      })),
    ],
    [],
  );

  function presetActive(fields: SearchField[]): boolean {
    return (
      fields.length === scope.size && fields.every((f) => scope.has(f))
    );
  }

  return (
    <div ref={rootRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Search scope"
        className="flex h-full items-center gap-1.5 rounded-full border border-black/[.08] px-3 py-2 text-sm text-black transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.06]"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isEverything ? "bg-zinc-400 dark:bg-zinc-500" : "bg-blue-500"
          }`}
        />
        Scope
        {!isEverything && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            · {enabledCount}
          </span>
        )}
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Configure search scope"
          className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-black/[.08] bg-white p-3 shadow-xl dark:border-white/[.145] dark:bg-zinc-900"
        >
          {/* Preset quick-picks */}
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const active = presetActive(p.fields);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.fields)}
                  aria-label={`Scope preset: ${p.label}`}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-black/[.12] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.18] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="my-3 border-t border-black/[.08] dark:border-white/[.145]" />

          {/* Grouped, expandable field checkboxes */}
          <div className="flex flex-col gap-1">
            {SEARCH_FIELD_GROUPS.map((group) => {
              const state = groupState(group, scope);
              const canExpand = group.fields.length > 1;
              const isExpanded = expanded.has(group.key);
              return (
                <div key={group.key}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      className="flex flex-1 items-center gap-2 rounded px-1 py-1 text-left text-sm text-black hover:bg-black/[.04] dark:text-zinc-50 dark:hover:bg-white/[.06]"
                    >
                      <Box
                        state={
                          state === "all"
                            ? "on"
                            : state === "some"
                              ? "partial"
                              : "off"
                        }
                      />
                      <span className="font-medium">{group.label}</span>
                    </button>
                    {canExpand && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(group.key)}
                        aria-label={
                          isExpanded
                            ? `Collapse ${group.label}`
                            : `Expand ${group.label}`
                        }
                        aria-expanded={isExpanded}
                        className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
                      >
                        {isExpanded ? "▴" : "▾"}
                      </button>
                    )}
                  </div>

                  {canExpand && isExpanded && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-black/[.08] pl-3 dark:border-white/[.145]">
                      {group.fields.map((field) => (
                        <button
                          key={field.key}
                          type="button"
                          onClick={() => toggleField(field.key)}
                          className="flex items-center gap-2 rounded px-1 py-1 text-left text-sm text-zinc-700 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                        >
                          <Box state={scope.has(field.key) ? "on" : "off"} />
                          {field.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="my-3 border-t border-black/[.08] dark:border-white/[.145]" />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPreset(ALL_SEARCH_FIELDS)}
              disabled={isEverything}
              className="text-xs text-blue-600 hover:underline disabled:cursor-default disabled:text-zinc-400 disabled:no-underline dark:text-blue-400 dark:disabled:text-zinc-600"
            >
              ↺ Search everything
            </button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {isEverything
                ? "All fields"
                : `${enabledCount} of ${ALL_SEARCH_FIELDS.length} fields`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
