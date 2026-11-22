/**
 * Nav PR 7 (plan r2 T2; PR 5 section 19 item 4): the Dashboard's renderer, `renderDayReason`, fills every reason exactly
 * as the reference renderer (tests/fixtures/day-plan/render.ts) does, in English and Spanish, over a sweep of real plans:
 * every viewer, 05:00 to 24:00 every 15 minutes, on the normal day, the heavy day with its earlier opening, Capitol Hill,
 * the live late close and the midnight (group 15) fixture.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planDay, type DayPlan, type Reason, type ShopFacts } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { ALL_VIEWERS, forViewer, PLAN_DATE } from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { lateClose } from "./fixtures/day-plan/p-street-late-close";
import { P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";
import { D1, earlyNextDay } from "./fixtures/day-plan/plan-date";
import { renderReason } from "./fixtures/day-plan/render";

const DICT = { en: en as Record<string, string>, es: es as Record<string, string> };
const minutes = Array.from({ length: (24 * 60 - 5 * 60) / 15 + 1 }, (_, i) => Math.min(5 * 60 + i * 15, 1439));
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Every reason a plan carries: items, the phase's "since", the heads-up, the notes, and the empty line. */
function reasonsOf(p: DayPlan): Reason[] {
  return [...p.items.flatMap((i) => i.reasons), ...(p.phase.since ? [p.phase.since] : []), ...(p.headsUp ? [p.headsUp] : []),
    ...p.notes.map((n) => n.reason), ...(p.empty ? [p.empty] : [])];
}

const SCENARIOS: Array<[string, string, (min: number) => ShopFacts]> = [
  ["normal", PLAN_DATE, (m) => pStreet(m)],
  ["heavy + opening", PLAN_DATE, (m) => pStreet(m, { heavy: true, opening: true })],
  ["night before heavy", "2026-11-17", (m) => pStreet(m, { nightBefore: true, opening: true })],
  ["Capitol Hill", PLAN_DATE, (m) => capitolHill(m)],
  ["late close", PLAN_DATE, (m) => lateClose(m)],
  ["midnight (group 15)", D1, (m) => earlyNextDay(fmt(Math.min(m, 1439)), "open", { kind: "another_day", stationDate: PLAN_DATE }, true)],
];

describe("renderDayReason === the reference renderer", () => {
  it.each(SCENARIOS)("%s: every reason of every viewer at every quarter, en and es", (_name, planDate, facts) => {
    let checked = 0;
    const keys = new Set<string>();
    for (const min of minutes) {
      const base = facts(min);
      for (const v of Object.values(ALL_VIEWERS)) {
        const p = planDay({ planDate, nowMin: min, viewer: v, facts: forViewer(base, P_STATION_BY_USER, v.userId) });
        if (p.kind !== "shop") throw new Error("shop plan expected");
        for (const r of reasonsOf(p)) {
          for (const lang of ["en", "es"] as const) {
            expect(renderDayReason(r, lang), `${min} ${v.userId} ${r.key} ${lang}`).toBe(renderReason(r, lang, DICT[lang]));
          }
          keys.add(r.key);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(keys.size).toBeGreaterThan(1);
  });

  it("two stations with different Spanish names render each in its own language, never a raw param", () => {
    const r: Reason = { key: "day.reason.closing.past_due_other", params: {
      n: { t: "count", v: 2 }, names: { t: "names", v: [{ en: "Crunchy Boi Station", es: "Estación Crunchy Boi" }, { en: "Walk Ins Station", es: null }] } } };
    expect(renderDayReason(r, "en")).toBe(renderReason(r, "en", DICT.en));
    expect(renderDayReason(r, "es")).toBe(renderReason(r, "es", DICT.es));
    expect(renderDayReason(r, "es")).toContain("Estación Crunchy Boi, Walk Ins Station");
    expect(renderDayReason(r, "en")).toContain("Crunchy Boi Station, Walk Ins Station");
    for (const lang of ["en", "es"] as const) expect(renderDayReason(r, lang)).not.toMatch(/\{\w+\}/);
  });

  it("source pin: the opaque usual time is read only as formatClockTime's argument (display, never parsed)", () => {
    const src = readFileSync("lib/day-plan-render.ts", "utf8");
    const uses = [...src.matchAll(/\.wall\b/g)];
    expect(uses).toHaveLength(1);
    expect(src).toContain('case "usual": return formatClockTime(p.v.wall, language);');
    // Types only from the engine: the renderer never calls into it.
    expect(src).toMatch(/import type \{[^}]*\} from "@\/lib\/day-plan-shared";/);
    expect(src).not.toMatch(/import \{[^}]*\} from "@\/lib\/day-plan-shared";/);
  });
});
