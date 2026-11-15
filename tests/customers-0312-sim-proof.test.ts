/** W12/B070: the sim-only two-session proof script, exercised offline with a fake transport (never run here). */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CUTOFF, EXPORT_DATE, IMPORT_SOURCE, fixture, fixtureSQL, holderSQL, importFixture, importFixtureSQL, importPreflight,
  importRetireSQL, importSignatures, preflight, racerSQL, retireSQL, runImportPairings, runProof, signatures, userColumns,
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

// W12/B070 r1 (review P2): the import finish against the sweep, both commit orders.
describe("0312 sim import-finish pairing (offline)", () => {
  const importGrants = importSignatures.map((signature: string) => ({ signature, present: true, executable: true }));
  it("uses synthetic 1990 fixtures on the fixture source and retires without deleting", () => {
    const f = importFixture();
    expect(f.emailA).toMatch(/^sim-0312i-a-[0-9a-f-]+@example\.test$/);
    expect(f.emailB).toMatch(/^sim-0312i-b-[0-9a-f-]+@example\.test$/);
    expect(IMPORT_SOURCE).toBe("toast_marketing_api");
    expect(EXPORT_DATE < CUTOFF.slice(0, 10)).toBe(true);
    expect(importFixtureSQL(f)).toContain("timestamptz '1990-01-01 00:00+00'");
    const cleanup = importRetireSQL(f);
    expect(cleanup).not.toMatch(/\bdelete from\b|\btruncate\b/i);
    expect(cleanup).toContain(`'${f.a}','delete_request'`);
    expect(cleanup).toContain(`'${f.b}','delete_request'`);
  });
  it.each(["grant", "order", "blast", "imports", "running"])("refuses %s drift before any insert", async (mode) => {
    const query = vi.fn()
      .mockResolvedValueOnce(mode === "grant" ? importGrants.slice(1) : importGrants)
      .mockResolvedValueOnce([{ locked: mode !== "order" }])
      .mockResolvedValueOnce([{ candidates: mode === "blast" ? 1 : 0, imports: mode === "imports" ? 1 : 0, running: mode === "running" ? 1 : 0 }]);
    await expect(importPreflight(query)).rejects.toThrow();
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("insert into"))).toBe(true);
  });

  type Mode = { blocked: [boolean, boolean]; erased: number; aState?: object; bState?: object; replay?: boolean };
  const ok: Mode = { blocked: [true, true], erased: 0 };
  function transport(mode: Mode) {
    let time = 0, pairing = -1, calls = 0;
    let release: (rows: unknown[]) => void = () => {};
    const hold = () => new Promise<unknown[]>((resolve) => { release = resolve; });
    const query = vi.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("unnest(array[")) return importGrants;
      if (sql.includes(" as locked")) return [{ locked: true }];
      if (sql.includes(" as candidates")) return [{ candidates: 0, imports: 0, running: 0 }];
      if (sql.includes("insert into public.users")) return [];
      if (sql.includes("customer_consent_import_begin(")) return [{ import_id: "00000000-0000-4000-8000-00000000000" + (pairing + 2) }];
      if (sql.includes("customer_consent_import_chunk(")) return [];
      if (sql.includes(" as ready")) return [{ ready: true }];
      if (sql.includes("pg_blocking_pids")) return [{ blocked: mode.blocked[pairing] }];
      const isFinish = sql.includes("customer_consent_import_finish(");
      const isSweep = sql.includes("customer_retention_sweep(");
      if (isFinish || isSweep) {
        expect(sql).toContain("set local role service_role");
        // Calls in order: finish holds (I), sweep races (I), sweep holds (II), finish races (II).
        calls += 1;
        expect(isFinish).toBe(calls === 1 || calls === 4);
        if (calls === 1 || calls === 3) { pairing += 1; return hold(); }
        time += 7000; release([]);
        return isSweep ? [{ result: { erased: mode.erased, skipped: 0 } }] : [{ result: { replay: mode.replay ?? false } }];
      }
      if (sql.includes(" as exported")) {
        return pairing === 0
          ? [mode.aState ?? { live: true, identifiers: 1, consent: "opted_in", exported: true }]
          : [mode.bState ?? { live: false, identifiers: 0, consent: "opted_out", exported: false }];
      }
      if (sql.includes("select public.customer_erase(")) return [];
      if (sql.includes(" as retired")) return [{ retired: true }];
      throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
    });
    const raceOptions = { now: () => time, sleep: async (ms: number) => { time += ms; } };
    return { query, raceOptions };
  }
  it.each<[string, Mode, boolean]>([
    ["both orders blocked, nobody opted in mid-erase", ok, true],
    ["the sweep did not block behind the finish", { ...ok, blocked: [false, true] }, false],
    ["the finish did not block behind the sweep", { ...ok, blocked: [true, false] }, false],
    ["the sweep erased the person the import opted in", { ...ok, erased: 1 }, false],
    ["the opted-in person lost their address", { ...ok, aState: { live: true, identifiers: 0, consent: "opted_in", exported: false } }, false],
    ["the person erased first came back opted in", { ...ok, bState: { live: false, identifiers: 0, consent: "opted_in", exported: false } }, false],
    ["the racing finish only replayed", { ...ok, replay: true }, false],
  ])("%s", async (_label, mode, passes) => {
    const { query, raceOptions } = transport(mode);
    const proof = runImportPairings(query, vi.fn(), raceOptions);
    if (passes) await proof; else await expect(proof).rejects.toThrow();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("select public.customer_erase("))).toHaveLength(1);
  });
});
