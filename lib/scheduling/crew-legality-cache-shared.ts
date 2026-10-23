import type { DayContext, RulePerson } from "./context-shared";
import { legalHoldPath, modCountsOn, type HoldPath } from "./people-rules-shared";

/** Build-local only: people, structure and catering inputs stay fixed while allocations change.
 * Never cache allocation-dependent checks (hours, budgets, station occupancy or certificates). */
export function crewLegalityCache() {
  type Quarters = { holds: Map<string, Map<number, HoldPath | null>>; mod: Map<number, boolean> };
  const people = new WeakMap<RulePerson, WeakMap<DayContext, Map<string, Quarters>>>();
  function quarters(p: RulePerson, day: DayContext, date: string): Quarters {
    let days = people.get(p);
    if (!days) { days = new WeakMap(); people.set(p, days); }
    let dates = days.get(day);
    if (!dates) { dates = new Map(); days.set(day, dates); }
    let value = dates.get(date);
    if (!value) { value = { holds: new Map(), mod: new Map() }; dates.set(date, value); }
    return value;
  }
  return {
    legalHoldPath(p: RulePerson, id: string, day: DayContext, date: string, q: number) {
      const all = quarters(p, day, date).holds;
      let holds = all.get(id);
      if (!holds) { holds = new Map(); all.set(id, holds); }
      if (!holds.has(q)) holds.set(q, legalHoldPath(p, id, day, date, q));
      return holds.get(q)!;
    },
    modCountsOn(p: RulePerson, day: DayContext, q: number) {
      // MoD depends on the day object (including its catering inputs), not the date string.
      const mod = quarters(p, day, "").mod;
      if (!mod.has(q)) mod.set(q, modCountsOn(p, day, q));
      return mod.get(q)!;
    },
  };
}
