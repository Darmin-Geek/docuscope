"use client";

import { useCallback, useEffect, useState } from "react";
import { getFiles, uploadFile, type FileDoc, type Project } from "@/lib/projects";
import FolderView from "./FolderView";
import FilesTable from "./FilesTable";

type ProjectViewProps = {
  project: Project;
  // The signed-in user's display name, used as the author of uploaded files.
  // Null when they haven't set one, in which case the author is left blank.
  authorName: string | null;
  onBack: () => void;
};

export default function ProjectView({
  project,
  authorName,
  onBack,
}: ProjectViewProps) {
  // The selected folder is owned here so both the folder tree and the file
  // table stay in sync: null means "show every file in the project", otherwise
  // only the selected folder's files are shown.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);

  const loadFiles = useCallback(() => {
    return getFiles(project.id, selectedFolderId)
      .then((result) => {
        setFiles(result);
        setFilesError(null);
      })
      .catch((err: unknown) => {
        setFilesError(
          err instanceof Error ? err.message : "Failed to load files.",
        );
      });
  }, [project.id, selectedFolderId]);

  // Reload whenever the project or selected folder changes. The active guard
  // discards a stale response that resolves after the deps have moved on.
  useEffect(() => {
    let active = true;
    getFiles(project.id, selectedFolderId)
      .then((result) => {
        if (!active) return;
        setFiles(result);
        setFilesError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setFilesError(
          err instanceof Error ? err.message : "Failed to load files.",
        );
      })
      .finally(() => {
        if (active) setFilesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project.id, selectedFolderId]);

  async function handleUpload(file: File) {
    await uploadFile(project.id, file, authorName, selectedFolderId);
    await loadFiles();
  }

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
        <FolderView
          projectId={project.id}
          selectedId={selectedFolderId}
          onSelectChange={setSelectedFolderId}
          onUpload={handleUpload}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <FilesTable files={files} loading={filesLoading} error={filesError} />
        </main>
      </div>
    </div>
  );
}
