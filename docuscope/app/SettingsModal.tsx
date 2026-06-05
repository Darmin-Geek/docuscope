"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getUserProfile, setUserName } from "@/lib/users";
import type { User } from "@/lib/auth";

type SettingsModalProps = {
  user: User;
  onClose: () => void;
};

export default function SettingsModal({ user, onClose }: SettingsModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load the current name so the field reflects what's already saved.
  useEffect(() => {
    let active = true;
    getUserProfile(user.uid)
      .then((profile) => {
        if (active && profile) {
          setName(profile.name);
        }
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Could not load your profile.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [user.uid]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await setUserName(user.uid, name.trim());
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
            Settings
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
            Name
            <input
              type="text"
              autoFocus
              disabled={loading}
              value={name}
              placeholder={loading ? "Loading…" : "Your full name"}
              onChange={(event) => setName(event.target.value)}
              className="rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-base text-black outline-none focus:border-black disabled:opacity-60 dark:border-white/[.18] dark:text-zinc-50 dark:focus:border-white"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || submitting}
            className="mt-2 flex h-12 items-center justify-center rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}
