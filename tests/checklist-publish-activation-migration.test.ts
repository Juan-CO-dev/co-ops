/**
 * Migration 0320 (bug audit 2026-11-14, wave W15). The executable proof is scripts/sql-harness-0320.mjs
 * (the real 0255 body + the real 0320 in ephemeral PGlite). This pin runs it in CI, pins section D's
 * re-emit of submit_phase2_atomic as a line-subsequence of 0255, and pins the file's gate and guards.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const read = (f: string) => readFileSync(`${MIGRATIONS}/${f}`, "utf8").replace(/\r\n/g, "\n");
const FILE = "0320_checklist_publish_activation.sql";
const SOURCE = "0255_under_par_alert_recipients.sql";
const START = "CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(";
const END = "$function$;";
const sql = read(FILE);

function extract(src: string): string {
  const a = src.indexOf(START);
  expect(a, "function start not found").toBeGreaterThan(-1);
  const b = src.indexOf(END, a);
  return src.slice(a, b + END.length);
}
function isLineSubsequence(needle: string, hay: string): { ok: boolean; missing: string | null } {
  const n = needle.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const h = hay.split("\n").map((l) => l.trimEnd());
  let j = 0;
  for (const line of n) {
    while (j < h.length && h[j] !== line) j++;
    if (j >= h.length) return { ok: false, missing: line };
    j++;
  }
  return { ok: true, missing: null };
}

describe("0320 checklist publish activation", () => {
  it("runs the offline SQL harness clean", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0320.mjs"], { encoding: "utf8", timeout: 300_000 });
    expect(output).toContain("PASS 0320:");
    expect(output).not.toContain("FAIL");
  });

  it("is file-only, in one transaction, and refuses by name", () => {
    expect(sql).toMatch(/^-- Migration 0320_checklist_publish_activation\n-- AUTHORED 2026-11-15\. NOT YET APPLIED/);
    expect(sql).not.toMatch(/APPLIED TO (SIM|PROD)/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).toContain("re-base section D onto the live body");
    expect(sql).toContain("'b9c7e346da007e37befb87ec07b716bb'");
  });

  it("section D: 0255 is the previous latest definer of submit_phase2_atomic", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) => read(f).includes(START));
    expect(defining[defining.length - 1]).toBe(FILE);
    expect(defining[defining.length - 2]).toBe(SOURCE);
  });

  it("section D: the 0255 body is a line-subsequence of the 0320 body (nothing dropped)", () => {
    const check = isLineSubsequence(extract(read(SOURCE)), extract(sql));
    expect(check.ok, `0255 line missing from 0320 → ${check.missing}`).toBe(true);
  });

  it("section D: BOTH universe queries keep only items with a live Phase 1 row on this instance (B085)", () => {
    const body = extract(sql);
    const clause = /AND EXISTS \(\s*SELECT 1 FROM checklist_completions p1\s*WHERE p1\.instance_id = p_opening_instance_id\s*AND p1\.template_item_id = cti\.id\s*AND p1\.prep_data \? 'phase1'\s*AND p1\.superseded_at IS NULL\s*AND p1\.revoked_at IS NULL\s*\)/g;
    expect(body.match(clause)).toHaveLength(2);
    // The only additions are those two clauses and their comments.
    const added = body.split("\n").filter((l) => !extract(read(SOURCE)).split("\n").includes(l));
    for (const l of added) expect(l.trim()).toMatch(/^(--|AND EXISTS \(|SELECT 1 FROM checklist_completions p1|WHERE p1\.|AND p1\.|\)$)/);
  });

  it("B and C share ONE lineage key and take it first", () => {
    const rpc = sql.slice(sql.indexOf("create or replace function public.checklist_template_activate_version("), sql.indexOf("-- ── C."));
    const guard = sql.slice(sql.indexOf("create or replace function public.checklist_instance_lineage_guard()"), sql.indexOf("-- ── D."));
    for (const body of [rpc, guard]) expect(body).toContain("perform pg_advisory_xact_lock(public.checklist_lineage_lock_key(");
    // In the RPC, the key comes before any row lock or write.
    expect(rpc.indexOf("pg_advisory_xact_lock")).toBeLessThan(rpc.indexOf("for no key update"));
    expect(rpc.indexOf("for no key update")).toBeLessThan(rpc.indexOf("update public.checklist_templates"));
    for (const name of ["stale_source", "apply_now_blocked_open_instance", "item_map_invalid", "version_not_activatable"]) expect(rpc).toContain(`'${name}'`);
    expect(guard).toContain("'checklist_instance_lineage_taken' using errcode = 'P0001'");
  });
});
