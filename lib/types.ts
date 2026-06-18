/**
 * Domain types — derived from Foundation Spec v1.2 Section 4 (database schema).
 *
 * These are the application-layer shapes. They map 1:1 to database rows but
 * use camelCase. The Supabase client layer (Phase 1) will handle the
 * snake_case ↔ camelCase translation.
 *
 * Adding a column to the database means adding a field here, in the same
 * commit, in the same PR. No exceptions.
 */

import type { RoleCode } from "./roles";

// ─────────────────────────────────────────────────────────────────────────────
// Auth & Access
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  phone: string | null;
  role: RoleCode;
  active: boolean;
  smsConsent: boolean;
  smsConsentAt: string | null;
  createdAt: string;
  createdBy: string | null;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  /** UI language preference per SPEC_AMENDMENTS.md C.31. */
  language: "en" | "es";
  /** AGM+-editable "about me" blurb (≤500 chars) per the profile-blurb design. Null = unset. */
  profileBlurb: string | null;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  type: "permanent" | "dark_kitchen";
  active: boolean;
  address: string | null;
  phone: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface UserLocation {
  userId: string;
  locationId: string;
  assignedAt: string;
  assignedBy: string | null;
}

export interface Session {
  id: string;
  userId: string;
  /** SHA-256 of the JWT carried in the session cookie. requireSession validates it
   *  alongside JWT signature/exp as defense against AUTH_JWT_SECRET leak forgery. */
  tokenHash: string;
  authMethod: "pin" | "password";
  stepUpUnlocked: boolean;
  stepUpUnlockedAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendors & Inventory
// ─────────────────────────────────────────────────────────────────────────────

export type VendorCategory =
  | "protein"
  | "produce"
  | "bread"
  | "dairy"
  | "dry"
  | "beverage"
  | "paper"
  | "cleaning"
  | "smallwares"
  | "other";

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  orderingEmail: string | null;
  orderingUrl: string | null;
  orderingDays: string | null;
  paymentTerms: string | null;
  accountNumber: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
}

export interface VendorItem {
  id: string;
  vendorId: string;
  name: string;
  category: string | null;
  unit: string;
  unitSize: string | null;
  itemNumber: string | null;
  sourceUrl: string | null;
  leadTimeDays: number | null;
  weekdayPar: number | null;
  weekendPar: number | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ParLevel {
  id: string;
  locationId: string;
  vendorItemId: string;
  parValue: number;
  /** NULL = all days; 0 = Sunday … 6 = Saturday */
  dayOfWeek: number | null;
  active: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports (SPEC_AMENDMENTS.md C.42)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operational report types per SPEC_AMENDMENTS.md C.42.
 *
 * Mirrors the Postgres `report_type_enum` (created in migration 0036, also
 * consumed by `report_assignments.report_type` per migration 0039). Single
 * source-of-truth: when a new report type is added, the enum AND this union
 * are updated in lockstep (one `ALTER TYPE ADD VALUE` migration + this
 * single union update).
 *
 * Used by:
 *   - ChecklistTemplateItem.reportReferenceType (closing's auto-complete items)
 *   - ReportAssignment.reportType (assignment-down across all report types)
 *
 * Runtime narrowing helper: lib/prep.ts isReportType().
 */
export type ReportType =
  | "am_prep"
  | "mid_day_prep"
  | "cash_report"
  | "opening_report"
  | "training_report"
  | "special_report"
  | "pm_report";

/**
 * Generic assignment-down record per SPEC_AMENDMENTS.md C.42. One table
 * serves all six report types via the shared report_type_enum.
 *
 * Strict-greater assigner-vs-assignee level (level >= assignee level)
 * enforced in the admin API (canActOn pattern), NOT RLS — RLS can't
 * easily look up the assignee's role across rows.
 *
 * Append-only: retraction is `active = false`, never row delete.
 */
export interface ReportAssignment {
  id: string;
  reportType: ReportType;
  locationId: string;
  /** ISO YYYY-MM-DD; consistent with ChecklistInstance.date. */
  operationalDate: string;
  assignerId: string;
  assigneeId: string;
  note: string | null;
  createdAt: string;
  active: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prep (SPEC_AMENDMENTS.md C.18 + C.44)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prep section enum mirrored as a TS union. Stored as a raw string inside
 * `checklist_template_items.prep_meta.section` JSONB (Postgres doesn't
 * enforce inside JSONB; lib/prep.ts isPrepSection() validates on read).
 *
 * `section` IS the system key (per SPEC_AMENDMENTS.md C.38) for prep
 * grouping/matching — never use the translated render-string for matching.
 */
export type PrepSection =
  | "Veg"
  | "Cooks"
  | "Sides"
  | "Sauces"
  | "Slicing"
  | "Misc";

/**
 * Per-row column descriptors for the AM Prep form. The template item's
 * `prep_meta.columns` array enumerates which numeric inputs the form renders
 * for that row. Section conventions:
 *   - Veg:     ["par", "on_hand", "back_up", "total"]
 *   - Cooks:   ["par", "on_hand", "total"]
 *   - Sides:   ["par", "portioned", "back_up", "total"]
 *   - Sauces:  ["par", "line", "back_up", "total"]
 *   - Slicing: ["par", "line", "back_up", "total"]
 *   - Misc:    ["yes_no"] OR ["yes_no", "free_text"]
 *
 * Convention: PrepColumn values stay snake_case because they double as i18n
 * key suffixes (am_prep.column.on_hand → "ON HAND" / "EN MANO"). The
 * corresponding PrepInputs field names are camelCase versions (onHand,
 * backUp, etc.) — JSONB blob keys camelCase per the Build #2 convention.
 *
 * "par" is descriptive (rendered as a read-only column showing
 * prepMeta.parValue); operator-editable inputs are the others.
 *
 * Runtime narrowing helper: lib/prep.ts isPrepColumn().
 */
export type PrepColumn =
  | "par"
  | "on_hand"
  | "portioned"
  | "line"
  | "back_up"
  | "total"
  | "yes_no"
  | "free_text";

/**
 * Section-aware metadata for prep-template items per SPEC_AMENDMENTS.md C.18.
 * Stored as JSONB on `checklist_template_items.prep_meta`.
 *
 * `section` MUST equal the parent ChecklistTemplateItem's `station` field —
 * this redundancy gives a typed accessor for prep-aware code without
 * re-parsing the loosely-typed `station` text. lib/prep.ts setPrepItemSection()
 * is the single write helper that sets both atomically (used by seed +
 * future GM admin tool); the read path asserts the invariant.
 *
 * All keys camelCase per Build #2 convention: JSONB blob keys are pure
 * application data (Postgres doesn't care), so we keep one convention.
 */
export interface PrepMeta {
  section: PrepSection;
  parValue: number | null;
  parUnit: string | null;
  specialInstruction: string | null;
  columns: PrepColumn[];
}

/**
 * Operator-supplied prep input values. Populated subset matches the
 * template item's `prepMeta.columns` array.
 *
 * All keys camelCase per Build #2 convention. Stored in
 * `checklist_completions.prep_data.inputs`.
 */
export interface PrepInputs {
  onHand?: number;
  portioned?: number;
  line?: number;
  backUp?: number;
  total?: number;
  yesNo?: boolean;
  freeText?: string;
}

/**
 * Denormalized snapshot per SPEC_AMENDMENTS.md C.44. Captured at submission
 * time so subsequent template edits via the GM admin tool (Build #2 follow-up
 * PR) don't retroactively affect historical reports.
 *
 * All keys camelCase per Build #2 convention. Stored in
 * `checklist_completions.prep_data.snapshot`.
 */
export interface PrepSnapshot {
  section: PrepSection;
  itemName: string;
  parValue: number | null;
  parUnit: string | null;
  specialInstruction: string | null;
}

export interface PrepData {
  inputs: PrepInputs;
  snapshot: PrepSnapshot;
}

/**
 * Phase 2 opening item metadata per SPEC_AMENDMENTS.md C.50.
 *
 * Stored as JSONB on `checklist_template_items.prep_meta`. Distinct from
 * `PrepMeta` (which is AM Prep-specific with `columns` + `specialInstruction`).
 *
 * Discriminator: `openingPhase2: true` signals to the form-mechanics
 * dispatcher (Step 6) and submit_opening_atomic RPC (Step 4) to route
 * this item through the Phase 2 storage path (prep_data.phase2 JSONB).
 *
 * `parValue` is mirrored from AM Prep at seed time for FALLBACK display
 * when no closer-estimate snapshot resolves (e.g., AM Prep was missed
 * yesterday OR Tomato-style par-null items). At form-render time, the
 * par used for over/under-par signal computation comes from
 * CloserEstimateSnapshot.parValue (the AM Prep snapshot's frozen par per
 * C.44). The mirror is only the fallback path.
 *
 * Par drift: when AM Prep par changes via future C.44 admin tooling, the
 * seed's UPDATE-on-drift path mirrors the new par into the opening Phase 2
 * item's `parValue`. Drift is captured forensically in the audit row.
 *
 * All keys camelCase per Build #2 convention.
 */
export interface OpeningPhase2Meta {
  /** Discriminator — true for Phase 2 items, absent/false for Phase 1. */
  openingPhase2: true;
  /** AM Prep section name (e.g., "Veg", "Cooks"). */
  section: PrepSection;
  /** Par mirrored from AM Prep at seed time. Null for items like Tomato (Prep Daily). */
  parValue: number | null;
  /** Unit-of-measure suffix mirrored from AM Prep at seed time. */
  parUnit: string | null;
}

/**
 * Structured attribution for auto-complete completions per SPEC_AMENDMENTS.md C.42.
 * Stored as JSONB on `checklist_completions.auto_complete_meta`. NULL on
 * user-tap completions; populated only on rows inserted by the auto-complete
 * mechanic (e.g., the closing's "AM Prep List" report-reference item
 * completion gets this on AM Prep submission).
 *
 * Architecturally distinct from `notes` (user-typed free text). Closing-client
 * UI branches on `completion.autoCompleteMeta IS NOT NULL` to render
 * attribution-style ("AM Prep List ✓ — submitted by Cristian at 9:47 PM")
 * vs user-notes rendering. Two semantically distinct concerns, two columns.
 *
 * All keys camelCase per Build #2 convention.
 */
export interface AutoCompleteMeta {
  reportType: ReportType;
  reportInstanceId: string;
  /** ISO timestamp — when the source report was submitted. */
  reportSubmittedAt: string;
  /**
   * Count of completed reports of this type for the day. Set for multi-instance
   * reports (Mid-day Prep, C.43) where several reports auto-tick one closing
   * reference item; undefined for single-instance reports (AM Prep, Opening).
   */
  count?: number;
  /** Instance ids of the counted reports (multi-instance only). */
  reportInstanceIds?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Checklists
// ─────────────────────────────────────────────────────────────────────────────

export type ChecklistType = "opening" | "prep" | "closing";

export interface ChecklistTemplate {
  id: string;
  locationId: string;
  type: ChecklistType;
  name: string;
  description: string | null;
  active: boolean;
  /** True for prep templates (locks on first submission); false for opening/closing. */
  singleSubmissionOnly: boolean;
  reminderTime: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  /**
   * Build #3 PR 1 — gate predicate that gates instance CREATION (the
   * submission path through getOrCreateInstance). NULL means no gate
   * (all existing templates default to NULL on PR 1 merge — back-compat
   * preserves current behavior). PR 4 writes concrete predicates for
   * AM Prep, Opening, Closing, and Mid-day Prep templates.
   *
   * Evaluator: lib/checklists.ts evaluateGatePredicate. The shape is
   * locked to GatePredicate (single `requires_state` array of clauses,
   * AND-semantics across clauses). Any unknown shape is rejected at
   * evaluator time so we don't silently misinterpret future schema
   * drift.
   */
  submissionGatePredicate: GatePredicate | null;
  /**
   * Build #3 PR 1 — gate predicate that gates instance EDITS (the C.46
   * post-submission update path). Same shape as submissionGatePredicate;
   * NULL means no gate. PR 1 ships the column + lib evaluator; PR 4
   * wires canEditReport to consume the result. Until then, canEditReport
   * keeps its existing behavior unchanged.
   */
  editGatePredicate: GatePredicate | null;
}

// ─── Build #3 PR 1 — gate predicates ───────────────────────────────────────

/**
 * Single clause inside a GatePredicate. Encodes a requirement on the
 * operational state of an upstream artifact:
 *
 *   "the artifact of `template_type` at the same location, on the
 *    operational date offset by `operational_date_offset` days, must
 *    have a status in `status_in[]`."
 *
 * Examples:
 *   - Opening's submission gate (per design doc §4.8): the prior night's
 *     closing must be in any non-open state.
 *     `{ template_type: 'closing', operational_date_offset: -1,
 *        status_in: ['confirmed', 'incomplete_confirmed', 'auto_finalized'] }`
 *   - AM Prep's edit gate: today's closing must still be 'open' (locks
 *     once the closing finalizes).
 *     `{ template_type: 'closing', operational_date_offset: 0,
 *        status_in: ['open'] }`
 *   - Mid-day Prep's submission gate: today's Opening Report must be
 *     submitted (any non-open status).
 *     `{ template_type: 'opening', operational_date_offset: 0,
 *        status_in: ['confirmed', 'incomplete_confirmed', 'auto_finalized'] }`
 */
export interface GatePredicateRequiresState {
  template_type: ChecklistType;
  operational_date_offset: number;
  status_in: ChecklistStatus[];
}

/**
 * Gate predicate stored on `checklist_templates.submission_gate_predicate`
 * and `.edit_gate_predicate` (both JSONB columns, NULL = no gate). All
 * clauses in `requires_state` must be satisfied (AND-semantics). The
 * shape is intentionally minimal — locked at one variant for Build #3
 * because PR 4 only configures predicates of this shape. When a real
 * second shape surfaces (likely with Toast forward projection), extend
 * via a discriminated union; until then, evaluator throws on unknown
 * shapes rather than fail-open.
 */
export interface GatePredicate {
  requires_state: GatePredicateRequiresState[];
}

/**
 * Optional translations for user-facing template-item content per
 * SPEC_AMENDMENTS.md C.38. Shape allows partial coverage (some fields
 * translated, others fall back to the original column). The original
 * `label`/`description`/`station` columns remain the en source-of-truth
 * AND the system-key for any matching/grouping logic — translations
 * resolve at render time only via lib/i18n/content.ts resolveTemplateItemContent.
 *
 * `specialInstruction` translates `prepMeta.specialInstruction` (NOT a
 * top-level column). This is currently the only field where the
 * source-of-truth lives in nested JSONB rather than a top-level column;
 * resolveTemplateItemContent reaches into prep_meta for the fallback so
 * the caller's contract stays uniform.
 */
export type ChecklistTemplateItemTranslations = {
  [language in "en" | "es"]?: {
    label?: string;
    description?: string | null;
    station?: string | null;
    specialInstruction?: string | null;
  };
};

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  station: string | null;
  displayOrder: number;
  label: string;
  description: string | null;
  /** Decimal-aware: 3, 4, 5, 6, 6.5, 7, 8 are all valid. */
  minRoleLevel: number;
  required: boolean;
  expectsCount: boolean;
  expectsPhoto: boolean;
  vendorItemId: string | null;
  active: boolean;
  translations: ChecklistTemplateItemTranslations | null;
  /**
   * Section-aware metadata for prep-template items per SPEC_AMENDMENTS.md C.18.
   * NULL on cleaning items and on report-reference items.
   *
   * `prepMeta.section` IS the system key (English source-of-truth) for prep
   * grouping/matching; same discipline as the Walk-Out Verification gate
   * (per SPEC_AMENDMENTS.md C.38). The display-string for the section header
   * is the existing `station` column resolved through `translations.es.station`
   * at render time only — never on a key path.
   *
   * `prepMeta.section` and `station` MUST stay in sync. Both seed scripts
   * and the future GM admin tool MUST write through a single helper
   * (setPrepItemSection in lib/prep.ts) that sets both atomically. The
   * lib/prep.ts read path asserts the invariant and throws on drift.
   */
  prepMeta: PrepMeta | null;
  /** Marks closing items that auto-complete on report submission per SPEC_AMENDMENTS.md C.42. */
  reportReferenceType: ReportType | null;
  /**
   * Cross-template item reference per migration 0049. For opening Phase 2
   * items, this links to the corresponding AM Prep template item that
   * provides `closer_count` at snapshot materialization (see C.50 §2;
   * canonical FK source per Step 11 simplification — replaces the
   * draft-stage `OpeningPhase2Meta.amPrepTemplateItemId` JSONB field
   * which was architecturally redundant).
   *
   * Forward-extensible: future cross-template references (Mid-day Prep ↔
   * AM Prep, PM Report ↔ Closing, etc.) can reuse this same column. The
   * column name stays generic; semantics are contextual per consumer.
   *
   * NULL on items without cross-template reference (Phase 1 verification
   * items, AM Prep items themselves, closing items unless they're report-
   * reference items per C.42 — though those use the separate
   * reportReferenceType column).
   */
  referencesTemplateItemId: string | null;
}

/**
 * Build #3 PR 1 — `auto_finalized` joins the status enum (per design doc
 * §4.4). Operational paths into each non-open status:
 *   - `confirmed`            → closer PIN-attests; all required items completed
 *   - `incomplete_confirmed` → closer PIN-attests with reasons for incompletes
 *   - `auto_finalized`       → opener-release OR system_auto OR migration backfill;
 *                              actor type discriminated on `finalizedAtActorType`
 *
 * C.53 — three-phase opening restructure extends the enum with two transitional
 * states that apply ONLY to opening instances (Wave 2 Build #1):
 *   - `phase1_complete` → opener finished Phase 1 verification; Phase 2 prep
 *                          surface unlocks for the location (collaborative,
 *                          multi-actor per C.52)
 *   - `phase2_complete` → Phase 2 prep finished; Phase 3 setup verification
 *                          unlocks for the same KH+ opener
 *
 * Closing/AM-Prep/Mid-day-Prep templates never enter the C.53 transitional
 * states; they transition `open → confirmed | incomplete_confirmed |
 * auto_finalized` directly. Consumers branching on status only need to
 * recognize the new states when reading opening instances; existing
 * exhaustive branches in closing/AM-Prep paths can ignore them safely
 * (they will never receive an opening instance row).
 */
export type ChecklistStatus =
  | "open"
  | "phase1_complete"
  | "phase2_complete"
  | "confirmed"
  | "incomplete_confirmed"
  | "auto_finalized";

// ─────────────────────────────────────────────────────────────────────────────
// Opening — C.53 three-phase + C.54 provenance (Wave 2 Build #1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C.53 — phase discriminator for opening instances. Derived at read time from
 * `ChecklistInstance.status`:
 *   - `open`              → 1 (Phase 1 active)
 *   - `phase1_complete`   → 2 (Phase 2 active)
 *   - `phase2_complete`   → 3 (Phase 3 active)
 *   - `confirmed` / `incomplete_confirmed` / `auto_finalized` → no active phase
 *
 * Used by `lib/opening.ts loadOpeningState` return shape (`currentPhase`) and
 * the phase-router stub at `app/(authed)/operations/opening/phase-router.tsx`.
 */
export type OpeningPhase = 1 | 2 | 3;

/**
 * C.54 §2 §3 — per-completion provenance marker distinguishing closing-captured
 * counts from morning-reconstructed counts. Set at submit time when the
 * opening's `ground_truth_count` derives from `opener_recount` under NULL
 * `closer_count` (snapshot row materialized with NULL source).
 *
 *   - `closer_captured`        → ground_truth resolved from yesterday's
 *                                AM-Prep snapshot's `closer_count` (normal path)
 *   - `reconstructed_morning`  → ground_truth resolved from `opener_recount`
 *                                because the snapshot's `closer_count` was NULL
 *                                (missing closing, system-auto-finalized empty,
 *                                or other NULL-source upstream cause)
 *
 * Permanently distinguishes the two states for forensic readback (audit,
 * dashboard, AI forecast input). Per C.54 §3 sub-decision 5 (no retroactive
 * backfill), pre-C.54 completions carry NULL on this marker; consumers must
 * tolerate NULL/missing.
 *
 * Physical shape: dedicated column on `checklist_completions` (option (i) per
 * C.54 §4 recommendation). Schema migration ships in a downstream commit;
 * this type locks the contract.
 */
export type C54Provenance = "closer_captured" | "reconstructed_morning";

/**
 * C.54 §2.C — opener attestation captured at submit time when any opening
 * Phase 2 completion lands with `provenance = 'reconstructed_morning'`. The
 * opener attests whether the prior-day's closing absence was a planned closure
 * or a missed/unknown event; the value rides into the routed MoO+ notification
 * payload (C.54 §2.B).
 *
 *   - `planned_closure`     → opener confirms the location was closed yesterday
 *                              (no system record of planned closures today; the
 *                              attestation IS the record)
 *   - `missed_or_unknown`   → opener cannot confirm planned closure; higher-
 *                              priority signal for MoO+ review
 *
 * NULL on instances where no NULL-source path engaged (the attestation prompt
 * only fires when at least one opening Phase 2 completion carries
 * provenance='reconstructed_morning' at submit time).
 *
 * Physical shape: dedicated column on `checklist_instances` per C.54 §4. The
 * column name is `opener_no_prior_data_reason`; this type names the values.
 */
export type OpeningNoPriorDataReason = "planned_closure" | "missed_or_unknown";

/**
 * C.53 §3 — discriminates how an opening Phase 1 spot-check item resolved its
 * `ground_truth_count`. Stored inside `prep_data->phase1.spot_check_status`
 * on the Phase 1 completion row.
 *
 *   - `matched_via_section_verify` → opener tapped Verify Section CTA;
 *                                     `ground_truth_count = closer_count` for
 *                                     this item (no per-item recount fired)
 *   - `flagged_recount`             → opener tapped per-item recount;
 *                                     `ground_truth_count = opener_recount`
 *                                     for this item
 *
 * NULL on Phase 1 entries that are not spot-check items (station cleanliness,
 * temp readings, sauces topped off, station ready).
 *
 * Note: this enum is orthogonal to `C54Provenance` (which captures whether
 * the source `closer_count` came from a closer-captured snapshot or a
 * NULL-source path); per C.54 §4 commentary, conflating the two axes into one
 * column was explicitly rejected in favor of two independent enums.
 */
export type OpeningSpotCheckStatus = "matched_via_section_verify" | "flagged_recount";

/**
 * C.53 §3 — type tag for setup item identifiers. UUID-shaped string at runtime;
 * the brand exists at the type level only to distinguish setup-item references
 * from arbitrary strings in downstream consumer code (form state, RPC payloads,
 * audit metadata).
 *
 * The "dedicated column on checklist_completions" phrasing in the type-contract-
 * lock prompt is interpreted as: wherever setup-item identifiers surface on
 * completion-shaped data (forms, RPCs, audit), they use this branded alias.
 * Whether the physical column lives on `opening_setup_verifications.setup_item_id`
 * (per C.53 §3 schema) or extends to `checklist_completions.setup_item_id`
 * (denormalization not currently in C.53) is a downstream schema-migration
 * decision; this type stabilizes the consumer contract regardless.
 */
export type OpeningSetupItemKey = string & { readonly __brand: "OpeningSetupItemKey" };

/**
 * C.53 §3 — narrows the value-shape options for a setup item.
 *
 *   - `boolean`            → tap-confirm (placed / not placed)
 *   - `quantitative_range` → numeric input within [`minValue`, `maxValue`]; in-range
 *                             status computed at verification time
 */
export type OpeningSetupItemType = "boolean" | "quantitative_range";

/**
 * C.53 §3 — controls whether a setup item is verified once across all stations
 * it applies to, or once per station.
 *
 *   - `shared`       → one verification row, `station_key IS NULL`, single
 *                       `verified_value` covering all applicable stations
 *                       (e.g., "2-4 QT basil distributed between walking +
 *                       3rd party stations")
 *   - `per_station`  → one verification row per applicable station, each with
 *                       its own `station_key` and verification state
 *                       (e.g., "GF bread + knife on each station")
 */
export type OpeningSetupVerificationScope = "shared" | "per_station";

/**
 * C.53 §3 — categories for `opening_setup_verifications.unverified_reason_category`
 * when an item is explicitly NOT verified at Phase 3 submit (transitions
 * instance to `incomplete_confirmed`). Free-text companion is
 * `unverified_reason_text`.
 *
 * Initial enum per C.53 §8 Q-P3-7 (pre-build proposal); refinement during
 * Phase 3 component build (C.53 §10 phase 2) may add or rename entries. Locked
 * here as the type-contract baseline; downstream commits can extend.
 */
export type OpeningSetupUnverifiedReason =
  | "ingredient_unavailable"
  | "equipment_broken"
  | "skipped_time_pressure"
  | "other";

/**
 * C.53 §3 — definition row for an opening Phase 3 setup item. Template-like;
 * seeded initially per C.53 §6 "Seed data" notes (single global checklist,
 * region/location scoping reserved for future activation per C.21).
 *
 * Stored as `opening_setup_items`. Mapped from snake_case via downstream
 * lib/opening-setup.ts (commit-3 territory).
 */
export interface OpeningSetupItem {
  id: OpeningSetupItemKey;
  /** NULL for global items; per-region scoping via C.21 pattern. */
  regionId: string | null;
  /** NULL for region-wide items; per-location scoping. */
  locationId: string | null;
  itemLabel: string;
  itemType: OpeningSetupItemType;
  /** Populated for `quantitative_range`; NULL for `boolean`. */
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  /** Station keys this item applies to (e.g., `['station_cooks','station_veg']`). */
  appliesToStations: string[];
  verificationScope: OpeningSetupVerificationScope;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

/**
 * C.53 §3 — per-instance verification state for opening Phase 3 setup items.
 * Append-only; one row per shared-scope item, one row per (item, station) pair
 * for per_station-scope items.
 *
 * `verifiedValue` + `inRange` populated for quantitative items; both NULL on
 * boolean items. `unverifiedReasonCategory` + `unverifiedReasonText` populated
 * when the item is explicitly unverified at submit (transitions instance to
 * `incomplete_confirmed`).
 *
 * Stored as `opening_setup_verifications`. Mapped from snake_case via downstream
 * lib/opening-setup.ts (commit-3 territory).
 */
export interface OpeningSetupVerification {
  id: string;
  openingInstanceId: string;
  setupItemId: OpeningSetupItemKey;
  /** Populated for `per_station` scope items; NULL for `shared` scope. */
  stationKey: string | null;
  verifiedAt: string;
  verifiedBy: string;
  /** Populated for `quantitative_range`; NULL for `boolean` and unverified. */
  verifiedValue: number | null;
  /** Computed at verification time for quantitative; NULL for boolean and unverified. */
  inRange: boolean | null;
  unverifiedReasonCategory: OpeningSetupUnverifiedReason | null;
  unverifiedReasonText: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening — C.53 three-phase entry shapes (Wave 2 Build #1)
//
// Wire/lib contract for opening submissions. Discriminated by `phase`. The
// route handler validates JSON payloads into these shapes; lib/opening.ts's
// submit dispatcher routes by phase to the appropriate atomic RPC.
//
// Restructure rationale: previously OpeningEntryPhase1 + OpeningEntryPhase2
// lived in lib/opening.ts and were submitted together via the single
// submit_opening_atomic RPC. C.53 splits opening into three operationally
// distinct phases (Phase 1 verification + Phase 2 prep + Phase 3 setup
// verification), each with its own atomic submit. The types relocate to
// lib/types.ts as the canonical contract; lib/opening.ts re-exports them
// for back-compat with existing imports.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C.53 Phase 1 entry — verification + spot-check + ground-truth derivation.
 *
 * Under C.53, the per-item recount + section-verification work that previously
 * lived in Phase 2 (closer-count display + opener_recount capture) MOVES into
 * Phase 1. By the time Phase 1 closes (instance.status → 'phase1_complete'),
 * `groundTruthCount` is FROZEN per spot-check item; Phase 2 reads it without
 * re-deriving.
 *
 * Existing Phase 1 fields preserved:
 *   - `countValue` — fridge temp reading on `expects_count=true` items
 *   - `photoId` — optional discrepancy photo
 *   - `notes` — optional discrepancy comment
 *
 * New C.53 per-item fields (NULL on non-spot-check items):
 *   - `spotCheckStatus` — discriminator from OpeningSpotCheckStatus enum
 *   - `openerRecount` — populated when spotCheckStatus='flagged_recount'
 *   - `groundTruthCount` — frozen value at Phase 1 close (closer_count when
 *     section-verified, opener_recount when flagged)
 *   - `prepNeed` — derived from `par_value - ground_truth` (clamped ≥ 0); NULL
 *     when item has no par OR no count semantics
 *
 * Section verifications continue to be sent as a sibling top-level array
 * (`OpeningSectionVerificationEntry[]`) alongside `entries[]` — independent
 * of per-item entries because sections are not items.
 */
export interface OpeningEntryPhase1 {
  templateItemId: string;
  phase: "phase1";
  /** Fridge temp reading on `expects_count=true` items. NULL otherwise. */
  countValue: number | null;
  /** Optional discrepancy photo (Phase 6 wires upload). */
  photoId: string | null;
  /** Optional discrepancy comment. */
  notes: string | null;
  /** C.53 §3 — spot-check resolution. NULL on non-spot-check items. */
  spotCheckStatus: OpeningSpotCheckStatus | null;
  /** C.53 §3 — opener's recount when spotCheckStatus='flagged_recount'. NULL otherwise. */
  openerRecount: number | null;
  /**
   * C.53 §3 — frozen ground_truth_count at Phase 1 close. The form derives
   * client-side from (closer_count, section verified, opener_recount); server
   * re-derives + validates. NULL when item has no count semantics
   * (e.g., cleanliness ticks).
   */
  groundTruthCount: number | null;
  /**
   * C.53 §3 — derived prep_need at Phase 1 close. = max(par_value - ground_truth, 0).
   * NULL when item has no par OR no count semantics.
   */
  prepNeed: number | null;
}

/**
 * C.53 Phase 2 entry — simplified prep entry.
 *
 * Restructure vs prior shape:
 *   - DROPPED `phase2` sub-object nesting (top-level fields now)
 *   - DROPPED `openerRecount` (moved to Phase 1; the recount happens during
 *     verification, not during prep entry)
 *   - DROPPED closer-count display (closer_count read upstream; Phase 2 sees
 *     only the derived prep_need from Phase 1)
 *   - KEPT `openerPrepped` (required) + `overPar` / `underPar` reason captures
 *   - ADDED `deltaVsPrepNeed` for client-derived delta capture; server
 *     authoritative (Phase 2 RPC recomputes from persisted Phase 1 ground_truth)
 *
 * Reason categories unchanged from C.50. Under-prep `freeText` REQUIRED;
 * over-prep `freeText` required when `reasonCategory='other'`; over-prep
 * `directedBy` required when `reasonCategory='management_directive'`.
 */
export interface OpeningEntryPhase2 {
  templateItemId: string;
  phase: "phase2";
  /** Required — what opener prepped today. */
  openerPrepped: number;
  /**
   * Signed delta = `openerPrepped - prepNeed`. NULL when `prepNeed` is NULL
   * (item has no par OR no Phase 1 ground_truth resolved). Server is
   * authoritative; client value used for client-side validation only.
   */
  deltaVsPrepNeed: number | null;
  /** Over-prep reason capture when delta > 0; NULL when at-par OR under-prep. */
  overPar: {
    reasonCategory:
      | "management_directive"
      | "clear_fridge_space"
      | "prevent_expiration"
      | "forecast_busy"
      | "bulk_efficiency"
      | "other";
    /** Required when `reasonCategory='management_directive'`; null otherwise. */
    directedBy: string | null;
    /** Optional free-text nuance; required when `reasonCategory='other'`. */
    freeText: string | null;
  } | null;
  /** Under-prep reason capture when delta < 0; NULL when at-par OR over-prep. */
  underPar: {
    reasonCategory:
      | "ingredient_unavailable"
      | "equipment_issue"
      | "time_constraint"
      | "staff_shortage"
      | "other";
    /** REQUIRED per C.50 §4 (always non-empty on under-prep). */
    freeText: string;
  } | null;
}

/**
 * C.53 Phase 3 entry — net-new setup verification per item.
 *
 * One entry per verification row written. `verificationScope` on the parent
 * `OpeningSetupItem` controls per-station vs shared semantics:
 *   - per-station-scope items → N entries (one per station, each with its own
 *     `stationKey`)
 *   - shared-scope items → one entry with `stationKey=null`
 *
 * Verification states encoded across the field group:
 *   - VERIFIED (boolean item)     → `verifiedAt` + `verifiedBy` set;
 *                                    `verifiedValue`/`inRange` NULL;
 *                                    `unverifiedReason` NULL
 *   - VERIFIED (quantitative)     → `verifiedAt` + `verifiedBy` set;
 *                                    `verifiedValue` + `inRange` set;
 *                                    `unverifiedReason` NULL
 *   - UNVERIFIED (explicit skip)  → `verifiedAt`/`verifiedBy`/`verifiedValue`/
 *                                    `inRange` NULL; `unverifiedReason` set —
 *                                    transitions parent instance to
 *                                    `incomplete_confirmed` at submit
 */
export interface OpeningEntryPhase3 {
  /**
   * Setup-item identifier (FK into `opening_setup_items.id`). Branded for
   * type-system distinction from arbitrary string IDs (`OpeningSetupItemKey`).
   */
  setupItemId: OpeningSetupItemKey;
  phase: "phase3";
  /**
   * Per-station scope key (matches `OpeningSetupItem.appliesToStations[N]`).
   * NULL for shared-scope items.
   */
  stationKey: string | null;
  /** ISO timestamp when opener verified. NULL when unverified. */
  verifiedAt: string | null;
  /** Opener user id. NULL when unverified. */
  verifiedBy: string | null;
  /** Populated for `itemType='quantitative_range'`; NULL for boolean and unverified. */
  verifiedValue: number | null;
  /**
   * Computed at verification time for quantitative items (true when
   * `verifiedValue` within `[minValue, maxValue]`); NULL for boolean and
   * unverified.
   */
  inRange: boolean | null;
  /**
   * Present when opener explicitly leaves the item unverified at submit.
   * Triggers `incomplete_confirmed` transition. NULL on verified entries.
   */
  unverifiedReason: {
    category: OpeningSetupUnverifiedReason;
    /** Free-text companion; nullable except when `category='other'` (caller-enforced). */
    text: string | null;
  } | null;
}

/**
 * C.53 — discriminated union across all three opening phases. Submit
 * dispatcher routes by phase (and, equivalently per the C.53 phase invariants,
 * by `instance.status`).
 */
export type OpeningEntry =
  | OpeningEntryPhase1
  | OpeningEntryPhase2
  | OpeningEntryPhase3;

/**
 * Section verification entry per C.50 §2 / C.53 §3 — top-level sibling field
 * on the Phase 1 submit payload alongside `entries`. Section verifications
 * are per-section, not per-item; the Phase 1 atomic submit RPC writes one
 * row to `opening_section_verifications` per `verified=true` entry. Append-
 * only per CO-OPS convention; multi-toggle in client state collapses to
 * final value at submit.
 */
export interface OpeningSectionVerificationEntry {
  /** System-key match value (English `prep_meta.section`, e.g., "Cooks"). */
  sectionKey: string;
  /** True when opener tapped Verify Section; false otherwise. */
  verified: boolean;
}

/**
 * Build #3 PR 1 — discriminator for which operational path produced the
 * non-open status (per design doc §4.4). NULL on rows still `'open'`;
 * always set when status transitions out of `'open'`.
 *
 *   `closer_confirm`  → status ∈ {'confirmed','incomplete_confirmed'} via PIN attestation
 *   `opener_release`  → status='auto_finalized' via opener tapping Release UI (PR 4)
 *   `system_auto`     → status='auto_finalized' via pg_cron / lazy-eval (PR 1)
 *
 * Note the migration-time backfill of pre-PR-1 stranded v1 instances
 * sets `system_auto` here (the column's CHECK constraint only knows the
 * three production-path values); the migration-backfill provenance is
 * captured separately on the audit row's `metadata.release_source =
 * 'migration_backfill'`. This keeps the runtime CHECK tight while
 * preserving forensic provenance in audit metadata.
 */
export type FinalizedAtActorType = "closer_confirm" | "opener_release" | "system_auto";

export interface ChecklistInstance {
  id: string;
  templateId: string;
  locationId: string;
  date: string;
  shiftStartAt: string | null;
  status: ChecklistStatus;
  /** Confirmation fields are populated on PIN-confirm — there is no separate confirmations table. */
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  /**
   * User who initiated this instance per SPEC_AMENDMENTS.md C.18. Distinct
   * from per-completion `completedBy` — this is the row-creator. NULL on
   * pre-Build-#2 rows (closing/opening instances created before migration
   * 0038 landed).
   */
  triggeredByUserId: string | null;
  /**
   * Precise trigger timestamp per SPEC_AMENDMENTS.md C.43. Used by Mid-day
   * Prep (Build #2 follow-up PR) as the multi-instance disambiguator. NULL
   * on pre-Build-#2 rows.
   */
  triggeredAt: string | null;
  /**
   * Build #3 PR 1 — discriminator for the operational path that finalized
   * this instance. NULL on `'open'` rows; populated when status transitions
   * out of `'open'`. See `FinalizedAtActorType` for value semantics.
   */
  finalizedAtActorType: FinalizedAtActorType | null;
  /**
   * Build #3 PR 1 — assignment / drop fields supporting C.42 assignment-down
   * + self-claim/drop semantics (per design doc §4.5).
   *
   * Three operational states:
   *   1. (assignedTo=NULL,  assignmentLocked=false) → unclaimed, anyone with
   *      creation permission can self-initiate by setting assignedTo
   *   2. (assignedTo=X,     assignmentLocked=false) → self-claimed by X; X
   *      can drop, others can't pick up until X drops
   *   3. (assignedTo=Y,     assignmentLocked=true)  → manager-assigned to Y
   *      via C.42 mechanic; Y CANNOT drop; only assigner+ can reassign
   *
   * CHECK constraint forbids (assignedTo=NULL, assignmentLocked=true). PR 1
   * ships the columns + dropInstance() helper for self-drop only;
   * reassignment + manager-assignment paths are out-of-scope for PR 1.
   */
  assignedTo: string | null;
  assignmentLocked: boolean;
  /**
   * Build #3 PR 1 — most-recent-drop tracking on the instance row. Full
   * drop history lives in `audit_log` via `report.drop` events (audit_log
   * IS the event log; no separate drops table). On re-claim, dropInstance
   * does NOT NULL these out — they remain as "last time this instance was
   * dropped" historical metadata until the next drop overwrites them.
   * Forensically, the audit chain via `report.drop` is the canonical
   * timeline; the instance row is convenience.
   */
  droppedAt: string | null;
  droppedBy: string | null;
  droppedReason: string | null;
  /**
   * C.54 §2.C — opener no-prior-data attestation captured at Phase 2 submit
   * when any Phase 2 completion lands with `countProvenance='reconstructed_morning'`.
   * NULL on instances where the attestation prompt did not fire (no
   * reconstructed-morning entries) and on non-opening templates.
   *
   * Physical shape: dedicated column on `checklist_instances` per C.54 §4.
   * Type contract locked here; the schema migration adding
   * `opener_no_prior_data_reason` ships in a downstream commit. Until the
   * column lands, the row mapper in lib/checklist-rows.ts defaults this to
   * null.
   */
  openerNoPriorDataReason: OpeningNoPriorDataReason | null;
}

/**
 * Revocation reason for a completion (per SPEC_AMENDMENTS.md C.28):
 *   - error_tap          silent within-60s self-untick; no note required
 *   - not_actually_done  post-60s structured self-revoke; no note required
 *   - other              post-60s structured self-revoke; note REQUIRED
 */
export type ChecklistRevocationReason = "error_tap" | "not_actually_done" | "other";

export interface ChecklistCompletion {
  id: string;
  instanceId: string;
  templateItemId: string;
  completedBy: string;
  completedAt: string;
  countValue: number | null;
  photoId: string | null;
  notes: string | null;
  /** Non-null when a later completion superseded this one. */
  supersededAt: string | null;
  supersededBy: string | null;
  /**
   * Revocation tracking (per SPEC_AMENDMENTS.md C.28). All four fields are
   * null on un-revoked completions. revoked_at and revocation_reason are
   * always set together; revocation_note is set only when reason='other'.
   * revoked_by always equals completedBy today (revocation is self-only),
   * but is kept as a separate FK for forward-compatibility with future
   * KH+ admin override paths.
   */
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: ChecklistRevocationReason | null;
  revocationNote: string | null;
  /**
   * Accountability tagging (per SPEC_AMENDMENTS.md C.28). When the wrong
   * person was credited via tap, actualCompleterId annotates the row with
   * who actually did the work. completedBy remains operational truth (the
   * append-only tap event) and is never modified. All three fields are
   * null on un-tagged completions; set together when an annotation lands.
   */
  actualCompleterId: string | null;
  actualCompleterTaggedAt: string | null;
  actualCompleterTaggedBy: string | null;
  /**
   * Operator-supplied prep payload per SPEC_AMENDMENTS.md C.18 + C.44.
   * Populated for prep-completion rows only; NULL on cleaning + report-
   * reference auto-complete completions. `count_value` (single numeric)
   * stays NULL for prep rows — prep numbers live in `prepData.inputs`.
   */
  prepData: PrepData | null;
  /**
   * Structured attribution for auto-complete completions per SPEC_AMENDMENTS.md C.42.
   * NULL on user-tap completions; populated on rows written by the
   * auto-complete mechanic (closing's report-reference items auto-completed
   * on report submission). Closing-client UI branches on this for
   * attribution-style rendering vs user-notes rendering.
   */
  autoCompleteMeta: AutoCompleteMeta | null;
  /**
   * C.46 — chain head FK. NULL on chain head (original completion); references
   * the chain head's id for every update completion in the chain. Populated
   * by submit_am_prep_atomic on update path; NULL on original-submission rows.
   */
  originalCompletionId: string | null;
  /** C.46 — edit position. 0 for chain head; 1-3 for updates (cap enforced in RPC). */
  editCount: number;
  /**
   * C.54 §2/§3 — per-completion provenance marker distinguishing closing-
   * captured counts from morning-reconstructed counts. Set at submit time on
   * opening Phase 2 completions whose `ground_truth_count` resolves via the
   * NULL-source path; NULL elsewhere (other template types, opening Phase 1/3,
   * and pre-C.54 completions per the no-retroactive-backfill rule).
   *
   * Physical shape: dedicated column on `checklist_completions` (option (i) per
   * C.54 §4 recommendation). Type contract locked here; the schema migration
   * adding `count_provenance` ships in a downstream commit. Until the column
   * lands, the row mapper in lib/checklist-rows.ts defaults this to null.
   */
  countProvenance: C54Provenance | null;
}

export interface ChecklistSubmission {
  id: string;
  instanceId: string;
  submittedBy: string;
  submittedAt: string;
  completionIds: string[];
  isFinalConfirmation: boolean;
}

export interface ChecklistIncompleteReason {
  id: string;
  instanceId: string;
  templateItemId: string;
  reason: string;
  reportedBy: string;
  reportedAt: string;
}

export interface PrepListResolution {
  id: string;
  instanceId: string;
  vendorItemId: string;
  parTarget: number;
  onHand: number;
  /** max(parTarget - onHand, 0) */
  needed: number;
  resolvedAt: string;
  sourceOpeningCountAt: string | null;
  notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shift Overlay (renamed from daily_reports in v1.2)
// ─────────────────────────────────────────────────────────────────────────────

export type ShiftType = "open" | "lunch" | "close";

export interface ShiftOverlay {
  id: string;
  locationId: string;
  submittedBy: string;
  submittedByRole: RoleCode;
  date: string;
  shift: ShiftType;
  submittedAt: string;
  lastEditedAt: string | null;
  editCount: number;

  // Revenue
  totalSales: number | null;
  transactionCount: number | null;
  avgTicket: number | null;
  walkInSales: number | null;
  onlineSales: number | null;
  cateringSales: number | null;

  // Cash
  cashDrawerStart: number | null;
  cashDrawer: number | null;
  cashDeposit: number | null;
  cashOverShort: number | null;
  cashTips: number | null;

  // Voids/Comps/Waste
  voidCount: number;
  voidAmount: number;
  compCount: number;
  compAmount: number;
  compReason: string | null;
  wasteAmount: number;
  wasteReason: string | null;

  // Customer
  complaintCount: number;
  complaintType: string | null;

  // Delivery
  deliveryOrders: number;
  avgDeliveryTime: number | null;
  ddOrders: number;
  ueOrders: number;
  toastOrders: number;
  deliveryComplaints: number;
  driverHours: number | null;

  // Staffing
  calloutName: string | null;
  calloutReason: string | null;
  calloutCoveredBy: string | null;
  calloutCreatedOt: boolean;
  additionalCallouts: string | null;
  otEmployees: string | null;
  sentHomeEarly: string | null;

  // Context
  weather: string | null;
  externalEvent: string | null;
  eventDetail: string | null;

  // Vendor / cost
  vendorDeliveries: string | null;
  invoiceTotal: number | null;
  priceFlags: string | null;
  portionNotes: string | null;

  // People
  employeeHighlight: string | null;
  employeeConcern: string | null;
  negativeReviews: number;
  reviewResponseNeeded: boolean;
  scheduleAdherence: string | null;
  crossShiftNotes: string | null;
  followUpItems: string | null;

  // Strategic
  weeklyInventoryNotes: string | null;
  plNotes: string | null;
  maintenanceNeeded: string | null;
  strategicNotes: string | null;
  crossLocationNotes: string | null;

  // Executive
  ownerDirective: string | null;
  marketObservation: string | null;
  forecastNotes: string | null;

  // Journal
  shiftNotes: string | null;

  // Computed
  parFlags: HandoffFlag[];
  handoffFlags: HandoffFlag[];
}

export interface ShiftOverlayCorrection {
  id: string;
  originalOverlayId: string;
  submittedBy: string;
  submittedAt: string;
  fieldCorrections: Record<string, unknown>;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Written Reports & Announcements
// ─────────────────────────────────────────────────────────────────────────────

export interface WrittenReport {
  id: string;
  locationId: string | null;
  submittedBy: string;
  submittedByRole: RoleCode;
  submittedAt: string;
  lastEditedAt: string | null;
  editCount: number;
  category: string | null;
  title: string | null;
  body: string;
  visibilityMinLevel: number;
  relatedTable: string | null;
  relatedId: string | null;
}

export type AnnouncementPriority = "info" | "standard" | "urgent" | "critical";

export interface Announcement {
  id: string;
  locationId: string | null;
  postedBy: string;
  postedByRole: RoleCode;
  postedAt: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  requiresAcknowledgement: boolean;
  targetMinRoleLevel: number;
  targetMaxRoleLevel: number | null;
  expiresAt: string | null;
  active: boolean;
}

export interface AnnouncementAcknowledgement {
  id: string;
  announcementId: string;
  userId: string;
  acknowledgedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Training
// ─────────────────────────────────────────────────────────────────────────────

export type ProgressRating = "ahead" | "on_track" | "behind" | "concern";

export interface TrainingReport {
  id: string;
  locationId: string;
  submittedBy: string;
  submittedByRole: RoleCode;
  date: string;
  submittedAt: string;
  lastEditedAt: string | null;
  editCount: number;
  traineeName: string;
  traineeUserId: string | null;
  /** True when submitter is NOT the trainee's assigned trainer. */
  isObservational: boolean;
  skillsPracticed: string | null;
  hoursLogged: number | null;
  progressRating: ProgressRating | null;
  readinessNotes: string | null;
  trainerNotes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photos, Views, Audit
// ─────────────────────────────────────────────────────────────────────────────

export type PhotoCategory =
  | "quality_issue"
  | "cleanliness"
  | "equipment"
  | "inventory"
  | "staff_handoff"
  | "checklist_verification"
  | "other";

export interface ReportPhoto {
  id: string;
  relatedTable: string;
  relatedId: string;
  storagePath: string;
  category: PhotoCategory | null;
  caption: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorRole: RoleCode | null;
  action: string;
  resourceTable: string;
  resourceId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  destructive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed / synthesis
// ─────────────────────────────────────────────────────────────────────────────

export interface HandoffFlag {
  severity: "info" | "warning" | "critical";
  category: string;
  message: string;
  source: { table: string; id: string; field?: string };
}
