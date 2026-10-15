/**
 * B11a-floor — closing count lines (temps, counts) save themselves. Pure decisions for
 * components/ChecklistItem.tsx, client-safe (zero I/O).
 *
 *   · sanitizeCountInput — a count/temperature is ≥ 0, so a "-" can never be typed
 *     (opening's OpeningCountInput.tsx does the same at input level).
 *   · parseCountDraft    — "" → null; a finite number ≥ 0 → the number; anything else → "invalid".
 *   · shouldAutoSaveCount — leaving the panel saves ONLY when the box holds a valid value, that
 *     value (or the note) differs from what is already saved, and no save is in flight. So
 *     Enter-then-blur never double-saves, and blurring an empty box does nothing (no
 *     missing_count error).
 *   · isAboveSafeMax     — the out-of-range warning (non-blocking): strictly above the line's
 *     safe max, the same comparison as lib/fridge-registry.ts isHotReading.
 */

export function sanitizeCountInput(raw: string): string {
  return raw.replace(/-/g, "");
}

export function parseCountDraft(draft: string): number | null | "invalid" {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

function normNote(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

export function shouldAutoSaveCount(args: {
  draft: string;
  notesDraft: string;
  liveCount: number | null | undefined;
  liveNotes: string | null | undefined;
  saving: boolean;
}): boolean {
  if (args.saving) return false;
  const parsed = parseCountDraft(args.draft);
  if (parsed === null || parsed === "invalid") return false;
  const countChanged = args.liveCount === null || args.liveCount === undefined || parsed !== args.liveCount;
  const notesChanged = normNote(args.notesDraft) !== normNote(args.liveNotes);
  return countChanged || notesChanged;
}

export function isAboveSafeMax(value: number | null | "invalid", safeMaxF: number | null | undefined): boolean {
  if (safeMaxF === null || safeMaxF === undefined || !Number.isFinite(safeMaxF)) return false;
  return typeof value === "number" && value > safeMaxF;
}
