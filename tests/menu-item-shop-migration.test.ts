/** Catalog Phase 3a — migration 0263 pinned: the shop overlay, its three writers, its privilege ceiling. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0263_menu_item_shop_settings.sql", "utf8"));
const WRITERS = ["save_menu_item_shop_setting", "retire_menu_item_shop_setting", "promote_menu_item_shop_setting"];

describe("0263", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0263_menu_item_shop_settings"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016000001, name 'menu_item_shop_settings')", ...rest].join("\n"))).toBe(true);
  });
  it("the executable proof (PGlite: the REAL 0258 → 0263 on synthetic rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0263.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0263:");
  }, 260_000);
  it("shop rows only, dated, one live per (menu item, shop), and a row must say something", () => {
    expect(src).toContain("location_id         uuid          not null references public.locations(id)");
    expect(src).toContain("constraint menu_item_shop_settings_live_window check ((valid_to is null) = active)");
    expect(src).toContain("on public.menu_item_shop_settings (menu_item_id, location_id) where active;");
    expect(src).toContain("constraint menu_item_shop_settings_says_something check");
  });
  it("every writer locks the menu item row first, is SECURITY DEFINER with a pinned search_path, service_role only", () => {
    for (const fn of WRITERS) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = pg_catalog, public");
      expect(body).toContain("from public.menu_items where id = ");
      expect(body.indexOf("for update")).toBeGreaterThan(-1);
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    expect(extractFunction(src, "create or replace function public.save_menu_item_shop_setting(", "\n$$;")).toContain("menu_item_shop:version_changed");
    const promote = extractFunction(src, "create or replace function public.promote_menu_item_shop_setting(", "\n$$;");
    expect(promote).toContain("menu_item_shop:global_changed");
    expect(promote).not.toContain("sold_here =");
  });
  it("every writer: graph lock → item row → closure locks → scoped snapshot re-check (Astra 3a r2#1–#3)", () => {
    for (const fn of WRITERS) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      const graph = body.indexOf("perform pg_advisory_xact_lock(7258025800);");
      const row = body.indexOf("from public.menu_items where id = ");
      const lock = body.indexOf("perform public.menu_item_change_lock(");
      const check = body.indexOf("public.menu_item_change_snapshot(");
      expect(graph).toBeGreaterThan(-1);
      expect(row).toBeGreaterThan(graph);
      expect(lock).toBeGreaterThan(row);
      expect(check).toBeGreaterThan(lock);
      expect(body).toContain("is distinct from p_snapshot");
      expect(body).toContain("'menu_item_shop:dependencies_changed'");
    }
    const snap = extractFunction(src, "create or replace function public.menu_item_change_snapshot(", "\n$$;");
    expect(snap).toContain("public.recipe_change_snapshot(r.recipe_id, p_location, null)");
    expect(src).not.toContain("-> 'tables'");
    expect(src).toContain("grant execute on function public.menu_item_change_snapshot(uuid, uuid) to service_role;");
  });
  it("promote: changed shops field by field, and the source shop returns to the default in the same transaction", () => {
    const promote = extractFunction(src, "create or replace function public.promote_menu_item_shop_setting(", "\n$$;");
    expect(promote).toContain("and ((v_price and not exists (select 1 from public.menu_item_shop_settings s");
    expect(promote).toContain("or (v_name and not exists (select 1 from public.menu_item_shop_settings s");
    expect(promote).not.toContain("((v_price and s.price is not null) or (v_name and s.name_override is not null))");
    const update = promote.indexOf("update public.menu_items");
    const retire = promote.indexOf("update public.menu_item_shop_settings set active = false, valid_to = v_now, retired_by = p_actor where id = v_row.id and active;");
    expect(retire).toBeGreaterThan(update);
    expect(promote).toContain("case when v_price then null else v_row.price end, v_row.sold_here,");
    expect(promote).toContain("'returned_shop', v_row.location_id");
  });
  it("privilege ceiling: deny-all RLS, revoke all (service_role too), grant exactly, asserted both ways", () => {
    expect(src).toContain("alter table public.menu_item_shop_settings enable row level security;");
    expect(src).toContain("create policy menu_item_shop_settings_no_user_delete on public.menu_item_shop_settings for delete using (false);");
    expect(src).toContain("revoke all on public.menu_item_shop_settings from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select, insert, update on public.menu_item_shop_settings to service_role;");
    expect(src).toContain("has_table_privilege('service_role', 'public.menu_item_shop_settings', 'DELETE')");
    expect(src).toContain("raise exception '0263: service_role above its ceiling'");
    expect(src).toContain("raise exception '0263: service_role is missing a privilege the writers need'");
    expect(src).toContain("raise exception '0263: unexpected execute grant'");
  });
});
