/**
 * W25 / B219 — migration 0334 pinned: the house header and gate line, one transaction, the drift-refusing
 * pre-flight, the re-emitted body as a line-subsequence of its ONLY source definer (0270) plus exactly the B219
 * block, and the executable PGlite proof (scripts/sql-harness-0334.mjs).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const m0334 = read("supabase/migrations/0334_people_shop_settings_pm_v2_switch_lock.sql");
const m0270 = read("supabase/migrations/0270_people_layer.sql");
function fn(sql: string, head: string): string {
  const i = sql.indexOf(head);
  expect(i, `${head} not found`).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf("end $$;", i) + "end $$;".length);
}

describe("0334_people_shop_settings_pm_v2_switch_lock", () => {
  it("house header and gate line", () => {
    const lines = m0334.split("\n");
    expect(lines[0]).toBe("-- Migration 0334_people_shop_settings_pm_v2_switch_lock");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-16\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word\)\.$/);
    for (const section of ["-- WHAT", "-- EXISTING ROWS:", "-- APP COMPATIBILITY:", "-- ROLLBACK:", "-- PRE-FLIGHT"]) expect(m0334).toContain(section);
  });

  it("is one transaction whose pre-flight refuses without 0270 or on a drifted live body", () => {
    expect(m0334).toMatch(/\nbegin;\n/);
    expect(m0334.trimEnd().endsWith("commit;")).toBe(true);
    expect(m0334).toContain("raise exception '0334: 0270 (save_people_shop_settings, people_shop_settings) must be applied first';");
    expect(m0334).toContain("a later definer exists; re-emit from it. Refusing.");
  });

  it("re-emits 0270's body unchanged except the B219 block (line-subsequence), and no other definer exists", () => {
    const src = fn(m0270, "create function public.save_people_shop_settings(").replace("create function", "create or replace function").split("\n");
    const out = fn(m0334, "create or replace function public.save_people_shop_settings(").split("\n");
    const declare = "declare v_old public.people_shop_settings%rowtype; v_had boolean;";
    let j = 0;
    const extra: string[] = [];
    for (const line of out) {
      const want = src[j];
      if (want !== undefined && (line === want || (want === declare && line === `${declare.slice(0, -1)}; v_role text;`))) j++;
      else extra.push(line.trim());
    }
    expect(j, "every 0270 line in order").toBe(src.length);
    expect(extra.filter((l) => !l.startsWith("--"))).toEqual([
      "if p_pm_v2 is distinct from coalesce(case when v_had then v_old.pm_v2 end, false) then",
      "select u.role into v_role from public.users u where u.id = p_actor and u.active;",
      "if v_role is null or v_role not in ('moo', 'owner', 'cgs') then raise exception 'pm_v2_moo_only'; end if;",
      "end if;",
    ]);
    // The block is judged after the lock and the FOR UPDATE read, before any write.
    const body = out.join("\n");
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("pm_v2_moo_only"));
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("pm_v2_moo_only"));
    expect(body.indexOf("pm_v2_moo_only")).toBeLessThan(body.indexOf("update public.people_shop_settings"));
    const definers = ["0270_people_layer.sql", "0334_people_shop_settings_pm_v2_switch_lock.sql"];
    const all = execFileSync("grep", ["-l", "function public.save_people_shop_settings", "-r", "supabase/migrations"], { encoding: "utf8" })
      .trim().split("\n").map((p) => p.split("/").pop());
    expect(all.sort()).toEqual(definers);
  });

  it("the role list is the app's PM_V2_SWITCH_ROLES", async () => {
    const { PM_V2_SWITCH_ROLES } = await import("@/lib/people/access-shared");
    expect([...PM_V2_SWITCH_ROLES].sort()).toEqual(["cgs", "moo", "owner"]);
  });

  it("the sim two-session proof is FILE ONLY: importing it runs nothing; its fixtures live at a new shop and it pins this body", async () => {
    const sim = await import("../scripts/sim/people-0334-pm-v2-lock-check-management.mjs");
    const f = sim.fixture();
    expect(f.tag).toBe(`SIM-0334-${f.shop}`);
    expect(sim.fixtureSQL(f)).toContain(f.shop);
    expect(sim.retireSQL(f)).not.toMatch(/\bdelete\b|people_shop_settings/i);
    expect(read("scripts/sim/people-0334-pm-v2-lock-check-management.mjs")).toContain("5f4188850bab073cec1ce8d07374aeb7");
    expect(m0334).toContain("5f4188850bab073cec1ce8d07374aeb7");
  });

  it("the PGlite proof passes (scripts/sql-harness-0334.mjs)", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0334.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/PASS 0334: \d+ checks/);
  }, 240_000);
});
