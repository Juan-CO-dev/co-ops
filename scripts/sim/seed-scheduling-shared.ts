/**
 * SIM ONLY — the scheduling seed's PURE half (Scheduling Phase 2, Task 26): the argument parser, the target guard and the
 * deterministic plan (crew, Toast links, 8 weeks of Toast time entries from fixed patterns). Zero I/O, no clock (today is
 * a parameter), no server import — tested by tests/schedule-sim-seed-guard.test.ts. The I/O half is seed-scheduling.ts.
 *
 * Patterns per shop (15 crew, never keyed on a shop code — the shops are SIM_LOCATIONS' ids):
 *   01–04 openers   Mon–Fri 07:00–15:00         09     BOH only   Mon–Sat 06:00–14:00 (job "Prep")
 *   05–08 closers   Wed–Sun 13:00–21:00         10–12  mids       Tue, Thu, Sat, Sun 10:00–18:00
 *   13    no history (linked, never punched)    14     new hire, 1 week   Mon–Fri 11:00–19:00, the last 7 days only
 *   15    new hire, 2 weeks (same, the last 14 days only)  — the P2-10 transition: fewer than 3 observed weeks = assumed
 *                                                            available within the shop's normal hours, flagged.
 */
import { etWallMinutesInstant } from "../../lib/operational-day";
import { SIM_PROJECT_REF, assertSimTarget } from "../../lib/sim-isolation-shared";
import type { RoleCode } from "../../lib/roles";

/** The production project ref, refused BY NAME before anything else is looked at. */
export const PROD_PROJECT_REF = "bgcvurheqzylyfehqgzh";
export const SEED_WEEKS = 8;
export const CREW_PER_SHOP = 15;
/** The sim-only wage estimates (prod starts BLANK, R2). */
export const SIM_ESTIMATED_HOURLY_CENTS = 1800;
export const SIM_ESTIMATED_SALARIED_WEEKLY_CENTS = 120000;

export interface SeedArgs { apply: boolean; captures: boolean; today: string | null }
export type ArgsResult = { ok: true; args: SeedArgs } | { ok: false; reason: string };

/** `--apply` writes (default: a dry run that writes nothing); `--captures` is accepted and documented; `--today=YYYY-MM-DD` pins the clock. */
export function parseSeedArgs(argv: readonly string[]): ArgsResult {
  const args: SeedArgs = { apply: false, captures: false, today: null };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else if (a === "--captures") args.captures = true;
    else if (a.startsWith("--today=") && /^\d{4}-\d{2}-\d{2}$/.test(a.slice(8))) args.today = a.slice(8);
    else return { ok: false, reason: `unknown argument: ${a}` };
  }
  return { ok: true, args };
}

/**
 * The target guard, BEFORE any client is built: the production ref is refused by name wherever it appears, then the
 * Supabase URL must be EXACTLY the sim origin (lib/sim-isolation-shared `assertSimTarget`) and a service key present.
 */
export function seedTarget(env: Readonly<Record<string, string | undefined>>): { ok: true; url: string; key: string } | { ok: false; reason: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (Object.values(env).some((v) => typeof v === "string" && v.includes(PROD_PROJECT_REF))) return { ok: false, reason: "refused: the environment names the PRODUCTION project" };
  try { assertSimTarget(url); } catch { return { ok: false, reason: `refused: NEXT_PUBLIC_SUPABASE_URL is not the sim (${SIM_PROJECT_REF})` }; }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, reason: "refused: SUPABASE_SERVICE_ROLE_KEY missing from the sim environment" };
  return { ok: true, url: url!, key };
}

export interface CrewPlan { n: number; email: string; name: string; role: RoleCode; language: "en" | "es"; employeeGuid: string; pattern: string }
export interface EntryPlan {
  location_id: string; time_entry_guid: string; business_date: string; employee_guid: string; employee_first_name: string;
  job_guid: null; job_name: string; in_at: string; out_at: string; hours: number; overtime_hours: number; auto_clocked_out: false; deleted: false;
}
export interface ShopPlan { locationId: string; crew: CrewPlan[]; entries: EntryPlan[] }

interface Pattern { key: string; dows: number[]; fromMin: number; toMin: number; job: string; lastDays: number | null }
const OPENER: Pattern = { key: "opener", dows: [1, 2, 3, 4, 5], fromMin: 7 * 60, toMin: 15 * 60, job: "Line", lastDays: null };
const CLOSER: Pattern = { key: "closer", dows: [3, 4, 5, 6, 7], fromMin: 13 * 60, toMin: 21 * 60, job: "Line", lastDays: null };
const BOH: Pattern = { key: "boh_only", dows: [1, 2, 3, 4, 5, 6], fromMin: 6 * 60, toMin: 14 * 60, job: "Prep", lastDays: null };
const MID: Pattern = { key: "mid", dows: [2, 4, 6, 7], fromMin: 10 * 60, toMin: 18 * 60, job: "Line", lastDays: null };
const NONE: Pattern = { key: "no_history", dows: [], fromMin: 0, toMin: 0, job: "Line", lastDays: null };
const HIRE1: Pattern = { key: "new_hire_1_week", dows: [1, 2, 3, 4, 5], fromMin: 11 * 60, toMin: 19 * 60, job: "Line", lastDays: 7 };
const HIRE2: Pattern = { key: "new_hire_2_weeks", dows: [1, 2, 3, 4, 5], fromMin: 11 * 60, toMin: 19 * 60, job: "Line", lastDays: 14 };
/** Crew 1–15: pattern and role. */
const CREW: ReadonlyArray<{ pattern: Pattern; role: RoleCode }> = [
  { pattern: OPENER, role: "shift_lead" }, { pattern: OPENER, role: "key_holder" }, { pattern: OPENER, role: "employee" }, { pattern: OPENER, role: "trainer" },
  { pattern: CLOSER, role: "shift_lead" }, { pattern: CLOSER, role: "key_holder" }, { pattern: CLOSER, role: "employee" }, { pattern: CLOSER, role: "employee" },
  { pattern: BOH, role: "employee" },
  { pattern: MID, role: "employee" }, { pattern: MID, role: "trainer" }, { pattern: MID, role: "employee" },
  { pattern: NONE, role: "employee" }, { pattern: HIRE1, role: "trainee" }, { pattern: HIRE2, role: "trainee" },
];
const FIRST = ["Abe", "Bea", "Cal", "Dee", "Eve", "Fin", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lou", "Mo", "Ned", "Oli"];

const pad = (n: number) => String(n).padStart(2, "0");
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}
function isoDow(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const w = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The plan for one shop, deterministic in (locationId, shopIndex, today). Entries cover the SEED_WEEKS × 7 days before today. */
export function shopPlan(locationId: string, shopIndex: number, today: string): ShopPlan {
  const tag = locationId.slice(0, 8);
  const crew: CrewPlan[] = CREW.map((c, i) => ({
    n: i + 1,
    email: `sched-${shopIndex + 1}-${pad(i + 1)}@sim.invalid`,
    name: `${FIRST[i]} Sim${shopIndex + 1}`,
    role: c.role,
    language: i % 4 === 3 ? "es" : "en",
    employeeGuid: `sim-sched-${tag}-${pad(i + 1)}`,
    pattern: c.pattern.key,
  }));
  const entries: EntryPlan[] = [];
  const days = SEED_WEEKS * 7;
  for (let back = days; back >= 1; back--) {
    const date = addDaysYmd(today, -back);
    const dow = isoDow(date);
    CREW.forEach((c, i) => {
      const p = c.pattern;
      if (!p.dows.includes(dow) || (p.lastDays !== null && back > p.lastDays)) return;
      const inAt = etWallMinutesInstant(date, p.fromMin).toISOString();
      const outAt = etWallMinutesInstant(date, p.toMin).toISOString();
      entries.push({
        location_id: locationId, time_entry_guid: `sim-sched-${tag}-${pad(i + 1)}-${date}`, business_date: date,
        employee_guid: crew[i]!.employeeGuid, employee_first_name: FIRST[i]!, job_guid: null, job_name: p.job,
        in_at: inAt, out_at: outAt, hours: (p.toMin - p.fromMin) / 60, overtime_hours: 0, auto_clocked_out: false, deleted: false,
      });
    });
  }
  return { locationId, crew, entries };
}

export function seedPlan(locationIds: readonly string[], today: string): ShopPlan[] {
  return locationIds.map((id, i) => shopPlan(id, i, today));
}
