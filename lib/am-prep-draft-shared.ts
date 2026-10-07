/**
 * AM Prep DRAFT — the pure shape, its validator, the patch/merge rule and the restore
 * precedence. Client-safe half of migration 0214 (`am_prep_drafts`).
 *
 * Juan's floor note, 2026-10-06: "the AM prep list resets whenever someone exits the am
 * prep, which makes them have to recount everything. It should just hold its inputs, so
 * that even if the 10 minute timer hits, they don't lose all their work, or if they need
 * to stop the count and do something else."
 *
 * The pattern is the opening Phase 1 draft (0203, `lib/opening-draft-shared.ts`): the
 * unsubmitted form state is autosaved SERVER-side and hydrated back on load. Two
 * differences, both deliberate:
 *
 *   1. KEY. ONE shared draft per shop per business day (`location_id` + `business_date`),
 *      not per instance. AM prep is single-instance-per-day-per-location already
 *      (checklist_instances UNIQUE(template_id, location_id, date)), so for the ordinary
 *      day the two keys name the same thing; the day key is what the spec states and it
 *      also survives a mid-day template re-version (a new instance id) without stranding
 *      the count. `instance_id` rides on the row and a draft whose instance no longer
 *      matches the page's is ignored on load (its item ids belong to another template).
 *
 *   2. PATCH, NOT SNAPSHOT, STAMPED. The client posts only the items that changed since its last
 *      successful save, and the server merges them into the stored draft item by item.
 *      Opening posts the whole form (last write wins). For AM prep the whole point is that
 *      a SECOND person picks the count up, and a stale tab left open on a first device
 *      would, under whole-form last-write-wins, erase the second person's numbers the
 *      moment it saved one keystroke. Item-level merge bounds that hazard to the items the
 *      stale tab actually touched.
 *
 * `*-shared.ts` per AGENTS.md: ZERO I/O, no server imports, safe in a client component.
 */

/** Current draft envelope version. Bump only with a reader that handles both. */
export const AM_PREP_DRAFT_VERSION = 1 as const;

/** Cap on the free-text field. Longer input is truncated, not rejected. */
export const AM_PREP_DRAFT_TEXT_MAX = 2000;
/**
 * Cap on a raw numeric field. The form keeps numbers as strings while typing ("3.", "0.0"),
 * and the draft stores exactly that string so a restore is faithful. 32 characters is far
 * past any count a person types; it exists so a hostile body cannot park a megabyte here.
 */
export const AM_PREP_DRAFT_NUMERIC_MAX = 32;
/** One AM prep template's worth of lines (CO runs ~40) with generous headroom. */
export const AM_PREP_DRAFT_MAX_ITEMS = 500;
/** Template-item ids are uuids; 200 is generous. */
export const AM_PREP_DRAFT_MAX_KEY_LENGTH = 200;

/** Debounce between the last keystroke and the save. Spec: "about 1 s". */
export const AM_PREP_DRAFT_DEBOUNCE_MS = 1000;

/** The numeric fields of the form row, stored as the raw strings the operator typed. */
export const AM_PREP_DRAFT_NUMERIC_FIELDS = [
  "onHand",
  "portioned",
  "line",
  "backUp",
  "total",
] as const;

/**
 * One line's unsubmitted form state. The value fields are structurally identical to
 * `RawPrepInputs` (components/prep/types.ts) — numeric fields as strings, `yesNo` boolean,
 * `freeText` string. An absent field is "not entered"; a line with NO value field is
 * "this line is blank" (a tombstone, kept so a late older delivery cannot resurrect it).
 *
 * `editedAt` — THE PER-LINE EDIT STAMP (review round 2, PR #383). A per-tab monotonic
 * number (`Date.now()` combined with a per-tab counter, strictly increasing within a tab;
 * see `createAmPrepDraftStamper`). The merge — `mergeAmPrepDraftItems` here and
 * `am_prep_draft_merge_items` in 0214, which mirror each other — keeps, PER LINE, the entry
 * with the greater stamp, so arrival order stops mattering: a late beacon carrying an older
 * edit can never overwrite a newer acknowledged one. Absent = 0 (oldest).
 *
 * V1 LIMIT, stated: two DEVICES editing the SAME line resolve by stamp, i.e. by their
 * clocks — the later wall-clock edit wins, and a device whose clock runs fast wins ties it
 * should lose. Different lines never conflict.
 */
export interface AmPrepDraftItem {
  onHand?: string;
  portioned?: string;
  line?: string;
  backUp?: string;
  total?: string;
  yesNo?: boolean;
  freeText?: string;
  editedAt?: number;
}

/** The persisted envelope (and the patch envelope a save posts). */
export interface AmPrepDraft {
  version: typeof AM_PREP_DRAFT_VERSION;
  /** Keyed by `checklist_template_items.id`. */
  items: Record<string, AmPrepDraftItem>;
}

/** What the page hands the form when a draft is restored. */
export interface AmPrepDraftRestore {
  draft: AmPrepDraft;
  /** Server time of the last save. */
  savedAt: string;
  /** Display name of the last saver; null when unknown. */
  savedByName: string | null;
}

export function emptyAmPrepDraft(): AmPrepDraft {
  return { version: AM_PREP_DRAFT_VERSION, items: {} };
}

/**
 * Normalize one row's VALUE: drop empty strings (an emptied cell and a never-touched cell
 * mean the same thing to the validator), cap lengths, keep booleans only when boolean. Key
 * order is fixed so two equal rows serialize identically. The stamp is NOT part of the
 * value — see `withStamp`.
 */
export function normalizeAmPrepDraftItem(raw: AmPrepDraftItem): AmPrepDraftItem {
  const out: AmPrepDraftItem = {};
  for (const f of AM_PREP_DRAFT_NUMERIC_FIELDS) {
    const v = raw[f];
    if (typeof v === "string" && v.length > 0) out[f] = v.slice(0, AM_PREP_DRAFT_NUMERIC_MAX);
  }
  if (typeof raw.yesNo === "boolean") out.yesNo = raw.yesNo;
  if (typeof raw.freeText === "string" && raw.freeText.length > 0) {
    out.freeText = raw.freeText.slice(0, AM_PREP_DRAFT_TEXT_MAX);
  }
  return out;
}

/** A normalized value plus its stamp (when it has one). */
function withStamp(raw: AmPrepDraftItem): AmPrepDraftItem {
  const out = normalizeAmPrepDraftItem(raw);
  if (typeof raw.editedAt === "number" && Number.isFinite(raw.editedAt) && raw.editedAt >= 0) {
    out.editedAt = raw.editedAt;
  }
  return out;
}

/** True when the line carries at least one VALUE field (a stamp alone is a blank line). */
export function amPrepDraftLineHasValue(item: AmPrepDraftItem): boolean {
  return Object.keys(normalizeAmPrepDraftItem(item)).length > 0;
}

/**
 * Normalize a whole FORM state (no stamps) into value-only lines, dropping blank rows and
 * bad keys. What the autosaver compares to detect an edit.
 */
export function normalizeAmPrepDraftItems(
  rows: Record<string, AmPrepDraftItem>,
): Record<string, AmPrepDraftItem> {
  const out: Record<string, AmPrepDraftItem> = {};
  let n = 0;
  for (const key of Object.keys(rows).sort()) {
    if (n >= AM_PREP_DRAFT_MAX_ITEMS) break;
    if (key.length === 0 || key.length > AM_PREP_DRAFT_MAX_KEY_LENGTH) continue;
    const item = normalizeAmPrepDraftItem(rows[key] ?? {});
    if (Object.keys(item).length === 0) continue;
    out[key] = item;
    n += 1;
  }
  return out;
}

/**
 * Stored draft lines → the form's seed: value fields only, blank (tombstone) lines dropped.
 */
export function amPrepDraftItemsToFormValues(
  items: Record<string, AmPrepDraftItem>,
): Record<string, AmPrepDraftItem> {
  return normalizeAmPrepDraftItems(items);
}

/** A line's stamp; absent counts as 0 (the oldest possible edit). */
export function amPrepDraftStampOf(item: AmPrepDraftItem | undefined): number {
  return item && typeof item.editedAt === "number" ? item.editedAt : 0;
}

/**
 * THE MERGE — the pure TS mirror of 0214 `am_prep_draft_merge_items`. Per line, keep the
 * entry with the GREATER `editedAt`; on a tie the incoming entry wins (a re-send of the
 * same edit is idempotent). Blank lines are kept as stamped tombstones. Capped at
 * AM_PREP_DRAFT_MAX_ITEMS so a merge never outgrows what the validator reads back.
 */
export function mergeAmPrepDraftItems(
  base: Record<string, AmPrepDraftItem>,
  patch: Record<string, AmPrepDraftItem>,
): Record<string, AmPrepDraftItem> {
  const merged: Record<string, AmPrepDraftItem> = { ...base };
  for (const [key, incoming] of Object.entries(patch)) {
    const stored = merged[key];
    if (stored === undefined || amPrepDraftStampOf(incoming) >= amPrepDraftStampOf(stored)) {
      merged[key] = incoming;
    }
  }
  const keys = Object.keys(merged).sort();
  const out: Record<string, AmPrepDraftItem> = {};
  for (const key of keys.slice(0, AM_PREP_DRAFT_MAX_ITEMS)) out[key] = merged[key]!;
  return out;
}

/**
 * THE TAB CLOCK (review round 3, PR #383). ONE per tab / JS context — module state, NOT per
 * saver — so it survives a saver being disposed and a new one mounted (remount, strict
 * mode, navigating back to the page). Every stamp is `max(Date.now(), last + 1)`: strictly
 * greater than any stamp this tab has issued OR observed, even within one millisecond or
 * across a backwards clock step.
 *
 * OBSERVE before stamping: a saver that starts from a restored draft, and every
 * acknowledged fetch, calls `observeAmPrepDraftStamp` with the highest stamp it has seen,
 * so a new edit is always stamped ABOVE it — otherwise an edit stamped below a restored
 * (e.g. another device's) stamp would never count as pending and would lose the merge.
 */
let amPrepDraftTabClock = 0;

/** The next stamp from this tab's clock. `now` is injectable for tests. */
export function nextAmPrepDraftStamp(now: () => number = Date.now): number {
  const t = now();
  amPrepDraftTabClock = t > amPrepDraftTabClock ? t : amPrepDraftTabClock + 1;
  return amPrepDraftTabClock;
}

/** Advance this tab's clock to at least `stamp` (a stamp seen from the server). */
export function observeAmPrepDraftStamp(stamp: number): void {
  if (Number.isFinite(stamp) && stamp > amPrepDraftTabClock) amPrepDraftTabClock = stamp;
}

/** TEST-ONLY: reset this context's tab clock. Never called by app code. */
export function resetAmPrepDraftTabClockForTests(value = 0): void {
  amPrepDraftTabClock = value;
}

/**
 * A stamper bound to the TAB clock (kept for call sites that want a function). Every
 * stamper in one JS context shares the same monotonic clock.
 */
export function createAmPrepDraftStamper(now: () => number = Date.now): () => number {
  return () => nextAmPrepDraftStamp(now);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse an untrusted value (a request body's `draft`, or the jsonb column read back).
 *
 * Returns `null` for ANYTHING malformed — wrong version, a numeric field that is a number
 * rather than the typed string, a `yesNo` that is not boolean, an `editedAt` that is not a
 * finite non-negative number. Reject-whole, the 0203 rule: a draft that half-parses
 * hydrates a form with a silently missing cell. UNKNOWN fields are dropped (a newer client
 * must not brick an older one). Blank lines are KEPT (with their stamp): a blank line is a
 * real edit ("this line is empty now").
 */
export function parseAmPrepDraft(raw: unknown): AmPrepDraft | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.version !== AM_PREP_DRAFT_VERSION) return null;
  if (!isPlainRecord(raw.items)) return null;
  const entries = Object.entries(raw.items);
  if (entries.length > AM_PREP_DRAFT_MAX_ITEMS) return null;

  const draft = emptyAmPrepDraft();
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > AM_PREP_DRAFT_MAX_KEY_LENGTH) return null;
    if (!isPlainRecord(value)) return null;
    for (const f of AM_PREP_DRAFT_NUMERIC_FIELDS) {
      const v = value[f];
      if (v !== undefined && v !== null && typeof v !== "string") return null;
    }
    if (value.yesNo !== undefined && value.yesNo !== null && typeof value.yesNo !== "boolean") {
      return null;
    }
    if (
      value.freeText !== undefined &&
      value.freeText !== null &&
      typeof value.freeText !== "string"
    ) {
      return null;
    }
    if (
      value.editedAt !== undefined &&
      value.editedAt !== null &&
      (typeof value.editedAt !== "number" || !Number.isFinite(value.editedAt) || value.editedAt < 0)
    ) {
      return null;
    }
    draft.items[key] = withStamp(value as AmPrepDraftItem);
  }
  return draft;
}

/**
 * THE RESTORE PRECEDENCE, as a pure function so it is assertable.
 *
 * A draft hydrates the form ONLY on a first submission of a still-open instance whose id
 * matches the draft's, and only while the draft is unconsumed and holds at least one line.
 * Edit mode (C.46 chained update) and read-only mode show the SUBMITTED values — a
 * submitted, accountability-bearing completion always outranks scratch.
 */
export function amPrepDraftApplies(args: {
  mode: "submit" | "edit" | "read_only";
  instanceStatus: string;
  instanceId: string;
  draftInstanceId: string | null;
  consumed: boolean;
  itemCount: number;
}): boolean {
  if (args.mode !== "submit") return false;
  if (args.instanceStatus !== "open") return false;
  if (args.consumed) return false;
  if (args.draftInstanceId !== args.instanceId) return false;
  return args.itemCount > 0;
}

/**
 * The role gate — the SAME one `submitAmPrep` applies (lib/prep.ts): level at or above
 * AM_PREP_BASE_LEVEL, or an active am_prep assignment for this shop and day. The level is
 * a parameter so this module stays free of the server lib.
 */
export function canWriteAmPrepDraft(args: {
  actorLevel: number;
  baseLevel: number;
  hasAssignment: boolean;
}): boolean {
  return args.actorLevel >= args.baseLevel || args.hasAssignment;
}

/** Backoff for a failed autosave: 2 s, 4 s, 8 s, 16 s, then every 30 s. */
export function amPrepDraftRetryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(30_000, 1000 * 2 ** n);
}

/**
 * Whether a failed save is worth retrying on a timer. Network failures (status null), 5xx,
 * 401 (the session may come back after the idle prompt), 408 and 429 retry. Any other 4xx
 * is a verdict, not a blip — the instance was submitted (409), the actor lost access
 * (403) — and retrying it forever would only spin; the next edit tries again.
 */
export function isRetryableAmPrepDraftFailure(status: number | null): boolean {
  if (status === null) return true;
  if (status >= 500) return true;
  return status === 401 || status === 408 || status === 429;
}
