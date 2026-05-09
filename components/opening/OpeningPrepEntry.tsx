"use client";

/**
 * OpeningPrepEntry — Phase 2 prep verification UI (Build #3 PR 3 Step 6).
 *
 * Section-grouped per-item layout per locked Q3:
 *   - 5 sections: Veg / Cooks / Sides / Sauces / Slicing
 *   - Per-item: label + closer-estimate display + 2 numeric inputs +
 *     computed signals + modal triggers
 *
 * Form state model (per locked Q2): parent OpeningClient owns
 * `phase2Values: Map<templateItemId, OpeningPrepEntryFormValue>`. This
 * component is pure presentation — receives values + change handlers.
 *
 * Closer-estimate snapshot (per locked Q7): caller passes resolved Map<id,
 * CloserCountSnapshot|null>. Per-item lookup at render time. NULL = no
 * AM Prep yesterday (Tomato par-null also resolves to a snapshot but with
 * parValue=null — see Q6).
 *
 * Computed signals (per locked sub-decision (e), option (i)): both opener
 * inputs must be numeric before any signal renders. No premature partial
 * signals during typing.
 *
 * Modal triggers: tap signal banner → open OverParModal / UnderParModal.
 * Modal save sets phase2Values[id].overPar or .underPar via onChange.
 *
 * Tomato + null-par edge case (per locked Q6): when parValue null (Tomato
 * OR no closer-estimate AND prep_meta.parValue null), no over/under signals
 * computed, no modals trigger. Inputs still required via the gate.
 */

import { useMemo, useState } from "react";

import { resolveTemplateItemContent } from "@/lib/i18n/content";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";
import type { CloserCountSnapshot } from "@/lib/opening";
import type { ChecklistTemplateItem, OpeningPhase2Meta } from "@/lib/types";

import {
  OverParModal,
  type ManagerOption,
  type OverParCapture,
} from "./OverParModal";
import { UnderParModal, type UnderParCapture } from "./UnderParModal";

export interface OpeningPrepEntryFormValue {
  openerActual: number | null;
  openerPrepped: number | null;
  overPar: OverParCapture | null;
  underPar: UnderParCapture | null;
}

interface OpeningPrepEntryProps {
  /** Phase 2 template items (already filtered by openingPhase2 marker upstream). */
  items: ChecklistTemplateItem[];
  /** Form state keyed by templateItemId. */
  values: Map<string, OpeningPrepEntryFormValue>;
  onChange: (templateItemId: string, next: OpeningPrepEntryFormValue) => void;
  /** Closer-estimate snapshots per item (null when no AM Prep yesterday OR par-null). */
  closerSnapshots: Record<string, CloserCountSnapshot | null>;
  /** AGM+ at this location for over-par directedBy dropdown. */
  managers: ReadonlyArray<ManagerOption>;
  language: Language;
  /** True after submit attempt to highlight required-but-missing fields. */
  showMissingErrors: boolean;
}

export function OpeningPrepEntry({
  items,
  values,
  onChange,
  closerSnapshots,
  managers,
  language,
  showMissingErrors,
}: OpeningPrepEntryProps) {
  const { t } = useTranslation();

  // Modal state — single ID at a time. Null = closed.
  const [overParModalItemId, setOverParModalItemId] = useState<string | null>(null);
  const [underParModalItemId, setUnderParModalItemId] = useState<string | null>(null);

  // Group by section. Insertion-order Map per existing closing/opening pattern.
  const sectionGroups = useMemo(() => {
    const groups = new Map<string, ChecklistTemplateItem[]>();
    for (const it of items) {
      const meta = it.prepMeta as OpeningPhase2Meta | null;
      const section = meta?.section ?? it.station ?? "—";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section)!.push(it);
    }
    return groups;
  }, [items]);

  // Resolve over/under par modal targets.
  const overParTarget = overParModalItemId
    ? items.find((it) => it.id === overParModalItemId)
    : null;
  const underParTarget = underParModalItemId
    ? items.find((it) => it.id === underParModalItemId)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {Array.from(sectionGroups.entries()).map(([sectionKey, sectionItems]) => {
        const firstItem = sectionItems[0];
        const sectionDisplay = firstItem
          ? resolveTemplateItemContent(firstItem, language).station ?? sectionKey
          : sectionKey;

        return (
          <section
            key={sectionKey}
            aria-label={sectionDisplay}
            className="rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5"
          >
            <header>
              <h3 className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text">
                {sectionDisplay}
              </h3>
            </header>

            <ul className="mt-3 flex flex-col">
              {sectionItems.map((item) => {
                const value = values.get(item.id) ?? {
                  openerActual: null,
                  openerPrepped: null,
                  overPar: null,
                  underPar: null,
                };
                const snapshot = closerSnapshots[item.id] ?? null;
                const meta = item.prepMeta as OpeningPhase2Meta | null;
                const fallbackPar = meta?.parValue ?? null;
                const fallbackParUnit = meta?.parUnit ?? null;
                // Effective par: snapshot's frozen par (per C.44) takes
                // precedence; fallback to mirrored par from prep_meta.
                const effectivePar = snapshot?.parValue ?? fallbackPar;
                const effectiveParUnit = fallbackParUnit;

                return (
                  <PrepEntryRow
                    key={item.id}
                    item={item}
                    value={value}
                    snapshot={snapshot}
                    effectivePar={effectivePar}
                    effectiveParUnit={effectiveParUnit}
                    language={language}
                    showMissingErrors={showMissingErrors}
                    onChange={(next) => onChange(item.id, next)}
                    onOpenOverPar={() => setOverParModalItemId(item.id)}
                    onOpenUnderPar={() => setUnderParModalItemId(item.id)}
                    t={t}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}

      {overParTarget ? (
        <OverParModal
          open={!!overParModalItemId}
          itemLabel={resolveTemplateItemContent(overParTarget, language).label}
          initial={values.get(overParTarget.id)?.overPar ?? null}
          managers={managers}
          onSave={(capture) => {
            const cur = values.get(overParTarget.id) ?? {
              openerActual: null,
              openerPrepped: null,
              overPar: null,
              underPar: null,
            };
            onChange(overParTarget.id, { ...cur, overPar: capture });
            setOverParModalItemId(null);
          }}
          onCancel={() => setOverParModalItemId(null)}
        />
      ) : null}

      {underParTarget ? (
        <UnderParModal
          open={!!underParModalItemId}
          itemLabel={resolveTemplateItemContent(underParTarget, language).label}
          initial={values.get(underParTarget.id)?.underPar ?? null}
          onSave={(capture) => {
            const cur = values.get(underParTarget.id) ?? {
              openerActual: null,
              openerPrepped: null,
              overPar: null,
              underPar: null,
            };
            onChange(underParTarget.id, { ...cur, underPar: capture });
            setUnderParModalItemId(null);
          }}
          onCancel={() => setUnderParModalItemId(null)}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-item row
// ─────────────────────────────────────────────────────────────────────────────

interface PrepEntryRowProps {
  item: ChecklistTemplateItem;
  value: OpeningPrepEntryFormValue;
  snapshot: CloserCountSnapshot | null;
  effectivePar: number | null;
  effectiveParUnit: string | null;
  language: Language;
  showMissingErrors: boolean;
  onChange: (next: OpeningPrepEntryFormValue) => void;
  onOpenOverPar: () => void;
  onOpenUnderPar: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function PrepEntryRow({
  item,
  value,
  snapshot,
  effectivePar,
  effectiveParUnit,
  language,
  showMissingErrors,
  onChange,
  onOpenOverPar,
  onOpenUnderPar,
  t,
}: PrepEntryRowProps) {
  const resolved = resolveTemplateItemContent(item, language);

  // Per locked Sub-decision (e), option (i): both inputs numeric before signal renders.
  const bothNumeric =
    typeof value.openerActual === "number" &&
    typeof value.openerPrepped === "number";

  // Over/under-par signal computed only when effective par exists AND both
  // inputs are numeric. Tomato (null par) and no-AM-Prep-yesterday share the
  // null-par code path: no signal, no modal trigger.
  const overParDelta =
    bothNumeric && effectivePar !== null && value.openerPrepped! > effectivePar
      ? value.openerPrepped! - effectivePar
      : null;
  const underParDelta =
    bothNumeric && effectivePar !== null && value.openerPrepped! < effectivePar
      ? effectivePar - value.openerPrepped!
      : null;

  // Missing-input error highlighting after submit attempt.
  const actualMissing = showMissingErrors && value.openerActual === null;
  const preppedMissing = showMissingErrors && value.openerPrepped === null;

  const parDisplay =
    effectivePar !== null
      ? `${effectivePar}${effectiveParUnit ? ` ${effectiveParUnit}` : ""}`
      : null;

  const closerEstimateBadge =
    snapshot && snapshot.amPrepEditCount > 0
      ? t("opening.phase2.edit_count_badge", { count: snapshot.amPrepEditCount })
      : null;

  return (
    <li className="flex flex-col gap-2 border-t border-co-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-co-text">{resolved.label}</p>
        {parDisplay ? (
          <p className="text-xs font-medium text-co-text-dim">
            {t("opening.phase2.par_label")}: {parDisplay}
          </p>
        ) : null}
      </div>

      {/* Closer estimate display (read-only). */}
      <div className="rounded-md border border-co-border-2 bg-co-bg p-2.5 text-xs">
        <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">
          {t("opening.phase2.closer_estimate_label")}:
        </span>{" "}
        {snapshot && typeof snapshot.total === "number" ? (
          <>
            <span className="font-semibold text-co-text">{snapshot.total}</span>
            {effectiveParUnit ? (
              <span className="text-co-text-muted"> {effectiveParUnit}</span>
            ) : null}
            {closerEstimateBadge ? (
              <span className="ml-2 inline-flex items-center rounded-full border border-co-border bg-co-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-co-text-dim">
                {closerEstimateBadge}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-co-text-dim">
            {t("opening.phase2.no_closer_estimate")}
          </span>
        )}
      </div>

      {/* Inputs row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("opening.phase2.opener_actual_label")}
          </label>
          <NumericInput
            value={value.openerActual}
            onChange={(next) => onChange({ ...value, openerActual: next })}
            ariaLabel={t("opening.phase2.input_actual_aria", { item: resolved.label })}
            hasError={actualMissing}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("opening.phase2.opener_prepped_label")}
          </label>
          <NumericInput
            value={value.openerPrepped}
            onChange={(next) => onChange({ ...value, openerPrepped: next })}
            ariaLabel={t("opening.phase2.input_prepped_aria", { item: resolved.label })}
            hasError={preppedMissing}
          />
        </div>
      </div>

      {/* Signal banner — only when bothNumeric AND par exists AND deltas trigger. */}
      {overParDelta !== null ? (
        <button
          type="button"
          onClick={onOpenOverPar}
          className={[
            "self-start inline-flex min-h-[36px] items-center gap-2 rounded-md px-3 py-1",
            "text-xs font-bold uppercase tracking-[0.12em]",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            value.overPar
              ? "border-2 border-co-success bg-[#E6F4E6] text-co-text"
              : "border-2 border-co-gold-deep bg-[#FFF4D0] text-co-text hover:bg-co-gold/30",
          ].join(" ")}
        >
          {value.overPar
            ? t("opening.phase2.signal.over_par_recorded")
            : t("opening.phase2.signal.over_par", { delta: overParDelta })}
        </button>
      ) : null}

      {underParDelta !== null ? (
        <button
          type="button"
          onClick={onOpenUnderPar}
          aria-label={
            value.underPar
              ? t("opening.phase2.signal.under_par_recorded")
              : t("opening.phase2.signal.under_par", { delta: underParDelta })
          }
          className={[
            "self-start inline-flex min-h-[36px] items-center gap-2 rounded-md px-3 py-1",
            "text-xs font-bold uppercase tracking-[0.12em]",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            value.underPar
              ? "border-2 border-co-success bg-[#E6F4E6] text-co-text"
              : "border-2 border-co-danger bg-[#FFE4E4] text-co-text hover:bg-[#FFD0D0]",
          ].join(" ")}
        >
          {value.underPar
            ? t("opening.phase2.signal.under_par_recorded")
            : t("opening.phase2.signal.under_par", { delta: underParDelta })}
        </button>
      ) : null}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NumericInput — minimal local copy (mirrors OpeningCountInput shape but
// integer-or-decimal aware; could lift to a shared component if usage grows).
// ─────────────────────────────────────────────────────────────────────────────

interface NumericInputProps {
  value: number | null;
  onChange: (next: number | null) => void;
  ariaLabel: string;
  hasError?: boolean;
}

function NumericInput({ value, onChange, ariaLabel, hasError = false }: NumericInputProps) {
  const stringValue = value === null ? "" : String(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={stringValue}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      aria-label={ariaLabel}
      aria-invalid={hasError}
      className={[
        "inline-flex h-11 w-20 items-center rounded-md border-2 px-3",
        "text-base font-semibold text-co-text",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        hasError
          ? "border-co-danger bg-co-surface"
          : "border-co-border-2 bg-co-surface hover:border-co-text",
      ].join(" ")}
    />
  );
}
