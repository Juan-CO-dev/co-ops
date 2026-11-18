/** Shared stub schema for the 0344 proofs: scripts/sql-harness-0344.mjs and
 * tests/catering-ring-code-capture-fixture.test.ts. Loads the REAL 0221 toast_orders_latest view and the REAL 0232
 * sales_report_assert_window / sales_report_catering_values bodies over a minimal schema. Offline, PGlite only. */
import { readFileSync } from 'node:fs';

export const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
export const id = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`;
const latestView = read('0221_toast_order_capture.sql').match(/create view public\.toast_orders_latest[\s\S]*?;\n/)?.[0];
const sales0232 = read('0232_reports_sales_reads.sql');
const assertWindow = sales0232.match(/create function public\.sales_report_assert_window[\s\S]*?\nend \$\$;/)?.[0];
const cateringValues = sales0232.match(/create function public\.sales_report_catering_values[\s\S]*?\nend \$\$;/)?.[0];
export const migration = read('0344_catering_toast_house_side.sql');

export const SHOP = id('1000', 1), OTHER = id('1000', 2), ACTOR = id('2000', 1);
export const H1 = id('3000', 1), H2 = id('3000', 2), H3 = id('3000', 3), H4 = id('3000', 4), EZ = id('3000', 5), LOST = id('3000', 6), H7 = id('3000', 7);

export async function schema(db, check = (ok, m) => { if (!ok) throw new Error(m); }) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table locations(id uuid primary key, name text);
    create table users(id uuid primary key, role text not null, active boolean not null default true);
    create table catering_pipeline(id uuid primary key, location_id uuid references locations(id), event_date date, stage text not null,
      lead_source text, headcount integer, estimated_revenue_cents bigint, external_ref text);
    create table catering_quotes(id uuid primary key default gen_random_uuid(), pipeline_id uuid references catering_pipeline(id),
      total_cents bigint, status text, superseded_at timestamptz, version integer not null default 1);
    create table ezcater_orders(id uuid primary key default gen_random_uuid(), lead_id uuid references catering_pipeline(id),
      location_id uuid, order_number text);
    create table ezcater_toast_links(id uuid primary key default gen_random_uuid(), order_id uuid not null, snapshot_id uuid not null,
      location_id uuid not null, toast_snapshot_id uuid not null, order_guid text not null, check_guid text not null,
      selection_guid text not null, business_date date not null, evidence text not null, is_current boolean not null default true);
    create table toast_orders(id uuid primary key, location_id uuid not null, order_guid text not null, business_date date not null,
      content_hash text not null default 'x', opened_at timestamptz, closed_at timestamptz, paid_at timestamptz, modified_at timestamptz,
      promised_at timestamptz, source text, revenue_center_guid text, dining_option_guid text, server_guid text,
      deleted boolean not null default false, voided boolean not null default false, excess_food boolean not null default false,
      third_party_provider_guid text, third_party_provider_name text, selection_units jsonb not null default '[]');
    create table toast_order_checks(snapshot_id uuid not null references toast_orders(id), check_guid text not null,
      amount_cents bigint, tax_cents bigint, total_cents bigint, voided boolean not null default false, deleted boolean not null default false,
      primary key(snapshot_id, check_guid));
    create table toast_order_latest_pointers(location_id uuid not null, order_guid text not null, snapshot_id uuid not null,
      business_date date not null, primary key(location_id, order_guid));
    create table toast_dining_options(location_id uuid not null, guid text not null, name text not null, primary key(location_id, guid));
    create table sales_channel_map(dining_option_label text primary key, channel text not null, provider text);
    create table toast_catering_orders(id uuid primary key default gen_random_uuid(), location_id uuid not null, order_guid text not null unique,
      business_date date not null, classification text not null default 'catering', voided boolean not null default false,
      lead_id uuid references catering_pipeline(id));
    grant all on all tables in schema public to service_role;`);
  check(Boolean(latestView && assertWindow && cateringValues), 'real 0221 / 0232 bodies extracted');
  await db.exec(latestView);
  await db.exec(assertWindow);
  await db.exec(cateringValues);
  await db.exec(`insert into locations values ('${SHOP}', 'Shop'), ('${OTHER}', 'Other');
    insert into users values ('${ACTOR}', 'gm', true);
    insert into toast_dining_options values ('${SHOP}', 'do-cat', 'Catering'), ('${SHOP}', 'do-dine', 'Dine In'), ('${SHOP}', 'do-ez', 'Ezcater');
    insert into sales_channel_map values ('Catering', 'catering', 'house'), ('Dine In', 'dine_in', 'house'), ('Ezcater', 'catering', 'ezCater');`);
}

/** One order with checks; a snapshot id per call so a recapture is just a second call for the same guid. */
export async function ring(db, snap, { order, date, option = 'do-cat', checks: list, shop = SHOP }) {
  const units = list.flatMap(c => (c.names ?? []).map((name, i) => ({ check_guid: c.guid, selection_guid: `${c.guid}-s${i}`, name })));
  await db.query(`insert into toast_orders(id, location_id, order_guid, business_date, dining_option_guid, selection_units)
    values ($1, $2, $3, $4, $5, $6)`, [snap, shop, order, date, option, JSON.stringify(units)]);
  for (const c of list) {
    await db.query(`insert into toast_order_checks(snapshot_id, check_guid, total_cents, voided) values ($1, $2, $3, $4)`,
      [snap, c.guid, c.total ?? null, c.voided ?? false]);
  }
  await db.query(`insert into toast_order_latest_pointers values ($1, $2, $3, $4)
    on conflict (location_id, order_guid) do update set snapshot_id = excluded.snapshot_id, business_date = excluded.business_date`,
    [shop, order, snap, date]);
}

