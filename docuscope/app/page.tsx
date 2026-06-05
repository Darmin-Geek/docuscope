"use client";

import { useEffect, useState } from "react";
import { onAuthChange, logOut, type User } from "@/lib/auth";
import AuthModal, { type AuthMode } from "./AuthModal";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthChange((nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center gap-8 px-16 py-32">
        {loading ? null : user ? (
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
              Welcome {user.email}
            </h1>
            <button
              type="button"
              onClick={() => logOut()}
              className="flex h-12 w-40 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Log Out
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() => setAuthMode("signup")}
              className="flex h-12 w-40 items-center justify-center rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("login")}
              className="flex h-12 w-40 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Log In
            </button>
          </div>
        )}
      </main>

      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />
      )}
    </div>
  );
}
