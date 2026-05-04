"use client";

/**
 * AmPrepForm — Build #2 PR 1, Part 2 (interactive logic).
 *
 * Top-level component for the AM Prep form. Owns:
 *   - rawValues state (RawPrepInputs per templateItemId; numeric fields
 *     stored as raw strings to preserve "3.", "0.0" during typing)
 *   - dirty tracking (compare current rawValues against initialRawValues
 *     via stable JSON.stringify)
 *   - validation (numeric parse + negative blocking + at-least-one-changed
 *     gate; per-row inline + form-level summary)
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
 *   - Empty entries: [] is allowed server-side (per locked plan); UI
 *     blocks at-least-one-changed via the dirty gate before letting
 *     submit fire, so the empty-payload path doesn't normally reach
 *     the server.
 *   - Pessimistic UX: inputs disabled during in-flight; success flips
 *     to read-only mode + success banner; error keeps inputs editable +
 *     surfaces error banner.
 */

import { useCallback, useMemo, useState } from "react";

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
 * Per-section TOTAL auto-calc formula sources. Sections present in this
 * map auto-compute TOTAL when any source field changes; sections absent
 * (Cooks, Misc) do NOT auto-calc.
 *
 * Cooks is intentionally excluded: Cooks items are batched ahead with
 * multi-day validity (vodka/marinara: day-of + next day; caramelized
 * onion: 3+ days). Cooks TOTAL captures total batch quantity across
 * active days, distinct from ON HAND ("currently on the line"). Auto-
 * calc would force a 1:1 mirror of ON HAND which is the wrong
 * operational signal — operator supplies TOTAL manually for Cooks.
 *
 * Mirrored on PrepRow's SECTIONS_WITH_AUTO_TOTAL set (which gates the
 * read-only display on the TOTAL cell). Keep in sync if a section gets
 * added or its formula changes.
 *
 * Empty-source semantics (locked Build #2 PR 1 Bug A fix): TOTAL stays
 * empty until ALL sources are non-empty. If any source is "" the TOTAL
 * is "". Both sources "0" → TOTAL "0". Both filled → TOTAL = sum. Any
 * source non-finite → TOTAL "" (validator surfaces the underlying error).
 */
const TOTAL_SOURCES: Partial<Record<PrepSectionEnum, ReadonlyArray<NumericField>>> = {
  Veg: ["onHand", "backUp"],
  Sides: ["portioned", "backUp"],
  Sauces: ["line", "backUp"],
  Slicing: ["line", "backUp"],
};

function computeTotal(section: PrepSectionEnum, raw: RawPrepInputs): string {
  const sources = TOTAL_SOURCES[section];
  if (!sources) return ""; // Cooks / Misc — operator-supplied or n/a
  const nums: number[] = [];
  for (const src of sources) {
    const v = raw[src];
    if (v === undefined || v === "") return ""; // any empty → TOTAL empty
    const n = Number(v);
    if (!Number.isFinite(n)) return ""; // validator surfaces source-side error
    nums.push(n);
  }
  return String(nums.reduce((a, b) => a + b, 0));
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
  t: (key: TranslationKey, params?: TranslationParams) => string,
): ValidationResult {
  const errors: Record<string, Partial<Record<keyof RawPrepInputs, string>>> = {};
  const entries: Array<{ templateItemId: string; inputs: PrepInputs }> = [];
  let errorCount = 0;

  for (const [templateItemId, raw] of Object.entries(rawValues)) {
    const rowErrors: Partial<Record<keyof RawPrepInputs, string>> = {};
    const inputs: PrepInputs = {};
    let rowHasAnyValue = false;

    // Numeric fields — parse + validate.
    for (const f of NUMERIC_FIELDS) {
      const raw_v = raw[f];
      if (raw_v === undefined || raw_v === "") continue; // empty allowed
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
      rowHasAnyValue = true;
    }

    // Boolean / string fields pass through.
    if (raw.yesNo !== undefined) {
      inputs.yesNo = raw.yesNo;
      rowHasAnyValue = true;
    }
    if (raw.freeText !== undefined && raw.freeText.length > 0) {
      inputs.freeText = raw.freeText;
      rowHasAnyValue = true;
    }

    if (Object.keys(rowErrors).length > 0) {
      errors[templateItemId] = rowErrors;
    }

    if (rowHasAnyValue && Object.keys(rowErrors).length === 0) {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Language-aware time formatter (per dashboard's PR 5d formatDateLabel
 * pattern). Uses es-US locale when language === "es", en-US otherwise.
 *
 * Architectural commitment per AGENTS.md "Language-aware time/date
 * formatting" durable lesson: every time/date formatting site in CO-OPS
 * uses language-aware locale going forward. Closing-client's existing
 * browser-locale time formatting is a known outlier pending cleanup.
 */
function formatTime(iso: string, language: Language): string {
  try {
    return new Date(iso).toLocaleTimeString(
      language === "es" ? "es-US" : "en-US",
      { hour: "numeric", minute: "2-digit" },
    );
  } catch {
    return "";
  }
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
   * instance (read-only mode displays them).
   */
  initialValues: Record<string, PrepInputs>;
  /** Author name lookup for the read-only banner. */
  authors: Record<string, string>;
  /** Current actor — drives success-banner attribution. */
  actor: { userId: string; name: string };
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
}: AmPrepFormProps) {
  const { t, language } = useTranslation();

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

  const validation = useMemo(() => validateRawValues(rawValues, t), [rawValues, t]);

  // Read-only when the instance has already been confirmed (server load OR
  // post-submission flip in this session).
  //
  // `incomplete_confirmed` is type-reachable via ChecklistStatus but
  // operationally unreachable for AM Prep instances under current code:
  // closing's confirmInstance (lib/checklists.ts) is the only path that
  // sets that status, and AM Prep doesn't use confirmInstance — the
  // submit_am_prep_atomic RPC always writes 'confirmed'. Kept here as
  // defensive coverage in case a future template-type unification
  // routes prep through confirmInstance, OR if an admin tool ever
  // surfaces a manual status transition.
  const isReadOnly =
    instance.status === "confirmed" ||
    instance.status === "incomplete_confirmed" ||
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
        // (Veg/Sides/Sauces/Slicing). Cooks is excluded: its TOTAL
        // captures multi-day batch quantity (operator-supplied) — see
        // TOTAL_SOURCES JSDoc for the operational rationale.
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
      const res = await fetch("/api/prep/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instance.id,
          entries: validation.entries,
        }),
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
  }, [instance.id, validation.entries, t]);

  // ─── Discard changes ────────────────────────────────────────────────────

  const handleDiscard = useCallback(() => {
    setRawValues(initialRawValues);
    if (submitState.kind === "error") setSubmitState({ kind: "idle" });
  }, [initialRawValues, submitState.kind]);

  // ─── Submit-button computed state ───────────────────────────────────────

  const submitButtonText = (() => {
    if (submitState.kind === "in_flight") return t("am_prep.submit.button_in_flight");
    if (validation.errorCount > 0) return t("am_prep.submit.button_fix_errors");
    if (!isDirty) return t("am_prep.submit.button_no_changes");
    return t("am_prep.submit.button");
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
    if (instance.status !== "confirmed" && instance.status !== "incomplete_confirmed") {
      return null;
    }
    const confirmedByName = instance.confirmedBy ? authors[instance.confirmedBy] ?? "—" : "—";
    const time = instance.confirmedAt ? formatTime(instance.confirmedAt, language) : "";
    return t("am_prep.banner.read_only", { name: confirmedByName, time });
  })();

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
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
        </div>
      ) : null}
    </div>
  );
}
