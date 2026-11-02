import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("0287 correction SQL harness", () => {
  it("executes correction refusals, authority parity and dual-accept compatibility in ephemeral PGlite", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0287.mjs"], {
      encoding: "utf8", timeout: 120_000,
    });
    expect(output).toContain("0287 correction behavior: non-open/reference/prep/live/window/reason refusals verified");
    expect(output).toContain("0287 authority: 45 role/membership cases");
    expect(output).toContain("level 8+ without membership preserved");
    expect(output).toContain("0287 contracts: service-only ACLs, signatures, lock order and after-lock clock verified");
    expect(output).toContain("legacy + filtered pass; stale revoke with prior revoked head rejected");
    expect(output).toContain("KNOWN TRANSITION LIMITATION: first-revoke filtered snapshot also matches legacy set");
    expect(output).toContain("PASS 0287:");
    expect(output).toContain("two-connection sim proof NOT RUN");
  }, 130_000);
});


describe("0287 SIM proof safety and coverage (not executed)", () => {
  const script=readFileSync("scripts/sim/checklist-0287-lock-check.mjs", "utf8");
  it("validates the SIM target before importing pg or constructing connections", () => {
    const guard=script.indexOf("if (!target.ok) throw new Error('SIM target refused')");
    expect(guard).toBeGreaterThan(script.indexOf("simDatabaseTarget(process.env.SIM_DATABASE_URL)"));
    expect(script.indexOf("await import('pg')")).toBeGreaterThan(guard);
    expect(script.indexOf("new pg.Client(target.config)")).toBeGreaterThan(guard);
    expect(script).not.toMatch(/dotenv|DATABASE_URL(?!\))/);
    expect(script).toContain("import.meta.url===pathToFileURL(process.argv[1]).href");
  });
  it("runs all six actual writers in every ordered pair and proves database blocking", () => {
    for (const rpc of ["checklist_write_completion", "checklist_submit_batch", "checklist_confirm_instance",
      "checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"]) {
      expect(script).toContain(`select public.${rpc}(`);
    }
    expect(script).toContain("for (const first of Object.keys(operations)) for (const second of Object.keys(operations))");
    expect(script).toContain("await a.query(operations[first].sql,operations[first].params)");
    expect(script).toContain("const waiter = race(b,operations[second])");
    expect(script).toContain("pg_blocking_pids($2::int)");
    expect(script).toContain("assert.notEqual(pidA,pidB,'independent backends')");
    expect(script).toMatch(/await blocked\(\);\s+await a\.query\('rollback'\);\s+const result = await waiter;/);
    expect(script).toContain("await b.query('rollback')");
    expect(script).toContain("await a.query(CONFIRM,[args.actor,args.instance,await snapshot()]); await a.query('commit')");
    expect(script).toContain("for (const name of ['revoke','reason','authority'])");
    expect(script).toContain("assert.equal(result.message,'instance_not_open')");
    expect(script).toContain("KNOWN TRANSITION LIMIT");
  });
});
