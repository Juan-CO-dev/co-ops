/**
 * THE DIRTY-EDITOR LOCK (disclosure doctrine D10) — pure, client-safe.
 *
 * Collapsed content conditional-renders, EXCEPT a drawer holding unsaved edits: it stays mounted and locked
 * open, and so does every disclosure that encloses it. Collapsing one would unmount the editor and silently
 * throw its draft away (Astra chunk E #4). Every toggle of a disclosure that can hold an editor goes through
 * `toggleDisclosure`, and its rendered state through `disclosureIsOpen`.
 */

/** Rendered open: the person's choice, or forced open while it holds a dirty editor. */
export function disclosureIsOpen(open: boolean, lockedByDirty: boolean): boolean {
  return open || lockedByDirty;
}

/** The next state after a tap: a dirty disclosure stays open (the collapse is a no-op); a clean one flips. */
export function toggleDisclosure(open: boolean, lockedByDirty: boolean): boolean {
  return lockedByDirty ? true : !open;
}

// ─── several editors under one disclosure (Astra chunk F review #3) ──────────

/** One editor's key under a disclosure scope: `${scope}/${part}` (e.g. a position's "adjust" and "rate" controls). */
export function editorKey(scope: string, part: string): string {
  return `${scope}/${part}`;
}

/** The dirty set after one editor reports: each editor is tracked on its OWN key, never folded into its scope. */
export function withDirty(prev: ReadonlySet<string>, key: string, dirty: boolean): ReadonlySet<string> {
  if (prev.has(key) === dirty) return prev;
  const next = new Set(prev);
  if (dirty) next.add(key); else next.delete(key);
  return next;
}

/** A scope is dirty while ANY of its editors is (a clean editor never clears a dirty sibling). */
export function dirtyUnder(dirty: ReadonlySet<string>, scope: string): boolean {
  const prefix = `${scope}/`;
  for (const k of dirty) if (k.startsWith(prefix)) return true;
  return false;
}
