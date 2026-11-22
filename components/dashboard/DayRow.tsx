/**
 * One day item (nav PR 7, plan r2 2.4). Server component: no client JS, no data, no clock, no env.
 *
 * - The name links to the item's page for EVERY listed item (Q1): the lens already removed what the viewer may not open.
 * - The explicit actions are exactly the engine's (`item.actions`): "Do it" to the item's page, "Assign" to Team today.
 *   A task someone else holds has none; "Assign" never appears without `ops` (the engine's rule).
 * - The ONE page-level action is the AM prep submitter's "Edit" (Q2 carve-out, C.46 A2): only on the `am_prep` row, only
 *   when it is done and the page passed `editHref`. The AM prep page's own gate decides whether edit mode opens.
 * - Reasons render only through renderDayReason.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ActionLink } from "@/components/ActionButton";
import { ASSIGN_HREF, itemHref, itemNameKey } from "@/lib/dashboard-day-shared";
import type { DayItem, StationState } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { formatClockTime, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

export type DayRowVariant = "row" | "compact-pin" | "full" | "next";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (min: number, language: Language) => formatClockTime(`${pad(Math.floor(min / 60))}:${pad(min % 60)}`, language);

/** The row's visible name: a station card is titled by its station (the Spanish name in Spanish), else its item name. */
export function dayItemName(item: DayItem, stations: readonly StationState[], language: Language): string {
  if (item.id === "station") {
    const s = item.section ? stations.find((x) => x.name === item.section) : undefined;
    if (!item.section) return serverT(language, "day.task.station");
    const name = language === "es" ? (s?.nameEs || item.section) : item.section;
    return serverT(language, "assignments.stationCard", { station: name });
  }
  const key = itemNameKey(item);
  return key ? serverT(language, key) : item.id;
}

function holderLine(item: DayItem, language: Language): string | null {
  switch (item.holder.kind) {
    case "mine": return serverT(language, "day.holder.mine");
    case "named": return serverT(language, "day.holder.named", { name: item.holder.firstName });
    case "nobody": return serverT(language, "day.holder.nobody");
    case "not_shown": return serverT(language, "day.holder.not_shown");
    case "unknown": return serverT(language, "dashboard.day.holder_unknown");
    case "none": return null;
  }
}

function doneLine(item: DayItem, language: Language): string | null {
  const d = item.done;
  if (!d) return null;
  if (d.autoFinalized) return serverT(language, "reports.status.auto_finalized");
  if (d.byName && d.at) return serverT(language, "day.done.by", { name: d.byName, time: formatTime(d.at, language) });
  if (d.at) return serverT(language, "day.done.at", { time: formatTime(d.at, language) });
  return null;
}

function stateLine(item: DayItem, language: Language): string | null {
  if (item.state === "unknown") return serverT(language, "dashboard.tile.unavailable");
  if (item.state === "in_progress") return serverT(language, "day.state.in_progress");
  return null;
}

export function DayRow({ item, shopId, stations, variant, language, editHref, children }: {
  item: DayItem;
  shopId: string;
  stations: readonly StationState[];
  variant: DayRowVariant;
  language: Language;
  /** The AM prep submitter's Edit (C.46 A2): passed by the page only for the submitter. */
  editHref?: string;
  /** The own Receiving / Counts tile, drawn under its own row only. */
  children?: ReactNode;
}) {
  const name = dayItemName(item, stations, language);
  const href = itemHref(item, shopId);
  const timed = item.at !== null && (item.band === "urgent" || item.band === "now" || item.band === "upcoming");
  const badge = item.band === "urgent" ? serverT(language, "dashboard.day.band.urgent") : item.band === "now" ? serverT(language, "dashboard.day.band.now") : null;
  const holder = holderLine(item, language);
  const done = doneLine(item, language);
  const state = stateLine(item, language);
  const showEdit = item.id === "am_prep" && item.state === "done" && editHref !== undefined;
  const big = variant === "full" || variant === "next";
  return (
    <article
      data-day-item={item.id}
      data-variant={variant}
      data-band={item.band}
      className={[
        "co-card flex min-w-0 flex-col gap-2",
        big ? "p-5 sm:p-6" : variant === "compact-pin" ? "px-4 py-3" : "p-4",
        item.band === "urgent" ? "border-2 border-co-cta" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {badge ? (
          <span className="inline-flex items-center rounded-full bg-co-surface-inset px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {badge}
          </span>
        ) : null}
        {timed ? <span className="text-sm font-semibold text-co-text-muted">{clock(item.at!, language)}</span> : null}
      </div>
      <Link href={href} className={["min-w-0 break-words font-bold text-co-text underline-offset-2 hover:underline", big ? "text-xl" : "text-base"].join(" ")}>
        {name}
      </Link>
      {state ? <p className="text-sm text-co-text-muted">{state}</p> : null}
      {holder ? <p className="text-sm text-co-text-muted" data-holder={item.holder.kind}>{holder}</p> : null}
      {done ? <p className="text-sm text-co-text-muted">{done}</p> : null}
      {item.reasons.map((r, i) => (
        <p key={`${r.key}:${i}`} className="text-sm text-co-text">{renderDayReason(r, language)}</p>
      ))}
      {item.actions.length > 0 || showEdit ? (
        <div className="flex flex-wrap gap-2">
          {item.actions.includes("do") ? (
            <ActionLink href={href} variant={big ? "primary" : "secondary"} aria-label={serverT(language, "dashboard.day.action.do_aria", { task: name })} data-action="do">
              {serverT(language, "dashboard.day.action.do")}
            </ActionLink>
          ) : null}
          {item.actions.includes("assign") ? (
            <ActionLink href={ASSIGN_HREF(shopId)} variant="secondary" aria-label={serverT(language, "dashboard.day.action.assign_aria", { task: name })} data-action="assign">
              {serverT(language, "dashboard.day.action.assign")}
            </ActionLink>
          ) : null}
          {showEdit ? (
            <ActionLink href={editHref!} variant="secondary" aria-label={serverT(language, "dashboard.day.action.edit_aria", { task: name })} data-action="edit">
              {serverT(language, "dashboard.day.action.edit")}
            </ActionLink>
          ) : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}
