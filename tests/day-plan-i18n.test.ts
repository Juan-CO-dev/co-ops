/**
 * Nav PR 5 (plan r4, 10 and 12): the day engine's words, en and es in the same PR. The 117 keys listed literally (19
 * phases, 2 names, 76 reasons, 1 empty, 11 holder/state/done/next, 8 notes); they are every day.* key; present in both,
 * non-empty, the same {params}; every _one has its _other; Spanish in tú-form; the spec 3.3.10 texts; every key the engine
 * can emit exists with exactly the placeholders the engine passes. (r3, D7) Station names travel as { en, es } per entry
 * and render in each language through the reference renderer.
 */
import { describe, expect, it } from "vitest";
import { applyLens, buildDay, EMITTED_KEYS, type DayPlan, type Reason } from "@/lib/day-plan-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { ALL_VIEWERS, forViewer, hm, PLAN_DATE } from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { NO_EVENTS, P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";
import { lateClose } from "./fixtures/day-plan/p-street-late-close";
import { renderReason } from "./fixtures/day-plan/render";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

const NEW_KEYS = {
  phases: [
    "day.phase.before_opening", "day.phase.opening_check", "day.phase.morning_prep", "day.phase.service",
    "day.phase.midday", "day.phase.night", "day.phase.closed", "day.phase.heavy_suffix", "day.phase.since.day_start",
    "day.phase.since.check_done", "day.phase.since.opening_done", "day.phase.since.service_start",
    "day.phase.since.station_closed", "day.phase.since.last_station", "day.phase.since.closing_done",
    "day.phase.since.station_usual", "day.phase.since.last_station_usual", "day.phase.since.last_station_mixed_one",
    "day.phase.since.last_station_mixed_other",
  ],
  names: [
    "day.task.catering_today", "day.task.station",
  ],
  reasons: [
    "day.reason.station.open", "day.reason.station.closed", "day.reason.station.past_due",
    "day.reason.opening.upcoming", "day.reason.opening.start", "day.reason.opening.step2",
    "day.reason.opening.urgent", "day.reason.opening.late", "day.reason.opening.urgent_heavy",
    "day.reason.opening.late_heavy", "day.reason.midday.waiting", "day.reason.midday.waiting_no_time",
    "day.reason.midday.waiting_first", "day.reason.midday.event", "day.reason.midday.late", "day.reason.midday.clock",
    "day.reason.midday.late_usual", "day.reason.closing.next", "day.reason.closing.next_no_time",
    "day.reason.closing.sections_one", "day.reason.closing.sections_other", "day.reason.closing.wrap_up",
    "day.reason.closing.past_due_one", "day.reason.closing.past_due_other", "day.reason.night.waiting",
    "day.reason.amprep.now", "day.reason.cash.now", "day.reason.pm.now", "day.reason.ordering.upcoming_one",
    "day.reason.ordering.upcoming_other", "day.reason.ordering.left_one", "day.reason.ordering.left_other",
    "day.reason.ordering.soon", "day.reason.ordering.soon_no_day", "day.reason.ordering.urgent_one",
    "day.reason.ordering.urgent_other", "day.reason.ordering.missed", "day.reason.ordering.none",
    "day.reason.ordering.tonight_one", "day.reason.ordering.tonight_other", "day.reason.ordering.done",
    "day.reason.receiving.expected_one", "day.reason.receiving.expected_other", "day.reason.receiving.half_logged",
    "day.reason.receiving.overdue", "day.reason.receiving.undated", "day.reason.receiving.none",
    "day.reason.receiving.done_one", "day.reason.receiving.done_other", "day.reason.catering.upcoming_one",
    "day.reason.catering.upcoming_other", "day.reason.catering.prep_now", "day.reason.catering.urgent",
    "day.reason.catering.late", "day.reason.catering.done", "day.reason.catering.done_mixed_one",
    "day.reason.catering.done_mixed_other", "day.reason.catering.done_untracked_one",
    "day.reason.catering.done_untracked_other", "day.reason.catering.none", "day.reason.catering.untracked_one",
    "day.reason.catering.untracked_other", "day.reason.catering.no_count_one", "day.reason.catering.no_count_other",
    "day.reason.catering.no_time_one", "day.reason.catering.no_time_other", "day.reason.catering.unavailable",
    "day.reason.heavy.today", "day.reason.heavy.today_no_time", "day.reason.heavy.flagged_one",
    "day.reason.heavy.flagged_other", "day.reason.heavy.tomorrow_one", "day.reason.heavy.tomorrow_other",
    "day.reason.count.tool", "day.reason.count.in_progress", "day.reason.own.assigned",
  ],
  empty: [
    "day.empty.crew",
  ],
  holderStateDoneNext: [
    "day.holder.mine", "day.holder.named", "day.holder.nobody", "day.holder.not_shown", "day.state.not_started",
    "day.state.in_progress", "day.state.done", "day.done.by", "day.done.at", "day.next.nothing_due",
    "day.next.closed",
  ],
  notes: [
    "day.fail.stations", "day.fail.shop_day", "day.fail.all", "day.fail.assignments", "day.fail.own_station",
    "day.note.stations_not_shown", "day.note.no_floor_stations", "day.note.default_hours",
  ],
} as const;
const ALL: string[] = Object.values(NEW_KEYS).flat();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("the day engine's keys", () => {
  it("117 keys: 19 phases, 2 names, 76 reasons, 1 empty, 11 holder/state/done/next, 8 notes; no duplicate", () => {
    expect(Object.values(NEW_KEYS).map((v) => v.length)).toEqual([19, 2, 76, 1, 11, 8]);
    expect(ALL).toHaveLength(117);
    expect(new Set(ALL).size).toBe(117);
  });

  it("they are every day.* key in both dictionaries", () => {
    expect(Object.keys(EN).filter((k) => k.startsWith("day.")).sort()).toEqual([...ALL].sort());
    expect(Object.keys(ES).filter((k) => k.startsWith("day.")).sort()).toEqual([...ALL].sort());
  });

  it.each(ALL)("%s: present in both, non-empty, the same {params}", (k) => {
    expect(EN[k]?.trim(), k).toBeTruthy();
    expect(ES[k]?.trim(), k).toBeTruthy();
    expect(placeholders(ES[k]!), k).toEqual(placeholders(EN[k]!));
  });

  it("every _one has its _other", () => {
    for (const k of ALL.filter((x) => x.endsWith("_one"))) expect(ALL, k).toContain(k.replace(/_one$/, "_other"));
  });

  it("Spanish is tú-form: no usted, no formal imperatives", () => {
    for (const k of ALL) {
      expect(ES[k], k).not.toMatch(/\busted(es)?\b/i);
      expect(ES[k], k).not.toMatch(/\b(Llene|Pida|Registre|Haga|Cuente|Termine)\b/);
    }
  });

  it("the r2 / r3 keys are present with their params", () => {
    const want: Record<string, string[]> = {
      "day.phase.since.station_usual": ["station", "time"], "day.phase.since.last_station_usual": ["station", "time"],
      "day.reason.station.past_due": ["station", "time"], "day.reason.closing.past_due_one": ["names"],
      "day.reason.closing.past_due_other": ["n", "names"], "day.reason.midday.clock": ["station", "time"],
      "day.reason.midday.late_usual": ["station", "time"], "day.phase.since.last_station_mixed_one": ["time"],
      "day.phase.since.last_station_mixed_other": ["n", "time"], "day.reason.catering.done_mixed_one": [],
      "day.reason.catering.done_mixed_other": ["n"], "day.reason.catering.done_untracked_one": [],
      "day.reason.catering.done_untracked_other": ["n"], "day.fail.own_station": [],
    };
    for (const [k, p] of Object.entries(want)) expect(placeholders(EN[k]!), k).toEqual([...p].sort());
  });

  it("the en values of the spec 3.3.10 sample keys are the spec's text", () => {
    expect(EN["day.reason.midday.waiting"]).toBe("Starts when {station} is closed (usually around {time}).");
    expect(EN["day.reason.closing.next"]).toBe("Next: {station} (usually around {time}).");
    expect(EN["day.reason.night.waiting"]).toBe("Tonight, once every station is closed.");
    expect(EN["day.reason.heavy.today"]).toBe("Heavy catering day: {guests} guests, first order out by {time}. Prep starts at {start}.");
    expect(EN["day.reason.heavy.flagged_other"]).toBe("{n} catering prep lines are flagged on Prep demand (at or over par, or no par set).");
    expect(EN["day.reason.own.assigned"]).toBe("Assigned to you.");
    expect(EN["day.empty.crew"]).toBe("Nothing is assigned to you yet. Your shift lead gives out stations and tasks.");
  });
});

describe("what the engine emits", () => {
  it("every EMITTED_KEYS entry exists, and its placeholder list equals the key's {params} in en and es", () => {
    for (const [k, params] of Object.entries(EMITTED_KEYS)) {
      expect(EN[k], k).toBeTruthy();
      expect(placeholders(EN[k]!), k).toEqual([...params].sort());
      expect(placeholders(ES[k]!), k).toEqual([...params].sort());
    }
  });

  it("over every fixture, viewer and quarter hour, each emitted reason is a listed key whose params equal its placeholders", () => {
    const seen = new Set<string>();
    const emitted = Object.keys(EMITTED_KEYS);
    const check = (r: Reason | null) => {
      if (r === null) return;
      seen.add(r.key);
      expect(emitted, r.key).toContain(r.key);
      expect(Object.keys(r.params).sort(), r.key).toEqual(placeholders(EN[r.key]!));
    };
    const fixtures = [
      (m: number) => pStreet(m), (m: number) => pStreet(m, { timeline: NO_EVENTS }), (m: number) => pStreet(m, { heavy: true }),
      (m: number) => pStreet(m, { nightBefore: true }), (m: number) => capitolHill(m), (m: number) => capitolHill(m, { events: false }),
      (m: number) => lateClose(m, { midDaySubmitted: false }),
    ];
    for (const facts of fixtures) {
      for (let m = 0; m < 1440; m += 15) {
        const f = facts(m);
        const day = buildDay(f.opening.kind === "ok" ? f.opening.value.forDate : PLAN_DATE, m, f);
        for (const v of Object.values(ALL_VIEWERS)) {
          const p: DayPlan = applyLens(day, v, forViewer(f, P_STATION_BY_USER, v.userId));
          check(p.phase.since);
          check(p.headsUp);
          check(p.empty);
          for (const n of p.notes) check(n.reason);
          for (const i of p.items) for (const r of i.reasons) check(r);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe("(r3, D7) bilingual station names", () => {
  it("two past-due stations with different translations render each language's own names; es null falls back to en", () => {
    const day = buildDay(PLAN_DATE, hm("15:45"), pStreet(hm("15:45"), { timeline: NO_EVENTS }));
    const pastDue = day.closing.reasons.find((r) => r.key === "day.reason.closing.past_due_other")!;
    expect(renderReason(pastDue, "en", EN)).toBe("2 stations are past their usual close: Crunchy Boi Station, 3rd Party Station.");
    expect(renderReason(pastDue, "es", ES)).toBe("2 estaciones pasaron su hora normal de cierre: Estación Crunchy Boi, Estación de terceros.");
    const next = day.closing.reasons.find((r) => r.key === "day.reason.closing.next")!;
    expect(renderReason(next, "en", EN)).toBe("Next: Walk Ins Station (usually around 8:00 PM).");
    expect(renderReason(next, "es", ES)).toMatch(/^Sigue: Walk Ins Station \(normalmente a eso de las 8:00/);
  });

  it("the usual time renders through formatClockTime, display only", () => {
    const f = forViewer(pStreet(hm("13:35")), P_STATION_BY_USER, ALL_VIEWERS.ROSA.userId);
    const card = applyLens(buildDay(PLAN_DATE, hm("13:35"), f), ALL_VIEWERS.ROSA, f).items.find((i) => i.id === "station")!;
    expect(renderReason(card.reasons[0]!, "en", EN)).toBe("Crunchy Boi Station usually closes by 1:30 PM. Mark it closed when it's done.");
    expect(renderReason(card.reasons[0]!, "es", ES)).toMatch(/^Estación Crunchy Boi normalmente cierra a las 1:30/);
  });
});
