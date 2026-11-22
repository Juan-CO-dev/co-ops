/**
 * Nav PR 7: render the Dashboard's day components to static HTML and read them back (rows in DOM order, visible text,
 * links). Plain createElement: the test files are .ts.
 */
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayList } from "@/components/dashboard/DayList";
import { PhaseLine } from "@/components/dashboard/PhaseLine";
import { YesterdayUnconfirmedAlert } from "@/components/dashboard/YesterdayUnconfirmedAlert";
import type { DayPlan } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import type { Language } from "@/lib/i18n/types";

export function decode(s: string): string {
  return s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/").replace(/&amp;/g, "&");
}
/** The visible text, tags dropped, entities decoded, whitespace collapsed. */
export function text(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
export interface RenderedRow { id: string; variant: string; band: string; html: string; text: string; links: RenderedLink[] }
export interface RenderedLink { href: string; text: string; action: string | null; aria: string | null }
export function links(html: string): RenderedLink[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
    const attr = (name: string) => { const a = m[1]!.match(new RegExp(`\\b${name}="([^"]*)"`)); return a ? decode(a[1]!) : null; };
    return { href: attr("href") ?? "", text: text(m[2]!), action: attr("data-action"), aria: attr("aria-label") };
  });
}
export function rows(html: string): RenderedRow[] {
  return [...html.matchAll(/<article\b[^>]*data-day-item="([^"]+)"[^>]*data-variant="([^"]+)"[^>]*data-band="([^"]+)"[^>]*>[\s\S]*?<\/article>/g)]
    .map((m) => ({ id: m[1]!, variant: m[2]!, band: m[3]!, html: m[0], text: text(m[0]), links: links(m[0]) }));
}

/** The page's day section as the Dashboard draws it: the phase line, the alerts, the notes, the day list. */
export function renderDay(plan: DayPlan, opts: { shopId: string; language: Language; editHref?: string }): string {
  const { shopId, language, editHref } = opts;
  return renderToStaticMarkup(createElement(Fragment, null,
    createElement(PhaseLine, { plan, language }),
    ...plan.alerts.map((a) => createElement(YesterdayUnconfirmedAlert, { key: a.date, location: { id: shopId, code: a.shopCode }, yesterdayDate: a.date, language })),
    ...plan.notes.map((n, i) => createElement("p", { key: `n${i}`, role: "status", "data-note": n.reason.key }, renderDayReason(n.reason, language))),
    createElement(DayList, { plan, shopId, language, editHref }),
  ));
}
