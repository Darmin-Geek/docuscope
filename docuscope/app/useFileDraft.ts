"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDraft,
  saveDraft,
  submitDraft,
  discardDraft as discardDraftApi,
  getInformation,
  getSelections,
  type FileDoc,
  type FileDraftSnapshot,
} from "@/lib/projects";

// One working snapshot per open file, shared by FileSidebar (metadata),
// InformationSidebar (information rows) and PdfViewerModal (selections) so that
// Save/Submit persist everything together (issue #78).
//
// Lifecycle:
//   - On open: fetch the published values (file + information + selections) and
//     any stored draft. Seed the working snapshot from the *published* values.
//     A stored draft is NOT auto-applied — resolution is deferred to check-out
//     time via the conflict prompt (see DraftConflictModal); until the user
//     chooses, the editor shows the published values.
//   - Save: PUT the working snapshot to the draft store. Main tables untouched.
//   - Submit: POST the working snapshot to /submit (publishes + clears draft),
//     then re-seed from the now-published values.
//   - applyDraft: load the stored draft into the working snapshot.
//   - discardDraft: DELETE the stored draft, then re-seed from published values.

export type FileDraft = {
  snapshot: FileDraftSnapshot;
  dirty: boolean;
  // A stored draft exists server-side for this (file, user).
  hasDraft: boolean;
  // hasDraft AND the stored draft would overwrite an already-filled published
  // field (drives the check-out conflict prompt).
  conflictsOnCheckout: boolean;
  loading: boolean;
  saving: boolean;
  submitting: boolean;
  error: string | null;
  // transient status line: "saved" | "submitted" | null
  status: "saved" | "submitted" | null;

  setMetadata: (patch: Partial<FileDraftSnapshot["metadata"]>) => void;
  upsertInformation: (info: FileDraftSnapshot["information"][number]) => void;
  removeInformation: (id: string) => void;
  upsertSelection: (
    informationId: string,
    selection: FileDraftSnapshot["information"][number]["selections"][number],
  ) => void;
  removeSelection: (informationId: string, selectionId: string) => void;

  save: () => Promise<void>;
  submit: () => Promise<void>;
  applyDraft: () => void;
  discardDraft: () => Promise<void>;
};

// The editable metadata fields, used for both seeding and the conflict check.
const META_FIELDS = [
  "author",
  "createdDate",
  "overallBias",
  "source",
  "fileReliability",
  "fileCredibility",
] as const;

function metadataFromFile(file: FileDoc): FileDraftSnapshot["metadata"] {
  return {
    author: file.author,
    createdDate: file.createdDate,
    overallBias: file.overallBias,
    source: file.source,
    fileReliability: file.fileReliability,
    fileCredibility: file.fileCredibility,
  };
}

// A draft "overwrites a filled-in field" if, for any metadata field, the
// published value is non-empty and the draft differs from it, OR if the file
// already has published information rows the draft would replace. Kept here so
// the modal trigger and tests share one definition (plan §4.2).
export function draftOverwritesFilledField(
  publishedMeta: FileDraftSnapshot["metadata"],
  publishedInformationCount: number,
  draft: FileDraftSnapshot,
): boolean {
  const metaConflict = META_FIELDS.some((f) => {
    const pub = publishedMeta[f];
    return pub != null && pub !== "" && draft.metadata[f] !== pub;
  });
  const infoConflict = publishedInformationCount > 0;
  return metaConflict || infoConflict;
}

function emptySnapshot(): FileDraftSnapshot {
  return {
    metadata: {
      author: null,
      createdDate: null,
      overallBias: null,
      source: null,
      fileReliability: null,
      fileCredibility: null,
    },
    information: [],
  };
}

export function useFileDraft(
  projectId: string,
  file: FileDoc | null,
): FileDraft {
  const fileId = file?.id ?? null;

  const [snapshot, setSnapshot] = useState<FileDraftSnapshot>(emptySnapshot);
  // The published baseline (used to detect "dirty" and to re-seed). Held in
  // state so the conflict predicate can read it during render.
  const [baseline, setBaseline] = useState<FileDraftSnapshot>(emptySnapshot);
  const [dirty, setDirty] = useState(false);

  const [storedDraft, setStoredDraft] = useState<FileDraftSnapshot | null>(null);
  const [publishedInfoCount, setPublishedInfoCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "submitted" | null>(null);

  // Build the published snapshot (metadata + information + each row's
  // selections) for the given file.
  const loadPublished = useCallback(
    async (f: FileDoc): Promise<FileDraftSnapshot> => {
      const information = await getInformation(projectId, f.id);
      const withSelections = await Promise.all(
        information.map(async (info) => {
          const selections = await getSelections(projectId, f.id, info.id);
          return {
            id: info.id,
            informationTitle: info.informationTitle,
            informationText: info.informationText,
            overallBias: info.overallBias,
            informationReliability: info.informationReliability,
            informationCredibility: info.informationCredibility,
            selections: selections.map((s) => ({
              id: s.id,
              pageIndex: s.pageIndex,
              boundingTop: s.boundingTop,
              boundingLeft: s.boundingLeft,
              rects: s.rects,
              text: s.text,
            })),
          };
        }),
      );
      return { metadata: metadataFromFile(f), information: withSelections };
    },
    [projectId],
  );

  // Seed from the published values whenever the file changes; load any stored
  // draft so the editor can detect conflicts at check-out time.
  useEffect(() => {
    if (!file) {
      setSnapshot(emptySnapshot());
      setBaseline(emptySnapshot());
      setStoredDraft(null);
      setPublishedInfoCount(0);
      setDirty(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setStatus(null);
    Promise.all([loadPublished(file), getDraft(projectId, file.id)])
      .then(([published, draft]) => {
        if (!active) return;
        setSnapshot(published);
        setBaseline(published);
        setPublishedInfoCount(published.information.length);
        setStoredDraft(draft);
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load draft.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, fileId, loadPublished]);

  // ── mutators ──────────────────────────────────────────────────────────────

  const setMetadata = useCallback(
    (patch: Partial<FileDraftSnapshot["metadata"]>) => {
      setSnapshot((prev) => ({ ...prev, metadata: { ...prev.metadata, ...patch } }));
      setDirty(true);
      setStatus(null);
    },
    [],
  );

  const upsertInformation = useCallback(
    (info: FileDraftSnapshot["information"][number]) => {
      setSnapshot((prev) => {
        const idx = prev.information.findIndex((i) => i.id === info.id);
        const information =
          idx === -1
            ? [...prev.information, info]
            : prev.information.map((i) => (i.id === info.id ? info : i));
        return { ...prev, information };
      });
      setDirty(true);
      setStatus(null);
    },
    [],
  );

  const removeInformation = useCallback((id: string) => {
    setSnapshot((prev) => ({
      ...prev,
      information: prev.information.filter((i) => i.id !== id),
    }));
    setDirty(true);
    setStatus(null);
  }, []);

  const upsertSelection = useCallback(
    (
      informationId: string,
      selection: FileDraftSnapshot["information"][number]["selections"][number],
    ) => {
      setSnapshot((prev) => ({
        ...prev,
        information: prev.information.map((info) => {
          if (info.id !== informationId) return info;
          const idx = info.selections.findIndex((s) => s.id === selection.id);
          const selections =
            idx === -1
              ? [...info.selections, selection]
              : info.selections.map((s) =>
                  s.id === selection.id ? selection : s,
                );
          return { ...info, selections };
        }),
      }));
      setDirty(true);
      setStatus(null);
    },
    [],
  );

  const removeSelection = useCallback(
    (informationId: string, selectionId: string) => {
      setSnapshot((prev) => ({
        ...prev,
        information: prev.information.map((info) =>
          info.id === informationId
            ? {
                ...info,
                selections: info.selections.filter((s) => s.id !== selectionId),
              }
            : info,
        ),
      }));
      setDirty(true);
      setStatus(null);
    },
    [],
  );

  // ── actions ───────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await saveDraft(projectId, file.id, snapshot);
      setStoredDraft(snapshot);
      setDirty(false);
      setStatus("saved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [projectId, file, snapshot]);

  const submit = useCallback(async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitDraft(projectId, file.id, snapshot);
      // The draft is gone server-side; the snapshot is now the published truth.
      setBaseline(snapshot);
      setStoredDraft(null);
      setPublishedInfoCount(snapshot.information.length);
      setDirty(false);
      setStatus("submitted");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  }, [projectId, file, snapshot]);

  // Load the stored draft into the working snapshot (the "Use my draft" choice).
  const applyDraft = useCallback(() => {
    if (!storedDraft) return;
    setSnapshot(storedDraft);
    setDirty(true);
    setStatus(null);
  }, [storedDraft]);

  // Delete the stored draft and re-seed from the published baseline (the
  // "Discard my draft" choice).
  const discardDraft = useCallback(async () => {
    if (!file) return;
    setError(null);
    try {
      await discardDraftApi(projectId, file.id);
      setStoredDraft(null);
      setSnapshot(baseline);
      setDirty(false);
      setStatus(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to discard draft.");
    }
  }, [projectId, file, baseline]);

  const hasDraft = storedDraft != null;
  const conflictsOnCheckout =
    hasDraft &&
    draftOverwritesFilledField(
      baseline.metadata,
      publishedInfoCount,
      storedDraft,
    );

  return {
    snapshot,
    dirty,
    hasDraft,
    conflictsOnCheckout,
    loading,
    saving,
    submitting,
    error,
    status,
    setMetadata,
    upsertInformation,
    removeInformation,
    upsertSelection,
    removeSelection,
    save,
    submit,
    applyDraft,
    discardDraft,
  };
}
