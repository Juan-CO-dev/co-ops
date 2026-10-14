"use client";

/**
 * MidDayPhase2Form — Phase 2 collaborative prep for mid-day (C.43). Per-item
 * "prepped" input that SAVES WHEN YOU LEAVE THE BOX (D-14, like opening Phase 2;
 * realtime-lite: append-only, reconcile on reload). When prepped is off the
 * back-to-par need, a STRUCTURED over/under reason is required — reusing the
 * opening Phase 2 OverParModal / UnderParModal (reason category + directedBy +
 * free text), stored as prep_data.overUnder. A blur while that reason is missing
 * saves nothing and shows the calm "add a reason" nudge; saving the reason in
 * the modal is what persists the row. The gate is the pure midDayPhase2SaveGate
 * (lib/mid-day-shared.ts). Finalize waits for every in-flight row save, then
 * closes the instance (phase1_complete → phase2_complete).
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { resolveSectionLabel } from "@/lib/prep-sections";
import type { MidDayOverUnder } from "@/lib/prep";
import { ActionButton } from "@/components/ActionButton";
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
  emptyBatchFormValue,
  isBatchContractCode,
  type BatchFormValue,
  type BatchRowContext,
} from "@/lib/batch-prep-shared";
import { midDayPhase2SaveGate, midDayPhase2Signature } from "@/lib/mid-day-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { etCalendarDate } from "@/lib/operational-day";
import { formatPrepQty } from "@/lib/prep-display-shared";

export interface MidDayPhase2Item {
  id: string;
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
  /** incomplete = a calm nudge (reason / batch half missing), never a failure. */
  status: "idle" | "saving" | "saved" | "error" | "incomplete";
  savedBy: string | null;
  error: string | null;
  /** True when the last save reached the server (or the network) and failed — the row offers "Try again". */
  retryable: boolean;
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
  retryable: false,
  confirmedConsumption: null,
  batch: emptyBatchFormValue(),
  batchErrorCode: null,
};

/** The signature of what a row already saved (D-14 dedupe); null when it has no save or it would not pass the gate. */
function savedSignatureOf(it: MidDayPhase2Item, st: SaveState): string | null {
  if (st.status !== "saved") return null;
  const gate = midDayPhase2SaveGate(
    { value: st.value, overUnder: st.overUnder, batch: st.batch },
    { need: it.need, batch: it.batch ?? null },
  );
  return gate.kind === "ok"
    ? midDayPhase2Signature({
        prepped: gate.prepped,
        overUnder: gate.overUnder,
        confirmedConsumption: st.confirmedConsumption,
        batchEntry: gate.batchEntry,
      })
    : null;
}

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
  items,
  managers,
  sectionLabels = {},
  todayIso,
  canEditConsumption = false,
}: {
  instanceId: string;
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
        retryable: false,
        confirmedConsumption: null,
        batch: it.initialBatch ?? emptyBatchFormValue(),
        batchErrorCode: null,
      };
    }
    return init;
  });
  // D-14 — per row: the signature the server holds, the one last sent, and the save chain.
  // One row's saves run one after another (never two POSTs racing for the same row), and
  // finalize waits for every chain. Mutable bookkeeping, never rendered.
  const [savedSig] = useState(() => {
    const m = new Map<string, string | null>();
    for (const it of items) m.set(it.id, savedSignatureOf(it, states[it.id] ?? EMPTY));
    return m;
  });
  const [queuedSig] = useState(() => new Map(savedSig));
  const chains = useRef(new Map<string, Promise<void>>());
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

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

  const patch = (id: string, p: Partial<SaveState>) =>
    setStates((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), ...p } }));

  /**
   * D-14 — persist one row with the given state (blur, reason saved, panel or batch commit).
   * Takes the explicit state to save so a modal / panel edit is never read from a stale closure.
   */
  const persist = (it: MidDayPhase2Item, st: SaveState): Promise<void> => {
    const pending = chains.current.get(it.id) ?? Promise.resolve();
    const gate = midDayPhase2SaveGate(
      { value: st.value, overUnder: st.overUnder, batch: st.batch },
      { need: it.need, batch: it.batch ?? null },
    );
    if (gate.kind === "blank") return pending;
    if (gate.kind === "invalid") {
      patch(it.id, { status: "error", error: t("mid_day_prep.phase2.required"), retryable: false });
      return pending;
    }
    if (gate.kind === "incomplete") {
      patch(it.id, {
        status: "incomplete",
        error:
          gate.reason === "needs_reason"
            ? t("mid_day_prep.phase2.reason_required")
            : t("mid_day_prep.phase2.batch_incomplete" as TranslationKey),
        retryable: false,
        batchErrorCode: gate.batchErrorCode,
      });
      return pending;
    }
    const sig = midDayPhase2Signature({
      prepped: gate.prepped,
      overUnder: gate.overUnder,
      confirmedConsumption: st.confirmedConsumption,
      batchEntry: gate.batchEntry,
    });
    if (sig === queuedSig.get(it.id)) {
      // Already saved (or on its way) — no second completion row, no re-attribution.
      if (sig === savedSig.get(it.id)) patch(it.id, { status: "saved", error: null, retryable: false, batchErrorCode: null });
      return pending;
    }
    queuedSig.set(it.id, sig);
    patch(it.id, { status: "saving", error: null, retryable: false, batchErrorCode: null });
    const sentValue = st.value.trim();
    const failed = (p: Partial<SaveState>) => {
      queuedSig.set(it.id, savedSig.get(it.id) ?? null);
      patch(it.id, { status: "error", retryable: true, ...p });
    };
    const run = async () => {
      try {
        const res = await fetch("/api/prep/mid-day/phase2/item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId,
            templateItemId: it.id,
            prepped: gate.prepped,
            overUnder: gate.overUnder,
            confirmedConsumption: st.confirmedConsumption,
            // 0215 — present only on a batch item (absent = single box, today's body).
            ...(gate.batchEntry ? { batch: gate.batchEntry } : {}),
          }),
          redirect: "manual",
        });
        if (res.ok) {
          savedSig.set(it.id, sig);
          // "Saved" only while the box still shows what was sent (typing during the save keeps the row unsaved).
          setStates((s) => {
            const cur = s[it.id] ?? EMPTY;
            const same = cur.value.trim() === sentValue;
            return {
              ...s,
              [it.id]: same
                ? { ...cur, status: "saved", savedBy: null, error: null, retryable: false, batchErrorCode: null }
                : { ...cur, savedBy: null },
            };
          });
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
        failed({ error: isBatchContractCode(code) ? null : msg, batchErrorCode: isBatchContractCode(code) ? code : null });
      } catch (e) {
        failed({ error: e instanceof Error ? e.message : "Network error." });
      }
    };
    const next = pending.then(run);
    chains.current.set(it.id, next);
    return next;
  };

  const onFinalize = async () => {
    if (finalizing) return;
    setFinalizing(true);
    setFinalizeError(null);
    // D-14 — tapping Finalize blurs the last box first; wait for that save (and every other
    // in-flight row save) so finalize never overtakes a row save and strands it.
    await Promise.all([...chains.current.values()]);
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
      <p className="px-1 text-xs text-co-text-muted">{t("mid_day_prep.phase2.autosave_hint")}</p>
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
                >
                  {it.batch ? (
                    /* 0215 batch vs bottle — the batch half (batch_mode items only). */
                    <BatchEntryFields
                      value={st.batch}
                      onChange={(next) => patch(it.id, { batch: next, status: "idle", error: null, batchErrorCode: null })}
                      onCommit={(next) => void persist(it, { ...st, batch: next })}
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
                      // D-14 — leaving the box saves the row (no Save button), like opening Phase 2.
                      onBlur={() => void persist(it, st)}
                      aria-label={`${it.label} — ${it.batch ? t("prep.batch.bottled_label" as TranslationKey) : t("mid_day_prep.phase2.prepped")}`}
                      placeholder={it.batch ? t("prep.batch.bottled_label" as TranslationKey) : t("mid_day_prep.phase2.prepped")}
                      className="
                        min-h-[44px] w-20 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface
                        px-2 text-base text-co-text focus:border-co-text focus:outline-none
                        focus-visible:ring-4 focus-visible:ring-co-gold/60
                      "
                    />
                  </div>

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
                      onChange={(rows) => {
                        // No Save button: a panel edit persists itself, as on opening Phase 2.
                        patch(it.id, { confirmedConsumption: rows });
                        void persist(it, { ...st, confirmedConsumption: rows });
                      }}
                      canEdit={canEditConsumption}
                    />
                  ) : null}
                  {st.status === "saving" ? (
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
                      {t("mid_day_prep.phase2.saving")}
                    </p>
                  ) : null}
                  {st.status === "saved" ? (
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-co-confirm-text">
                      {st.savedBy
                        ? t("mid_day_prep.phase2.saved_by", { name: st.savedBy })
                        : t("mid_day_prep.phase2.saved")}
                    </p>
                  ) : null}
                  {st.status === "incomplete" && st.error ? (
                    // Calm, directive nudge (not an error): the next step that makes the row savable.
                    <p className="text-[11px] font-medium text-co-info">{st.error}</p>
                  ) : null}
                  {st.status === "error" && st.error ? (
                    <p role="alert" className="text-[10px] text-co-cta-text">{st.error}</p>
                  ) : null}
                  {st.status === "error" && st.retryable ? (
                    <ActionButton
                      variant="secondary"
                      onClick={() => void persist(it, st)}
                      aria-label={t("mid_day_prep.phase2.retry_aria", { item: it.label })}
                      className="self-start"
                    >
                      {t("mid_day_prep.phase2.retry")}
                    </ActionButton>
                  ) : null}

                  {st.modalOpen && over ? (
                    <OverParModal
                      open
                      itemLabel={it.label}
                      initial={ouToOverInitial(st.overUnder)}
                      managers={managers}
                      onSave={(c) => {
                        // Saving the reason is what persists an off-need row.
                        patch(it.id, { overUnder: overToOU(c), modalOpen: false });
                        void persist(it, { ...st, overUnder: overToOU(c) });
                      }}
                      onCancel={() => patch(it.id, { modalOpen: false })}
                    />
                  ) : null}
                  {st.modalOpen && offPar && !over ? (
                    <UnderParModal
                      open
                      itemLabel={it.label}
                      initial={ouToUnderInitial(st.overUnder)}
                      onSave={(c) => {
                        patch(it.id, { overUnder: underToOU(c), modalOpen: false });
                        void persist(it, { ...st, overUnder: underToOU(c) });
                      }}
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
