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
  | "special_report";

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
}

export type ChecklistStatus = "open" | "confirmed" | "incomplete_confirmed";

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
