/**
 * Audit W18/B107 — 0324 pinned: house header, gate line, the internal par loop a VERBATIM copy of 0261
 * apply_sku_pack_change's (line-subsequence), the apply taking THE SAME SKU LOCK first, the snapshot
 * re-check under it, the retire through 0259's writer, and the ACL. The executable proof is
 * scripts/sql-harness-0324.mjs (PGlite: the REAL 0259 + 0260 + 0261 + 0324), run here.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0324_sku_pack_back_to_default.sql", "utf8").replace(/\r\n/g, "\n");
const m0261 = readFileSync("supabase/migrations/0261_sku_pack_change_requests.sql", "utf8").replace(/\r\n/g, "\n");
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)) + to.length);
const loop0261 = between(m0261, "  if p_par_changes is not null and jsonb_typeof(p_par_changes) <> 'array' then", "  end loop;\n");
const helper = between(sql, "create or replace function public.sku_pack_apply_par_changes(", "\n$$;\n");
const apply = between(sql, "create or replace function public.apply_sku_pack_back_to_default(", "\n$$;\n");

describe("0324_sku_pack_back_to_default", () => {
  it("header + gate line", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0324_sku_pack_back_to_default");
    expect(sql.split("\n")[1]).toBe("-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).");
    expect(sql).toContain("begin;\n");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("refuses before 0259 + 0261", () => {
    expect(sql).toContain("raise exception '0324: 0259 + 0261 (pack versions, the pack-change snapshot and apply) must be applied first';");
  });
  it("the internal loop is 0261's par-conversion loop, VERBATIM (every line, in order)", () => {
    const lines = loop0261.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThan(80);
    let at = 0;
    for (const line of lines) {
      const i = helper.indexOf(`${line}\n`, at);
      expect(i, line).toBeGreaterThan(-1);
      at = i + line.length;
    }
    expect(helper).toContain("security invoker\nset search_path = pg_catalog, public");
  });
  it("0261's apply_sku_pack_change is NOT re-emitted (the live writer stays byte-identical)", () => {
    expect(sql).not.toContain("create or replace function public.apply_sku_pack_change(");
  });
  it("the apply: definer, the SKU lock FIRST, the snapshot re-taken under it, then 0259's retire, then the loop", () => {
    expect(apply).toContain("security definer\nset search_path = pg_catalog, public");
    const lock = apply.indexOf("perform 1 from public.vendor_items where id = p_sku and active for update;");
    const body = apply.indexOf("begin\n");
    expect(apply.slice(body, lock).replace(/--[^\n]*\n/g, "").trim()).toBe("begin");
    const snap = apply.indexOf("public.sku_pack_change_snapshot(p_sku, v_shops) is distinct from p_snapshot");
    const retire = apply.indexOf("perform public.retire_sku_pack_version(p_version, p_actor);");
    const pars = apply.indexOf("public.sku_pack_apply_par_changes(p_sku, p_location, p_par_changes, p_actor)");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(snap);
    expect(snap).toBeLessThan(retire);
    expect(retire).toBeLessThan(pars);
    for (const code of ["dependencies_changed", "not_found", "version_sku_mismatch", "not_live", "location_required"]) {
      expect(apply).toContain(`'sku_pack_change:${code}'`);
    }
  });
  it("ACL: the apply for service_role only, the loop for nobody, asserted in the file", () => {
    expect(sql).toContain("revoke all on function public.sku_pack_apply_par_changes(uuid, uuid, jsonb, uuid) from public, anon, authenticated, service_role;");
    expect(sql).toContain("revoke all on function public.apply_sku_pack_back_to_default(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.apply_sku_pack_back_to_default(uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;");
    expect(sql).toContain("raise exception '0324: unexpected execute grant on %', f_loop;");
    expect(sql).toContain("raise exception '0324: PUBLIC holds EXECUTE on a 0324 function';");
  });
  it("the PGlite harness passes on the real migrations", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0324.mjs"], { encoding: "utf8" });
    expect(out).toContain("PASS 0324:");
  }, 120_000);
});
