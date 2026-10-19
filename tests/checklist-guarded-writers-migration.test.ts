import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0276_checklist_guarded_writers.sql", "utf8");

describe("0276 guarded checklist writers (file only)", () => {
  it("keeps the gate and changes no existing writers, table privileges or policies", () => {
    expect(sql).toContain("FILE ONLY; NOT APPLIED");
    const statements = sql.replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/\bdelete\s+from\b|\b(?:alter|drop)\s+(?:table|policy)\b/i);
    expect(statements).not.toMatch(/\b(?:grant|revoke)\b[^;]*\bon\s+(?:table\s+)?public\.checklist_instances/i);
    expect([...statements.matchAll(/create function public\.([a-z_]+)/g)].map(m => m[1])).toEqual([
      "checklist_actor_level", "checklist_write_completion", "checklist_submit_batch", "checklist_confirm_instance",
    ]);
    expect(statements.match(/security invoker/gi)).toHaveLength(4);
  });

  it("reuses the existing role map and binds prevalidated completion identity", () => {
    expect(sql).toContain("public.assignment_author_level(p_actor)");
    expect(sql).not.toMatch(/when 'owner' then/);
    expect(sql).toContain("if v_live is distinct from v_expected then raise exception 'completion_set_changed'");
    expect(sql).toContain("get diagnostics v_n = row_count");
  });

  it("runs real RLS/RPC parity, transaction behavior and privilege/lock/open mutations", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0276.mjs"], {
      encoding: "utf8", timeout: 300_000,
    });
    expect(output).toContain("3300 shared cases");
    expect(output).toContain("mutation authenticated EXECUTE: rejected");
    expect(output).toContain("mutation anon EXECUTE: rejected");
    for (const writer of [1, 2, 3]) for (const kind of ["lock", "open"]) {
      expect(output).toContain(`mutation ${kind} writer ${writer}: rejected`);
    }
    expect(output).toContain("PASS 0276:");
    expect(output).toContain("two-connection sim proof NOT RUN");
  }, 320_000);
});
