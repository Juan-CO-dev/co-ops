/**
 * Local Postgres proof of migration 0303 (one open Stripe Checkout Session per quote — bug audit
 * 2026-11-14, wave W02, finding B035). SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns the Supabase
 * sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0303.mjs
 *
 * Builds `catering_payments` from the REAL DDL — 0127's CREATE TABLE, the whole of 0130
 * (`catering_payments_one_due`) and the whole of 0204 (`provider_session_id` + its index + `stripe_events`)
 * — over the real 0108 / 0120 / 0127 parents, then applies 0303 and proves:
 *   P0  the pre-flight refuses: without 0204 (no provider_session_id), without 0130 (no one_due index),
 *       on a second apply, and on rows that already break the rule (it names the count and picks no
 *       winner); a refused apply changes nothing
 *   P1  the apply itself: one new UNIQUE index on (quote_id) WHERE status = 'due' AND provider_session_id
 *       IS NOT NULL; the 0130 and 0204 indexes still there; no row written, moved or deleted; no grant or
 *       policy changed; exactly ONE column added (`settlement_cleanup_at`, a nullable timestamptz with no
 *       default, NULL on every existing row) and every other column as it was; exactly TWO functions
 *   P2  the rule: a second due intent of one quote cannot ATTACH a session while another due intent holds
 *       one (23505 naming the index), by UPDATE and by INSERT
 *   P3  what stays allowed: a due deposit + a due full with only one at Stripe; clearing one session then
 *       attaching the other (the app's retire-then-mint order); a paid / refunded / void row keeping its
 *       session id beside a new due one; different quotes each with their own open checkout
 *   P4  0130 is untouched: still one due intent per (quote, kind)
 *   P5  the rollback in the header (drop the two functions, the index, the column — in that order)
 *       restores the pre-0303 schema exactly
 *   P6  the attach FUNCTION (review r3), `catering_payment_attach_checkout`: every answer it can give
 *       (attached / in_progress / not_due / not_payable / already_paid / session_unresolved), that a
 *       refusal writes nothing, that a void row's session blocks and a paid / refunded row's does not,
 *       its privilege ceiling (service_role only: anon and authenticated are refused by Postgres), that
 *       it is SECURITY DEFINER with a pinned search_path, and that it takes the quote row and the
 *       quote's payment rows FOR UPDATE before it reads
 *   P7  the READINESS function (review r6), `catering_payment_checkout_ready`: true after the apply; false
 *       the moment any of the three other objects is gone (the attach function, the index, the column), so
 *       a half rollback can never read as "ready"; its privilege ceiling (service_role only); SECURITY
 *       INVOKER with a pinned search_path
 *   P8  the SETTLEMENT MARKER (review r6, r8): the app's compare-and-set (`settlement_cleanup_at = now()
 *       where status in ('paid', 'refunded') and settlement_cleanup_at is null`) lands exactly once per
 *       SETTLED row — paid, or refunded with its cleanup still unrecorded (review r8: the marker owns the
 *       cleanup, the money status does not) — never on a due / void row, never changes the status, is never
 *       rewritten by a second writer, is neither set nor cleared by a refund, and does not interact with
 *       either unique index
 *
 * WHAT A SINGLE SESSION CANNOT SHOW: that a concurrent settlement actually WAITS on those locks. That
 * is a two-session proof and belongs on the sim, run by CC when 0303 is applied there.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const M0303 = read("0303_catering_payments_one_open_checkout.sql");
const M0130 = read("0130_catering_payments_one_due.sql");
const M0204 = read("0204_stripe_events_and_checkout.sql");

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
// The REAL payments table, its 0127 index and its RLS switch.
const PAYMENTS_0127 = must(
  M0127.match(/CREATE TABLE catering_payments \([\s\S]*?ALTER TABLE catering_payments ENABLE ROW LEVEL SECURITY;/i),
  "0127 catering_payments",
);

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, needle, what) {
  try { await fn(); check(false, `${what} (no error; expected ${needle})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(needle), `${what} → ${needle}${s.includes(needle) ? "" : ` (got: ${s})`}`); }
}

/** A database at the state 0303 expects (0127 + optionally 0130 + optionally 0204). */
async function base({ m0130 = true, m0204 = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key default gen_random_uuid(), code text, active boolean not null default true);
    create table public.users (id uuid primary key default gen_random_uuid(), role text, active boolean not null default true);
    ${table("0108_catering_scaffold_capture.sql", "catering_customers")}
    ${table("0108_catering_scaffold_capture.sql", "catering_pipeline")}
    create table public.catering_delivery_zones (id uuid primary key default gen_random_uuid());
    ${QUOTES_0120}
    ${QUOTES_0127}
    ${PAYMENTS_0127}`);
  if (m0130) await db.exec(M0130);
  if (m0204) await db.exec(M0204);
  return db;
}

const indexNames = async (db) =>
  (await db.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'catering_payments' order by 1")).rows.map((r) => r.indexname);
const snapshot = async (db) =>
  JSON.stringify((await db.query("select id, quote_id, kind, amount_cents, status, provider, provider_ref, provider_session_id from public.catering_payments order by id")).rows);
const columnsOf = async (db) =>
  (await db.query(
    "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'catering_payments' order by ordinal_position")).rows;

async function fixtures(db) {
  const shop = (await db.query("insert into public.locations (code) values ('S1') returning id")).rows[0].id;
  const quote = async () => (await db.query(
    "insert into public.catering_quotes (location_id, version, status) values ($1, 1, 'sent') returning id", [shop])).rows[0].id;
  const pay = async (quoteId, kind, status = "due", session = null) => (await db.query(
    "insert into public.catering_payments (quote_id, kind, amount_cents, status, provider_session_id) values ($1, $2, 1000, $3, $4) returning id",
    [quoteId, kind, status, session])).rows[0].id;
  return { shop, quote, pay };
}

const db = await base();
try {
  // ── P0 — the pre-flight ─────────────────────────────────────────────────────────────────────
  {
    const no0204 = await base({ m0204: false });
    await refuses(() => no0204.exec(M0303), "0303: 0204 (catering_payments.provider_session_id) must be applied first", "P0 the pre-flight refuses without 0204");
    await no0204.close();

    const no0130 = await base({ m0130: false });
    await refuses(() => no0130.exec(M0303), "0303: 0130 (catering_payments_one_due) must be applied first", "P0 the pre-flight refuses without 0130");
    await no0130.close();

    const none = new PGlite();
    await refuses(() => none.exec(M0303), "0303: 0127 (catering_payments) must be applied first", "P0 the pre-flight refuses without the table");
    await none.close();

    const again = await base();
    await again.exec(M0303);
    await refuses(() => again.exec(M0303), "0303: catering_payments_one_open_checkout already exists: refusing a second apply", "P0 a second apply is refused");
    await again.exec("rollback");
    // Half a rollback (the index dropped, the function left): still refused, by the function's own guard.
    await again.exec("drop index public.catering_payments_one_open_checkout;");
    await refuses(() => again.exec(M0303), "0303: catering_payment_attach_checkout already exists: refusing a second apply", "P0 a re-apply over a leftover function is refused");
    await again.exec("rollback");
    // …the attach function dropped too, the readiness function left:
    await again.exec("drop function public.catering_payment_attach_checkout(uuid, uuid, integer, text);");
    await refuses(() => again.exec(M0303), "0303: catering_payment_checkout_ready already exists: refusing a second apply", "P0 a re-apply over a leftover readiness function is refused");
    await again.exec("rollback");
    // …and that one dropped, the marker column left:
    await again.exec("drop function public.catering_payment_checkout_ready();");
    await refuses(() => again.exec(M0303), "0303: catering_payments.settlement_cleanup_at already exists: refusing a second apply", "P0 a re-apply over a leftover marker column is refused");
    await again.exec("rollback");
    // The whole documented rollback, and the file applies again from clean.
    await again.exec("alter table public.catering_payments drop column settlement_cleanup_at;");
    await again.exec(M0303);
    check((await again.query("select public.catering_payment_checkout_ready() as ok")).rows[0].ok === true, "P0 after the full documented rollback, the file applies again");
    await again.close();

    // Rows that already break the rule: two due intents of ONE quote, both at Stripe.
    const dirty = await base();
    const f = await fixtures(dirty);
    const q = await f.quote();
    await f.pay(q, "deposit", "due", "cs_test_a");
    await f.pay(q, "full", "due", "cs_test_b");
    const before = await snapshot(dirty);
    await refuses(() => dirty.exec(M0303), "0303: 1 quote(s) already hold more than one due payment with an open checkout session: refusing", "P0 the DATA CHECK refuses colliding rows and names the count");
    // The migration's own `begin` is left aborted by the refusal; end it as the apply tool would.
    await dirty.exec("rollback");
    check((await snapshot(dirty)) === before, "P0 a refused apply changes no row (the migration picks no winner)");
    check(!(await indexNames(dirty)).includes("catering_payments_one_open_checkout"), "P0 a refused apply leaves no index behind");
    // The documented fix: clear the stale session, then the apply goes through.
    await dirty.query("update public.catering_payments set provider_session_id = null where provider_session_id = 'cs_test_a'");
    await dirty.exec(M0303);
    check((await indexNames(dirty)).includes("catering_payments_one_open_checkout"), "P0 after the stale session is cleared by hand, the apply succeeds");
    await dirty.close();
  }

  // ── fixtures BEFORE the apply: existing rows of every shape the table can hold ───────────────
  const f = await fixtures(db);
  const Q1 = await f.quote(), Q2 = await f.quote(), Q3 = await f.quote(), Q4 = await f.quote();
  const q1Deposit = await f.pay(Q1, "deposit", "due", "cs_test_q1_dep"); // at Stripe
  const q1Full = await f.pay(Q1, "full", "due", null);                    // due, not at Stripe
  await f.pay(Q2, "deposit", "paid", "cs_test_q2_old");                   // history
  await f.pay(Q2, "balance", "due", null);
  await f.pay(Q3, "deposit", "void", "cs_test_q3_void");                  // history
  await f.pay(Q3, "full", "refunded", "cs_test_q3_ref");                  // history
  const grantsBefore = JSON.stringify((await db.query(
    "select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'catering_payments' order by 1, 2")).rows);
  const policiesBefore = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'catering_payments'")).rows[0].n;
  const columnsBefore = JSON.stringify(await columnsOf(db));
  const rowsBefore = await snapshot(db);
  const namesBefore = await indexNames(db);

  await db.exec(M0303);
  check(true, "0303 applied with every SQL guard, over existing rows");

  // ── P1 — exactly one new index, nothing else moved ───────────────────────────────────────────
  const namesAfter = await indexNames(db);
  check(JSON.stringify(namesAfter.filter((n) => !namesBefore.includes(n))) === JSON.stringify(["catering_payments_one_open_checkout"]),
    "P1 the apply adds exactly one index: catering_payments_one_open_checkout");
  check(namesBefore.every((n) => namesAfter.includes(n)), "P1 every pre-existing index is still there (one_due, provider_session_ix, quote, pkey)");
  const def = (await db.query("select indexdef from pg_indexes where indexname = 'catering_payments_one_open_checkout'")).rows[0].indexdef;
  check(/^CREATE UNIQUE INDEX catering_payments_one_open_checkout ON public\.catering_payments USING btree \(quote_id\) WHERE /i.test(def)
    && /status = 'due'/i.test(def) && /provider_session_id IS NOT NULL/i.test(def),
    "P1 it is UNIQUE (quote_id) WHERE status = 'due' AND provider_session_id IS NOT NULL");
  check((await snapshot(db)) === rowsBefore, "P1 no row was written, moved or deleted");
  check(JSON.stringify((await db.query(
    "select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'catering_payments' order by 1, 2")).rows) === grantsBefore,
    "P1 no grant on catering_payments changed");
  check((await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'catering_payments'")).rows[0].n === policiesBefore,
    "P1 no policy was added");
  {
    const after = await columnsOf(db);
    const added = after.filter((c) => !JSON.parse(columnsBefore).some((b) => b.column_name === c.column_name));
    check(JSON.stringify(added) === JSON.stringify([{ column_name: "settlement_cleanup_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }]),
      "P1 exactly ONE column was added: settlement_cleanup_at, a nullable timestamptz with no default");
    check(JSON.stringify(after.filter((c) => c.column_name !== "settlement_cleanup_at")) === columnsBefore,
      "P1 every pre-existing column is exactly as it was");
    check((await db.query("select count(*)::int as n from public.catering_payments where settlement_cleanup_at is not null")).rows[0].n === 0,
      "P1 the apply wrote no marker: every existing row reads NULL (not confirmed)");
  }
  check((await db.query("select relrowsecurity from pg_class where oid = 'public.catering_payments'::regclass")).rows[0].relrowsecurity === true,
    "P1 RLS is still enabled on catering_payments");

  // …and the second object: one function, behind its ceiling.
  const FN = "public.catering_payment_attach_checkout(uuid,uuid,integer,text)";
  const fnRows = (await db.query(
    "select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) as returns from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'catering_payment_attach_checkout'")).rows;
  check(fnRows.length === 1 && fnRows[0].returns === "text", "P1 the apply adds exactly one function: catering_payment_attach_checkout(uuid, uuid, integer, text) returns text");
  check(fnRows[0]?.prosecdef === true && JSON.stringify(fnRows[0]?.proconfig) === JSON.stringify(["search_path=pg_catalog, public"]),
    "P1 it is SECURITY DEFINER with search_path = pg_catalog, public");
  const priv = (await db.query(
    `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as authed, has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [FN])).rows[0];
  check(priv.anon === false && priv.authed === false && priv.svc === true, "P1 EXECUTE: service_role only — not anon, not authenticated");
  check((await db.query("select count(*)::int as n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = $1::regprocedure and a.grantee = 0", [FN])).rows[0].n === 0,
    "P1 …and not PUBLIC");
  check(JSON.stringify((await db.query(
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname like 'catering_payment%' order by 1")).rows.map((r) => r.proname))
      === JSON.stringify(["catering_payment_attach_checkout", "catering_payment_checkout_ready"]),
    "P1 exactly two catering_payment functions exist: the attach and the readiness question");

  // ── P7 — the readiness function (review r6) ──────────────────────────────────────────────────
  {
    const READY = "public.catering_payment_checkout_ready()";
    const ready = async (d = db) => (await d.query("select public.catering_payment_checkout_ready() as ok")).rows[0].ok;
    check((await ready()) === true, "P7 after the apply, catering_payment_checkout_ready() answers true");
    const meta = (await db.query(
      "select p.prosecdef, p.proconfig, p.provolatile, pg_get_function_result(p.oid) as returns from pg_proc p where p.oid = $1::regprocedure", [READY])).rows[0];
    check(meta.returns === "boolean" && meta.prosecdef === false && meta.provolatile === "s"
      && JSON.stringify(meta.proconfig) === JSON.stringify(["search_path=pg_catalog, public"]),
      "P7 it returns boolean, is STABLE, SECURITY INVOKER, with search_path = pg_catalog, public");
    const rp = (await db.query(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as authed, has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [READY])).rows[0];
    check(rp.anon === false && rp.authed === false && rp.svc === true, "P7 EXECUTE: service_role only — not anon, not authenticated");
    check((await db.query("select count(*)::int as n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = $1::regprocedure and a.grantee = 0", [READY])).rows[0].n === 0,
      "P7 …and not PUBLIC");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await refuses(() => ready(), "permission denied for function catering_payment_checkout_ready", `P7 ${role} cannot execute it (42501)`);
      } finally {
        await db.exec("reset role");
      }
    }
    await db.exec("set role service_role");
    try {
      check((await ready()) === true, "P7 service_role may execute it → true");
    } finally {
      await db.exec("reset role");
    }
    // A HALF ROLLBACK NEVER READS AS READY: each of the three other objects, removed alone.
    for (const [what, undo] of [
      ["the attach function", "drop function public.catering_payment_attach_checkout(uuid, uuid, integer, text);"],
      ["the one-open-checkout index", "drop index public.catering_payments_one_open_checkout;"],
      ["the settlement marker column", "alter table public.catering_payments drop column settlement_cleanup_at;"],
    ]) {
      const half = await base();
      await half.exec(M0303);
      await half.exec(undo);
      check((await ready(half)) === false, `P7 with ${what} gone, it answers false (the app refuses the pay tap)`);
      await half.close();
    }
    // …and without the file at all there is no function to ask: the error PostgREST turns into PGRST202.
    const none = await base();
    await refuses(() => ready(none), "42883", "P7 on a database without 0303 the function does not exist (42883; PostgREST: PGRST202)");
    await none.close();
  }

  // ── P8 — the settlement marker's compare-and-set (review r6) ─────────────────────────────────
  {
    // The statement lib/catering/payment-sessions.ts markSettlementCleanupDone issues (review r8: the
    // guard is "money was recorded on this row", `paid` or `refunded` — SETTLED_PAYMENT_STATUSES).
    const mark = async (id) => (await db.query(
      "update public.catering_payments set settlement_cleanup_at = now() where id = $1 and status in ('paid', 'refunded') and settlement_cleanup_at is null returning settlement_cleanup_at, status", [id])).rows;
    const markerOf = async (id) => (await db.query("select settlement_cleanup_at from public.catering_payments where id = $1", [id])).rows[0].settlement_cleanup_at;
    const statusOf = async (id) => (await db.query("select status from public.catering_payments where id = $1", [id])).rows[0].status;
    const M = await f.quote();
    const mPaid = await f.pay(M, "deposit", "paid", "cs_marker_paid");
    const mDue = await f.pay(M, "balance", "due", null);
    const first = await mark(mPaid);
    check(first.length === 1 && first[0].settlement_cleanup_at != null, "P8 the marker lands on a PAID row whose marker is NULL (one row)");
    const stamped = String(await markerOf(mPaid));
    check((await mark(mPaid)).length === 0, "P8 a second writer matches nothing: the marker is written ONCE");
    check(String(await markerOf(mPaid)) === stamped, "P8 …and its value is not rewritten");
    check((await mark(mDue)).length === 0 && (await markerOf(mDue)) === null, "P8 a DUE row never takes the marker");
    const N = await f.quote();
    const nVoid = await f.pay(N, "deposit", "void", "cs_marker_void");
    const nRefunded = await f.pay(N, "full", "refunded", "cs_marker_ref");
    check((await mark(nVoid)).length === 0 && (await markerOf(nVoid)) === null, "P8 a VOID row never takes it either (no settlement was recorded on it)");
    // REVIEW r8: a row that was paid and REFUNDED before its cleanup was recorded still owes it — and
    // takes the marker when it is done. The write names no status: the row stays refunded.
    check((await markerOf(nRefunded)) === null, "P8 a REFUNDED row whose cleanup was never recorded reads NULL (still owed)");
    const late = await mark(nRefunded);
    check(late.length === 1 && late[0].settlement_cleanup_at != null, "P8 (r8) the marker lands on a REFUNDED row whose marker is NULL (one row)");
    check(late[0]?.status === "refunded" && (await statusOf(nRefunded)) === "refunded", "P8 (r8) …and writing it does not change the money status: still refunded");
    const lateStamp = String(await markerOf(nRefunded));
    check((await mark(nRefunded)).length === 0 && String(await markerOf(nRefunded)) === lateStamp, "P8 (r8) …once: a second writer matches nothing and the value stands");
    // A paid row that was refunded AFTER its cleanup keeps the fact (it is history, never cleared).
    await db.query("update public.catering_payments set status = 'refunded' where id = $1", [mPaid]);
    check(String(await markerOf(mPaid)) === stamped, "P8 a later refund does not clear it");
    check((await mark(mPaid)).length === 0 && String(await markerOf(mPaid)) === stamped, "P8 …and does not let it be written again");
    // …and a refund of a paid row whose marker is NULL neither sets it nor loses the obligation.
    const O = await f.quote();
    const oPaid = await f.pay(O, "deposit", "paid", "cs_marker_owed");
    await db.query("update public.catering_payments set status = 'refunded' where id = $1 and status = 'paid'", [oPaid]);
    check((await markerOf(oPaid)) === null, "P8 (r8) a refund does not SET the marker: the cleanup is still owed on the refunded row");
    check((await mark(oPaid)).length === 1 && (await statusOf(oPaid)) === "refunded", "P8 (r8) …and the run that finishes it records it there");
    // The marker is no part of either unique index: a due intent may still open its checkout beside it.
    await db.query("update public.catering_payments set provider_session_id = 'cs_marker_bal' where id = $1 and status = 'due'", [mDue]);
    check(true, "P8 the marker does not interact with catering_payments_one_open_checkout / one_due");
  }

  // ── P2 — the rule ────────────────────────────────────────────────────────────────────────────
  await refuses(
    () => db.query("update public.catering_payments set provider = 'stripe', provider_session_id = 'cs_test_q1_full' where id = $1 and status = 'due'", [q1Full]),
    "catering_payments_one_open_checkout",
    "P2 a second due intent of the quote cannot ATTACH a session while the first holds one (UPDATE → 23505)");
  await refuses(
    () => db.query("update public.catering_payments set provider_session_id = 'x' where id = $1", [q1Full]),
    "23505",
    "P2 …and the error is a unique violation (the code the app reads as payment_in_progress)");
  check((await db.query("select provider_session_id from public.catering_payments where id = $1", [q1Full])).rows[0].provider_session_id === null,
    "P2 the refused attach wrote nothing");
  {
    const Q5 = await f.quote();
    await f.pay(Q5, "deposit", "due", "cs_test_q5_dep");
    await refuses(() => f.pay(Q5, "full", "due", "cs_test_q5_full"), "catering_payments_one_open_checkout",
      "P2 an INSERT of a second due intent already carrying a session is refused too");
  }

  // ── P3 — what stays allowed ──────────────────────────────────────────────────────────────────
  check((await db.query("select count(*)::int as n from public.catering_payments where quote_id = $1 and status = 'due'", [Q1])).rows[0].n === 2,
    "P3 a quote may hold a due deposit AND a due full — only one of them at Stripe");
  // The app's order: retire the other session (clear its id), THEN attach the new one.
  await db.query("update public.catering_payments set provider_session_id = null where id = $1 and status = 'due' and provider_session_id = 'cs_test_q1_dep'", [q1Deposit]);
  await db.query("update public.catering_payments set provider = 'stripe', provider_session_id = 'cs_test_q1_full' where id = $1 and status = 'due'", [q1Full]);
  check((await db.query("select provider_session_id from public.catering_payments where id = $1", [q1Full])).rows[0].provider_session_id === "cs_test_q1_full",
    "P3 retire-then-mint: after the first session is cleared, the second intent attaches its own");
  // Re-attaching a NEW session to the SAME row (a re-priced intent) is the row replacing itself.
  await db.query("update public.catering_payments set provider_session_id = 'cs_test_q1_full_2' where id = $1 and status = 'due'", [q1Full]);
  check(true, "P3 the same intent may replace its own session id (a re-priced intent)");
  // History beside a live checkout.
  const q2New = await f.pay(Q2, "full", "due", "cs_test_q2_new");
  check(!!q2New, "P3 a PAID row keeping its old session id does not block a new due checkout on the quote");
  const q3New = await f.pay(Q3, "balance", "due", "cs_test_q3_new");
  check(!!q3New, "P3 VOID and REFUNDED rows keeping their session ids do not block one either");
  // The moment a due row is paid it leaves the index, and the quote's next intent may go to Stripe.
  await db.query("update public.catering_payments set status = 'paid' where id = $1", [q2New]);
  await db.query("update public.catering_payments set provider_session_id = 'cs_test_q2_bal' where quote_id = $1 and kind = 'balance' and status = 'due'", [Q2]);
  check(true, "P3 once a checkout is PAID it leaves the index: the balance intent may then open its own");
  // Other quotes are independent.
  await f.pay(Q4, "deposit", "due", "cs_test_q4_dep");
  check((await db.query("select count(distinct quote_id)::int as n from public.catering_payments where status = 'due' and provider_session_id is not null")).rows[0].n >= 3,
    "P3 different quotes each hold their own open checkout");
  check((await db.query("select count(*)::int as n from (select quote_id from public.catering_payments where status = 'due' and provider_session_id is not null group by 1 having count(*) > 1) d")).rows[0].n === 0,
    "P3 …and no quote holds two");

  // ── P4 — 0130 is untouched ───────────────────────────────────────────────────────────────────
  await refuses(() => f.pay(Q4, "deposit", "due", null), "catering_payments_one_due", "P4 0130 still allows only one due intent per (quote, kind)");

  // ── P6 — the attach function (review r3) ─────────────────────────────────────────────────────
  {
    const attach = async (paymentId, quoteId, amount, session) =>
      (await db.query("select public.catering_payment_attach_checkout($1, $2, $3, $4) as out", [paymentId, quoteId, amount, session])).rows[0].out;
    const rowOf = async (id) => (await db.query("select status, provider, provider_session_id, quote_id, amount_cents from public.catering_payments where id = $1", [id])).rows[0];
    const untouched = async (fn, what) => { const before = await snapshot(db); const out = await fn(); check((await snapshot(db)) === before, `${what} — and wrote nothing`); return out; };

    // attached: a due intent with no session, on a quote with nothing paid and no other checkout.
    const A = await f.quote();
    const aDeposit = await f.pay(A, "deposit");
    const aFull = await f.pay(A, "full");
    check((await attach(aFull, A, 1000, "cs_fn_a_full")) === "attached", "P6 a due intent on a clean quote → attached");
    const afterAttach = await rowOf(aFull);
    check(afterAttach.provider === "stripe" && afterAttach.provider_session_id === "cs_fn_a_full" && afterAttach.status === "due",
      "P6 …provider = 'stripe' and the session id are on the row; it is still due");
    // in_progress: the intent already names a session.
    check((await untouched(() => attach(aFull, A, 1000, "cs_fn_a_full_2"), "P6 a second attach to the same intent")) === "in_progress",
      "P6 an intent that already holds a session → in_progress");
    // session_unresolved: ANOTHER due intent of the quote holds a session (never the index's 23505).
    check((await untouched(() => attach(aDeposit, A, 1000, "cs_fn_a_dep"), "P6 an attach beside another DUE intent's checkout")) === "session_unresolved",
      "P6 another DUE intent of the quote holds a session → session_unresolved (decided before the index is reached)");

    // session_unresolved: a VOID intent that still names a session — outside the index, inside the rule.
    const B = await f.quote();
    const bVoid = await f.pay(B, "deposit", "void", "cs_fn_b_void");
    const bFull = await f.pay(B, "full");
    check((await untouched(() => attach(bFull, B, 1000, "cs_fn_b_full"), "P6 an attach beside a VOID intent's unresolved checkout")) === "session_unresolved",
      "P6 a VOID intent that still names a session → session_unresolved (the index does not see it; the function does)");
    // …and once that session is confirmed retired (its id cleared), the replacement attaches.
    await db.query("update public.catering_payments set provider_session_id = null where id = $1", [bVoid]);
    check((await attach(bFull, B, 1000, "cs_fn_b_full")) === "attached", "P6 after the void row's session id is cleared (confirmed retired) → attached");

    // already_paid: any paid payment on the quote, whatever its kind.
    for (const paidKind of ["deposit", "full", "balance"]) {
      const C = await f.quote();
      await f.pay(C, paidKind, "paid", paidKind === "balance" ? null : `cs_fn_paid_${paidKind}`);
      const other = await f.pay(C, paidKind === "full" ? "deposit" : "full");
      check((await untouched(() => attach(other, C, 1000, `cs_fn_c_${paidKind}`), `P6 an attach beside a PAID ${paidKind}`)) === "already_paid",
        `P6 a PAID ${paidKind} on the quote → already_paid`);
    }
    // History does not block: a REFUNDED row (with its old session id) re-opens collection.
    const D = await f.quote();
    await f.pay(D, "deposit", "refunded", "cs_fn_d_history");
    const dFull = await f.pay(D, "full");
    check((await attach(dFull, D, 1000, "cs_fn_d_full")) === "attached", "P6 a REFUNDED row keeping its session id as history blocks nothing → attached");
    // A void row with NO session id blocks nothing either.
    const E = await f.quote();
    await f.pay(E, "deposit", "void", null);
    const eFull = await f.pay(E, "full");
    check((await attach(eFull, E, 1000, "cs_fn_e_full")) === "attached", "P6 a VOID row with no session id blocks nothing → attached");

    // not_due: the intent is paid, void, or does not exist.
    const G = await f.quote();
    const gVoid = await f.pay(G, "deposit", "void", null);
    check((await untouched(() => attach(gVoid, G, 1000, "cs_fn_g"), "P6 an attach to a VOID intent")) === "not_due", "P6 a void intent → not_due");
    check((await untouched(() => attach(randomUUID(), G, 1000, "cs_fn_g2"), "P6 an attach to an intent that does not exist")) === "not_due", "P6 an unknown intent → not_due");
    const H = await f.quote();
    const hPaid = await f.pay(H, "deposit", "paid", null);
    check((await untouched(() => attach(hPaid, H, 1000, "cs_fn_h"), "P6 an attach to a PAID intent")) === "not_due", "P6 a paid intent → not_due");

    // not_payable: another quote, another amount, a superseded quote, a quote that does not exist.
    const I = await f.quote(), J = await f.quote();
    const iFull = await f.pay(I, "full");
    check((await untouched(() => attach(iFull, J, 1000, "cs_fn_i"), "P6 an attach naming ANOTHER quote")) === "not_payable",
      "P6 the intent is on another quote (a revise moved it) → not_payable");
    check((await untouched(() => attach(iFull, I, 999, "cs_fn_i"), "P6 an attach at ANOTHER amount")) === "not_payable",
      "P6 the intent carries another amount (it was re-priced) → not_payable");
    check((await untouched(() => attach(iFull, randomUUID(), 1000, "cs_fn_i"), "P6 an attach naming a quote that does not exist")) === "not_payable",
      "P6 an unknown quote → not_payable");
    await db.query("update public.catering_quotes set superseded_at = now() where id = $1", [I]);
    check((await attach(iFull, I, 1000, "cs_fn_i")) === "not_payable", "P6 a SUPERSEDED quote → not_payable");
    check((await rowOf(iFull)).provider_session_id === null, "P6 …and nothing was attached to its intent");

    // Bad arguments raise (22023); they are never a quiet answer.
    await refuses(() => attach(null, I, 1000, "cs_x"), "invalid_arguments", "P6 a null payment id raises invalid_arguments");
    await refuses(() => attach(iFull, I, 1000, "   "), "invalid_arguments", "P6 a blank session id raises invalid_arguments");
    await refuses(() => attach(iFull, I, null, "cs_x"), "22023", "P6 …with errcode 22023");

    // THE CEILING, exercised: Postgres itself refuses the PostgREST roles; service_role is let through.
    const K = await f.quote();
    const kFull = await f.pay(K, "full");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await refuses(() => attach(kFull, K, 1000, "cs_fn_k"), "permission denied for function catering_payment_attach_checkout", `P6 ${role} cannot execute the function (42501)`);
      } finally {
        await db.exec("reset role");
      }
    }
    check((await rowOf(kFull)).provider_session_id === null, "P6 a refused role wrote nothing");
    await db.exec("set role service_role");
    try {
      check((await attach(kFull, K, 1000, "cs_fn_k")) === "attached", "P6 service_role may execute it → attached");
    } finally {
      await db.exec("reset role");
    }

    // The locks it takes, read from its own source: the quote row FOR UPDATE, then the quote's payment
    // rows FOR UPDATE, both BEFORE the first check that can answer already_paid / session_unresolved.
    const src = (await db.query("select prosrc from pg_proc where oid = $1::regprocedure", [FN])).rows[0].prosrc;
    const iQuoteLock = src.search(/from public\.catering_quotes q where q\.id = p_quote_id for update/);
    const iRowsLock = src.search(/from public\.catering_payments p where p\.quote_id = p_quote_id order by p\.id for update/);
    const iPaid = src.indexOf("return 'already_paid'");
    const iUnresolved = src.indexOf("return 'session_unresolved'");
    const iWrite = src.search(/update public\.catering_payments/);
    check(iQuoteLock >= 0 && iRowsLock > iQuoteLock, "P6 it locks the quote row FOR UPDATE, then every payment row of the quote FOR UPDATE");
    check(iPaid > iRowsLock && iUnresolved > iRowsLock && iWrite > iPaid && iWrite > iUnresolved,
      "P6 …and reads for a paid row and an unresolved checkout only AFTER both locks, and writes only after both reads");
  }

  // ── P5 — the documented rollback, in the documented order ────────────────────────────────────
  await db.exec("drop function public.catering_payment_checkout_ready();");
  check((await db.query("select to_regprocedure('public.catering_payment_checkout_ready()') is null as gone")).rows[0].gone === true,
    "P5 `drop function …checkout_ready` removes the readiness function FIRST (from here the app refuses every pay tap: 503)");
  await db.exec("drop function public.catering_payment_attach_checkout(uuid, uuid, integer, text);");
  check((await db.query("select to_regprocedure('public.catering_payment_attach_checkout(uuid,uuid,integer,text)') is null as gone")).rows[0].gone === true,
    "P5 `drop function …attach_checkout` removes the attach function (there is no other way to attach: the app does not fall back)");
  await db.exec("drop index public.catering_payments_one_open_checkout;");
  await db.query("update public.catering_payments set provider_session_id = 'cs_test_q1_dep_again' where id = $1 and status = 'due'", [q1Deposit]);
  check((await db.query("select count(*)::int as n from public.catering_payments where quote_id = $1 and status = 'due' and provider_session_id is not null", [Q1])).rows[0].n === 2,
    "P5 `drop index` removes the rule (nothing else changed)");
  await db.exec("alter table public.catering_payments drop column settlement_cleanup_at;");
  check(JSON.stringify(await columnsOf(db)) === columnsBefore, "P5 `drop column` restores the pre-0303 columns exactly");
  check(JSON.stringify(await indexNames(db)) === JSON.stringify(namesBefore), "P5 …and the pre-0303 indexes exactly");
} catch (e) {
  failures++;
  console.error(`FAIL 0303 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0303: ${checks} checks (single-session PGlite; the two-request race itself needs two sessions — sim)`);
