/**
 * Batch vs bottle — PHASE B: yield stats + drift nudges. PURE, client-safe (the `*-shared.ts`
 * pattern): zero I/O, no server imports. The server loader is lib/yield-stats.ts.
 *
 * The data is Phase A's (0215): every live `productions` header with `batches_made > 0` carries
 * `came_out_to` (the measured output, par units), `yield_at_time` (the card the fold's ONE graph
 * saw at save time) and `made_by` (the maker, not the editor). Nothing new is captured.
 *
 * JUAN'S RULINGS (2026-10-07, GO-coops-bvb-S-r4-phaseB): "Average of 10 batches and a nudge when
 * it's off 15%… also we need to track it being under and over… since under they are doing
 * something wrong and same if it's over." Minimum 6 batches before any nudge (CC). Both
 * directions are ERRORS, never good or bad: "coming out UNDER (−18%)" / "coming out OVER (+22%)".
 *
 * DEFINITIONS (the builder's stated choices; every one is pinned in tests/yield-stats-shared.test.ts):
 *   · A "batch" in the window is one batch HEADER (one prep session's entry: N batches made →
 *     came out to X). The variance view lists exactly these rows, so "the last 10 batches" is the
 *     last 10 headers, newest `produced_at` first (id breaks a tie, so the window is stable).
 *   · Per header, actual per batch = came_out_to / batches_made, compared with THAT header's own
 *     yield_at_time — a card edited mid-window never re-scores the batches made under the old card.
 *   · The window's average is batch-weighted: signedDrift = (Σ came_out_to − Σ batches×card) /
 *     Σ batches×card. A double batch counts twice, as it should; with one card and single batches
 *     it is exactly the plain mean of the per-batch drifts.
 *   · EDGE: exactly 15% off IS a nudge (|drift| ≥ 0.15). A 1e-9 tolerance absorbs float noise so
 *     8.5 against a card of 10 lands on the nudge side, as the arithmetic says it should.
 *   · Recipe level and maker level are computed INDEPENDENTLY: one maker +20% and another −20%
 *     can net to "fine" for the recipe while each maker still raises their own retrain item.
 *   · A Retrain note snoozes its scope (the recipe, or one maker on that recipe) until
 *     YIELD_STATS_WINDOW more batches in that scope were produced AFTER the note — by then the
 *     whole window is post-retrain, so the verdict is about the retrained behaviour only.
 */

/** Juan, 2026-10-07: the average is over the last 10 batches. */
export const YIELD_STATS_WINDOW = 10;
/** CC, 2026-10-07: no nudge before 6 batches, so one bad day cannot trigger it. */
export const YIELD_NUDGE_MIN_BATCHES = 6;
/** Juan, 2026-10-07: 15% off the recipe card, in EITHER direction. */
export const YIELD_NUDGE_DRIFT = 0.15;
/** Shift lead and up see the variance view, the nudges and the retrain items. */
export const YIELD_STATS_READ_MIN = 5;
/** GM: Update recipe yield (plus the recipe-edit step-up) and Retrain. */
export const YIELD_ACTION_MIN = 7;

const EDGE_EPSILON = 1e-9;

export interface YieldBatch {
  /** productions.id */
  id: string;
  /** productions.output_item_id — the batch recipe's single output item. */
  itemId: string;
  producedAt: string;
  /** productions.made_by — the maker; null on a header that predates attribution. */
  madeBy: string | null;
  batchesMade: number;
  cameOutTo: number;
  yieldAtTime: number;
}

export type YieldScope = "recipe" | "maker";

export interface RetrainNoteLite {
  id: string;
  itemId: string;
  scope: YieldScope;
  /** Set when scope = "maker"; null for a recipe-level note. */
  makerId: string | null;
  createdAt: string;
  snoozeBatches: number;
}

export type YieldDirection = "under" | "over" | "on_card";

export interface DriftSummary {
  /** Headers in the window. */
  count: number;
  /** Σ batches_made across the window. */
  batches: number;
  /** Average measured output per batch. */
  actualPerBatch: number;
  /** Average card per batch (the batch-weighted yield_at_time; equals the card when it never moved). */
  cardPerBatch: number;
  /** (actual − card) / card over the window; negative = UNDER, positive = OVER. */
  signedDrift: number;
  direction: YieldDirection;
  /** count ≥ YIELD_NUDGE_MIN_BATCHES. */
  enough: boolean;
  /** enough AND |signedDrift| ≥ YIELD_NUDGE_DRIFT. */
  flagged: boolean;
}

export interface SnoozeState {
  noteId: string;
  /** Batches in scope still to come before the nudge may speak again; 0 = expired. */
  remaining: number;
  snoozed: boolean;
}

export interface ScopeVerdict {
  window: YieldBatch[];
  summary: DriftSummary | null;
  snooze: SnoozeState | null;
  /** flagged AND not snoozed — the nudge / retrain item renders. */
  nudge: boolean;
}

export interface MakerVerdict extends ScopeVerdict {
  makerId: string;
}

export interface ItemYieldVerdict {
  itemId: string;
  recipe: ScopeVerdict & {
    /** Makers in the recipe window whose own batches there are ≥ 15% off, worst first. */
    outlierMakerIds: string[];
  };
  makers: MakerVerdict[];
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** A header the math can use: whole batches > 0, a measured output ≥ 0, a card > 0. */
export function isUsableBatch(b: YieldBatch): boolean {
  return finite(b.batchesMade) && b.batchesMade > 0 && finite(b.cameOutTo) && b.cameOutTo >= 0 && finite(b.yieldAtTime) && b.yieldAtTime > 0;
}

/** One header's own drift: (came_out_to / batches − yield_at_time) / yield_at_time. */
export function batchSignedDrift(b: YieldBatch): number {
  return (b.cameOutTo / b.batchesMade - b.yieldAtTime) / b.yieldAtTime;
}

/** Newest first by produced_at; id descending breaks a tie so the window never wobbles. */
export function newestFirst(batches: YieldBatch[]): YieldBatch[] {
  return [...batches].sort((a, b) => {
    const ta = Date.parse(a.producedAt);
    const tb = Date.parse(b.producedAt);
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** The last `size` usable headers, newest first. */
export function lastWindow(batches: YieldBatch[], size: number = YIELD_STATS_WINDOW): YieldBatch[] {
  return newestFirst(batches.filter(isUsableBatch)).slice(0, size);
}

export function directionOf(signedDrift: number): YieldDirection {
  if (Math.abs(signedDrift) < EDGE_EPSILON) return "on_card";
  return signedDrift < 0 ? "under" : "over";
}

/** |drift| ≥ 15%, with the float tolerance stated in the header. Exactly 15% is a nudge. */
export function isOffCard(signedDrift: number): boolean {
  return Math.abs(signedDrift) >= YIELD_NUDGE_DRIFT - EDGE_EPSILON;
}

/** The window's batch-weighted verdict; null when the window is empty. */
export function summarizeDrift(window: YieldBatch[]): DriftSummary | null {
  const usable = window.filter(isUsableBatch);
  if (usable.length === 0) return null;
  let actual = 0;
  let expected = 0;
  let batches = 0;
  for (const b of usable) {
    actual += b.cameOutTo;
    expected += b.batchesMade * b.yieldAtTime;
    batches += b.batchesMade;
  }
  const signedDrift = (actual - expected) / expected;
  const enough = usable.length >= YIELD_NUDGE_MIN_BATCHES;
  return {
    count: usable.length,
    batches,
    actualPerBatch: actual / batches,
    cardPerBatch: expected / batches,
    signedDrift,
    direction: directionOf(signedDrift),
    enough,
    flagged: enough && isOffCard(signedDrift),
  };
}

/**
 * The latest note in scope snoozes until `snoozeBatches` more in-scope batches were produced
 * after it. `inScope` must already be filtered to the scope (the recipe's, or one maker's on it).
 */
export function snoozeState(inScope: YieldBatch[], notes: RetrainNoteLite[]): SnoozeState | null {
  if (notes.length === 0) return null;
  const latest = [...notes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))[0]!;
  const at = Date.parse(latest.createdAt);
  const after = inScope.filter((b) => isUsableBatch(b) && Date.parse(b.producedAt) > at).length;
  const remaining = Math.max(0, latest.snoozeBatches - after);
  return { noteId: latest.id, remaining, snoozed: remaining > 0 };
}

function verdict(inScope: YieldBatch[], notes: RetrainNoteLite[]): ScopeVerdict {
  const window = lastWindow(inScope);
  const summary = summarizeDrift(window);
  const snooze = snoozeState(inScope, notes);
  return { window, summary, snooze, nudge: !!summary?.flagged && !snooze?.snoozed };
}

/** Makers in `window` whose own headers there are off the card (no minimum: this NAMES, it never nudges). */
export function outlierMakers(window: YieldBatch[]): string[] {
  const byMaker = new Map<string, YieldBatch[]>();
  for (const b of window) {
    if (!b.madeBy) continue;
    const l = byMaker.get(b.madeBy) ?? [];
    l.push(b);
    byMaker.set(b.madeBy, l);
  }
  const out: Array<{ id: string; drift: number }> = [];
  for (const [id, list] of byMaker) {
    const s = summarizeDrift(list);
    if (s && isOffCard(s.signedDrift)) out.push({ id, drift: Math.abs(s.signedDrift) });
  }
  return out.sort((a, b) => b.drift - a.drift || (a.id < b.id ? -1 : 1)).map((o) => o.id);
}

/**
 * Everything for ONE item (= one batch recipe) at ONE location. `batches` and `notes` must
 * already be scoped to that item and location by the loader.
 */
export function evaluateItem(itemId: string, batches: YieldBatch[], notes: RetrainNoteLite[]): ItemYieldVerdict {
  const mine = batches.filter((b) => b.itemId === itemId);
  const myNotes = notes.filter((n) => n.itemId === itemId);
  const recipe = verdict(mine, myNotes.filter((n) => n.scope === "recipe"));
  const makerIds = [...new Set(mine.map((b) => b.madeBy).filter((v): v is string => !!v))].sort();
  const makers: MakerVerdict[] = makerIds.map((makerId) => ({
    makerId,
    ...verdict(
      mine.filter((b) => b.madeBy === makerId),
      myNotes.filter((n) => n.scope === "maker" && n.makerId === makerId),
    ),
  }));
  return { itemId, recipe: { ...recipe, outlierMakerIds: outlierMakers(recipe.window) }, makers };
}

/**
 * The signed percent for a label: always signed, one decimal at most, "−" (U+2212) for under.
 * "+22%", "−18%", "+15.5%", "0%". Spanish writes the decimal with a comma.
 */
export function formatSignedPct(signedDrift: number, language: "en" | "es" = "en"): string {
  const pct = Math.round(Math.abs(signedDrift) * 1000) / 10;
  if (pct === 0) return "0%";
  const sign = signedDrift < 0 ? "−" : "+";
  const body = String(pct);
  return `${sign}${language === "es" ? body.replace(".", ",") : body}%`;
}

/** The i18n key that labels a direction; the caller interpolates `{pct}` = formatSignedPct(…). */
export function directionKey(direction: YieldDirection): "yield.direction.under" | "yield.direction.over" | "yield.direction.on_card" {
  return direction === "under" ? "yield.direction.under" : direction === "over" ? "yield.direction.over" : "yield.direction.on_card";
}

/** A new card yield the Update action may write: finite, > 0, and not absurd (the typo guard). */
export function isValidCardYield(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100000;
}

/** Retrain note text: optional, trimmed, ≤ 500 chars. Returns null for empty; "invalid" when too long. */
export function normalizeRetrainNote(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return "invalid";
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > 500 ? "invalid" : t;
}
