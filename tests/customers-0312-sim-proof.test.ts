/** W12/B070: the sim-only two-session proof script, exercised offline with a fake transport (never run here). */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CUTOFF, EXPORT_DATE, IMPORT_SOURCE, fixture, fixtureSQL, holderSQL, importFixture, importFixtureSQL, importPreflight,
  importPersonBSQL, importRetireSQL, importSignatures, preflight, racerSQL, retireSQL, runImportPairings, runProof, signatures, userColumns,
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
    expect(cleanup).toContain("'delete_request'");
    expect(cleanup).toContain(`c.id in ('${f.a}','${f.b}')`);
  });
  it.each(["grant", "order", "blast", "imports", "running"])("refuses %s drift before any insert", async (mode) => {
    const query = vi.fn()
      .mockResolvedValueOnce(mode === "grant" ? importGrants.slice(1) : importGrants)
      .mockResolvedValueOnce([{ locked: mode !== "order" }])
      .mockResolvedValueOnce([{ candidates: mode === "blast" ? 1 : 0, imports: mode === "imports" ? 1 : 0, running: mode === "running" ? 1 : 0 }]);
    await expect(importPreflight(query)).rejects.toThrow();
    expect(query.mock.calls.every(([sql]) => !String(sql).includes("insert into"))).toBe(true);
  });

  // r2 (review P2): the fake no longer supplies the sweep's erased count. It models the fixture rows the
  // script's SQL creates (people from its inserts, opt-ins from completed finishes, erasures) and the sweep
  // erases exactly the live, unconsented ones: the sweep's eligibility at the 1990-01-02 cutoff (every fixture
  // person is last seen 1990-01-01). The database-backed version is sql-harness-0312's sim-fixture block.
  type Mode = { blocked: [boolean, boolean]; sweepIgnoresConsent?: boolean; aState?: object; bState?: object; replay?: boolean };
  const ok: Mode = { blocked: [true, true] };
  function transport(mode: Mode) {
    let time = 0, pairing = -1, calls = 0, imports = 0;
    let release: (rows: unknown[]) => void = () => {};
    const hold = () => new Promise<unknown[]>((resolve) => { release = resolve; });
    const people = new Map<string, { email: string; consented: boolean; erased: boolean }>();
    const importEmail = new Map<string, string>();
    const sweeps: number[] = [];
    const log: string[] = [];
    const finish = (sql: string) => {
      const id = /customer_consent_import_finish\('[^']+','([^']+)'/.exec(sql)![1]!;
      for (const p of people.values()) if (p.email === importEmail.get(id) && !p.erased) p.consented = true;
      return [{ result: { replay: mode.replay ?? false } }];
    };
    const sweep = () => {
      const erased = [...people.values()].filter((p) => !p.erased && (mode.sweepIgnoresConsent || !p.consented));
      for (const p of erased) p.erased = true;
      sweeps.push(erased.length);
      return [{ result: { erased: erased.length, skipped: 0 } }];
    };
    const query = vi.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes("unnest(array[")) return importGrants;
      if (sql.includes(" as locked")) return [{ locked: true }];
      if (sql.includes(" as candidates")) return [{ candidates: 0, imports: 0, running: 0 }];
      if (sql.includes("insert into public.customers")) {
        for (const [, id, email] of sql.matchAll(/customer_identifiers\([^)]*\)\s*values\('([0-9a-f-]+)','email','([^']+)'/g)) {
          people.set(id!, { email: email!, consented: false, erased: false });
          log.push(`create ${email}`);
        }
        return [];
      }
      if (sql.includes("customer_consent_import_begin(")) {
        const id = `00000000-0000-4000-8000-00000000000${++imports}`;
        importEmail.set(id, /sim-0312i-[ab]-[0-9a-f-]+@example\.test/.exec(sql)![0]);
        return [{ import_id: id }];
      }
      if (sql.includes("customer_consent_import_chunk(")) return [];
      if (sql.includes(" as ready")) return [{ ready: true }];
      if (sql.includes("pg_blocking_pids")) return [{ blocked: mode.blocked[pairing] }];
      const isFinish = sql.includes("customer_consent_import_finish(");
      const isSweep = sql.includes("customer_retention_sweep(");
      if (isFinish || isSweep) {
        expect(sql).toContain("set local role service_role");
        // Calls in order: finish holds (I), sweep races (I), sweep holds (II), finish races (II). The holder's
        // effect lands first (it commits first); the racer then sees it.
        calls += 1;
        expect(isFinish).toBe(calls === 1 || calls === 4);
        log.push(isFinish ? "finish" : "sweep");
        const rows = isFinish ? finish(sql) : sweep();
        if (calls === 1 || calls === 3) { pairing += 1; return hold(); }
        time += 7000; release([]);
        return rows;
      }
      if (sql.includes(" as exported")) {
        const id = /where id='([0-9a-f-]+)'/.exec(sql)![1]!;
        const p = people.get(id)!;
        const isA = p.email.includes("-a-");
        const override = isA ? mode.aState : mode.bState;
        if (override && (pairing === 0) === isA) return [override];
        return [{ live: !p.erased, identifiers: p.erased ? 0 : 1, consent: p.erased ? "opted_out" : p.consented ? "opted_in" : null,
          exported: p.consented && !p.erased }];
      }
      if (sql.includes("select public.customer_erase(")) {
        for (const p of people.values()) p.erased = true;
        log.push("retire");
        return [];
      }
      if (sql.includes(" as retired")) return [{ retired: [...people.values()].every((p) => p.erased) }];
      throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
    });
    const raceOptions = { now: () => time, sleep: async (ms: number) => { time += ms; } };
    return { query, raceOptions, sweeps, log };
  }
  it.each<[string, Mode, boolean]>([
    ["both orders blocked, nobody opted in mid-erase", ok, true],
    ["the sweep did not block behind the finish", { ...ok, blocked: [false, true] }, false],
    ["the finish did not block behind the sweep", { ...ok, blocked: [true, false] }, false],
    ["the sweep erased the person the import opted in", { ...ok, sweepIgnoresConsent: true }, false],
    ["the opted-in person lost their address", { ...ok, aState: { live: true, identifiers: 0, consent: "opted_in", exported: false } }, false],
    ["the person erased first came back opted in", { ...ok, bState: { live: false, identifiers: 0, consent: "opted_in", exported: false } }, false],
    ["the racing finish only replayed", { ...ok, replay: true }, false],
  ])("%s", async (_label, mode, passes) => {
    const { query, raceOptions } = transport(mode);
    const proof = runImportPairings(query, vi.fn(), raceOptions);
    if (passes) await proof; else await expect(proof).rejects.toThrow();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("select public.customer_erase("))).toHaveLength(1);
  });
  it("creates B only after pairing I, so pairing I's sweep has no candidate and pairing II's erases exactly B", async () => {
    const { query, raceOptions, sweeps, log } = transport(ok);
    await runImportPairings(query, vi.fn(), raceOptions);
    expect(sweeps).toEqual([0, 1]);
    expect(log.map((l) => l.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, "<id>"))).toEqual([
      "create sim-0312i-a-<id>@example.test", "finish", "sweep",
      "create sim-0312i-b-<id>@example.test", "sweep", "finish", "retire",
    ]);
  });
  it("a run that stops in pairing I never creates B and still retires what it created", async () => {
    const { query, raceOptions, log } = transport({ ...ok, blocked: [false, true] });
    await expect(runImportPairings(query, vi.fn(), raceOptions)).rejects.toThrow(/racer must have an ungranted lock/);
    expect(log.some((l) => l.includes("sim-0312i-b-"))).toBe(false);
    expect(log.at(-1)).toBe("retire");
    expect(importRetireSQL(importFixture())).toMatch(/customer_erase\([^)]*c\.id,'delete_request'\) from public\.customers c where c\.id in \(/);
  });
  it("the fixture SQL creates only A up front; B has its own insert", () => {
    const f = importFixture();
    expect(importFixtureSQL(f)).toContain(f.emailA);
    expect(importFixtureSQL(f)).not.toContain(f.emailB);
    expect(importPersonBSQL(f)).toContain(f.emailB);
    expect(importPersonBSQL(f)).not.toContain(f.emailA);
  });
});
