"use client";
/**
 * THE THREE-WAY RECONCILIATION (Scheduling Phase 2, Task 25; spec §8.0) — per the disclosure doctrine:
 *  - one SUMMARY ROW per person (the anchor is the CO-OPS user): the name, the three ticks (CO-OPS · Toast · 7shifts) and
 *    how many things there are to look at — identity and alerts always visible; a full-row 44 px toggle opens the drawer;
 *  - the drawer: what to look at (each flag, named), the day by day comparison with its BASIS ("Against the published
 *    7shifts schedule" / "Against the CO-OPS proposal (not published)") and its missing evidence, the hours each source
 *    reports, and the actions — deep links to the existing link screens. This view writes nothing;
 *  - two more sections, collapsed with their counts: Toast clock-ins with no CO-OPS person (first name only) and 7shifts
 *    people not linked (display name + employee number).
 * useState only (D9). Every string en + es (tú). Phone-first at 375 px: one column, rows wrap, no sideways scroll.
 */
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ReconcileDay, ReconcileFlag, ReconcileRow, ReconcileView, SevenStatus } from "@/lib/scheduling/reconcile-shared";

export interface ReconcilePageView {
  locationId: string;
  today: string;
  dates: string[];
  sevenStatus: SevenStatus;
  shopLinkedToSeven: boolean;
  toastLinksAvailable: boolean;
  proposalAvailable: boolean;
  view: ReconcileView;
  links: { toast: string; seven: string };
}

const LINK_CLASS = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm font-bold text-co-text";

function Disclosure({ id, title, count, initialOpen, children }: { id: string; title: string; count: string | null; initialOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const panel = useId();
  return (
    <section className="co-card" data-section={id}>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 text-left">
        <span className="text-base font-bold text-co-text">{title}{count ? <span className="ml-2 text-xs font-bold text-co-warning-text">{count}</span> : null}</span>
        <span aria-hidden="true" className="text-co-text-dim">{open ? "⌃" : "⌄"}</span>
      </button>
      <div id={panel} hidden={!open} className="grid gap-2 px-4 pb-4">{children}</div>
    </section>
  );
}

export function ReconcileList({ page, initialOpen = false }: { page: ReconcilePageView; initialOpen?: boolean }) {
  const { t, language } = useTranslation();
  const v = page.view;
  const flagText = (f: ReconcileFlag) => {
    const p = f.params ?? {};
    const time = (iso: unknown) => (typeof iso === "string" ? formatTime(iso, language) : "");
    return t(`schedule.reconcile.flag.${f.code}` as TranslationKey, {
      date: f.date ? formatDateLabel(f.date, language) : "",
      startAt: time(p.startAt), endAt: time(p.endAt), inAt: time(p.inAt),
      toastHours: p.toastHours ?? "", sevenHours: p.sevenHours ?? "", days: p.days ?? "",
    });
  };
  const sevenNote: TranslationKey | null = page.sevenStatus !== "ready" ? `schedule.reconcile.seven_state.${page.sevenStatus}` as TranslationKey
    : !page.shopLinkedToSeven ? "schedule.reconcile.seven_state.shop_not_linked" : null;
  const clear = v.counts.flagged === 0 && v.counts.toastUnlinked === 0 && v.counts.sevenUnlinked === 0;
  return (
    <div className="grid min-w-0 gap-3" data-state="reconcile">
      <p className="text-sm text-co-text-muted">{t("schedule.reconcile.window", { from: formatDateLabel(page.dates[0]!, language), to: formatDateLabel(page.dates[page.dates.length - 1]!, language) })}</p>
      {sevenNote ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface-inset p-3 text-sm text-co-text">{t(sevenNote)}</p> : null}
      {!page.toastLinksAvailable ? <p role="status" className="rounded-lg border-2 border-co-warning bg-co-warning-surface p-3 text-sm font-bold text-co-warning-text">{t("schedule.reconcile.toast_links_unavailable")}</p> : null}
      {!page.proposalAvailable ? <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface-inset p-3 text-sm text-co-text">{t("schedule.reconcile.proposal_unavailable")}</p> : null}
      {clear ? <p role="status" className="co-card p-4 text-sm font-bold text-co-confirm-text">{t("schedule.reconcile.all_clear")}</p> : null}

      <section className="grid gap-2" data-section="people" aria-label={t("schedule.reconcile.section.people", { n: v.counts.people })}>
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-bold text-co-text">
          {t("schedule.reconcile.section.people", { n: v.counts.people })}
          {v.counts.flagged > 0 ? <span className="text-xs font-bold text-co-warning-text">{t("schedule.reconcile.section.people_flagged", { n: v.counts.flagged })}</span> : null}
        </h2>
        {v.rows.map((r) => <PersonRow key={r.userId} row={r} page={page} initialOpen={initialOpen} flagText={flagText} />)}
      </section>

      <Disclosure id="toast-unlinked" title={t("schedule.reconcile.section.toast", { n: v.counts.toastUnlinked })} initialOpen={initialOpen}
        count={null}>
        {v.toastUnlinked.map((u) => (
          <div key={u.employeeGuid} className="grid gap-1 rounded-lg border border-co-border bg-co-surface-inset p-3" data-toast-employee={u.employeeGuid}>
            <span className="font-bold text-co-text">{u.firstName ?? "—"}</span>
            <span className="text-sm text-co-warning-text">{t("schedule.reconcile.flag.toast_clockin_no_user", { days: u.punchDays })}</span>
            <Link href={page.links.toast} className={`${LINK_CLASS} justify-self-start`}>{t("schedule.reconcile.action.link_toast")}</Link>
          </div>
        ))}
      </Disclosure>

      <Disclosure id="seven-unlinked" title={t("schedule.reconcile.section.seven", { n: v.counts.sevenUnlinked })} initialOpen={initialOpen} count={null}>
        {v.sevenUnlinked.map((u) => (
          <div key={u.sevenUserId} className="grid gap-1 rounded-lg border border-co-border bg-co-surface-inset p-3" data-seven-user={u.sevenUserId}>
            <span className="font-bold text-co-text">{u.displayName}{u.employeeId ? <span className="ml-2 text-xs text-co-text-muted">{t("schedule.reconcile.employee_id", { id: u.employeeId })}</span> : null}</span>
            <span className="text-sm text-co-warning-text">{t("schedule.reconcile.flag.seven_user_unlinked")}</span>
            <Link href={page.links.seven} className={`${LINK_CLASS} justify-self-start`}>{t("schedule.reconcile.action.link_seven")}</Link>
          </div>
        ))}
      </Disclosure>
    </div>
  );
}

function Tick({ source, state }: { source: "coops" | "toast" | "seven"; state: "linked" | "missing" | "not_connected" }) {
  const { t } = useTranslation();
  const label = t("schedule.reconcile.tick.label", { source: t(`schedule.reconcile.tick.${source}` as TranslationKey), state: t(`schedule.reconcile.tick.${state}` as TranslationKey) });
  const tone = state === "linked" ? "border-co-border text-co-confirm-text" : state === "missing" ? "border-co-warning text-co-warning-text" : "border-co-border text-co-text-muted";
  return (
    <span data-tick={source} data-state={state} aria-label={label} className={`inline-flex items-center gap-1 rounded-full border px-2 text-xs font-bold ${tone}`}>
      <span aria-hidden="true">{state === "linked" ? "✓" : state === "missing" ? "✗" : "–"}</span>
      {t(`schedule.reconcile.tick.${source}` as TranslationKey)}
      {state === "not_connected" ? <span className="font-normal">· {t("schedule.reconcile.tick.not_connected")}</span> : null}
    </span>
  );
}

function PersonRow({ row, page, initialOpen, flagText }: { row: ReconcileRow; page: ReconcilePageView; initialOpen: boolean; flagText: (f: ReconcileFlag) => string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initialOpen);
  const panel = useId();
  const identity = row.flags.filter((f) => !f.date);
  return (
    <div className="co-card" data-person-row={row.userId}>
      <button type="button" data-person={row.userId} aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}
        className="grid min-h-[44px] w-full items-center gap-1 px-4 py-2 text-left">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-co-text">{row.name}</span>
          {row.flags.length > 0
            ? <span className="text-xs font-bold text-co-warning-text">{t("schedule.reconcile.row.to_look_at", { n: row.flags.length })}</span>
            : <span className="text-xs font-bold text-co-confirm-text">{t("schedule.reconcile.row.all_good")}</span>}
        </span>
        <span className="flex flex-wrap gap-1">
          <Tick source="coops" state="linked" />
          <Tick source="toast" state={row.ticks.toast} />
          <Tick source="seven" state={row.ticks.seven} />
        </span>
      </button>
      <div id={panel} hidden={!open} className="grid gap-2 px-4 pb-4">
        {identity.length > 0 ? (
          <ul className="grid gap-1 text-sm text-co-warning-text">
            {identity.map((f, i) => <li key={i}>{flagText(f)}</li>)}
          </ul>
        ) : null}
        {row.ticks.toast === "missing" || row.ticks.seven === "missing" ? (
          <div className="flex flex-wrap gap-2">
            {row.ticks.toast === "missing" ? <Link href={page.links.toast} className={LINK_CLASS}>{t("schedule.reconcile.action.link_toast")}</Link> : null}
            {row.ticks.seven === "missing" ? <Link href={page.links.seven} className={LINK_CLASS}>{t("schedule.reconcile.action.link_seven")}</Link> : null}
          </div>
        ) : null}
        {row.days.length === 0 ? <p className="text-sm text-co-text-muted">{t("schedule.reconcile.row.no_days")}</p> : null}
        {row.days.map((d) => <DayBlock key={d.date} day={d} flagText={flagText} />)}
      </div>
    </div>
  );
}

function DayBlock({ day, flagText }: { day: ReconcileDay; flagText: (f: ReconcileFlag) => string }) {
  const { t, language } = useTranslation();
  const hours = (h: number | null) => (h === null ? t("schedule.reconcile.day.none") : `${h} h`);
  return (
    <div className="grid gap-1 rounded-lg border border-co-border bg-co-surface-inset p-3" data-day={day.date} data-basis={day.basis}>
      <span className="text-sm font-bold text-co-text">{formatDateLabel(day.date, language)}</span>
      <span className="text-xs font-bold tracking-wide text-co-text-muted">{t(day.basis === "published" ? "schedule.reconcile.basis.published" : "schedule.reconcile.basis.proposal")}</span>
      {day.missing ? <span className="text-xs text-co-text-muted">{t(`schedule.reconcile.missing.${day.missing}` as TranslationKey, { date: formatDateLabel(day.date, language) })}</span> : null}
      <span className="text-xs text-co-text-muted">{t("schedule.reconcile.day.hours", { toast: hours(day.toastHours), seven: hours(day.sevenHours) })}</span>
      {day.flags.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {day.flags.map((f, i) => <li key={i} data-flag={f.code} className={f.code === "proposal_differs" ? "text-co-text" : "font-bold text-co-warning-text"}>{flagText(f)}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
