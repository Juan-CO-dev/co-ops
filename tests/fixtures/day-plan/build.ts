/**
 * Nav PR 5 fixtures: fact builders for the day engine (plan r4, section 11). Illustrative data in the real shapes.
 * Time is always an input: `hm("13:35")` is minutes on the plan date, `iso(date, "13:40")` the ET instant.
 */
import type {
  CateringOrder, ChecklistDay, DayAssignment, DayItem, DayPlan, DayStation, DayViewer, Fact, Reason, ReasonParam, ReportDay,
  ShopFacts, Surface,
} from "@/lib/day-plan-shared";
import { operationalNow } from "@/lib/midshift-shared";
import { etWallMinutesInstant } from "@/lib/operational-day";
import { ROLES, type RoleCode } from "@/lib/roles";

/** A Wednesday (dow 3). */
export const PLAN_DATE = "2026-11-18";

export function hm(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
}
const isoCache = new Map<string, string>();
/** The ET instant of a wall time (cached: the sweeps build the same facts thousands of times). */
export function iso(date: string, t: string): string {
  const k = `${date} ${t}`;
  let v = isoCache.get(k);
  if (v === undefined) isoCache.set(k, (v = etWallMinutesInstant(date, hm(t)).toISOString()));
  return v;
}

export const ok = <T>(value: T): Fact<T> => ({ kind: "ok", value });
export const failed = <T>(): Fact<T> => ({ kind: "failed" });

export function station(p: Partial<DayStation> & Pick<DayStation, "id" | "name" | "sort">): DayStation {
  return { nameEs: null, floor: false, startsMidDay: false, usuallyClosesAt: null, closedAt: null, ...p };
}
export function order(p: Partial<CateringOrder> & Pick<CateringOrder, "id">): CateringOrder {
  return { source: "pipeline", eventQ: null, headcount: null, state: "to_go_out", outAt: null, ...p };
}
export function checklist(forDate: string, p: Partial<ChecklistDay> = {}): ChecklistDay {
  return { forDate, status: null, phase1At: null, finishedAt: null, finishedByName: null, sectionsLeft: null, ...p };
}
export function report(forDate: string, p: Partial<ReportDay> = {}): ReportDay {
  return { forDate, state: "none", at: null, byName: null, ...p };
}
export function assignment(id: string, task: DayAssignment["task"], assigneeId: string, firstName: string, p: Partial<DayAssignment> = {}): DayAssignment {
  return { id, task, assigneeId, firstName, available: true, source: "assigned", ...p };
}

/** A member of the shop holds every surface; the catering manager at a shop they do not belong to holds three. */
const MEMBER_SURFACES: ReadonlySet<Surface> = new Set<Surface>(["tasks", "ops", "catering", "schedule", "report_read"]);
const NON_MEMBER_CATERING_SURFACES: ReadonlySet<Surface> = new Set<Surface>(["tasks", "catering", "schedule"]);

export function viewer(role: RoleCode, userId: string, surfaces: ReadonlySet<Surface> = MEMBER_SURFACES): DayViewer {
  return { userId, role, level: ROLES[role].level, surfaces, switches: {} };
}

/** The people of the worked example and one viewer per role (plan 12, group 2). */
export const ANA = viewer("key_holder", "u-ana");
export const LUIS = viewer("employee", "u-luis");
export const ROSA = viewer("employee", "u-rosa");
const SL = viewer("shift_lead", "u-sl");
export const AGM = viewer("agm", "u-agm");
const PREP = viewer("prep_mgr", "u-prep");
export const CATERING_MEMBER = viewer("catering_mgr", "u-cat");
export const CATERING_NON_MEMBER = viewer("catering_mgr", "u-cat-x", NON_MEMBER_CATERING_SURFACES);
export const GM = viewer("gm", "u-gm");
export const MOO = viewer("moo", "u-moo");
const OWNER = viewer("owner", "u-owner");
export const CGS = viewer("cgs", "u-juan");
export const ALL_VIEWERS = { ANA, LUIS, ROSA, SL, AGM, PREP, CATERING_MEMBER, CATERING_NON_MEMBER, GM, MOO, OWNER, CGS } as const;

/** The fact for "my station" as PR 6 fills it for one viewer. */
export function forViewer(facts: ShopFacts, stationByUser: Readonly<Record<string, string>>, userId: string): ShopFacts {
  const id = stationByUser[userId];
  return { ...facts, myStation: ok(id ? { stationId: id } : null) };
}

/** Every Fact field of ShopFacts failed (group 5). */
export const FACT_FIELDS = [
  "hours", "stations", "opening", "closing", "amPrep", "midDay", "cash", "pm", "ordering", "rhythm", "receiving",
  "cateringToday", "cateringTomorrow", "flaggedLines", "assignments", "myStation", "counts", "yesterdayClosing",
] as const satisfies readonly (keyof ShopFacts)[];
export function withFailed(facts: ShopFacts, fields: readonly (typeof FACT_FIELDS)[number][]): ShopFacts {
  const out: Record<string, unknown> = { ...facts };
  for (const f of fields) out[f] = { kind: "failed" };
  return out as unknown as ShopFacts;
}

// ── Compact text forms, so a test can assert a whole list in one readable line ──
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** A parameter as text: names by their en value, every time as ET "HH:MM" (an instant through operationalNow). */
function paramText(p: ReasonParam): string {
  switch (p.t) {
    case "name": return p.en;
    case "names": return p.v.map((x) => x.en).join("+");
    case "usual": return p.v.wall.slice(0, 5);
    case "wall": return hhmm(p.min);
    case "instant": return hhmm(operationalNow(new Date(p.iso)).minutesOfDay);
    case "day": return p.ymd;
    case "count": return String(p.v);
    case "key": return p.key;
  }
}
/** "midday.waiting{station=Crunchy Boi Station,time=13:30}" (the day.reason. / day.phase. prefix dropped). */
export function reasonText(r: Reason | null): string {
  if (r === null) return "";
  const params = Object.entries(r.params).map(([k, v]) => `${k}=${paramText(v)}`).join(",");
  return `${r.key.replace(/^day\.(reason|phase)\./, "")}{${params}}`;
}
/** "closing upcoming/full" per item, in order. */
export function itemsText(plan: DayPlan): string[] {
  return plan.items.map((i) => `${i.id} ${i.band}${i.pin ? `/${i.pin}` : ""}`);
}
/** One item by id (throws when absent). */
export function item(plan: DayPlan, id: DayItem["id"]): DayItem {
  const found = plan.items.find((i) => i.id === id);
  if (!found) throw new Error(`no ${id} in ${itemsText(plan).join(", ")}`);
  return found;
}
export function phaseText(plan: DayPlan): string {
  return `${plan.phase.id} (${plan.phase.decidedBy}) ${reasonText(plan.phase.since)}`.trim();
}
