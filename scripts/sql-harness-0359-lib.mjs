/**
 * The PGlite base shared by scripts/sql-harness-0359.mjs, tests/helpers/refund-pglite.ts and the sim tooling's local
 * check: the REAL DDL of every migration 0359 depends on, then the REAL 0357 -> 0358 -> 0359. SYNTHETIC ROWS ONLY.
 * Nothing here touches a real database.
 *
 *   base({ upTo })           upTo = "base" | "0357" | "0358" | "0359" (default "0359")
 *   withStandIns(db)         the ISOLATED TEST FIXTURE of plan B1.5 "B1 proof before B2 exists": the fixture owner
 *                            inserts stand-in install records for the two later contracts (B2, B3). Test setup only:
 *                            no production migration and no application code can do this (no role but the owner
 *                            holds INSERT on the table, and there is no registration function).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const M0357 = read("0357_catering_refund_requests.sql");
export const M0358 = read("0358_catering_refund_roles.sql");
export const M0359 = read("0359_catering_refund_reconciler.sql");
export const CALLER = "b1-1";

function must(match, what) {
  if (!match) throw new Error(`harness: could not extract ${what}`);
  return match[0];
}
function table(file, name) {
  return must(read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")), `${name} from ${file}`);
}
const M0127 = read("0127_catering_portal_orders.sql");
const M0204 = read("0204_stripe_events_and_checkout.sql");
const M0343 = read("0343_demand_signal_sources.sql");
const QUOTES_0120 = table("0120_catering_quotes.sql", "catering_quotes");
const QUOTES_0127 = must(
  M0127.match(/ALTER TABLE catering_quotes DROP CONSTRAINT catering_quotes_status_check;[\s\S]*?CHECK \(origin IN \('self_serve','staff'\)\);/i),
  "0127 catering_quotes alters",
);
const PAYMENTS_0127 = must(
  M0127.match(/CREATE TABLE catering_payments \([\s\S]*?ALTER TABLE catering_payments ENABLE ROW LEVEL SECURITY;/i),
  "0127 catering_payments",
);
const EVENTS_0333 = table("0333_marketing_entry_moves_and_refund_time.sql", "catering_payment_refund_events");
const STRIPE_EVENTS_0204 = must(M0204.match(/create table if not exists public\.stripe_events \([\s\S]*?\n\);/i), "0204 stripe_events");
/** 0343's cron lease as it stands on main: the eight-job CHECK and the function body, verbatim. */
const CRON_0343 = must(
  M0343.match(/alter table public\.cron_route_leases drop constraint cron_route_leases_job_check,[\s\S]*?return claimed is not null;\nend \$\$;/),
  "0343 cron lease",
);

export async function base({ upTo = "0359" } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key default gen_random_uuid(), code text, active boolean not null default true);
    create table public.users (id uuid primary key default gen_random_uuid(), role text not null, active boolean not null default true, name text);
    create table public.user_locations (user_id uuid not null references public.users(id), location_id uuid not null references public.locations(id),
      active boolean not null default true, primary key (user_id, location_id));
    create table public.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
      revoked_at timestamptz, expires_at timestamptz not null default now() + interval '12 hours',
      step_up_unlocked boolean not null default false, step_up_unlocked_at timestamptz);
    create table public.audit_log (id bigserial primary key, actor_id uuid, actor_role text, action text not null, resource_table text,
      resource_id uuid, metadata jsonb, destructive boolean not null default false, occurred_at timestamptz not null default now());
    ${table("0108_catering_scaffold_capture.sql", "catering_customers")}
    ${table("0108_catering_scaffold_capture.sql", "catering_pipeline")}
    create table public.catering_delivery_zones (id uuid primary key default gen_random_uuid());
    ${QUOTES_0120}
    ${QUOTES_0127}
    ${PAYMENTS_0127}
    alter table public.catering_payments add column provider_session_id text, add column settlement_cleanup_at timestamptz;
    ${EVENTS_0333}
    ${STRIPE_EVENTS_0204}
    alter table public.stripe_events enable row level security;
    create table public.cron_route_leases (job text primary key, lease_until timestamptz not null,
      constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan')));
    alter table public.cron_route_leases enable row level security;
    revoke all on public.cron_route_leases from public, anon, authenticated, service_role;
    create function public.claim_cron_route(p_job text) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$ begin return false; end $$;
    revoke all on function public.claim_cron_route(text) from public, anon, authenticated;
    grant execute on function public.claim_cron_route(text) to service_role;
    ${CRON_0343}
    -- What production has: service_role holds the ordinary privileges on main's own tables (Supabase's default
    -- grants), and exactly SELECT + INSERT on 0333's refund events (0333's own grant). The refund migrations state
    -- their own tables' privileges themselves.
    grant select, insert, update, delete on public.locations, public.users, public.user_locations, public.sessions, public.audit_log,
      public.catering_customers, public.catering_pipeline, public.catering_delivery_zones, public.catering_quotes,
      public.catering_payments, public.stripe_events to service_role;
    grant usage, select on all sequences in schema public to service_role;
    grant select, insert on public.catering_payment_refund_events to service_role;`);
  if (upTo === "base") return db;
  await db.exec(M0357);
  if (upTo === "0357") return db;
  await db.exec(M0358);
  if (upTo === "0358") return db;
  await db.exec(M0359);
  return db;
}

/** The isolated test fixture: stand-in install records for the two later contracts. Fixture owner only. */
export async function withStandIns(db) {
  await db.exec(`insert into public.catering_refund_install_contracts (part, version, migration) values
    ('B2', 'b2-1', '0362_fixture_stand_in'), ('B3', 'b3-1', '0363_fixture_stand_in')`);
  return db;
}

export const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
export const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows;
export const count = async (db, sql, params = []) => Number((await one(db, sql, params)).n);

/** The two body fingerprints of a function (0358's convention): house, and exact. */
export async function fingerprints(db, signature) {
  return one(db, `select md5(regexp_replace(prosrc, '[^\\x21-\\x7E]+', '', 'g')) as house,
      md5(btrim(regexp_replace(prosrc, '\\s*[\\r\\n]+\\s*', E'\\n', 'g'), E' \\t\\r\\n')) as exact
    from pg_proc where oid = $1::regprocedure`, [`public.${signature}`]);
}
