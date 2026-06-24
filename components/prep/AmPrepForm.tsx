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
 *   per the section's shape (totalSourcesForShape, migration 0086).
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
import { ActionButton } from "@/components/ActionButton";
import { shapeFromColumns, totalSourcesForShape } from "@/lib/prep-sections";
import type {
  ChecklistInstance,
  ChecklistTemplateItem,
  LineInputType,
  PrepInputs,
  PrepSectionDefn,
} from "@/lib/types";

import { GenericPrepSection } from "./sections/GenericPrepSection";
import { MiscSection } from "./sections/MiscSection";
import { MixedPrepSection } from "./sections/MixedPrepSection";
import type { RawPrepInputs } from "./types";

/**
 * Numeric fields in RawPrepInputs that need parsing at submission time.
 * yesNo + freeText are already correctly typed (boolean / string) and
 * pass through to PrepInputs unchanged.
 */
const NUMERIC_FIELDS = ["onHand", "portioned", "line", "backUp", "total"] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];

/**
 * Maps the snake_case PrepColumn field names returned by
 * `totalSourcesForShape` (on_hand / portioned / line / back_up) to the
 * camelCase keys on RawPrepInputs (onHand / portioned / line / backUp).
 * The shape lib speaks PrepColumn; the form state speaks RawPrepInputs.
 */
const PREP_COLUMN_TO_RAW_FIELD: Record<
  "on_hand" | "portioned" | "line" | "back_up",
  NumericField
> = {
  on_hand: "onHand",
  portioned: "portioned",
  line: "line",
  back_up: "backUp",
};

/**
 * TOTAL auto-calc, shape-driven (Item/Inventory Spine, Task 4). Replaces the
 * old hardcoded TOTAL_SOURCES map. Looks up the section's shape, resolves the
 * primary + secondary source fields via totalSourcesForShape; null shape (the
 * yes_no Misc shape) → no total.
 *
 * Primary / secondary semantics (unchanged from the hardcoded version):
 *   - PRIMARY is the operationally-always-reported source (on_hand / portioned
 *     / line per shape). TOTAL stays empty until primary is filled.
 *   - SECONDARY is BACK UP (always). Optional: empty SECONDARY treated as 0 in
 *     the sum so operators do not have to type 0 on lines without backups.
 *
 * Empty-source semantics (byte-identical to the prior computeTotal):
 *   - primary "" → TOTAL "" (no value to sum)
 *   - primary filled, secondary "" → TOTAL = primary (treat empty as 0)
 *   - both filled → TOTAL = primary + secondary
 *   - any source non-finite → TOTAL "" (validator surfaces the underlying
 *     parse error on the source field)
 */
function computeTotal(
  shape: LineInputType | undefined,
  raw: RawPrepInputs,
): string {
  // free_text + yes_no carry no total; only the numeric shapes pass to
  // totalSourcesForShape (typed for PrepSectionShape). The shape is now the
  // LINE's own shape (per-line input types), not the section default.
  if (shape === undefined || shape === "free_text") return "";
  const sources = totalSourcesForShape(shape);
  if (!sources) return ""; // yes_no — n/a
  const primaryField = PREP_COLUMN_TO_RAW_FIELD[sources.primary];
  const secondaryField = PREP_COLUMN_TO_RAW_FIELD[sources.secondary];
  const primaryRaw = raw[primaryField];
  if (primaryRaw === undefined || primaryRaw === "") return "";
  const primaryNum = Number(primaryRaw);
  if (!Number.isFinite(primaryNum)) return "";
  // Secondary (BACK UP) defaults to 0 when empty — operator UX win:
  // no need to type 0 on lines without backups.
  let secondaryNum = 0;
  const secondaryRaw = raw[secondaryField];
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

/**
 * Iterates `templateItems` (source of truth — what the form must cover)
 * rather than `Object.entries(rawValues)` (operator-state-only).
 *
 * Why this matters (PR 2 Bug D fix, hardened in PR 3 smoke): if the loop
 * iterates rawValues, items the operator never touched are silently
 * skipped — no entry in rawValues means no validation runs, no error
 * fires, primary-required check never executes. An operator could submit
 * with only 1 row touched (e.g., a Misc YES tap) and the form would
 * accept it as a valid 1-entry submission. PR 2's "32 required" intent
 * was UX-layer-only and bypassable.
 *
 * Iterating `templateItems` enforces the architectural intent: every
 * template item must be evaluated, regardless of whether the operator
 * has interacted with it. Empty primary fields surface as inline errors;
 * the form-level "Fix N issues" summary fires; submit stays disabled
 * until the operator fills every required cell.
 *
 * Surfaced during Build #2 PR 3 smoke when Juan submitted EM AM Prep
 * with only "Meatball mix - YES" tapped (1 cid_count instead of 36+)
 * and the form accepted it cleanly.
 */
function validateRawValues(
  rawValues: Record<string, RawPrepInputs>,
  templateItems: ChecklistTemplateItem[],
  lineShapeByItemId: Map<string, LineInputType>,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): ValidationResult {
  const errors: Record<string, Partial<Record<keyof RawPrepInputs, string>>> = {};
  const entries: Array<{ templateItemId: string; inputs: PrepInputs }> = [];
  let errorCount = 0;

  for (const item of templateItems) {
    const templateItemId = item.id;
    // Default to empty raw row when operator has never touched this item.
    const raw: RawPrepInputs = rawValues[templateItemId] ?? {};
    const rowErrors: Partial<Record<keyof RawPrepInputs, string>> = {};
    const inputs: PrepInputs = {};

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
    // Which field is "primary" is now SHAPE-driven (migration 0086),
    // not hardcoded per slug:
    //   - yes_no shape (Misc): require `yesNo` on every item
    //     (operationally-critical attestations: meatball mix ready,
    //     meatballs ready to cook, etc.). free_text stays optional.
    //   - numeric shapes (on_hand / portioned / line): require the
    //     shape's primary source field (totalSourcesForShape(shape).primary,
    //     mapped snake_case → camelCase RawPrepInputs key).
    //
    // Per-row required check now ALWAYS fires because we iterate
    // templateItems (not rawValues). Untouched rows get default {} for
    // raw, so primary fields are undefined → primary_required error.
    //
    // SHAPE is now the LINE's own input type (per-line input types slice),
    // derived from prep_meta.columns via shapeFromColumns — not the section
    // default. For homogeneous sections every line's shape equals the section
    // shape, so this is identical to the prior section-keyed behavior.
    const shape = lineShapeByItemId.get(templateItemId);
    if (shape === "yes_no") {
      if (raw.yesNo === undefined) {
        rowErrors.yesNo = t("am_prep.error.primary_required");
        errorCount += 1;
      }
    } else if (shape === "free_text") {
      // free_text lines require a non-empty note only when the template item
      // is `required` (ChecklistTemplateItem.required). Otherwise optional.
      if (item.required && (raw.freeText === undefined || raw.freeText.length === 0)) {
        rowErrors.freeText = t("am_prep.error.primary_required");
        errorCount += 1;
      }
    } else if (shape !== undefined) {
      const sources = totalSourcesForShape(shape);
      if (sources) {
        const primaryField = PREP_COLUMN_TO_RAW_FIELD[sources.primary];
        const primaryRaw = raw[primaryField];
        if (primaryRaw === undefined || primaryRaw === "") {
          // Only set the required-error if there isn't already a
          // parse-error on the same field (parse-error is more
          // specific feedback for the operator).
          if (!rowErrors[primaryField]) {
            rowErrors[primaryField] = t("am_prep.error.primary_required");
            errorCount += 1;
          }
        }
      }
    }

    if (Object.keys(rowErrors).length > 0) {
      errors[templateItemId] = rowErrors;
    }

    // Push to entries when row has no errors. With required
    // validation enforced per templateItem, the entries array contains
    // exactly one entry per template item when validation is clean.
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
  /**
   * Sections First-Class — DB-backed section labels (slug → { en, es }) from
   * the loader. Threaded to each section component, which prefers it over the
   * i18n fallback for the section header. Optional; defaults to {} (fallback).
   */
  sectionLabels?: Record<string, { en: string; es: string | null }>;
  /**
   * Item/Inventory Spine (Task 4) — ordered active section definitions (by
   * displayOrder) from loadAmPrepState. Drives the data-driven render: the
   * form maps over these instead of a hardcoded SECTION_ORDER, routing each
   * section to MiscSection (yes_no shape) or GenericPrepSection (numeric).
   */
  sections: PrepSectionDefn[];
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
  sectionLabels = {},
  sections,
}: AmPrepFormProps) {
  const { t, language } = useTranslation();
  const router = useRouter();

  // Per-LINE shape lookup (per-line input types slice). Each line's input type
  // is derived from its own prep_meta.columns via shapeFromColumns — the line's
  // total/primary-required derive from ITS shape, not the section default. For
  // the 6 homogeneous seeded sections every line's shape equals the section
  // shape, so this is a no-op refactor until mixed sections exist (PR B).
  const lineShapeByItemId = useMemo(() => {
    const map = new Map<string, LineInputType>();
    for (const item of templateItems) {
      if (item.prepMeta) map.set(item.id, shapeFromColumns(item.prepMeta.columns));
    }
    return map;
  }, [templateItems]);

  // Group items by section. Groups initialize from `sections` (display order
  // preserved) instead of the removed hardcoded SECTION_ORDER. Items group by
  // their prepMeta.section slug; items lacking prepMeta are dropped (warn).
  const itemsBySection = useMemo(() => {
    const groups = new Map<string, ChecklistTemplateItem[]>();
    for (const s of sections) groups.set(s.slug, []);
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
  }, [templateItems, sections]);

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
    () => validateRawValues(rawValues, templateItems, lineShapeByItemId, t),
    [rawValues, templateItems, lineShapeByItemId, t],
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
        // field changes in a section whose SHAPE carries a total (the numeric
        // shapes on_hand / portioned / line; yes_no has no total). Shape-driven
        // per migration 0086 — see computeTotal JSDoc for primary/secondary
        // semantics.
        const nextRow: RawPrepInputs = { ...prevRow, [field]: rawValue };
        // Auto-calc TOTAL is driven by the LINE's own shape (per-line input
        // types), not the section default. Only numeric shapes carry a total;
        // free_text + yes_no return null from totalSourcesForShape.
        const shape = lineShapeByItemId.get(templateItemId);
        if (
          shape !== undefined &&
          shape !== "free_text" &&
          field !== "total" &&
          totalSourcesForShape(shape) != null
        ) {
          nextRow.total = computeTotal(shape, nextRow);
        }
        return { ...prev, [templateItemId]: nextRow };
      });
    },
    [lineShapeByItemId],
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
            rounded-2xl border-2 border-co-success/60 bg-co-success-surface
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
            rounded-2xl border-2 border-co-cta/60 bg-co-danger-surface
            p-4 sm:p-5 text-sm font-semibold text-co-text
          "
        >
          {submitState.message}
        </section>
      ) : null}

      {/* Sections — data-driven render in display order (Item/Inventory
          Spine, Task 4). `sections` is already display-ordered (the loader
          sorts by displayOrder). yes_no shape → MiscSection (toggle pair);
          numeric shapes → GenericPrepSection. Props match exactly what the
          former per-section components received (byte-identical render for
          the 6 seeded sections). */}
      {sections.map((s) => {
        const sectionItems = itemsBySection.get(s.slug) ?? [];
        // Homogeneity: a section renders the UNIFORM path (MiscSection /
        // GenericPrepSection — byte-identical to before this slice) iff every
        // line's own shape equals the section default. Empty section → no
        // lines → vacuously uniform → uniform path. Only a genuinely-mixed
        // section (≥1 line whose shape differs from the section default)
        // takes MixedPrepSection.
        const isUniform = sectionItems.every(
          (i) => i.prepMeta != null && shapeFromColumns(i.prepMeta.columns) === s.shape,
        );

        if (!isUniform) {
          return (
            <MixedPrepSection
              key={s.slug}
              section={s.slug}
              templateItems={sectionItems}
              rawValues={rawValues}
              onChange={handleChange}
              disabled={isReadOnly}
              errors={validation.errors}
              sectionLabels={sectionLabels}
            />
          );
        }

        return s.shape === "yes_no" ? (
          <MiscSection
            key={s.slug}
            templateItems={sectionItems}
            rawValues={rawValues}
            onChange={handleChange}
            disabled={isReadOnly}
            errors={validation.errors}
            sectionLabels={sectionLabels}
          />
        ) : (
          <GenericPrepSection
            key={s.slug}
            section={s.slug}
            shape={s.shape}
            columns={s.columns}
            templateItems={sectionItems}
            rawValues={rawValues}
            onChange={handleChange}
            disabled={isReadOnly}
            errors={validation.errors}
            sectionLabels={sectionLabels}
          />
        );
      })}

      {/* Form-level error summary — accessibility-driven (per locked
          decision: BOTH per-row inline AND form-level summary). Renders
          when there's >= 1 row-level error. */}
      {validation.errorCount > 0 && !isReadOnly ? (
        <section
          role="alert"
          aria-live="polite"
          className="
            rounded-2xl border-2 border-co-cta/60 bg-co-danger-surface
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
          <ActionButton
            onClick={handleSubmit}
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
            size="lg"
            className="w-full"
          >
            {submitButtonText}
          </ActionButton>

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
