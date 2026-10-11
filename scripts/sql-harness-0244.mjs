/** Local Postgres proof, synthetic rows only. CC still owns the Supabase sim/prod gate. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    create table public.users(id uuid primary key, active boolean, created_at timestamptz);
    grant select(id,active,created_at) on public.users to authenticated;
    grant select,update on public.users to service_role;
    create table public.toast_time_entries(location_id uuid,employee_guid text,user_id uuid,in_at timestamptz,deleted boolean);
    alter table public.toast_time_entries enable row level security;
    grant select on public.toast_time_entries to service_role;
  `);
  await db.exec(readFileSync("supabase/migrations/0244_dormant_people.sql", "utf8"));
  await db.exec(`
    insert into public.users values ('00000000-0000-4000-8000-000000000001',true,'2025-01-01',null,null);
    insert into public.toast_time_entries values
      ('00000000-0000-4000-8000-000000000010','e1','00000000-0000-4000-8000-000000000001','2026-04-12',false),
      ('00000000-0000-4000-8000-000000000010','e1','00000000-0000-4000-8000-000000000001','2026-05-12',false),
      ('00000000-0000-4000-8000-000000000010','e1','00000000-0000-4000-8000-000000000001','2026-10-11',true),
      ('00000000-0000-4000-8000-000000000011','e1',null,'2026-04-12',false),
      ('00000000-0000-4000-8000-000000000011','old',null,'2025-01-01',false);
    set role service_role;
    do $$ begin
      if (select count(*) from public.admin_last_clock_ins('2026-04-12')) <> 2 then raise exception 'window/grouping failed'; end if;
      if (select max(last_in_at) from public.admin_last_clock_ins('2026-04-12')) <> '2026-05-12'::timestamptz then raise exception 'deleted/max failed'; end if;
      if (select count(*) from public.admin_last_clock_ins('-infinity')) <> 3 then raise exception 'all-history failed'; end if;
      if not has_column_privilege('service_role','public.users','dormant_at','UPDATE') then raise exception 'service write failed'; end if;
      if not has_column_privilege('authenticated','public.users','active','SELECT') then raise exception 'old select lost'; end if;
    end $$;
    reset role;
  `);
  console.log("PASS 0244 grants, grouping, boundary, tombstones, all-history, service-role access");
} finally { await db.close(); }
