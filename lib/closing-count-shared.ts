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

/** A draft as it was when a save was sent, or as it is now. */
export interface CountDraftSnapshot {
  count: string;
  notes: string;
}

/** Did the closer change the box or the note after the save was sent? ("38" vs "38.0" is no change.) */
export function draftChangedSince(sent: CountDraftSnapshot, now: CountDraftSnapshot): boolean {
  const a = parseCountDraft(sent.count);
  const b = parseCountDraft(now.count);
  const countChanged =
    typeof a === "number" && typeof b === "number" ? a !== b : sent.count.trim() !== now.count.trim();
  return countChanged || normNote(sent.notes) !== normNote(now.notes);
}

/**
 * Astra r1 P2-1 — what a SUCCESSFUL count save does with the panel. The box and note stay
 * editable while a save is pending, so an edit made mid-save (38 → Enter → type 39) must never
 * be discarded:
 *   · nothing changed since the send            → "close" (clear drafts, close the panel);
 *   · changed, count-only line                  → "resave" (keep the panel and the newer draft,
 *                                                  save the newer revision right away);
 *   · changed, photo line                       → "keep_open" (keep the newer draft; the closer
 *                                                  taps Save — a photo line never autosaves).
 */
export function afterCountSaveSuccess(
  sent: CountDraftSnapshot,
  now: CountDraftSnapshot,
  countOnly: boolean,
): "close" | "resave" | "keep_open" {
  if (!draftChangedSince(sent, now)) return "close";
  return countOnly ? "resave" : "keep_open";
}
