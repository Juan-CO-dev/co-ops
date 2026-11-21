/** Shared fixtures for the offline 0353 proof (scripts/sql-harness-0353.mjs) and the vitest tests that run the REAL
 * loader reads against the same rows (tests/day-plan-load-before-0353.test.ts). Ephemeral PGlite only: no network.
 * The live shape comes from CHIEF 2026-11-21-sch-prebuild-checks.md ("Closing Manager items"): ten closing sections
 * per shop; Closing Manager holds 7 active items, 5 of them report references ("Count the drawer" and "Count and secure
 * tips" are not); the other nine sections hold none.
 */
import { readFileSync } from 'node:fs';

export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const readMigration = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');

export const SHOP_P = id(1), SHOP_C = id(2), SHOP_X = id(3), SHOP_NONE = id(4);
export const CLOSING_MANAGER = 'Closing Manager';
export const FLOOR_SECTIONS = ['Crunchy Boi Station', '3rd Party Station', 'Walk Ins Station', 'Expo Station'];
export const OTHER_SECTIONS = ['Prep Fridge', 'Clean front of house', 'Shut Down Back Line', 'Walk-Out Verification', 'Dish'];
export const LIVE_SECTIONS = [...FLOOR_SECTIONS, ...OTHER_SECTIONS, CLOSING_MANAGER];
export const CM_ITEMS = [
  ['Opening report', 'opening_report'], ['AM prep', 'am_prep'], ['Mid-day Prep', 'mid_day_prep'], ['Cash report', 'cash_report'],
  ['PM report', 'pm_report'], ['Count the drawer', null], ['Count and secure tips', null],
];

/** The tables 0353 and the loader's flag / classification reads touch, without 0353's columns. */
export const SCHEMA = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges grant execute on functions to anon, authenticated;
  create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text,
    resource_id uuid, before_state jsonb, after_state jsonb, metadata jsonb, destructive boolean, created_at timestamptz default now());
  create table locations(id uuid primary key, code text, name text, active boolean not null default true);
  create table users(id uuid primary key, name text, role text, active boolean not null default true);
  create table user_locations(user_id uuid, location_id uuid, active boolean not null default true);
  create table stations(id uuid primary key default gen_random_uuid(), location_id uuid not null references locations(id),
    name text not null, name_es text, sort integer not null default 0, active boolean not null default true,
    staffed boolean not null default true, usually_closes_at time, unique(location_id, name));
  create table station_positions(id uuid primary key default gen_random_uuid(), station_id uuid references stations(id),
    location_id uuid, name text, sort integer default 1, active boolean not null default true);
  create table checklist_templates(id uuid primary key, location_id uuid, type text, name text, active boolean not null default true,
    effective_from date, created_at timestamptz not null default now(), prep_subtype text);
  create table checklist_template_items(id uuid primary key default gen_random_uuid(), template_id uuid references checklist_templates(id),
    station text, label text, active boolean not null default true, display_order integer not null default 0, report_reference_type text);
  create table checklist_instances(id uuid primary key default gen_random_uuid(), template_id uuid references checklist_templates(id),
    location_id uuid, date date, status text default 'open', created_at timestamptz default now());
  grant all on all tables in schema public to service_role;
`;

let seq = 1000;
const next = () => id(++seq);

/** Insert rows. `spec`: { locations, users, memberships, stations, templates, items, instances } (all optional). */
export async function seed(db, spec) {
  for (const l of spec.locations ?? []) await db.query('insert into locations(id, code, name, active) values ($1,$2,$3,$4)', [l.id, l.code, l.name ?? l.code, l.active ?? true]);
  for (const u of spec.users ?? []) await db.query('insert into users(id, name, role, active) values ($1,$2,$3,$4)', [u.id, u.name ?? u.role, u.role, u.active ?? true]);
  for (const m of spec.memberships ?? []) await db.query('insert into user_locations(user_id, location_id, active) values ($1,$2,$3)', [m.user, m.location, m.active ?? true]);
  for (const s of spec.stations ?? []) {
    await db.query('insert into stations(id, location_id, name, sort, active, staffed, usually_closes_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [s.id, s.location, s.name, s.sort ?? 0, s.active ?? true, s.staffed ?? true, s.usual ?? null]);
    if (s.position !== false) await db.query('insert into station_positions(station_id, location_id, name, active) values ($1,$2,$3,$4)', [s.id, s.location, s.name, s.positionActive ?? true]);
  }
  for (const t of spec.templates ?? []) {
    await db.query('insert into checklist_templates(id, location_id, type, name, active, effective_from, created_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [t.id, t.location, t.type ?? 'closing', t.name ?? 'Closing', t.active ?? true, t.effectiveFrom ?? null, t.createdAt ?? '2026-01-01T00:00:00Z']);
  }
  for (const i of spec.items ?? []) {
    await db.query('insert into checklist_template_items(id, template_id, station, label, active, display_order, report_reference_type) values ($1,$2,$3,$4,$5,$6,$7)',
      [i.id ?? next(), i.template, i.station, i.label ?? 'item', i.active ?? true, i.order ?? 0, i.ref ?? null]);
  }
  for (const x of spec.instances ?? []) {
    await db.query('insert into checklist_instances(id, template_id, location_id, date, status) values ($1,$2,$3,$4,$5)', [x.id ?? next(), x.template, x.location, x.date, x.status ?? 'open']);
  }
}

/** One shop in the live shape: the ten sections as stations and as the closing template's items. */
export function liveShop(shop, code, template, { stationBase }) {
  const stations = LIVE_SECTIONS.map((name, i) => ({ id: id(stationBase + i), location: shop, name, sort: i + 1,
    staffed: FLOOR_SECTIONS.includes(name) || name === CLOSING_MANAGER }));
  const items = [];
  for (const name of LIVE_SECTIONS) {
    if (name === CLOSING_MANAGER) for (const [label, ref] of CM_ITEMS) items.push({ template, station: name, label, ref });
    else for (const label of ['Wipe down', 'Restock', 'Check off']) items.push({ template, station: name, label });
  }
  return { locations: [{ id: shop, code }], stations, templates: [{ id: template, location: shop }], items };
}

export function merge(...specs) {
  const out = {};
  for (const s of specs) for (const [k, v] of Object.entries(s)) out[k] = [...(out[k] ?? []), ...v];
  return out;
}

/**
 * The twin table (plan r3, 8.5): one station per section shape at shop P, plus rows at the other shop and in other
 * templates. `expected` = whether the backfill (and so the code rule) marks it.
 */
export const TWIN_TEMPLATE_P = id(501), TWIN_RETIRED_P = id(502), TWIN_FUTURE_P = id(503), TWIN_TEMPLATE_C = id(504);
export function twinShapes() {
  const shapes = [
    { name: 'Zero refs', items: [{}, {}, {}], expected: false },
    { name: 'One of one', items: [{ ref: 'opening_report' }], expected: true },
    { name: 'One of seven', items: [{ ref: 'cash_report' }, {}, {}, {}, {}, {}, {}], expected: true },
    { name: 'Five of seven', items: [...Array(5)].map(() => ({ ref: 'pm_report' })).concat([{}, {}]), expected: true },
    { name: 'Inactive ref only', items: [{ ref: 'am_prep', active: false }, {}], expected: false },
    { name: 'Retired ref only', items: [{}], retired: [{ ref: 'am_prep' }], expected: false },
    { name: 'Future ref only', items: [{}], future: [{ ref: 'am_prep' }], expected: false },
    { name: 'Other shop ref only', items: [{}], otherShop: [{ ref: 'am_prep' }], expected: false },
    { name: 'Spaced name', items: [{ ref: 'mid_day_prep', spaced: true }], expected: true },
    { name: CLOSING_MANAGER, items: [{}, {}], expected: false },
  ];
  const items = [];
  const stations = [];
  shapes.forEach((s, i) => {
    stations.push({ id: id(600 + i), location: SHOP_P, name: s.name, sort: i + 1 });
    stations.push({ id: id(700 + i), location: SHOP_C, name: s.name, sort: i + 1 });
    for (const it of s.items) items.push({ template: TWIN_TEMPLATE_P, station: it.spaced ? `  ${s.name} ` : s.name, ref: it.ref ?? null, active: it.active ?? true });
    for (const it of s.retired ?? []) items.push({ template: TWIN_RETIRED_P, station: s.name, ref: it.ref });
    for (const it of s.future ?? []) items.push({ template: TWIN_FUTURE_P, station: s.name, ref: it.ref });
    for (const it of s.otherShop ?? []) items.push({ template: TWIN_TEMPLATE_C, station: s.name, ref: it.ref });
  });
  return {
    shapes,
    spec: {
      locations: [{ id: SHOP_P, code: 'P' }, { id: SHOP_C, code: 'C' }],
      stations,
      templates: [
        { id: TWIN_TEMPLATE_P, location: SHOP_P, createdAt: '2026-06-01T00:00:00Z' },
        { id: TWIN_RETIRED_P, location: SHOP_P, active: false, createdAt: '2026-07-01T00:00:00Z' },
        { id: TWIN_FUTURE_P, location: SHOP_P, effectiveFrom: '2099-01-01', createdAt: '2026-08-01T00:00:00Z' },
        { id: TWIN_TEMPLATE_C, location: SHOP_C },
      ],
      items,
    },
  };
}

/**
 * The V1-instance / V2-effective fixture (ruling B1): today's closing instance sits on retired V1 while V2 is
 * effective. (a) V2 ADDS a reference to "Expo Station" (none in V1); (b) V2 REMOVES Closing Manager's references.
 */
export const V1 = id(801), V2 = id(802);
export function versionShop(variant, { shop = SHOP_P, today }) {
  const base = liveShop(shop, 'P', V1, { stationBase: 900 });
  const v2Items = [];
  for (const name of LIVE_SECTIONS) {
    if (name === CLOSING_MANAGER) {
      for (const [label, ref] of CM_ITEMS) v2Items.push({ template: V2, station: name, label, ref: variant === 'b' ? null : ref });
    } else {
      for (const label of ['Wipe down', 'Restock', 'Check off']) v2Items.push({ template: V2, station: name, label });
      if (variant === 'a' && name === 'Expo Station') v2Items.push({ template: V2, station: name, label: 'Sign the PM report', ref: 'pm_report' });
    }
  }
  return merge(
    { ...base, templates: [{ id: V1, location: shop, active: false, createdAt: '2026-01-01T00:00:00Z' }] },
    { templates: [{ id: V2, location: shop, createdAt: '2026-11-01T00:00:00Z' }], items: v2Items, instances: [{ template: V1, location: shop, date: today }] },
  );
}
