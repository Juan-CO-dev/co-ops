/**
 * Scheduling Phase 2, chunk G, Task 26 — the sim scheduling seed's guard and plan (pure; no client is ever built here).
 *  - arguments: a DRY RUN by default; `--apply` writes; anything unknown is refused;
 *  - the target: the production ref refused BY NAME wherever it appears; otherwise only the exact sim origin, with a
 *    service key; the I/O scripts refuse BEFORE building a client and run only when invoked directly (pathToFileURL);
 *  - the plan: 15 crew per shop with the fixed patterns (openers, closers, one BOH-only, mids, one with no history, a
 *    1-week and a 2-week new hire — the P2-10 transition), 8 weeks before `today`, deterministic and idempotent ids,
 *    the first name only in the entries, never a shop code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREW_PER_SHOP, PROD_PROJECT_REF, SEED_WEEKS, parseSeedArgs, seedPlan, seedTarget, shopPlan } from "../scripts/sim/seed-scheduling-shared";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const SIM_URL = `https://${SIM_PROJECT_REF}.supabase.co`;
const L1 = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";
const L2 = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const TODAY = "2026-10-28"; // a Wednesday

describe("arguments", () => {
  it("dry run by default; --apply writes; --today pins the clock; anything else is refused", () => {
    expect(parseSeedArgs([])).toEqual({ ok: true, args: { apply: false, captures: false, today: null } });
    expect(parseSeedArgs(["--apply", "--today=2026-10-28"])).toEqual({ ok: true, args: { apply: true, captures: false, today: "2026-10-28" } });
    expect(parseSeedArgs(["--captures"])).toMatchObject({ ok: true, args: { captures: true } });
    expect(parseSeedArgs(["--force"])).toEqual({ ok: false, reason: "unknown argument: --force" });
    expect(parseSeedArgs(["--today=tomorrow"]).ok).toBe(false);
  });
});

describe("the target guard", () => {
  it("refuses the PRODUCTION ref by name, wherever it appears", () => {
    expect(seedTarget({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "k" })).toEqual({ ok: false, reason: "refused: the environment names the PRODUCTION project" });
    expect(seedTarget({ NEXT_PUBLIC_SUPABASE_URL: SIM_URL, SUPABASE_SERVICE_ROLE_KEY: "k", OTHER: `postgres://x@db.${PROD_PROJECT_REF}.supabase.co` }).ok).toBe(false);
  });
  it("accepts only the exact sim origin, with a service key", () => {
    expect(seedTarget({ NEXT_PUBLIC_SUPABASE_URL: SIM_URL, SUPABASE_SERVICE_ROLE_KEY: "k" })).toEqual({ ok: true, url: SIM_URL, key: "k" });
    for (const url of [undefined, "", `${SIM_URL}/`.replace(/\/$/, "x"), `https://${SIM_PROJECT_REF}.supabase.co.evil.test`, `http://${SIM_PROJECT_REF}.supabase.co`, "https://other.supabase.co"]) {
      expect(seedTarget({ NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "k" }).ok, String(url)).toBe(false);
    }
    expect(seedTarget({ NEXT_PUBLIC_SUPABASE_URL: SIM_URL })).toEqual({ ok: false, reason: "refused: SUPABASE_SERVICE_ROLE_KEY missing from the sim environment" });
  });
  it("each sim script refuses BEFORE building a client and runs only when invoked directly", () => {
    for (const f of ["scripts/sim/seed-scheduling.ts", "scripts/sim/run-schedule-draft.ts", "scripts/sim/schedule-lock-check.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("pathToFileURL(process.argv[1]");
      const guard = src.indexOf("seedTarget(process.env)");
      const client = src.indexOf("createClient(");
      expect(guard, f).toBeGreaterThan(-1);
      expect(client, f).toBeGreaterThan(guard);
      expect(src, f).not.toMatch(/supabase-server/);
      expect(src, f).not.toMatch(/["'](EM|MEP)["']/);
    }
  });
});

describe("the plan", () => {
  const plan = shopPlan(L1, 0, TODAY);
  it("15 crew with the fixed patterns and roles; emails @sim.invalid, lowercase", () => {
    expect(plan.crew).toHaveLength(CREW_PER_SHOP);
    expect(plan.crew.map((c) => c.pattern)).toEqual(["opener", "opener", "opener", "opener", "closer", "closer", "closer", "closer", "boh_only", "mid", "mid", "mid",
      "no_history", "new_hire_1_week", "new_hire_2_weeks"]);
    for (const c of plan.crew) { expect(c.email).toMatch(/^sched-1-\d{2}@sim\.invalid$/); expect(c.email).toBe(c.email.toLowerCase()); }
  });
  it("8 weeks of entries before today, from the patterns; no history for 13; the new hires only in their last 1 / 2 weeks", () => {
    const by = (n: number) => plan.entries.filter((e) => e.employee_guid === plan.crew[n - 1]!.employeeGuid);
    const dates = plan.entries.map((e) => e.business_date).sort();
    expect(dates[0]! >= "2026-09-02").toBe(true); // 56 days before Oct 28
    expect(dates[dates.length - 1]! < TODAY).toBe(true);
    expect(by(1)).toHaveLength(SEED_WEEKS * 5);
    expect(by(9)).toHaveLength(SEED_WEEKS * 6);
    expect(by(9).every((e) => e.job_name === "Prep")).toBe(true);
    expect(by(13)).toHaveLength(0);
    expect(by(14).length).toBe(5);
    expect(by(15).length).toBe(10);
    // An opener on Mon Oct 26 (EDT) is 07:00–15:00 ET; a closer on Sun Nov 1 (EST after the fall-back) 13:00–21:00 ET.
    const mon = by(1).find((e) => e.business_date === "2026-10-26")!;
    expect([mon.in_at, mon.out_at, mon.hours]).toEqual(["2026-10-26T11:00:00.000Z", "2026-10-26T19:00:00.000Z", 8]);
    const sun = shopPlan(L1, 0, "2026-11-04").entries.find((e) => e.employee_guid === plan.crew[4]!.employeeGuid && e.business_date === "2026-11-01")!;
    expect([sun.in_at, sun.out_at]).toEqual(["2026-11-01T18:00:00.000Z", "2026-11-02T02:00:00.000Z"]);
  });
  it("deterministic and idempotent ids; the first name only; never a shop code; both shops apart", () => {
    expect(shopPlan(L1, 0, TODAY)).toEqual(plan);
    const guids = plan.entries.map((e) => e.time_entry_guid);
    expect(new Set(guids).size).toBe(guids.length);
    for (const e of plan.entries) expect(e.employee_first_name).not.toMatch(/\s/);
    const both = seedPlan([L1, L2], TODAY);
    expect(both.map((p) => p.locationId)).toEqual([L1, L2]);
    expect(both[1]!.crew[0]!.email).toBe("sched-2-01@sim.invalid");
    expect(new Set([...both[0]!.entries, ...both[1]!.entries].map((e) => e.time_entry_guid)).size).toBe(both[0]!.entries.length + both[1]!.entries.length);
  });
});
