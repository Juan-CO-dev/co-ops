// 0360 (the Demand AI monthly ceiling: $5.00 to $50.00): the offline proof. PGlite, one session, synthetic fixtures;
// no network, no sim, no prod. The REAL parents, the REAL 0342 / 0343 / 0352, then the REAL 0360.
//  - before: 0352's ceiling; the new app's $50.00 cap is REFUSED (the app-first order, pinned as broken);
//  - the pre-flight refuses a drifted database by name and changes nothing (each drift made and undone here);
//  - the in-file digest bites on any other change in public, and passes on harmless activity;
//  - after: the ceiling is 50,000,000 for the function, the reserve and the reader; the OLD app's $5.00 cap still
//    reserves (the migration-first order); a lower caller cap still binds; the month fills to exactly $50.00 and not
//    one microdollar more; the per-reservation bound is still 0352's 5,000,000; owner and ACL are unchanged.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshLaborParents } from "./helpers/fact-0338-parents";
import { DEMAND_AI_CODE_CAP_MICRO } from "@/lib/demand-signals/insights-shared";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
const M0342 = read("0342_demand_signals_replay.sql");
const M0343 = read("0343_demand_signal_sources.sql");
const M0352 = read("0352_demand_ai_insights.sql");
const M0360 = read("0360_demand_ai_cap.sql");
const OLD = 5_000_000, NEW = 50_000_000;
const HASH = "a".repeat(64), MODEL = "claude-opus-5-5";
const FN = "public.demand_ai_cap_ceiling_micro()";
const RESERVE = "public.demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)";
const SHOPS = Array.from({ length: 14 }, () => randomUUID());
const MOO = randomUUID(), GM = randomUUID();
/** Where a statement is injected into a COPY of the file: after the re-emit and its privileges, before the assertions. */
const ASSERT_MARK = "-- ── Assertions (raise = nothing in this file is kept)";
const inject = (statement: string) => {
  expect(M0360.split(ASSERT_MARK)).toHaveLength(2);
  // A function replacer: in a replacement STRING, `$$` would be read as one literal `$` and break the dollar quotes.
  return M0360.replace(ASSERT_MARK, () => `${statement}\n${ASSERT_MARK}`);
};
/** 0352's own CREATE of one function, as CREATE OR REPLACE (the test's way to put a body back, or to drift it). */
const statement0352 = (name: string) => {
  const m = M0352.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`));
  if (!m) throw new Error(`${name} not found in 0352`);
  return m[0].replace("create function", () => "create or replace function");
};

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = unknown>(sql: string, params: unknown[] = []) => Object.values((await q(sql, params))[0] as Record<string, T>)[0] as T;
const count = (table: string, where = "true") => one<number>(`select count(*)::int from ${table} where ${where}`);
const ceiling = () => one<number | string>(`select ${FN}`).then(Number);
const spent = () => one<number | string>("select demand_ai_month_spent_micro(demand_today_et())").then(Number);
const today = (shop: string) => one<{ attempt: Record<string, unknown> | null; month_spent_micro: number; cap_ceiling_micro: number }>("select demand_ai_today($1)", [shop]);
const reserve = (shop: string, micro: number, cap: number, actor: string | null = MOO) =>
  one<{ id: string; month_spent_before_micro: number }>("select demand_ai_reserve($1,$2,$3,$4,$5,$6,$7)", [actor, shop, HASH, MODEL, 1, micro, cap]);
const fails = async (p: Promise<unknown>, message: string | RegExp) => { await expect(p).rejects.toThrow(message); };
async function as<T>(role: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}
/** Everything about the function except its body, and its body's two fingerprints. */
const fnRow = () => one<Record<string, unknown>>(`select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = '${FN}'::regprocedure`);
const fnBody = () => one<string>(`select p.prosrc from pg_proc p where p.oid = '${FN}'::regprocedure`);
const aclOf = (fn: string) => one<string>(`select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
  || case when a.is_grantable then '*' else '' end, ',' order by 1), '') from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${fn}'::regprocedure`);
/** A drift made inside a transaction, the file run on top of it, the named refusal, and everything rolled back. */
async function refused(drift: string, message: string | RegExp, file = M0360) {
  await db.exec("begin");
  try {
    if (drift) await db.exec(drift);
    await fails(db.exec(file), message);
  } finally { await db.exec("rollback"); }
  expect(await ceiling()).toBe(OLD);
  expect(await fnBody()).toBe(`\n  select ${OLD}::bigint\n`);
}

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(`create table public.user_locations(user_id uuid not null, location_id uuid not null, active boolean not null default true, assigned_by uuid);`);
  await db.exec(M0342);
  await db.exec(M0343);
  await db.exec(M0352);
  for (const [i, id] of SHOPS.entries()) await db.query("insert into locations(id, name, active) values ($1,$2,true)", [id, `Shop ${i + 1}`]);
  await db.query("insert into users(id, role, active) values ($1,'moo',true), ($2,'gm',true)", [MOO, GM]);
  await db.query("insert into user_locations(user_id, location_id, active) values ($1,$2,true)", [GM, SHOPS[0]]);
}, 240_000);

describe("0360: before it is applied", () => {
  it("0352's ceiling is live, and THE APP-FIRST ORDER IS REFUSED: a $50.00 cap is demand_ai_invalid, by the ceiling alone", async () => {
    expect(await ceiling()).toBe(OLD);
    expect(Number((await today(SHOPS[0]!)).cap_ceiling_micro)).toBe(OLD);
    // A known-good request: the same call with the old cap is rolled back after it succeeds, so `demand_ai_invalid`
    // below can only be the ceiling comparison (the actor, shop, hash, model, version and amount are all valid).
    await db.exec("begin");
    try { expect((await reserve(SHOPS[0]!, 70_000, OLD)).id).toMatch(/^[0-9a-f-]{36}$/); } finally { await db.exec("rollback"); }
    await fails(reserve(SHOPS[0]!, 70_000, OLD + 1), "demand_ai_invalid");
    await fails(reserve(SHOPS[0]!, 70_000, DEMAND_AI_CODE_CAP_MICRO), "demand_ai_invalid");   // what the new app sends
    await fails(reserve(SHOPS[0]!, 70_000, DEMAND_AI_CODE_CAP_MICRO, GM), "demand_ai_invalid");
    expect(await count("demand_ai_reservations")).toBe(0);
    expect(await count("audit_log", "action = 'demand_ai.request'")).toBe(0);
  });
});

describe("0360: the pre-flight refuses a drifted database by name and changes nothing", () => {
  it("a later definer of the ceiling, or a body that differs by one space inside a line", async () => {
    await refused(`create or replace function ${FN} returns bigint language sql immutable set search_path = pg_catalog, public as $$\n  select 6000000::bigint\n$$;`,
      "is not its 0352 definition -- a later definer exists; re-emit from it. Refusing.");
    // Same printing characters, one more space: the house fingerprint cannot see it, the exact one does.
    await refused(`create or replace function ${FN} returns bigint language sql immutable set search_path = pg_catalog, public as $$\n  select  5000000::bigint\n$$;`,
      "is not its 0352 definition");
  });
  it("a changed shape: security definer, another volatility, another search_path, a second overload", async () => {
    await refused(`alter function ${FN} security definer;`, "is not 0352's shape");
    await refused(`alter function ${FN} stable;`, "is not 0352's shape");
    await refused(`alter function ${FN} set search_path = public;`, "is not 0352's shape");
    await refused(`alter function ${FN} reset search_path;`, "is not 0352's shape");
    await refused(`create function public.demand_ai_cap_ceiling_micro(integer) returns bigint language sql immutable as $$ select 1::bigint $$;`, "has more than one overload. Refusing.");
  });
  it("a grant it does not expect is REFUSED, never silently revoked: on the ceiling and on the reserve", async () => {
    await refused(`grant execute on function ${FN} to authenticated;`, "authenticated may execute");
    await refused(`grant execute on function ${FN} to anon;`, "anon may execute");
    await refused(`grant execute on function ${FN} to public;`, "public may execute");
    await refused(`grant execute on function ${FN} to service_role with grant option;`, /the ACL of .* is not 0352's \(it is: postgres=EXECUTE\/postgres,service_role=EXECUTE\*\/postgres\)/);
    await refused(`create role someone_else; grant execute on function ${FN} to someone_else;`,
      /the ACL of .* is not 0352's \(it is: postgres=EXECUTE\/postgres,service_role=EXECUTE\/postgres,someone_else=EXECUTE\/postgres\)/);
    await refused(`revoke execute on function ${FN} from service_role;`, "service_role cannot execute");
    await refused(`grant execute on function ${RESERVE} to authenticated;`, /authenticated may execute demand_ai_reserve/);
    await refused(`revoke execute on function public.demand_ai_today(uuid) from service_role;`, /service_role cannot execute demand_ai_today/);
    // A NULL ACL is Postgres's default (PUBLIC may execute): it is refused, not read as "no PUBLIC entry".
    await refused(`update pg_proc set proacl = null where oid = '${FN}'::regprocedure;`, "public may execute");
  });
  it("THE WHOLE ACL includes the owner's own entry and who granted each privilege (review, Astra P2 / Opus P3)", async () => {
    // The owner lost its own EXECUTE on the claims validator: a later settlement run as the owner would fail and leave the
    // reservation charged in full. The three named roles and service_role all read as before; only the whole ACL sees it.
    await refused(`revoke execute on function public.demand_ai_claims_valid(jsonb) from postgres;`,
      /the ACL of demand_ai_claims_valid\(jsonb\) is not 0352's \(it is: service_role=EXECUTE\/postgres\)/);
    await refused(`revoke execute on function ${FN} from postgres;`, /the ACL of demand_ai_cap_ceiling_micro\(\) is not 0352's \(it is: service_role=EXECUTE\/postgres\)/);
    // service_role's EXECUTE granted by ANOTHER role: this file's own GRANT (run by postgres) would add a second entry, so
    // it is refused in the pre-flight, by name, and not later by the equal-to-before assertion.
    await refused(`create role granter; revoke execute on function ${FN} from service_role; grant execute on function ${FN} to granter with grant option;
      set role granter; grant execute on function ${FN} to service_role; reset role;`,
      /the ACL of demand_ai_cap_ceiling_micro\(\) is not 0352's \(it is: granter=EXECUTE\*\/postgres,postgres=EXECUTE\/postgres,service_role=EXECUTE\/granter\)/);
    expect(await one("select current_user")).toBe("postgres");
  });
  it("WHAT EACH OF THE SIX IS, not only its text: a metadata-only drift keeps the body's fingerprints and is refused (review, Astra P2)", async () => {
    // The reserve made STABLE: same source, owner and ACL, and then every reservation fails at its FOR SHARE.
    await refused(`alter function ${RESERVE} stable;`, "public.demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint) is not 0352's shape (it is plpgsql:s:t:jsonb:7, 0352 made it plpgsql:v:t:jsonb:7). Refusing.");
    await refused(`alter function ${RESERVE} security invoker;`, "is not 0352's shape (it is plpgsql:v:f:jsonb:7, 0352 made it plpgsql:v:t:jsonb:7)");
    await refused(`alter function public.demand_ai_today(uuid) security invoker;`, "public.demand_ai_today(uuid) is not 0352's shape (it is plpgsql:v:f:jsonb:1,");
    await refused(`alter function public.demand_ai_month_spent_micro(date) volatile;`, "public.demand_ai_month_spent_micro(date) is not 0352's shape (it is sql:v:t:bigint:1, 0352 made it sql:s:t:bigint:1)");
    await refused(`alter function public.demand_ai_claims_valid(jsonb) security definer;`, "public.demand_ai_claims_valid(jsonb) is not 0352's shape (it is plpgsql:i:t:boolean:1,");
    await refused(`alter function public.demand_ai_claims_valid(jsonb) strict;`, "public.demand_ai_claims_valid(jsonb) is not 0352's shape (it is plpgsql:i:f:boolean:1:odd,");
    await refused(`alter function public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer) set search_path = public;`, "is not 0352's shape (it is plpgsql:v:t:jsonb:9:config,");
    await refused(`alter function public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer) reset search_path;`, "is not 0352's shape (it is plpgsql:v:t:jsonb:9:config,");
    await refused(`alter function ${FN} parallel safe;`, "public.demand_ai_cap_ceiling_micro() is not 0352's shape (it is sql:i:f:bigint:0:odd,");
    await refused(`alter function ${FN} leakproof;`, "is not 0352's shape (it is sql:i:f:bigint:0:odd,");
    // A set-returning twin with the same source, value and argument list (CREATE OR REPLACE cannot change the return
    // type, so it is dropped and made again; the privileges are put back the way 0352 left them).
    await refused(`drop function ${FN} cascade;
      create function ${FN} returns setof bigint language sql immutable set search_path = pg_catalog, public as $$\n  select 5000000::bigint\n$$;
      revoke all on function ${FN} from public, anon, authenticated, service_role; grant execute on function ${FN} to service_role;`, "is not 0352's shape (it is sql:i:f:bigint:0:odd,");
  });
  it("A DATABASE THAT RECORDS 0360 IS NEVER RAISED A SECOND TIME (review, Astra P2): 0352's body with a 0360 ledger row is refused", async () => {
    const ledger = `create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);`;
    await refused(`${ledger} insert into supabase_migrations.schema_migrations values ('20261127233259', '0360_demand_ai_cap', array['(the file)']);`,
      "0360: already recorded as applied, and the live body is 0352's again: the ceiling was lowered after 0360. Re-emit from the later definer. Refusing.");
    // A ledger that records only OTHER migrations says nothing, and neither does a database with no ledger at all (every other test here).
    await db.exec("begin");
    try {
      await db.exec(`${ledger} insert into supabase_migrations.schema_migrations values ('20261120033423', '0352_demand_ai_insights', array['x']);`);
      // The file's own `begin;` only warns inside this transaction; its `commit;` is cut off so the whole thing rolls back here.
      expect(M0360.endsWith("\ncommit;\n")).toBe(true);
      await db.exec(M0360.slice(0, -"commit;\n".length));
      expect(await ceiling()).toBe(NEW);
    } finally { await db.exec("rollback"); }
    expect(await ceiling()).toBe(OLD);
    expect(await one("select to_regclass('supabase_migrations.schema_migrations') is null")).toBe(true);
  });
  it("another owner", async () => {
    await refused(`alter function ${RESERVE} owner to service_role;`, /demand_ai_reserve\(.*\) is not owned by postgres/);
    await refused(`alter function ${FN} owner to service_role;`, /demand_ai_cap_ceiling_micro\(\) is not owned by postgres/);
  });
  it("THE CODE THAT ENFORCES THE LIMIT has changed: the reserve, the month's accounting or the reader is not 0352's", async () => {
    const reserveNoCeiling = statement0352("demand_ai_reserve").replace("or p_cap_micro > public.demand_ai_cap_ceiling_micro() then", () => "then");
    expect(reserveNoCeiling).not.toBe(statement0352("demand_ai_reserve"));
    await refused(reserveNoCeiling, /the live body of public\.demand_ai_reserve\(.*\) is not its 0352 definition -- the code that enforces the ceiling has changed/);
    const monthAlwaysZero = statement0352("demand_ai_month_spent_micro").replace("else r.reserved_micro end), 0)", () => "else 0 end), 0)");
    expect(monthAlwaysZero).not.toBe(statement0352("demand_ai_month_spent_micro"));
    await refused(monthAlwaysZero, /the live body of public\.demand_ai_month_spent_micro\(date\) is not its 0352 definition/);
    const todayOtherCap = statement0352("demand_ai_today").replace("'cap_ceiling_micro', public.demand_ai_cap_ceiling_micro()", () => "'cap_ceiling_micro', 1");
    expect(todayOtherCap).not.toBe(statement0352("demand_ai_today"));
    await refused(todayOtherCap, /the live body of public\.demand_ai_today\(uuid\) is not its 0352 definition/);
  });
  it("0352 is not (all) there; the per-reservation bound is not 0352's", async () => {
    await refused(`drop function public.demand_ai_today(uuid);`, "function public.demand_ai_today(uuid) is missing (0352 must be applied first)");
    await refused(`drop table public.demand_ai_settlements;`, "public.demand_ai_settlements is missing (0352 must be applied first)");
    await refused(`alter table public.demand_ai_reservations drop constraint demand_ai_reservations_reserved_micro_check;
      alter table public.demand_ai_reservations add constraint demand_ai_reservations_reserved_micro_check check (reserved_micro between 1 and 50000000);`,
      "the per-reservation bound on demand_ai_reservations.reserved_micro is not 0352's (1 to 5000000). This file does not change it. Refusing.");
    await refused(`alter table public.demand_ai_reservations drop constraint demand_ai_reservations_reserved_micro_check;`, "the per-reservation bound");
  });
});

describe("0360: the in-file digest (nothing else in public changed)", () => {
  it("BITES on every kind of change it claims to compare, made between the pre-flight and the assertions; nothing of it is kept", async () => {
    const strays = [
      "create table public.zz_stray(id integer);",
      "alter table public.locations add column zz_stray integer;",
      "create index zz_stray on public.locations(name);",
      "create policy zz_stray on public.demand_ai_reservations for select using (true);",
      "grant select on public.demand_ai_reservations to anon;",
      "grant insert on public.demand_ai_settlements to service_role;",
      "alter table public.demand_ai_settlements disable row level security;",
      "comment on table public.demand_ai_reservations is 'zz stray';",
      "alter table public.demand_ai_settlements add constraint zz_stray check (rejected_count < 1000000);",
      "alter table public.demand_ai_settlements alter column rejected_count set default 1;",
      // A column's STORAGE and COMPRESSION, and a table's storage options (review, Astra P2: attstorage was not compared).
      "alter table public.demand_ai_settlements alter column error_code set storage external;",
      "alter table public.demand_ai_settlements alter column stop_reason set compression pglz;",
      "alter table public.demand_ai_reservations set (fillfactor = 90);",
      "alter table public.demand_ai_reservations alter column model set not null, alter column requested_role drop not null;",
      "alter table public.demand_ai_reservations replica identity full;",
      "alter table public.demand_ai_settlements alter constraint demand_ai_settlements_reservation_id_fkey deferrable initially deferred;",
      "create trigger zz_stray before insert on public.demand_ai_settlements for each row execute function suppress_redundant_updates_trigger();",
      "alter table public.demand_ai_reservations disable row level security;",
      "create function public.zz_stray() returns integer language sql as $$ select 1 $$;",
      // Another function replaced: one the pre-flight does not fingerprint, so only the digest can see it.
      "create or replace function public.demand_ai_claims_valid(p_claims jsonb) returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$ begin return true; end $$;",
      // A property of ANOTHER function that neither the fingerprints nor the shape rows read: only the whole-row digest sees it.
      "alter function public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer) cost 500;",
      "create view public.zz_stray as select 1 as one;",
      "create type public.zz_stray as enum ('a');",
      "create sequence public.zz_stray;",
      "revoke usage on schema public from anon;",
    ];
    for (const stray of strays) {
      await db.exec("begin");
      try { await fails(db.exec(inject(stray)), /0360: something else in schema public changed while this ran \(before fn:\d+:[0-9a-f]{32} rel:/); }
      catch (e) { throw new Error(`${stray}: ${(e as Error).message}`); }
      finally { await db.exec("rollback"); }
      expect(await ceiling(), stray).toBe(OLD);
    }
    expect(await one("select to_regclass('public.zz_stray') is null and to_regprocedure('public.zz_stray()') is null")).toBe(true);
    expect(await aclOf("public.demand_ai_claims_valid(jsonb)")).toBe("postgres=EXECUTE,service_role=EXECUTE");
  });
  it("a missing pre-flight reading raises (a NULL never passes), for the function row and for the digest", async () => {
    for (const key of ["co_ops.m0360_fn_before", "co_ops.m0360_public_before"]) {
      const copy = M0360.replace(`perform set_config('${key}'`, () => `perform set_config('${key}_elsewhere'`);
      expect(copy).not.toBe(M0360);
      await db.exec("begin");
      try { await fails(db.exec(copy), key.endsWith("fn_before") ? "0360: the pre-flight reading of the function is missing" : "0360: the pre-flight catalog digest is missing"); }
      finally { await db.exec("rollback"); }
      expect(await ceiling()).toBe(OLD);
    }
  });
  it("a re-emit that changes MORE than the body is refused by the equal-to-before check", async () => {
    const copy = M0360.replace("returns bigint language sql immutable set search_path = pg_catalog, public as $$\n  select 50000000::bigint",
      () => "returns bigint language sql immutable parallel safe set search_path = pg_catalog, public as $$\n  select 50000000::bigint");
    expect(copy).not.toBe(M0360);
    await db.exec("begin");
    try { await fails(db.exec(copy), "0360: demand_ai_cap_ceiling_micro() changed in more than its body"); } finally { await db.exec("rollback"); }
    // And a wrong number is refused by the value assertion (the fingerprint of the body written would also differ).
    const wrong = M0360.replace("$$\n  select 50000000::bigint\n$$;", () => "$$\n  select 500000000::bigint\n$$;");
    expect(wrong).not.toBe(M0360);
    await db.exec("begin");
    try { await fails(db.exec(wrong), "0360: demand_ai_cap_ceiling_micro() does not return 50000000 as a bigint (500000000)"); } finally { await db.exec("rollback"); }
    expect(await ceiling()).toBe(OLD);
  });
  it("PASSES on harmless activity: statistics and plain rows are not in it (then the test puts 0352's body back)", async () => {
    const before = await fnRow();
    await db.exec(inject(`analyze public.locations; analyze public.demand_ai_reservations;
      insert into public.locations(id, name, active) values (gen_random_uuid(), 'A harmless row', false);`));
    expect(await ceiling()).toBe(NEW);
    expect(await fnRow()).toEqual(before);
    await db.exec(statement0352("demand_ai_cap_ceiling_micro"));
    expect(await ceiling()).toBe(OLD);
    expect(await fnRow()).toEqual(before);
    expect(await fnBody()).toBe(`\n  select ${OLD}::bigint\n`);
  });
});

describe("0360: applied", () => {
  let rowBefore: Record<string, unknown>, aclBefore: string, othersBefore: string;
  const others = () => one<string>(`select md5(string_agg(to_jsonb(p)::text, '|' order by p.oid)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.oid <> '${FN}'::regprocedure`);
  it("the REAL file applies; its own assertions pass; only the body of the one function changed", async () => {
    rowBefore = await fnRow(); aclBefore = await aclOf(FN); othersBefore = await others();
    await db.exec(M0360);
    expect(await ceiling()).toBe(NEW);
    expect(await ceiling()).toBe(DEMAND_AI_CODE_CAP_MICRO);          // the app's cap and the database's ceiling agree
    expect(await fnBody()).toBe(`\n  select ${NEW}::bigint\n`);
    expect(await fnRow()).toEqual(rowBefore);                        // owner, ACL, settings, volatility, language, arguments
    expect(rowBefore).toMatchObject({ provolatile: "i", prosecdef: false, proconfig: ["search_path=pg_catalog, public"], pronargs: 0 });
    expect(await aclOf(FN)).toBe(aclBefore);
    expect(aclBefore).toBe("postgres=EXECUTE,service_role=EXECUTE");
    expect(await others()).toBe(othersBefore);
    expect(await one(`select p.proowner::regrole::text from pg_proc p where p.oid = '${FN}'::regprocedure`)).toBe("postgres");
    expect(await count("demand_ai_reservations")).toBe(0);
    expect(await count("audit_log", "action = 'demand_ai.request'")).toBe(0);
  });
  it("a second apply is refused by name and changes nothing", async () => {
    await fails(db.exec(M0360), "0360: already applied");
    await db.exec("rollback");
    expect(await ceiling()).toBe(NEW);
  });
  it("PostgREST roles still cannot execute it; service_role reads the new number", async () => {
    for (const role of ["anon", "authenticated"]) await as(role, () => fails(db.query(`select ${FN}`), "permission denied"));
    expect(Number(await as("service_role", () => one(`select ${FN}`)))).toBe(NEW);
    expect(Number((await as("service_role", () => today(SHOPS[0]!))).cap_ceiling_micro)).toBe(NEW);
  });
  it("THE MIGRATION-FIRST ORDER: the old app's $5.00 cap still reserves, exactly as before", async () => {
    const out = await reserve(SHOPS[0]!, 70_000, OLD, GM);
    expect(Number(out.month_spent_before_micro)).toBe(0);
    expect(await spent()).toBe(70_000);
    expect((await q<{ metadata: { cap_micro: number } }>("select metadata from audit_log where action = 'demand_ai.request'"))[0]!.metadata.cap_micro).toBe(OLD);
  });
  it("the new cap reserves; one microdollar above the ceiling is refused, with nothing else changed in the call", async () => {
    await fails(reserve(SHOPS[1]!, 70_000, NEW + 1), "demand_ai_invalid");
    expect(await count("demand_ai_reservations")).toBe(1);
    const out = await reserve(SHOPS[1]!, 70_000, NEW);                // the same call, the cap alone lowered by one
    expect(Number(out.month_spent_before_micro)).toBe(70_000);
    expect(await count("demand_ai_reservations")).toBe(2);
  });
  it("THE PER-RESERVATION BOUND IS UNCHANGED: 5,000,000 fits, 5,000,001 is refused by 0352's table check, with headroom to spare", async () => {
    const err = await reserve(SHOPS[2]!, OLD + 1, NEW).then(() => null, (e: Error & { code?: string; constraint?: string }) => e);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("23514");
    expect(err!.message).toContain("demand_ai_reservations_reserved_micro_check");
    expect(await count("demand_ai_reservations")).toBe(2);
    await reserve(SHOPS[2]!, OLD, NEW);
    expect(await spent()).toBe(140_000 + OLD);
  });
  it("a month above $5.00 keeps admitting under the $50.00 cap, and a caller's LOWER cap still binds", async () => {
    const soFar = await spent();
    expect(soFar).toBeGreaterThan(OLD);
    // The old app (cap 5,000,000) is now past its own cap: refused by name, as it always was.
    await fails(reserve(SHOPS[3]!, 1, OLD), "demand_ai_cap_reached");
    await fails(reserve(SHOPS[3]!, 50_000, soFar + 49_999), "demand_ai_cap_reached");
    const d = await reserve(SHOPS[3]!, 50_000, soFar + 50_000);       // exactly at the caller's cap fits
    expect(Number(d.month_spent_before_micro)).toBe(soFar);
  });
  it("THE MONTH FILLS TO EXACTLY $50.00 AND NOT ONE MICRODOLLAR MORE", async () => {
    // Same-day reservations across shops (one per shop per ET day), so this never depends on the day of the month.
    for (const shop of SHOPS.slice(4, 12)) await reserve(shop, OLD, NEW);     // eight more at the per-reservation bound
    const left = NEW - (await spent());
    expect(left).toBeGreaterThan(1);
    expect(left).toBeLessThanOrEqual(OLD);
    await fails(reserve(SHOPS[12]!, left + 1, NEW), "demand_ai_cap_reached");
    await reserve(SHOPS[12]!, left, NEW);                                      // exactly at the ceiling fits
    expect(await spent()).toBe(NEW);
    await fails(reserve(SHOPS[13]!, 1, NEW), "demand_ai_cap_reached");         // one microdollar over
    expect((await today(SHOPS[13]!)).attempt).toBeNull();
    const t = await today(SHOPS[12]!);
    expect([Number(t.month_spent_micro), Number(t.cap_ceiling_micro)]).toEqual([NEW, NEW]);
    expect(await count("demand_ai_reservations")).toBe(13);
    expect(await count("audit_log", "action = 'demand_ai.request'")).toBe(13);
  });
});
