"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "react-oidc-context";
import type { User } from "@/lib/auth";
import { getProjectsForUser, type Project } from "@/lib/projects";
import { getUserProfile } from "@/lib/users";
import SettingsModal from "./SettingsModal";
import CreateProjectModal from "./CreateProjectModal";
import ProjectView from "./ProjectView";

const SELECTED_PROJECT_KEY = "docuscope:selectedProjectId";

function readStoredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SELECTED_PROJECT_KEY);
}

function storeSelectedProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
  } else {
    window.localStorage.removeItem(SELECTED_PROJECT_KEY);
  }
}

export default function Home() {
  const auth = useAuth();

  // Derive a stable User from the OIDC session; null when not authenticated.
  // An expired session still leaves a (stale) user object in localStorage, so
  // treat an expired token as logged out — otherwise we'd show the project list
  // to a user whose API calls all fail with "not authenticated".
  const user = useMemo<User | null>(() => {
    if (!auth.user || auth.user.expired) return null;
    return {
      uid: auth.user.profile.sub,
      email: (auth.user.profile.email as string | undefined) ?? null,
    };
  }, [auth.user]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const restoredSelectionRef = useRef(false);
  const [restoringSelection, setRestoringSelection] = useState(true);

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
      if (isInitialLoad) {
        restoredSelectionRef.current = true;
        const storedId = readStoredProjectId();
        const stored = storedId
          ? loaded.find((p) => p.id === storedId)
          : undefined;
        if (stored) {
          setSelectedProject(stored);
        } else if (storedId) {
          storeSelectedProjectId(null);
        }
      }
    } catch (err) {
      setProjectsError(
        err instanceof Error ? err.message : "Failed to load projects.",
      );
    } finally {
      setProjectsLoading(false);
      if (isInitialLoad) setRestoringSelection(false);
    }
  }, []);

  // React to sign-in / sign-out.
  useEffect(() => {
    if (auth.isLoading) return;
    if (user?.email) {
      loadProjects(user.email);
    } else if (!auth.isAuthenticated) {
      setProjects([]);
      selectProject(null);
      restoredSelectionRef.current = false;
      setRestoringSelection(true);
      setName(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isLoading, auth.isAuthenticated, user?.uid, user?.email]);

  // Load the signed-in user's display name.
  const refreshName = useCallback((currentUser: User) => {
    return getUserProfile(currentUser.uid).then((profile) => {
      const trimmed = profile?.name.trim();
      setName(trimmed ? trimmed : null);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    getUserProfile(user.uid)
      .then((profile) => {
        if (active) {
          const trimmed = profile?.name.trim();
          setName(trimmed ? trimmed : null);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  // Show a spinner while OIDC is resolving or while the initial project load
  // (and localStorage restore) is in flight.
  if (auth.isLoading || (user && restoringSelection)) {
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

  if (user && selectedProject) {
    return (
      <ProjectView
        project={selectedProject}
        authorName={name}
        onBack={() => {
          selectProject(null);
          setSelectedProject(null);
        }}
        userId={user.uid}
        userEmail={user.email ?? ""}
      />
    );
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      {user && (
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
        {user ? (
          <div className="flex w-full flex-col items-center gap-8">
            <div className="flex w-full flex-col items-center gap-6">
              <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
                Welcome{name ? ` ${name}` : ""}
              </h1>
              <button
                type="button"
                onClick={() => void auth.removeUser()}
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
          // Both buttons redirect to Cognito's hosted UI where users can sign
          // in with an existing account or sign up for a new one.
          <div className="flex flex-col gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() => void auth.signinRedirect()}
              className="flex h-12 w-40 items-center justify-center rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => void auth.signinRedirect()}
              className="flex h-12 w-40 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Log In
            </button>
          </div>
        )}
      </main>

      {settingsOpen && user && (
        <SettingsModal
          user={user}
          onClose={() => {
            setSettingsOpen(false);
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
