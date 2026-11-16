/**
 * W27 / B230 — migration 0335 pinned: the house header and gate line, the confirm writer's body (graph lock first,
 * the GUID's rows locked, refusals before any write), the ACL, the app's caller and its pre-0335 fallback, and the
 * executable PGlite proof.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const m = read("supabase/migrations/0335_toast_map_confirm_atomic.sql");
const body = (() => {
  const i = m.indexOf("create or replace function public.confirm_toast_mapping(");
  return m.slice(i, m.indexOf("end $$;", i));
})();

describe("0335_toast_map_confirm_atomic", () => {
  it("house header and gate line", () => {
    const lines = m.split("\n");
    expect(lines[0]).toBe("-- Migration 0335_toast_map_confirm_atomic");
    expect(lines[1]).toBe("-- AUTHORED 2026-11-16. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).");
    for (const h of ["-- WHAT:", "-- EXISTING ROWS:", "-- PRE-FLIGHT", "-- VERIFY AFTER APPLY:", "-- ROLLBACK:", "-- PROOF:", "-- LOCK ORDER:"]) expect(m).toContain(h);
    expect(m).toMatch(/\nbegin;\n/);
    expect(m.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("takes the graph lock, then the GUID's rows, before reading the target under the lock", () => {
    const graph = body.indexOf("perform pg_advisory_xact_lock(7258025800);");
    const rows = body.indexOf("for update;");
    const reread = body.indexOf("select * into v_row from public.toast_menu_map where id = p_map_id for update;");
    expect(graph).toBeGreaterThan(0);
    expect(graph).toBeLessThan(rows);
    expect(rows).toBeLessThan(reread);
    expect(body).toMatch(/where location_id = v_loc and toast_item_guid = v_guid and active\s+order by id\s+for update;/);
  });

  it("every refusal comes before the supersede, and open_item_guid is checked before any row is deactivated", () => {
    const supersede = body.indexOf("update public.toast_menu_map set active = false");
    expect(supersede).toBeGreaterThan(0);
    for (const code of ["toast_map:not_found", "toast_map:conflict", "toast_map:not_candidate", "toast_map:open_item_guid"]) {
      const at = body.lastIndexOf(`'${code}'`);
      expect(at, code).toBeGreaterThan(0);
      expect(at, code).toBeLessThan(supersede);
    }
    expect(supersede).toBeLessThan(body.indexOf("set match_status = 'confirmed'"));
  });

  it("is SECURITY DEFINER with a pinned search_path, EXECUTE for service_role only", () => {
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = pg_catalog, public");
    expect(m).toContain("revoke all on function public.confirm_toast_mapping(uuid, uuid, uuid) from public, anon, authenticated;");
    expect(m).toContain("grant execute on function public.confirm_toast_mapping(uuid, uuid, uuid) to service_role;");
  });

  it("the app calls it, keeps the pre-0335 sequence only as the missing-function fallback, and supersedes no row itself", () => {
    const src = read("lib/admin/toast-map.ts");
    const confirm = src.slice(src.indexOf("export async function confirmMapping("), src.indexOf("async function confirmMappingLegacy("));
    expect(confirm).toContain('rpc("confirm_toast_mapping"');
    expect(confirm).not.toContain(".update(");
    expect(confirm).toMatch(/PGRST202[\s\S]*42883[\s\S]*confirmMappingLegacy\(/);
  });

  it("the PGlite proof passes (scripts/sql-harness-0335.mjs)", () => {
    const out = execFileSync("node", ["scripts/sql-harness-0335.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/(\d+)\/\1 checks passed/);
  }, 60_000);
});

// ── confirmMapping's mapping of 0335's answers ─────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), update: vi.fn() }));
const SHOP = "00000000-0000-4000-8000-0000000000a1";
const MAP = "00000000-0000-4000-8000-0000000000d4";
const candidate = { id: MAP, location_id: SHOP, menu_item_id: "m1", item_id: null, package_id: null, sku_id: null, toast_item_guid: "g1",
  toast_item_name: "Sub", toast_price_cents: 100, match_status: "candidate", match_score: null, confirmed_at: null, is_modifier: false,
  disposition: "deplete", portion_qty: null, portion_unit: null, active: true };
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: () => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "neq"]) q[k] = () => q;
    q.maybeSingle = async () => ({ data: candidate, error: null });
    q.returns = async () => ({ data: [{ id: "rival", disposition: "deplete" }], error: null });
    q.update = (...args: unknown[]) => { mocks.update(...args); const u: Record<string, unknown> = {}; u.eq = () => u; u.then = (ok: (v: unknown) => unknown) => Promise.resolve({ error: null, count: 1 }).then(ok); return u; };
    return q;
  },
  rpc: mocks.rpc,
}) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
const { confirmMapping } = await import("@/lib/admin/toast-map");
const gm = { user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: [SHOP] } as unknown as AuthContext;

describe("confirmMapping over 0335", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.audit.mockResolvedValue(undefined); });

  it("one RPC call, no TS supersede, the audit row takes `superseded` from the function", async () => {
    mocks.rpc.mockResolvedValue({ data: { superseded: 2, location_id: SHOP }, error: null });
    await confirmMapping(gm, MAP);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_toast_mapping", { p_map_id: MAP, p_location_id: SHOP, p_actor: "u-gm" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "toast_map.confirm", metadata: expect.objectContaining({ superseded: 2 }) }));
  });

  it.each([
    ["toast_map:conflict", 409, "conflict"], ["toast_map:not_candidate", 409, "not_candidate"],
    ["toast_map:open_item_guid", 409, "open_item_guid"], ["toast_map:not_found", 404, "not_found"],
  ])("%s → %i %s, no audit row", async (message, status, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    await expect(confirmMapping(gm, MAP)).rejects.toMatchObject({ status, code });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("without 0335 the pre-0335 sequence runs (the app keeps working before the apply)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.confirm_toast_mapping" } });
    await confirmMapping(gm, MAP);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "toast_map.confirm", metadata: expect.objectContaining({ superseded: 1 }) }));
  });
});
