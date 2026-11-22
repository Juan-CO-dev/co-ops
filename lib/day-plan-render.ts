/**
 * The day engine's renderer (nav PR 7, plan r2 2.9; PR 5 section 19 item 4): fills a Reason's typed parameters the way the
 * reference renderer does (tests/fixtures/day-plan/render.ts), then translates. Every reason, phase "since", heads-up and
 * note on the Dashboard is rendered here and nowhere else (tests/day-plan-render.test.ts pins it equal to the reference).
 *
 * `name` → es ?? en in Spanish, en in English; `names` → the same per entry, joined ", "; `usual` → formatClockTime of the
 * opaque wall time (DISPLAY only, never parsed for logic); `wall` → formatClockTime of the minutes; `instant` → formatTime;
 * `day` → formatWeekday; `count` → the number; `key` → the dictionary value.
 */
import type { Reason, ReasonParam } from "@/lib/day-plan-shared";
import { formatClockTime, formatTime, formatWeekday } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

const pad = (n: number) => String(n).padStart(2, "0");

function renderParam(p: ReasonParam, language: Language): string {
  switch (p.t) {
    case "name": return language === "es" ? (p.es ?? p.en) : p.en;
    case "names": return p.v.map((n) => (language === "es" ? (n.es ?? n.en) : n.en)).join(", ");
    case "usual": return formatClockTime(p.v.wall, language);
    case "wall": return formatClockTime(`${pad(Math.floor(p.min / 60))}:${pad(p.min % 60)}`, language);
    case "instant": return formatTime(p.iso, language);
    case "day": return formatWeekday(p.ymd, language);
    case "count": return String(p.v);
    case "key": return serverT(language, p.key);
  }
}

export function renderDayReason(reason: Reason, language: Language): string {
  const params = Object.fromEntries(Object.entries(reason.params).map(([k, v]) => [k, renderParam(v, language)]));
  return serverT(language, reason.key, params);
}
