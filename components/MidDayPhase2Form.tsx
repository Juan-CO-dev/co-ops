"use client";

/**
 * MidDayPhase2Form — Phase 2 collaborative prep for mid-day (C.43). Per-item
 * "prepped" input + per-item Save (realtime-lite: each save POSTs independently,
 * append-only; other cooks' saves reconcile on reload). When prepped differs from
 * the back-to-par need, an inline reason field appears (over/under-prep — stored
 * as inputs.freeText, like opening Phase 2's over/under capture). Finalize closes
 * the instance (phase1_complete → phase2_complete).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";

export interface MidDayPhase2Item {
  id: string;
  label: string;
  section: string;
  parValue: number | null;
  parUnit: string | null;
  /** max(par - phase1 onHand, 0); the back-to-par target. */
  need: number | null;
  /** Prepped amount already saved (this instance), or null. */
  initialPrepped: number | null;
  /** Name of whoever saved it (null = saved by you / not yet saved). */
  initialSavedBy: string | null;
  /** Over/under-prep reason already saved (inputs.freeText), or null. */
  initialReason: string | null;
}

interface SaveState {
  value: string;
  reason: string;
  status: "idle" | "saving" | "saved" | "error";
  savedBy: string | null;
  error: string | null;
}

const EMPTY: SaveState = { value: "", reason: "", status: "idle", savedBy: null, error: null };

export function MidDayPhase2Form({
  instanceId,
  items,
}: {
  instanceId: string;
  items: MidDayPhase2Item[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [states, setStates] = useState<Record<string, SaveState>>(() => {
    const init: Record<string, SaveState> = {};
    for (const it of items) {
      init[it.id] = {
        value: it.initialPrepped !== null ? String(it.initialPrepped) : "",
        reason: it.initialReason ?? "",
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

  const onSave = async (id: string) => {
    const st = states[id] ?? EMPTY;
    if (st.status === "saving") return;
    const raw = st.value.trim();
    const prepped = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(prepped) || prepped < 0) {
      patch(id, { status: "error", error: t("mid_day_prep.phase2.required") });
      return;
    }
    patch(id, { status: "saving", error: null });
    try {
      const res = await fetch("/api/prep/mid-day/phase2/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          templateItemId: id,
          prepped,
          reason: st.reason.trim() || null,
        }),
        redirect: "manual",
      });
      if (res.ok) {
        patch(id, { status: "saved", savedBy: null, error: null });
        return;
      }
      let msg = "Save failed.";
      try {
        const b = (await res.json()) as { message?: string; error?: string };
        msg = b.message ?? b.error ?? msg;
      } catch {
        // keep generic
      }
      patch(id, { status: "error", error: msg });
    } catch (e) {
      patch(id, { status: "error", error: e instanceof Error ? e.message : "Network error." });
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
              const showReason =
                it.need !== null &&
                preppedNum !== null &&
                Number.isFinite(preppedNum) &&
                preppedNum !== it.need;
              const over = showReason && preppedNum! > (it.need ?? 0);
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
                      onChange={(e) => patch(it.id, { value: e.target.value, status: "idle", error: null })}
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
                      onClick={() => void onSave(it.id)}
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

                  {showReason ? (
                    <input
                      type="text"
                      value={st.reason}
                      onChange={(e) => patch(it.id, { reason: e.target.value, status: "idle" })}
                      aria-label={over ? t("mid_day_prep.phase2.over_reason") : t("mid_day_prep.phase2.under_reason")}
                      placeholder={over ? t("mid_day_prep.phase2.over_reason") : t("mid_day_prep.phase2.under_reason")}
                      className="
                        w-full rounded-md border-2 border-co-gold-deep bg-co-surface px-2 py-1.5
                        text-xs text-co-text focus:outline-none
                        focus-visible:ring-4 focus-visible:ring-co-gold/60
                      "
                    />
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
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {finalizeError ? <p className="px-1 text-[11px] text-co-cta">{finalizeError}</p> : null}

      <button
        type="button"
        onClick={() => void onFinalize()}
        disabled={finalizing}
        className="
          inline-flex min-h-[52px] items-center justify-center rounded-xl border-2
          border-co-text bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em]
          text-co-surface transition hover:opacity-90 focus:outline-none
          focus-visible:ring-4 focus-visible:ring-co-gold/60
          disabled:cursor-not-allowed disabled:opacity-50
        "
      >
        {finalizing ? t("mid_day_prep.phase2.finalizing") : t("mid_day_prep.phase2.finalize")}
      </button>
    </div>
  );
}
