"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getFiles,
  getLabels,
  uploadFile,
  type FileDoc,
  type Label,
  type Project,
} from "@/lib/projects";
import FolderView from "./FolderView";
import FilesTable from "./FilesTable";
import FileSidebar from "./FileSidebar";
import ProjectSettingsModal from "./ProjectSettingsModal";

type ProjectViewProps = {
  project: Project;
  // The signed-in user's display name, used as the author of uploaded files.
  // Null when they haven't set one, in which case the author is left blank.
  authorName: string | null;
  // The signed-in user's Firebase auth uid, used to claim/recognise the file
  // check-out lock so the sidebar can tell "me" from "another editor".
  userId: string;
  // The signed-in user's email, used by project settings to manage the
  // contributor list (and stop them removing themselves).
  userEmail: string;
  onBack: () => void;
};

export default function ProjectView({
  project,
  authorName,
  userId,
  userEmail,
  onBack,
}: ProjectViewProps) {
  // The selected folder is owned here so both the folder tree and the file
  // table stay in sync: null means "show every file in the project", otherwise
  // only the selected folder's files are shown.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  // The file whose metadata sidebar is open, or null when it's closed.
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // The project's labels, plus the editable title and settings modal state.
  // Title is held locally so a rename in settings updates the header at once.
  const [title, setTitle] = useState(project.title);
  const [labels, setLabels] = useState<Label[]>([]);
  // Held locally so add/remove in settings updates the list without a refetch.
  const [contributors, setContributors] = useState<string[]>(
    project.contributors,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Labels currently filtering the file table. A file must carry every selected
  // label to appear; an empty set means no filtering.
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
    new Set(),
  );

  // Load the project's labels once per project.
  useEffect(() => {
    let active = true;
    getLabels(project.id)
      .then((result) => {
        if (active) setLabels(result);
      })
      .catch(() => {
        // Labels are non-critical chrome; ignore load failures silently.
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  // Plain click selects a single label (or clears it when it's the only one
  // selected); shift-click toggles the label within the current selection.
  function handleToggleLabel(labelId: string, additive: boolean) {
    setSelectedLabelIds((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (next.has(labelId)) next.delete(labelId);
        else next.add(labelId);
        return next;
      }
      if (prev.size === 1 && prev.has(labelId)) return new Set();
      return new Set([labelId]);
    });
  }

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

  // Reflect a saved metadata edit locally so the table updates without a refetch.
  function handleFileSaved(updated: FileDoc) {
    setFiles((prev) =>
      prev.map((file) => (file.id === updated.id ? updated : file)),
    );
  }

  // Apply a label add/remove against the freshest file state. Adding two labels
  // in quick succession must accumulate rather than clobber, so the mutation is
  // expressed as a function of the current label list, not a stale snapshot.
  function handleFileLabelsChanged(
    fileId: string,
    nextLabels: (current: string[]) => string[],
  ) {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === fileId
          ? { ...file, labels: nextLabels(file.labels) }
          : file,
      ),
    );
  }

  // Within the already-loaded files (the project, or the selected folder), keep
  // only those carrying every selected label. No selection means no filtering.
  const visibleFiles = useMemo(() => {
    if (selectedLabelIds.size === 0) return files;
    return files.filter((file) =>
      [...selectedLabelIds].every((id) => file.labels.includes(id)),
    );
  }, [files, selectedLabelIds]);

  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 font-sans dark:bg-black">
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
          {title || "Untitled project"}
        </h1>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Project settings"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-solid border-black/[.08] text-lg transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          ⚙
        </button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <FolderView
          projectId={project.id}
          selectedId={selectedFolderId}
          onSelectChange={setSelectedFolderId}
          onUpload={handleUpload}
          labels={labels}
          selectedLabelIds={selectedLabelIds}
          onToggleLabel={handleToggleLabel}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <FilesTable
            files={visibleFiles}
            loading={filesLoading}
            error={filesError}
            labels={labels}
            selectedId={selectedFileId}
            onSelectFile={(file) => setSelectedFileId(file.id)}
          />
        </main>
        {selectedFile && (
          <FileSidebar
            // Remount on file change so the form resets to the new file's values.
            key={selectedFile.id}
            projectId={project.id}
            file={selectedFile}
            labels={labels}
            userId={userId}
            onClose={() => setSelectedFileId(null)}
            onSaved={handleFileSaved}
            onLabelsChanged={handleFileLabelsChanged}
          />
        )}
      </div>

      {settingsOpen && (
        <ProjectSettingsModal
          projectId={project.id}
          title={title}
          labels={labels}
          contributors={contributors}
          currentUserEmail={userEmail}
          onTitleSaved={setTitle}
          onContributorAdded={(email) =>
            setContributors((prev) =>
              prev.includes(email) ? prev : [...prev, email],
            )
          }
          onContributorRemoved={(email) =>
            setContributors((prev) => prev.filter((c) => c !== email))
          }
          onLabelCreated={(label) =>
            // Guard against adding a label that is already present: the labels
            // load effect reads from Firestore and may have already included a
            // freshly-created doc, so a plain append can duplicate it by id.
            setLabels((prev) =>
              prev.some((existing) => existing.id === label.id)
                ? prev
                : [...prev, label],
            )
          }
          onLabelUpdated={(label) =>
            setLabels((prev) =>
              prev.map((existing) =>
                existing.id === label.id ? label : existing,
              ),
            )
          }
          onLabelDeleted={(labelId) => {
            setLabels((prev) => prev.filter((label) => label.id !== labelId));
            // deleteLabel() strips the label from every file in Firestore; mirror
            // that in the loaded files so the table/sidebar don't keep a stale id.
            setFiles((prev) =>
              prev.map((file) =>
                file.labels.includes(labelId)
                  ? { ...file, labels: file.labels.filter((id) => id !== labelId) }
                  : file,
              ),
            );
            // Drop the deleted label from any active filter so it can't linger.
            setSelectedLabelIds((prev) => {
              if (!prev.has(labelId)) return prev;
              const next = new Set(prev);
              next.delete(labelId);
              return next;
            });
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
