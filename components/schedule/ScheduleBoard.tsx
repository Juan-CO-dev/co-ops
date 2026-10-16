"use client";
/**
 * THE SCHEDULE BOARD (Scheduling Phase 2, chunk F; spec §7; Juan's mockup v17 as the visual reference). Renders the
 * server-computed `BoardView` and never re-derives a rule. Phone-first at 375 px: one column, the page never scrolls
 * sideways (the timeline is the one horizontally scrollable region). Client state is `useState` only (D9).
 *
 * States: scheduling OFF for the shop ("Turn it on in schedule settings" for MoO+), NOT INSTALLED (the 503 line), and
 * READY: the week picker, banners, the live strip with the budget lines, the suggestion, the advisory, the rules badge,
 * the day tabs, the selected day (notes, gaps), and Generate / Regenerate. No email, no notification.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { BoardBanner, BoardView, GapLine } from "@/lib/scheduling/board-view-shared";
import { addDays, formatQ } from "@/lib/scheduling/time-shared";
import { BudgetSuggestion } from "./BudgetSuggestion";
import { DayTabs } from "./DayTabs";
import { DayTimeline } from "./DayTimeline";
import { LaborTargetCard } from "./LaborTargetCard";
import { MoneyStrip } from "./MoneyStrip";
import { RulesBadge } from "./RulesBadge";
import { scheduleErrorKey } from "./schedule-errors";
import { useBoardLine } from "./use-board-line";

export type BoardPageView = { state: "off"; canTurnOn: boolean; locationId?: string } | { state: "not_installed" } | ({ state: "ready" } & BoardView);

const BANNER_TONE: Record<BoardBanner["tone"], string> = {
  info: "border-co-border bg-co-surface-inset text-co-text",
  warn: "border-co-warning bg-co-warning-surface text-co-warning-text",
  danger: "border-co-cta-text bg-co-danger-surface text-co-cta-text",
};

export function ScheduleBoard({ view, initialDate }: { view: BoardPageView; initialDate?: string }) {
  if (view.state === "off") return <BoardOff canTurnOn={view.canTurnOn} locationId={view.locationId ?? null} />;
  if (view.state === "not_installed") return <BoardNotInstalled />;
  return <ReadyBoard view={view} initialDate={initialDate} />;
}

function BoardOff({ canTurnOn, locationId }: { canTurnOn: boolean; locationId: string | null }) {
  const { t } = useBoardLine({ names: {}, positions: {} });
  return (
    <section className="co-card grid gap-2 p-4" data-state="off">
      <p className="font-bold text-co-text">{t("schedule.page.off")}</p>
      {canTurnOn ? (
        <Link href={locationId ? `/schedule/settings?loc=${locationId}` : "/schedule/settings"} className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">
          {t("schedule.page.off_moo")}
        </Link>
      ) : null}
    </section>
  );
}

function BoardNotInstalled() {
  const { t } = useBoardLine({ names: {}, positions: {} });
  return <p className="co-card p-4 text-sm font-bold text-co-text" role="status" data-state="not_installed">{t("schedule.error.inputs_unavailable")}</p>;
}

function GapRow({ g, names, positions }: { g: GapLine; names: Record<string, string>; positions: Record<string, { name: string; nameEs: string | null }> }) {
  const { t, language, line, name, position } = useBoardLine({ names, positions });
  const what = g.code === "coverage_gap" ? position(g.positionId) : t(`schedule.rule.${g.code}` as TranslationKey);
  const certificate = g.cause === "unresolved_search" && g.candidateIds.length > 0
    ? t("schedule.board.gap.unresolved_try", { candidates: g.candidateIds.map((id) => name(id)).join(", ") })
    : line(g.line);
  return (
    <li data-gap-cause={g.cause} data-tone={g.tone}
      className={`grid gap-0.5 rounded-lg border-2 p-2 text-sm ${g.tone === "amber" ? "border-co-warning bg-co-warning-surface" : "border-co-cta-text bg-co-danger-surface"}`}>
      <span className="font-bold text-co-text">{what} · {formatQ(g.fromQ, language)}–{formatQ(g.toQ, language)}</span>
      <span className={g.tone === "amber" ? "text-co-warning-text" : "text-co-cta-text"}>
        <span className="font-bold">{t(`schedule.gap.cause.${g.cause}` as TranslationKey)}:</span> {certificate}
      </span>
      {g.inherited ? <span className="text-xs text-co-text-muted">{t("schedule.board.problem.earlier")}</span> : null}
      {g.blocksApprove ? <span className="text-xs font-bold text-co-warning-text">{t("schedule.board.gap.blocks_approve")}</span> : null}
    </li>
  );
}

function ReadyBoard({ view, initialDate }: { view: BoardView; initialDate?: string }) {
  const { t, language, line } = useBoardLine({ names: view.names, positions: view.positions });
  const router = useRouter();
  const post = useStepUpPost();
  const firstOpen = view.dates.find((d) => d >= view.today) ?? view.dates[view.dates.length - 1]!;
  const [selected, setSelected] = useState(initialDate && view.dates.includes(initialDate) ? initialDate : firstOpen);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<TranslationKey | null>(null);
  const day = view.days.find((d) => d.date === selected) ?? null;
  const weekHref = (w: string) => `/schedule?loc=${view.locationId}&week=${w}`;

  async function generate() {
    setBusy(true); setNotice(null);
    const r = await post("/api/schedule", { action: "generate", locationId: view.locationId, weekStart: view.weekStart, expectedHead: view.generate.expectedHead, confirmEdited: false });
    setBusy(false);
    if (!r.ok) { setNotice(scheduleErrorKey(r.code)); if (r.code === "head_moved") router.refresh(); return; }
    router.refresh();
  }

  return (
    <div className="grid min-w-0 gap-3" data-state="ready">
      <nav aria-label={t("schedule.board.week.label")} className="flex items-center justify-between gap-2">
        <Link href={weekHref(addDays(view.weekStart, -7))} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text" aria-label={t("schedule.board.week.prev")}>‹</Link>
        <span className="text-sm font-bold text-co-text">{t("schedule.board.week.of", { date: formatDateLabel(view.weekStart, language) })}</span>
        <Link href={weekHref(addDays(view.weekStart, 7))} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text" aria-label={t("schedule.board.week.next")}>›</Link>
      </nav>

      {view.banners.map((b) => (
        <p key={b.id} role="status" data-banner={b.id} className={`rounded-lg border-2 p-3 text-sm font-bold ${BANNER_TONE[b.tone]}`}>{line(b.line)}</p>
      ))}

      {view.strip ? (
        <MoneyStrip strip={view.strip} budgetLines={view.budgetLines} names={view.names} positions={view.positions}
          canSetEstimates={view.perms.canManageSwitch} locationId={view.locationId} />
      ) : view.budgetLines.length > 0 ? (
        <ul className="grid gap-1 text-sm text-co-text-muted" data-section="budget-lines">{view.budgetLines.map((l, i) => <li key={i}>{line(l)}</li>)}</ul>
      ) : null}

      {view.suggestion ? <BudgetSuggestion suggestion={view.suggestion} locationId={view.locationId} weekStart={view.weekStart} names={view.names} positions={view.positions} /> : null}

      {view.advisory.length > 0 ? (
        <section className="co-card grid gap-1 p-3" data-section="advisory">
          <h2 className="text-sm font-bold text-co-text">{t("schedule.board.advisory.title")}</h2>
          <ul className="grid gap-1 text-sm text-co-text-muted">{view.advisory.map((l, i) => <li key={i}>{line(l)}</li>)}</ul>
        </section>
      ) : null}

      {view.week ? (
        <RulesBadge fresh={view.rules.fresh} inherited={view.rules.inherited} names={view.names} positions={view.positions}
          defaultOpen={view.rules.fresh.some((p) => p.severity === "error") || view.rules.inherited.length > 0} />
      ) : (
        <p className="co-card p-4 text-sm text-co-text" data-section="no-week">{t("schedule.board.no_week")}</p>
      )}

      <DayTabs tabs={view.tabs} selected={selected} onSelect={setSelected} />

      {day ? (
        <section className="grid min-w-0 gap-2" aria-label={formatDateLabel(day.date, language)} data-day={day.date}>
          {day.notes.map((n, i) => <p key={i} className="text-sm text-co-text-muted">{line(n)}</p>)}
          <DayTimeline day={day} names={view.names} positions={view.positions} />
          {day.labor ? <LaborTargetCard labor={day.labor} names={view.names} positions={view.positions} /> : null}
          {day.gaps.length > 0 ? (
            <ul className="grid gap-2" aria-label={t("schedule.board.gap.title", { n: day.gaps.length })}>
              {day.gaps.map((g, i) => <GapRow key={i} g={g} names={view.names} positions={view.positions} />)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {view.perms.canEdit ? (
        <div className="grid gap-2">
          <button type="button" data-act={view.week ? "regenerate" : "generate"} disabled={busy || view.generate.disabled} onClick={generate}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60">
            {t(view.week ? "schedule.board.act.regenerate" : "schedule.board.act.generate")}
          </button>
          {view.generate.disabled && view.banners.some((b) => b.id === "demand_unavailable") ? <p className="text-xs text-co-text-muted">{t("schedule.board.act.disabled_demand")}</p> : null}
        </div>
      ) : null}

      {notice ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(notice)}</p> : null}
    </div>
  );
}
