"use client";

import { useState, type FormEvent } from "react";
import { resetPassword } from "@/lib/auth";

type ResetPasswordModalProps = {
  onClose: () => void;
};

export default function ResetPasswordModal({
  onClose,
}: ResetPasswordModalProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email);
      setSent(true);
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
            Reset Password
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

        {sent ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            If an account exists for <span className="font-medium">{email}</span>
            , a password reset link is on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Email
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
              {submitting ? "Please wait…" : "Send Reset Link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
