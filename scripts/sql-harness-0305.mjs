/**
 * Offline proof of migration 0305 (bug audit 2026-11-14, fix wave W05). SYNTHETIC ROWS ONLY: PGlite,
 * in memory, no credentials, no network. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0305.mjs
 *
 * The base is hand-built tables plus the REAL definitions the migration stands on, extracted from their
 * sources, never forked: current_user_id (0200), current_user_role_level (0189), the live
 * current_user_locations body (Foundation Spec v1.3 §5, never re-emitted by a migration until 0305), the
 * cash_reports policy (0067), the catering oracles and read policies (0113, 0120) and the parents' floored
 * quals (0189), the three correction RPCs with their grants (0287) over assignment_author_level (0228), and
 * opening_setup_items' read policy (0054) with 0106 / 0272's denies and write revokes.
 * Every request runs as PostgREST runs it: `set local role authenticated` plus the JWT claims in
 * `request.jwt.claims`.
 *
 * TWO databases. `main`: every "before" check (the bug, on the pre-0305 schema), then the real 0305, then every
 * "after" check. `drift`: every refusal, each as `begin; <drift>; 0305` — the refused apply aborts and the
 * rollback removes the drift with it, so each case starts from the same pre-0305 schema.
 *
 *   A  B009  current_user_locations() counts ACTIVE memberships only: a removed shop closes on the curl path
 *            while the kept shop stays open; helper shape, grants and the refusal guards.
 *   B  B010  the catering child tables (quote lines, order lines, lead history) take the parents' level-5
 *            floor on the location arm: the whole role x membership matrix, child never wider than parent,
 *            the unassigned-lead arm (6+) and the level-9 arm unchanged; a second read policy is refused.
 *   C  B150  the three checklist correction RPCs (0287, real bodies) require an ACTIVE membership below
 *            level 8: all 15 roles x active / inactive / missing membership, for the authority path and both
 *            self paths; each re-emitted body is 0287's with exactly one changed line; grants and context kept.
 *   D  B152  opening_setup_items: the anon key reads nothing (no grant, policy TO authenticated with a live
 *            session); signed-in staff read it as before; no write came back; drift is refused.
 *   Z        the whole file: one audit row per change, and a second apply refuses and writes nothing.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const mig = (name) => read(`supabase/migrations/${name}`);
const M0305 = mig("0305_rls_membership_and_read_floors.sql");
const M0287 = mig("0287_checklist_corrections_serialized.sql");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} -> ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
function grab(sql, re, what) {
  const m = sql.match(re);
  if (!m) throw new Error(`extract: ${what} not found`);
  return m[0];
}
/**
 * `begin; <drift>; 0305` must refuse with `code`. The file's own `begin` is a no-op inside the open
 * transaction, its failed guard aborts it, and the rollback removes the drift too.
 */
async function applyRefuses(db, drift, code, what) {
  await db.exec("begin");
  try {
    if (drift) await db.exec(drift);
    await refuses(() => db.exec(M0305), code, what);
  } finally { await db.exec("rollback"); }
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
const SHOP_A = id(101), SHOP_B = id(102);
const LEAD_A = id(301), LEAD_B = id(302), LEAD_NONE = id(303);
const ORDER_A = id(311), ORDER_B = id(312), QUOTE_A = id(321), QUOTE_B = id(322);
const TEMPLATE_ITEM = id(401), INSTANCE_A = id(402), COMPLETION = id(403), CORRECTOR = id(50);
const CORRECTION_RPCS = ["checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"];
const correctionBody = (name) => grab(M0287, new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`), `0287 ${name}`);
/** [user id, session id, role]. Everyone starts as an ACTIVE member of both shops unless a test says otherwise. */
const PEOPLE = {
  employee: [id(1), id(201), "employee"],
  keyHolder: [id(2), id(202), "key_holder"],
  shiftLead: [id(3), id(203), "shift_lead"],
  cateringMgr: [id(4), id(204), "catering_mgr"],
  gm: [id(5), id(205), "gm"],
  moo: [id(6), id(206), "moo"],
  owner: [id(7), id(207), "owner"],
};
const LEVEL = { employee: 3, keyHolder: 4, shiftLead: 5, cateringMgr: 6, gm: 7, moo: 8, owner: 9 };

/** Run `fn` as one PostgREST request of `who` (a PEOPLE key, or "anon"), rolled back afterwards. */
async function request(db, who, fn) {
  await db.exec("begin");
  try {
    if (who === "anon") {
      await db.exec(`set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
    } else {
      const [user, session] = PEOPLE[who];
      await db.exec(`set local role authenticated;
        select set_config('request.jwt.claims', '${JSON.stringify({ user_id: user, session_id: session, role: "authenticated" })}', true);`);
    }
    return await fn();
  } finally { await db.exec("rollback"); }
}
const rows = async (db, who, sql) => request(db, who, async () => (await db.query(sql)).rows);

async function base() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase's explicit default ACLs (not merely PostgreSQL's PUBLIC grant).
    alter default privileges grant execute on functions to anon, authenticated, service_role;
    alter default privileges grant all on tables to anon, authenticated, service_role;
    create table audit_log(actor_id uuid, actor_role text, action text, resource_table text, resource_id uuid,
      destructive boolean, metadata jsonb);
    create table users(id uuid primary key, role text not null, active boolean not null default true);
    create table user_locations(user_id uuid not null references users, location_id uuid not null,
      active boolean not null default true);
    create table sessions(id uuid primary key, user_id uuid references users, revoked_at timestamptz, expires_at timestamptz);
    create table cash_reports(id uuid primary key default gen_random_uuid(), location_id uuid not null, note text);
    alter table cash_reports enable row level security;`);
  for (const [user, session, role] of Object.values(PEOPLE)) {
    await db.exec(`insert into users values('${user}','${role}',true);
      insert into user_locations values('${user}','${SHOP_A}',true),('${user}','${SHOP_B}',true);
      insert into sessions values('${session}','${user}',null,now()+interval '1 day');`);
  }
  await db.exec(`insert into cash_reports(location_id, note) values('${SHOP_A}','a'),('${SHOP_B}','b');`);
  // The REAL helpers. current_user_locations is the live body: no migration ever re-emitted it before 0305.
  await db.exec(grab(mig("0200_current_user_id_session_bound.sql"), /CREATE OR REPLACE FUNCTION public\.current_user_id\(\)[\s\S]*?\$function\$;/, "0200 current_user_id"));
  await db.exec(grab(mig("0189_rls_perimeter_revokes_and_read_floors.sql"), /create or replace function public\.current_user_role_level\(\)[\s\S]*?\$\$;/, "0189 current_user_role_level"));
  await db.exec(grab(read("docs/CO-OPS_Foundation_Spec_v1.3.md"), /CREATE OR REPLACE FUNCTION current_user_locations\(\)[\s\S]*?\$\$;/, "spec current_user_locations"));
  // 0029's grant posture for the three helpers: authenticated + service_role, never anon / PUBLIC.
  await db.exec(`revoke all on function current_user_id(), current_user_role_level(), current_user_locations() from public, anon;
    grant execute on function current_user_id(), current_user_role_level(), current_user_locations() to authenticated, service_role;`);
  await db.exec(grab(mig("0067_cash_reports.sql"), /CREATE POLICY cash_reports_read[\s\S]*?;/, "0067 cash_reports_read"));

  // Catering: parents and children, with the REAL oracles and read policies (0113, 0120) and the parents'
  // REAL floored quals (0189's ALTER POLICY statements over a placeholder).
  await db.exec(`create table catering_pipeline(id uuid primary key, location_id uuid);
    create table catering_orders(id uuid primary key, location_id uuid not null);
    create table catering_quotes(id uuid primary key, location_id uuid not null);
    create table catering_pipeline_events(id uuid primary key default gen_random_uuid(), pipeline_id uuid not null references catering_pipeline, to_stage text);
    create table catering_order_items(id uuid primary key default gen_random_uuid(), order_id uuid not null references catering_orders, description text);
    create table catering_quote_items(id uuid primary key default gen_random_uuid(), quote_id uuid not null references catering_quotes, unit_price_cents integer);
    alter table catering_pipeline enable row level security; alter table catering_orders enable row level security;
    alter table catering_quotes enable row level security; alter table catering_pipeline_events enable row level security;
    alter table catering_order_items enable row level security; alter table catering_quote_items enable row level security;
    create policy catering_pipeline_read on catering_pipeline for select using (false);
    create policy catering_orders_read on catering_orders for select using (false);
    insert into catering_pipeline values('${LEAD_A}','${SHOP_A}'),('${LEAD_B}','${SHOP_B}'),('${LEAD_NONE}',null);
    insert into catering_orders values('${ORDER_A}','${SHOP_A}'),('${ORDER_B}','${SHOP_B}');
    insert into catering_quotes values('${QUOTE_A}','${SHOP_A}'),('${QUOTE_B}','${SHOP_B}');
    insert into catering_pipeline_events(pipeline_id, to_stage) values('${LEAD_A}','inquiry'),('${LEAD_B}','inquiry'),('${LEAD_NONE}','inquiry');
    insert into catering_order_items(order_id, description) values('${ORDER_A}','a'),('${ORDER_B}','b');
    insert into catering_quote_items(quote_id, unit_price_cents) values('${QUOTE_A}',1200),('${QUOTE_B}',1300);`);
  const m0113 = mig("0113_catering_child_rls_parent_anchored.sql"), m0120 = mig("0120_catering_quotes.sql"), m0189 = mig("0189_rls_perimeter_revokes_and_read_floors.sql");
  for (const [sql, re, what] of [
    [m0113, /CREATE FUNCTION public\.catering_pipeline_loc\(p_id uuid\)[\s\S]*?\$\$;\nREVOKE EXECUTE[^\n]*;/, "0113 catering_pipeline_loc"],
    [m0113, /CREATE FUNCTION public\.catering_order_loc\(o_id uuid\)[\s\S]*?\$\$;\nREVOKE EXECUTE[^\n]*;/, "0113 catering_order_loc"],
    [m0120, /CREATE FUNCTION public\.catering_quote_loc\(q_id uuid\)[\s\S]*?\$\$;\nREVOKE EXECUTE[^\n]*;\nREVOKE EXECUTE[^\n]*;/, "0120 catering_quote_loc"],
    [m0113, /CREATE POLICY catering_pipeline_events_read[\s\S]*?\);/, "0113 catering_pipeline_events_read"],
    [m0113, /CREATE POLICY catering_order_items_read[\s\S]*?\);/, "0113 catering_order_items_read"],
    [m0120, /CREATE POLICY catering_quotes_read[\s\S]*?\);/, "0120 catering_quotes_read"],
    [m0120, /CREATE POLICY catering_quote_items_read[\s\S]*?\);/, "0120 catering_quote_items_read"],
    [m0189, /alter policy catering_pipeline_read[\s\S]*?\);/, "0189 catering_pipeline_read"],
    [m0189, /alter policy catering_orders_read[\s\S]*?\);/, "0189 catering_orders_read"],
  ]) await db.exec(grab(sql, re, what));

  // Checklist corrections: the columns the three RPCs touch, 0228's level helper, 0287's REAL bodies and grants.
  await db.exec(`create table checklist_template_items(id uuid primary key, report_reference_type text);
    create table checklist_instances(id uuid primary key, location_id uuid not null, status text not null default 'open');
    create table checklist_completions(id uuid primary key, instance_id uuid not null references checklist_instances,
      template_item_id uuid not null references checklist_template_items, completed_by uuid not null references users,
      completed_at timestamptz not null default now(), prep_data jsonb, superseded_at timestamptz, revoked_at timestamptz,
      revoked_by uuid references users, revocation_reason text, revocation_note text);
    insert into users values('${CORRECTOR}','key_holder',true);
    insert into user_locations values('${CORRECTOR}','${SHOP_A}',true);
    insert into checklist_template_items values('${TEMPLATE_ITEM}', null);
    insert into checklist_instances values('${INSTANCE_A}','${SHOP_A}','open');
    insert into checklist_completions(id, instance_id, template_item_id, completed_by, completed_at)
      values('${COMPLETION}','${INSTANCE_A}','${TEMPLATE_ITEM}','${PEOPLE.employee[0]}', now() - interval '1 hour');`);
  await db.exec(grab(mig("0228_assignment_attribution.sql"), /create function public\.assignment_author_level[\s\S]*?end \$\$;/i, "0228 assignment_author_level"));
  await db.exec(`revoke all on function assignment_author_level(uuid) from public, anon, authenticated;
    grant execute on function assignment_author_level(uuid) to service_role;`);
  for (const name of CORRECTION_RPCS) await db.exec(correctionBody(name));
  await db.exec(grab(M0287, /revoke all on function public\.checklist_revoke_completion[\s\S]*?grant execute on function public\.checklist_mark_not_done\(uuid,uuid,text\) to service_role;/, "0287 correction grants"));

  // opening_setup_items: 0054's REAL read policy, 0106's denies, 0272's insert deny and write revokes.
  await db.exec(`create table opening_setup_items(id uuid primary key default gen_random_uuid(), location_id uuid, item_label text not null,
      min_value numeric, max_value numeric, active boolean not null default true);
    alter table opening_setup_items enable row level security;
    insert into opening_setup_items(location_id, item_label, min_value, max_value) values('${SHOP_A}','Fridge temp',33,40),('${SHOP_B}','Sanitizer ppm',200,400);`);
  await db.exec(grab(mig("0054_c53_c54_schema.sql"), /CREATE POLICY opening_setup_items_select_policy[\s\S]*?;/, "0054 opening_setup_items_select_policy"));
  await db.exec(grab(mig("0106_lock_append_only_rls_outliers.sql"), /create policy opening_setup_items_no_user_update[^\n]*;\ncreate policy opening_setup_items_no_user_delete[^\n]*;/, "0106 denies"));
  await db.exec(grab(mig("0272_postgrest_write_lockdown.sql"), /create policy opening_setup_items_no_user_insert[\s\S]*?;/, "0272 insert deny"));
  await db.exec("revoke insert, update, delete, truncate, references, trigger on table opening_setup_items from public, anon, authenticated;");
  return db;
}

const shops = (list) => list.map((r) => r.location_id).sort().join(",");
const BOTH_SHOPS = [SHOP_A, SHOP_B].sort().join(",");
const helperSource = async (db) => (await db.query(`select prosrc from pg_proc where oid = 'public.current_user_locations()'::regprocedure`)).rows[0].prosrc;

// ── A. B009 ─────────────────────────────────────────────────────────────────────────────────────
const membership = {
  async before(db) {
    // The bug, on the pre-0305 schema: a removed membership still opens the shop. (Left removed for `after`.)
    await db.exec(`update user_locations set active = false where user_id = '${PEOPLE.keyHolder[0]}' and location_id = '${SHOP_A}';`);
    check(shops(await rows(db, "keyHolder", "select location_id from cash_reports")) === BOTH_SHOPS,
      "A0 before 0305: a key holder removed from shop A still reads shop A's cash reports (the bug)");
  },
  async after(db) {
    check(shops(await rows(db, "keyHolder", "select location_id from cash_reports")) === SHOP_B,
      "A1 after 0305: the removed shop is closed, the kept shop still reads");
    const helper = (await rows(db, "keyHolder", "select public.current_user_locations() as l"))[0].l;
    check(Array.isArray(helper) && helper.length === 1 && helper[0] === SHOP_B, "A1 current_user_locations() = the active memberships only");
    check(shops(await rows(db, "gm", "select location_id from cash_reports")) === BOTH_SHOPS,
      "A1 an untouched member of both shops still reads both");
    // No memberships at all: an empty array (never NULL), so `= ANY` is false rather than unknown.
    await db.exec(`update user_locations set active = false where user_id = '${PEOPLE.keyHolder[0]}';`);
    const none = (await rows(db, "keyHolder", "select public.current_user_locations() as l, public.current_user_locations() is null as n"))[0];
    check(Array.isArray(none.l) && none.l.length === 0 && none.n === false, "A1 no active membership = an empty array, not NULL");
    check((await rows(db, "keyHolder", "select 1 from cash_reports")).length === 0, "A1 no active membership reads nothing");
    // Re-adding the shop (active = true again) re-opens it: the helper reads the live table.
    await db.exec(`update user_locations set active = true where user_id = '${PEOPLE.keyHolder[0]}' and location_id = '${SHOP_A}';`);
    check(shops(await rows(db, "keyHolder", "select location_id from cash_reports")) === SHOP_A, "A1 a re-added shop opens again");
    // A revoked session is still nobody (0200 is untouched).
    await db.exec(`update sessions set revoked_at = now() where id = '${PEOPLE.gm[1]}';`);
    check((await rows(db, "gm", "select public.current_user_locations() as l"))[0].l.length === 0, "A1 a revoked session resolves no shops (0200 intact)");
    await db.exec("update sessions set revoked_at = null; update user_locations set active = true;");

    const fn = (await db.query(`select p.prosecdef, p.provolatile, p.proconfig, l.lanname, p.prorettype::regtype::text as ret
      from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.current_user_locations()'::regprocedure`)).rows[0];
    check(fn.prosecdef && fn.provolatile === "s" && fn.lanname === "sql" && fn.ret === "uuid[]"
      && fn.proconfig.includes("search_path=pg_catalog, public"), "A2 still SECURITY DEFINER, STABLE, sql, uuid[], search_path pinned");
    const acl = (await db.query(`select has_function_privilege('anon', 'public.current_user_locations()', 'EXECUTE') as anon,
      has_function_privilege('authenticated', 'public.current_user_locations()', 'EXECUTE') as authed,
      has_function_privilege('service_role', 'public.current_user_locations()', 'EXECUTE') as service`)).rows[0];
    check(!acl.anon && acl.authed && acl.service, "A2 EXECUTE: authenticated + service_role, never anon");
    await refuses(() => request(db, "anon", () => db.query("select public.current_user_locations()")), "42501", "A2 anon cannot call the helper");
    console.log("A  B009 current_user_locations(): active memberships only; shape and grants verified");
  },
  async refusals(db) {
    await applyRefuses(db, "alter table user_locations drop column active;", "0305: 0078", "A3 refuses without user_locations.active (0078)");
    await applyRefuses(db, "alter function public.current_user_locations() security invoker;", "is not the expected helper",
      "A3 refuses a helper that is not SECURITY DEFINER (drifted shape)");
    check(!(await helperSource(db)).includes("active"), "A3 a refused apply changes nothing (one transaction)");
  },
};

// ── B. B010 ─────────────────────────────────────────────────────────────────────────────────────
const CHILDREN = [
  ["catering_quote_items", "quote_id", "catering_quotes", QUOTE_A, QUOTE_B],
  ["catering_order_items", "order_id", "catering_orders", ORDER_A, ORDER_B],
  ["catering_pipeline_events", "pipeline_id", "catering_pipeline", LEAD_A, LEAD_B],
];
const parentIds = async (db, who, table, key) => (await rows(db, who, `select ${key} as k from ${table} order by 1`)).map((r) => r.k);

const cateringChildren = {
  async before(db) {
    // The bug: a level-3 member reads the children while the parent returns nothing.
    for (const [child, key, parent, atA, atB] of CHILDREN) {
      const seen = await parentIds(db, "employee", child, key);
      check(seen.includes(atA) && seen.includes(atB) && (await rows(db, "employee", `select 1 from ${parent}`)).length === 0,
        `B0 before 0305: an employee (level 3) reads ${child} at their shops while ${parent} returns nothing (the bug)`);
    }
  },
  async after(db) {
    // The matrix: every role, as a member of both shops, of shop B only, and of no shop.
    for (const membershipCase of ["both", "b_only", "none"]) {
      for (const who of Object.keys(LEVEL)) {
        const level = LEVEL[who];
        await db.exec(`update user_locations set active = ${membershipCase === "both"} where user_id = '${PEOPLE[who][0]}' and location_id = '${SHOP_A}';
          update user_locations set active = ${membershipCase !== "none"} where user_id = '${PEOPLE[who][0]}' and location_id = '${SHOP_B}';`);
        for (const [child, key, parent, atA, atB] of CHILDREN) {
          const want = level >= 9 ? [atA, atB] : level < 5 ? [] : membershipCase === "both" ? [atA, atB] : membershipCase === "b_only" ? [atB] : [];
          const seen = await parentIds(db, who, child, key);
          const located = seen.filter((k) => k !== LEAD_NONE).sort().join(",");
          check(located === [...want].sort().join(","), `B1 ${who} (level ${level}, ${membershipCase}) reads ${want.length} located parent(s) of ${child}`);
          // Never wider than the parent: every child row's parent is itself readable.
          const parents = await parentIds(db, who, parent, "id");
          check(seen.every((k) => parents.includes(k)), `B1 ${who} (${membershipCase}): ${child} is never wider than ${parent}`);
        }
        // 0113's third arm, unchanged: an unassigned lead's history needs level 6 (9+ reads everything).
        const unassigned = (await parentIds(db, who, "catering_pipeline_events", "pipeline_id")).includes(LEAD_NONE);
        check(unassigned === (level >= 6), `B2 ${who} (level ${level}, ${membershipCase}): unassigned-lead history ${level >= 6 ? "readable" : "hidden"}`);
      }
    }
    await db.exec("update user_locations set active = true;");
    // A deactivated manager resolves no level (0189): nothing.
    await db.exec(`update users set active = false where id = '${PEOPLE.gm[0]}';`);
    for (const [child] of CHILDREN) check((await rows(db, "gm", `select 1 from ${child}`)).length === 0, `B2 a deactivated GM reads nothing from ${child}`);
    await db.exec(`update users set active = true where id = '${PEOPLE.gm[0]}';`);
    // anon: the policy calls helpers anon cannot execute; never rows.
    for (const [child] of CHILDREN) {
      let got = "error";
      try { got = String((await rows(db, "anon", `select 1 from ${child}`)).length); } catch { /* 42501 is the loud refusal */ }
      check(got === "error" || got === "0", `B2 anon reads nothing from ${child}`);
    }
    // Structure: one permissive read policy per child, floored; nothing else moved.
    const policies = (await db.query(`select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public'
      and tablename in ('catering_quote_items','catering_order_items','catering_pipeline_events') and cmd in ('SELECT','ALL') order by 1`)).rows;
    check(policies.length === 3 && policies.every((p) => p.policyname === `${p.tablename}_read` && p.cmd === "SELECT" && />= \(?5\)?/.test(p.qual) && />= \(?9\)?/.test(p.qual)),
      "B3 exactly one SELECT policy per child table, carrying the level-5 floor and the level-9 arm");
    check(/IS NULL\) AND \(current_user_role_level\(\) >= \(?6\)?/.test(policies.find((p) => p.tablename === "catering_pipeline_events").qual),
      "B3 catering_pipeline_events keeps 0113's unassigned-lead arm at level 6");
    console.log("B  B010 catering child reads: floored at level 5 on the location arm; matrix and structure verified");
  },
  async refusals(db) {
    await applyRefuses(db, "drop policy catering_order_items_read on catering_order_items;", "0305: policy catering_order_items_read",
      "B4 refuses when a child read policy is missing");
    await applyRefuses(db, "create policy catering_quote_items_everyone on catering_quote_items for select using (true);",
      "another permissive read policy (catering_quote_items_everyone)", "B4 refuses when a second read policy would OR the floor away");
    check(!(await helperSource(db)).includes("active"), "B4 that refusal rolled section A back too (one transaction)");
  },
};

// ── C. B150 ─────────────────────────────────────────────────────────────────────────────────────
const ROLES = [["prospect", 0], ["hired_not_yet_worked", 1], ["trainee", 2], ["employee", 3], ["trainer", 4], ["key_holder", 4], ["shift_lead", 5],
  ["agm", 6], ["catering_mgr", 6], ["prep_mgr", 6], ["social_media_mgr", 6], ["gm", 7], ["moo", 8], ["owner", 9], ["cgs", 10]];
const CORRECT = {
  authority: `select public.checklist_mark_not_done('${COMPLETION}','${CORRECTOR}','not done')`,
  reason: `select public.checklist_revoke_with_reason('${COMPLETION}','${CORRECTOR}','other','a correction')`,
  quick: `select public.checklist_revoke_completion('${COMPLETION}','${CORRECTOR}')`,
};
/** One call as `role`, always rolled back (with `change` applied first): "allowed" or the refusal. */
async function attempt(db, call, change = "", role = "service_role") {
  await db.exec("begin");
  try {
    if (change) await db.exec(change);
    await db.exec(`set local role ${role}`);
    await db.query(call);
    return "allowed";
  } catch (e) { return e.code === "P0001" ? e.message : `${e.code}:${e.message}`; }
  finally { await db.exec("rollback"); }
}
const membershipSql = (m) => m === "missing"
  ? `delete from user_locations where user_id = '${CORRECTOR}';`
  : `update user_locations set active = ${m === "active"} where user_id = '${CORRECTOR}';`;
const correctionSources = async (db) => (await db.query(`select proname, prosrc, prosecdef, proconfig from pg_proc where proname = any($1::text[])`, [CORRECTION_RPCS])).rows;

const corrections = {
  bodies: {},
  async before(db) {
    // The bug, on 0287 alone: a key holder whose membership row is inactive still corrects the shop's checklist.
    check(await attempt(db, CORRECT.authority, membershipSql("inactive")) === "allowed",
      "C0 before 0305: a key holder removed from the shop (inactive membership) still marks a completion not done (the bug)");
    check(await attempt(db, CORRECT.reason, membershipSql("inactive") + `update checklist_completions set completed_by = '${CORRECTOR}';`) === "allowed",
      "C0 before 0305: the same person still revokes their own completion there (the bug)");
    this.bodies = Object.fromEntries((await correctionSources(db)).map((r) => [r.proname, r.prosrc]));
  },
  async after(db) {
    let cases = 0;
    for (const [role, level] of ROLES) for (const membershipCase of ["active", "inactive", "missing"]) {
      const setup = `update users set role = '${role}' where id = '${CORRECTOR}';` + membershipSql(membershipCase);
      const scoped = membershipCase === "active" || level >= 8;
      const authority = await attempt(db, CORRECT.authority, setup);
      check((authority === "allowed") === (level >= 4 && scoped), `C1 mark-not-done ${role}/${membershipCase}: ${authority}`);
      if (!scoped) check(authority === "not_authorized", `C1 mark-not-done ${role}/${membershipCase} refuses not_authorized`);
      const mine = setup + `update checklist_completions set completed_by = '${CORRECTOR}';`;
      const reason = await attempt(db, CORRECT.reason, mine);
      check((reason === "allowed") === scoped, `C1 revoke-with-reason ${role}/${membershipCase}: ${reason}`);
      const quick = await attempt(db, CORRECT.quick, mine + "update checklist_completions set completed_at = clock_timestamp();");
      check((quick === "allowed") === scoped, `C1 quick revoke ${role}/${membershipCase}: ${quick}`);
      cases++;
    }
    // A membership at ANOTHER shop is not a membership here.
    check(await attempt(db, CORRECT.authority, `update user_locations set location_id = '${SHOP_B}' where user_id = '${CORRECTOR}';`) === "not_authorized",
      "C1 an active membership at another shop does not count");

    // Everything else is 0287's: the bodies differ by exactly the one membership line, and behaviour holds.
    const after = await correctionSources(db);
    check(after.length === 3, "C2 exactly three correction RPCs (no overload added)");
    for (const fn of after) {
      const a = this.bodies[fn.proname].split("\n"), b = fn.prosrc.split("\n");
      const changed = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y);
      check(a.length === b.length && changed.length === 2
        && changed[0][0].includes("Deliberately no active filter") && changed[0][1].trim().startsWith("-- 0305 (B150)")
        && changed[1][1] === changed[1][0].replace("v_instance.location_id for share", "v_instance.location_id and active for share"),
        `C2 ${fn.proname} is 0287's body with one changed statement (and its comment)`);
      check(!fn.prosecdef && fn.proconfig.includes("search_path=pg_catalog, public"), `C2 ${fn.proname} stays SECURITY INVOKER with a pinned search_path`);
    }
    for (const [call, change, code, what] of [
      [CORRECT.authority, "update checklist_instances set status = 'confirmed';", "instance_not_open", "a confirmed instance refuses"],
      [CORRECT.authority, `update checklist_completions set completed_by = '${CORRECTOR}';`, "use_self_revoke", "authority is cross-user only"],
      [CORRECT.reason, "", "not_self", "self revoke is self only"],
      [CORRECT.authority, `update users set role = 'owner' where id = '${PEOPLE.employee[0]}';`, "revoke_hierarchy_violation", "never above the completer's level"],
      [CORRECT.authority, "update checklist_completions set completed_at = clock_timestamp();", "use_quick_revoke", "the 60-second window"],
      [CORRECT.authority, `update users set active = false where id = '${CORRECTOR}';`, "not_authorized", "a deactivated actor"],
      [CORRECT.authority, "update checklist_template_items set report_reference_type = 'cash_report';", "reference_row_not_correctable", "reference rows"],
    ]) check(await attempt(db, call, change) === code, `C2 unchanged 0287 refusal: ${what} -> ${code}`);
    for (const role of ["anon", "authenticated"]) for (const call of Object.values(CORRECT)) {
      check((await attempt(db, call, "", role)).startsWith("42501"), `C3 ${role} cannot call ${call.slice(14, call.indexOf("("))}`);
    }
    console.log(`C  B150 correction RPCs: ${cases} role/membership cases x 3 writers; active membership below level 8, level 8+ preserved`);
  },
  async refusals(db) {
    // A definition that is not 0287's (a later re-emission) is never clobbered.
    const later = correctionBody("checklist_mark_not_done").replace("create function", "create or replace function")
      .replace("where user_id = p_actor and location_id = v_instance.location_id for share", "where user_id = p_actor and location_id = v_instance.location_id and true for share");
    await applyRefuses(db, later, "is not 0287's definition", "C4 refuses when a correction RPC is not 0287's body (a later re-emission)");
    await applyRefuses(db, "drop function public.checklist_revoke_completion(uuid,uuid);", "0305: 0287", "C4 refuses without 0287");
  },
};

// ── D. B152 ─────────────────────────────────────────────────────────────────────────────────────
const openingSetupItems = {
  async before(db) {
    check((await rows(db, "anon", "select item_label from opening_setup_items")).length === 2,
      "D0 before 0305: the anon key alone reads every opening_setup_items row (the bug)");
  },
  async after(db) {
    await refuses(() => rows(db, "anon", "select item_label from opening_setup_items"), "42501", "D1 after 0305: anon is refused (no grant)");
    await refuses(() => rows(db, "anon", "select id from opening_setup_items"), "42501", "D1 anon is refused on a single column too");
    await refuses(() => rows(db, "anon", "select count(*) from opening_setup_items"), "42501", "D1 anon cannot even count rows");
    for (const who of ["employee", "keyHolder", "gm", "owner"]) {
      check((await rows(db, who, "select item_label from opening_setup_items")).length === 2, `D2 a signed-in ${who} still reads the setup items`);
    }
    // A staff JWT whose session is revoked is nobody (0200): the policy returns no rows rather than everything.
    await db.exec(`update sessions set revoked_at = now() where id = '${PEOPLE.keyHolder[1]}';`);
    check((await rows(db, "keyHolder", "select 1 from opening_setup_items")).length === 0, "D2 a revoked session reads nothing");
    await db.exec(`update sessions set revoked_at = null where id = '${PEOPLE.keyHolder[1]}';`);
    // The write side did not move: still no user write of any kind.
    for (const [what, sql] of [["insert", `insert into opening_setup_items(item_label) values('x')`],
      ["update", "update opening_setup_items set item_label = 'x'"], ["delete", "delete from opening_setup_items"]]) {
      await refuses(() => rows(db, "gm", sql), "42501", `D3 a signed-in GM still cannot ${what}`);
    }
    check(await attempt(db, "select count(*) from opening_setup_items") === "allowed"
      && (await request(db, "anon", async () => { await db.exec("reset role; set local role service_role"); return (await db.query("select 1 from opening_setup_items")).rows.length; })) === 2,
      "D3 service_role still reads every row");
    const pol = (await db.query(`select policyname, cmd, roles::text[] as roles, qual from pg_policies where schemaname = 'public' and tablename = 'opening_setup_items' order by 1`)).rows;
    const readPolicies = pol.filter((r) => r.cmd === "SELECT");
    check(readPolicies.length === 1 && readPolicies[0].policyname === "opening_setup_items_select_policy" && readPolicies[0].roles.join(",") === "authenticated"
      && /current_user_id\(\) IS NOT NULL/.test(readPolicies[0].qual), "D4 one read policy: TO authenticated, live session");
    check(pol.map((r) => r.policyname).join(",") === "opening_setup_items_no_user_delete,opening_setup_items_no_user_insert,opening_setup_items_no_user_update,opening_setup_items_select_policy",
      "D4 the three explicit denies are untouched");
    const privs = (await db.query(`select r, p, has_table_privilege(r, 'public.opening_setup_items', p) as held
      from unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`)).rows;
    check(privs.every((x) => x.held === (x.r === "authenticated" && x.p === "SELECT")), "D4 anon holds nothing; authenticated holds SELECT only");
    check(!(await db.query(`select has_any_column_privilege('anon', 'public.opening_setup_items', 'SELECT') as c`)).rows[0].c, "D4 no column-level SELECT left for anon");
    console.log("D  B152 opening_setup_items: anon refused, signed-in staff unchanged, writes still closed");
  },
  async refusals(db) {
    await applyRefuses(db, "alter policy opening_setup_items_select_policy on opening_setup_items rename to opening_setup_items_read;",
      "opening_setup_items_select_policy (0054) is missing", "D5 refuses when the 0054 read policy is missing");
    await applyRefuses(db, "create policy opening_setup_items_everyone on opening_setup_items for select using (true);",
      "another permissive read policy (opening_setup_items_everyone)", "D5 refuses when another read policy would keep the table open");
    check((await rows(db, "employee", "select 1 from catering_quote_items")).length === 2, "D5 that refusal rolled sections A to C back too (one transaction)");
    await applyRefuses(db, "grant insert on opening_setup_items to authenticated;", "authenticated holds INSERT", "D5 refuses when a user write grant has come back (0272 drift)");
  },
};

// ── Z. the whole file ───────────────────────────────────────────────────────────────────────────
async function wholeFile(db) {
  const audit = (await db.query(`select metadata->>'bug' as bug, count(*)::int as n from audit_log
    where metadata->>'migration' = '0305_rls_membership_and_read_floors' and action = 'security.grants_change'
      and destructive and metadata->>'actor_context' = 'migration_apply' and actor_id is null group by 1 order by 1`)).rows;
  check(JSON.stringify(audit) === JSON.stringify([{ bug: "B009", n: 1 }, { bug: "B010", n: 3 }, { bug: "B150", n: 1 }, { bug: "B152", n: 1 }]),
    "Z  audit rows: B009 x1, B010 x3, B150 x1, B152 x1, all migration_apply");
  const b010 = (await db.query(`select resource_table from audit_log where metadata->>'bug' = 'B010' order by 1`)).rows.map((r) => r.resource_table).join(",");
  check(b010 === "catering_order_items,catering_pipeline_events,catering_quote_items", "Z  B010: one audit row per child policy");
  await applyRefuses(db, "", "0305: already applied", "Z  a second apply of the whole file refuses");
  check((await db.query(`select count(*)::int as n from audit_log where metadata->>'migration' = '0305_rls_membership_and_read_floors'`)).rows[0].n === 6,
    "Z  the refused second apply wrote nothing");
}

const SECTIONS = [membership, cateringChildren, corrections, openingSetupItems];
let main, drift;
try {
  main = await base();
  for (const section of SECTIONS) await section.before(main);
  await main.exec(M0305);
  for (const section of SECTIONS) await section.after(main);
  await wholeFile(main);

  drift = await base();
  for (const section of SECTIONS) await section.refusals(drift);
  // Every refused apply left `drift` exactly as it was: the real file still applies cleanly on it.
  await drift.exec(M0305);
  check((await helperSource(drift)).includes("active"), "Z  after every refusal the untouched schema still takes the real 0305");
  console.log("R  refusals: missing prerequisite, drifted definition, OR-stacked policy and returned write grant all refuse");

  if (failures) { console.error(`FAIL 0305: ${failures} of ${checks} checks failed`); process.exitCode = 1; }
  else console.log(`PASS 0305: ${checks} checks`);
} catch (e) { console.error(`FAIL 0305: ${e.stack ?? e}`); process.exitCode = 1; }
finally { await main?.close(); await drift?.close(); }
