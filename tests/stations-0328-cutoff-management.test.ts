import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fixture, main, proofSQL, runProof } from "../scripts/sim/stations-0328-cutoff-check-management.mjs";
import { PROD_REF } from "../scripts/supabase-management-query.mjs";

describe("0328 Management API proof (offline only)", () => {
  it("refuses the production ref before any request", () => {
    expect(() => main([`--ref=${PROD_REF}`])).toThrow(/SIM/);
    expect(() => main([])).toThrow(/--ref/);
  });
  it("writes its fixture and reads it inside ONE transaction that rolls back", () => {
    const f = fixture() as Record<string, string>;
    const sql = proofSQL(f).trim();
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("rollback;")).toBe(true);
    expect(sql).not.toMatch(/\bcommit\b|\bupdate\b|\bdelete\b|\btruncate\b/i);
    expect(sql).toContain(`'${f.shop}'`);
    const source = readFileSync("scripts/sim/stations-0328-cutoff-check-management.mjs", "utf8");
    expect(source).not.toMatch(/import.*dotenv|SIM_DATABASE_URL|import\(['"]pg['"]\)/);
  });
  it("asserts the cutoff readings against a recorded fake transport", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("to_regprocedure")) return [{ present: true, executable: true, staff: false, delegates: true }];
      if (sql.includes("information_schema.columns")) return [
        ...["id", "name", "code", "type", "active"].map((c) => ({ table_name: "locations", column_name: c, is_nullable: "NO", column_default: null })),
        ...["id", "location_id", "type", "name", "active"].map((c) => ({ table_name: "checklist_templates", column_name: c, is_nullable: "NO", column_default: null })),
        ...["id", "template_id", "location_id", "date", "status", "shift_start_at"].map((c) => ({ table_name: "checklist_instances", column_name: c, is_nullable: "YES", column_default: null })),
      ];
      if (sql.startsWith("begin;")) return [{ at_2330: "2026-10-14", at_0059: "2026-10-14", at_0100: "2026-10-15", at_0700: "2026-10-15", wrapper_equal: true }];
      if (sql.includes("as clean")) return [{ clean: true }];
      throw new Error(`unexpected ${sql.slice(0, 40)}`);
    });
    const log = vi.fn();
    await runProof(query, log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("PASS 0328"));
    const pre0328 = vi.fn(async (sql: string) => (sql.includes("to_regprocedure") ? [{ present: false, executable: false, staff: false, delegates: false }] : []));
    await expect(runProof(pre0328, vi.fn())).rejects.toThrow(/0328 missing/);
  });
});
