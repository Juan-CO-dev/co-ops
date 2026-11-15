/**
 * Local Postgres proof of migration 0304 (the cash report's closing lock + atomic write, bug-audit wave
 * W03: B040 / B041 / B147), SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns the Supabase sim/prod gate;
 * this never touches a real database.
 *
 *   node scripts/sql-harness-0304.mjs
 *
 * Applies a small inline stub (the Supabase roles + default privileges, users, locations, the two
 * checklist tables with 0046's status set, the two RLS helpers 0067's policies call), then the REAL
 * 0067 + 0069 + 0188, 0253's two column adds, and 0304, and proves:
 *   P0  the preflight refuses without 0188, without 0253's columns, and on a second apply
 *   P1  the posture: exactly one signature (0188's 14-argument one dropped), SECURITY DEFINER with a
 *       pinned search_path, EXECUTE for service_role only (anon / authenticated refused)
 *   P2  a first submit inserts the live row with 0253's Toast columns; a hand count stores no denominations
 *   P3  an edit supersedes the prior row and the chain stamps agree: prior.superseded_at = new.signed_at,
 *       prior.superseded_by = new.id, one live row
 *   P4  the gate (B040 / B041): confirmed, incomplete_confirmed and auto_finalized each refuse
 *       `closing_finalized` and change nothing; open and no-instance write; another shop's finalized
 *       closing and this shop's finalized non-closing list do not lock
 *   P5  atomicity: an insert that fails rolls the supersede back with it — the prior row stays live,
 *       nothing is stranded (the state 0188's prose and #304's rollback machinery existed to describe)
 *   P6  invalid input refuses by name before any write
 *   P7  review r1: the lock is the day's closing INSTANCES, any template version — a retired V1's
 *       finalized instance refuses with V2 published (with or without a V2 instance), and so does a
 *       finalized V2 over an open V1; the RPC takes no template id, so no resolution can disarm it
 * The two-session proofs (a confirm racing the FOR SHARE lock; two simultaneous submits → one 23505)
 * need two connections and are sim-only; P1 pins the lock and the compare-and-set in the body instead.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const M0067 = read("supabase/migrations/0067_cash_reports.sql");
const M0069 = read("supabase/migrations/0069_cash_reports_rename_drawer_float.sql");
const M0188 = read("supabase/migrations/0188_cash_report_atomic_supersede.sql");
const M0253_COLUMNS = read("supabase/migrations/0253_cash_reports_toast_projected.sql")
  .split("\n").filter((l) => l.startsWith("alter table public.cash_reports add column")).join("\n");
const M0304 = read("supabase/migrations/0304_cash_report_closing_lock.sql");
if (M0253_COLUMNS.split("\n").length !== 2) throw new Error("expected 0253's two column adds");

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.users (id uuid primary key default gen_random_uuid(), name text not null default 'stub');
create table public.locations (id uuid primary key default gen_random_uuid());
create function public.current_user_role_level() returns integer language sql stable as $$ select null::integer $$;
create function public.current_user_locations() returns uuid[] language sql stable as $$ select '{}'::uuid[] $$;
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  type text not null,
  active boolean not null default true
);
create table public.checklist_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id),
  location_id uuid not null references public.locations(id),
  date date not null,
  status text not null default 'open'
    check (status in ('open','phase1_complete','phase2_complete','confirmed','incomplete_confirmed','auto_finalized'))
);
`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ m0188 = true, m0253 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(M0067);
  await db.exec(M0069);
  if (m0188) await db.exec(M0188);
  if (m0253) await db.exec(M0253_COLUMNS);
  return db;
}

const SIG = "uuid,date,integer,integer,integer,text,jsonb,integer,jsonb,integer,integer,text,bigint,timestamptz,uuid,timestamptz";

const db = await base();
try {
  // P0 — the preflight
  {
    const no0188 = await base({ m0188: false });
    await refuses(() => no0188.exec(M0304), "0304: expected 0188 submit_cash_report_atomic signature", "P0 refuses without 0188");
    await no0188.close();
    const no0253 = await base({ m0253: false });
    await refuses(() => no0253.exec(M0304), "0304: 0253 (cash_reports toast_projected columns) must be applied first", "P0 refuses without 0253's columns");
    await no0253.close();
    const again = await base();
    await again.exec(M0304);
    await refuses(() => again.exec(M0304), "0304: already applied", "P0 a second apply is refused");
    await again.close();
  }

  await db.exec(M0304);
  check(true, "0304 applied with every SQL guard");

  // P1 — posture
  {
    const sigs = (await db.query("select pg_get_function_identity_arguments(p.oid) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_cash_report_atomic'")).rows;
    check(sigs.length === 1, "P1 exactly one submit_cash_report_atomic signature (0188's dropped)");
    const f = `public.submit_cash_report_atomic(${SIG})`;
    const priv = (await db.query(`select has_function_privilege('anon', '${f}'::regprocedure, 'EXECUTE') as anon,
      has_function_privilege('authenticated', '${f}'::regprocedure, 'EXECUTE') as auth,
      has_function_privilege('service_role', '${f}'::regprocedure, 'EXECUTE') as svc,
      (select prosecdef from pg_proc where oid = '${f}'::regprocedure) as definer,
      (select proconfig from pg_proc where oid = '${f}'::regprocedure) as cfg,
      (select prosrc from pg_proc where oid = '${f}'::regprocedure) as src`)).rows[0];
    check(!priv.anon && !priv.auth && priv.svc, "P1 EXECUTE: service_role only");
    check(priv.definer === true && JSON.stringify(priv.cfg) === JSON.stringify(["search_path=pg_catalog, public"]), "P1 SECURITY DEFINER, search_path pinned");
    check(/for share/.test(priv.src) && /and superseded_at is null/.test(priv.src), "P1 the body locks the closing FOR SHARE and supersedes with a compare-and-set");
  }

  // fixtures
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const L = await id("insert into public.locations default values returning id");
  const OTHER = await id("insert into public.locations default values returning id");
  const KH = await id("insert into public.users (name) values ('kh') returning id");
  const TMPL = await id("insert into public.checklist_templates (location_id, type) values ($1, 'closing') returning id", [L]);
  const PREP_TMPL = await id("insert into public.checklist_templates (location_id, type) values ($1, 'prep') returning id", [L]);
  const OTHER_TMPL = await id("insert into public.checklist_templates (location_id, type) values ($1, 'closing') returning id", [OTHER]);
  const DAY = "2026-11-10";
  const INST = await id("insert into public.checklist_instances (template_id, location_id, date) values ($1, $2, $3) returning id", [TMPL, L, DAY]);

  await db.exec("set role service_role");
  const submit = async (o = {}) => {
    const a = {
      loc: L, date: DAY, projected: 50000, drawer: 60000, float: 20000, method: "hand",
      denoms: null, tips: 0, onShift: [], overShort: -10000, deposit: 40000, note: null,
      toastCents: 50000, toastAsOf: "2026-11-11T02:00:00Z", actor: KH, now: "2026-11-11T03:00:00Z", ...o,
    };
    const r = await db.query(
      `select * from public.submit_cash_report_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [a.loc, a.date, a.projected, a.drawer, a.float, a.method, a.denoms === null ? null : JSON.stringify(a.denoms), a.tips,
        JSON.stringify(a.onShift), a.overShort, a.deposit, a.note, a.toastCents, a.toastAsOf, a.actor, a.now]);
    return r.rows[0];
  };
  const rows = async () => (await db.query("select id, superseded_at, superseded_by, signed_at, drawer_total_cents, denominations, toast_projected_cents, toast_projected_as_of from public.cash_reports where location_id = $1 and report_date = $2 order by created_at, signed_at", [L, DAY])).rows;
  const live = async () => (await rows()).filter((r) => r.superseded_at === null);

  // P1 (cont.) — the PostgREST roles cannot call it
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => submit(), "permission denied", `P1 ${role} cannot execute the writer`);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");

  // P2 — first submit
  const first = await submit({ denoms: { "2000": 3 } });
  check(first.new_id && first.superseded_id === null, "P2 a first submit returns (new_id, null)");
  {
    const r = await live();
    check(r.length === 1 && r[0].id === first.new_id, "P2 one live row");
    check(Number(r[0].toast_projected_cents) === 50000 && r[0].toast_projected_as_of !== null, "P2 0253's Toast figure and its as-of are stored");
    check(r[0].denominations === null, "P2 a hand count stores no denominations");
  }

  // P3 — an edit
  const second = await submit({ drawer: 61000, now: "2026-11-11T03:05:00Z" });
  {
    const all = await rows();
    const prior = all.find((r) => r.id === first.new_id);
    const next = all.find((r) => r.id === second.new_id);
    check(second.superseded_id === first.new_id, "P3 an edit returns the superseded id");
    check((await live()).length === 1 && (await live())[0].id === second.new_id, "P3 exactly one live row: the edit");
    check(prior.superseded_by === second.new_id && +new Date(prior.superseded_at) === +new Date(next.signed_at),
      "P3 the chain stamps agree (prior.superseded_at = new.signed_at, prior.superseded_by = new.id)");
  }

  // P4 — the gate
  for (const status of ["confirmed", "incomplete_confirmed", "auto_finalized"]) {
    await db.exec("reset role");
    await db.query("update public.checklist_instances set status = $1 where id = $2", [status, INST]);
    await db.exec("set role service_role");
    const before = JSON.stringify(await rows());
    await refuses(() => submit({ drawer: 1 }), "closing_finalized", `P4 a ${status} closing refuses the cash write`);
    check(JSON.stringify(await rows()) === before, `P4 ${status}: nothing changed`);
  }
  await db.exec("reset role");
  await db.query("update public.checklist_instances set status = 'open' where id = $1", [INST]);
  await db.exec("set role service_role");
  const third = await submit({ drawer: 62000, now: "2026-11-11T03:10:00Z" });
  check(third.superseded_id === second.new_id, "P4 an open closing writes");
  const otherDay = await submit({ date: "2026-11-09", now: "2026-11-11T03:11:00Z" });
  check(otherDay.new_id && otherDay.superseded_id === null, "P4 a day with no closing instance writes (nothing to lock)");
  {
    // Only THIS shop's CLOSING instances lock: another shop's finalized closing and this shop's
    // finalized prep list leave the edit window open.
    await db.exec("reset role");
    await db.query("insert into public.checklist_instances (template_id, location_id, date, status) values ($1, $2, $3, 'confirmed')", [OTHER_TMPL, OTHER, DAY]);
    await db.query("insert into public.checklist_instances (template_id, location_id, date, status) values ($1, $2, $3, 'confirmed')", [PREP_TMPL, L, DAY]);
    await db.exec("set role service_role");
    const unlocked = await submit({ drawer: 63000, now: "2026-11-11T03:12:00Z" });
    check(unlocked.superseded_id === third.new_id, "P4 another shop's finalized closing and a finalized non-closing list do not lock");
  }

  // P7 — review r1: the lock is the day's closing INSTANCES, any template version. Template V1 is
  //      retired (an admin published V2 and deactivated V1) with a finalized instance; whatever the app
  //      resolves as current today, the RPC takes no template id and the locked deposit stands.
  {
    await db.exec("reset role");
    const V2 = await id("insert into public.checklist_templates (location_id, type) values ($1, 'closing') returning id", [L]);
    await db.query("update public.checklist_templates set active = false where id = $1", [TMPL]); // V1 retired
    await db.exec("set role service_role");
    for (const status of ["confirmed", "incomplete_confirmed", "auto_finalized"]) {
      await db.exec("reset role");
      await db.query("update public.checklist_instances set status = $1 where id = $2", [status, INST]);
      await db.exec("set role service_role");
      const before = JSON.stringify(await rows());
      await refuses(() => submit({ drawer: 2 }), "closing_finalized", `P7 retired V1 ${status} + replacement V2 (no instance) → refused`);
      check(JSON.stringify(await rows()) === before, `P7 ${status}: the locked deposit is untouched`);
    }
    await db.exec("reset role");
    const V2_INST = await id("insert into public.checklist_instances (template_id, location_id, date) values ($1, $2, $3) returning id", [V2, L, DAY]);
    await db.exec("set role service_role");
    {
      const before = JSON.stringify(await rows());
      await refuses(() => submit({ drawer: 3 }), "closing_finalized", "P7 V1 finalized + V2 open the same night → still refused");
      check(JSON.stringify(await rows()) === before, "P7 V1 finalized + V2 open: nothing changed");
    }
    await db.exec("reset role");
    await db.query("update public.checklist_instances set status = 'open' where id = $1", [INST]);
    await db.query("update public.checklist_instances set status = 'auto_finalized' where id = $1", [V2_INST]);
    await db.exec("set role service_role");
    await refuses(() => submit({ drawer: 4 }), "closing_finalized", "P7 V2 finalized (V1 open) → refused");
    await db.exec("reset role");
    await db.query("update public.checklist_instances set status = 'open' where id = $1", [V2_INST]);
    await db.exec("set role service_role");
    const reopened = await submit({ drawer: 64000, now: "2026-11-11T03:15:00Z" });
    check(reopened.new_id && reopened.superseded_id !== null, "P7 both versions open → the edit writes");
  }

  // P5 — atomicity: a failing insert takes the supersede with it
  {
    const liveBefore = (await live())[0];
    await refuses(() => submit({ actor: "00000000-0000-4000-8000-000000000000", now: "2026-11-11T03:20:00Z" }), "23503", "P5 an insert that fails (unknown signer) errors");
    const liveAfter = await live();
    check(liveAfter.length === 1 && liveAfter[0].id === liveBefore.id && liveAfter[0].superseded_at === null,
      "P5 the prior row is still live — the supersede rolled back with the insert, nothing stranded");
  }

  // P6 — invalid input
  {
    const before = JSON.stringify(await rows());
    await refuses(() => submit({ method: "scale" }), "invalid_payload", "P6 an unknown count method");
    await refuses(() => submit({ actor: null }), "invalid_payload", "P6 no actor");
    await refuses(() => submit({ now: null }), "invalid_payload", "P6 no instant");
    check(JSON.stringify(await rows()) === before, "P6 refusals wrote nothing");
  }
  await db.exec("reset role");
} catch (e) {
  failures++;
  console.error("FAIL harness crashed:", e);
} finally {
  await db.close();
}

if (failures) { console.error(`FAIL 0304: ${failures} of ${checks} checks failed`); process.exit(1); }
console.log(`PASS 0304: ${checks} checks`);
