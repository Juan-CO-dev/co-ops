"use client";
/**
 * The horizon builder (spec §5.8, §6.1; plan Task 23): choose next week · the next N weeks · the rest of this month · a
 * whole month; Preview shows, per week, What changed (summary + a collapsed day list), the gaps by cause with their
 * certificate line, new problems and EARLIER problems (kept days; they never block Approve), the further-out confidence
 * note, and — for a week carrying manager edits — "You edited this week — rebuilding replaces your edits" with its own
 * checkbox. Apply posts the preview's token; it asks for the password (Tier B) ONLY when a checked week carries edits;
 * a cancelled prompt keeps the preview and applies nothing; unchecked edited weeks are skipped and named; a stale
 * preview says "preview again"; a partial result names the landed, skipped and failed weeks.
 *
 * `ApproveBar`: Approve (Tier B, always prompted) — disabled WITH its reason while rules fail or an unresolved gap
 * remains; once approved, "Ready for 7shifts — sending comes in a later update" and no send control (Phase 3).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { formatDateLabel, formatMonthLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { NarrativeLine } from "@/lib/people-narrative";
import type { HorizonApplyResult, HorizonPreview, PreviewWeek } from "@/lib/scheduling/schedules";
import type { HorizonRequest } from "@/lib/scheduling/horizon-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { useBoardLine } from "./use-board-line";
import { WhatChanged } from "./WhatChanged";
import {
  HORIZON_MODES, applyBody, applyNeedsStepUp, approveBody, previewBody, requestFor, runGuarded, skippedWeeks, type HorizonChoice, type PostOutcome,
} from "./horizon-flow-shared";

type Labels = Record<string, { name: string; nameEs: string | null }>;
export type HorizonPreviewView = HorizonPreview & { request: HorizonRequest };

const nextMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`; };
const asOutcome = (r: { ok: boolean; data?: Record<string, unknown>; code?: string }): PostOutcome => (r.ok ? { ok: true, data: r.data ?? {} } : { ok: false, code: r.code ?? "generic" });

export function HorizonBuilder({ locationId, today = "2026-10-21", names, positions, initialPreview = null, initialResult = null, initialError = null }: {
  locationId: string;
  today?: string;
  names: Record<string, string>;
  positions: Labels;
  /** SSR tests only. */
  initialPreview?: HorizonPreviewView | null;
  initialResult?: HorizonApplyResult | null;
  initialError?: string | null;
}) {
  const { t, language } = useBoardLine({ names, positions });
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const thisMonth = today.slice(0, 7);
  const [choice, setChoice] = useState<HorizonChoice>({ mode: "next_week", n: 2, month: nextMonth(thisMonth) });
  const [preview, setPreview] = useState<HorizonPreviewView | null>(initialPreview);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [result, setResult] = useState<HorizonApplyResult | null>(initialResult);

  async function doPreview() {
    setBusy(true); setError(null); setResult(null);
    const request = requestFor(choice);
    const r = await post("/api/schedule", previewBody(locationId, request));
    setBusy(false);
    if (!r.ok) { setError(r.code); return; }
    setPreview({ ...((r.data as { preview: HorizonPreview }).preview), request });
    setConfirmed([]);
  }
  async function doApply() {
    if (!preview) return;
    setBusy(true); setError(null);
    const out = await runGuarded({
      tier: applyNeedsStepUp(preview, confirmed) ? "B" : null,
      requestStepUp: () => requestStepUp("B"),
      post: async () => asOutcome(await post("/api/schedule", applyBody(locationId, preview.request, preview.token, confirmed))),
    });
    setBusy(false);
    if (out.kind === "cancelled") return; // the preview stays; nothing was applied
    if (out.kind === "refused") { setError(out.code); return; }
    setResult(out.data.result as HorizonApplyResult);
    setPreview(null);
    router.refresh();
  }
  const date = (d: string) => formatDateLabel(d, language);
  return (
    <section className="co-card grid gap-3 p-4" data-section="horizon" aria-labelledby="schedule-horizon-title">
      <h2 id="schedule-horizon-title" className="text-base font-bold text-co-text">{t("schedule.board.horizon.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("schedule.board.horizon.intro")}</p>
      <fieldset className="grid gap-2">
        <legend className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.board.horizon.choose")}</legend>
        {HORIZON_MODES.map((m) => (
          <label key={m} data-mode={m} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-co-border px-3 text-sm text-co-text">
            <input type="radio" name="schedule-horizon" className="h-5 w-5" checked={choice.mode === m} onChange={() => setChoice((c) => ({ ...c, mode: m }))} />
            {t(`schedule.board.horizon.mode.${m}` as TranslationKey)}
          </label>
        ))}
        {choice.mode === "next_weeks" ? (
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">{t("schedule.board.horizon.weeks_label")}
            <select className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-2" value={choice.n} onChange={(e) => setChoice((c) => ({ ...c, n: Number(e.target.value) }))}>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        ) : null}
        {choice.mode === "month" ? (
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">{t("schedule.board.horizon.month_label")}
            <select className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-2" value={choice.month} onChange={(e) => setChoice((c) => ({ ...c, month: e.target.value }))}>
              {[thisMonth, nextMonth(thisMonth)].map((m) => <option key={m} value={m}>{formatMonthLabel(m, language)}</option>)}
            </select>
          </label>
        ) : null}
      </fieldset>
      <button type="button" data-act="preview" disabled={busy} onClick={doPreview}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface px-4 font-bold text-co-text disabled:opacity-60">
        {t(error === "preview_stale" ? "schedule.board.horizon.preview_again_button" : "schedule.board.horizon.preview")}
      </button>
      {error === "preview_stale" ? <p role="alert" className="text-sm font-bold text-co-warning-text">{t("schedule.board.horizon.preview_again")}</p>
        : error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}

      {preview ? (
        <div className="grid gap-3" data-section="horizon-preview">
          {preview.weeks.map((w) => <PreviewWeekCard key={w.weekStart} w={w} names={names} positions={positions} confirmed={confirmed.includes(w.weekStart)}
            onConfirm={(on) => setConfirmed((c) => (on ? [...c, w.weekStart] : c.filter((x) => x !== w.weekStart)))} />)}
          {skippedWeeks(preview, confirmed).map((ws) => <p key={ws} className="text-sm text-co-text-muted">{t("schedule.board.horizon.will_skip", { date: date(ws) })}</p>)}
          <button type="button" data-act="apply" disabled={busy} onClick={doApply}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60">
            {t("schedule.board.horizon.apply")}
          </button>
        </div>
      ) : null}

      {result ? (
        <ul className="grid gap-1 text-sm" data-section="horizon-result">
          {result.landed.map((x) => <li key={x.weekStart} className="text-co-confirm-text">{t("schedule.board.horizon.landed", { date: date(x.weekStart) })}</li>)}
          {result.skipped.map((x) => <li key={x.weekStart} className="text-co-text-muted">{t("schedule.board.horizon.skipped", { date: date(x.weekStart) })}</li>)}
          {result.failed ? <li className="font-bold text-co-cta-text">{t("schedule.board.horizon.failed", { date: date(result.failed.weekStart) })} {t(scheduleErrorKey(result.failed.code))}</li> : null}
        </ul>
      ) : null}
    </section>
  );
}

function PreviewWeekCard({ w, names, positions, confirmed, onConfirm }: {
  w: PreviewWeek & { gaps: Array<PreviewWeek["gaps"][number] & { line: NarrativeLine }> };
  names: Record<string, string>;
  positions: Labels;
  confirmed: boolean;
  onConfirm: (on: boolean) => void;
}) {
  const { t, language, line, position } = useBoardLine({ names, positions });
  return (
    <article className="grid gap-2 rounded-lg border-2 border-co-border p-3" data-week={w.weekStart}>
      <h3 className="text-sm font-bold text-co-text">{t("schedule.board.week.of", { date: formatDateLabel(w.weekStart, language) })}</h3>
      {w.confidence === "further_out" ? <p className="text-xs text-co-text-muted">{t("schedule.board.banner.further_out")}</p> : null}
      {w.edited ? (
        <div className="grid gap-1 rounded-lg border-2 border-co-warning bg-co-warning-surface p-2">
          <p className="text-sm font-bold text-co-warning-text">{t(w.engine === "crew" ? "schedule.board.horizon.crew_edited_warning" : "schedule.board.horizon.edited_warning")}{w.engine === "crew" && !!w.historicalEditedDates?.length && <> {t("schedule.board.horizon.crew_history_warning")}</>}</p>
          <label data-confirm-week={w.weekStart} className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} />
            {t("schedule.board.horizon.confirm_week")}
          </label>
        </div>
      ) : null}
      <WhatChanged diff={w.whatChanged} names={names} positions={positions} />
      <p className="text-xs text-co-text-muted">
        {t("schedule.board.horizon.new_problems", { n: w.problems.newErrors + w.problems.newGaps + w.problems.newWarnings })}
        {w.problems.inherited > 0 ? <> · {t("schedule.board.horizon.earlier_problems", { n: w.problems.inherited })}</> : null}
      </p>
      {w.gaps.length > 0 ? (
        <ul className="grid gap-1 text-sm" aria-label={t("schedule.board.gap.title", { n: w.gaps.length })}>
          {w.gaps.map((g, i) => (
            <li key={i} data-gap-cause={g.cause} className={g.cause === "budget_limited" || g.cause === "unresolved_search" ? "text-co-warning-text" : "text-co-cta-text"}>
              {formatDateLabel(g.date, language)} · {g.positionId ? `${position(g.positionId)} · ` : ""}{formatQ(g.fromQ, language)}–{formatQ(g.toQ, language)} ·{" "}
              <span className="font-bold">{t(`schedule.gap.cause.${g.cause}` as TranslationKey)}:</span> {line(g.line)}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function ApproveBar({ locationId, weekStart, week, approve }: {
  locationId: string;
  weekStart: string;
  week: { headRevisionId: string; approved: boolean; edited: boolean } | null;
  approve: { allowed: boolean; refusal: string | null };
}) {
  const { t } = useBoardLine({ names: {}, positions: {} });
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!week) return null;
  if (week.approved) return <p className="co-card p-3 text-sm font-bold text-co-confirm-text" data-section="approve">{t("schedule.board.ready_for_7shifts")}</p>;
  if (approve.refusal === "forbidden") return null;
  async function doApprove() {
    if (!week) return;
    setBusy(true); setError(null);
    const out = await runGuarded({
      tier: "B", requestStepUp: () => requestStepUp("B"),
      post: async () => asOutcome(await post("/api/schedule", approveBody(locationId, weekStart, week.headRevisionId))),
    });
    setBusy(false);
    if (out.kind === "cancelled") return;
    if (out.kind === "refused") { setError(out.code); if (out.code === "head_moved") router.refresh(); return; }
    router.refresh();
  }
  const reason = approve.refusal === "unresolved_gaps" || approve.refusal === "rules_failing" ? approve.refusal : null;
  return (
    <section className="co-card grid gap-2 p-4" data-section="approve">
      <p className="text-sm text-co-text-muted">{t("schedule.board.approve.intro")}</p>
      <button type="button" data-act="approve" disabled={busy || !approve.allowed} onClick={doApprove}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-text bg-co-gold px-4 font-bold text-co-text disabled:opacity-60">
        {t("schedule.board.approve.button")}
      </button>
      {reason ? <p className="text-sm font-bold text-co-warning-text">{t(`schedule.error.${reason}` as TranslationKey)}</p> : null}
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
    </section>
  );
}
