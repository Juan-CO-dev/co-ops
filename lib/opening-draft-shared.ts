/**
 * Opening Phase 1 DRAFT — the pure shape, its validator, and the precedence rule.
 *
 * LRA-121 / STAFF-5. Phase 1 verification work (station ticks, fridge temps, per-item
 * comments, spot-check recounts, section verifies) lived ONLY in the browser's React
 * state until a key holder tapped submit. An employee (level 3) cannot submit
 * (`OPENING_BASE_LEVEL` = 4), so the shift's real sequence — employee walks the shop,
 * key holder arrives and submits — lost every keystroke the moment the key holder
 * opened the same instance on their own device. This module is the client-safe half of
 * the fix: the draft that is autosaved server-side per opening instance and hydrated
 * back on load.
 *
 * `*-shared.ts` per AGENTS.md: ZERO I/O, no server imports, safe in a client component.
 * `lib/opening.ts` re-exports the surface so server consumers keep their import path.
 *
 * ── WHAT THE DRAFT IS, AND WHAT IT IS NOT ─────────────────────────────────────────────
 * It is WORKING STATE — the unsubmitted contents of one browser form, mirrored to the
 * server so a second device can pick it up. It is NOT an accountability record: it is
 * never read once `checklist_instances.status` leaves 'open', because the Phase 1 atomic
 * submit (migration 0055) writes the real `checklist_completions` +
 * `opening_section_verifications` rows and those supersede it wholesale. The append-only
 * law protects history; this is scratch, and it is updated in place.
 *
 * ── THE SHAPE MIRRORS `OpeningItemFormValue` EXACTLY ──────────────────────────────────
 * Per-item fields are the five fields of `OpeningItemFormValue`
 * (components/opening/OpeningChecklistItem.tsx) — countValue, photoId, notes, ticked,
 * openerRecount — because the whole point is a faithful round-trip of the form state.
 *
 * `spotCheckStatus` is deliberately ABSENT. It is not form state: `handlePhase1Submit`
 * DERIVES it at submit time from `openerRecount` + the snapshot's `closerCount`, and the
 * RPC re-derives the persisted value anyway (migration 0055). Persisting a derived
 * discriminator would create a second opinion about a value the server owns.
 *
 * `ticked` is load-bearing and is the field the sim journey
 * (`opening.phase1.persist-before-submit`) reads back: the station header's
 * `aria-pressed` is `items.every(v => v.ticked)` (OpeningVerificationStation:90).
 *
 * `sections` carries the section-verify beat because those rows are ALSO pre-submit-only
 * state: `opening_section_verifications` is INSERTed exclusively inside the submit RPCs
 * (0053 / 0055 / 0185) — verified live in this repo — so before submit there is nothing
 * on the server for a second opener to read. Confirmed, not assumed.
 *
 * `openerNoPriorDataAttestation` rides for the same reason and no other:
 * `checklist_instances.opener_no_prior_data_reason` (C.54 §4) is written at SUBMIT, so
 * pre-submit the opener's selection lives nowhere but the radio group. An employee who
 * recounts a NULL-source item, picks a reason and hands the tablet over would otherwise
 * arrive at a prompt the key holder has to re-answer from knowledge they do not have —
 * the attestation is a statement about the PRIOR NIGHT, and the person who can make it is
 * whoever walked the shop. Additive to `version: 1`: absent reads as null, so a draft
 * written before this field parses unchanged.
 */

import type { OpeningNoPriorDataReason } from "./types";

/** Current draft envelope version. Bump only with a reader that handles both. */
export const OPENING_PHASE1_DRAFT_VERSION = 1 as const;

/**
 * The two legal attestation values, at RUNTIME.
 *
 * Typed as `ReadonlySet<OpeningNoPriorDataReason>` so the compiler ties this set to the
 * union in lib/types.ts — adding a third reason there without adding it here is a type
 * error at the membership check, not a value that silently fails validation in
 * production. (`lib/types.ts` is imported type-only; types erase, so this module stays
 * client-safe and zero-I/O.) Mirrors the same set POST /api/opening/submit/phase1
 * validates against.
 */
export const OPENING_DRAFT_ATTESTATION_REASONS: ReadonlySet<OpeningNoPriorDataReason> =
  new Set<OpeningNoPriorDataReason>(["planned_closure", "missed_or_unknown"]);

/**
 * Role floor for reading AND writing a Phase 1 draft.
 *
 * This is the OPENING PAGE's floor, NOT the submit floor. `OPENING_BASE_LEVEL` (4, KH+)
 * gates `submit_phase1_atomic`; the page itself carries no level gate beyond a live
 * session, and every opening template item is `min_role_level = 3` (lib/opening.ts:107).
 * An employee at level 3 is exactly the actor whose lost work this draft exists to save,
 * so flooring the draft at the SUBMIT level would rebuild the defect in a new table.
 *
 * Exported here (pure) so the route, the lib and migration 0203's RLS quals all name one
 * number.
 */
export const OPENING_DRAFT_MIN_LEVEL = 3;

/** Cap on any free-text field persisted in a draft. Longer input is truncated, not rejected. */
export const OPENING_DRAFT_TEXT_MAX = 2000;

/**
 * Defensive bounds. A draft is one opening template's worth of items (CO's live openings
 * run well under 200 rows) plus its prep sections. These exist so a malformed or hostile
 * body cannot park an unbounded blob in a jsonb column on a level-3 floor.
 */
export const OPENING_DRAFT_MAX_ITEMS = 500;
export const OPENING_DRAFT_MAX_SECTIONS = 200;
/** Template-item ids are uuids; section keys are slugs. 200 is generous for both. */
export const OPENING_DRAFT_MAX_KEY_LENGTH = 200;

/** One item's worth of unsubmitted Phase 1 form state. Mirrors `OpeningItemFormValue`. */
export interface OpeningPhase1DraftItem {
  /** Fridge temp reading on `expects_count` items. NULL otherwise. */
  countValue: number | null;
  /** Discrepancy photo id. Always null today (upload is unbuilt); carried for fidelity. */
  photoId: string | null;
  /** Discrepancy comment. Trimmed; capped at OPENING_DRAFT_TEXT_MAX. */
  notes: string | null;
  /** Station tick. The station header's aria-pressed is every() over this field. */
  ticked: boolean;
  /** C.53 spot-check morning recount. NULL when no recount was entered. */
  openerRecount: number | null;
}

/** The persisted envelope. One row per instance; `draft` jsonb holds exactly this. */
export interface OpeningPhase1Draft {
  version: typeof OPENING_PHASE1_DRAFT_VERSION;
  /** Keyed by `checklist_template_items.id`. */
  items: Record<string, OpeningPhase1DraftItem>;
  /** Keyed by the prep section key (`prepMeta.section`). */
  sections: Record<string, boolean>;
  /**
   * C.54 §2.C opener attestation, unsubmitted. NULL when the prompt never fired or the
   * opener has not picked yet — which are deliberately the same value here: "not yet
   * stated" is the only thing a draft can honestly say, and the submit RPC is what turns
   * a required-and-missing attestation into a refusal (`provenance_required`).
   */
  openerNoPriorDataAttestation: OpeningNoPriorDataReason | null;
}

/** Where a hydrated Phase 1 form value came from. See `openingPhase1ValueSource`. */
export type OpeningPhase1ValueSource = "completion" | "draft" | "empty";

/**
 * THE PRECEDENCE RULE, as a pure function so it is assertable.
 *
 * completion > draft > empty. A persisted Phase 1 completion is a submitted,
 * accountability-bearing row; a draft is unsubmitted scratch. A completion existing at
 * all means Phase 1 landed, which means the draft is by definition stale — so it never
 * wins, and the client never has to reason about which of two truths is newer.
 */
export function openingPhase1ValueSource(
  hasCompletion: boolean,
  hasDraft: boolean,
): OpeningPhase1ValueSource {
  if (hasCompletion) return "completion";
  if (hasDraft) return "draft";
  return "empty";
}

/** An empty draft — what a fresh instance holds and what a reset writes. */
export function emptyOpeningPhase1Draft(): OpeningPhase1Draft {
  return {
    version: OPENING_PHASE1_DRAFT_VERSION,
    items: {},
    sections: {},
    openerNoPriorDataAttestation: null,
  };
}

function normalizeText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, OPENING_DRAFT_TEXT_MAX);
}

/**
 * Build a normalized draft from the client's two state Maps.
 *
 * Applies the SAME normalization the parser enforces (trim + cap, empty string → null),
 * so `parseOpeningPhase1Draft(buildOpeningPhase1Draft(x))` round-trips byte-identically —
 * which is what lets the client dedupe autosaves by comparing serialized payloads.
 * Entries beyond the caps are dropped from the tail (insertion order) rather than
 * failing the save: an autosave must never block the operator.
 */
export function buildOpeningPhase1Draft(
  items: Iterable<readonly [string, OpeningPhase1DraftItem]>,
  sections: Iterable<readonly [string, boolean]>,
  openerNoPriorDataAttestation: OpeningNoPriorDataReason | null = null,
): OpeningPhase1Draft {
  const draft = emptyOpeningPhase1Draft();
  // Validated on the way OUT as well as on the way in: a caller handing this an
  // out-of-vocabulary value must not be able to build a payload the parser will then
  // reject on read-back, which would silently disable autosave for that whole morning.
  draft.openerNoPriorDataAttestation =
    openerNoPriorDataAttestation !== null &&
    OPENING_DRAFT_ATTESTATION_REASONS.has(openerNoPriorDataAttestation)
      ? openerNoPriorDataAttestation
      : null;
  let itemCount = 0;
  for (const [key, value] of items) {
    if (itemCount >= OPENING_DRAFT_MAX_ITEMS) break;
    if (key.length === 0 || key.length > OPENING_DRAFT_MAX_KEY_LENGTH) continue;
    draft.items[key] = {
      countValue: Number.isFinite(value.countValue) ? value.countValue : null,
      photoId: value.photoId === null ? null : normalizeText(value.photoId),
      notes: value.notes === null ? null : normalizeText(value.notes),
      ticked: value.ticked === true,
      openerRecount: Number.isFinite(value.openerRecount) ? value.openerRecount : null,
    };
    itemCount += 1;
  }
  let sectionCount = 0;
  for (const [key, verified] of sections) {
    if (sectionCount >= OPENING_DRAFT_MAX_SECTIONS) break;
    if (key.length === 0 || key.length > OPENING_DRAFT_MAX_KEY_LENGTH) continue;
    draft.sections[key] = verified === true;
    sectionCount += 1;
  }
  return draft;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse an untrusted value (a request body, or a jsonb column read back) into a draft.
 *
 * Returns `null` for ANYTHING malformed — a wrong version, a non-object, an item whose
 * `countValue` is a string or a NaN. There is no partial-acceptance path: a draft that
 * half-parses would hydrate a form with a silently missing field, and a blank field the
 * operator believes they filled is exactly the failure LRA-121 is about. Rejecting whole
 * is loud (the client shows an empty form and the operator re-enters), accepting half is
 * quiet.
 *
 * UNKNOWN KEYS ARE DROPPED, not rejected: a future field written by a newer client must
 * not brick an older one, and the version field is what guards a real shape change.
 */
export function parseOpeningPhase1Draft(raw: unknown): OpeningPhase1Draft | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.version !== OPENING_PHASE1_DRAFT_VERSION) return null;
  if (!isPlainRecord(raw.items)) return null;
  if (!isPlainRecord(raw.sections)) return null;

  const itemEntries = Object.entries(raw.items);
  if (itemEntries.length > OPENING_DRAFT_MAX_ITEMS) return null;
  const sectionEntries = Object.entries(raw.sections);
  if (sectionEntries.length > OPENING_DRAFT_MAX_SECTIONS) return null;

  const draft = emptyOpeningPhase1Draft();

  // Additive to version 1: ABSENT (a draft written before this field existed) reads as
  // null, which is the same thing "the opener has not picked yet" means. A PRESENT but
  // out-of-vocabulary value is a different animal — it is a claim about the prior night
  // that nobody can read — so it rejects the whole draft rather than being coerced to
  // null, which would quietly erase an attestation the opener believes they made.
  const attestation = raw.openerNoPriorDataAttestation;
  if (attestation !== null && attestation !== undefined) {
    if (
      typeof attestation !== "string" ||
      !OPENING_DRAFT_ATTESTATION_REASONS.has(attestation as OpeningNoPriorDataReason)
    ) {
      return null;
    }
    draft.openerNoPriorDataAttestation = attestation as OpeningNoPriorDataReason;
  }

  for (const [key, value] of itemEntries) {
    if (key.length === 0 || key.length > OPENING_DRAFT_MAX_KEY_LENGTH) return null;
    if (!isPlainRecord(value)) return null;

    const countValue = parseNullableFiniteNumber(value.countValue);
    if (countValue === INVALID) return null;
    const openerRecount = parseNullableFiniteNumber(value.openerRecount);
    if (openerRecount === INVALID) return null;
    const photoId = parseNullableText(value.photoId);
    if (photoId === INVALID) return null;
    const notes = parseNullableText(value.notes);
    if (notes === INVALID) return null;
    if (typeof value.ticked !== "boolean") return null;

    draft.items[key] = { countValue, photoId, notes, ticked: value.ticked, openerRecount };
  }

  for (const [key, verified] of sectionEntries) {
    if (key.length === 0 || key.length > OPENING_DRAFT_MAX_KEY_LENGTH) return null;
    if (typeof verified !== "boolean") return null;
    draft.sections[key] = verified;
  }

  return draft;
}

/**
 * Sentinel for "present but malformed", distinct from the legitimate value `null`.
 * A bare `null` return could not tell `{ notes: null }` (valid) from `{ notes: 7 }`
 * (malformed) — and conflating them is how a bad value gets swallowed.
 */
const INVALID = Symbol("invalid");

function parseNullableFiniteNumber(value: unknown): number | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return INVALID;
  return value;
}

function parseNullableText(value: unknown): string | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return INVALID;
  return normalizeText(value);
}
