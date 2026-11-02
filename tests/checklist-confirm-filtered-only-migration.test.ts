import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8").replace(/\r\n/g, "\n");
const previous = read("0287_checklist_corrections_serialized");
const sql = read("0288_checklist_confirm_filtered_only");
const body = (source: string) => source.match(/create or replace function public\.checklist_confirm_instance\([\s\S]*?end \$\$;/)?.[0] ?? "";

describe("0288 filtered-only checklist confirmation (file only)", () => {
  it("preserves every byte of 0287's function except the intended tightening", () => {
    const expected = body(previous)
      .replace("v_live uuid[]; ", "")
      .replace("  -- 0287 transition: old deployments send all unsuperseded heads; new ones\n  -- send only unrevoked heads. Tighten to filtered-only after the drain.", "  -- The expected set is the unrevoked live heads.")
      .replace("  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_live\n    from public.checklist_completions where instance_id = p_instance and superseded_at is null;\n", "")
      .replace("v_live is distinct from v_expected and ", "");
    expect(expected).not.toBe("");
    expect(body(sql)).toBe(expected);
    expect(body(sql)).not.toContain("v_live");
  });

  it("preserves the post-grant execution assertions and only this function's grants", () => {
    const grants = (source: string) => source.slice(source.indexOf("revoke all on function public.checklist_confirm_instance"), source.indexOf("INSERT INTO public.audit_log"));
    const expected = grants(previous)
      .replace("    'public.checklist_revoke_completion(uuid,uuid)'::regprocedure,\n", "")
      .replace("    'public.checklist_revoke_with_reason(uuid,uuid,text,text)'::regprocedure,\n", "")
      .replace("    'public.checklist_mark_not_done(uuid,uuid,text)'::regprocedure,\n", "")
      .replaceAll("0287:", "0288:");
    expect(expected).not.toBe("");
    expect(grants(sql)).toBe(expected);
    expect(sql.match(/INSERT INTO public.audit_log/g)).toHaveLength(1);
    expect(sql.match(/create or replace function/g)).toHaveLength(1);
  });

  it("documents the drain gate, verification and forward rollback", () => {
    expect(sql).toContain("AUTHORED 2026-11-01. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0287.");
    for (const text of ["Provenance:", "ROLLOUT:", "VERIFY AFTER APPLY:", "ROLLBACK:", "a6b2a0ca", "NEW migration", "expected 0287 dual-accept confirmation"]) expect(sql).toContain(text);
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/\bdelete\s+from\b|\b(?:alter|drop)\s+(?:table|policy)\b/i);
  });

  it("executes real 0276, 0287 and 0288 with filtered snapshots and a committed revoke", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0288.mjs"], { encoding: "utf8", timeout: 300_000 });
    for (const text of ["service-only grants, execution context", "legacy unfiltered refused; filtered accepted", "committed first revoke caught", "non-dual-accept body refused", "PASS 0288:", "two-connection sim proof NOT RUN"]) expect(output).toContain(text);
  }, 320_000);
});
