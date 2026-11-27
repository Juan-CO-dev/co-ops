import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cutoverSQL } from "../scripts/sim/toast-dedup-cutover-lock-check.mjs";

const sql = readFileSync("supabase/migrations/0351_toast_snapshot_dedup.sql", "utf8").replace(/\r\n/g, "\n");

describe("0351 cutover proof instrumentation (scripts/sim/toast-dedup-cutover-lock-check.mjs)", () => {
  it("adds only the session settings, the two pauses and the rollback; the file is otherwise byte-identical", () => {
    const out: string = cutoverSQL(sql, { name: "dd-cut-test", before11: 4, before12: 0 });
    const stripped = out
      .replace("\nset local application_name = 'dd-cut-test';\nset local lock_timeout = '10s';\nset local statement_timeout = '90s';\n", "\n")
      .replace("\nselect pg_sleep(4);\n-- 11. LAST lock", "\n-- 11. LAST lock")
      .replace("\nselect pg_sleep(0);\n-- 12. Final assertions.", "\n-- 12. Final assertions.")
      .replace("\nselect 'cutover_ok' as out, pg_backend_pid() as pid;\nrollback;\n", "\ncommit;\n");
    expect(stripped).toBe(sql);
    expect(out).not.toMatch(/\ncommit;\n/);
  });
});
