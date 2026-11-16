/**
 * Audit W18/B107: the 0324 SIM proof script, run OFFLINE — its one rolled-back statement list executes
 * against PGlite with the REAL 0259 + 0260 + 0261 + 0324 on a stub schema, its preflight passes on a
 * schema that matches, and its target guard refuses anything but the sim. The live run is CC's.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { fixture, proofSQL, runProof, inserted } from "../scripts/sim/sku-pack-back-to-default-0324-check.mjs";
import { projectRef, PROD_REF, SIM_REF } from "../scripts/supabase-management-query.mjs";

const STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.users(id uuid primary key);
  create table public.locations(id uuid primary key, name text, code text, type text, active boolean not null default true);
  create table public.vendors(id uuid primary key, source_kind text, active boolean not null default true);
  create table public.vendor_items(id uuid primary key, name text, active boolean not null default true,
    location_id uuid null references public.locations(id), pack_format text, each_container_label text,
    units_per_pack int, each_size numeric, each_measure text, weekday_par numeric, weekend_par numeric);
  create table public.measure_units(label text primary key, active boolean not null default true);
  create table public.sku_pack_levels (id uuid primary key default gen_random_uuid(), sku_id uuid not null references public.vendor_items(id),
    label text not null, contains_qty numeric not null check (contains_qty > 0), contains_level_id uuid null references public.sku_pack_levels(id),
    contains_measure_unit text null, display_ordinal integer not null default 0, effective_from timestamptz not null default now(),
    active boolean not null default true, created_at timestamptz not null default now(), created_by uuid null references public.users(id),
    constraint sku_pack_levels_one_link check (num_nonnulls(contains_level_id, contains_measure_unit) = 1));
  create unique index sku_pack_levels_sku_label_active on public.sku_pack_levels (sku_id, label) where active;
  create table public.vendor_price_history(id uuid primary key default gen_random_uuid(), vendor_item_id uuid not null references public.vendor_items(id),
    unit_price numeric(10,2) not null, effective_date date not null, recorded_at timestamptz default now(), recorded_by uuid, source text, source_note text);
  create table public.location_sku_settings (id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
    sku_id uuid not null references public.vendor_items(id), active_override boolean null, weekday_par numeric null, weekend_par numeric null,
    updated_by uuid null references public.users(id), updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
    auto_weekday_par numeric null, auto_weekend_par numeric null, auto_weekday_applied_at timestamptz null, auto_weekend_applied_at timestamptz null,
    auto_weekday_baseline_par numeric null, auto_weekend_baseline_par numeric null, pinned_weekday_at timestamptz null, pinned_weekend_at timestamptz null,
    constraint location_sku_settings_location_sku_uq unique (location_id, sku_id));
  create table public.vendor_import_batches(id uuid primary key);
  create table public.vendor_import_observations(id uuid primary key);
  create table public.vendor_deliveries(id uuid primary key, location_id uuid not null references public.locations(id));
  create table public.photos(id uuid primary key, location_id uuid not null references public.locations(id));
  insert into public.measure_units values ('oz', true), ('lb', true), ('each', true);
`;

describe("0324 sim proof (offline)", () => {
  it("its rolled-back proof runs on the real migrations and commits nothing", async () => {
    const db = new PGlite();
    try {
      await db.exec(STUB);
      for (const m of ["0259_sku_shop_versions", "0260_sku_pack_versions_finalize", "0261_sku_pack_change_requests", "0324_sku_pack_back_to_default"]) {
        await db.exec(readFileSync(`supabase/migrations/${m}.sql`, "utf8"));
      }
      const query = async (sql: string) => {
        // PGlite's exec answers a multi-statement list; like the Management API, the rows are those of the
        // last statement that returns rows (a trailing commit / rollback returns none).
        const results = await db.exec(sql);
        return ([...results].reverse().find((r) => r.fields.length > 0)?.rows ?? []) as Array<Record<string, unknown>>;
      };
      const logs: string[] = [];
      await runProof(query, (m: string) => logs.push(m));
      expect(logs.some((l) => l.startsWith("PASS B1"))).toBe(true);
      expect(logs.at(-1)).toBe("PASS nothing committed");
      expect((await db.query("select count(*)::int as n from public.vendor_items")).rows[0]).toEqual({ n: 0 });
    } finally { await db.close(); }
  }, 120_000);
  it("a broken invariant fails the request (the DO block raises inside the transaction)", () => {
    const sql = proofSQL(fixture());
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("rollback;")).toBe(true);
    for (const tag of ["B1 failed", "B2 failed", "B3 failed"]) expect(sql).toContain(tag);
    expect(Object.keys(inserted)).toEqual(["locations", "vendor_items", "location_sku_settings"]);
  });
  it("targets the sim only", () => {
    expect(projectRef([`--ref=${SIM_REF}`], true)).toBe(SIM_REF);
    expect(() => projectRef([`--ref=${PROD_REF}`], true)).toThrow();
  });
});
