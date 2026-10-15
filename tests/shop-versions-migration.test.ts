/**
 * Catalog Phase 2a — migrations 0259 + 0260 pinned: header + gate line; the dated version table
 * and its one-live index; the DB-proven level link; the lanes; the auto-par pack stamps; the six
 * writers (SECURITY DEFINER, locked search_path, service_role only, refused to PostgREST roles,
 * first-value decided under the SKU lock); the privilege ceilings; and the two re-emits as
 * line-subsequences of their latest definers ± the enumerated mods, nothing else.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REEMITS, applyMods, extractFunction, isLineSubsequence, normalize } from "../scripts/shop-versions/reemit-mods";

const DIR = "supabase/migrations";
const read = (f: string) => normalize(readFileSync(`${DIR}/${f}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const M0259 = "0259_sku_shop_versions.sql";
const M0260 = "0260_sku_pack_versions_finalize.sql";
const WRITERS = ["save_sku_pack_version", "retire_sku_pack_version", "save_sku_shop_price", "save_sku_global_price", "retire_sku_price_lane", "record_receiving_prices"];

describe("0259 / 0260 headers", () => {
  it("both carry the house header and the gate line", () => {
    for (const f of [M0259, M0260]) {
      const src = read(f);
      expect(src.split("\n")[0]).toBe(`-- Migration ${f.replace(/\.sql$/, "")}`);
      expect(src).toMatch(/NOT YET APPLIED — apply via MCP after review|APPLIED TO SIM \d{14}/);
    }
    expect(read(M0260)).toContain("ONLY AFTER the Phase 2a code is deployed");
  });
});

describe("0259 structure", () => {
  const src = read(M0259);
  it("dated versions: valid_from / valid_to paired with active, one live chain per (sku, scope)", () => {
    expect(src).toContain("create table if not exists public.sku_pack_versions");
    expect(src).toMatch(/scope_key\s+uuid\s+generated always as \(coalesce\(location_id, '00000000-0000-0000-0000-000000000000'::uuid\)\) stored/);
    expect(src).toContain("check ((valid_to is null) = active)");
    expect(src).toContain("on public.sku_pack_versions (sku_id, scope_key) where active;");
    expect(src).toContain("on public.sku_pack_versions (sku_id, scope_key, valid_from);");
  });
  it("levels: the DB-proven composite FK and the scoped label index replacing the old one", () => {
    expect(src).toContain("add column if not exists version_id  uuid null");
    expect(src).toContain("foreign key (version_id, sku_id, scope_key)");
    expect(src).toContain("drop index if exists public.sku_pack_levels_sku_label_active;");
    expect(src).toContain("on public.sku_pack_levels (sku_id, scope_key, label) where active;");
  });
  it("the backfill asserts instead of hoping", () => {
    expect(src).toContain("pack levels left without a version");
    expect(src).toContain("would have two live global chains");
    expect(src).toContain("levels point into a different version");
    expect(src).toContain("level sets span two SKUs or mix live and retired levels");
  });
  it("migration review P1: a set is a CHAIN, not a timestamp — every active level of a SKU is one version; inactive sets by pointer connectivity", () => {
    const backfill = extractFunction(src, "-- ── (3) backfill:", "end $$;");
    // ACTIVE: one key per SKU, never per effective_from (5 prod SKUs wrote their live chain in several statements).
    expect(backfill).toContain("select l.id, 'active:' || l.sku_id::text from public.sku_pack_levels l where l.version_id is null and l.active;");
    // INACTIVE: connected components over contains_level_id, both directions, same SKU, both ends retired.
    expect(backfill).toContain("with recursive edge(a, b) as (");
    expect(backfill).toContain("undirected(a, b) as (select a, b from edge union select b, a from edge),");
    expect(backfill).toContain("c.version_id is null and not c.active and c.sku_id = l.sku_id");
    expect(backfill).toContain("select node as level_id, 'inactive:' || min(root::text) as set_key from reach group by node");
    expect(backfill).toContain("min(l.effective_from)                                        as valid_from,");
    expect(backfill).not.toMatch(/group by sku_id, effective_from, active/);
    // History: the ACTIVE set sorts last on a tie; 0260 re-dates with the same order (P3a).
    expect(backfill).toContain("window w as (partition by sku_id order by valid_from, active, created_at, id)");
    // The executable proof on synthetic rows is scripts/sql-harness-0259.mjs (PGlite).
  });
  it("price lanes + the location/lane pairing", () => {
    expect(src).toContain("create table if not exists public.sku_price_lanes");
    expect(src).toContain("check ((location_id is null) = (price_lane_id is null))");
    expect(src).toContain("foreign key (price_lane_id, vendor_item_id, location_id)");
  });
  it("D3: a MONOTONIC pack epoch per (sku, shop), bumped by trigger on every effective change; auto values stamped with it", () => {
    expect(src).toContain("create table if not exists public.sku_pack_epochs");
    expect(src).toContain("add column if not exists auto_weekday_pack_epoch bigint null");
    expect(src).toContain("add column if not exists auto_weekend_pack_epoch bigint null");
    expect(src).toContain("set auto_weekday_pack_epoch = case when auto_weekday_par is not null then 0 end,");
    const bump = extractFunction(src, "create or replace function public.sku_pack_epoch_bump(", "\n$$;");
    expect(bump).toContain("on conflict (sku_id, location_id) do update set epoch = e.epoch + 1");
    expect(bump).toContain("elsif tg_op = 'UPDATE' and old.active and not new.active and new.location_id is not null then");
    expect(src).toContain("after insert or update of active on public.sku_pack_versions");
    // the triggers come AFTER the backfill, so the backfill bumps nothing and snapshots nothing
    expect(src.indexOf("create trigger sku_pack_versions_epoch")).toBeGreaterThan(src.indexOf("pack levels left without a version"));
  });
  it("2b r2#5: a pre-chain flat baseline is recorded before a SKU's first global chain", () => {
    expect(src).toContain("constraint sku_pack_versions_baseline_never_live check (flat_snapshot is null or not active)");
    const base = extractFunction(src, "create or replace function public.sku_pack_versions_flat_baseline(", "\n$$;");
    expect(base).toContain("if exists (select 1 from public.sku_pack_versions where sku_id = new.sku_id and location_id is null) then return new; end if;");
    expect(base).toContain("values (new.sku_id, null, false, '2000-01-01T00:00:00Z', new.valid_from,");
    expect(base).not.toContain("v_vi.pack_format is null and v_vi.units_per_pack is null"); // an all-null pack is history too
    expect(src).toContain("before insert on public.sku_pack_versions");
  });
  it("2a r2#6: the GLOBAL flat mirror is derived inside save_sku_pack_version's transaction", () => {
    const body = extractFunction(src, "create or replace function public.save_sku_pack_version(", "\n$$;");
    expect(body).toContain("v_mirror := public.sku_flat_mirror_apply(p_sku, v_new);");
    expect(body.indexOf("sku_flat_mirror_apply")).toBeGreaterThan(body.indexOf("readback_failed"));
    const mirror = extractFunction(src, "create or replace function public.sku_flat_mirror_apply(", "\n$$;");
    expect(mirror).toContain("units_per_pack = case when v_units = trunc(v_units) then v_units::int else null end");
    expect(mirror).toContain("set pack_format = 'Each (no case)', units_per_pack = null, each_size = null, each_measure = null");
  });
  it("review P3b: save_sku_pack_version proves the chain's shape with NAMED refusals, on an ACTIVE SKU", () => {
    const body = extractFunction(src, "create or replace function public.save_sku_pack_version(", "\n$$;");
    for (const code of ["non_positive_qty", "duplicate_label", "shared_child", "not_one_root", "cycle"]) {
      expect(body).toContain(`raise exception 'sku_pack_version:${code}' using errcode = 'P0001';`);
    }
    expect(body).toContain("from public.vendor_items vi where vi.id = p_sku and vi.active for update;");
    // a surviving live label is a named refusal, never a bare 23505
    expect(body).toMatch(/exception when unique_violation then\s+--[^\n]*\n\s+raise exception 'sku_pack_version:duplicate_label'/);
    // every shape check runs BEFORE the lock and any write
    expect(body.indexOf("sku_pack_version:cycle")).toBeLessThan(body.indexOf("for update"));
  });
  it("chunk-4 P2: below MoO a first chain may not move a flat pack that was already set (named, atomic)", () => {
    const body = extractFunction(src, "create or replace function public.save_sku_pack_version(", "\n$$;");
    // the flat pack is read UNDER the SKU lock, in the same statement that takes it
    expect(body).toMatch(/select vi\.location_id, vi\.pack_format, vi\.units_per_pack, vi\.each_size, vi\.each_measure\s+into v_flat\s+from public\.vendor_items vi where vi\.id = p_sku and vi\.active for update;/);
    // "had a flat pack" = any mirror field set, except the 'Each (no case)' unknown placeholder alone
    expect(body).toContain("v_had_flat := p_first_only and p_location is null and (");
    expect(body).toContain("or (v_flat.pack_format is not null and v_flat.pack_format <> 'Each (no case)'));");
    // compared against the mirror THIS chain derived, after it is applied, so a mismatch rolls it all back
    expect(body.indexOf("raise exception 'sku_pack_version:flat_pack_exists'")).toBeGreaterThan(body.indexOf("v_mirror := public.sku_flat_mirror_apply(p_sku, v_new);"));
    expect(body).toContain("is distinct from (v_flat.pack_format, v_flat.units_per_pack, v_flat.each_size, v_flat.each_measure)) then");
  });
  it("chunk-4 P3b: a shop-owned SKU has no other shop — refused by name for packs AND prices", () => {
    const pack = extractFunction(src, "create or replace function public.save_sku_pack_version(", "\n$$;");
    expect(pack).toContain("if p_location is not null and v_owner is not null and v_owner <> p_location then");
    expect(pack).toContain("raise exception 'sku_pack_version:sku_owned_by_other_shop' using errcode = 'P0001';");
    const price = extractFunction(src, "create or replace function public.save_sku_shop_price(", "\n$$;");
    expect(price).toContain("raise exception 'sku_price:sku_owned_by_other_shop' using errcode = 'P0001';");
  });
  it("review P3c: record_receiving_prices guards price, date, SKU and shop with named refusals", () => {
    const body = extractFunction(src, "create or replace function public.record_receiving_prices(", "\n$$;");
    expect(body).toContain("if not exists (select 1 from public.locations where id = p_location and active) then");
    expect(body).toMatch(/perform 1 from public\.vendor_items where id = v_sku for update;\s+if not found then\s+raise exception 'sku_price:sku_not_found'/);
    expect(body).toContain("v_price := case when jsonb_typeof(v_row -> 'unit_price') = 'number' then (v_row ->> 'unit_price')::numeric end;");
    expect(body).toContain("raise exception 'sku_price:invalid_date' using errcode = 'P0001';");
  });
  it("review P3f: a global pack change bumps the epoch of EVERY shop riding it, inactive shops included", () => {
    const bump = extractFunction(src, "create or replace function public.sku_pack_epoch_bump(", "\n$$;");
    expect(bump).not.toContain("l.active");
  });
  it("review P3e: the helpers are proven unreachable by PostgREST roles, and service_role proven to hold EXECUTE on every writer", () => {
    expect(src).toContain("raise exception '0259: a helper is executable by a PostgREST role';");
    expect(src).toContain("raise exception '0259: service_role is missing EXECUTE on a writer';");
    for (const fn of ["sku_pack_epoch_bump()", "sku_pack_versions_flat_baseline()", "sku_flat_mirror_apply(uuid, uuid)"]) {
      expect(src).toContain(`has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`);
      expect(src).toContain(`has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`);
    }
    for (const fn of WRITERS) expect(src).toContain(`has_function_privilege('service_role', 'public.${fn}(`);
  });
  it("every writer is SECURITY DEFINER, locked search_path, service_role only; first-value is decided under the SKU lock", () => {
    for (const fn of WRITERS) {
      const body = src.slice(src.indexOf(`create or replace function public.${fn}(`));
      expect(body.slice(0, 700)).toContain("security definer");
      expect(body.slice(0, 700)).toContain("set search_path = pg_catalog, public");
      expect(src).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(src).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
    for (const fn of ["save_sku_pack_version", "save_sku_global_price"]) {
      const body = extractFunction(src, `create or replace function public.${fn}(`, "\n$$;");
      expect(body.indexOf("for update")).toBeGreaterThan(-1);
      expect(body.indexOf("for update")).toBeLessThan(body.indexOf("global_requires_moo"));
    }
    expect(src).toContain("raise exception '0259: unexpected execute grant'");
  });
  it("record_receiving_prices: under the SKU lock, the shop's live lane — else it OPENS the shop's first lane (decision e)", () => {
    const body = extractFunction(src, "create or replace function public.record_receiving_prices(", "\n$$;");
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("from public.sku_price_lanes"));
    expect(body).toContain("insert into public.sku_price_lanes (sku_id, location_id, based_on_price_id, active, created_at, created_by)");
    expect(body).toContain("if v_owner is distinct from p_location then");
    expect(body.indexOf("insert into public.sku_price_lanes")).toBeLessThan(body.indexOf("insert into public.vendor_price_history"));
  });
  it("privilege ceiling on both new tables: revoke all (service_role too), grant exactly, assert both ways", () => {
    for (const t of ["sku_pack_versions", "sku_price_lanes", "sku_pack_epochs"]) {
      expect(src).toContain(`alter table public.${t} enable row level security;`);
      expect(src).toContain(`revoke all on public.${t} from public, anon, authenticated, service_role;`);
      expect(src).toContain(`grant select, insert, update on public.${t} to service_role;`);
      expect(src).toContain(`has_table_privilege('service_role', 'public.${t}', 'DELETE')`);
      expect(src).toContain(`has_table_privilege('service_role', 'public.${t}', 'TRUNCATE')`);
    }
    expect(src).toContain("raise exception '0259: service_role above its ceiling'");
    expect(src).toContain("raise exception '0259: service_role is missing a privilege the writers need'");
  });
});

describe("0259 re-emits its two SQL chain writers faithfully", () => {
  const emitted0259 = read(M0259);
  for (const r of REEMITS) {
    describe(r.name, () => {
      it(`${r.source} was the latest definer before 0259, and 0259 is now`, () => {
        const defining = files.filter((f) => read(f).includes(r.start) || read(f).includes(r.startReplaced));
        expect(defining[defining.length - 1]).toBe(M0259);
        expect(defining[defining.length - 2]).toBe(r.source);
      });
      it("the source body (± the enumerated mods) is a line-subsequence of the 0259 body", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const check = isLineSubsequence(source, extractFunction(emitted0259, r.startReplaced, r.end));
        expect(check.ok, `missing from 0259 → ${check.missing}`).toBe(true);
      });
      it("adds nothing beyond the mods except comment lines", () => {
        const source = applyMods(extractFunction(read(r.source), r.start, r.end), r.mods);
        const srcLines = new Set(source.split("\n").map((l) => l.trimEnd()));
        const extra = extractFunction(emitted0259, r.startReplaced, r.end).split("\n").map((l) => l.trimEnd())
          .filter((l) => l.trim() !== "" && !srcLines.has(l) && !l.trim().startsWith("--"));
        expect(extra).toEqual([]);
      });
    });
  }
  it("the store copy derives its flat mirror from the chain it cloned (Astra 2a#10)", () => {
    const body = extractFunction(emitted0259, "create or replace function public.receiving_create_store_item(", "$$;");
    // review P3d: through the ONE mirror rule, never a second copy of it.
    expect(body).toContain("perform public.sku_flat_mirror_apply(v_id, v_version);");
    expect(body).not.toContain("v_root_label");
  });
});

describe("0260 finalize", () => {
  const src = read(M0260);
  it("heals legacy-window writes with real dates, asserts every invariant, then makes version_id NOT NULL", () => {
    expect(src).toContain("note = '0260 backfill'");
    expect(src).toContain("assert v_null = 0");
    expect(src).toContain("assert v_mismatch = 0");
    expect(src).toContain("alter table public.sku_pack_levels alter column version_id set not null;");
  });
  it("names its deadline: before the next depletion cron after the deploy (review P3g)", () => {
    expect(src).toContain("DEADLINE: apply BEFORE THE NEXT DEPLETION CRON after the deploy — /api/cron/toast-sales-pull,");
    expect(readFileSync("vercel.json", "utf8")).toContain('{ "path": "/api/cron/toast-sales-pull", "schedule": "0 9 * * *" }');
  });
  it("re-dates the whole global timeline across versioned AND healed rows (Astra 2a r2#5), with the baseline trigger off", () => {
    expect(src).toContain("lead(v.valid_from) over (partition by v.sku_id order by v.valid_from, v.valid_to nulls last, v.created_at, v.id)");
    expect(src).toContain("assert v_overlap = 0");
    expect(src.indexOf("disable trigger sku_pack_versions_flat_baseline")).toBeLessThan(src.indexOf("'0260 backfill'"));
    expect(src).toContain("enable trigger sku_pack_versions_flat_baseline");
  });
});
