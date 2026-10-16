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
