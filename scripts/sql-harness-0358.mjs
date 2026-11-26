/**
 * Local Postgres proof of migration 0358 (catering refund roles: GM and AGM join the membership branch of
 * `catering_refund_actor_ok`). SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns the Supabase sim / prod gate; this
 * never touches a real database.
 *
 *   node scripts/sql-harness-0358.mjs
 *
 * Builds the same base as scripts/sql-harness-0357.mjs (the REAL 0120 / 0127 / 0333 DDL, minimal users /
 * user_locations / locations / audit_log), applies the REAL 0357, then the REAL 0358, and proves:
 *   P0  the pre-flight: refuses without 0357; refuses a CHANGED live body by name (a later definer); refuses a second
 *       overload; refuses a second apply ("already applied"); a refused apply leaves 0357's body in place
 *   P1  OLD SQL (0357 alone, the "app deployed first" half of the deploy order): a GM / AGM is `false` at their own
 *       shop and the real reserve answers `forbidden`
 *   P2  what was re-emitted: SECURITY DEFINER, plpgsql, volatile, boolean, the pinned search_path and nothing else in
 *       proconfig; the body fingerprints written in the file are the real ones (0357's before, 0358's after)
 *   P3  who may EXECUTE it, asked two ways: has_function_privilege for anon / authenticated / PUBLIC (false) and
 *       service_role (true), and by actually calling it under each role (42501 for anon, authenticated and a fresh
 *       role that belongs to nothing = PUBLIC; an answer for service_role). The REVOKE is the file's own: a database
 *       where PUBLIC, anon and authenticated had been GRANTED execute before the apply ends with none of them
 *   P4  THE MATRIX: every role x {member, member elsewhere only, inactive membership, no membership, inactive user}
 *       x {the order's shop, no shop}. owner / cgs: any shop while active. moo / catering_mgr / gm / agm: only an
 *       active user with an ACTIVE membership at THAT shop. Everyone else (prep_mgr, social_media_mgr, shift_lead
 *       and below): never
 *   P5  the real reserve after 0358: a GM and an AGM refund at their member shop (the audit row names their role);
 *       another shop's GM, a GM whose membership is inactive, an inactive GM and a prep manager are `forbidden`,
 *       and a refusal writes nothing
 *   P6  nothing else moved: every other function body, ACL and setting in `public`, every table / column ACL and every
 *       column are identical before and after 0358 (0357's other five functions and its two tables included)
 *   P7  the in-file assertions refuse a drifted database and keep nothing: 0357's reserve executable by
 *       authenticated; service_role holding INSERT on the requests table; an extra UPDATE column; RLS off; a policy;
 *       anon holding SELECT on the snapshots table
 *   P8  the rollback written in the header: re-emitting 0357's body (kept verbatim below) restores 0357's fingerprint
 *       and a GM is refused again
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const M0357 = read("0357_catering_refund_requests.sql");
const M0358 = read("0358_catering_refund_roles.sql");

/** The fingerprints 0358 carries (its pre-flight and its own body assertion). */
export const FP_0357 = "e33880cdb5aab577a829ef45c2afa61a";
export const FP_0358 = "4076029ec89d7b777af23ff3d8fcbdee";

/** Every role code (held equal to lib/roles.ts by tests/catering-refund-0358-migration.test.ts). */
const ROLES = ["cgs", "owner", "moo", "gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee", "trainee", "hired_not_yet_worked", "prospect"];
const ANY_SHOP = ["owner", "cgs"];
const MEMBER_SHOP = ["moo", "catering_mgr", "gm", "agm"];

/** 0357's body of the actor rule, VERBATIM (the rollback's source; P8 proves it restores 0357's fingerprint). */
const ROLLBACK_TO_0357 = `create or replace function public.catering_refund_actor_ok(p_actor_id uuid, p_shop_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null then return false; end if;
  if v_role in ('owner', 'cgs') then return true; end if;
  if v_role in ('moo', 'catering_mgr') and p_shop_id is not null and exists (
       select 1 from public.user_locations m where m.user_id = p_actor_id and m.location_id = p_shop_id and m.active) then
    return true;
  end if;
  return false;
end $$;
revoke all on function public.catering_refund_actor_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;`;

function must(match, what) {
  if (!match) throw new Error(`harness: could not extract ${what}`);
  return match[0];
}
function table(file, name) {
  return must(read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")), `${name} from ${file}`);
}
const M0127 = read("0127_catering_portal_orders.sql");
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

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, needle, what) {
  try { await fn(); check(false, `${what} (no error; expected ${needle})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message} ${e.detail ?? ""}`; check(s.includes(needle), `${what} → ${needle}${s.includes(needle) ? "" : ` (got: ${s})`}`); }
}

/** The 0357 harness's base, plus (optionally) the REAL 0357. */
async function base({ with0357 = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key default gen_random_uuid(), code text, active boolean not null default true);
    create table public.users (id uuid primary key default gen_random_uuid(), role text not null, active boolean not null default true);
    create table public.user_locations (user_id uuid not null references public.users(id), location_id uuid not null references public.locations(id),
      active boolean not null default true, primary key (user_id, location_id));
    create table public.audit_log (id bigserial primary key, actor_id uuid, actor_role text, action text not null, resource_table text,
      resource_id uuid, metadata jsonb, destructive boolean not null default false, occurred_at timestamptz not null default now());
    ${table("0108_catering_scaffold_capture.sql", "catering_customers")}
    ${table("0108_catering_scaffold_capture.sql", "catering_pipeline")}
    create table public.catering_delivery_zones (id uuid primary key default gen_random_uuid());
    ${QUOTES_0120}
    ${QUOTES_0127}
    ${PAYMENTS_0127}
    ${EVENTS_0333}`);
  if (with0357) await db.exec(M0357);
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params = []) => Number((await one(db, sql, params)).n);
const fingerprint = async (db) => (await one(db, `select md5(regexp_replace(prosrc, '[^\\x21-\\x7E]+', '', 'g')) as fp from pg_proc
  where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure`)).fp;
/** Everything in `public` EXCEPT the one function 0358 re-emits: bodies, ACLs, settings, tables, columns, triggers. */
const digest = async (db) => one(db, `select
  (select md5(string_agg(p.oid::regprocedure::text || p.prosrc || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, '') || p.prosecdef::text || p.provolatile::text,
                         '|' order by p.oid::regprocedure::text))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'catering_refund_actor_ok') as fns,
  (select md5(string_agg(c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text, '|' order by c.relname))
     from pg_class c where c.relnamespace = 'public'::regnamespace) as rels,
  (select md5(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || a.atttypid::regtype::text || ':' || coalesce(a.attacl::text, ''), '|' order by a.attrelid::regclass::text, a.attname))
     from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped) as cols,
  (select md5(coalesce(string_agg(c.relname || '.' || t.tgname || ':' || t.tgenabled::text, '|' order by c.relname, t.tgname), ''))
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) as trgs,
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace) as fn_count,
  (select count(*)::int from pg_policies where schemaname = 'public') as policies`);
const actorAcl = async (db) => (await one(db, "select coalesce(proacl::text, '(default)') as acl from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure")).acl;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function fixtures(db) {
  const shop = (await one(db, "insert into public.locations (code) values ('S1') returning id")).id;
  const other = (await one(db, "insert into public.locations (code) values ('S2') returning id")).id;
  const user = async (role, { member = shop, active = true, memberActive = true } = {}) => {
    const id = (await one(db, "insert into public.users (role, active) values ($1, $2) returning id", [role, active])).id;
    if (member) await db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [id, member, memberActive]);
    return id;
  };
  const quote = async (loc = shop) => (await one(db,
    "insert into public.catering_quotes (location_id, version, status, root_id) values ($1, 1, 'accepted', null) returning id", [loc])).id;
  let n = 0;
  const pay = async (quoteId, kind, amount) => (await one(db,
    `insert into public.catering_payments (quote_id, kind, amount_cents, status, provider, provider_ref, paid_at)
     values ($1, $2, $3, 'paid', 'stripe', $4, now()) returning id`, [quoteId, kind, amount, `pi_test_${++n}`])).id;
  return { shop, other, user, quote, pay };
}
const ok = async (db, u, shop) => (await one(db, "select public.catering_refund_actor_ok($1, $2) as ok", [u, shop])).ok;
const reserve = (db, actor, quote, amount) =>
  db.query("select public.catering_refund_reserve($1, $2, $3, $4, 'customer_cancelled', null, 'panel') as r", [actor, quote, randomUUID(), amount]).then((r) => r.rows[0].r);

/** Apply 0358 to a database that must refuse it; prove the refusal by name and that nothing was kept. */
async function refusedApply(prepare, needle, what) {
  const db = await base();
  try {
    await prepare(db);
    const before = await digest(db);
    const aclBefore = await actorAcl(db);
    const fpBefore = await fingerprint(db);
    await refuses(() => db.exec(M0358), needle, what);
    await db.exec("rollback");
    check(fpBefore !== FP_0358 && (await fingerprint(db)) === fpBefore && same(await digest(db), before) && (await actorAcl(db)) === aclBefore, `${what}: nothing was kept`);
  } finally { await db.close(); }
}

let db;
try {
  // ── P0 — the pre-flight ──────────────────────────────────────────────────────────────────────
  {
    const no0357 = await base({ with0357: false });
    await refuses(() => no0357.exec(M0358), "0358: public.catering_refund_requests is missing (0357 must be applied first)", "P0 refuses without 0357");
    await no0357.exec("rollback");
    check((await one(no0357, "select to_regprocedure('public.catering_refund_actor_ok(uuid, uuid)') is null as gone")).gone === true, "P0 a refused apply creates no function");
    await no0357.close();
  }
  const CHANGED = ROLLBACK_TO_0357.replace("('moo', 'catering_mgr')", "('moo', 'catering_mgr', 'prep_mgr')");
  await refusedApply((d) => d.exec(CHANGED),
    "is not its 0357 definition -- a later definer exists; re-emit from it. Refusing.", "P0 a CHANGED live body is refused by name");
  await refusedApply((d) => d.exec("create function public.catering_refund_actor_ok(p_actor_id uuid) returns boolean language sql as 'select false'"),
    "0358: public.catering_refund_actor_ok has more than one overload. Refusing.", "P0 a second overload is refused");
  await refusedApply((d) => d.exec("drop function public.catering_refund_claim(uuid)"),
    "0358: function public.catering_refund_claim(uuid) is missing (0357 must be applied first)", "P0 a missing 0357 function is refused");

  db = await base();
  const f = await fixtures(db);
  check((await fingerprint(db)) === FP_0357, `P0 the live 0357 body's fingerprint is the one 0358 expects (${FP_0357})`);

  // ── P1 — OLD SQL: 0357 alone (the app deployed first) ────────────────────────────────────────
  const gm = await f.user("gm");
  const agm = await f.user("agm");
  const Q = await f.quote();
  await f.pay(Q, "deposit", 30000);
  await f.pay(Q, "balance", 70000);
  check((await ok(db, gm, f.shop)) === false && (await ok(db, agm, f.shop)) === false, "P1 old SQL: a GM and an AGM are false at their own shop");
  await refuses(() => reserve(db, gm, Q, 100), "forbidden", "P1 old SQL: the reserve refuses a GM (the app maps it to 403)");
  await refuses(() => reserve(db, agm, Q, 100), "forbidden", "P1 old SQL: the reserve refuses an AGM");
  check((await count(db, "select count(*) n from public.catering_refund_requests")) === 0, "P1 old SQL: nothing was reserved");

  // A database where the function had been opened to everyone: the file's own REVOKE must close it (P3).
  await db.exec("grant execute on function public.catering_refund_actor_ok(uuid, uuid) to public, anon, authenticated");
  check((await one(db, "select has_function_privilege('anon', 'public.catering_refund_actor_ok(uuid, uuid)', 'execute') as ok")).ok === true, "P3 (setup) before the apply anon CAN execute it");

  const before = await digest(db);
  await db.exec(M0358);
  check(true, "0358 applied");
  const after = await digest(db);

  // ── P0 again — a second apply ────────────────────────────────────────────────────────────────
  await refuses(() => db.exec(M0358), "0358: already applied", "P0 a second apply is refused");
  await db.exec("rollback");

  // ── P2 — what was re-emitted ─────────────────────────────────────────────────────────────────
  check((await fingerprint(db)) === FP_0358, `P2 the body is 0358's (${FP_0358})`);
  check(M0358.split(FP_0357).length === 3 && M0358.split(FP_0358).length === 4, "P2 the file carries exactly those two fingerprints (0357's twice, its own three times)");
  const fn = await one(db, `select p.prosecdef, p.provolatile::text as vol, p.prorettype::regtype::text as ret, p.proconfig, l.lanname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure`);
  check(fn.prosecdef === true, "P2 SECURITY DEFINER");
  check(same(fn.proconfig, ["search_path=pg_catalog, public"]), `P2 search_path pinned, and it is the only setting (${JSON.stringify(fn.proconfig)})`);
  check(fn.vol === "v" && fn.ret === "boolean" && fn.lanname === "plpgsql" && fn.args === "p_actor_id uuid, p_shop_id uuid", "P2 same signature, return type, language and volatility as 0357");
  check((await count(db, "select count(*) n from pg_proc where proname = 'catering_refund_actor_ok'")) === 1, "P2 still exactly one function by that name");

  // ── P3 — who may execute it ──────────────────────────────────────────────────────────────────
  const FN = "public.catering_refund_actor_ok(uuid, uuid)";
  for (const role of ["anon", "authenticated", "public"]) {
    check((await one(db, `select has_function_privilege('${role}', '${FN}', 'execute') as ok`)).ok === false, `P3 ${role === "public" ? "PUBLIC" : role} cannot execute it (has_function_privilege)`);
  }
  check((await one(db, `select has_function_privilege('service_role', '${FN}', 'execute') as ok`)).ok === true, "P3 service_role can (has_function_privilege)");
  check((await count(db, `select count(*) n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = '${FN}'::regprocedure and a.grantee = 0`)) === 0, "P3 no PUBLIC entry in its ACL");
  // 'public' really is the PUBLIC pseudo-role here: it answers true for a function nobody revoked.
  await db.exec("create function public.h0358_open() returns int language sql as 'select 1'");
  check((await one(db, "select has_function_privilege('public', 'public.h0358_open()', 'execute') as ok")).ok === true, "P3 control: has_function_privilege('public', …) is true for an un-revoked function");
  await db.exec("drop function public.h0358_open()");
  await db.exec("create role h0358_nobody");
  for (const role of ["anon", "authenticated", "h0358_nobody"]) {
    await db.exec(`set role ${role}`);
    try { await refuses(() => db.query(`select public.catering_refund_actor_ok($1, $2)`, [gm, f.shop]), "42501", `P3 calling it as ${role === "h0358_nobody" ? "a role that belongs to nothing (PUBLIC)" : role} is permission denied`); }
    finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { check((await ok(db, gm, f.shop)) === true, "P3 calling it as service_role answers (a member GM: true)"); }
  finally { await db.exec("reset role"); }
  await db.exec("drop role h0358_nobody");

  // ── P4 — the matrix ──────────────────────────────────────────────────────────────────────────
  const STATES = [
    ["member", { member: f.shop }],
    ["member of another shop only", { member: f.other }],
    ["inactive membership", { member: f.shop, memberActive: false }],
    ["no membership", { member: null }],
    ["inactive user (member)", { member: f.shop, active: false }],
  ];
  let cells = 0;
  let wrong = [];
  for (const role of ROLES) {
    for (const [state, opts] of STATES) {
      const u = await f.user(role, opts);
      const activeUser = opts.active !== false;
      const memberHere = opts.member === f.shop && opts.memberActive !== false;
      const wantShop = activeUser && (ANY_SHOP.includes(role) || (MEMBER_SHOP.includes(role) && memberHere));
      const wantNoShop = activeUser && ANY_SHOP.includes(role);
      const gotShop = await ok(db, u, f.shop);
      const gotNoShop = await ok(db, u, null);
      cells += 2;
      if (gotShop !== wantShop) wrong.push(`${role} / ${state} / the shop: ${gotShop}`);
      if (gotNoShop !== wantNoShop) wrong.push(`${role} / ${state} / no shop: ${gotNoShop}`);
    }
  }
  check(wrong.length === 0, `P4 the matrix: ${ROLES.length} roles x ${STATES.length} states x 2 shops = ${cells} cells${wrong.length ? ` — WRONG: ${wrong.join("; ")}` : ""}`);
  check(cells === 150, "P4 150 cells were asked");
  check((await ok(db, gm, f.shop)) === true && (await ok(db, agm, f.shop)) === true, "P4 new SQL: the same GM and AGM as P1 are now true at their own shop");
  check((await ok(db, gm, f.other)) === false && (await ok(db, agm, f.other)) === false, "P4 …and false at a shop they do not belong to");
  check((await ok(db, randomUUID(), f.shop)) === false && (await ok(db, null, f.shop)) === false, "P4 an unknown or missing actor is false");
  {
    // A membership that is switched off, then on: the rule follows the row.
    await db.query("update public.user_locations set active = false where user_id = $1", [agm]);
    const off = await ok(db, agm, f.shop);
    await db.query("update public.user_locations set active = true where user_id = $1", [agm]);
    check(off === false && (await ok(db, agm, f.shop)) === true, "P4 an AGM whose membership is deactivated is refused until it is active again");
    // A member of BOTH shops passes at both; deactivating the user refuses everywhere.
    const both = await f.user("gm");
    await db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [both, f.other]);
    check((await ok(db, both, f.shop)) === true && (await ok(db, both, f.other)) === true, "P4 a GM of two shops passes at each");
    await db.query("update public.users set active = false where id = $1", [both]);
    check((await ok(db, both, f.shop)) === false && (await ok(db, both, f.other)) === false, "P4 …and nowhere once deactivated");
  }

  // ── P5 — the real reserve after 0358 ─────────────────────────────────────────────────────────
  {
    const made = await reserve(db, gm, Q, 80000);
    check(made.replay === false && made.requests.length === 2 && made.location_id === f.shop, "P5 a GM refunds at their member shop (balance, then deposit)");
    const made2 = await reserve(db, agm, Q, 5000);
    check(made2.requests.length === 1 && Number(made2.requests[0].amount_cents) === 5000, "P5 an AGM refunds at their member shop");
    const audits = (await db.query("select actor_id, actor_role, destructive from public.audit_log where action = 'catering.refund.request' order by id")).rows;
    check(audits.length === 3 && audits.every((a) => a.destructive === true) && audits.filter((a) => a.actor_role === "gm" && a.actor_id === gm).length === 2
      && audits.filter((a) => a.actor_role === "agm" && a.actor_id === agm).length === 1, "P5 each row has its destructive audit row naming the GM / AGM");
    const rowsBefore = await count(db, "select count(*) n from public.catering_refund_requests");
    const auditBefore = await count(db, "select count(*) n from public.audit_log");
    const gmElsewhere = await f.user("gm", { member: f.other });
    const gmLapsed = await f.user("gm", { memberActive: false });
    const gmInactive = await f.user("gm", { active: false });
    const agmElsewhere = await f.user("agm", { member: f.other });
    const prep = await f.user("prep_mgr");
    const smm = await f.user("social_media_mgr");
    const lead = await f.user("shift_lead");
    for (const [u, name] of [[gmElsewhere, "a GM of another shop"], [gmLapsed, "a GM whose membership is inactive"], [gmInactive, "an inactive GM"],
      [agmElsewhere, "an AGM of another shop"], [prep, "a prep manager"], [smm, "a social media manager"], [lead, "a shift lead"]]) {
      await refuses(() => reserve(db, u, Q, 100), "forbidden", `P5 ${name} is refused by the reserve`);
    }
    check((await count(db, "select count(*) n from public.catering_refund_requests")) === rowsBefore && (await count(db, "select count(*) n from public.audit_log")) === auditBefore,
      "P5 a refusal writes nothing");
    // The other shop's order: its own GM may, this shop's GM may not.
    const Q2 = await f.quote(f.other);
    await f.pay(Q2, "full", 9000);
    await refuses(() => reserve(db, gm, Q2, 100), "forbidden", "P5 this shop's GM is refused on another shop's order");
    check((await reserve(db, gmElsewhere, Q2, 100)).requests.length === 1, "P5 …and that shop's own GM is not");
  }

  // ── P6 — nothing else moved ──────────────────────────────────────────────────────────────────
  check(same(before, after), `P6 every other function (body, ACL, settings), table, column ACL, column and trigger is identical before and after${same(before, after) ? "" : ` — ${JSON.stringify({ before, after })}`}`);
  check(after.policies === 0, "P6 no policy exists");

  // ── P7 — the in-file assertions refuse a drifted database ────────────────────────────────────
  await refusedApply((d) => d.exec("grant execute on function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text) to authenticated"),
    "0358: authenticated may execute catering_refund_reserve(uuid,uuid,uuid,bigint,text,text,text) (RPC escape)", "P7 0357's reserve executable by authenticated");
  await refusedApply((d) => d.exec("grant execute on function public.catering_refund_figures(uuid) to public"),
    "0358: public may execute catering_refund_figures(uuid) (RPC escape)", "P7 a 0357 function executable by PUBLIC");
  await refusedApply((d) => d.exec("revoke execute on function public.catering_refund_claim(uuid) from service_role"),
    "0358: service_role cannot execute catering_refund_claim(uuid)", "P7 service_role lost a 0357 RPC");
  await refusedApply((d) => d.exec("alter function public.catering_refund_figures(uuid) reset search_path"),
    "0358: catering_refund_figures(uuid) is not SECURITY DEFINER with the pinned search_path", "P7 a 0357 RPC without its pinned search_path");
  await refusedApply((d) => d.exec("grant insert on table public.catering_refund_requests to service_role"),
    "0358: service_role holds table-level INSERT on public.catering_refund_requests", "P7 service_role holding INSERT on the requests table");
  await refusedApply((d) => d.exec("grant update (amount_cents) on table public.catering_refund_requests to service_role"),
    "0358: service_role UPDATE columns on catering_refund_requests are not 0357's", "P7 an extra UPDATE column for service_role");
  await refusedApply((d) => d.exec("alter table public.catering_refund_requests disable row level security"),
    "0358: RLS is off on public.catering_refund_requests", "P7 RLS switched off");
  await refusedApply((d) => d.exec("create policy p on public.catering_refund_stripe_snapshots for select using (true)"),
    "0358: public.catering_refund_stripe_snapshots has a policy", "P7 a policy on the snapshots table");
  await refusedApply((d) => d.exec("grant select on table public.catering_refund_stripe_snapshots to anon"),
    "0358: anon holds SELECT on public.catering_refund_stripe_snapshots", "P7 anon holding SELECT on the snapshots table");
  await refusedApply((d) => d.exec("grant select (status) on table public.catering_refund_requests to authenticated"),
    "0358: authenticated holds column SELECT on public.catering_refund_requests", "P7 authenticated holding one column");
  await refusedApply((d) => d.exec("alter table public.catering_refund_requests disable trigger catering_refund_requests_guard"),
    "0358: the catering_refund_requests_guard trigger is missing or disabled", "P7 the guard trigger disabled");

  // ── P8 — the rollback in the header ──────────────────────────────────────────────────────────
  await db.exec(`begin; ${ROLLBACK_TO_0357} commit;`);
  check((await fingerprint(db)) === FP_0357, "P8 re-emitting 0357's body restores 0357's fingerprint");
  check((await ok(db, gm, f.shop)) === false, "P8 …and a GM is refused again");
  check((await one(db, `select has_function_privilege('authenticated', '${FN}', 'execute') as ok`)).ok === false
    && (await one(db, `select has_function_privilege('service_role', '${FN}', 'execute') as ok`)).ok === true, "P8 …with the same privileges");
  await db.exec(M0358);
  check((await fingerprint(db)) === FP_0358 && (await ok(db, gm, f.shop)) === true, "P8 0358 applies again on the restored body");
} catch (e) {
  failures++;
  console.error(`FAIL 0358 harness: ${e.stack ?? e}`);
} finally {
  if (db) await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0358: ${checks} checks (single-session PGlite, the REAL 0357 then the REAL 0358)`);
