"use client";

import { type Project } from "@/lib/projects";
import FolderView from "./FolderView";

type ProjectViewProps = {
  project: Project;
  onBack: () => void;
};

export default function ProjectView({ project, onBack }: ProjectViewProps) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center gap-4 border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to projects"
          className="flex h-9 items-center justify-center rounded-full border border-solid border-black/[.08] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          ← Projects
        </button>
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {project.title || "Untitled project"}
        </h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <FolderView projectId={project.id} />
        <main className="flex-1 overflow-y-auto p-6" />
      </div>
    </div>
  );
}
