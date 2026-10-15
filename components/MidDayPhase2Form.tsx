"use client";

/**
 * MidDayPhase2Form — Phase 2 collaborative prep for mid-day (C.43). Per-item
 * "prepped" input + per-item Save (realtime-lite: append-only, reconcile on
 * reload). When prepped is off the back-to-par need, a STRUCTURED over/under
 * reason is required — reusing the opening Phase 2 OverParModal / UnderParModal
 * (reason category + directedBy + free text), stored as prep_data.overUnder.
 * Finalize closes the instance (phase1_complete → phase2_complete).
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { resolveSectionLabel } from "@/lib/prep-sections";
import type { MidDayOverUnder } from "@/lib/prep";
import { ActionButton } from "@/components/ActionButton";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { CollapsibleChecklistSection } from "@/components/ui/CollapsibleChecklistSection";
import { unfinishedSectionIds } from "@/lib/collapsible-sections";
import { useCollapsibleSections } from "@/lib/use-collapsible-sections";
import {
  OverParModal,
  type ManagerOption,
  type OverParCapture,
  type OverParReasonCategory,
} from "@/components/opening/OverParModal";
import {
  UnderParModal,
  type UnderParCapture,
  type UnderParReasonCategory,
} from "@/components/opening/UnderParModal";
import type { DerivedSku, ConfirmedInput } from "@/lib/prep-consumption";
import { ProductionConsumptionPanel } from "@/components/production/ProductionConsumptionPanel";
import { BatchEntryFields } from "@/components/prep/BatchEntryFields";
import {
  batchEntryFromForm,
  emptyBatchFormValue,
  isBatchContractCode,
  validateBatchEntry,
  type BatchFormValue,
  type BatchRowContext,
} from "@/lib/batch-prep-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { etCalendarDate } from "@/lib/operational-day";
import { formatPrepQty } from "@/lib/prep-display-shared";
import { canMakeTheNeed } from "@/lib/made-the-need-shared";
import { initialMidDaySave, nextSaveStep, type MidDaySaveState } from "@/lib/mid-day-save-shared";
import { whatsLeft } from "@/lib/whats-left-shared";
import { WhatsLeft, focusWhatsLeft } from "@/components/ui/WhatsLeft";

export interface MidDayPhase2Item {
  id: string;
  required?: boolean;
  minRoleLevel?: number;
  label: string;
  section: string;
  parValue: number | null;
  parUnit: string | null;
  need: number | null;
  initialPrepped: number | null;
  /**
   * Astra P1 #2 — true iff a Phase 2 SAVE exists for this row (lib/mid-day-shared.ts
   * midDayPhase2RowSeed). A Phase 1 count never counts as saved; absent = derive from
   * initialPrepped (pre-0215 callers).
   */
  initialSaved?: boolean;
  initialSavedBy: string | null;
  /** Registry item id (for production capture); null = not registry-linked. */
  itemId: string | null;
  /** Per-one-output-unit leaf-SKU consumption for the panel; [] = non-convertible. */
  derived: DerivedSku[];
  /** Structured over/under capture already saved (prep_data.overUnder), or null. */
  initialOverUnder: MidDayOverUnder | null;
  /**
   * 0215 batch vs bottle — non-null on a batch_mode item: the row grows the batch half and
   * `prepped` means BOTTLED for the line. `need` is then need_for_line (par − LINE).
   */
  batch?: BatchRowContext | null;
  /** 0215 — the panel rows as PER-BATCH quantities (outputQty = batches). */
  batchDerived?: DerivedSku[];
  /** 0215 — the batch half already saved today (prep_data.batch), or null. */
  initialBatch?: BatchFormValue | null;
}

interface SaveState {
  value: string;
  overUnder: MidDayOverUnder | null;
  modalOpen: boolean;
  status: "idle" | "saving" | "saved" | "error";
  savedBy: string | null;
  error: string | null;
  /** Panel confirmation; null = untouched (server records the derived default). */
  confirmedConsumption: ConfirmedInput[] | null;
  /** 0215 — the batch half (ignored on single-box items). */
  batch: BatchFormValue;
  /** 0215 — the last refused save's batch contract code (renders prep.batch.error.<code>). */
  batchErrorCode: string | null;
}

const EMPTY: SaveState = {
  value: "",
  overUnder: null,
  modalOpen: false,
  status: "idle",
  savedBy: null,
  error: null,
  confirmedConsumption: null,
  batch: emptyBatchFormValue(),
  batchErrorCode: null,
};

function overToOU(c: OverParCapture): MidDayOverUnder {
  return { kind: "over", reasonCategory: c.reasonCategory, directedBy: c.directedBy, freeText: c.freeText };
}
function underToOU(c: UnderParCapture): MidDayOverUnder {
  return { kind: "under", reasonCategory: c.reasonCategory, directedBy: null, freeText: c.freeText };
}
function ouToOverInitial(ou: MidDayOverUnder | null): OverParCapture | null {
  if (!ou || ou.kind !== "over") return null;
  return {
    reasonCategory: ou.reasonCategory as OverParReasonCategory,
    directedBy: ou.directedBy,
    freeText: ou.freeText,
  };
}
function ouToUnderInitial(ou: MidDayOverUnder | null): UnderParCapture | null {
  if (!ou || ou.kind !== "under") return null;
  return { reasonCategory: ou.reasonCategory as UnderParReasonCategory, freeText: ou.freeText ?? "" };
}

export function MidDayPhase2Form({
  instanceId,
  actorLevel = 99,
  items,
  managers,
  sectionLabels = {},
  todayIso,
  canEditConsumption = false,
}: {
  instanceId: string;
  actorLevel?: number;
  items: MidDayPhase2Item[];
  managers: ManagerOption[];
  /** DB-backed section labels (slug → { en, es }); preferred over the raw slug. */
  sectionLabels?: Record<string, { en: string; es: string | null }>;
  /** 0215 — the instance's operational date (YYYY-MM-DD) for the shelf-life red state. */
  todayIso?: string;
  /** D-13 — the viewer may edit the "Uses: …" panel (KH+); server-derived. Default read-only. */
  canEditConsumption?: boolean;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const today = todayIso ?? etCalendarDate(new Date().toISOString());
  const [states, setStates] = useState<Record<string, SaveState>>(() => {
    const init: Record<string, SaveState> = {};
    for (const it of items) {
      init[it.id] = {
        value: it.initialPrepped !== null ? String(it.initialPrepped) : "",
        overUnder: it.initialOverUnder,
        modalOpen: false,
        status: (it.initialSaved ?? it.initialPrepped !== null) ? "saved" : "idle",
        savedBy: it.initialSavedBy,
        error: null,
        confirmedConsumption: null,
        batch: it.initialBatch ?? emptyBatchFormValue(),
        batchErrorCode: null,
      };
    }
    return init;
  });
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  // Synchronous per-row authority: React state may not have committed before a second tap.
  const saveOrderRef = useRef<Map<string, MidDaySaveState>>(new Map());
  const stepSave = (id: string, event: Parameters<typeof nextSaveStep>[1]) => {
    const result = nextSaveStep(saveOrderRef.current.get(id) ?? initialMidDaySave, event);
    saveOrderRef.current.set(id, result.state);
    return result;
  };

  const groups = useMemo(() => {
    const out: Array<{ section: string; items: MidDayPhase2Item[] }> = [];
    const idx = new Map<string, number>();
    for (const it of items) {
      let gi = idx.get(it.section);
      if (gi === undefined) {
        gi = out.length;
        idx.set(it.section, gi);
        out.push({ section: it.section, items: [] });
      }
      out[gi]!.items.push(it);
    }
    return out;
  }, [items]);

  // Wave 1 B — collapsible sections. An item is DONE when its save state is "saved"
  // (the same status that renders the "Saved" line on the row).
  const sectionProgress = groups.map((g) => ({
    id: g.section,
    total: g.items.length,
    done: g.items.filter((it) => (states[it.id] ?? EMPTY).status === "saved").length,
  }));
  const collapsible = useCollapsibleSections("mid-day-phase2", sectionProgress);
  const left = whatsLeft(items.map((it) => ({ id: it.id, sectionId: it.section, label: it.label,
    required: it.required ?? true, minRoleLevel: it.minRoleLevel ?? 0, targetField: "primary" })),
    Object.fromEntries(items.map((it) => [it.id, (states[it.id] ?? EMPTY).status === "saved"])), actorLevel);

  const patch = (id: string, p: Partial<SaveState>) => {
    if (p.status === "idle") stepSave(id, { type: "edit" });
    setStates((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), ...p } }));
  };

  // `override` lets a one-tap fill ("Made the need", B11a) save the value it just set without
  // waiting for the state update to land — same body, same route, same RPC.
  const onSave = async (it: MidDayPhase2Item, override?: Partial<SaveState>) => {
    const st = { ...(states[it.id] ?? EMPTY), ...override };
    if (saveOrderRef.current.get(it.id)?.inFlightRevision != null) return;
    const raw = st.value.trim();
    const prepped = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(prepped) || prepped < 0) {
      patch(it.id, { status: "error", error: t("mid_day_prep.phase2.required") });
      collapsible.reveal([it.section]);
      return;
    }
    const offPar = it.need !== null && prepped !== it.need;
    if (offPar && !st.overUnder) {
      patch(it.id, { status: "error", error: t("mid_day_prep.phase2.reason_required") });
      collapsible.reveal([it.section]);
      return;
    }
    // 0215 batch vs bottle — mirror the RPC's gates (ruling B + addendum 2) before POSTing.
    const batchCtx = it.batch ?? null;
    let batchEntry: ReturnType<typeof batchEntryFromForm> | null = null;
    if (batchCtx) {
      if (batchCtx.blocked || batchCtx.backupBefore === null) {
        patch(it.id, { status: "error", error: t("mid_day_prep.phase2.batch_incomplete" as TranslationKey), batchErrorCode: batchCtx.blocked ? "batch_recipe_unresolved" : "backup_unknown" });
        collapsible.reveal([it.section]);
        return;
      }
      batchEntry = batchEntryFromForm(st.batch, batchCtx.yieldPerBatch);
      const check = validateBatchEntry(batchEntry, { bottled: prepped, backupBefore: batchCtx.backupBefore, need: batchCtx.need, yieldPerBatch: batchCtx.yieldPerBatch });
      if (!check.ok) {
        patch(it.id, { status: "error", error: t("mid_day_prep.phase2.batch_incomplete" as TranslationKey), batchErrorCode: check.code });
        collapsible.reveal([it.section]);
        return;
      }
    }
    const signature = JSON.stringify({ prepped, overUnder: offPar ? st.overUnder : null, batchEntry, confirmedConsumption: st.confirmedConsumption });
    const start = stepSave(it.id, { type: "start", signature });
    if (!start.post) return;
    const saveRevision = start.state.revision;
    patch(it.id, { status: "saving", error: null, batchErrorCode: null });
    try {
      const res = await fetch("/api/prep/mid-day/phase2/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          templateItemId: it.id,
          prepped,
          overUnder: offPar ? st.overUnder : null,
          confirmedConsumption: st.confirmedConsumption,
          // 0215 — present only on a batch item (absent = single box, today's body).
          ...(batchEntry ? { batch: batchEntry } : {}),
        }),
        redirect: "manual",
      });
      if (res.ok) {
        const ack = stepSave(it.id, { type: "ack", revision: saveRevision });
        patch(it.id, { status: ack.state.phase === "saved" ? "saved" : "idle", savedBy: null, error: null, batchErrorCode: null });
        return;
      }
      let msg = "Save failed.";
      let code: string | null = null;
      try {
        const b = (await res.json()) as { message?: string; error?: string; code?: string };
        msg = b.message ?? b.error ?? msg;
        code = typeof b.code === "string" ? b.code : null;
      } catch {
        // keep generic
      }
      // B11a: the server's off-need reason refusal speaks the same words as the client gate.
      if (code === "off_need_reason_required") msg = t("mid_day_prep.phase2.reason_required");
      const refused = stepSave(it.id, { type: "fail", revision: saveRevision });
      if (refused.state.phase === "failed") patch(it.id, { status: "error", error: isBatchContractCode(code) ? null : msg, batchErrorCode: isBatchContractCode(code) ? code : null });
      else patch(it.id, { status: "idle" });
    } catch (e) {
      const refused = stepSave(it.id, { type: "fail", revision: saveRevision });
      if (refused.state.phase === "failed") patch(it.id, { status: "error", error: e instanceof Error ? e.message : "Network error." });
      else patch(it.id, { status: "idle" });
    }
  };

  const onFinalize = async () => {
    if (finalizing) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const res = await fetch("/api/prep/mid-day/phase2/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId }),
        redirect: "manual",
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      let msg = "Finalize failed.";
      try {
        const b = (await res.json()) as { message?: string; error?: string; code?: string; missing?: string[] };
        // Astra P1 #2: finalize is refused while a batch row has no Phase 2 save.
        msg =
          b.code === "batch_rows_unsaved"
            ? t("mid_day_prep.phase2.finalize_batch_rows_unsaved" as TranslationKey, { n: b.missing?.length ?? 0 })
            : (b.message ?? b.error ?? msg);
      } catch {
        // keep generic
      }
      setFinalizeError(msg);
      setFinalizing(false);
      // Finalize refused: open the sections that still have unsaved items.
      collapsible.reveal(unfinishedSectionIds(sectionProgress));
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : "Network error.");
      setFinalizing(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-5 lg:block lg:columns-2 lg:[column-gap:1.25rem] lg:[&>*]:break-inside-avoid lg:[&>*]:mb-5">
      <WhatsLeft result={left} onJump={(entry) => focusWhatsLeft(entry, (id) => collapsible.setOpenTransient(id, true))} />
      {groups.map((g) => (
        <CollapsibleChecklistSection
          key={g.section}
          formKey="mid-day-phase2"
          headingLevel={2}
          sectionId={g.section}
          title={resolveSectionLabel(sectionLabels, g.section, language, g.section)}
          titleClassName="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-text"
          done={g.items.filter((it) => (states[it.id] ?? EMPTY).status === "saved").length}
          total={g.items.length}
          progressSuffix={g.items.some((it) => (states[it.id] ?? EMPTY).status === "error")
            ? ` · ${t("save_status.failed_count", { n: g.items.filter((it) => (states[it.id] ?? EMPTY).status === "error").length })}`
            : undefined}
          open={collapsible.isOpen(g.section)}
          onToggle={() => collapsible.toggle(g.section)}
        >
          <ul className="mt-2 flex flex-col gap-1.5">
            {g.items.map((it) => {
              const st = states[it.id] ?? EMPTY;
              const preppedNum = st.value.trim() === "" ? null : Number(st.value);
              const offPar =
                it.need !== null &&
                preppedNum !== null &&
                Number.isFinite(preppedNum) &&
                preppedNum !== it.need;
              const over = offPar && preppedNum! > (it.need ?? 0);
              return (
                <li
                  key={it.id}
                  className="flex min-w-0 flex-col gap-1.5 rounded-md border-2 border-co-border bg-co-surface px-3 py-2"
                  data-whats-left-item={it.id}
                >
                  {it.batch ? (
                    /* 0215 batch vs bottle — the batch half (batch_mode items only). */
                    <BatchEntryFields
                      value={st.batch}
                      onChange={(next) => patch(it.id, { batch: next, status: "idle", error: null, batchErrorCode: null })}
                      ctx={it.batch}
                      bottled={preppedNum !== null && Number.isFinite(preppedNum) ? preppedNum : null}
                      showErrors={st.batchErrorCode !== null}
                      serverErrorCode={st.batchErrorCode}
                      language={language}
                      todayIso={today}
                      t={t}
                    />
                  ) : null}
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-co-text">{it.label}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-co-text-dim">
                        {/* B1 #3 — "5 × 1/3 Pan", never "5 1/3 Pan"; float noise rounded. */}
                        {it.need !== null
                          ? `${t("mid_day_prep.phase1.need")} ${formatPrepQty(it.need, it.parUnit)}`
                          : `${t("mid_day_prep.page.section_par")} ${formatPrepQty(it.parValue, it.parUnit)}`}
                        {it.batch ? ` · ${t("prep.batch.bottled_label" as TranslationKey)}` : ""}
                      </p>
                    </div>
                    <input
                      type="number"
                      data-whats-left-field="primary"
                      inputMode="decimal"
                      min={0}
                      value={st.value}
                      onChange={(e) =>
                        // Prepped counts are >= 0 — strip any "-" so a
                        // negative can't be typed and the live offPar/preview
                        // never computes from a negative. onSave still rejects
                        // prepped < 0 (defense in depth).
                        patch(it.id, { value: e.target.value.replace(/-/g, ""), status: "idle", error: null })
                      }
                      aria-label={`${it.label} — ${it.batch ? t("prep.batch.bottled_label" as TranslationKey) : t("mid_day_prep.phase2.prepped")}`}
                      // B8 #12 — w-20 clipped "Prepped" to "Preppec"; a short placeholder in a w-32 box
                      // fits en + es ("Preparado", "Embotellado"). The aria-label keeps the full words.
                      placeholder={it.batch ? t("prep.batch.bottled_short") : t("mid_day_prep.phase2.prepped")}
                      className="
                        min-h-[44px] w-32 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface
                        px-2 text-base text-co-text focus:border-co-text focus:outline-none
                        focus-visible:ring-4 focus-visible:ring-co-gold/60
                      "
                    />
                    <ActionButton
                      onClick={() => void onSave(it)}
                      disabled={saveOrderRef.current.get(it.id)?.inFlightRevision != null}
                      className="shrink-0"
                    >
                      {st.status === "saving" ? t("mid_day_prep.phase2.saving") : t("mid_day_prep.phase2.save")}
                    </ActionButton>
                  </div>

                  {/* B11a — "Made the need": fill the box with the need and run this row's
                      save (identical record to typing it; a stale over/under capture is dropped,
                      an at-need row has no off-need question). Never on a batch row. */}
                  {it.need !== null &&
                  canMakeTheNeed({
                    need: it.need,
                    isBatch: !!it.batch,
                    readOnly: false,
                    current: preppedNum !== null && Number.isFinite(preppedNum) ? preppedNum : null,
                    saved: st.status === "saved",
                  }) ? (
                    <ActionButton
                      variant="secondary"
                      onClick={() => {
                        const fill = { value: String(it.need), overUnder: null };
                        patch(it.id, { ...fill, status: "idle", error: null });
                        void onSave(it, fill);
                      }}
                      disabled={saveOrderRef.current.get(it.id)?.inFlightRevision != null}
                      aria-label={t("prep.made_the_need_aria", { item: it.label, qty: formatPrepQty(it.need, it.parUnit) })}
                      className="self-start"
                    >
                      {t("prep.made_the_need")}
                    </ActionButton>
                  ) : null}

                  {offPar ? (
                    <ActionButton
                      variant="secondary"
                      onClick={() => patch(it.id, { modalOpen: true, status: "idle", error: null })}
                      className="self-start"
                    >
                      {st.overUnder
                        ? t("mid_day_prep.phase2.edit_reason")
                        : t("mid_day_prep.phase2.add_reason")}
                    </ActionButton>
                  ) : null}

                  {/* 0215: a batch item's panel is PER BATCH — one batch's oz × batches made. */}
                  {(it.batch ? (it.batchDerived ?? []).length > 0 : it.derived.length > 0) ? (
                    <ProductionConsumptionPanel
                      derived={it.batch ? (it.batchDerived ?? []) : it.derived}
                      outputQty={it.batch ? st.batch.batches : (preppedNum ?? 0)}
                      value={st.confirmedConsumption}
                      onChange={(rows) => patch(it.id, { confirmedConsumption: rows, status: "idle", error: null })}
                      canEdit={canEditConsumption}
                    />
                  ) : null}
                  <SaveStatus phase={st.status === "error" ? "failed" : st.status}
                    detail={st.status === "saved" ? (st.savedBy
                      ? t("mid_day_prep.phase2.saved_by", { name: st.savedBy })
                      : t("mid_day_prep.phase2.saved")) : st.error}
                    onRetry={st.status === "error" ? () => void onSave(it) : undefined} />

                  {st.modalOpen && over ? (
                    <OverParModal
                      open
                      itemLabel={it.label}
                      initial={ouToOverInitial(st.overUnder)}
                      managers={managers}
                      onSave={(c) => patch(it.id, { overUnder: overToOU(c), modalOpen: false })}
                      onCancel={() => patch(it.id, { modalOpen: false })}
                    />
                  ) : null}
                  {st.modalOpen && offPar && !over ? (
                    <UnderParModal
                      open
                      itemLabel={it.label}
                      initial={ouToUnderInitial(st.overUnder)}
                      onSave={(c) => patch(it.id, { overUnder: underToOU(c), modalOpen: false })}
                      onCancel={() => patch(it.id, { modalOpen: false })}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CollapsibleChecklistSection>
      ))}

      {finalizeError ? <p className="px-1 text-[11px] text-co-cta-text">{finalizeError}</p> : null}

      <ActionButton onClick={() => void onFinalize()} disabled={finalizing} className="w-full">
        {finalizing ? t("mid_day_prep.phase2.finalizing") : t("mid_day_prep.phase2.finalize")}
      </ActionButton>
    </div>
  );
}
