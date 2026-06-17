"use client";

/**
 * MidDayPhase2Form — Phase 2 collaborative prep for mid-day (C.43). Per-item
 * "prepped" input + per-item Save (realtime-lite: append-only, reconcile on
 * reload). When prepped is off the back-to-par need, a STRUCTURED over/under
 * reason is required — reusing the opening Phase 2 OverParModal / UnderParModal
 * (reason category + directedBy + free text), stored as prep_data.overUnder.
 * Finalize closes the instance (phase1_complete → phase2_complete).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { MidDayOverUnder } from "@/lib/prep";
import { ActionButton } from "@/components/ActionButton";
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

export interface MidDayPhase2Item {
  id: string;
  label: string;
  section: string;
  parValue: number | null;
  parUnit: string | null;
  need: number | null;
  initialPrepped: number | null;
  initialSavedBy: string | null;
  /** Structured over/under capture already saved (prep_data.overUnder), or null. */
  initialOverUnder: MidDayOverUnder | null;
}

interface SaveState {
  value: string;
  overUnder: MidDayOverUnder | null;
  modalOpen: boolean;
  status: "idle" | "saving" | "saved" | "error";
  savedBy: string | null;
  error: string | null;
}

const EMPTY: SaveState = {
  value: "",
  overUnder: null,
  modalOpen: false,
  status: "idle",
  savedBy: null,
  error: null,
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
  items,
  managers,
}: {
  instanceId: string;
  items: MidDayPhase2Item[];
  managers: ManagerOption[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [states, setStates] = useState<Record<string, SaveState>>(() => {
    const init: Record<string, SaveState> = {};
    for (const it of items) {
      init[it.id] = {
        value: it.initialPrepped !== null ? String(it.initialPrepped) : "",
        overUnder: it.initialOverUnder,
        modalOpen: false,
        status: it.initialPrepped !== null ? "saved" : "idle",
        savedBy: it.initialSavedBy,
        error: null,
      };
    }
    return init;
  });
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

  const patch = (id: string, p: Partial<SaveState>) =>
    setStates((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), ...p } }));

  const onSave = async (it: MidDayPhase2Item) => {
    const st = states[it.id] ?? EMPTY;
    if (st.status === "saving") return;
    const raw = st.value.trim();
    const prepped = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(prepped) || prepped < 0) {
      patch(it.id, { status: "error", error: t("mid_day_prep.phase2.required") });
      return;
    }
    const offPar = it.need !== null && prepped !== it.need;
    if (offPar && !st.overUnder) {
      patch(it.id, { status: "error", error: t("mid_day_prep.phase2.reason_required") });
      return;
    }
    patch(it.id, { status: "saving", error: null });
    try {
      const res = await fetch("/api/prep/mid-day/phase2/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          templateItemId: it.id,
          prepped,
          overUnder: offPar ? st.overUnder : null,
        }),
        redirect: "manual",
      });
      if (res.ok) {
        patch(it.id, { status: "saved", savedBy: null, error: null });
        return;
      }
      let msg = "Save failed.";
      try {
        const b = (await res.json()) as { message?: string; error?: string };
        msg = b.message ?? b.error ?? msg;
      } catch {
        // keep generic
      }
      patch(it.id, { status: "error", error: msg });
    } catch (e) {
      patch(it.id, { status: "error", error: e instanceof Error ? e.message : "Network error." });
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
        const b = (await res.json()) as { message?: string; error?: string };
        msg = b.message ?? b.error ?? msg;
      } catch {
        // keep generic
      }
      setFinalizeError(msg);
      setFinalizing(false);
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : "Network error.");
      setFinalizing(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.section}>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {g.section}
          </h2>
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
                  className="flex flex-col gap-1.5 rounded-md border-2 border-co-border bg-co-surface px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-co-text">{it.label}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                        {it.need !== null
                          ? `${t("mid_day_prep.phase1.need")} ${it.need}`
                          : `${t("mid_day_prep.page.section_par")} ${it.parValue ?? "—"}`}
                        {it.parUnit ? ` ${it.parUnit}` : ""}
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
                      aria-label={`${it.label} — ${t("mid_day_prep.phase2.prepped")}`}
                      placeholder={t("mid_day_prep.phase2.prepped")}
                      className="
                        h-10 w-20 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface
                        px-2 text-sm text-co-text focus:border-co-text focus:outline-none
                        focus-visible:ring-4 focus-visible:ring-co-gold/60
                      "
                    />
                    <button
                      type="button"
                      onClick={() => void onSave(it)}
                      disabled={st.status === "saving"}
                      className="
                        inline-flex h-10 shrink-0 items-center rounded-md border-2 border-co-text
                        bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text
                        transition hover:bg-co-gold-deep focus:outline-none
                        focus-visible:ring-4 focus-visible:ring-co-gold/60
                        disabled:cursor-not-allowed disabled:opacity-50
                      "
                    >
                      {st.status === "saving" ? t("mid_day_prep.phase2.saving") : t("mid_day_prep.phase2.save")}
                    </button>
                  </div>

                  {offPar ? (
                    <button
                      type="button"
                      onClick={() => patch(it.id, { modalOpen: true, status: "idle", error: null })}
                      className="
                        inline-flex min-h-[44px] items-center self-start rounded-md border-2
                        border-co-gold-deep bg-co-surface px-2 text-[11px] font-bold uppercase
                        tracking-[0.1em] text-co-text transition hover:bg-co-surface-2
                        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                      "
                    >
                      {st.overUnder
                        ? t("mid_day_prep.phase2.edit_reason")
                        : t("mid_day_prep.phase2.add_reason")}
                    </button>
                  ) : null}

                  {st.status === "saved" ? (
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-success">
                      {st.savedBy
                        ? t("mid_day_prep.phase2.saved_by", { name: st.savedBy })
                        : t("mid_day_prep.phase2.saved")}
                    </p>
                  ) : null}
                  {st.status === "error" && st.error ? (
                    <p className="text-[10px] text-co-cta">{st.error}</p>
                  ) : null}

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
        </section>
      ))}

      {finalizeError ? <p className="px-1 text-[11px] text-co-cta">{finalizeError}</p> : null}

      <ActionButton onClick={() => void onFinalize()} disabled={finalizing} className="w-full">
        {finalizing ? t("mid_day_prep.phase2.finalizing") : t("mid_day_prep.phase2.finalize")}
      </ActionButton>
    </div>
  );
}
