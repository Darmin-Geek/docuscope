"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkInFile, checkOutFile, getFile } from "@/lib/projects";
import { getUserProfile } from "@/lib/users";

export type FileLock = {
  lockedByOther: boolean;
  // True when this user currently holds the file's check-out lock.
  isHeldByMe: boolean;
  editorName: string | null;
  acquire: () => void;
  release: () => void;
};

export function useFileLock(
  projectId: string,
  fileId: string | null,
  userId: string,
): FileLock {
  const [held, setHeld] = useState<{ fileId: string; uid: string | null }>({
    fileId: "",
    uid: null,
  });
  const checkedOutBy = held.fileId === fileId ? held.uid : null;
  const [editor, setEditor] = useState<{ uid: string; name: string | null } | null>(null);

  const holding = useRef(false);

  const lockedByOther = checkedOutBy != null && checkedOutBy !== userId;
  const isHeldByMe = checkedOutBy === userId;
  const editorName = editor?.uid === checkedOutBy ? editor.name : null;

  // On file change: fetch once to get the initial checkedOutBy and reset local lock state.
  useEffect(() => {
    if (!fileId) return;
    holding.current = false;
    let active = true;
    getFile(projectId, fileId)
      .then((f) => {
        // If the user acquired the lock locally while this initial read was in
        // flight, the response is stale — don't let it clobber the fresh
        // acquire (which would strand release(), leaving holding.current false).
        if (active && !holding.current) {
          // If the server already has us as the lock holder, keep holding.current
          // in sync so release() can fire the check-in API call correctly.
          holding.current = f.checkedOutBy === userId;
          setHeld({ fileId, uid: f.checkedOutBy });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, fileId, userId]);

  // While someone else holds the lock, poll every 3 s.
  // Stop (cleanup) when lockedByOther changes to false or fileId changes.
  useEffect(() => {
    if (!lockedByOther || !fileId) return;
    const interval = setInterval(() => {
      getFile(projectId, fileId)
        .then((f) => setHeld({ fileId, uid: f.checkedOutBy }))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [lockedByOther, projectId, fileId]);

  // Resolve the other editor's uid to a display name.
  useEffect(() => {
    if (!lockedByOther || checkedOutBy == null) return;
    let active = true;
    const holder = checkedOutBy;
    getUserProfile(holder)
      .then((profile) => {
        if (active) setEditor({ uid: holder, name: profile?.name.trim() || null });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [lockedByOther, checkedOutBy]);

  const acquire = useCallback(() => {
    if (!fileId || holding.current) return;
    holding.current = true;
    checkOutFile(projectId, fileId, userId)
      .then((claimed) => {
        if (!claimed) {
          // Lost the race; fetch current state so polling can begin.
          holding.current = false;
          getFile(projectId, fileId)
            .then((f) => setHeld({ fileId, uid: f.checkedOutBy }))
            .catch(() => {});
        } else {
          setHeld({ fileId, uid: userId });
        }
      })
      .catch(() => {
        holding.current = false;
      });
  }, [projectId, fileId, userId]);

  const release = useCallback(() => {
    if (!fileId || !holding.current) return;
    holding.current = false;
    setHeld({ fileId, uid: null });
    void checkInFile(projectId, fileId);
  }, [projectId, fileId]);

  // Release the lock if the file changes or the view unmounts while we still hold it.
  useEffect(() => {
    return () => {
      if (!holding.current) return;
      holding.current = false;
      if (fileId) {
        setHeld({ fileId, uid: null });
        void checkInFile(projectId, fileId);
      }
    };
  }, [projectId, fileId]);

  return { lockedByOther, isHeldByMe, editorName, acquire, release };
}
