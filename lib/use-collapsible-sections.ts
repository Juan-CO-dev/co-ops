"use client";

/**
 * useCollapsibleSections - open/closed state for one form's sections.
 *
 *  - Initial state: first unfinished section open, the rest collapsed
 *    (lib/collapsible-sections.ts defaultOpenMap), computed ONCE at mount so
 *    sections do not jump shut under the user's finger as they finish items.
 *  - After mount, remembered per-device states (localStorage, try/catch) are
 *    layered on top. Read in an effect, never during render, so SSR and the
 *    first client render agree (no hydration mismatch).
 *  - `toggle` remembers; `reveal` (a validation problem) opens + scrolls and does
 *    NOT persist: it is a transient "look here", not a preference.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyStoredOpen,
  collapseStorageKey,
  defaultOpenMap,
  getBrowserStorage,
  revealOpenMap,
  scrollSectionIntoView,
  toggledOpen,
  writeStoredOpen,
  type SectionProgress,
} from "@/lib/collapsible-sections";

export interface CollapsibleSections {
  isOpen: (sectionId: string) => boolean;
  toggle: (sectionId: string) => void;
  /** Open these sections and scroll the first into view (validation problems). */
  reveal: (sectionIds: readonly string[]) => void;
  /** Set one section's state without remembering it (e.g. scroll-past auto-collapse). */
  setOpenTransient: (sectionId: string, open: boolean) => void;
}

export function useCollapsibleSections(
  formKey: string,
  sections: readonly SectionProgress[],
  initialOpen?: Record<string, boolean>,
): CollapsibleSections {
  const [open, setOpen] = useState<Record<string, boolean>>(() => initialOpen ?? defaultOpenMap(sections));
  const idsRef = useRef<string[]>([]);
  const openRef = useRef(open);
  // Mirror latest values for the stable callbacks below (written after commit, never during render).
  useEffect(() => {
    idsRef.current = sections.map((s) => s.id);
    openRef.current = open;
  });

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!storage) return;
    setOpen((prev) => applyStoredOpen(prev, formKey, idsRef.current, storage));
  }, [formKey]);

  const isOpen = useCallback((id: string) => open[id] === true, [open]);

  const toggle = useCallback(
    (id: string) => {
      const next = toggledOpen(openRef.current, id);
      writeStoredOpen(getBrowserStorage(), collapseStorageKey(formKey, id), next);
      setOpen((prev) => ({ ...prev, [id]: next }));
    },
    [formKey],
  );

  const reveal = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      setOpen((prev) => revealOpenMap(prev, ids));
      scrollSectionIntoView(formKey, ids[0]!);
    },
    [formKey],
  );

  const setOpenTransient = useCallback((id: string, value: boolean) => {
    setOpen((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));
  }, []);

  return { isOpen, toggle, reveal, setOpenTransient };
}
