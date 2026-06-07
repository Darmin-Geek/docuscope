"use client";

import { useState } from "react";
import {
  addContributor,
  createLabel,
  deleteLabel,
  removeContributor,
  updateLabel,
  updateProjectTitle,
  type Label,
} from "@/lib/projects";
import LabelPill from "./LabelPill";

type ProjectSettingsModalProps = {
  projectId: string;
  title: string;
  labels: Label[];
  contributors: string[];
  // The signed-in user's email, so the UI can stop them removing themselves
  // (which, under the security rules, would instantly revoke their own access).
  currentUserEmail: string;
  onTitleSaved: (title: string) => void;
  onLabelCreated: (label: Label) => void;
  onLabelUpdated: (label: Label) => void;
  onLabelDeleted: (labelId: string) => void;
  onContributorAdded: (email: string) => void;
  onContributorRemoved: (email: string) => void;
  onClose: () => void;
};

// A fresh label starts neutral gray; the user tweaks it inline afterwards.
const NEW_LABEL_COLOR = "#9ca3af";

export default function ProjectSettingsModal({
  projectId,
  title,
  labels,
  contributors,
  currentUserEmail,
  onTitleSaved,
  onLabelCreated,
  onLabelUpdated,
  onLabelDeleted,
  onContributorAdded,
  onContributorRemoved,
  onClose,
}: ProjectSettingsModalProps) {
  const [titleValue, setTitleValue] = useState(title);
  // Local working copy so name/color edits feel instant; each change is also
  // persisted to Firestore and pushed up to the parent on blur.
  const [draftLabels, setDraftLabels] = useState<Label[]>(labels);
  // Local copy of the contributor list, kept in step with Firestore as the user
  // adds and removes people, plus the email being typed into the add field.
  const [draftContributors, setDraftContributors] =
    useState<string[]>(contributors);
  const [newContributor, setNewContributor] = useState("");
  // The contributor email awaiting a remove confirmation, or null when no
  // confirmation dialog is open.
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedCurrentUser = currentUserEmail.trim().toLowerCase();

  function fail(err: unknown, fallback: string) {
    setError(err instanceof Error ? err.message : fallback);
  }

  async function handleAddContributor() {
    const normalized = newContributor.trim().toLowerCase();
    if (!normalized) return;
    if (draftContributors.includes(normalized)) {
      setNewContributor("");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await addContributor(projectId, normalized);
      setDraftContributors((prev) => [...prev, normalized]);
      setNewContributor("");
      onContributorAdded(normalized);
    } catch (err) {
      fail(err, "Failed to add the contributor.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveContributor(email: string) {
    setError(null);
    setBusy(true);
    try {
      await removeContributor(projectId, email);
      setDraftContributors((prev) => prev.filter((c) => c !== email));
      onContributorRemoved(email);
      setPendingRemoval(null);
    } catch (err) {
      fail(err, "Failed to remove the contributor.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    const trimmed = titleValue.trim();
    if (trimmed === title.trim()) return;
    setError(null);
    try {
      await updateProjectTitle(projectId, trimmed);
      onTitleSaved(trimmed);
    } catch (err) {
      fail(err, "Failed to save the title.");
    }
  }

  function editDraft(labelId: string, fields: Partial<Label>) {
    setDraftLabels((prev) =>
      prev.map((label) =>
        label.id === labelId ? { ...label, ...fields } : label,
      ),
    );
  }

  // Persist a label's current draft (name + color) when the user finishes
  // editing it. Only writes when something actually changed.
  async function commitLabel(labelId: string) {
    const draft = draftLabels.find((label) => label.id === labelId);
    const original = labels.find((label) => label.id === labelId);
    if (!draft) return;
    if (
      original &&
      original.label === draft.label &&
      original.color === draft.color
    ) {
      return;
    }
    setError(null);
    try {
      await updateLabel(projectId, labelId, {
        label: draft.label,
        color: draft.color,
      });
      onLabelUpdated({ ...draft, label: draft.label.trim() });
    } catch (err) {
      fail(err, "Failed to save the label.");
    }
  }

  async function handleAddLabel() {
    setError(null);
    setBusy(true);
    try {
      const created = await createLabel(projectId, "New label", NEW_LABEL_COLOR);
      setDraftLabels((prev) => [...prev, created]);
      onLabelCreated(created);
    } catch (err) {
      fail(err, "Failed to create the label.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteLabel(labelId: string) {
    setError(null);
    setBusy(true);
    try {
      await deleteLabel(projectId, labelId);
      setDraftLabels((prev) => prev.filter((label) => label.id !== labelId));
      onLabelDeleted(labelId);
    } catch (err) {
      fail(err, "Failed to delete the label.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Project Settings
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

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto">
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Title
            <input
              type="text"
              value={titleValue}
              onChange={(event) => setTitleValue(event.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveTitle();
                }
              }}
              className="rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-base text-black outline-none focus:border-black dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Contributors
            </span>
            <div className="flex flex-col gap-2">
              {draftContributors.map((email) => {
                const isSelf = email === normalizedCurrentUser;
                return (
                  <div key={email} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-black dark:text-zinc-50">
                      {email}
                      {isSelf && (
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {" "}
                          (you)
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingRemoval(email)}
                      disabled={busy || isSelf}
                      aria-label={`Remove ${email}`}
                      title={
                        isSelf
                          ? "You can't remove yourself from a project"
                          : undefined
                      }
                      className="shrink-0 text-xl leading-none text-zinc-400 hover:text-red-600 disabled:opacity-50 disabled:hover:text-zinc-400 dark:hover:text-red-400"
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="email"
                placeholder="name@example.com"
                value={newContributor}
                onChange={(event) => setNewContributor(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleAddContributor();
                  }
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-black/[.12] bg-transparent px-2 text-sm text-black outline-none focus:border-black dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
              />
              <button
                type="button"
                onClick={() => void handleAddContributor()}
                disabled={busy || newContributor.trim().length === 0}
                className="shrink-0 text-sm font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
              >
                Add
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Labels
            </span>
            <div className="flex flex-col gap-2">
              {draftLabels.map((label) => (
                <div key={label.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={label.color}
                    aria-label="Label color"
                    onChange={(event) =>
                      editDraft(label.id, { color: event.target.value })
                    }
                    onBlur={() => void commitLabel(label.id)}
                    className="h-8 w-8 shrink-0 cursor-pointer rounded border border-black/[.12] bg-transparent dark:border-white/[.18]"
                  />
                  <input
                    type="text"
                    value={label.label}
                    onChange={(event) =>
                      editDraft(label.id, { label: event.target.value })
                    }
                    onBlur={() => void commitLabel(label.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="h-8 min-w-0 flex-1 rounded-md border border-black/[.12] bg-transparent px-2 text-sm text-black outline-none focus:border-black dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
                  />
                  <LabelPill label={label.label} color={label.color} />
                  <button
                    type="button"
                    onClick={() => void handleDeleteLabel(label.id)}
                    disabled={busy}
                    aria-label={`Delete ${label.label}`}
                    className="shrink-0 text-xl leading-none text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleAddLabel()}
              disabled={busy}
              className="self-start text-sm font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              + Add label
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>

    {pendingRemoval && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        onClick={() => {
          if (!busy) setPendingRemoval(null);
        }}
      >
        <div
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
          onClick={(event) => event.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50">
            Remove contributor?
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-black dark:text-zinc-50">
              {pendingRemoval}
            </span>{" "}
            will lose access to this project, and any files they have checked out
            will be unlocked for others to edit.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setPendingRemoval(null)}
              disabled={busy}
              className="flex h-9 items-center justify-center rounded-full border border-solid border-black/[.12] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.18] dark:hover:bg-[#1a1a1a]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleRemoveContributor(pendingRemoval)}
              disabled={busy}
              className="flex h-9 items-center justify-center rounded-full bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
