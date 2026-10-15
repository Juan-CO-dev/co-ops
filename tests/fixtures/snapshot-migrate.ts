/**
 * Catalog Phase 2a — run the REAL migrations 0259 + 0260 over a prod-shaped snapshot, in PGlite
 * (in-memory Postgres; no network, no real database), and hand back the post-migration rows
 * (Astra full-branch r1 P2). Nothing here fabricates a version: the versions, their intervals, the
 * level links and the lanes are whatever 0259's own backfill writes and 0260 finalizes.
 *
 * The schema is the minimum 0259/0260 touch, with prod's constraint shape where it matters to the
 * backfill (0159's sku_pack_levels verbatim in the parts 0259 reads). Snapshot rows are loaded
 * through jsonb_populate_recordset, so every value keeps the type Postgres gives it in prod.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

type Row = Record<string, unknown>;
export type SnapshotTables = Record<string, Row[]>;

const SCHEMA = `
  create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.users(id uuid primary key);
  create table public.locations(id uuid primary key, active boolean not null default true);
  create table public.vendors(id uuid primary key, source_kind text, active boolean not null default true);
  create table public.vendor_items(id uuid primary key, active boolean not null default true,
    location_id uuid null references public.locations(id), pack_format text, each_container_label text,
    units_per_pack numeric, each_size numeric, each_measure text);
  create table public.measure_units(label text primary key, active boolean not null default true);
  create table public.sku_pack_levels (
    id uuid primary key default gen_random_uuid(),
    sku_id uuid not null references public.vendor_items(id),
    label text not null,
    contains_qty numeric not null check (contains_qty > 0),
    contains_level_id uuid null references public.sku_pack_levels(id),
    contains_measure_unit text null,
    display_ordinal integer not null default 0,
    effective_from timestamptz not null default now(),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid null references public.users(id),
    constraint sku_pack_levels_one_link check (num_nonnulls(contains_level_id, contains_measure_unit) = 1)
  );
  create unique index sku_pack_levels_sku_label_active on public.sku_pack_levels (sku_id, label) where active;
  create table public.vendor_price_history(id uuid primary key default gen_random_uuid(),
    vendor_item_id uuid not null references public.vendor_items(id), unit_price numeric(10,2) not null,
    effective_date date not null, recorded_at timestamptz default now(), recorded_by uuid, source text, source_note text);
  create table public.location_sku_settings(sku_id uuid, location_id uuid, auto_weekday_par numeric, auto_weekend_par numeric);
  create table public.vendor_import_batches(id uuid primary key);
  create table public.vendor_import_observations(id uuid primary key);
  grant select, insert, update on all tables in schema public to service_role;
`;

/** The columns of each table this loads into PGlite (everything 0259/0260 read or write). */
const LOAD: Record<string, string[]> = {
  locations: ["id", "active"],
  vendors: ["id", "source_kind", "active"],
  vendor_items: ["id", "active", "location_id", "pack_format", "each_container_label", "units_per_pack", "each_size", "each_measure"],
  measure_units: ["label", "active"],
  sku_pack_levels: ["id", "sku_id", "label", "contains_qty", "contains_level_id", "contains_measure_unit", "display_ordinal", "effective_from", "active", "created_at", "created_by"],
  vendor_price_history: ["id", "vendor_item_id", "unit_price", "effective_date", "recorded_at", "recorded_by", "source", "source_note"],
  location_sku_settings: ["sku_id", "location_id", "auto_weekday_par", "auto_weekend_par"],
};

const iso = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
const plain = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, iso(v)]));

export interface MigratedSnapshot {
  /** The snapshot tables with the post-0259/0260 rows merged in: the "after" world. */
  tables: SnapshotTables;
  /** Counts the proof reports. */
  report: { versions: number; shopVersions: number; lanes: number; levels: number; mirrorChanged: string[] };
}

/** Load `snapshot` into PGlite, run 0259 then 0260 exactly as committed, read the results back. */
export async function migrateSnapshot(snapshot: SnapshotTables): Promise<MigratedSnapshot> {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    // created_by → users (FK): only the ids the snapshot references; no user data is needed.
    const userIds = [...new Set((snapshot.sku_pack_levels ?? []).map((r) => r.created_by).filter((v): v is string => typeof v === "string"))];
    if (userIds.length > 0) await db.query("insert into public.users (id) select unnest($1::uuid[])", [userIds]);
    for (const [table, cols] of Object.entries(LOAD)) {
      const rows = snapshot[table];
      if (!rows) throw new Error(`snapshot is missing ${table}.json`);
      if (rows.length === 0) continue;
      const list = cols.join(", ");
      await db.query(
        `insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`,
        [JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))))],
      );
    }
    await db.exec(readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/0260_sku_pack_versions_finalize.sql", "utf8"));

    const q = async (sql: string) => (await db.query<Row>(sql)).rows.map(plain);
    const versions = await q("select id, sku_id, location_id, based_on_version_id, active, valid_from, valid_to, note, flat_snapshot, created_at, created_by, retired_by from public.sku_pack_versions order by id");
    const levelLinks = new Map((await q("select id, version_id, location_id from public.sku_pack_levels")).map((r) => [String(r.id), r]));
    const priceLinks = new Map((await q("select id, location_id, price_lane_id from public.vendor_price_history")).map((r) => [String(r.id), r]));
    const lanes = await q("select id, sku_id, location_id, based_on_price_id, active, created_at, created_by, retired_at, retired_by from public.sku_price_lanes order by id");
    const epochs = await q("select sku_id, location_id, epoch from public.sku_pack_epochs order by sku_id, location_id");
    const mirror = new Map((await q("select id, pack_format, each_container_label, units_per_pack::text as units_per_pack, each_size::text as each_size, each_measure from public.vendor_items")).map((r) => [String(r.id), r]));

    // The flat mirror must be untouched by the migrations (the backfill writes no mirror).
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const mirrorChanged = (snapshot.vendor_items ?? []).filter((s) => {
      const m = mirror.get(String(s.id));
      return !m || m.pack_format !== (s.pack_format ?? null) || m.each_container_label !== (s.each_container_label ?? null)
        || num(m.units_per_pack) !== num(s.units_per_pack) || num(m.each_size) !== num(s.each_size) || m.each_measure !== (s.each_measure ?? null);
    }).map((s) => String(s.id));

    const tables: SnapshotTables = JSON.parse(JSON.stringify(snapshot)) as SnapshotTables;
    tables.sku_pack_levels = (tables.sku_pack_levels ?? []).map((l) => {
      const link = levelLinks.get(String(l.id));
      if (!link) throw new Error(`level ${String(l.id)} vanished in the migration`);
      return { ...l, version_id: link.version_id, location_id: link.location_id };
    });
    tables.vendor_price_history = (tables.vendor_price_history ?? []).map((p) => {
      const link = priceLinks.get(String(p.id));
      if (!link) throw new Error(`price ${String(p.id)} vanished in the migration`);
      return { ...p, location_id: link.location_id, price_lane_id: link.price_lane_id };
    });
    tables.sku_pack_versions = versions;
    tables.sku_price_lanes = lanes;
    tables.sku_pack_epochs = epochs;
    return {
      tables,
      report: {
        versions: versions.length, shopVersions: versions.filter((v) => v.location_id != null).length,
        lanes: lanes.length, levels: tables.sku_pack_levels.length, mirrorChanged,
      },
    };
  } finally {
    await db.close();
  }
}

/**
 * A PGlite database with the REAL 0259 + 0260 + 0261 schema applied over the stub base tables (no rows).
 * The caller closes it. Used to check that every column a loader names on a 0259 table exists.
 */
export async function migratedSchemaDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(SCHEMA_FOR_0261);
  await db.exec(readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0260_sku_pack_versions_finalize.sql", "utf8"));
  // Catalog Phase 2b: the door's report table + the atomic apply (its sql-language snapshot
  // function is validated against these columns at create time).
  await db.exec(readFileSync("supabase/migrations/0261_sku_pack_change_requests.sql", "utf8"));
  return db;
}

/**
 * The extra base columns/tables 0261 references (0172 vendor_items pars; 0174 + 0183 overlay
 * columns; the FK targets vendor_deliveries and photos). Only migratedSchemaDb applies these, so
 * the snapshot proof (migrateSnapshot) keeps exactly the schema it was frozen with.
 */
const SCHEMA_FOR_0261 = `
  alter table public.vendor_items add column weekday_par numeric, add column weekend_par numeric;
  alter table public.location_sku_settings
    add column id uuid primary key default gen_random_uuid(),
    add column active_override boolean, add column weekday_par numeric, add column weekend_par numeric,
    add column updated_by uuid, add column updated_at timestamptz not null default now(),
    add column auto_weekday_applied_at timestamptz, add column auto_weekend_applied_at timestamptz,
    add column auto_weekday_baseline_par numeric, add column auto_weekend_baseline_par numeric,
    add column pinned_weekday_at timestamptz, add column pinned_weekend_at timestamptz;
  create table public.vendor_deliveries(id uuid primary key, location_id uuid not null references public.locations(id));
  create table public.photos(id uuid primary key, location_id uuid not null references public.locations(id));
  grant select, insert, update on all tables in schema public to service_role;
`;
