/**
 * 0320's two-session proof script (scripts/sim/checklist-0320-lineage-lock-check-management.mjs) is
 * CC's to run on SIM; this pins its shape offline: SIM-only, retirement-only cleanup, the three races.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fixture, fixtureSQL, retireSQL, evidenceSQL, runProof, main } from "../scripts/sim/checklist-0320-lineage-lock-check-management.mjs";
import { PROD_REF, SIM_REF } from "../scripts/supabase-management-query.mjs";

type Case = { name: string; t1: string; t2: string; i1: string; i2: string; date: string };
type Fixture = { actor: string; shop: string; tag: string; cases: Case[] };

describe("0320 Management API proof (offline only)", () => {
  it("races the lineage key three ways through the shared observed-wait helper", () => {
    const source = readFileSync("scripts/sim/checklist-0320-lineage-lock-check-management.mjs", "utf8");
    expect(source.match(/await proveRace\(query, /g)).toHaveLength(3);
    expect(source).toContain("activateSQL(f, c1)");
    expect(source).toContain("insertSQL(f, c2.t2, c2.date)");
    expect(source).toContain("proveRace(query, activateSQL(f, c3), insertSQL(f, c3.t1, c3.date)");
    expect(source).not.toMatch(/import.*dotenv|process\.env\.SIM_DATABASE_URL|import\(['"]pg['"]\)/);
  });
  it("allocates isolated 2099 lineages and only retires its own configuration", () => {
    const f = fixture() as unknown as Fixture;
    expect(f.tag).toMatch(/^SIM-0320-/);
    expect(f.cases).toHaveLength(3);
    for (const c of f.cases) expect(c.date).toMatch(/^2099-/);
    const sql = fixtureSQL(f), retire = retireSQL(f);
    expect(sql).not.toMatch(/\b(update|delete|truncate)\b/i);
    expect(retire.match(/set active=false/g)).toHaveLength(4);
    expect(retire).not.toMatch(/delete|truncate|checklist_instances|checklist_completions/i);
    expect(evidenceSQL(f, f.cases[0]!)).toContain("count(*)::int from public.checklist_instances");
  });
  it("refuses non-SIM targets before accessing transport", () => {
    const fetcher = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", fetcher);
    try {
      for (const args of [[], [`--ref=${PROD_REF}`], [`--ref=${SIM_REF}`, `--ref=${SIM_REF}`]]) expect(() => main(args)).toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("fails its preflight before writing any fixture when 0320 is not applied", async () => {
    const query = vi.fn(async (sql: string) => (sql.includes("information_schema.columns") ? [] : [{ rpc: false, executable: false, guard: false }]));
    await expect(runProof(query, vi.fn())).rejects.toThrow();
    expect(query.mock.calls.some(([sql]) => /insert into/i.test(sql))).toBe(false);
  });
});
