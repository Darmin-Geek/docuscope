"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkInFile, checkOutFile, subscribeToFile } from "@/lib/projects";
import { getUserProfile } from "@/lib/users";

/**
 * Coordinated access to a single file's check-out lock (`checkedOutBy`, see
 * docs/dataModel.md). Lifted above the file detail and information sidebars so
 * the two panels share one lock: editing a file detail OR any of its
 * information checks the whole file out to the current user, which is exactly
 * what blocks every other contributor from touching either while it's held.
 */
export type FileLock = {
  /** True when someone else currently holds the file checked out. */
  lockedByOther: boolean;
  /** Resolved display name of the other holder, or null until/if it loads. */
  editorName: string | null;
  /**
   * Claim the lock for an editing session. Reference-counted so the file
   * detail and information panels can each hold it; the file only frees once
   * every session has released.
   */
  acquire: () => void;
  /** Release one editing session's hold on the lock. */
  release: () => void;
};

export function useFileLock(
  projectId: string,
  fileId: string | null,
  userId: string,
): FileLock {
  // The uid currently holding the file, kept live so a lock taken or released
  // by another user surfaces in both sidebars without a refresh. Tagged with the
  // file it came from so a snapshot for a previous file is ignored after a
  // switch (avoiding a reset effect that would cascade renders).
  const [held, setHeld] = useState<{ fileId: string; uid: string | null }>({
    fileId: "",
    uid: null,
  });
  const checkedOutBy = held.fileId === fileId ? held.uid : null;
  // The resolved profile of the holder, keyed by uid so a name fetched for a
  // previous holder is never shown for the current one.
  const [editor, setEditor] = useState<{ uid: string; name: string | null } | null>(
    null,
  );

  // How many editing sessions (focused field groups) currently want the lock,
  // and whether we have actually claimed it in Firestore. Refs so the live
  // subscription and focus handlers can coordinate without re-rendering.
  const holders = useRef(0);
  const holding = useRef(false);

  const lockedByOther = checkedOutBy != null && checkedOutBy !== userId;
  const editorName = editor?.uid === checkedOutBy ? editor.name : null;

  // Mirror the file's `checkedOutBy` so both panels see the same lock state. The
  // hold bookkeeping is reset here (and on cleanup below) so a new file never
  // inherits the previous one's session count.
  useEffect(() => {
    if (!fileId) return;
    holders.current = 0;
    holding.current = false;
    return subscribeToFile(projectId, fileId, (live) => {
      setHeld({ fileId, uid: live.checkedOutBy });
    });
  }, [projectId, fileId]);

  // Resolve the other editor's uid to a display name for the banners.
  useEffect(() => {
    if (!lockedByOther || checkedOutBy == null) return;
    let active = true;
    const holder = checkedOutBy;
    getUserProfile(holder)
      .then((profile) => {
        if (active) setEditor({ uid: holder, name: profile?.name.trim() || null });
      })
      .catch(() => {
        // Fall back to the generic label if the name won't load.
      });
    return () => {
      active = false;
    };
  }, [lockedByOther, checkedOutBy]);

  const acquire = useCallback(() => {
    if (!fileId) return;
    holders.current += 1;
    if (holding.current) return;
    holding.current = true;
    // Transactional claim: if another user wins the race we drop our hold and
    // the incoming snapshot disables the fields for everyone but the winner.
    checkOutFile(projectId, fileId, userId)
      .then((claimed) => {
        if (!claimed) holding.current = false;
      })
      .catch(() => {
        holding.current = false;
      });
  }, [projectId, fileId, userId]);

  const release = useCallback(() => {
    if (!fileId) return;
    if (holders.current > 0) holders.current -= 1;
    if (holders.current > 0) return;
    if (!holding.current) return;
    holding.current = false;
    void checkInFile(projectId, fileId);
  }, [projectId, fileId]);

  // Release the lock if the file changes or the view unmounts while we still
  // hold it, so the file never stays stuck checked out to us.
  useEffect(() => {
    return () => {
      if (!holding.current) return;
      holding.current = false;
      holders.current = 0;
      if (fileId) void checkInFile(projectId, fileId);
    };
  }, [projectId, fileId]);

  return { lockedByOther, editorName, acquire, release };
}
