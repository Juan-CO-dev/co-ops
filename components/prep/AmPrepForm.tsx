"use client";

/**
 * AmPrepForm — Build #2 PR 1, Part 2 (interactive logic), updated in
 * Build #2 PR 2 with daily-completeness-attestation validation.
 *
 * Operational design intent (Build #2 PR 2 Bug D, locked from Juan
 * smoke):
 *
 *   AM Prep is a daily completeness attestation. All primary source
 *   fields (28 across Veg/Cooks/Sides/Sauces/Slicing) and all 4 Misc
 *   Y/N attestations are required. The form blocks submission until
 *   32 entries are completed. BACK UP fields and free_text remain
 *   optional. TOTAL fields auto-calculate from primary + secondary
 *   per the TOTAL_SOURCES map.
 *
 *   Operator types 0 if there is nothing on hand — empty is rejected.
 *   Per Juan: "all on hand should be filled out before submitting.
 *   With on hand counts they either have to put zero or the number
 *   of the count."
 *
 *   Per-row inline errors render on the primary cell (numeric
 *   sections) or below the YES/NO toggle pair (Misc) + a form-level
 *   summary counts the total. Submit button stays disabled until
 *   every required field is filled.
 *
 * Top-level component for the AM Prep form. Owns:
 *   - rawValues state (RawPrepInputs per templateItemId; numeric fields
 *     stored as raw strings to preserve "3.", "0.0" during typing)
 *   - dirty tracking (compare current rawValues against initialRawValues
 *     via stable JSON.stringify)
 *   - validation (numeric parse + negative blocking + primary-required
 *     per section + Misc yesNo-required; per-row inline + form-level
 *     summary)
 *   - submit handler (POST /api/prep/submit; error code → translated
 *     message via am_prep.error.<code> namespace)
 *   - read-only mode rendering (when instance.status === 'confirmed' OR
 *     after a successful in-session submission)
 *   - success banner with attribution + read-only banner for returning users
 *   - discard-changes affordance (small text-style button under submit)
 *
 * Section grouping discipline (per C.38): groups by `prepMeta.section`
 * (typed enum after upstream narrowPrepTemplateItem). Items lacking
 * prepMeta dropped defensively with warn-only log.
 *
 * Submission semantics:
 *   - No PIN attestation (locked S5 — closing finalize PIN attests to
 *     the whole shift including AM Prep)
 *   - Pessimistic UX: inputs disabled during in-flight; success flips
 *     to read-only mode + success banner; error keeps inputs editable +
 *     surfaces error banner.
 */

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import type { ChecklistChainEntry } from "@/lib/checklists";
import { formatChainAttribution, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import type {
  ChecklistInstance,
  ChecklistTemplateItem,
  PrepInputs,
  PrepSection as PrepSectionEnum,
} from "@/lib/types";

import { CooksSection } from "./sections/CooksSection";
import { MiscSection } from "./sections/MiscSection";
import { SaucesSection } from "./sections/SaucesSection";
import { SidesSection } from "./sections/SidesSection";
import { SlicingSection } from "./sections/SlicingSection";
import { VegSection } from "./sections/VegSection";
import type { RawPrepInputs } from "./types";

const SECTION_ORDER: ReadonlyArray<PrepSectionEnum> = [
  "Veg",
  "Cooks",
  "Sides",
  "Sauces",
  "Slicing",
  "Misc",
];

/**
 * Numeric fields in RawPrepInputs that need parsing at submission time.
 * yesNo + freeText are already correctly typed (boolean / string) and
 * pass through to PrepInputs unchanged.
 */
const NUMERIC_FIELDS = ["onHand", "portioned", "line", "backUp", "total"] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];

/**
 * Per-section TOTAL auto-calc formula. Sections present in this map
 * auto-compute TOTAL when any source field changes; sections absent
 * (Misc) do NOT auto-calc.
 *
 * Primary / secondary semantics (locked Build #2 PR 1 follow-up per
 * Juan smoke):
 *   - PRIMARY field is the operationally-always-reported source (ON HAND
 *     for Veg/Cooks; PORTIONED for Sides; LINE for Sauces/Slicing).
 *     Required: TOTAL stays empty until primary is filled.
 *   - SECONDARY field is BACK UP (always; "leftover that needs to be
 *     prepped for service"). Optional: empty SECONDARY treated as 0
 *     in the sum so operators do not have to type 0 on every line
 *     without backups.
 *
 * Cooks history: original Q-A1 decision excluded Cooks because the
 * column shape was ["par","on_hand","total"] (no BACK UP) and auto-calc
 * would have forced TOTAL = ON HAND, masking the multi-day batch
 * semantic. Build #2 PR 1 follow-up added BACK UP per Juan ("we need
 * the backup to know how much we have leftover that needs to be
 * prepped for service"). With BACK UP present, TOTAL = ON HAND + BACK
 * UP cleanly captures total service-ready quantity across active days
 * (vodka/marinara: day-of + next day; caramelized onion: 3+ days) —
 * BACK UP being "what is left from prior batches still service-ready"
 * is exactly what makes the sum operationally correct. Cooks now
 * auto-calcs.
 *
 * Mirrored on PrepRow's SECTIONS_WITH_AUTO_TOTAL set (which gates the
 * read-only display on the TOTAL cell). Keep in sync if a section gets
 * added or its formula changes.
 *
 * Empty-source semantics:
 *   - primary "" → TOTAL "" (no value to sum)
 *   - primary filled, secondary "" → TOTAL = primary (treat empty as 0)
 *   - both filled → TOTAL = primary + secondary
 *   - any source non-finite → TOTAL "" (validator surfaces the
 *     underlying parse error on the source field)
 */
const TOTAL_SOURCES: Partial<
  Record<PrepSectionEnum, { primary: NumericField; secondary: NumericField }>
> = {
  Veg: { primary: "onHand", secondary: "backUp" },
  Cooks: { primary: "onHand", secondary: "backUp" },
  Sides: { primary: "portioned", secondary: "backUp" },
  Sauces: { primary: "line", secondary: "backUp" },
  Slicing: { primary: "line", secondary: "backUp" },
};

function computeTotal(section: PrepSectionEnum, raw: RawPrepInputs): string {
  const sources = TOTAL_SOURCES[section];
  if (!sources) return ""; // Misc — n/a
  const primaryRaw = raw[sources.primary];
  if (primaryRaw === undefined || primaryRaw === "") return "";
  const primaryNum = Number(primaryRaw);
  if (!Number.isFinite(primaryNum)) return "";
  // Secondary (BACK UP) defaults to 0 when empty — operator UX win:
  // no need to type 0 on lines without backups.
  let secondaryNum = 0;
  const secondaryRaw = raw[sources.secondary];
  if (secondaryRaw !== undefined && secondaryRaw !== "") {
    const n = Number(secondaryRaw);
    if (!Number.isFinite(n)) return "";
    secondaryNum = n;
  }
  return String(primaryNum + secondaryNum);
}

// ─────────────────────────────────────────────────────────────────────────────
// State derivation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert PrepInputs (typed) → RawPrepInputs (numeric fields as strings).
 * Used to derive initial rawValues from server-provided initialValues.
 */
function prepInputsToRaw(inputs: PrepInputs): RawPrepInputs {
  const raw: RawPrepInputs = {};
  for (const f of NUMERIC_FIELDS) {
    const v = inputs[f];
    if (v !== undefined) raw[f] = String(v);
  }
  if (inputs.yesNo !== undefined) raw.yesNo = inputs.yesNo;
  if (inputs.freeText !== undefined) raw.freeText = inputs.freeText;
  return raw;
}

/**
 * Stable JSON serialization of rawValues for dirty comparison. Sorts
 * outer keys + inner field keys so re-arrangements don't churn the dirty
 * flag. JS Object.keys order is insertion-order which matches across
 * setState calls in practice, but the sort makes it bulletproof.
 */
function stableStringify(rawValues: Record<string, RawPrepInputs>): string {
  const entries = Object.keys(rawValues)
    .sort()
    .map((k) => {
      const inner = rawValues[k] ?? {};
      const innerKeys = Object.keys(inner).sort();
      const innerEntries = innerKeys.map((ik) => [ik, (inner as Record<string, unknown>)[ik]]);
      return [k, Object.fromEntries(innerEntries)];
    });
  return JSON.stringify(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

interface ValidationResult {
  /** Per-row, per-field translated error messages. Empty when valid. */
  errors: Record<string, Partial<Record<keyof RawPrepInputs, string>>>;
  /** Total error count for the form-level summary. */
  errorCount: number;
  /**
   * Parsed entries ready for the API. Only present when validation passes
   * (errorCount === 0). Excludes rows where every field is empty/undefined.
   */
  entries: Array<{ templateItemId: string; inputs: PrepInputs }> | null;
}

function validateRawValues(
  rawValues: Record<string, RawPrepInputs>,
  sectionByItemId: Map<string, PrepSectionEnum>,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): ValidationResult {
  const errors: Record<string, Partial<Record<keyof RawPrepInputs, string>>> = {};
  const entries: Array<{ templateItemId: string; inputs: PrepInputs }> = [];
  let errorCount = 0;

  for (const [templateItemId, raw] of Object.entries(rawValues)) {
    const rowErrors: Partial<Record<keyof RawPrepInputs, string>> = {};
    const inputs: PrepInputs = {};
    const section = sectionByItemId.get(templateItemId);

    // Numeric fields — parse + validate.
    for (const f of NUMERIC_FIELDS) {
      const raw_v = raw[f];
      if (raw_v === undefined || raw_v === "") continue; // empty allowed at parse time; primary-required check below
      const parsed = Number(raw_v);
      if (!Number.isFinite(parsed)) {
        rowErrors[f] = t("am_prep.error.numeric_invalid");
        errorCount += 1;
        continue;
      }
      if (parsed < 0) {
        rowErrors[f] = t("am_prep.error.negative_blocked");
        errorCount += 1;
        continue;
      }
      inputs[f] = parsed;
    }

    // Boolean / string fields pass through.
    if (raw.yesNo !== undefined) {
      inputs.yesNo = raw.yesNo;
    }
    if (raw.freeText !== undefined && raw.freeText.length > 0) {
      inputs.freeText = raw.freeText;
    }

    // Primary-required check (Build #2 PR 2 Bug D fix). AM Prep is a
    // daily completeness attestation: ALL primary source fields must
    // be filled before submission (operator types 0 if there's
    // nothing on hand). BACK UP and free_text remain optional.
    //
    // Numeric sections (Veg/Cooks/Sides/Sauces/Slicing) require their
    // section-specific primary (onHand for Veg/Cooks; portioned for
    // Sides; line for Sauces/Slicing — drawn from TOTAL_SOURCES).
    //
    // Misc requires yesNo on every item (operationally-critical
    // attestations: meatball mix ready, meatballs ready to cook,
    // etc.). free_text on Cook Bacon? stays optional.
    if (section && section !== "Misc") {
      const sources = TOTAL_SOURCES[section];
      if (sources) {
        const primaryRaw = raw[sources.primary];
        if (primaryRaw === undefined || primaryRaw === "") {
          // Only set the required-error if there isn't already a
          // parse-error on the same field (parse-error is more
          // specific feedback for the operator).
          if (!rowErrors[sources.primary]) {
            rowErrors[sources.primary] = t("am_prep.error.primary_required");
            errorCount += 1;
          }
        }
      }
    }
    if (section === "Misc") {
      if (raw.yesNo === undefined) {
        rowErrors.yesNo = t("am_prep.error.primary_required");
        errorCount += 1;
      }
    }

    if (Object.keys(rowErrors).length > 0) {
      errors[templateItemId] = rowErrors;
    }

    // Push to entries when row has no errors. With required
    // validation, every row that gets here has at least its primary
    // field filled — so silently-empty rows no longer slip through.
    if (Object.keys(rowErrors).length === 0) {
      entries.push({ templateItemId, inputs });
    }
  }

  return {
    errors,
    errorCount,
    entries: errorCount === 0 ? entries : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-error code mapping
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_ERROR_CODES = new Set([
  "prep_role_violation",
  "prep_instance_not_open",
  "prep_auto_complete_failed",
  "prep_shape",
  "prep_invariant",
  "location_access_denied",
  "instance_not_found",
  "invalid_payload",
]);

interface SubmitResponseBodyError {
  error?: string;
  code?: string;
  // Other metadata fields ignored by the UI; the code is the discriminator.
}

interface SubmitResponseBodySuccess {
  instance: ChecklistInstance;
  submittedCompletionIds: string[];
  closingAutoCompleteId: string | null;
  /** C.46 — present on every response (0 on original; 1-3 on update). */
  editCount: number;
  /** C.46 — null on original-submission response; chain-head id on update. */
  originalSubmissionId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export interface AmPrepFormProps {
  instance: ChecklistInstance;
  /** Pre-narrowed (lib/prep.ts narrowPrepTemplateItem). */
  templateItems: ChecklistTemplateItem[];
  /**
   * Server-loaded existing values (PrepInputs typed). Empty for a fresh
   * prep instance; populated on returning-user reads of a confirmed
   * instance (read-only mode displays them) or in edit mode (chain-resolved
   * current values).
   */
  initialValues: Record<string, PrepInputs>;
  /** Author name lookup for the read-only banner. */
  authors: Record<string, string>;
  /** Current actor — drives success-banner attribution. */
  actor: { userId: string; name: string };
  /**
   * C.46 — three discrete modes (replaces former isReadOnly derivation):
   *   - "submit"    — no prior submission; render form for first submission
   *   - "edit"      — submission exists; actor has edit access; ?edit=true
   *                   was requested. Form pre-populated with chain-resolved
   *                   values; CTA "Update AM Prep"; explicit Cancel button
   *   - "read_only" — submission exists; render values as static + chain
   *                   attribution banner
   */
  mode: "submit" | "edit" | "read_only";
  /**
   * C.46 — full chain (head + updates) for attribution rendering. Empty
   * array on submit mode (no chain yet); 1+ entries on edit/read_only.
   */
  chainAttribution?: ChecklistChainEntry[];
  /** C.46 — chain head submission id; required for the edit-mode POST. */
  originalSubmissionId?: string | null;
  /** Location id — used for the Cancel button's stay-on-page navigation. */
  locationId?: string;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "in_flight" }
  | { kind: "success"; instance: ChecklistInstance }
  | { kind: "error"; code: string; message: string };

export function AmPrepForm({
  instance: initialInstance,
  templateItems,
  initialValues,
  authors,
  actor,
  mode,
  chainAttribution = [],
  originalSubmissionId = null,
  locationId,
}: AmPrepFormProps) {
  const { t, language } = useTranslation();
  const router = useRouter();

  // Group items by section.
  const itemsBySection = useMemo(() => {
    const groups = new Map<PrepSectionEnum, ChecklistTemplateItem[]>();
    for (const section of SECTION_ORDER) groups.set(section, []);
    for (const item of templateItems) {
      if (!item.prepMeta) {
        console.warn(
          `[AmPrepForm] template_item ${item.id} has no prepMeta; dropping. ` +
            `narrowPrepTemplateItem upstream should have caught this.`,
        );
        continue;
      }
      const list = groups.get(item.prepMeta.section);
      if (list) list.push(item);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.displayOrder - b.displayOrder);
    }
    return groups;
  }, [templateItems]);

  // Lookup: templateItemId → section. Used by handleChange to gate auto-
  // calc TOTAL per section.
  const sectionByItemId = useMemo(() => {
    const map = new Map<string, PrepSectionEnum>();
    for (const item of templateItems) {
      if (item.prepMeta) map.set(item.id, item.prepMeta.section);
    }
    return map;
  }, [templateItems]);

  // Derive initial rawValues from initialValues prop (one-time at mount).
  const initialRawValues = useMemo(() => {
    const raw: Record<string, RawPrepInputs> = {};
    for (const [k, v] of Object.entries(initialValues)) {
      raw[k] = prepInputsToRaw(v);
    }
    return raw;
  }, [initialValues]);

  const initialRawValuesString = useMemo(
    () => stableStringify(initialRawValues),
    [initialRawValues],
  );

  // State.
  const [instance, setInstance] = useState<ChecklistInstance>(initialInstance);
  const [rawValues, setRawValues] = useState<Record<string, RawPrepInputs>>(initialRawValues);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // Derived: dirty + validation.
  const isDirty = useMemo(
    () => stableStringify(rawValues) !== initialRawValuesString,
    [rawValues, initialRawValuesString],
  );

  const validation = useMemo(
    () => validateRawValues(rawValues, sectionByItemId, t),
    [rawValues, sectionByItemId, t],
  );

  // C.46 — read-only is now derived from the explicit `mode` prop (replaces
  // the former instance.status-based derivation). Mode is computed once in
  // the page Server Component and passed down. In-session flips during
  // submit (in_flight + success) still disable inputs locally — those are
  // session-local UI state that the server-derived mode wouldn't know about.
  const isReadOnly =
    mode === "read_only" ||
    submitState.kind === "in_flight" ||
    submitState.kind === "success";

  // ─── Change dispatch ────────────────────────────────────────────────────

  const handleChange = useCallback(
    (templateItemId: string, field: keyof RawPrepInputs, rawValue: string) => {
      setRawValues((prev) => {
        const prevRow = prev[templateItemId] ?? {};
        // Boolean field (yesNo) — rawValue is "true" / "false" string from
        // the toggle's onClick. Parse to boolean for storage.
        if (field === "yesNo") {
          const parsedBool = rawValue === "true";
          return { ...prev, [templateItemId]: { ...prevRow, yesNo: parsedBool } };
        }
        // String field (freeText) — pass through.
        if (field === "freeText") {
          return { ...prev, [templateItemId]: { ...prevRow, freeText: rawValue } };
        }
        // Numeric field — store raw string. Auto-calc TOTAL when a source
        // field changes in a section that has the auto-calc formula
        // (Veg/Cooks/Sides/Sauces/Slicing). All 5 numeric sections now
        // auto-calc — see TOTAL_SOURCES JSDoc for primary/secondary
        // semantics + Cooks BACK UP-column history.
        const nextRow: RawPrepInputs = { ...prevRow, [field]: rawValue };
        const section = sectionByItemId.get(templateItemId);
        if (section && field !== "total" && TOTAL_SOURCES[section]) {
          nextRow.total = computeTotal(section, nextRow);
        }
        return { ...prev, [templateItemId]: nextRow };
      });
    },
    [sectionByItemId],
  );

  // ─── Submit ─────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (validation.entries === null) return; // guard — button should be disabled
    setSubmitState({ kind: "in_flight" });
    try {
      // C.46 — when in edit mode, post is_update=true + chain head id.
      const requestBody =
        mode === "edit" && originalSubmissionId
          ? {
              instanceId: instance.id,
              entries: validation.entries,
              isUpdate: true,
              originalSubmissionId,
            }
          : {
              instanceId: instance.id,
              entries: validation.entries,
            };
      const res = await fetch("/api/prep/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        redirect: "manual",
      });
      if (res.ok) {
        const body = (await res.json()) as SubmitResponseBodySuccess;
        setInstance(body.instance);
        setSubmitState({ kind: "success", instance: body.instance });
        return;
      }
      // Error path — extract code, fall back to fallback.
      let body: SubmitResponseBodyError = {};
      try {
        body = (await res.json()) as SubmitResponseBodyError;
      } catch {
        // unparseable body
      }
      const code = body.code && KNOWN_ERROR_CODES.has(body.code) ? body.code : "fallback";
      setSubmitState({
        kind: "error",
        code,
        message: t(`am_prep.error.${code}` as Parameters<typeof t>[0]),
      });
    } catch {
      setSubmitState({
        kind: "error",
        code: "network",
        message: t("am_prep.error.network"),
      });
    }
  }, [instance.id, validation.entries, t, mode, originalSubmissionId]);

  // ─── Discard changes ────────────────────────────────────────────────────

  const handleDiscard = useCallback(() => {
    setRawValues(initialRawValues);
    if (submitState.kind === "error") setSubmitState({ kind: "idle" });
  }, [initialRawValues, submitState.kind]);

  // ─── C.46 Cancel (edit mode) ────────────────────────────────────────────
  // Stay on /operations/am-prep, drop ?edit=true → toggles to read_only mode.
  // Less disorienting than full nav-to-dashboard.
  const handleCancelEdit = useCallback(() => {
    if (locationId) {
      router.push(`/operations/am-prep?location=${locationId}`);
    } else {
      router.push("/dashboard");
    }
  }, [router, locationId]);

  // ─── Submit-button computed state ───────────────────────────────────────

  const submitButtonText = (() => {
    const isEditMode = mode === "edit";
    if (submitState.kind === "in_flight") {
      return isEditMode
        ? t("am_prep.submit.button_update_in_flight")
        : t("am_prep.submit.button_in_flight");
    }
    if (validation.errorCount > 0) return t("am_prep.submit.button_fix_errors");
    if (!isDirty) return t("am_prep.submit.button_no_changes");
    return isEditMode ? t("am_prep.submit.button_update") : t("am_prep.submit.button");
  })();

  const submitDisabled =
    submitState.kind === "in_flight" ||
    !isDirty ||
    validation.errorCount > 0 ||
    isReadOnly;

  // ─── Banner copy ────────────────────────────────────────────────────────

  const successBanner = (() => {
    if (submitState.kind !== "success") return null;
    const time = submitState.instance.confirmedAt
      ? formatTime(submitState.instance.confirmedAt, language)
      : "";
    return t("am_prep.banner.success", { time, name: actor.name });
  })();

  const readOnlyBanner = (() => {
    // Only render the read-only banner for instances confirmed BEFORE this
    // session (server-loaded confirmed state). Post-submit success uses the
    // success banner above; both cover the read-only-now state but with
    // different attribution copy.
    if (submitState.kind === "success") return null;
    if (mode !== "read_only") return null;
    // C.46 — chain rendering: 2+ entries → comma-separated chain via shared
    // formatter; 1 entry → existing single-author banner copy. Empty chain
    // falls through to the legacy single-author derivation (defensive).
    if (chainAttribution.length >= 2) {
      return t("am_prep.banner.read_only_chain", {
        attribution: formatChainAttribution(chainAttribution, language, t),
      });
    }
    if (chainAttribution.length === 1) {
      const head = chainAttribution[0]!;
      return t("am_prep.banner.read_only", {
        name: head.submitterName,
        time: formatTime(head.submittedAt, language),
      });
    }
    // Defensive fallback (no chain loaded but mode says read_only).
    const confirmedByName = instance.confirmedBy ? authors[instance.confirmedBy] ?? "—" : "—";
    const time = instance.confirmedAt ? formatTime(instance.confirmedAt, language) : "";
    return t("am_prep.banner.read_only", { name: confirmedByName, time });
  })();

  // C.46 — editing banner ("Editing AM Prep submitted by [name] at [time]").
  // Renders only in edit mode; uses chain head's attribution.
  const editingBanner = (() => {
    if (mode !== "edit") return null;
    if (chainAttribution.length === 0) return null;
    const head = chainAttribution[0]!;
    return t("am_prep.banner.editing", {
      name: head.submitterName,
      time: formatTime(head.submittedAt, language),
    });
  })();

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* C.46 editing banner (mode === "edit"). */}
      {editingBanner ? (
        <section
          role="status"
          aria-live="polite"
          className="
            rounded-2xl border-2 border-co-gold/60 bg-co-surface-2
            p-4 sm:p-5 text-sm font-semibold text-co-text
          "
        >
          {editingBanner}
        </section>
      ) : null}

      {/* Read-only banner (server-loaded confirmed instance). */}
      {readOnlyBanner ? (
        <section
          role="status"
          aria-live="polite"
          className="
            rounded-2xl border-2 border-co-border-2 bg-co-surface-2
            p-4 sm:p-5 text-sm font-semibold text-co-text
          "
        >
          {readOnlyBanner}
        </section>
      ) : null}

      {/* Success banner (post-submit). */}
      {successBanner ? (
        <section
          role="status"
          aria-live="polite"
          className="
            rounded-2xl border-2 border-co-success/60 bg-[#E8F7EE]
            p-4 sm:p-5 text-sm font-semibold text-co-text
          "
        >
          {successBanner}
        </section>
      ) : null}

      {/* Error banner (post-submit failure; inputs remain editable). */}
      {submitState.kind === "error" ? (
        <section
          role="alert"
          aria-live="assertive"
          className="
            rounded-2xl border-2 border-co-cta/60 bg-[#FFE8E9]
            p-4 sm:p-5 text-sm font-semibold text-co-text
          "
        >
          {submitState.message}
        </section>
      ) : null}

      {/* Sections — render in canonical order. */}
      <VegSection
        templateItems={itemsBySection.get("Veg") ?? []}
        rawValues={rawValues}
        onChange={handleChange}
        disabled={isReadOnly}
        errors={validation.errors}
      />
      <CooksSection
        templateItems={itemsBySection.get("Cooks") ?? []}
        rawValues={rawValues}
        onChange={handleChange}
        disabled={isReadOnly}
        errors={validation.errors}
      />
      <SidesSection
        templateItems={itemsBySection.get("Sides") ?? []}
        rawValues={rawValues}
        onChange={handleChange}
        disabled={isReadOnly}
        errors={validation.errors}
      />
      <SaucesSection
        templateItems={itemsBySection.get("Sauces") ?? []}
        rawValues={rawValues}
        onChange={handleChange}
        disabled={isReadOnly}
        errors={validation.errors}
      />
      <SlicingSection
        templateItems={itemsBySection.get("Slicing") ?? []}
        rawValues={rawValues}
        onChange={handleChange}
        disabled={isReadOnly}
        errors={validation.errors}
      />
      <MiscSection
        templateItems={itemsBySection.get("Misc") ?? []}
        rawValues={rawValues}
        onChange={handleChange}
        disabled={isReadOnly}
        errors={validation.errors}
      />

      {/* Form-level error summary — accessibility-driven (per locked
          decision: BOTH per-row inline AND form-level summary). Renders
          when there's >= 1 row-level error. */}
      {validation.errorCount > 0 && !isReadOnly ? (
        <section
          role="alert"
          aria-live="polite"
          className="
            rounded-2xl border-2 border-co-cta/60 bg-[#FFE8E9]
            p-4 sm:p-5 text-sm font-semibold text-co-text
          "
        >
          {validation.errorCount === 1
            ? t("am_prep.error.summary_one")
            : t("am_prep.error.summary_other", { count: validation.errorCount })}
        </section>
      ) : null}

      {/* Submit affordance + discard. Only render when not in read-only mode
          AND not after a successful submission (those flips hide the form's
          interactive footer). */}
      {!isReadOnly ? (
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
            className={[
              "inline-flex min-h-[64px] w-full items-center justify-center rounded-xl",
              "px-5 text-base font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              submitDisabled
                ? "border-2 border-co-border-2 bg-co-surface text-co-text-faint cursor-not-allowed"
                : "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep",
            ].join(" ")}
          >
            {submitButtonText}
          </button>

          {/* Discard-changes affordance — visible only when dirty (the
              !isReadOnly outer guard already excludes in-flight + success
              + server-confirmed states, so submitState.kind here is
              narrowed to "idle" | "error"). Small text-style button. */}
          {isDirty ? (
            <button
              type="button"
              onClick={handleDiscard}
              className="
                inline-flex min-h-[36px] items-center justify-center self-center
                px-3 text-xs font-semibold uppercase tracking-[0.12em] text-co-text-muted
                transition hover:text-co-text
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/40
                rounded-md
              "
            >
              {t("am_prep.submit.discard")}
            </button>
          ) : null}

          {/* C.46 Cancel button (edit mode) — explicit nav-back-to-read-only.
              Distinct from Discard (which keeps user in edit mode + resets
              values); Cancel exits edit mode entirely. Stay-on-page pattern:
              drops ?edit=true → page re-renders in read_only mode. */}
          {mode === "edit" ? (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="
                inline-flex min-h-[36px] items-center justify-center self-center
                px-3 text-xs font-semibold uppercase tracking-[0.12em] text-co-text-muted
                transition hover:text-co-text
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/40
                rounded-md
              "
            >
              {t("am_prep.submit.button_cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
