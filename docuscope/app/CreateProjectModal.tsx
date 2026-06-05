"use client";

import { useState, type FormEvent } from "react";
import { createProject } from "@/lib/projects";

type CreateProjectModalProps = {
  creatorEmail: string;
  onClose: () => void;
  onCreated: () => void;
};

export default function CreateProjectModal({
  creatorEmail,
  onClose,
  onCreated,
}: CreateProjectModalProps) {
  const [title, setTitle] = useState("");
  // Contributors are entered one-per-row; start with a single empty field.
  const [contributors, setContributors] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateContributor(index: number, value: string) {
    setContributors((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  function addContributorField() {
    setContributors((prev) => [...prev, ""]);
  }

  function removeContributorField(index: number) {
    setContributors((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const emails = contributors
        .map((email) => email.trim())
        .filter((email) => email.length > 0);
      await createProject(title, creatorEmail, emails);
      onCreated();
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
            Create Project
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Title
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-base text-black outline-none focus:border-black dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
            />
          </label>

          <div className="flex flex-col gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Contributors
            {contributors.map((email, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => updateContributor(index, event.target.value)}
                  className="flex-1 rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-base text-black outline-none focus:border-black dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
                />
                {contributors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeContributorField(index)}
                    aria-label="Remove contributor"
                    className="text-xl leading-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addContributorField}
              className="self-start text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              + Add another contributor
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex h-12 items-center justify-center rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Please wait…" : "Create Project"}
          </button>
        </form>
      </div>
    </div>
  );
}
