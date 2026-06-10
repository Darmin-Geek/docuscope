"use client";

import { useState } from "react";

type RemoveRelationshipModalProps = {
  informationTitle: string;
  type: "corroborates" | "conflicts";
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export default function RemoveRelationshipModal({
  informationTitle,
  type,
  onCancel,
  onConfirm,
}: RemoveRelationshipModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const relationLabel =
    type === "corroborates" ? "corroborates with" : "conflicts with";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
          Remove relationship?
        </h2>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          {`Remove this "${relationLabel}" relationship with "${informationTitle || "Untitled"}"? This will also remove the link from the other information entry.`}
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex h-10 items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium text-black transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/[.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="flex h-10 items-center justify-center rounded-full bg-red-600 px-5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {submitting ? "Removing…" : "Yes, remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
