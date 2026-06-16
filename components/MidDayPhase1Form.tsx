"use client";

/**
 * MidDayPhase1Form — Phase 1 count form for mid-day prep (C.43). One numeric
 * on-hand input per item; shows live "need = max(par - on_hand, 0)". Submit
 * POSTs /api/prep/mid-day/phase1 (single-submit → phase1_complete), then
 * router.refresh() re-renders the page into Phase 2.
 *
 * Blank inputs submit as on_hand=0 (counter didn't find any → prep full par).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { ActionButton } from "@/components/ActionButton";

export interface MidDayPhase1Item {
  id: string;
  label: string;
  section: string;
  parValue: number | null;
  parUnit: string | null;
}

export function MidDayPhase1Form({
  instanceId,
  items,
}: {
  instanceId: string;
  items: MidDayPhase1Item[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const out: Array<{ section: string; items: MidDayPhase1Item[] }> = [];
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

  const onSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const entries = items.map((it) => {
      const raw = counts[it.id];
      const n = raw === undefined || raw.trim() === "" ? 0 : Number(raw);
      return { templateItemId: it.id, inputs: { onHand: Number.isFinite(n) ? n : 0 } };
    });
    try {
      const res = await fetch("/api/prep/mid-day/phase1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, entries }),
        redirect: "manual",
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      let msg = "Could not submit the count.";
      try {
        const b = (await res.json()) as { message?: string; error?: string };
        msg = b.message ?? b.error ?? msg;
      } catch {
        // keep generic message
      }
      setError(msg);
      setSubmitting(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error.");
      setSubmitting(false);
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
              const raw = counts[it.id] ?? "";
              const onHand = raw.trim() === "" ? null : Number(raw);
              const need =
                it.parValue !== null && onHand !== null && Number.isFinite(onHand)
                  ? Math.max(it.parValue - onHand, 0)
                  : null;
              return (
                <li
                  key={it.id}
                  className="flex items-center gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-co-text">{it.label}</p>
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                      {t("mid_day_prep.page.section_par")} {it.parValue ?? "—"}
                      {it.parUnit ? ` ${it.parUnit}` : ""}
                      {need !== null ? ` · ${t("mid_day_prep.phase1.need")} ${need}` : ""}
                    </p>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={raw}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [it.id]: e.target.value }))
                    }
                    aria-label={`${it.label} — ${t("mid_day_prep.phase1.on_hand")}`}
                    placeholder={t("mid_day_prep.phase1.on_hand")}
                    className="
                      h-10 w-24 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface
                      px-2 text-sm text-co-text focus:border-co-text focus:outline-none
                      focus-visible:ring-4 focus-visible:ring-co-gold/60
                    "
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {error ? <p className="px-1 text-[11px] text-co-cta">{error}</p> : null}

      <ActionButton onClick={() => void onSubmit()} disabled={submitting} className="w-full">
        {submitting ? t("mid_day_prep.phase1.submitting") : t("mid_day_prep.phase1.submit")}
      </ActionButton>
    </div>
  );
}
