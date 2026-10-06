/**
 * Collapsible checklist sections - PURE logic (no React, no DOM beyond a guarded
 * `window.localStorage` accessor). Wave 1 branch B (Juan's floor note: "collapsible
 * menu checklist sections. So that people don't scroll endlessly looking for things.").
 *
 * UI-only: nothing here touches a submit payload, API route or schema. Each form
 * keeps its OWN existing definition of "done" and hands this module the resulting
 * { done, total } per section; this module never decides what done means.
 *
 * Storage law: every localStorage access is wrapped in try/catch (Safari private
 * mode, blocked cookies and quota errors all THROW on access, not just on write).
 * With storage blocked the feature still works for the session; it just cannot
 * remember across visits.
 *
 * Note vs docs/DISCLOSURE_DOCTRINE.md D9 ("per-session useState only, no
 * localStorage"): that law binds admin/backend editors. The floor checklists are
 * a different surface and Juan's note asks for the device to remember, so this is
 * a deliberate, spec-directed exception (GO-coops-wave1 section B).
 */

export interface SectionProgress {
  /** Stable system key of the section (never a translated string). */
  id: string;
  /** Items done under the host form's own completeness rule. */
  done: number;
  /** Items in the section under the same rule. */
  total: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY_PREFIX = "co-ops:section-open:v1";

/** localStorage key for one section of one form. */
export function collapseStorageKey(formKey: string, sectionId: string): string {
  return `${KEY_PREFIX}:${formKey}:${sectionId}`;
}

/** DOM marker used to find a section for scroll-into-view. */
export function sectionDomKey(formKey: string, sectionId: string): string {
  return `${formKey}:${sectionId}`;
}

/** A section with nothing left to do (an empty section has nothing to do). */
export function isSectionFinished(p: Pick<SectionProgress, "done" | "total">): boolean {
  return p.done >= p.total;
}

/**
 * Starting state: the FIRST unfinished section is open; every other section
 * (finished or not) is collapsed. When everything is finished, all collapse.
 */
export function defaultOpenMap(sections: readonly SectionProgress[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  let opened = false;
  for (const s of sections) {
    if (!opened && !isSectionFinished(s)) {
      out[s.id] = true;
      opened = true;
    } else {
      out[s.id] = false;
    }
  }
  return out;
}

/** Ids of every unfinished section: the ones a refused submit should open. */
export function unfinishedSectionIds(sections: readonly SectionProgress[]): string[] {
  return sections.filter((s) => !isSectionFinished(s)).map((s) => s.id);
}

/** Pure toggle: the next open state for one section (missing = closed). */
export function toggledOpen(current: Record<string, boolean>, id: string): boolean {
  return !(current[id] === true);
}

/** The device's localStorage, or null when it is blocked / unavailable. */
export function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Remembered open state for a key; undefined when none, unreadable, or storage throws. */
export function readStoredOpen(storage: StorageLike | null, key: string): boolean | undefined {
  if (!storage) return undefined;
  try {
    const v = storage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Remember an open state. Never throws. */
export function writeStoredOpen(storage: StorageLike | null, key: string, open: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(key, open ? "1" : "0");
  } catch {
    // Quota / blocked storage: the toggle still works for this session.
  }
}

/** Layer remembered states over the computed defaults. */
export function applyStoredOpen(
  base: Record<string, boolean>,
  formKey: string,
  sectionIds: readonly string[],
  storage: StorageLike | null,
): Record<string, boolean> {
  const next = { ...base };
  for (const id of sectionIds) {
    const stored = readStoredOpen(storage, collapseStorageKey(formKey, id));
    if (stored !== undefined) next[id] = stored;
  }
  return next;
}

/** Every listed id becomes open (a validation problem is inside it). */
export function revealOpenMap(
  current: Record<string, boolean>,
  ids: readonly string[],
): Record<string, boolean> {
  const next = { ...current };
  for (const id of ids) next[id] = true;
  return next;
}

/** Scroll a section into view once it has been un-hidden. Safe on the server. */
export function scrollSectionIntoView(formKey: string, sectionId: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const key = sectionDomKey(formKey, sectionId);
  const run = () => {
    try {
      const el = Array.from(document.querySelectorAll("[data-collapsible-section]")).find(
        (n) => n.getAttribute("data-collapsible-section") === key,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      // Scrolling is a nicety; never let it break a submit path.
    }
  };
  // Two frames: React commits the un-hide first, then layout settles.
  window.requestAnimationFrame(() => window.requestAnimationFrame(run));
}
