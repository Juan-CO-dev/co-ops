/**
 * Scheduling Phase 2, Task 13 — migration 0274 pinned: the header and gate line, the executable PGlite proof
 * (the shared structure case file on the SQL CHECK, every refusal, the ceilings), the deny-all posture, the definer
 * writers, the named arguments the lib sends, every refusal a ScheduleErrorCode, and the structure twin fuzzed:
 * valid_schedule_structure (SQL) ≡ validScheduleStructure (TS) on random mutations beyond the case file.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";
import { CASE_DEFAULTS, shopBase } from "../scripts/schedule-structure-cases.mjs";
import { ROLES } from "@/lib/roles";
import { SCHEDULE_ERROR_CODES } from "@/lib/scheduling/errors-shared";
import {
  recordBudgetEntryCall, recordDayTypeCall, recordPersonSettingsCall, recordPinCall, saveShopSettingsCall, saveStructureCall,
} from "@/lib/scheduling/rpc-args-shared";
import { validScheduleStructure } from "@/lib/scheduling/structure-shared";

const raw = readFileSync("supabase/migrations/0274_schedule_settings.sql", "utf8");
const src = normalize(raw);
const TABLES = ["schedule_shop_settings", "schedule_structures", "schedule_person_settings", "schedule_budget_entries", "schedule_budget_days",
  "schedule_day_types", "schedule_pins"];

/** The SQL parameter names of a function, in order. */
function sqlParams(name: string): string[] {
  const fn = extractFunction(src, `create function public.${name}(`, "returns");
  const inner = fn.slice(fn.indexOf("(") + 1, fn.lastIndexOf(")"));
  return inner.split(",").map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
}

describe("0274_schedule_settings", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0274_schedule_settings"
        && /^-- AUTHORED 2026-10-16\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0272 and BEFORE 0275\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO SIM 2026-10-20 (schema_migrations version 20261020000001, name 'schedule_settings')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the stub's Supabase grants, the REAL helpers + 0270, then 0274, writers called as the lib calls them) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0274.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("S3 valid_schedule_structure agrees with the shared case file");
    expect(out).toContain("S3 the schedule_structures CHECK agrees with the shared case file");
    expect(out).toContain("S8 F11 week → month");
    expect(out).toContain("S8 F12 month → week → adjacent month");
    expect(out).toContain("S8 F13 partial week");
    expect(out).toContain("PASS 0274:");
  }, 260_000);

  it("deny-all: every table RLS on, no policy, SELECT-only for service_role (the definer writers are the only writers)", () => {
    expect(src).toContain(`revoke all on public.${TABLES.slice(0, 4).join(", public.")},\n  public.${TABLES.slice(4).join(", public.")}\n  from public, anon, authenticated, service_role;`);
    expect(src).toContain(`grant select on public.${TABLES.slice(0, 4).join(", public.")},\n  public.${TABLES.slice(4).join(", public.")}\n  to service_role;`);
    for (const t of TABLES) expect(src).toContain(`alter table public.${t} enable row level security;`);
    expect(src).not.toMatch(/create policy/i);
    expect(src).not.toMatch(/grant (insert|update|delete|all)/i);
  });

  it("every writer is SECURITY DEFINER with a pinned search_path, service_role only, and takes its lock before it reads", () => {
    const writers = ["save_schedule_shop_settings", "save_schedule_structure", "record_schedule_person_settings", "record_schedule_budget_entry",
      "record_schedule_day_type", "record_schedule_pin", "schedule_actor_level", "schedule_actor_require", "schedule_subject_at_shop"];
    for (const name of writers) {
      const fn = extractFunction(src, `create function public.${name}(`, "end $$;");
      expect(fn, name).toMatch(/language plpgsql security definer set search_path = pg_catalog, public as \$\$/);
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    }
    for (const [name, lock, read] of [
      ["save_schedule_shop_settings", "'schedule-shop-settings/'", "select * into v_old"],
      ["save_schedule_structure", "'schedule-structure/'", "select id into v_live"],
      ["record_schedule_person_settings", "'schedule-person/'", "select * into v_old"],
      ["record_schedule_budget_entry", "'schedule-budget/'", "insert into public.schedule_budget_entries"],
      ["record_schedule_pin", "'schedule-pin/'", "select * into v_pin"],
    ] as const) {
      const fn = extractFunction(src, `create function public.${name}(`, "end $$;");
      expect(fn.indexOf(lock), name).toBeGreaterThan(-1);
      expect(fn.indexOf(lock), name).toBeLessThan(fn.indexOf(read));
    }
    expect(src).toContain("create function public.valid_schedule_structure(p jsonb) returns boolean\nlanguage plpgsql immutable set search_path = pg_catalog, public as $$");
    expect(src).toContain("structure   jsonb       not null constraint schedule_structures_valid check (public.valid_schedule_structure(structure)),");
    // The actor rule REUSES 0228 and 0270; it never copies them.
    expect(src).not.toMatch(/create (or replace )?function public\.(assignment_author_level|people_position_at_shop|toast_link_actor_level)/);
  });

  it("the lib's named arguments (rpc-args-shared) are EXACTLY each writer's SQL parameters, in order", () => {
    const calls = [
      saveShopSettingsCall({ actorId: "a", locationId: "l", enabled: false, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "read" }),
      saveStructureCall({ actorId: "a", locationId: "l", expectedId: null, structure: {} }),
      recordPersonSettingsCall({ actorId: "a", locationId: "l", userId: "u", workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [],
        softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null }),
      recordBudgetEntryCall({ actorId: "a", locationId: "l", scope: "week", weekStart: "2026-10-26", month: null, hours: 0, days: [], source: "manager",
        suggestionDigest: null, apportionedBy: "even" }),
      recordDayTypeCall({ actorId: "a", locationId: "l", date: "2026-10-26", dayType: "auto" }),
      recordPinCall({ actorId: "a", locationId: "l", date: null, userId: null, startQ: null, endQ: null, positions: null, kind: null, retiresId: null }),
    ];
    for (const c of calls) expect(Object.keys(c.args), c.fn).toEqual(sqlParams(c.fn));
  });

  it("every refusal a writer raises is a ScheduleErrorCode (the closed vocabulary, en + es)", () => {
    const raised = [...src.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(raised.length).toBeGreaterThan(20);
    for (const code of new Set(raised)) expect(SCHEDULE_ERROR_CODES as readonly string[], code).toContain(code);
    for (const code of ["structure_moved", "structure_invalid", "position_not_at_shop", "roster_include_refused", "budget_invalid", "wage_estimate_invalid",
      "pin_invalid", "day_locked", "schedule_role_refused", "schedule_forbidden", "shop_not_allowed", "person_not_at_shop", "invalid_payload"]) {
      expect(raised, code).toContain(code);
    }
  });

  it("the role codes in SQL are lib/roles' ROLES, exactly", () => {
    const fn = extractFunction(src, "create function public.schedule_role_codes()", "$$;");
    const list = [...fn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(list).toEqual(Object.keys(ROLES).sort());
  });

  it("THE TWIN, fuzzed: valid_schedule_structure ≡ validScheduleStructure on 400 random mutations of both case-file bases", async () => {
    const start = raw.indexOf("-- ── THE STRUCTURE RULE SET");
    const end = raw.indexOf("-- ── THE TABLES");
    const db = new PGlite();
    await db.exec(raw.slice(start, end));
    let seed = 0x5eed0274;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
    const POOL: unknown[] = [0, 1, -1, 2, 2.5, 4, 8, 9, 16, 40, 42, 60, 80, 84, 96, 97, 0.25, 10.1, 10.5, 24.25, 1e9, 1e10, "x", "employee", "walk", "", null, true, false, [], {}, [1, 1], ["gm", "gm"], ["owner"]];
    const paths = (v: unknown, at: string[] = [], out: string[][] = []): string[][] => {
      if (v !== null && typeof v === "object") for (const k of Object.keys(v as object)) { out.push([...at, k]); paths((v as Record<string, unknown>)[k], [...at, k], out); }
      return out;
    };
    let agree = 0;
    let validSeen = 0;
    const N = Number(process.env.TWIN_FUZZ_N ?? 400); // CI: 400; a deeper local run: TWIN_FUZZ_N=3000
    for (let i = 0; i < N; i++) {
      const v = structuredClone(rnd() < 0.5 ? shopBase() : CASE_DEFAULTS) as Record<string, unknown>;
      const log: string[] = [];
      for (let m = 0, n = 1 + Math.floor(rnd() * 2); m < n; m++) {
        const all = paths(v);
        const path = pick(all);
        let o = v as Record<string, unknown>;
        for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
        const last = path[path.length - 1]!;
        const r = rnd();
        log.push(path.join("."));
        // An array element is removed with splice: a delete would leave a HOLE, which JSON can never carry.
        if (r < 0.1) { if (Array.isArray(o)) o.splice(Number(last), 1); else delete o[last]; }
        else if (r < 0.15 && !Array.isArray(o)) o[`extra${m}`] = 1;
        else if (r < 0.35 && typeof o[last] === "number") o[last] = (o[last] as number) + pick([-4, -1, 1, 4, 0.25]);
        else o[last] = structuredClone(pick(POOL));
      }
      const ts = validScheduleStructure(v).ok;
      const sql = (await db.query<{ v: boolean }>("select public.valid_schedule_structure($1::jsonb) as v", [JSON.stringify(v)])).rows[0]!.v;
      if (ts === sql) agree++; else console.error(`twin disagrees (TS ${ts}, SQL ${sql}) at`, log.join(" | "), JSON.stringify(log.map((p) => p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], v))));
      if (ts) validSeen++;
    }
    await db.close();
    expect(agree).toBe(N);
    expect(validSeen).toBeGreaterThan(20); // the fuzz exercises both verdicts
  }, 120_000);
});
