/**
 * The reference renderer (plan r4, 11.6): fills a reason's {params} the way PR 7 must, so PR 5's tests can assert what a
 * viewer would read, in both languages, without any UI. PR 7's renderer is pinned equal to it.
 *
 * `name` → es ?? en in Spanish, en in English; `names` → the same per entry, joined with ", "; `usual` → formatClockTime
 * of v.wall (display only, never parsed for logic); `wall` → formatClockTime of the minutes; `instant` → formatTime;
 * `day` → formatWeekday; `count` → the number; `key` → the dictionary value.
 */
import type { Reason, ReasonParam } from "@/lib/day-plan-shared";
import { formatClockTime, formatTime, formatWeekday } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";

export type Dictionary = Readonly<Record<string, string>>;

const pad = (n: number) => String(n).padStart(2, "0");

function renderParam(p: ReasonParam, language: Language, dict: Dictionary): string {
  switch (p.t) {
    case "name": return language === "es" ? (p.es ?? p.en) : p.en;
    case "names": return p.v.map((n) => (language === "es" ? (n.es ?? n.en) : n.en)).join(", ");
    case "usual": return formatClockTime(p.v.wall, language);
    case "wall": return formatClockTime(`${pad(Math.floor(p.min / 60))}:${pad(p.min % 60)}`, language);
    case "instant": return formatTime(p.iso, language);
    case "day": return formatWeekday(p.ymd, language);
    case "count": return String(p.v);
    case "key": return dict[p.key] ?? p.key;
  }
}

export function renderReason(reason: Reason, language: Language, dict: Dictionary): string {
  const template = dict[reason.key] ?? reason.key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const p = reason.params[name];
    return p === undefined ? whole : renderParam(p, language, dict);
  });
}
