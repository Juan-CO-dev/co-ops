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
      "checklist_actor_level", "checklist_write_completion", "checklist_submit_batch", "checklist_confirm_instance", "written_report_update_self",
    ]);
    expect(statements.match(/security invoker/gi)).toHaveLength(5);
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
    expect(output).toContain("4392 shared cases");
    expect(output).toContain("mutation authenticated EXECUTE: rejected");
    expect(output).toContain("mutation anon EXECUTE: rejected");
    for (const writer of [1, 2, 3]) for (const kind of ["lock", "read-before-lock", "declare-call", "declare-query", "open"]) {
      expect(output).toContain(`mutation ${kind} writer ${writer}: rejected`);
    }
    expect(output).toContain("PASS 0276:");
    expect(output).toContain("two-connection sim proof NOT RUN");
  }, 320_000);
});

const correctionsSql = readFileSync("supabase/migrations/0287_checklist_corrections_serialized.sql", "utf8");
const cleanSql = (source: string) => source.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const confirmBody = (source: string) => source.match(/create (?:or replace )?function public\.checklist_confirm_instance\([\s\S]*?end \$\$;/i)?.[0] ?? "";

describe("0287 serialized corrections (file only)", () => {
  it("retains the unapplied gate, phased rollout, rollback and global lock contract", () => {
    expect(correctionsSql).toContain("AUTHORED 2026-11-01. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0286.");
    expect(correctionsSql).toContain("AM instance -> closing instance -> completion rows");
    for (const section of ["Provenance:", "ROLLOUT:", "VERIFY AFTER APPLY:", "ROLLBACK:"]) expect(correctionsSql).toContain(section);
    expect(correctionsSql).toContain("later tightening migration");
    expect(correctionsSql).toContain("after old deployments drain");
    expect(cleanSql(correctionsSql)).not.toMatch(/\bdelete\s+from\b|\b(?:alter|drop)\s+(?:table|policy)\b/i);
    expect(cleanSql(correctionsSql)).not.toMatch(/\b(?:grant|revoke)\b[^;]*\bon\s+(?:table\s+)?public\.checklist_instances/i);
  });

  it("preserves 0277's exact confirmation signature and all behavior except dual-accept comparison", () => {
    const previous = cleanSql(confirmBody(sql));
    const current = cleanSql(confirmBody(correctionsSql))
      .replace("create or replace function", "create function")
      .replace("v_live uuid[]; v_filtered uuid[];", "v_live uuid[];")
      .replace("select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_filtered from public.checklist_completions where instance_id = p_instance and superseded_at is null and revoked_at is null; ", "")
      .replace("v_live is distinct from v_expected and v_filtered is distinct from v_expected", "v_live is distinct from v_expected");
    expect(previous).not.toBe("");
    expect(current).toBe(previous);
  });

  it("adds only the three correction writers with service-only privileges and clocks after locks", () => {
    const names=["checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"];
    expect([...correctionsSql.matchAll(/create function public\.([a-z_]+)/g)].map(m=>m[1])).toEqual(names);
    expect(correctionsSql.match(/security invoker/gi)).toHaveLength(4);
    for (const name of names) {
      const body=cleanSql(correctionsSql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?end \\$\\$;`))?.[0] ?? "");
      expect(body).not.toBe("");
      const parent=body.indexOf("for no key update;");
      expect(parent).toBeGreaterThan(0);
      expect(body.lastIndexOf("for no key update;")).toBeGreaterThan(parent);
      expect(body).not.toContain("for update;");
      for (const code of ["reference_row_not_correctable", "prep_data_not_correctable"]) {
        expect(body.indexOf(`raise exception '${code}'`)).toBeLessThan(body.lastIndexOf("for no key update;"));
      }
      expect(body.indexOf("clock_timestamp()")).toBeGreaterThan(parent);
      for (const code of ["instance_not_open", "reference_row_not_correctable", "prep_data_not_correctable"]) expect(body).toContain(`raise exception '${code}'`);
      expect(correctionsSql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated;`));
      expect(correctionsSql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role;`));
    }
  });
});
