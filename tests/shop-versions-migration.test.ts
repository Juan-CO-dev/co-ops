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
      expect(src).toContain("NOT YET APPLIED — apply via MCP after review");
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
    expect(body).toContain("update public.vendor_items set pack_format = v_root_label");
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
  it("re-dates the whole global timeline across versioned AND healed rows (Astra 2a r2#5), with the baseline trigger off", () => {
    expect(src).toContain("lead(v.valid_from) over (partition by v.sku_id order by v.valid_from, v.created_at, v.id)");
    expect(src).toContain("assert v_overlap = 0");
    expect(src.indexOf("disable trigger sku_pack_versions_flat_baseline")).toBeLessThan(src.indexOf("'0260 backfill'"));
    expect(src).toContain("enable trigger sku_pack_versions_flat_baseline");
  });
});
