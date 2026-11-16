/**
 * Offline proof of migration 0318 (bug audit follow-up W05B, Juan's ruling 2026-11-15). SYNTHETIC ROWS ONLY:
 * PGlite, in memory, no credentials, no network. CC owns the Supabase sim/prod gate; this never touches a real
 * database.
 *
 *   node scripts/sql-harness-0318.mjs
 *
 * The base is hand-built tables plus the REAL definitions the migration stands on, extracted from their sources,
 * never forked: assignment_author_level (0228), the whole of 0276 (checklist_actor_level and the three guarded
 * writers), and 0287's re-emitted checklist_confirm_instance (the live confirm). Every call runs as the app runs
 * it: `set local role service_role`, one transaction, rolled back.
 *
 *   A  before 0318: a MoO / owner / CGS with no membership is refused by all three writers (what the ruling lifts)
 *   B  after 0318: 9 roles x active / inactive / missing membership x the three writers:
 *        allowed  <=>  level >= 8, or an ACTIVE membership at the instance's shop
 *      an inactive level-8+ user is refused; the callers' own floors still hold (item min level, confirm >= 3)
 *   C  lock order: the instance row is locked by the caller; below 8 the membership row is read FOR SHARE,
 *      at 8+ user_locations is never touched (no lock taken)
 *   D  shape: SECURITY INVOKER, pinned search_path, EXECUTE for service_role only (authenticated refused)
 *   E  refusals: a second apply, a drifted body, a missing 0228 / 0276 — each refused, nothing written
 *   Z  one audit row
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const mig = (name) => read(`supabase/migrations/${name}`);
const M0318 = mig("0318_checklist_task_writers_any_shop_level8.sql");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
function grab(sql, re, what) {
  const m = sql.match(re);
  if (!m) throw new Error(`extract: ${what} not found`);
  return m[0];
}

const ACTOR = id(1), SHOP_A = id(101), SHOP_B = id(102), TEMPLATE = id(201), ITEM = id(202), INSTANCE = id(203), COMPLETION = id(204);
const ROLES = { employee: 3, key_holder: 4, shift_lead: 5, social_media_mgr: 6, agm: 6, gm: 7, moo: 8, owner: 9, cgs: 10 };
const CALLS = {
  complete: `select public.checklist_write_completion('${ACTOR}','${INSTANCE}','${ITEM}',null,null,'note')`,
  submit: `select public.checklist_submit_batch('${ACTOR}','${INSTANCE}',array['${COMPLETION}']::uuid[])`,
  confirm: `select public.checklist_confirm_instance('${ACTOR}','${INSTANCE}',now(),'[]',array['${COMPLETION}']::uuid[])`,
};

async function base() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase's explicit default ACLs (not merely PostgreSQL's PUBLIC grant).
    alter default privileges grant execute on functions to anon, authenticated;
    create table audit_log(actor_id uuid, actor_role text, action text, resource_table text, resource_id uuid,
      destructive boolean, metadata jsonb);
    create table written_reports(id uuid primary key, submitted_by uuid, submitted_at timestamptz, location_id uuid,
      title text, body text, category text, visibility_min_level integer, last_edited_at timestamptz, edit_count integer default 0);
    create table users(id uuid primary key, role text not null, active boolean not null);
    create table user_locations(user_id uuid references users, location_id uuid, active boolean default true);
    create table checklist_templates(id uuid primary key, location_id uuid, type text, active boolean default true);
    create table checklist_template_items(id uuid primary key, template_id uuid references checklist_templates,
      min_role_level integer, active boolean, report_reference_type text, input_type text);
    create table checklist_instances(id uuid primary key, template_id uuid references checklist_templates,
      location_id uuid, date date default current_date, status text default 'open', confirmed_at timestamptz,
      confirmed_by uuid references users);
    create table checklist_completions(id uuid primary key default gen_random_uuid(), instance_id uuid not null references checklist_instances,
      template_item_id uuid not null references checklist_template_items, completed_by uuid not null references users,
      completed_at timestamptz default now(), count_value numeric(10,2), photo_id uuid, notes text,
      superseded_at timestamptz, superseded_by uuid references checklist_completions, revoked_at timestamptz,
      actual_completer_id uuid references users, prep_data jsonb);
    create table checklist_submissions(id uuid primary key default gen_random_uuid(), instance_id uuid not null references checklist_instances,
      submitted_by uuid not null references users, submitted_at timestamptz default now(), completion_ids uuid[] not null,
      is_final_confirmation boolean default false);
    create table checklist_incomplete_reasons(id uuid primary key default gen_random_uuid(), instance_id uuid not null references checklist_instances,
      template_item_id uuid not null references checklist_template_items, reason text not null, reported_by uuid not null references users,
      reported_at timestamptz default now());
    grant all on all tables in schema public to service_role;
    insert into users values('${ACTOR}','key_holder',true);
    insert into user_locations values('${ACTOR}','${SHOP_A}',true);
    insert into checklist_templates values('${TEMPLATE}','${SHOP_A}','closing',true);
    insert into checklist_template_items values('${ITEM}','${TEMPLATE}',3,true,null,null);
    insert into checklist_instances(id, template_id, location_id) values('${INSTANCE}','${TEMPLATE}','${SHOP_A}');
    insert into checklist_completions(id, instance_id, template_item_id, completed_by, completed_at)
      values('${COMPLETION}','${INSTANCE}','${ITEM}','${ACTOR}',now()-interval '1 hour');`);
  // The REAL role map (0228) with 0276's grant posture, then the real 0276, then 0287's live confirm.
  await db.exec(grab(mig("0228_assignment_attribution.sql"), /create function public\.assignment_author_level[\s\S]*?end \$\$;/, "0228 assignment_author_level"));
  await db.exec(`revoke all on function public.assignment_author_level(uuid) from public, anon, authenticated;
    grant execute on function public.assignment_author_level(uuid) to service_role;`);
  await db.exec(mig("0276_checklist_guarded_writers.sql"));
  await db.exec(grab(mig("0287_checklist_corrections_serialized.sql"), /create or replace function public\.checklist_confirm_instance\([\s\S]*?\nend \$\$;/, "0287 checklist_confirm_instance"));
  await db.exec(`revoke all on function public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) from public, anon, authenticated;
    grant execute on function public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]) to service_role;`);
  return db;
}

/** Set the actor's role / active flag and their shop-A membership ('active' | 'inactive' | 'missing'). */
async function fixture(db, role, membership, userActive = true) {
  await db.exec(`reset role;
    update users set role='${role}', active=${userActive} where id='${ACTOR}';
    delete from user_locations;
    ${membership === "missing" ? `insert into user_locations values('${ACTOR}','${SHOP_B}',true);`
      : `insert into user_locations values('${ACTOR}','${SHOP_A}',${membership === "active"}),('${ACTOR}','${SHOP_B}',true);`}`);
}

/** One writer call as service_role, rolled back: 'allowed' or the raised message. */
async function attempt(db, statement) {
  await db.exec("begin; set local role service_role;");
  try { await db.query(statement); return "allowed"; }
  catch (e) { return String(e.message); }
  finally { await db.exec("rollback"); }
}

async function matrix(db, label, expect) {
  for (const [role, level] of Object.entries(ROLES)) {
    for (const membership of ["active", "inactive", "missing"]) {
      await fixture(db, role, membership);
      for (const [name, sql] of Object.entries(CALLS)) {
        const got = await attempt(db, sql);
        const want = expect(level, membership);
        check((got === "allowed") === want && (want || got === "not_authorized"),
          `${label} ${name} ${role} (${level})/${membership}: ${want ? "allowed" : "not_authorized"}${(got === "allowed") === want ? "" : ` (got ${got})`}`);
      }
    }
  }
}

async function applyRefuses(db, drift, code, what) {
  await db.exec("reset role; begin");
  try {
    if (drift) await db.exec(drift);
    let msg = null;
    try { await db.exec(M0318); } catch (e) { msg = String(e.message); }
    check(msg !== null && msg.includes(code), `${what} -> ${code}${msg && msg.includes(code) ? "" : ` (got ${msg})`}`);
  } finally { await db.exec("rollback"); }
}

const main = await base();

// ── A: before 0318 ──────────────────────────────────────────────────────────────────────────────────
for (const role of ["moo", "owner", "cgs"]) {
  await fixture(main, role, "missing");
  for (const [name, sql] of Object.entries(CALLS)) {
    const got = await attempt(main, sql);
    check(got === "not_authorized", `A0 before 0318: ${role} with no membership is refused ${name} (the rule 0318 lifts)${got === "not_authorized" ? "" : ` (got ${got})`}`);
  }
}
await fixture(main, "gm", "active");
check(await attempt(main, CALLS.complete) === "allowed", "A0 before 0318: an active member GM completes");

// ── E (on a second, pristine database): refusals ─────────────────────────────────────────────────────
const drift = await base();
await applyRefuses(drift, `drop function public.assignment_author_level(uuid);`, "0318: 0228", "E1 refuses without 0228's assignment_author_level");
await applyRefuses(drift, `drop function public.checklist_submit_batch(uuid,uuid,uuid[]);`, "0318: 0276", "E2 refuses without 0276's writers");
await applyRefuses(drift, `create or replace function public.checklist_actor_level(p_actor uuid, p_location uuid)
  returns integer language plpgsql security invoker set search_path = pg_catalog, public as $$
  begin return public.assignment_author_level(p_actor); end $$;`, "re-sync", "E3 refuses a drifted (not 0276) checklist_actor_level");
await applyRefuses(drift, `alter function public.checklist_actor_level(uuid,uuid) security definer;`, "re-sync", "E4 refuses a SECURITY DEFINER checklist_actor_level");
{
  const n = (await drift.query(`select count(*)::int as n from audit_log`)).rows[0].n;
  check(n === 1, `E5 the refused applies wrote nothing (audit rows: ${n}, 0276's own row only)`);
}
await drift.exec("reset role");
await drift.exec(M0318);
check(true, "E6 after every refusal the untouched schema still takes the real 0318");
await drift.close();

// ── apply ───────────────────────────────────────────────────────────────────────────────────────────
await main.exec("reset role");
await main.exec(M0318);

// ── B: the matrix ───────────────────────────────────────────────────────────────────────────────────
await matrix(main, "B1", (level, membership) => level >= 8 || membership === "active");
for (const role of ["moo", "owner", "cgs"]) {
  for (const membership of ["active", "missing"]) {
    await fixture(main, role, membership, false);
    for (const [name, sql] of Object.entries(CALLS)) {
      const got = await attempt(main, sql);
      check(got === "not_authorized", `B2 an INACTIVE ${role} (${membership} membership) is refused ${name}${got === "not_authorized" ? "" : ` (got ${got})`}`);
    }
  }
}
// The callers' own floors stand: a level-8+ actor still gets their level back.
await main.exec(`reset role; update checklist_template_items set min_role_level = 9 where id = '${ITEM}';`);
await fixture(main, "moo", "missing");
check(await attempt(main, CALLS.complete) === "not_authorized", "B3 a MoO (8) at a non-member shop is still held to the item's min level 9");
await fixture(main, "owner", "missing");
check(await attempt(main, CALLS.complete) === "allowed", "B3 an owner (9) at a non-member shop meets the item's min level 9");
await main.exec(`reset role; update checklist_template_items set min_role_level = 3 where id = '${ITEM}';`);
await fixture(main, "cgs", "missing");
{
  await main.exec("begin; set local role service_role;");
  try {
    const r = (await main.query(`${CALLS.confirm} as r`)).rows[0].r;
    check(r.instance.status === "confirmed" && r.instance.confirmed_by === ACTOR, "B4 a CGS with no membership confirms the instance (confirmed_by = the CGS)");
    const sub = (await main.query(`select submitted_by, is_final_confirmation from checklist_submissions where instance_id = '${INSTANCE}'`)).rows;
    check(sub.length === 1 && sub[0].submitted_by === ACTOR && sub[0].is_final_confirmation === true, "B4 the final submission names the CGS");
  } finally { await main.exec("rollback"); }
}

// ── C: lock order ───────────────────────────────────────────────────────────────────────────────────
async function locksDuring(role, membership) {
  await fixture(main, role, membership);
  await main.exec("begin; set local role service_role;");
  try {
    await main.query(CALLS.complete);
    await main.exec("reset role");
    const rows = (await main.query(`select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
      where c.relname in ('checklist_instances','users','user_locations') and l.pid = pg_backend_pid()`)).rows;
    return new Set(rows.map((r) => `${r.relname}:${r.mode}`));
  } finally { await main.exec("rollback"); }
}
{
  const member = await locksDuring("key_holder", "active");
  check(member.has("checklist_instances:RowShareLock") && member.has("users:RowShareLock") && member.has("user_locations:RowShareLock"),
    `C1 below 8: the caller locks the instance, then the users row and the membership row FOR SHARE (${[...member].join(", ")})`);
  const moo = await locksDuring("moo", "missing");
  check(moo.has("checklist_instances:RowShareLock") && moo.has("users:RowShareLock") && !moo.has("user_locations:RowShareLock")
    && ![...moo].some((x) => x.startsWith("user_locations:")),
    `C2 at 8+: user_locations is never read or locked (${[...moo].join(", ")})`);
}

// ── D: shape and grants ─────────────────────────────────────────────────────────────────────────────
{
  const f = (await main.query(`select prosecdef, proconfig from pg_proc where oid = 'public.checklist_actor_level(uuid,uuid)'::regprocedure`)).rows[0];
  check(f.prosecdef === false && (f.proconfig ?? []).includes("search_path=pg_catalog, public"), "D1 SECURITY INVOKER with the pinned search_path");
  const g = (await main.query(`select has_function_privilege('anon', 'public.checklist_actor_level(uuid,uuid)', 'EXECUTE') as anon,
    has_function_privilege('authenticated', 'public.checklist_actor_level(uuid,uuid)', 'EXECUTE') as auth,
    has_function_privilege('service_role', 'public.checklist_actor_level(uuid,uuid)', 'EXECUTE') as svc`)).rows[0];
  check(!g.anon && !g.auth && g.svc, "D2 EXECUTE: service_role only, never anon / authenticated");
  await fixture(main, "moo", "missing");
  await main.exec("begin; set local role authenticated;");
  let msg = null;
  try { await main.query(`select public.checklist_actor_level('${ACTOR}','${SHOP_A}')`); } catch (e) { msg = String(e.message); }
  finally { await main.exec("rollback"); }
  check(msg !== null && /permission denied/.test(msg), "D3 authenticated cannot call checklist_actor_level");
}

// ── Z ───────────────────────────────────────────────────────────────────────────────────────────────
{
  await main.exec("reset role");
  const rows = (await main.query(`select action, destructive, metadata from audit_log where metadata->>'migration' = '0318_checklist_task_writers_any_shop_level8'`)).rows;
  check(rows.length === 1 && rows[0].metadata.actor_context === "migration_apply" && rows[0].destructive === true,
    "Z  one audit row, migration_apply, destructive");
  let msg = null;
  try { await main.exec(M0318); } catch (e) { msg = String(e.message); }
  check(msg !== null && msg.includes("already applied"), "Z  a second apply refuses (already applied)");
  await main.exec("rollback").catch(() => {});
  const n = (await main.query(`select count(*)::int as n from audit_log where metadata->>'migration' = '0318_checklist_task_writers_any_shop_level8'`)).rows[0].n;
  check(n === 1, "Z  the refused second apply wrote nothing");
}
await main.close();

if (failures) { console.error(`FAIL 0318: ${failures} of ${checks} checks failed`); process.exit(1); }
console.log(`PASS 0318: ${checks} checks`);
