/**
 * The catering manager's block (nav PR 8, plan r2 2.5; spec r5 3.6, 3.3.4, 3.3.11; lead rulings r1 A6, Q4, Q5; r2 B1).
 * Server component. Drawn ONLY from the engine's `placement: "block"` item (the lens gives it to the catering manager on
 * the catering item it kept, which exists only where the viewer holds `catering`), first on the page after the alerts.
 *
 * - The engine's own row: the band, the "Next up" badge when Next up is this item (never under the aggregate failure), and
 *   the item's reasons (the urgent / prep-window lines, the untracked line).
 * - The heavy-day lines and the night-before line, drawn here ONCE (the page then leaves the night-before line out of the
 *   phase line, Q5).
 * - Today's orders in the block's own order, each with its state; an untracked ezCater order is "not tracked here",
 *   never an "out" state (3.3.4).
 * - Tomorrow, inbox waiting, and the orders the reconciliation lists as not rung in Toast. A clear list is said ONLY in
 *   words scoped to that list ("No orders are waiting to be rung in Toast"), never "every order is in Toast" (B1), and
 *   for ezCater alone while house orders are not checked (A6).
 * No money, no names, no order numbers.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { InboxWaiting, NotRungScoped } from "@/lib/dashboard-blocks";
import type { Settled } from "@/lib/dashboard-day";
import { itemHref } from "@/lib/dashboard-day-shared";
import type { CateringBlockOrder, CateringBlockPlan, DayItem, HeavyTodayLines, Reason } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { formatClockTime, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (min: number, language: Language) => formatClockTime(`${pad(Math.floor(min / 60))}:${pad(min % 60)}`, language);

/** One order's state, in words. `not_tracked` has its own words and reaches no "out" key. */
export function orderStateText(o: Pick<CateringBlockOrder, "state" | "outAt">, language: Language): string {
  switch (o.state) {
    case "to_go_out": return serverT(language, "dashboard.catering_block.state.to_go_out");
    case "out": return o.outAt
      ? serverT(language, "dashboard.catering_block.state.out", { time: formatTime(o.outAt, language) })
      : serverT(language, "dashboard.catering_block.state.out_no_time");
    case "completed": return serverT(language, "dashboard.catering_block.state.completed");
    case "not_tracked": return serverT(language, "dashboard.catering_block.state.not_tracked");
  }
}

/** The not-rung line(s) from the scoped read (A6, B1). */
export function notRungLines(r: NotRungScoped): TranslationKey[] {
  const lines: TranslationKey[] = [];
  if (r.count === 1) lines.push("dashboard.catering_block.not_rung_one");
  else if (r.count > 1) lines.push("dashboard.catering_block.not_rung_other");
  else lines.push(r.house === "on" ? "dashboard.catering_block.not_rung_none" : "dashboard.catering_block.not_rung_none_ezcater");
  if (r.house !== "on") lines.push("dashboard.catering_block.house_not_checked");
  return lines;
}

const Muted = ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => <p className="text-sm text-co-text-muted" {...rest}>{children}</p>;

export function CateringBlock({ item, block, heavyToday, headsUp, extras, nextUp, shopId, language }: {
  item: DayItem;
  block: CateringBlockPlan;
  heavyToday: HeavyTodayLines | null;
  headsUp: Reason | null;
  /** null = not read (the page did not start them). */
  extras: { inbox: Settled<InboxWaiting>; notRung: Settled<NotRungScoped> } | null;
  nextUp: boolean;
  shopId: string;
  language: Language;
}) {
  const t = (k: TranslationKey, v?: Record<string, string | number>) => serverT(language, k, v);
  const unavailable = (name: TranslationKey) => t("dashboard.needs_you.unavailable", { name: t(name) });
  const badge = item.band === "urgent" ? t("dashboard.day.band.urgent") : item.band === "now" ? t("dashboard.day.band.now") : null;
  const heavy = [heavyToday?.heavy, heavyToday?.flagged, headsUp].filter((r): r is Reason => r != null);
  return (
    <section
      aria-label={t("dashboard.catering_block.aria")}
      data-catering-block
      data-band={item.band}
      className={["co-card flex min-w-0 flex-col gap-3 p-5 sm:p-6", item.band === "urgent" ? "border-2 border-co-cta" : ""].join(" ")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {nextUp ? (
          <span data-next-up-badge className="inline-flex items-center rounded-full bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text">
            {t("dashboard.day.next_up")}
          </span>
        ) : null}
        {badge ? (
          <span className="inline-flex items-center rounded-full bg-co-surface-inset px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">{badge}</span>
        ) : null}
      </div>
      <Link href={itemHref(item, shopId)} className="inline-flex min-h-[44px] min-w-0 items-center break-words text-xl font-bold text-co-text underline-offset-2 hover:underline">
        {t("day.task.catering_today")}
      </Link>
      {item.reasons.map((r, i) => <p key={`r:${r.key}:${i}`} className="text-sm text-co-text">{renderDayReason(r, language)}</p>)}
      {heavy.map((r, i) => <p key={`h:${r.key}:${i}`} className="text-sm font-semibold text-co-text" data-heavy-line={r.key}>{renderDayReason(r, language)}</p>)}

      {block.today === "unknown" ? (
        <Muted data-orders="unknown">{t("day.reason.catering.unavailable")}</Muted>
      ) : block.today.length === 0 ? (
        <Muted data-orders="none">{t("day.reason.catering.none")}</Muted>
      ) : (
        <ul className="flex flex-col gap-1" data-orders="list">
          {block.today.map((o) => (
            <li key={o.id} data-order-state={o.state} className="flex min-w-0 flex-wrap gap-x-2 text-sm text-co-text">
              <span className="font-semibold tabular-nums">{o.eventQ !== null ? clock(o.eventQ * 15, language) : t("dashboard.catering_block.no_time")}</span>
              <span>·</span>
              <span>{o.guests === null ? t("dashboard.catering_block.no_count") : o.guests === 1 ? t("dashboard.catering_block.guests_one") : t("dashboard.catering_block.guests_other", { n: o.guests })}</span>
              <span>·</span>
              <span>{orderStateText(o, language)}</span>
            </li>
          ))}
        </ul>
      )}
      {block.next ? <p className="text-sm text-co-text" data-next-order>{t("dashboard.catering_block.next", { time: clock(block.next.atMin, language) })}</p> : null}

      <Muted data-tomorrow>
        {block.tomorrow === "unknown" ? unavailable("dashboard.catering_block.tomorrow")
          : block.tomorrow.orders === 0 ? t("dashboard.catering_block.tomorrow_none")
            : block.tomorrow.orders === 1 ? t("dashboard.catering_block.tomorrow_one", { guests: block.tomorrow.guests })
              : t("dashboard.catering_block.tomorrow_other", { n: block.tomorrow.orders, guests: block.tomorrow.guests })}
      </Muted>

      {extras ? (
        <div className="flex flex-col gap-1">
          {extras.inbox.kind !== "ok" ? <Muted data-inbox="failed">{unavailable("catering.inbox.title")}</Muted> : (
            <Link href="/catering/inbox" data-inbox="ok" className="flex min-h-[44px] min-w-0 items-center text-sm text-co-text underline-offset-2 hover:underline"><span className="flex min-w-0 flex-col">
              {extras.inbox.value.shop === 0 && !extras.inbox.value.unplaced ? <span>{t("dashboard.catering_block.inbox_none")}</span> : null}
              {extras.inbox.value.shop > 0 ? <span>{extras.inbox.value.shop === 1 ? t("dashboard.catering_block.inbox_one") : t("dashboard.catering_block.inbox_other", { n: extras.inbox.value.shop })}</span> : null}
              {extras.inbox.value.unplaced ? <span>{t("dashboard.catering_block.inbox_unplaced", { n: extras.inbox.value.unplaced })}</span> : null}
            </span></Link>
          )}
          {extras.notRung.kind !== "ok" ? <Muted data-not-rung="failed">{unavailable("catering.toast_link.status.not_rung_in_toast")}</Muted> : (
            <div data-not-rung={extras.notRung.value.house} className="flex flex-col gap-1 text-sm text-co-text">
              {notRungLines(extras.notRung.value).map((k) => (k === "dashboard.catering_block.not_rung_one" || k === "dashboard.catering_block.not_rung_other"
                ? <Link key={k} href="/catering/pipeline" className="inline-flex min-h-[44px] items-center underline-offset-2 hover:underline">{t(k, { n: extras.notRung.kind === "ok" ? extras.notRung.value.count : 0 })}</Link>
                : <p key={k} className={k === "dashboard.catering_block.house_not_checked" ? "text-co-text-muted" : ""}>{t(k)}</p>))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
