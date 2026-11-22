"use client";
/**
 * PR SCH (plan r5 4.5, 16.2): the date's EARLIER OPENING on the board. It shows the stored opening (proposed / accepted /
 * manual / automatic / declined, with its start, the usual start, the trigger reasons and the day's guests) and — for
 * whoever may decide it (GM at their own shop, MoO+ anywhere: the same rule as Approve) on a date that is not past — the
 * actions: Accept / Decline a proposal, "Open earlier on this date…" (a start before the usual one), "Use the normal
 * opening" (clear a decision). Every action is Tier B, posts an IDENTITY (an accept never carries a start), and records the
 * decision only: the shifts move when the week is regenerated, which the panel says. Nothing is sent to anyone.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DayView } from "@/lib/scheduling/board-view-shared";
import type { OpeningDecisionInput } from "@/lib/scheduling/opening-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { openingBody, runGuarded, type PostOutcome } from "./horizon-flow-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { useBoardLine } from "./use-board-line";

const asOutcome = (r: { ok: boolean; data?: Record<string, unknown>; code?: string }): PostOutcome => (r.ok ? { ok: true, data: r.data ?? {} } : { ok: false, code: r.code ?? "generic" });
/** The earliest start offered: four hours before the usual opening (never before midnight). */
const EARLIEST_OFFER_Q = 16;
const BTN = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-4 font-bold text-co-text disabled:opacity-60";

export function OpeningPanel({ day, locationId, weekStart, expectedHead, canDecide }: {
  day: DayView; locationId: string; weekStart: string; expectedHead: string | null; canDecide: boolean;
}) {
  const { t, language } = useBoardLine({ names: {}, positions: {} });
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = day.opening ?? null;
  const normalQ = o?.normalStartQ ?? day.bounds?.fromQ ?? null;
  const [startQ, setStartQ] = useState<number | null>(null);
  const actionable = canDecide && !!expectedHead && !day.locked && normalQ !== null;
  if (!o && !actionable) return null;

  async function decide(decision: OpeningDecisionInput) {
    if (!expectedHead) return;
    setBusy(true); setError(null);
    const out = await runGuarded({
      tier: "B", requestStepUp: () => requestStepUp("B"),
      post: async () => asOutcome(await post("/api/schedule", openingBody(locationId, weekStart, expectedHead, day.date, decision))),
    });
    setBusy(false);
    if (out.kind === "cancelled") return;
    if (out.kind === "refused") { setError(out.code); if (out.code === "head_moved") router.refresh(); return; }
    setPicking(false);
    router.refresh();
  }

  const at = (q: number) => formatQ(q, language);
  const reasons = o?.triggers.map((x) => t(`schedule.opening.trigger.${x}` as TranslationKey)).join("; ") ?? "";
  const offers = normalQ === null ? [] : Array.from({ length: Math.max(0, normalQ - Math.max(0, normalQ - EARLIEST_OFFER_Q)) }, (_, i) => Math.max(0, normalQ - EARLIEST_OFFER_Q) + i);
  const persistent = o && (o.status === "accepted" || o.status === "manual" || o.status === "declined");
  const applied = o && (o.status === "accepted" || o.status === "manual" || o.status === "auto");
  return (
    <section className="co-card grid gap-2 p-3" data-section="opening" data-opening-status={o?.status ?? "none"} aria-label={t("schedule.opening.title")}>
      <h2 className="text-sm font-bold text-co-text">{t("schedule.opening.title")}</h2>
      {o ? (
        <p className="text-sm text-co-text">
          {t(`schedule.opening.status.${o.status}` as TranslationKey, { start: at(o.startQ), normal: at(o.normalStartQ), guests: o.guests, reason: reasons || "—" })}
        </p>
      ) : null}
      {applied ? <p className="text-xs text-co-text-muted">{t("schedule.opening.regenerate_hint")}</p> : null}
      {applied && o.engine === "crew" ? <p className="text-xs text-co-text-muted">{t("schedule.opening.crew_hint")}</p> : null}
      {actionable ? (
        <div className="flex flex-wrap gap-2">
          {o?.status === "proposed" ? <>
            <button type="button" data-act="opening-accept" disabled={busy} onClick={() => decide({ kind: "accept" })} className={`${BTN} border-co-text bg-co-gold`}>{t("schedule.opening.act.accept")}</button>
            <button type="button" data-act="opening-decline" disabled={busy} onClick={() => decide({ kind: "decline" })} className={`${BTN} border-co-border-2 bg-co-surface`}>{t("schedule.opening.act.decline")}</button>
          </> : null}
          {o?.status === "auto" ? (
            <button type="button" data-act="opening-decline" disabled={busy} onClick={() => decide({ kind: "decline" })} className={`${BTN} border-co-border-2 bg-co-surface`}>{t("schedule.opening.act.decline")}</button>
          ) : null}
          {persistent ? (
            <button type="button" data-act="opening-clear" disabled={busy} onClick={() => decide({ kind: "clear" })} className={`${BTN} border-co-border-2 bg-co-surface`}>{t("schedule.opening.act.use_normal")}</button>
          ) : null}
          {!picking ? (
            <button type="button" data-act="opening-open-earlier" disabled={busy || offers.length === 0} onClick={() => { setPicking(true); setStartQ(offers[offers.length - 1] ?? null); }}
              className={`${BTN} border-co-border-2 bg-co-surface`}>{t("schedule.opening.act.open_earlier")}</button>
          ) : null}
        </div>
      ) : null}
      {actionable && picking ? (
        <div className="flex flex-wrap items-center gap-2" data-section="opening-pick">
          <label className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-co-text">
            {t("schedule.opening.start_label")}
            <select className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-2 text-co-text" value={startQ ?? ""}
              onChange={(e) => setStartQ(Number(e.target.value))}>
              {offers.map((q) => <option key={q} value={q}>{at(q)}</option>)}
            </select>
          </label>
          <button type="button" data-act="opening-save" disabled={busy || startQ === null} onClick={() => startQ !== null && decide({ kind: "manual", startQ })}
            className={`${BTN} border-co-text bg-co-gold`}>{t("schedule.opening.act.save")}</button>
          <button type="button" data-act="opening-cancel" disabled={busy} onClick={() => setPicking(false)} className={`${BTN} border-co-border-2 bg-co-surface`}>{t("schedule.opening.act.cancel")}</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
    </section>
  );
}
