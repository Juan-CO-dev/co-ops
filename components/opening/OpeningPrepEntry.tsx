"use client";

/**
 * OpeningPrepEntry — Phase 2 prep verification UI (C.50 redesign).
 *
 * Per-section layout per C.50 §4:
 *   - Section header has the verify CTA (OpeningSectionVerify component)
 *   - Per-item rows below show ground-truth display + opener_prepped input
 *   - Live prep_need preview (display-only)
 *   - Modal-trigger signal banners for over/under-prep capture
 *
 * **C.50 model shifts captured here:**
 * - openerActual REMOVED from form state.
 * - C.53 Commit B residual fix: ground_truth_count + prep_need are sourced
 *   from the PERSISTED Phase 1 values (prep_data.phase1) via the
 *   phase1ResolvedByItem prop, so the client delta matches the server delta by
 *   construction. The old client-side derivation (opener_recount IF NOT NULL
 *   ELSE closer_count when section verified) survives only as a pre-submit
 *   defensive fallback.
 * - C.53 Commit B: the per-item recount drill-in (OpeningRecountPanel) was
 *   removed as vestigial — recount is a Phase 1 concern; Phase 2 reads the
 *   persisted ground truth, never re-counts.
 * - Signal banners trigger on delta_vs_prep_need (not delta_vs_par).
 * - NULL closer_count sentinel: section-verify disabled for sections with
 *   any NULL item. NULL-reason badge surfaces operational cause via snapshot
 *   row metadata + template item's references_template_item_id.
 *
 * Form state model (per Lock 2): separate overPar / underPar slots in
 * OpeningPhase2FormValue; UX path-differentiation via delta sign. Modals
 * keep their existing shape (capture types unchanged); semantic shifts
 * from "vs par" to "vs prep_need" are copy-only.
 *
 * Submit-gate inline error badges per C.50 §4: "section unverified" /
 * "prep amount required" / "reason required." Server is canonical;
 * client-side display-only validation prevents wasted round-trips.
 */

import { useMemo, useState } from "react";

import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { useTranslation } from "@/lib/i18n/provider";
import type { OpeningCloserCountSnapshotRow } from "@/lib/opening";
import type { ChecklistTemplateItem, OpeningPhase2Meta } from "@/lib/types";

import { OpeningSectionVerify } from "./OpeningSectionVerify";
import {
  OverParModal,
  type ManagerOption,
  type OverParCapture,
} from "./OverParModal";
import { UnderParModal, type UnderParCapture } from "./UnderParModal";
import { RevokeReasonModal } from "./RevokeReasonModal";

export interface OpeningPhase2FormValue {
  /** Opener recount value when item flagged for per-item recount; NULL otherwise. */
  openerRecount: number | null;
  /** Numeric input — what opener actually prepped today. */
  openerPrepped: number | null;
  /** Over-prep capture; populated when delta_vs_prep_need > 0 AND opener saved a reason. */
  overPar: OverParCapture | null;
  /** Under-prep capture; populated when delta_vs_prep_need < 0 AND opener saved a reason. */
  underPar: UnderParCapture | null;
}

export type { ManagerOption };

/**
 * Per-row save lifecycle (C.53 Commit B Lane B). The save-state Map keyed by
 * templateItemId is the SINGLE SOURCE OF TRUTH for BOTH the per-row badges
 * rendered here AND the finalize outstanding-count computed in the parent —
 * the badge and the gate read the same Map so they can never disagree.
 */
export type Phase2SaveStatus =
  | "unsaved"
  | "incomplete"
  | "saving"
  | "saved"
  | "failed";

/**
 * Why a blur-save no-op'd because a prerequisite blocks persistence. Drives the
 * calm, directive "incomplete" badge (distinct from the alarming "failed"
 * badge): "incomplete" means "you started this row but a prerequisite blocks
 * the save — here's the next step," NOT "something broke."
 *   - "needs_ground_truth": section unverified AND no per-item recount, so there
 *     is no ground-truth count to compute prep_need against.
 *   - "needs_reason": a non-zero delta_vs_prep_need needs its over/under reason
 *     captured before the row can persist.
 */
export type Phase2IncompleteReason = "needs_ground_truth" | "needs_reason";

export interface Phase2SaveState {
  status: Phase2SaveStatus;
  /** users.id of the saver (for "Saved by {name}" attribution); null until saved. */
  savedById: string | null;
  /** ISO timestamp of the persisted save; null until saved. */
  savedAt: string | null;
  /** Error code from the last failed save (drives inline error copy); null otherwise. */
  errorCode: string | null;
  /** Which prerequisite blocks the save; non-null only when status==="incomplete". */
  incompleteReason: Phase2IncompleteReason | null;
  /**
   * Serialized snapshot of the last-persisted values. The dispatcher diffs the
   * current value's signature against this to skip redundant re-POSTs. null
   * until first save.
   */
  savedSignature: string | null;
  /**
   * completions.id of the live phase2 row — the §8.4 revoke POST target. Non-null
   * only while status==="saved" (cleared on revoke so the row goes "unsaved").
   */
  completionId: string | null;
}

/** §8.4 Lane D structured-path reason vocabulary (silent path stamps its own sentinel). */
export type Phase2RevokeReason = "re_enter_count" | "other";

/**
 * Outcome of a revoke dispatch (Lane D). "needs_reason" means the SERVER chose
 * the structured path and wants a reason — the client opens the inline form and
 * re-dispatches. The client NEVER predicts the silent-vs-structured boundary.
 */
export type Phase2RevokeOutcome =
  | { status: "revoked"; path: "silent" | "structured" }
  | { status: "needs_reason" }
  | { status: "error"; code: string };

interface OpeningPrepEntryProps {
  items: ChecklistTemplateItem[];
  values: Map<string, OpeningPhase2FormValue>;
  onChange: (templateItemId: string, next: OpeningPhase2FormValue) => void;
  /**
   * Per-row save state. The ONE Map that drives both the badges here and the
   * finalize gate in the parent (Juan's single-source pre-commit proof).
   */
  saveStates: Map<string, Phase2SaveState>;
  /** Map<users.id, display name> for save attribution. */
  saverNames: Record<string, string>;
  /** Fires a per-row persist for the given item with the value to save. */
  onSaveItem: (templateItemId: string, value: OpeningPhase2FormValue) => void;
  /**
   * Fires a per-row §8.4 revoke (Lane D). Called FIRST with no reason — the
   * SERVER decides silent (quick self-window) vs structured. On a "needs_reason"
   * outcome the row opens the inline reason form and re-calls with reason+note.
   * The client never computes the 60s window itself.
   */
  onRevokeItem: (
    templateItemId: string,
    reason?: Phase2RevokeReason | null,
    note?: string | null,
  ) => Promise<Phase2RevokeOutcome>;
  /** Map<templateItemId, snapshot row> from loadOpeningCloserCountSnapshots (persisted). */
  closerSnapshots: Map<string, OpeningCloserCountSnapshotRow>;
  /**
   * C.53 Commit B residual fix — persisted Phase 1 ground-truth keyed by
   * templateItemId (from prep_data.phase1's ground_truth_count + prep_need).
   * The row's prep_need / delta MUST be computed from these persisted values,
   * not re-derived client-side, so the client delta matches the server delta by
   * construction (the Phase 2 RPC reads prep_need straight from prep_data.phase1).
   * Undefined for an item with no phase1 row yet (pre-submit defensive fallback).
   */
  phase1ResolvedByItem: Map<
    string,
    { groundTruth: number | null; prepNeed: number | null }
  >;
  /** Map<sectionKey, verified-state> in client memory; toggled via OpeningSectionVerify. */
  sectionVerifications: Map<string, boolean>;
  onSectionVerifyToggle: (sectionKey: string) => void;
  managers: ReadonlyArray<ManagerOption>;
  language: Language;
  showMissingErrors: boolean;
  /**
   * Locked (read-only) — Phase 2 has been finalized (instance.status past
   * 'phase1_complete'). Renders the prepped values as a static, locked view:
   * inputs disabled, save/revoke/retry hidden, section-verify + over/under
   * triggers inert. Defaults to false (editable) so the live phase1_complete
   * prep flow is unaffected. Unlock is via the report lifecycle (a future
   * edit/reopen path), never by editing a finalized report in place.
   */
  readOnly?: boolean;
}

export function OpeningPrepEntry({
  items,
  values,
  onChange,
  saveStates,
  saverNames,
  onSaveItem,
  onRevokeItem,
  closerSnapshots,
  phase1ResolvedByItem,
  sectionVerifications,
  onSectionVerifyToggle,
  managers,
  language,
  showMissingErrors,
  readOnly = false,
}: OpeningPrepEntryProps) {
  const { t } = useTranslation();

  const [overParModalItemId, setOverParModalItemId] = useState<string | null>(null);
  const [underParModalItemId, setUnderParModalItemId] = useState<string | null>(null);
  // Revoke flow state. `revokingItemId` is the row mid-dispatch (disables its
  // CTA + spinner); `revokeModalItemId` is the row whose structured reason form
  // is open (only set when the SERVER returned "needs_reason").
  const [revokingItemId, setRevokingItemId] = useState<string | null>(null);
  const [revokeModalItemId, setRevokeModalItemId] = useState<string | null>(null);
  // Row whose last silent-path revoke errored — surfaces an inline notice so a
  // failed undo of a destructive action is never silent. Structured-path errors
  // surface inside RevokeReasonModal instead.
  const [revokeErrorItemId, setRevokeErrorItemId] = useState<string | null>(null);

  // Optimistic no-reason revoke. The server decides silent-vs-structured; a
  // "needs_reason" outcome opens the inline form (re-dispatch carries reason+note);
  // an "error" outcome surfaces an inline notice on the row.
  const handleRevokeClick = async (itemId: string) => {
    setRevokingItemId(itemId);
    setRevokeErrorItemId(null);
    const outcome = await onRevokeItem(itemId);
    setRevokingItemId(null);
    if (outcome.status === "needs_reason") setRevokeModalItemId(itemId);
    else if (outcome.status === "error") setRevokeErrorItemId(itemId);
  };

  // Group items by section (system key from prep_meta.section).
  const sectionGroups = useMemo(() => {
    const groups = new Map<string, ChecklistTemplateItem[]>();
    for (const it of items) {
      const meta = it.prepMeta as OpeningPhase2Meta | null;
      const key = meta?.section ?? "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    return groups;
  }, [items]);

  // Per-section disabled state per Step 11 Lock 3: section disabled when
  // any item has NULL closer_count AND no opener_recount. Opener must
  // per-item recount NULL items before they can section-verify the rest.
  const sectionDisabledMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const [section, sectionItems] of sectionGroups.entries()) {
      const hasUnrecountedNull = sectionItems.some((it) => {
        const snap = closerSnapshots.get(it.id) ?? null;
        const value = values.get(it.id) ?? null;
        return (
          (snap?.closerCount ?? null) === null &&
          (value?.openerRecount ?? null) === null
        );
      });
      map.set(section, hasUnrecountedNull);
    }
    return map;
  }, [sectionGroups, closerSnapshots, values]);

  const overParTarget = overParModalItemId
    ? items.find((it) => it.id === overParModalItemId)
    : null;
  const underParTarget = underParModalItemId
    ? items.find((it) => it.id === underParModalItemId)
    : null;
  const revokeTarget = revokeModalItemId
    ? items.find((it) => it.id === revokeModalItemId)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {Array.from(sectionGroups.entries()).map(([sectionKey, sectionItems]) => {
        const firstItem = sectionItems[0];
        const sectionDisplay = firstItem
          ? resolveTemplateItemContent(firstItem, language).station ?? sectionKey
          : sectionKey;
        const verified = sectionVerifications.get(sectionKey) ?? false;
        const disabled = sectionDisabledMap.get(sectionKey) ?? false;

        return (
          <section
            key={sectionKey}
            aria-label={sectionDisplay}
            className="rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5"
          >
            <header className="flex items-start justify-between gap-3">
              <h3 className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text">
                {sectionDisplay}
              </h3>
              <OpeningSectionVerify
                sectionKey={sectionKey}
                sectionDisplay={sectionDisplay}
                verified={verified}
                disabled={disabled || readOnly}
                disabledReason={disabled ? "null_items_unrecounted" : null}
                onToggleVerified={() => onSectionVerifyToggle(sectionKey)}
                language={language}
              />
            </header>

            <ul className="mt-3 flex flex-col">
              {sectionItems.map((item) => {
                const value = values.get(item.id) ?? {
                  openerRecount: null,
                  openerPrepped: null,
                  overPar: null,
                  underPar: null,
                };
                const snapshot = closerSnapshots.get(item.id) ?? null;
                const saveState =
                  saveStates.get(item.id) ?? {
                    status: "unsaved" as const,
                    savedById: null,
                    savedAt: null,
                    errorCode: null,
                    incompleteReason: null,
                    savedSignature: null,
                    completionId: null,
                  };
                const saverName =
                  saveState.savedById !== null
                    ? saverNames[saveState.savedById] ?? null
                    : null;

                return (
                  <PrepEntryRow
                    key={item.id}
                    item={item}
                    value={value}
                    snapshot={snapshot}
                    phase1Resolved={phase1ResolvedByItem.get(item.id) ?? null}
                    sectionVerified={verified}
                    language={language}
                    showMissingErrors={showMissingErrors}
                    saveState={saveState}
                    saverName={saverName}
                    onChange={(next) => onChange(item.id, next)}
                    onSave={(next) => onSaveItem(item.id, next)}
                    onRevoke={() => handleRevokeClick(item.id)}
                    revoking={revokingItemId === item.id}
                    revokeError={revokeErrorItemId === item.id}
                    onOpenOverPar={() => setOverParModalItemId(item.id)}
                    onOpenUnderPar={() => setUnderParModalItemId(item.id)}
                    readOnly={readOnly}
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
              openerRecount: null,
              openerPrepped: null,
              overPar: null,
              underPar: null,
            };
            const next = { ...cur, overPar: capture };
            onChange(overParTarget.id, next);
            onSaveItem(overParTarget.id, next);
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
              openerRecount: null,
              openerPrepped: null,
              overPar: null,
              underPar: null,
            };
            const next = { ...cur, underPar: capture };
            onChange(underParTarget.id, next);
            onSaveItem(underParTarget.id, next);
            setUnderParModalItemId(null);
          }}
          onCancel={() => setUnderParModalItemId(null)}
        />
      ) : null}

      {revokeTarget ? (
        <RevokeReasonModal
          open={!!revokeModalItemId}
          itemLabel={resolveTemplateItemContent(revokeTarget, language).label}
          onSubmit={(reason, note) => onRevokeItem(revokeTarget.id, reason, note)}
          onClose={() => setRevokeModalItemId(null)}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-item row — C.50 redesign
// ─────────────────────────────────────────────────────────────────────────────

interface PrepEntryRowProps {
  item: ChecklistTemplateItem;
  value: OpeningPhase2FormValue;
  snapshot: OpeningCloserCountSnapshotRow | null;
  /**
   * C.53 Commit B residual fix — persisted Phase 1 ground-truth for this item
   * (from prep_data.phase1). When present, the row computes prep_need / delta
   * from these persisted values so the client delta matches the server delta by
   * construction. null until the phase1 row lands (pre-submit defensive fallback
   * to the old client-side derivation).
   */
  phase1Resolved: { groundTruth: number | null; prepNeed: number | null } | null;
  sectionVerified: boolean;
  language: Language;
  showMissingErrors: boolean;
  saveState: Phase2SaveState;
  /** Resolved display name of the saver; null when unsaved or name unknown. */
  saverName: string | null;
  onChange: (next: OpeningPhase2FormValue) => void;
  /** Fires a per-row persist with the value to save (blur / modal save). */
  onSave: (next: OpeningPhase2FormValue) => void;
  /** Fires a per-row §8.4 revoke (no-reason; server decides the path). */
  onRevoke: () => void;
  /** True while this row's revoke is mid-flight (disables the CTA, shows spinner copy). */
  revoking: boolean;
  /** True when this row's last silent-path revoke errored (surfaces an inline notice). */
  revokeError: boolean;
  onOpenOverPar: () => void;
  onOpenUnderPar: () => void;
  /** Locked (read-only) — Phase 2 finalized. Inputs disabled; save/revoke/retry hidden. */
  readOnly: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function PrepEntryRow({
  item,
  value,
  snapshot,
  phase1Resolved,
  sectionVerified,
  language,
  showMissingErrors,
  saveState,
  saverName,
  onChange,
  onSave,
  onRevoke,
  revoking,
  revokeError,
  onOpenOverPar,
  onOpenUnderPar,
  readOnly,
  t,
}: PrepEntryRowProps) {
  const resolved = resolveTemplateItemContent(item, language);

  // Live prep_need computation per C.50 §1
  const closerCount = snapshot?.closerCount ?? null;
  const parValue = snapshot?.parValue ?? null;
  const parUnit = snapshot?.parUnit ?? null;

  // C.53 Commit B residual fix — ground_truth + prep_need are sourced from the
  // PERSISTED Phase 1 values (prep_data.phase1) when available, so the client
  // delta matches the server delta by construction (the Phase 2 RPC reads
  // prep_need straight from prep_data.phase1, never recomputing). The old
  // client-side derivation (opener_recount IF NOT NULL ELSE closer_count when
  // section verified) is retained only as a pre-submit defensive fallback for
  // the window before the phase1 row lands.
  const groundTruth =
    phase1Resolved?.groundTruth ??
    (value.openerRecount !== null
      ? value.openerRecount
      : sectionVerified
        ? closerCount
        : null);

  // prep_need = MAX(0, par_value - ground_truth_count). Persisted value wins;
  // the MAX(0, ...) fallback only fires before phase1 has been persisted.
  const prepNeed =
    phase1Resolved?.prepNeed ??
    (groundTruth !== null && parValue !== null
      ? Math.max(0, parValue - groundTruth)
      : null);

  // delta_vs_prep_need = opener_prepped - prep_need (only when both numeric)
  const delta =
    prepNeed !== null && value.openerPrepped !== null
      ? value.openerPrepped - prepNeed
      : null;

  const overDelta = delta !== null && delta > 0 ? delta : null;
  const underDelta = delta !== null && delta < 0 ? -delta : null;

  // NULL-reason badge derivation per Step 11 Lock 3 forward note. Mapping:
  //   referencesTemplateItemId === null → "item_not_linked" (foundation gap)
  //   closingInstanceMissing && refsExist → "no_am_prep" (closer missed last night)
  //   else (default) → "first_day" (linked + closing exists, no value found)
  const isNullCloserCount = closerCount === null;
  const closingInstanceMissing = (snapshot?.closingInstanceId ?? null) === null;
  const itemNotLinked = item.referencesTemplateItemId === null;
  const nullReasonKey: TranslationKey | null = !isNullCloserCount
    ? null
    : itemNotLinked
      ? "opening.phase2.null_reason.item_not_linked"
      : closingInstanceMissing
        ? "opening.phase2.null_reason.no_am_prep"
        : "opening.phase2.null_reason.first_day";

  // Submit-gate badges per C.50 §4
  const sectionUnverifiedAndNoRecount =
    showMissingErrors && !sectionVerified && value.openerRecount === null;
  const prepAmountMissing =
    showMissingErrors &&
    prepNeed !== null &&
    prepNeed > 0 &&
    value.openerPrepped === null;
  const reasonMissing =
    showMissingErrors &&
    delta !== null &&
    delta !== 0 &&
    ((delta > 0 && value.overPar === null) ||
      (delta < 0 && value.underPar === null));

  const parDisplay =
    parValue !== null
      ? `${parValue}${parUnit ? ` ${parUnit}` : ""}`
      : null;

  // C.53 Commit B — the ground-truth display sources from the persisted Phase 1
  // value (closer count, or a Phase 1 recount captured at verification time).
  // The per-item recount panel is vestigial in Phase 2 (removed), so the label
  // is the stable "closer estimate" key rather than the old recount-vs-closer
  // branch.
  const groundTruthBadgeLabel = t("opening.phase2.closer_estimate_label");

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

      {/* Ground-truth display — persisted Phase 1 value. The recount affordance
       * and its drill-in panel were removed in C.53 Commit B (recount is a
       * Phase 1 concern; Phase 2 reads the persisted ground truth). */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-co-border-2 bg-co-bg p-2.5 text-xs">
        <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">
          {groundTruthBadgeLabel}:
        </span>
        {groundTruth !== null ? (
          <span className="font-semibold text-co-text">
            {groundTruth}
            {parUnit ? <span className="text-co-text-muted"> {parUnit}</span> : null}
          </span>
        ) : (
          <span className="text-co-text-dim italic">
            {nullReasonKey ? t(nullReasonKey) : t("opening.phase2.no_closer_estimate")}
          </span>
        )}
      </div>

      {/* prep_need live preview (computed client-side, display-only).
       * Always renders for visual grammar consistency across items. When
       * ground_truth is unresolved (section not verified AND no recount),
       * shows pending-verification copy in dim style; once ground_truth
       * resolves, value renders in normal weight. Signals/modals stay
       * gated on resolved prep_need (numeric) — display-only line never
       * lies about a derived value that isn't canonical. */}
      <div className="flex items-center gap-2 text-xs">
        {prepNeed !== null ? (
          <>
            <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">
              {t("opening.phase2.prep_need_label")}:
            </span>
            <span className="font-semibold text-co-text">
              {prepNeed}
              {parUnit ? <span className="text-co-text-muted"> {parUnit}</span> : null}
            </span>
          </>
        ) : (
          <span className="text-co-text-dim italic">
            {t("opening.phase2.prep_need_pending_verification")}
          </span>
        )}
      </div>

      {/* opener_prepped numeric input */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
          {t("opening.phase2.opener_prepped_label")}
        </label>
        <NumericInput
          value={value.openerPrepped}
          onChange={(next) => onChange({ ...value, openerPrepped: next })}
          onBlur={readOnly ? undefined : () => onSave(value)}
          ariaLabel={t("opening.phase2.input_prepped_aria", { item: resolved.label })}
          hasError={!readOnly && prepAmountMissing}
          disabled={readOnly}
        />
      </div>

      {/* Signal banners — modal triggers for over/under-prep capture */}
      {overDelta !== null ? (
        <button
          type="button"
          onClick={onOpenOverPar}
          disabled={readOnly}
          aria-label={
            value.overPar
              ? t("opening.phase2.signal.over_prep_recorded")
              : t("opening.phase2.signal.over_prep", { delta: overDelta })
          }
          className={[
            "self-start inline-flex min-h-[36px] items-center gap-2 rounded-md px-3 py-1",
            "text-xs font-bold uppercase tracking-[0.12em]",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            readOnly ? "cursor-not-allowed" : "",
            value.overPar
              ? "border-2 border-co-success bg-[#E6F4E6] text-co-text"
              : "border-2 border-co-gold-deep bg-[#FFF4D0] text-co-text hover:bg-co-gold/30",
          ].join(" ")}
        >
          {value.overPar
            ? t("opening.phase2.signal.over_prep_recorded")
            : t("opening.phase2.signal.over_prep", { delta: overDelta })}
        </button>
      ) : null}

      {underDelta !== null ? (
        <button
          type="button"
          onClick={onOpenUnderPar}
          disabled={readOnly}
          aria-label={
            value.underPar
              ? t("opening.phase2.signal.under_prep_recorded")
              : t("opening.phase2.signal.under_prep", { delta: underDelta })
          }
          className={[
            "self-start inline-flex min-h-[36px] items-center gap-2 rounded-md px-3 py-1",
            "text-xs font-bold uppercase tracking-[0.12em]",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            readOnly ? "cursor-not-allowed" : "",
            value.underPar
              ? "border-2 border-co-success bg-[#E6F4E6] text-co-text"
              : "border-2 border-co-danger bg-[#FFE4E4] text-co-text hover:bg-[#FFD0D0]",
          ].join(" ")}
        >
          {value.underPar
            ? t("opening.phase2.signal.under_prep_recorded")
            : t("opening.phase2.signal.under_prep", { delta: underDelta })}
        </button>
      ) : null}

      {/* At-par indicator (informational; no action) */}
      {delta === 0 ? (
        <p className="self-start text-xs italic text-co-success">
          {t("opening.phase2.signal.at_par")}
        </p>
      ) : null}

      {/* Per-row save-state indicator + attribution + retry (C.53 Commit B Lane B).
       * Reads the same Map entry that feeds the parent's finalize outstanding-count,
       * so the badge and the gate can never disagree. */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {saveState.status === "saving" ? (
          <span className="font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("opening.phase2.save.saving")}
          </span>
        ) : saveState.status === "saved" ? (
          <>
            <span className="font-medium text-co-success">
              {saveState.savedAt !== null
                ? t("opening.phase2.save.saved_by_at", {
                    name: saverName ?? t("opening.phase2.save.saved_by_unknown"),
                    time: formatTime(saveState.savedAt, language),
                  })
                : t("opening.phase2.save.saved")}
            </span>
            {/* §8.4 revoke CTA — server decides silent vs structured; the client
                never predicts the 60s window. Hidden once Phase 2 is finalized
                (read-only): a locked report has no per-row self-revoke. */}
            {!readOnly ? (
              <button
                type="button"
                onClick={onRevoke}
                disabled={revoking}
                aria-label={t("opening.phase2.revoke.cta_aria", { item: resolved.label })}
                className="
                  inline-flex min-h-[32px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 py-1
                  text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-muted
                  transition hover:border-co-danger hover:text-co-danger
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                  disabled:cursor-not-allowed disabled:opacity-60
                "
              >
                {revoking
                  ? t("opening.phase2.revoke.cta_pending")
                  : t("opening.phase2.revoke.cta")}
              </button>
            ) : null}
            {revokeError ? (
              <span role="alert" className="font-bold text-co-danger">
                {t("opening.phase2.revoke.error")}
              </span>
            ) : null}
          </>
        ) : saveState.status === "failed" ? (
          <>
            <span role="alert" className="font-bold text-co-danger">
              {t("opening.phase2.save.failed")}
            </span>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => onSave(value)}
                aria-label={t("opening.phase2.save.retry_aria", { item: resolved.label })}
                className="
                  inline-flex min-h-[32px] items-center rounded-full border-2 border-co-danger bg-co-surface px-3 py-1
                  text-[10px] font-bold uppercase tracking-[0.12em] text-co-text
                  transition hover:bg-[#FFE4E4]
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              >
                {t("opening.phase2.save.retry")}
              </button>
            ) : null}
          </>
        ) : saveState.status === "incomplete" ? (
          // Calm, directive nudge — informational (Brand Blue), NOT an error.
          // Tells the prepper the next step to make the row savable; deliberately
          // distinct from the alarming red "failed" badge above.
          <span className="font-medium text-co-info">
            {saveState.incompleteReason === "needs_ground_truth"
              ? t("opening.phase2.save.incomplete_ground_truth")
              : t("opening.phase2.save.incomplete_reason")}
          </span>
        ) : (
          <span className="font-medium text-co-text-dim">
            {t("opening.phase2.save.unsaved")}
          </span>
        )}
      </div>

      {/* Submit-gate inline error badges — render only when showMissingErrors active */}
      {sectionUnverifiedAndNoRecount ? (
        <p role="alert" className="self-start text-[11px] font-medium text-co-danger">
          {t("opening.phase2.gate.section_unverified")}
        </p>
      ) : null}
      {prepAmountMissing && !sectionUnverifiedAndNoRecount ? (
        <p role="alert" className="self-start text-[11px] font-medium text-co-danger">
          {t("opening.phase2.gate.prep_amount_required")}
        </p>
      ) : null}
      {reasonMissing ? (
        <p role="alert" className="self-start text-[11px] font-medium text-co-danger">
          {t("opening.phase2.gate.reason_required")}
        </p>
      ) : null}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NumericInput — local input component (mirrors prior shape; integer/decimal aware)
// ─────────────────────────────────────────────────────────────────────────────

interface NumericInputProps {
  value: number | null;
  onChange: (next: number | null) => void;
  onBlur?: () => void;
  ariaLabel: string;
  hasError?: boolean;
  /** Locked (read-only) — the input renders its value but cannot be edited. */
  disabled?: boolean;
}

function NumericInput({
  value,
  onChange,
  onBlur,
  ariaLabel,
  hasError = false,
  disabled = false,
}: NumericInputProps) {
  const stringValue = value === null ? "" : String(value);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={stringValue}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={onBlur}
      aria-label={ariaLabel}
      aria-invalid={hasError}
      className={[
        "inline-flex h-11 w-20 items-center rounded-md border-2 px-3",
        "text-base font-semibold text-co-text",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        disabled
          ? "border-co-border-2 bg-co-bg/40 text-co-text-muted cursor-not-allowed"
          : hasError
            ? "border-co-danger bg-co-surface"
            : "border-co-border-2 bg-co-surface hover:border-co-text",
      ].join(" ")}
    />
  );
}
