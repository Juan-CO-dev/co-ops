/**
 * Juan's ruling 2026-11-11 — one CO-OPS person, one 7shifts account PER SHOP (each shop is its own LLC); a
 * few accounts span both shops (one account, two links). Migration 0301 pinned: header, the executable
 * PGlite proof, the index swap on BOTH sides, the re-emitted writer (definer, pinned, locked, service_role
 * only, the per-shop refusals), the data check over existing rows, 0269 untouched.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0301_sevenshifts_per_shop_links.sql", "utf8"));
const m0269 = normalize(readFileSync("supabase/migrations/0269_sevenshifts_links.sql", "utf8"));

describe("0301_sevenshifts_per_shop_links", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0301_sevenshifts_per_shop_links"
        && /^-- AUTHORED 2026-11-11\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0269\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO SIM 2026-11-12 (schema_migrations version 20261112000001, name 'sevenshifts_per_shop_links')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the REAL helpers + 0243 + 0268 + 0269 + 0301 on synthetic rows, over an existing 0269 link) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0301.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0301:");
  }, 260_000);

  it("the index swap on BOTH sides: one_live_user and one_live_remote dropped; one_live_user_shop and one_live_remote_shop UNIQUE per shop WHERE active", () => {
    expect(src).toContain("drop index public.sevenshifts_user_links_one_live_user;");
    expect(src).toContain("drop index public.sevenshifts_user_links_one_live_remote;");
    expect(src).toContain("create unique index sevenshifts_user_links_one_live_user_shop\n  on public.sevenshifts_user_links (user_id, linked_at_location_id) where active;");
    expect(src).toContain("create unique index sevenshifts_user_links_one_live_remote_shop\n  on public.sevenshifts_user_links (sevenshifts_user_id, linked_at_location_id) where active;");
    expect(src).not.toMatch(/drop index public\.sevenshifts_user_links_shop/);
  });

  it("the preflight accepts the existing 0269 rows: the exact 0269 index set, and a DATA CHECK that no live (user, shop) / (remote, shop) collides", () => {
    expect(src).toContain("'sevenshifts_user_links_one_live_remote', 'sevenshifts_user_links_one_live_user',\n                                   'sevenshifts_user_links_pkey', 'sevenshifts_user_links_shop'");
    expect(src).toContain("raise exception '0301: the live index set on sevenshifts_user_links differs from 0269 (%): refusing'");
    expect(src).toContain("select 1 from public.sevenshifts_user_links where active group by user_id, linked_at_location_id having count(*) > 1");
    expect(src).toContain("select 1 from public.sevenshifts_user_links where active group by sevenshifts_user_id, linked_at_location_id having count(*) > 1");
    expect(src).toContain("raise exception '0301: % live (user, shop) / (remote, shop) collisions in sevenshifts_user_links: refusing', v_dup;");
    // No row is updated, deleted or rewritten by the migration.
    expect(src).not.toMatch(/\n\s*(update|delete from|truncate) public\.sevenshifts_user_links/);
  });

  it("the re-emitted writer keeps every 0269 rule and judges both refusals per shop; 0269's own text is untouched", () => {
    const fn = extractFunction(src, "create or replace function public.link_sevenshifts_user(p_actor uuid, p_location uuid, p_remote_user bigint, p_user uuid)", "end $$;");
    expect(fn).toContain("returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$");
    expect(fn).toContain("perform pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0));");
    expect(fn).toContain("v_actor := public.toast_link_actor_level(p_actor, p_location);");
    expect(fn).toContain("v_subject := public.assignment_user_level(p_user, p_location);");
    expect(fn).toContain("if v_subject > v_actor then raise exception 'role_insufficient'; end if;");
    expect(fn).toContain("raise exception 'remote_not_at_shop';");
    // the same account at this shop: same person → changed:false, another → remote_already_linked
    expect(fn).toContain("where sevenshifts_user_id = p_remote_user and linked_at_location_id = p_location and active;");
    expect(fn).toContain("if v_live.user_id = p_user then return jsonb_build_object('id', v_live.id, 'changed', false); end if;");
    // the account belongs to one person, at any shop
    expect(fn).toContain("if exists (select 1 from public.sevenshifts_user_links where sevenshifts_user_id = p_remote_user and user_id <> p_user and active) then");
    // one account per (user, shop)
    expect(fn).toContain("if exists (select 1 from public.sevenshifts_user_links where user_id = p_user and linked_at_location_id = p_location and active) then");
    expect(fn).toContain("raise exception 'user_already_linked';");
    expect(fn).not.toMatch(/name/i);
    expect(src).toContain("revoke all on function public.link_sevenshifts_user(uuid, uuid, bigint, uuid) from public, anon, authenticated;");
    expect(src).toContain("grant execute on function public.link_sevenshifts_user(uuid, uuid, bigint, uuid) to service_role;");
    expect(src).not.toMatch(/create (or replace )?function public\.(unlink_sevenshifts_user|link_sevenshifts_location|unlink_sevenshifts_location|toast_link_actor_level|assignment_user_level)/);
    // 0269 still carries its original one-per-side indexes (its own pin) — 0301 is the only place they move.
    expect(m0269).toContain("create unique index sevenshifts_user_links_one_live_user on public.sevenshifts_user_links (user_id) where active;");
    expect(m0269).toContain("create unique index sevenshifts_user_links_one_live_remote on public.sevenshifts_user_links (sevenshifts_user_id) where active;");
    expect(m0269).toContain("if exists (select 1 from public.sevenshifts_user_links where user_id = p_user and active) then");
  });
});
