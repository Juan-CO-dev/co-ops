/**
 * Catalog Phase 2b — 0261 pinned: house header, gate line, deny-all + privilege ceiling, one open
 * report, and the atomic apply taking THE SAME SKU LOCK 0259's writers take, then the dependency
 * snapshot, then 0259's save_sku_pack_version inside it. The executable proof (atomic apply, the
 * all-or-nothing refusal, the snapshot re-check) is scripts/sql-harness-0261.mjs (PGlite).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0261_sku_pack_change_requests.sql", "utf8").replace(/\r\n/g, "\n");
const m0259 = readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8").replace(/\r\n/g, "\n");
const body = sql.slice(sql.indexOf("create or replace function public.apply_sku_pack_change("));
const LOCK = "from public.vendor_items where id = p_sku and active for update";

describe("0261_sku_pack_change_requests", () => {
  it("header + gate line", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0261_sku_pack_change_requests");
    expect(sql.split("\n")[1]).toBe("-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.");
  });
  it("the record, its status pairing, and one open report per (sku, shop)", () => {
    expect(sql).toContain("create table if not exists public.sku_pack_change_requests");
    expect(sql).toContain("check (status in ('open', 'applied', 'dismissed'))");
    expect(sql).toContain("check ((status = 'open') = (resolved_at is null))");
    expect(sql).toContain("check ((status = 'applied') = (resolved_version_id is not null))");
    expect(sql).toContain("on public.sku_pack_change_requests (sku_id, location_id) where status = 'open';");
  });
  it("deny-all AND a service-role privilege ceiling: revoke all (service_role too), grant exactly, assert both sets", () => {
    expect(sql).toContain("alter table public.sku_pack_change_requests enable row level security;");
    expect(sql).toContain("revoke all on public.sku_pack_change_requests from public, anon, authenticated, service_role;");
    expect(sql).toContain("grant select, insert, update on public.sku_pack_change_requests to service_role;");
    for (const p of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "SELECT", "INSERT", "UPDATE"]) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.sku_pack_change_requests', '${p}')`);
    }
    expect(sql).toContain("raise exception '0261: unexpected table grant'");
    expect(sql).toContain("raise exception '0261: service_role above its ceiling'");
    expect(sql).toContain("raise exception '0261: unexpected execute grant'");
  });
  it("apply_sku_pack_change + the snapshot: definer, locked search_path, service_role only", () => {
    expect(body).toMatch(/^create or replace function public\.apply_sku_pack_change\([\s\S]*?security definer\s+set search_path = pg_catalog, public/);
    const sig = "(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb)";
    expect(sql).toContain(`revoke all on function public.apply_sku_pack_change${sig} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function public.apply_sku_pack_change${sig} to service_role;`);
    expect(sql).toContain("create or replace function public.sku_pack_change_snapshot(p_sku uuid, p_shops uuid[])");
    expect(sql).toContain("revoke all on function public.sku_pack_change_snapshot(uuid, uuid[]) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.sku_pack_change_snapshot(uuid, uuid[]) to service_role;");
  });
  it("THE SAME SKU LOCK 0259's writers take, FIRST; then the snapshot re-taken and compared under it (2b r2#2)", () => {
    expect(m0259).toContain("from public.vendor_items vi where vi.id = p_sku and vi.active for update"); // save_sku_pack_version
    expect(m0259).toContain("perform 1 from public.vendor_items where id = p_sku and active for update;"); // the price writers
    const lock = body.indexOf(`perform 1 ${LOCK};`);
    expect(lock).toBeGreaterThan(-1);
    const firstStatement = body.indexOf("begin\n");
    expect(body.slice(firstStatement, lock).replace(/--[^\n]*\n/g, "").trim()).toBe("begin");
    expect(lock).toBeLessThan(body.indexOf("public.sku_pack_change_snapshot(p_sku, v_shops) is distinct from p_snapshot"));
    expect(body).toContain("'sku_pack_change:dependencies_changed'");
  });
  it("the report bound to this SKU and scope, then 0259's writer INSIDE the same transaction, then each par against its expected value", () => {
    const lock = body.indexOf(`perform 1 ${LOCK};`);
    expect(lock).toBeLessThan(body.indexOf("v_req.sku_id <> p_sku"));
    expect(body.indexOf("v_req.sku_id <> p_sku")).toBeLessThan(body.indexOf("public.save_sku_pack_version("));
    expect(body.indexOf("public.save_sku_pack_version(")).toBeLessThan(body.indexOf("is distinct from v_expected"));
    for (const code of ["par_changed", "request_mismatch", "request_not_open", "par_lane_mismatch", "invalid_patch", "invalid_payload", "sku_not_found"]) {
      expect(body).toContain(`'sku_pack_change:${code}'`);
    }
    expect(body).toContain("resolved_version_id = v_version");
  });
  it("a conversion that CREATES the shop's own slot (inherited global or auto) does so only while it is still EMPTY (2b r2#3)", () => {
    expect(body).toContain("if coalesce((v_change->>'inherited')::boolean, false) then");
    expect(body).toContain("v_from not in ('global', 'auto')");
    expect(body).toContain("insert into public.location_sku_settings (location_id, sku_id, updated_by) values (v_loc, p_sku, p_actor) returning * into v_row;");
    // chunk-2 review P3c: a concurrent insert of the shop's row is "the par moved", by name.
    expect(body).toMatch(/returning \* into v_row;\s+exception when unique_violation then\s+raise exception 'sku_pack_change:par_changed'/);
  });
});

describe("the executable proof (PGlite: the REAL 0259 + 0260 + 0261 on synthetic rows) runs green in CI", () => {
  it("atomic apply, all-or-nothing refusals, the snapshot re-check, own-par, report binding, privileges", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0261.mjs"], { encoding: "utf8", timeout: 180_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0261:");
  }, 200_000);
});
