/** Local Postgres proof: apply unchanged 0235 + authored 0241, then the SIM SQL harness.
 * Minimal prerequisite schema, no network or credentials. Does not replace CC's Supabase SIM gate.
 * Run: node scripts/sql-harness-0241.mjs
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(`
    create extension pgcrypto;
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.locations(id uuid primary key default gen_random_uuid(), code text, active boolean default true);
    create table public.users(id uuid primary key default gen_random_uuid(), role text, active boolean default true, name text, email text);
    create table public.user_locations(user_id uuid references public.users(id), location_id uuid references public.locations(id), active boolean default true);
    create table public.audit_log(id uuid primary key default gen_random_uuid(), actor_id uuid references public.users(id), actor_role text,
      action text not null, resource_table text, resource_id uuid, metadata jsonb not null, destructive boolean not null);
    insert into public.locations(code) values ('SIM');
    insert into public.users(role,name,email) values ('gm','Sim manager','maya@sim.co-ops'),('owner','Sim owner','owner@sim.co-ops');
    insert into public.user_locations select u.id,l.id,true from public.users u cross join public.locations l;
  `);
  for (const file of ["supabase/migrations/0235_password_vault.sql", "supabase/migrations/0241_vault_hardening.sql", "scripts/test-password-vault.sql"]) {
    await db.exec(readFileSync(file, "utf8"));
    console.log(`PASS ${file}`);
  }
} finally {
  await db.close();
}
