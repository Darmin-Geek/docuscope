"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isEmptyHtml, sanitizeHtml } from "@/lib/richText";

type RichTextEditorProps = {
  // Current value as HTML (or "" / legacy plain text). Controlled, like a
  // <textarea>: the parent owns the value and receives every change.
  value: string;
  // Emits sanitised HTML on every edit. "" when the editor is empty.
  onChange: (html: string) => void;
  // Read-only when true (= !isHeldByMe || lockedByOther in the sidebars).
  disabled?: boolean;
  placeholder?: string;
  // Maps to a min-height so the box matches the textarea rows it replaces.
  minRows?: number;
  // Accessible name for the editing surface (the sidebars pass the field label).
  ariaLabel?: string;
};

type Command = {
  key: string;
  label: string;
  title: string;
  // execCommand name and (for list commands) the queryCommandState name.
  command: string;
};

// The toolbar: exactly the marks the issue asks for. Kept small so the editor's
// output stays inside the sanitiser's allow-list.
const COMMANDS: Command[] = [
  { key: "bold", label: "B", title: "Bold", command: "bold" },
  { key: "italic", label: "I", title: "Italic", command: "italic" },
  { key: "underline", label: "U", title: "Underline", command: "underline" },
  { key: "strike", label: "S", title: "Strikethrough", command: "strikeThrough" },
  { key: "ul", label: "• List", title: "Bullet list", command: "insertUnorderedList" },
  { key: "ol", label: "1. List", title: "Numbered list", command: "insertOrderedList" },
];

// A controlled rich-text editor that mirrors the <textarea> contract it replaces
// (issue #81). Built on contentEditable + execCommand so it ships with no new
// dependency; its output is always passed through the shared allow-list
// sanitiser, so the component boundary is identical to a Tiptap-backed one and
// the choice stays reversible.
export default function RichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder,
  minRows = 3,
  ariaLabel,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // The last HTML we emitted, so an external `value` update can be told apart
  // from our own edit and we don't re-seed the DOM mid-typing (which would drop
  // the caret). Mirrors the sidebars' existing "am I editing?" guards.
  const lastEmitted = useRef<string>(value);
  const [activeMarks, setActiveMarks] = useState<Record<string, boolean>>({});

  // Seed / reconcile the DOM from `value`. Skip while the editor is focused (the
  // user is typing) unless the incoming value is genuinely different from what we
  // last emitted — e.g. switching the open information entry or a draft reload.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incoming = value ?? "";
    if (incoming === lastEmitted.current && el.innerHTML === lastEmitted.current) {
      return;
    }
    const isFocused = typeof document !== "undefined" && document.activeElement === el;
    if (isFocused && incoming === lastEmitted.current) return;
    if (el.innerHTML !== incoming) {
      el.innerHTML = incoming;
    }
    lastEmitted.current = incoming;
  }, [value]);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const clean = sanitizeHtml(el.innerHTML);
    lastEmitted.current = clean;
    onChange(clean);
  }, [onChange]);

  const refreshMarks = useCallback(() => {
    if (typeof document === "undefined") return;
    const next: Record<string, boolean> = {};
    for (const c of COMMANDS) {
      try {
        next[c.key] = document.queryCommandState(c.command);
      } catch {
        next[c.key] = false;
      }
    }
    setActiveMarks(next);
  }, []);

  const runCommand = useCallback(
    (command: string) => {
      const el = editorRef.current;
      if (!el || disabled) return;
      el.focus();
      try {
        document.execCommand(command, false);
      } catch {
        // execCommand is unavailable/blocked — leave the value untouched.
      }
      emit();
      refreshMarks();
    },
    [disabled, emit, refreshMarks],
  );

  // Keep the toolbar's active state in sync with the caret position.
  useEffect(() => {
    if (disabled) return;
    const handler = () => {
      const el = editorRef.current;
      if (el && document.activeElement === el) refreshMarks();
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [disabled, refreshMarks]);

  const minHeight = `${Math.max(minRows, 1) * 1.4 + 0.75}rem`;
  const showPlaceholder = isEmptyHtml(value);

  return (
    <div
      className={`rich-editor rounded-md border border-black/[.08] bg-transparent text-xs text-black focus-within:border-black/[.25] dark:border-white/[.145] dark:text-zinc-50 dark:focus-within:border-white/[.4] ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {!disabled && (
        <div className="flex flex-wrap gap-0.5 border-b border-black/[.08] px-1 py-1 dark:border-white/[.145]">
          {COMMANDS.map((c) => (
            <button
              key={c.key}
              type="button"
              // Keep the selection in the editor when a toolbar button is pressed.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runCommand(c.command)}
              aria-label={c.title}
              aria-pressed={activeMarks[c.key] ?? false}
              title={c.title}
              className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-semibold transition-colors hover:bg-black/[.06] dark:hover:bg-white/[.08] ${
                activeMarks[c.key]
                  ? "bg-black/[.08] text-black dark:bg-white/[.12] dark:text-zinc-50"
                  : "text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ""}
        data-empty={showPlaceholder ? "true" : "false"}
        onInput={emit}
        onBlur={emit}
        style={{ minHeight }}
        className={`rich-text px-2 py-1.5 outline-none ${
          disabled ? "cursor-not-allowed" : ""
        }`}
      />
    </div>
  );
}
