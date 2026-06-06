"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthChange, logOut, type User } from "@/lib/auth";
import { getProjectsForUser, type Project } from "@/lib/projects";
import { getUserProfile } from "@/lib/users";
import AuthModal, { type AuthMode } from "./AuthModal";
import ResetPasswordModal from "./ResetPasswordModal";
import SettingsModal from "./SettingsModal";
import CreateProjectModal from "./CreateProjectModal";
import ProjectView from "./ProjectView";

// Remembers which project the user last opened so a page reload returns them to
// that project's view instead of the project list. Scoped per-browser only.
const SELECTED_PROJECT_KEY = "docuscope:selectedProjectId";

function readStoredProjectId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(SELECTED_PROJECT_KEY);
}

function storeSelectedProjectId(id: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (id) {
    window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
  } else {
    window.localStorage.removeItem(SELECTED_PROJECT_KEY);
  }
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  // Whether we've already attempted to restore the last-opened project for this
  // session. The restore should run only on the first project load after
  // sign-in, never on later refreshes (e.g. after creating a project), so it
  // can't yank a user off the list view they're intentionally looking at.
  const restoredSelectionRef = useRef(false);
  // True while that first load + restore decision is in flight. We show a
  // spinner (rather than the project list) until it resolves, so a reload that
  // reopens a project doesn't flash the list on the way to the project view.
  const [restoringSelection, setRestoringSelection] = useState(true);

  // Select (or clear) a project and remember the choice so a reload reopens it.
  const selectProject = useCallback((project: Project | null) => {
    setSelectedProject(project);
    storeSelectedProjectId(project?.id ?? null);
  }, []);

  const loadProjects = useCallback(async (email: string) => {
    const isInitialLoad = !restoredSelectionRef.current;
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const loaded = await getProjectsForUser(email);
      setProjects(loaded);
      // On the first load after sign-in, reopen the project the user last had
      // open if it's still one of theirs.
      if (isInitialLoad) {
        restoredSelectionRef.current = true;
        const storedId = readStoredProjectId();
        const stored = storedId
          ? loaded.find((project) => project.id === storedId)
          : undefined;
        if (stored) {
          setSelectedProject(stored);
        } else if (storedId) {
          // The stored project is gone (deleted or access revoked); drop it.
          storeSelectedProjectId(null);
        }
      }
    } catch (err) {
      setProjectsError(
        err instanceof Error ? err.message : "Failed to load projects.",
      );
    } finally {
      setProjectsLoading(false);
      // The restore decision is now made; reveal the resolved view.
      if (isInitialLoad) {
        setRestoringSelection(false);
      }
    }
  }, []);

  useEffect(() => {
    // The auth callback fires asynchronously when auth state resolves/changes,
    // so it's the right place to kick off the per-user project load.
    const unsubscribe = onAuthChange((nextUser) => {
      setUser(nextUser);
      setLoading(false);
      if (nextUser?.email) {
        loadProjects(nextUser.email);
      } else {
        setProjects([]);
        // Forget the open project on sign-out and allow the next sign-in to
        // restore its own last-opened project.
        selectProject(null);
        restoredSelectionRef.current = false;
        // Spin again on the next sign-in while that user's projects load.
        setRestoringSelection(true);
        // Clear any previous name immediately on sign-out / account switch; the
        // effect below loads the new one when a user is present.
        setName(null);
      }
    });
    return unsubscribe;
  }, [loadProjects, selectProject]);

  // Load the signed-in user's display name (null when they haven't set one).
  const refreshName = useCallback((currentUser: User) => {
    return getUserProfile(currentUser.uid).then((profile) => {
      const trimmed = profile?.name.trim();
      setName(trimmed ? trimmed : null);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }
    let active = true;
    getUserProfile(user.uid)
      .then((profile) => {
        if (!active) {
          return;
        }
        const trimmed = profile?.name.trim();
        setName(trimmed ? trimmed : null);
      })
      .catch(() => {
        // The read can be rejected if the user signs out while it is still in
        // flight (the now-null auth fails the Firestore rules). That's expected
        // during sign-out, so swallow it rather than surfacing an unhandled
        // rejection; the auth listener has already cleared the name.
      });
    return () => {
      active = false;
    };
  }, [user]);

  // While auth is resolving, or while a signed-in user's projects load for the
  // first time (and we decide whether to reopen their last project), show a
  // spinner. This resolves directly into either the project view or the project
  // list, so neither flashes before the other. Placed after all hooks so the
  // early returns never skip one.
  if (loading || (user && restoringSelection)) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <div
          role="status"
          aria-label="Loading"
          className="h-10 w-10 animate-spin rounded-full border-2 border-black/[.12] border-t-black/70 dark:border-white/[.18] dark:border-t-white/80"
        />
      </div>
    );
  }

  // Once a project is opened, the project view takes over the whole window.
  if (user && selectedProject) {
    return (
      <ProjectView
        project={selectedProject}
        authorName={name}
        onBack={() => {selectProject(null); setSelectedProject(null);}}

        userId={user.uid}
      />
    );
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      {!loading && user && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-solid border-black/[.08] text-xl transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          ⚙
        </button>
      )}

      <main className="flex w-full max-w-3xl flex-col items-center gap-8 px-16 py-32">
        {loading ? null : user ? (
          <div className="flex w-full flex-col items-center gap-8">
            <div className="flex w-full flex-col items-center gap-6">
              <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
                Welcome{name ? ` ${name}` : ""}
              </h1>
              <button
                type="button"
                onClick={() => logOut()}
                className="flex h-12 w-40 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                Log Out
              </button>
            </div>

            <section className="flex w-full flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                  Your Projects
                </h2>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                >
                  Create Project
                </button>
              </div>

              {projectsLoading ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Loading projects…
                </p>
              ) : projectsError ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {projectsError}
                </p>
              ) : projects.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  You haven&apos;t been added to any projects yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {projects.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => selectProject(project)}
                        className="w-full rounded-xl border border-black/[.08] px-4 py-3 text-left transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                      >
                        <span className="text-base font-medium text-black dark:text-zinc-50">
                          {project.title || "Untitled project"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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

      {!loading && !user && (
        <footer className="absolute bottom-6 left-0 right-0 flex justify-center">
          <button
            type="button"
            onClick={() => setResettingPassword(true)}
            className="text-sm font-medium text-zinc-500 underline-offset-4 transition-colors hover:text-black hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Reset Password
          </button>
        </footer>
      )}

      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />
      )}

      {resettingPassword && (
        <ResetPasswordModal onClose={() => setResettingPassword(false)} />
      )}

      {settingsOpen && user && (
        <SettingsModal
          user={user}
          onClose={() => {
            setSettingsOpen(false);
            // Ignore a rejection here too (e.g. signing out as settings close).
            refreshName(user).catch(() => {});
          }}
        />
      )}

      {creating && user?.email && (
        <CreateProjectModal
          creatorEmail={user.email}
          onClose={() => setCreating(false)}
          onCreated={() => loadProjects(user.email!)}
        />
      )}
    </div>
  );
}
