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
 * Juan, later the same day: "Retrain should be a GM option, and maybe he can assign a kh+ to help
 * retrain whoever is not making the recipe right etc".
 *
 * DEFINITIONS (every one is pinned in tests/yield-stats-shared.test.ts):
 *   · BATCHES, NOT ENTRIES (Astra r1 #3). One header (one prep session's entry) can carry 2–3
 *     batches. The window, the 6-batch minimum and the 10-batch snooze all count BATCHES
 *     (Σ batches_made), never array length.
 *   · THE WINDOW BOUNDARY IS PROPORTIONAL. Newest entries are taken (produced_at desc, id breaks a
 *     tie) until they hold 10 batches; the entry that crosses 10 contributes only the fraction
 *     that fits (`weight` = batches still needed / its batches). So the window is EXACTLY 10
 *     batches whenever 10 exist, and an older triple batch cannot drag 2 extra batches in.
 *   · Per entry, actual per batch = came_out_to / batches_made, compared with THAT entry's own
 *     yield_at_time — a card edited mid-window never re-scores the batches made under the old card.
 *   · The window's average is batch-weighted: signedDrift = (Σ w·came_out_to − Σ w·batches·card) /
 *     Σ w·batches·card.
 *   · EDGE: exactly 15% off IS a nudge (|drift| ≥ 0.15). A 1e-9 tolerance absorbs float noise.
 *   · Recipe level and maker level are computed independently for the VERDICT: one maker +20%
 *     and another −20% can net to "fine" for the recipe while each maker still raises an item.
 *   · HOLDS. A Retrain note holds its scope's nudge while (a) its 10-batch snooze runs — counted
 *     in batches produced after the note was recorded — or (b) the retrain is still OPEN (assigned
 *     and not marked done), whichever is longer. A RECIPE-level note also holds every maker item
 *     on that recipe, on the recipe's own batch counter (Astra r1 #2, CC ruling (b)).
 */

/** Juan, 2026-10-07: the average is over the last 10 batches. */
export const YIELD_STATS_WINDOW = 10;
/** CC, 2026-10-07: no nudge before 6 batches, so one bad day cannot trigger it. */
export const YIELD_NUDGE_MIN_BATCHES = 6;
/** Juan, 2026-10-07: 15% off the recipe card, in EITHER direction. */
export const YIELD_NUDGE_DRIFT = 0.15;
/** Shift lead and up SEE the variance view, the nudges and the retrain items (view-only). */
export const YIELD_STATS_READ_MIN = 5;
/** GM: Update recipe yield (plus the recipe-edit step-up) and Retrain (both scopes). */
export const YIELD_ACTION_MIN = 7;
/** Juan: the GM may assign the retraining to a key holder or above. */
export const RETRAIN_ASSIGNEE_MIN = 4;

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

/** An entry inside a window: `weight` ∈ (0, 1] is the fraction of its batches the window holds. */
export interface WindowEntry extends YieldBatch {
  weight: number;
}

export type YieldScope = "recipe" | "maker";
export type RetrainStatus = "open" | "done";

export interface RetrainNoteLite {
  id: string;
  itemId: string;
  scope: YieldScope;
  /** Set when scope = "maker"; null for a recipe-level note. */
  makerId: string | null;
  createdAt: string;
  snoozeBatches: number;
  status: RetrainStatus;
  assignedTo: string | null;
  doneAt: string | null;
  doneBy: string | null;
}

export type YieldDirection = "under" | "over" | "on_card";

export interface DriftSummary {
  /** Entries (headers) contributing to the window, the boundary one included. */
  entries: number;
  /** Batches in the window (Σ weight × batches_made) — ≤ YIELD_STATS_WINDOW. */
  batches: number;
  /** Average measured output per batch. */
  actualPerBatch: number;
  /** Average card per batch (the batch-weighted yield_at_time; equals the card when it never moved). */
  cardPerBatch: number;
  /** (actual − card) / card over the window; negative = UNDER, positive = OVER. */
  signedDrift: number;
  direction: YieldDirection;
  /** batches ≥ YIELD_NUDGE_MIN_BATCHES. */
  enough: boolean;
  /** enough AND |signedDrift| ≥ YIELD_NUDGE_DRIFT. */
  flagged: boolean;
}

export interface SnoozeState {
  noteId: string;
  /** Batches still to come before the snooze ends; 0 = expired. */
  remaining: number;
  snoozed: boolean;
  /** The latest note's retrain is still open (assigned, not marked done). */
  open: boolean;
  /** snoozed OR open — the note is holding the nudge. */
  holding: boolean;
}

export interface Hold extends SnoozeState {
  /** "own" = this scope's note; "recipe" = a recipe-level note holding a maker item. */
  via: "own" | "recipe";
}

export interface ScopeVerdict {
  window: WindowEntry[];
  summary: DriftSummary | null;
  /** The note holding this scope's nudge, if any (own first, then the recipe's for a maker). */
  hold: Hold | null;
  /** The latest own note, holding or not (for "Retrained <date> by <KH>" history). */
  latestNoteId: string | null;
  /** flagged AND no hold — the nudge / retrain item renders with its buttons. */
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
export function newestFirst<T extends YieldBatch>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    const ta = Date.parse(a.producedAt);
    const tb = Date.parse(b.producedAt);
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Total batches across entries (whole entries). */
export function batchCount(batches: YieldBatch[]): number {
  return batches.filter(isUsableBatch).reduce((n, b) => n + b.batchesMade, 0);
}

/**
 * The last `size` BATCHES, newest first. The entry that crosses the boundary carries the
 * fraction of its batches that fits (proportional weighting).
 */
export function lastWindow(batches: YieldBatch[], size: number = YIELD_STATS_WINDOW): WindowEntry[] {
  const out: WindowEntry[] = [];
  let have = 0;
  for (const b of newestFirst(batches.filter(isUsableBatch))) {
    if (have >= size - EDGE_EPSILON) break;
    const need = size - have;
    const weight = b.batchesMade <= need ? 1 : need / b.batchesMade;
    out.push({ ...b, weight });
    have += weight * b.batchesMade;
  }
  return out;
}

export function directionOf(signedDrift: number): YieldDirection {
  if (Math.abs(signedDrift) < EDGE_EPSILON) return "on_card";
  return signedDrift < 0 ? "under" : "over";
}

/** |drift| ≥ 15%, with the float tolerance stated in the header. Exactly 15% is a nudge. */
export function isOffCard(signedDrift: number): boolean {
  return Math.abs(signedDrift) >= YIELD_NUDGE_DRIFT - EDGE_EPSILON;
}

/** The window's batch-weighted verdict; null when the window is empty. Unweighted entries count whole. */
export function summarizeDrift(window: Array<YieldBatch & { weight?: number }>): DriftSummary | null {
  const usable = window.filter(isUsableBatch);
  if (usable.length === 0) return null;
  let actual = 0;
  let expected = 0;
  let batches = 0;
  for (const b of usable) {
    const w = b.weight ?? 1;
    actual += w * b.cameOutTo;
    expected += w * b.batchesMade * b.yieldAtTime;
    batches += w * b.batchesMade;
  }
  const signedDrift = (actual - expected) / expected;
  const enough = batches >= YIELD_NUDGE_MIN_BATCHES - EDGE_EPSILON;
  return {
    entries: usable.length,
    batches: Math.round(batches * 1e6) / 1e6,
    actualPerBatch: actual / batches,
    cardPerBatch: expected / batches,
    signedDrift,
    direction: directionOf(signedDrift),
    enough,
    flagged: enough && isOffCard(signedDrift),
  };
}

/** The latest note (created_at desc, id desc). */
export function latestNote(notes: RetrainNoteLite[]): RetrainNoteLite | null {
  if (notes.length === 0) return null;
  return [...notes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))[0]!;
}

/**
 * The latest note in scope holds until `snoozeBatches` more BATCHES in scope were produced after
 * it was recorded — and, independently, for as long as its retrain is open. `inScope` must
 * already be filtered to the scope (the recipe's, or one maker's on it).
 */
export function snoozeState(inScope: YieldBatch[], notes: RetrainNoteLite[]): SnoozeState | null {
  const latest = latestNote(notes);
  if (!latest) return null;
  const at = Date.parse(latest.createdAt);
  const after = batchCount(inScope.filter((b) => Date.parse(b.producedAt) > at));
  const remaining = Math.max(0, latest.snoozeBatches - after);
  const snoozed = remaining > 0;
  const open = latest.status === "open";
  return { noteId: latest.id, remaining, snoozed, open, holding: snoozed || open };
}

/** Makers in `window` whose own (weighted) batches there are off the card. This NAMES; it never nudges. */
export function outlierMakers(window: WindowEntry[]): string[] {
  const byMaker = new Map<string, WindowEntry[]>();
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
 * already be scoped to that location; this filters to the item.
 */
export function evaluateItem(itemId: string, batches: YieldBatch[], notes: RetrainNoteLite[]): ItemYieldVerdict {
  const mine = batches.filter((b) => b.itemId === itemId);
  const myNotes = notes.filter((n) => n.itemId === itemId);
  const recipeNotes = myNotes.filter((n) => n.scope === "recipe");

  const recipeWindow = lastWindow(mine);
  const recipeSummary = summarizeDrift(recipeWindow);
  const recipeSnooze = snoozeState(mine, recipeNotes);
  const recipeHold: Hold | null = recipeSnooze?.holding ? { ...recipeSnooze, via: "own" } : null;
  const recipe = {
    window: recipeWindow,
    summary: recipeSummary,
    hold: recipeHold,
    latestNoteId: latestNote(recipeNotes)?.id ?? null,
    nudge: !!recipeSummary?.flagged && !recipeHold,
    outlierMakerIds: outlierMakers(recipeWindow),
  };

  const makerIds = [...new Set(mine.map((b) => b.madeBy).filter((v): v is string => !!v))].sort();
  const makers: MakerVerdict[] = makerIds.map((makerId) => {
    const own = mine.filter((b) => b.madeBy === makerId);
    const ownNotes = myNotes.filter((n) => n.scope === "maker" && n.makerId === makerId);
    const window = lastWindow(own);
    const summary = summarizeDrift(window);
    const ownSnooze = snoozeState(own, ownNotes);
    // Own note first; else a recipe-level Retrain holds every maker item on the recipe's counter.
    const hold: Hold | null = ownSnooze?.holding ? { ...ownSnooze, via: "own" } : recipeHold ? { ...recipeHold, via: "recipe" } : null;
    return { makerId, window, summary, hold, latestNoteId: latestNote(ownNotes)?.id ?? null, nudge: !!summary?.flagged && !hold };
  });
  return { itemId, recipe, makers };
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

/**
 * The assignee picker's floor (Juan): an ACTIVE key holder or above at the shop, never ranked
 * above the GM assigning. The server re-checks the chosen id against the same rule.
 */
export function isEligibleRetrainAssignee(candidate: { level: number; active: boolean; atShop: boolean }, actorLevel: number): boolean {
  return candidate.active && candidate.atShop && candidate.level >= RETRAIN_ASSIGNEE_MIN && candidate.level <= actorLevel;
}

/** Who may mark an open retrain done: its assignee, or a GM+ (the location bind is the server's). */
export function canMarkRetrainDone(actor: { userId: string; level: number }, note: { assignedTo: string | null; status: RetrainStatus }): boolean {
  if (note.status !== "open") return false;
  return actor.userId === note.assignedTo || actor.level >= YIELD_ACTION_MIN;
}
