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
 *   2. PATCH, NOT SNAPSHOT. The client posts only the items that changed since its last
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
 * One line's unsubmitted form state. Structurally identical to `RawPrepInputs`
 * (components/prep/types.ts) — numeric fields as strings, `yesNo` boolean, `freeText`
 * string — so the form hands its state in and gets it back without conversion. An
 * absent field is "not entered"; an EMPTY item (`{}`) is "this line is blank".
 */
export interface AmPrepDraftItem {
  onHand?: string;
  portioned?: string;
  line?: string;
  backUp?: string;
  total?: string;
  yesNo?: boolean;
  freeText?: string;
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
 * Normalize one row: drop empty strings (an emptied cell and a never-touched cell mean the
 * same thing to the validator), cap lengths, keep booleans only when boolean. Key order is
 * fixed so two equal rows serialize identically — the client's change detection compares
 * serialized rows.
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

/** Normalize a whole form state into draft items, dropping blank rows and bad keys. */
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
 * The PATCH a save posts: every line whose normalized value differs from what this client
 * last saved. A line that was saved and is now blank goes out as `{}` — that is how a
 * cleared cell reaches the server.
 */
export function diffAmPrepDraftItems(
  lastSaved: Record<string, AmPrepDraftItem>,
  current: Record<string, AmPrepDraftItem>,
): Record<string, AmPrepDraftItem> {
  const patch: Record<string, AmPrepDraftItem> = {};
  const keys = new Set([...Object.keys(lastSaved), ...Object.keys(current)]);
  for (const key of [...keys].sort()) {
    const before = lastSaved[key];
    const after = current[key];
    const beforeJson = before ? JSON.stringify(before) : "{}";
    const afterJson = after ? JSON.stringify(after) : "{}";
    if (beforeJson !== afterJson) patch[key] = after ?? {};
  }
  return patch;
}

/**
 * Merge a patch into a stored set of items, line by line. An empty patch row removes the
 * line (it is blank now). Capped at AM_PREP_DRAFT_MAX_ITEMS so a merge can never grow the
 * row past what the validator accepts on read-back.
 */
export function mergeAmPrepDraftItems(
  base: Record<string, AmPrepDraftItem>,
  patch: Record<string, AmPrepDraftItem>,
): Record<string, AmPrepDraftItem> {
  const merged: Record<string, AmPrepDraftItem> = { ...base };
  for (const [key, item] of Object.entries(patch)) {
    if (Object.keys(item).length === 0) delete merged[key];
    else merged[key] = item;
  }
  const keys = Object.keys(merged).sort();
  const out: Record<string, AmPrepDraftItem> = {};
  for (const key of keys.slice(0, AM_PREP_DRAFT_MAX_ITEMS)) out[key] = merged[key]!;
  return out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse an untrusted value (a request body's `draft`, or the jsonb column read back).
 *
 * Returns `null` for ANYTHING malformed — wrong version, a numeric field that is a number
 * rather than the typed string, a `yesNo` that is not boolean. Reject-whole, the 0203 rule:
 * a draft that half-parses hydrates a form with a silently missing cell, and a blank cell
 * the operator believes they counted is the exact failure this exists to end. UNKNOWN
 * fields are dropped (a newer client must not brick an older one). Empty rows are KEPT,
 * because in a patch an empty row means "this line is blank now".
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
    draft.items[key] = normalizeAmPrepDraftItem(value as AmPrepDraftItem);
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
