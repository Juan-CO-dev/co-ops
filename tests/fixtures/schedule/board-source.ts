/**
 * A `BoardSource` (the board view-model's input) built from a REAL generator fixture (Scheduling Phase 2, chunk F):
 * the mockup v17 week (F1) or any `FIXTURES` entry, run through `buildWeek`, wrapped as the head the loader would
 * return. Names and position labels are test data; logic never reads them.
 */
import { budgetForDates } from "@/lib/scheduling/budget-shared";
import type { BoardSource } from "@/lib/scheduling/board-view-shared";
import { buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import type { PositionRole } from "@/lib/scheduling/structure-shared";
import { DATES, FIXTURES, I, V17_SPECS, WEEK } from "./fixtures";

export const POSITION_LABELS: Record<string, { name: string; nameEs: string | null; role: PositionRole }> = {
  [I.$PREP]: { name: "Prep", nameEs: "Preparación", role: "prep" },
  [I.$DISH]: { name: "Prep/Dishwasher", nameEs: "Prep/Lavaplatos", role: "prep_dish" },
  [I.$REG]: { name: "Register & Delivery", nameEs: "Caja y entregas", role: "register" },
  [I.$EXPO]: { name: "Expeditor", nameEs: "Expedidor", role: "expo" },
  [I.$WALKON]: { name: "Walk-ins / Online", nameEs: "Mostrador / En línea", role: "walk_online" },
  [I.$WALK]: { name: "Walk-ins", nameEs: "Mostrador", role: "walk" },
  [I.$BOI]: { name: "Crunchy Boi", nameEs: "Crunchy Boi", role: "line_other" },
  [I.$THIRD]: { name: "3rd Party", nameEs: "Terceros", role: "line_other" },
};

/** "u-05-dani" → "Dani"; any other id → itself. */
export const nameOf = (id: string) => {
  const m = /^u-[\w]+-([a-z]+)$/.exec(id);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1) : id;
};

const cache = new Map<string, GeneratorOutput>();
export function built(name = "F1-mockup-v17"): GeneratorOutput {
  if (!cache.has(name)) cache.set(name, buildWeek(FIXTURES[name]!()));
  return cache.get(name)!;
}

export type SourceOver = Partial<Omit<BoardSource, "perms">> & { perms?: Partial<BoardSource["perms"]> };

/** A GM's view of the fixture week (money visible, every act allowed), today = Monday; `over` replaces fields. */
export function boardSource(over: SourceOver = {}, fixture = "F1-mockup-v17"): BoardSource {
  const out = built(fixture);
  const ids = Object.keys(out.context.people).sort();
  const wages = Object.fromEntries(ids.map((id) => [id, out.context.people[id]!.salaried || out.context.people[id]!.presenceOnly ? null : 1900]));
  const forecastWeekCents = Object.values(out.context.days).reduce((n, d) => n + (d.inputs.dayCents ?? 0), 0);
  const base: BoardSource = {
    locationId: out.context.locationId, weekStart: WEEK, today: WEEK, weeksAhead: 1,
    perms: { canSeeMoney: true, canEdit: true, canApprove: true, canEditStructure: true, canManageSwitch: false, canBudget: true },
    liveStructureId: "sv-fixture-1", demand: "ok",
    names: Object.fromEntries(ids.map((id) => [id, nameOf(id)])),
    roles: Object.fromEntries(ids.map((id) => [id, out.context.people[id]!.role])),
    positions: POSITION_LABELS,
    skills: FIXTURES[fixture]!().skills,
    wageCentsByUser: wages, shopEstimateHourlyCents: 1900, salariedWeeklyCents: 225000, forecastWeekCents,
    budget: budgetForDates([], [], DATES), suggestion: null, advisory: [],
    week: {
      headRevisionId: "rev-head-1", approvedRevisionId: null, edited: false, structureVersionId: "sv-fixture-1",
      shifts: out.shifts, days: out.days, gaps: out.gaps, reasons: out.reasons as unknown as Record<string, unknown>,
      dayContexts: Object.fromEntries(DATES.map((d) => [d, out.context.days[d] ?? null])),
      people: out.context.people, closingWindowByDate: out.context.closingWindowByDate,
    },
  };
  const { perms, ...rest } = over;
  return { ...base, ...rest, perms: { ...base.perms, ...(perms ?? {}) } };
}

export { DATES, I, V17_SPECS, WEEK };
