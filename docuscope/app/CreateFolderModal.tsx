"use client";

import { useState, type FormEvent } from "react";

type CreateFolderModalProps = {
  // Name of the folder the new folder will be nested under, or null when the
  // new folder will be created at the project root.
  parentFolderName: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
};

export default function CreateFolderModal({
  parentFolderName,
  onClose,
  onCreate,
}: CreateFolderModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onCreate(name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">
            New Folder
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            &times;
          </button>
        </div>

        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          {parentFolderName
            ? `Inside “${parentFolderName}”`
            : "At the project root"}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Folder name
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-base text-black outline-none focus:border-black dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex h-12 items-center justify-center rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Please wait…" : "Create Folder"}
          </button>
        </form>
      </div>
    </div>
  );
}
