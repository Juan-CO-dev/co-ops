/** W12/B070: the sim-only two-session proof script, exercised offline with a fake transport (never run here). */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CUTOFF, fixture, fixtureSQL, holderSQL, preflight, racerSQL, retireSQL, runProof, signatures, userColumns,
} from "../scripts/sim/customers-0312-retention-lock-check-management.mjs";
import { PROD_REF, SIM_REF, projectRef } from "../scripts/supabase-management-query.mjs";

const grants = signatures.map((signature: string) => ({ signature, present: true, executable: true }));
const columns = userColumns.map((column_name: string) => ({ column_name }));

describe("0312 sim Management API proof (offline)", () => {
  it("guards the designated sim and reads no environment files", () => {
    const source = readFileSync("scripts/sim/customers-0312-retention-lock-check-management.mjs", "utf8");
    expect(source).toContain("projectRef(process.argv.slice(2),true)");
    expect(source.match(/process\.env\.[A-Z_]+/g)).toEqual(["process.env.SUPABASE_ACCESS_TOKEN"]);
    expect(source).not.toMatch(/dotenv/);
    expect(projectRef([`--ref=${SIM_REF}`], true)).toBe(SIM_REF);
    for (const ref of [PROD_REF, "aaaaaaaaaaaaaaaaaaaa"]) expect(() => projectRef([`--ref=${ref}`], true)).toThrow();
  });
  it("uses synthetic fixtures, a 1990 cutoff, and retires without deleting", () => {
    const f = fixture();
    expect(f.email).toMatch(/^sim-0312-[0-9a-f-]+@example\.test$/);
    expect(f.evidence).toMatch(/^[0-9]{1,100}:[A-Za-z0-9_ -]{1,200}$/);
    expect(fixtureSQL(f)).toContain("timestamptz '1990-01-01 00:00+00'");
    expect(racerSQL(f)).toContain(CUTOFF);
    expect(holderSQL(f)).toContain("customer_consent_record_explicit");
    const cleanup = retireSQL(f);
    expect(cleanup).not.toMatch(/\bdelete from\b|\btruncate\b/i);
    expect(cleanup).toContain(`'${f.customer}','delete_request'`);
  });
  it.each(["grant", "column", "blast"])("refuses %s drift before any insert", async (mode) => {
    const query = vi.fn()
      .mockResolvedValueOnce(mode === "grant" ? [] : grants)
      .mockResolvedValueOnce(mode === "column" ? columns.slice(1) : columns)
      .mockResolvedValueOnce([{ n: mode === "blast" ? 1 : 0 }]);
    await expect(preflight(query)).rejects.toThrow();
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("insert into"))).toBe(true);
  });
  it.each([[true, 0], [false, 0], [true, 1]])("needs an observed block AND zero erasures: blocked=%s erased=%s", async (blocked, erased) => {
    let time = 0;
    let release: (rows: unknown[]) => void = () => {};
    const query = vi.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("unnest(array[")) return grants;
      if (sql.includes("information_schema.columns")) return columns;
      if (sql.includes("last_seen_at < timestamptz")) return [{ n: 0 }];
      if (sql.includes("insert into public.users")) return [];
      if (sql.includes("customer_consent_record_explicit(")) {
        expect(sql).toContain("set local role service_role");
        return new Promise((resolve) => { release = resolve; });
      }
      if (sql.includes("customer_retention_sweep(")) { time = 7000; release([]); return [{ result: { erased, skipped: 0 } }]; }
      if (sql.includes(" as ready")) return [{ ready: true }];
      if (sql.includes("pg_blocking_pids")) return [{ blocked }];
      if (sql.includes(" as live")) return [{ live: true, identifiers: 1, suppressions: 0, consent: "opted_in" }];
      if (sql.includes("select public.customer_erase(")) return [];
      if (sql.includes(" as retired")) return [{ retired: true }];
      throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
    });
    const proof = runProof(query, vi.fn(), { now: () => time, sleep: async (ms: number) => { time += ms; } });
    if (blocked && erased === 0) await proof; else await expect(proof).rejects.toThrow();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("select public.customer_erase("))).toHaveLength(1);
  });
});
