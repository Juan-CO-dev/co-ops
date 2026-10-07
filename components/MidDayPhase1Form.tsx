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
import { resolveSectionLabel } from "@/lib/prep-sections";
import { ActionButton } from "@/components/ActionButton";
import { CollapsibleChecklistSection } from "@/components/ui/CollapsibleChecklistSection";
import { useCollapsibleSections } from "@/lib/use-collapsible-sections";

export interface MidDayPhase1Item {
  id: string;
  label: string;
  section: string;
  parValue: number | null;
  parUnit: string | null;
  /**
   * 0215 batch vs bottle (ruling F) — true when the item's recipe is batch_mode and eligible:
   * the count is TWO boxes (on hand = LINE, plus the bulk BACK UP), both required, and the
   * server derives the total. Every other item keeps its single box, blank = 0.
   */
  batchMode?: boolean;
}

export function MidDayPhase1Form({
  instanceId,
  items,
  sectionLabels = {},
}: {
  instanceId: string;
  items: MidDayPhase1Item[];
  /** DB-backed section labels (slug → { en, es }); preferred over the raw slug. */
  sectionLabels?: Record<string, { en: string; es: string | null }>;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  /** 0215 — the bulk BACK UP box of a batch item, keyed like `counts`. */
  const [backUps, setBackUps] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBatchErrors, setShowBatchErrors] = useState(false);

  const isBoxBlank = (raw: string | undefined) => raw === undefined || raw.trim() === "";
  /** A batch item is COUNTED only when both boxes hold a finite number >= 0. */
  const batchBoxesComplete = (it: MidDayPhase1Item) => {
    if (!it.batchMode) return true;
    const a = Number(counts[it.id] ?? "");
    const b = Number(backUps[it.id] ?? "");
    return !isBoxBlank(counts[it.id]) && !isBoxBlank(backUps[it.id]) && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0;
  };

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

  // Wave 1 B — collapsible sections. An item is DONE when its count box is non-blank
  // (the form's own "has a count" rule: blank submits as 0, but the need readout and
  // the counter treat only a non-blank box as counted). Phase 1 has no client-side
  // submit validation (blank = 0), so there is no open-on-error hook here.
  const collapsible = useCollapsibleSections(
    "mid-day-phase1",
    groups.map((g) => ({
      id: g.section,
      total: g.items.length,
      done: g.items.filter((it) => (counts[it.id] ?? "").trim() !== "" && batchBoxesComplete(it)).length,
    })),
  );

  const onSubmit = async () => {
    if (submitting) return;
    // 0215: a batch item with a blank box does not default to 0 — a silent 0 would wipe a
    // real bulk container from the backup math. Say which rows are missing and stop.
    const incomplete = items.filter((it) => !batchBoxesComplete(it));
    if (incomplete.length > 0) {
      setShowBatchErrors(true);
      setError(t("mid_day_prep.phase1.error.backup_required"));
      collapsible.reveal(incomplete.map((it) => it.section));
      return;
    }
    setSubmitting(true);
    setError(null);
    const entries = items.map((it) => {
      const raw = counts[it.id];
      const n = raw === undefined || raw.trim() === "" ? 0 : Number(raw);
      if (it.batchMode) {
        // Both boxes are present (checked above); the server derives the total.
        return { templateItemId: it.id, inputs: { onHand: n, backUp: Number(backUps[it.id]) } };
      }
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
    <div className="mt-4 flex flex-col gap-5 lg:block lg:columns-2 lg:[column-gap:1.25rem] lg:[&>*]:break-inside-avoid lg:[&>*]:mb-5">
      {groups.map((g) => (
        <CollapsibleChecklistSection
          key={g.section}
          formKey="mid-day-phase1"
          headingLevel={2}
          sectionId={g.section}
          title={resolveSectionLabel(sectionLabels, g.section, language, g.section)}
          titleClassName="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-text"
          done={g.items.filter((it) => (counts[it.id] ?? "").trim() !== "").length}
          total={g.items.length}
          open={collapsible.isOpen(g.section)}
          onToggle={() => collapsible.toggle(g.section)}
        >
          <ul className="mt-2 flex flex-col gap-1.5">
            {g.items.map((it) => {
              const raw = counts[it.id] ?? "";
              const onHand = raw.trim() === "" ? null : Number(raw);
              const need =
                it.parValue !== null && onHand !== null && Number.isFinite(onHand)
                  ? Math.max(it.parValue - onHand, 0)
                  : null;
              const batchIncomplete = showBatchErrors && !batchBoxesComplete(it);
              return (
                <li
                  key={it.id}
                  className={[
                    "flex items-center gap-3 rounded-md border-2 bg-co-surface px-3 py-2",
                    batchIncomplete ? "border-co-cta-text" : "border-co-border",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-co-text">{it.label}</p>
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-co-text-dim">
                      {t("mid_day_prep.page.section_par")} {it.parValue ?? "—"}
                      {it.parUnit ? ` ${it.parUnit}` : ""}
                      {need !== null ? ` · ${t("mid_day_prep.phase1.need")} ${need}` : ""}
                    </p>
                    {batchIncomplete ? (
                      <p className="text-[10px] font-bold text-co-cta-text">{t("mid_day_prep.phase1.error.backup_required")}</p>
                    ) : null}
                  </div>
                  {it.batchMode ? (
                    /* 0215 — the bulk BACK UP box sits beside the on-hand (LINE) box. */
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={backUps[it.id] ?? ""}
                      onChange={(e) => setBackUps((c) => ({ ...c, [it.id]: e.target.value }))}
                      aria-label={`${it.label} — ${t("mid_day_prep.phase1.back_up")}`}
                      aria-required
                      placeholder={t("mid_day_prep.phase1.back_up")}
                      className="
                        min-h-[44px] w-24 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface
                        px-2 text-sm text-co-text focus:border-co-text focus:outline-none
                        focus-visible:ring-4 focus-visible:ring-co-gold/60
                      "
                    />
                  ) : null}
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
                      min-h-[44px] w-24 shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface
                      px-2 text-sm text-co-text focus:border-co-text focus:outline-none
                      focus-visible:ring-4 focus-visible:ring-co-gold/60
                    "
                  />
                </li>
              );
            })}
          </ul>
        </CollapsibleChecklistSection>
      ))}

      {error ? <p className="px-1 text-[11px] text-co-cta-text">{error}</p> : null}

      <ActionButton onClick={() => void onSubmit()} disabled={submitting} className="w-full">
        {submitting ? t("mid_day_prep.phase1.submitting") : t("mid_day_prep.phase1.submit")}
      </ActionButton>
    </div>
  );
}
