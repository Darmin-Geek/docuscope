"use client";

import { useCallback, useEffect, useState } from "react";
import type { FieldHistory, FieldVersion } from "@/lib/projects";

const EMPTY: FieldVersion[] = [];

// Loads an entity's field version history and exposes a per-field lookup.
// `loader` fetches the whole grouped history (file or information); pass `null`
// to disable fetching (e.g. an unsaved information entry that has no history
// yet). `reloadToken` re-runs the fetch when it changes — bump it after a
// Submit so freshly published edits appear, and include the entity id so
// switching entities refetches. Callers pass a `useCallback`-memoised loader so
// its identity is stable between renders and the effect doesn't refetch every
// render.
export function useFieldHistory(
  loader: (() => Promise<FieldHistory>) | null,
  reloadToken: unknown,
): {
  versionsFor: (field: string) => FieldVersion[];
} {
  const [history, setHistory] = useState<FieldHistory>({});
  const enabled = loader !== null;

  useEffect(() => {
    // Disabled: nothing to fetch. `versionsFor` masks any stale history below.
    if (!loader) return;
    let active = true;
    loader()
      .then((h) => {
        if (active) setHistory(h);
      })
      .catch(() => {
        // A failed load just leaves the popovers empty; not worth surfacing.
        if (active) setHistory({});
      });
    return () => {
      active = false;
    };
  }, [loader, reloadToken]);

  // While disabled, report no versions regardless of any history left in state.
  const versionsFor = useCallback(
    (field: string) => (enabled ? history[field] ?? EMPTY : EMPTY),
    [enabled, history],
  );

  return { versionsFor };
}
