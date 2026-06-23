"use client";

import { useState } from "react";

type DraftConflictModalProps = {
  // Load the stored draft into the editor (overwrites the shown published
  // values locally; nothing is written to the main tables until Submit).
  onUseDraft: () => void;
  // Delete the stored draft and keep the published values.
  onDiscardDraft: () => Promise<void>;
  // Dismiss without choosing. The safe default: the draft is kept (still
  // stored), and the editor keeps showing the published values, so no work is
  // silently lost either way.
  onClose: () => void;
};

// Shown on check-out when the user already holds a draft for this file whose
// values would overwrite an already-filled published field (see issue #78
// §4.2). The user must decide whether to bring their private draft into the
// editor or discard it before editing begins.
export default function DraftConflictModal({
  onUseDraft,
  onDiscardDraft,
  onClose,
}: DraftConflictModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDiscard() {
    setError(null);
    setBusy(true);
    try {
      await onDiscardDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved draft found"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
          Unsaved draft found
        </h2>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          You have an unsaved draft for this file that differs from its current
          values. Load your draft to keep editing it, or discard it to start
          from the saved values.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleDiscard()}
            disabled={busy}
            className="flex h-10 items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium text-black transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.06]"
          >
            {busy ? "Discarding…" : "Discard my draft"}
          </button>
          <button
            type="button"
            onClick={onUseDraft}
            disabled={busy}
            className="flex h-10 items-center justify-center rounded-full bg-black px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            Use my draft
          </button>
        </div>
      </div>
    </div>
  );
}
