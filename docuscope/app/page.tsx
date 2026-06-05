"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthChange, logOut, type User } from "@/lib/auth";
import { getProjectsForUser, type Project } from "@/lib/projects";
import { getUserProfile } from "@/lib/users";
import AuthModal, { type AuthMode } from "./AuthModal";
import SettingsModal from "./SettingsModal";
import CreateProjectModal from "./CreateProjectModal";
import ProjectView from "./ProjectView";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const loadProjects = useCallback(async (email: string) => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      setProjects(await getProjectsForUser(email));
    } catch (err) {
      setProjectsError(
        err instanceof Error ? err.message : "Failed to load projects.",
      );
    } finally {
      setProjectsLoading(false);
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
        setSelectedProject(null);
        // Clear any previous name immediately on sign-out / account switch; the
        // effect below loads the new one when a user is present.
        setName(null);
      }
    });
    return unsubscribe;
  }, [loadProjects]);

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
    getUserProfile(user.uid).then((profile) => {
      if (!active) {
        return;
      }
      const trimmed = profile?.name.trim();
      setName(trimmed ? trimmed : null);
    });
    return () => {
      active = false;
    };
  }, [user]);

  // Once a project is opened, the project view takes over the whole window.
  // Placed after all hooks so the early return never skips one.
  if (user && selectedProject) {
    return (
      <ProjectView
        project={selectedProject}
        authorName={name}
        onBack={() => setSelectedProject(null)}
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
                        onClick={() => setSelectedProject(project)}
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

      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} />
      )}

      {settingsOpen && user && (
        <SettingsModal
          user={user}
          onClose={() => {
            setSettingsOpen(false);
            refreshName(user);
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
