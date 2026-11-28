/**
 * Local Postgres proof of migration 0359 (catering refund Part B1, REDESIGN v2: the Stripe mirror). SYNTHETIC ROWS
 * ONLY: PGlite, in memory. CC owns the Supabase sim / prod gate; this never touches a real database, makes no network
 * call and holds no key.
 *
 *   node scripts/sql-harness-0359.mjs
 *
 * The base is scripts/sql-harness-0359-lib.mjs (the REAL DDL 0359 depends on, then the REAL 0357 -> 0358 -> 0359);
 * the scenario toolkit is scripts/sql-harness-0359-kit.mjs (time moves with elapse(), never by mocking the clock).
 * Every group below is named after the plan's test (PLAN-refundB1v2.md section 10's four "H" blocks and section 15.3),
 * tests the FINAL rule of section 15 where a ruling changed it, and runs on a FRESH database (a loaded copy of the base).
 * Output: `ok   <group> :: <check>` / `FAIL <group> :: <check>` per check, one `GROUP <name>` line per group, and the
 * totals on the last line. Exit code non-zero on any failure.
 *
 * Single session. PGlite is ONE connection: "exactly one wins" / "in both orders" are run in each order on fresh
 * databases; a real lock WAIT cannot be produced here, so the arm's budget is proven by its MEASUREMENT (a zero budget
 * is `deadline_passed`) and the lock order statically (tests/catering-refund-0359-migration.test.ts). The two-session
 * proof is scripts/sim/refund-0359-lock-check.mjs (sim only).
 *
 * FIXTURE WRITES (what the harness writes that no B1 function does, each stated where it is used): the fixture owner
 * inserts main's rows (payments, ledger rows, refund events), a 0357-era request row where a test needs one, moves a
 * single instant (`fx` single-column updates, `claimAgo`, `keepAlive` = "the sweep kept claiming on schedule"), and for two structurally
 * unreachable states (the insert race; a mirror row the token's read did not retrieve) builds them by hand.
 */
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { base, withPartsReady, M0359, one, rows, count, fingerprints } from "./sql-harness-0359-lib.mjs";
import {
  rpc, asService, world, ownerOf, refundOf, listsOf, begin, record, read, figures, elapse, ledger, observing,
  requestRow, stateRow, mirror,
} from "./sql-harness-0359-kit.mjs";

// ── The runner ──────────────────────────────────────────────────────────────────────────────────────────────────
// Groups are REGISTERED by group(); the dispatch at the end of the file runs them, in worker threads when more than
// one job is allowed (SQL_HARNESS_JOBS, default min(4, cpus - 1)): every group still has its OWN fresh database, and
// the output is printed in registration order. `--only <text>` runs the groups whose name contains it.
let buf = null;
const emit = (line, err = false) => { if (buf) buf.push([err, line]); else (err ? console.error : console.log)(line); };
let checks = 0;
let failures = 0;
let groupName = "";
const check = (ok, what) => {
  checks++;
  if (ok) emit(`ok   ${groupName} :: ${what}`);
  else { failures++; emit(`FAIL ${groupName} :: ${what}`, true); }
  return !!ok;
};
/** Canonical JSON: object keys sorted, bigint as text (so an answer's key order never decides a comparison). */
const js = (v) => JSON.stringify(v, (_, x) => {
  if (typeof x === "bigint") return x.toString();
  if (x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Date)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]));
  return x;
});
const eq = (got, want, what) => check(js(got) === js(want), js(got) === js(want) ? what : `${what} (got ${js(got)}, expected ${js(want)})`);
/** A named refusal RAISED as P0001 (F8, F12, F16): the message is the name. */
async function raises(fn, name, what) {
  try { await fn(); return check(false, `${what} -> ${name} (no error)`); }
  catch (e) {
    const ok = e.message === name && (e.code === "P0001" || e.code === undefined);
    return check(ok, ok ? `${what} -> ${name}` : `${what} -> ${name} (got ${e.code} ${e.message} ${e.detail ?? ""})`);
  }
}
/** Any error whose code / message / detail contains `needle`. */
async function refuses(fn, needle, what) {
  try { await fn(); return check(false, `${what} -> ${needle} (no error)`); }
  catch (e) {
    const s = `${e.code ?? ""} ${e.message} ${e.detail ?? ""}`;
    return check(s.includes(needle), s.includes(needle) ? `${what} -> ${needle}` : `${what} -> ${needle} (got: ${s})`);
  }
}

const SNAP = {};
const open = [];
/** A fresh database: a loaded copy of the base built once per level ("0358" or "0359"). */
async function fresh(upTo = "0359") {
  if (!SNAP[upTo]) {
    const db = await base({ upTo });
    SNAP[upTo] = await db.dumpDataDir("none");
    await db.close();
  }
  const db = new PGlite({ loadDataDir: SNAP[upTo] });
  await db.waitReady;
  open.push(db);
  return db;
}
const GROUPS = [];
function group(name, fn, opts = {}) { GROUPS.push({ name, fn, opts }); }
async function runGroup({ name, fn, opts: { upTo = "0359" } }) {
  groupName = name;
  buf = [];
  const c0 = checks;
  const f0 = failures;
  emit(`== ${name}`);
  const t0 = Date.now();
  try {
    const db = await fresh(upTo);
    await fn(db);
  } catch (e) {
    check(false, `threw: ${e.code ?? ""} ${e.message} ${e.detail ?? ""}
${e.stack}`);
  } finally {
    while (open.length) await open.pop().close().catch(() => {});
  }
  if (checks === c0) check(false, "ran no check");
  const n = checks - c0;
  const f = failures - f0;
  const ms = Date.now() - t0;
  if (f) emit(`FAIL GROUP ${name} (${n} checks, ${f} failed, ${ms} ms)`, true);
  else emit(`ok   GROUP ${name} (${n} checks, ${ms} ms)`);
  const lines = buf;
  buf = null;
  return { name, lines, checks: n, failures: f };
}

// ── Scenario helpers (harness-local; the kit is shared and left as it is) ─────────────────────────────────────────
const fx = async (db, sql, params = []) => {
  // Fixture owner, row triggers off (0357's guard): a stand-in for a state the test needs, stated where used.
  await db.exec("set session_replication_role = replica");
  try { return await db.query(sql, params); } finally { await db.exec("set session_replication_role = origin"); }
};
/** "The sweep kept claiming on schedule": its last claim 1 minute ago, no lease held. A claim that does not resume
 *  writes nothing else (F13), so this is exactly what 15-minute ticks leave behind. */
const keepAlive = (db) => fx(db, "update public.catering_refund_observation set last_claim_at = clock_timestamp() - interval '1 minute', lease_until = null");
/** The last claim exactly `interval` ago (liveness boundaries). */
const claimAgo = (db, interval) => fx(db, "update public.catering_refund_observation set last_claim_at = clock_timestamp() - $1::interval, lease_until = clock_timestamp() - $1::interval + interval '330 seconds'", [interval]);
const st = async (db, p) => (await figures(db, p.id ?? p)).state;
const nowEpoch = async (db) => Number((await one(db, "select extract(epoch from clock_timestamp())::float8 as e")).e);
const armedEpoch = async (db, id) => Number((await one(db, "select extract(epoch from create_armed_at)::float8 as e from public.catering_refund_requests where id = $1", [id])).e);
const auditCount = (db, action) => count(db, "select count(*) as n from public.audit_log where action = $1", [action]);
const reqCount = (db) => count(db, "select count(*) as n from public.catering_refund_requests");
const stateCount = (db) => count(db, "select count(*) as n from public.catering_refund_payment_state");
const kindsOf = async (db, p) => Object.fromEntries((await rows(db, "select refund_id, kind, attachable_to from public.catering_refund_claims($1)", [p.id])).map((r) => [r.refund_id, r.kind]));
const attachableOf = async (db, p) => Object.fromEntries((await rows(db, "select refund_id, attachable_to from public.catering_refund_claims($1)", [p.id])).map((r) => [r.refund_id, r.attachable_to]));
const dueNow = (db, limit = 50) => rpc(db, "catering_refund_sweep_due", [limit]);
const inventory = (db) => rpc(db, "catering_refund_inventory");
/** Refund objects as Stripe would hand them over AGAIN after time moved: `created` re-read from the mirror. */
async function current(db, refs) {
  const out = [];
  for (const r of refs) {
    const m = await one(db, "select extract(epoch from stripe_created_at)::bigint as c from public.catering_refund_observed where refund_id = $1", [r.id]);
    out.push(m ? { ...r, created: Number(m.c) } : r);
  }
  return out;
}

/** A shop, its owner, one quote with the payments named, observation live and settled, the B2 / B3 gate open. */
async function scene(db, { parts = true, observe = true, pays = [["full", 10000]] } = {}) {
  const w = await world(db);
  const owner = await w.user("owner", { member: null });
  const q = await w.quote();
  const list = [];
  for (const [kind, amount, opts] of pays) list.push(await w.pay(q, kind, amount, opts ?? {}));
  if (observe) await observing(db);
  if (parts) await withPartsReady(db);
  return { w, owner, q, pays: list, p: list[0] };
}
/** A second quote with one payment of its own (same shop). */
async function another(db, s, amount = 10000, opts = {}) {
  const q = await s.w.quote();
  const p = await s.w.pay(q, "full", amount, opts);
  return { q, p };
}

/** A press as the lib makes it, with the figure the person SAW read back from F3 after the reads. */
async function tap(db, { actor, quoteId, payments, amount = null, token = randomUUID(), readOptions = () => ({}), seen = null, reason = "customer_cancelled", note = null }) {
  const probe = await rpc(db, "catering_refund_reserve_fresh", [actor, quoteId, token, amount ?? 1, null, reason, note, "panel", null]);
  if (probe.replay) return { probe, replay: true, token, reserved: probe };
  const reads = [];
  for (const row of probe.payments) {
    const p = payments.find((x) => x.id === row.payment_id);
    reads.push({ payment_id: p.id, ...(await read(db, p, readOptions(p))) });
  }
  let total = 0;
  for (const r of reads) total += (await figures(db, r.payment_id)).refundable ?? 0;
  const reserved = await rpc(db, "catering_refund_reserve_fresh", [actor, quoteId, token, amount ?? total, seen ?? total, reason, note, "panel",
    JSON.stringify(reads.map((r) => ({ payment_id: r.payment_id, read_token: r.read_token ?? null })))]);
  return { probe, reads, reserved, token, total };
}
const arm = (db, req, wait = 5000) => rpc(db, "catering_refund_arm", [req.id, req.read_token, wait]);
const finish = (db, id, outcome, refund = null, code = null, msg = null) =>
  rpc(db, "catering_refund_finish", [id, outcome, refund == null ? null : JSON.stringify(refund), code, msg]);
const release = (db, actor, id, token, finding = "no_request", slot = "default", livemode = false, note = null) =>
  rpc(db, "catering_refund_release", [actor, id, token, finding, slot, livemode, note]);
const attach = (db, actor, id, refundId, token, note = null) => rpc(db, "catering_refund_attach", [actor, id, refundId, token, note]);
/** A create ANSWER (what F10 is handed) for request `req` on payment `p`. */
const answerOf = (p, reqId, amount, over = {}) => ({ id: `re_ans${randomUUID().slice(0, 8)}`, amount, currency: "usd", payment_intent: p.pi, charge: p.charge, status: "succeeded", request_id: reqId, ...over });

/** One payment, one quote, one ARMED request of `amount` (scene + tap + arm). */
async function armedScene(db, { amount = 1000, captured = 10000, scene: opts = {} } = {}) {
  const s = await scene(db, { pays: [["full", captured]], ...opts });
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount });
  const req = t.reserved.requests[0];
  const a = await arm(db, req);
  if (a.result !== "armed") throw new Error(`armedScene: arm answered ${js(a)}`);
  return { ...s, req, reqId: req.id, armed: a, armedEpoch: await armedEpoch(db, req.id) };
}
/** 24 hours and a minute pass with the sweep claiming on schedule; then a fresh complete read (known). */
async function after24h(db, p, refunds = []) {
  await elapse(db, "24 hours 1 minute");
  await keepAlive(db);
  return read(db, p, { refunds: await current(db, refunds) });
}
/** Settle: 5 minutes and a second pass (sweep on schedule), then a fresh complete read. */
async function settleAndRead(db, p, refunds = [], opts = {}) {
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  return read(db, p, { refunds: await current(db, refunds), ...opts });
}
const tableDigest = (db, t) => one(db, `select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as d from public.${t} x`);
const MAINS = ["catering_payments", "catering_payment_refund_events", "stripe_events", "users", "cron_route_leases"];

const PRIVATE = [
  "catering_refund_settle_interval()", "catering_refund_liveness_interval()", "catering_refund_fresh_interval()",
  "catering_refund_read_max_age()", "catering_refund_reread_interval()",
  "catering_refund_dirty_at(uuid)", "catering_refund_payment_figures(uuid)", "catering_refund_parts_ready()",
  "catering_refund_claims(uuid)", "catering_refund_answer_matches(uuid, jsonb)", "catering_refund_release_role(uuid, uuid)",
  "catering_refund_sweep_due(integer)", "catering_refund_observe_set(boolean)",
  "catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)", "catering_refund_claim(uuid)",
  "catering_refund_record_snapshot(uuid, timestamp with time zone, bigint, jsonb)", "catering_refund_requests_guard()"];
const WORKER = [
  "catering_refund_read_begin(uuid)", "catering_refund_record_read(uuid, uuid, text, jsonb, jsonb, jsonb)",
  "catering_refund_summary(uuid[])", "catering_refund_reserve_fresh(uuid, uuid, uuid, bigint, bigint, text, text, text, jsonb)",
  "catering_refund_arm(uuid, uuid, integer)", "catering_refund_finish(uuid, text, jsonb, text, text)",
  "catering_refund_cancel_unarmed(uuid, text)", "catering_refund_release(uuid, uuid, uuid, text, text, boolean, text)",
  "catering_refund_attach(uuid, uuid, text, uuid, text)", "catering_refund_sweep_begin(integer)",
  "catering_refund_sweep_end(uuid, integer, integer)", "catering_refund_inventory()",
  "catering_refund_actor_ok(uuid, uuid)", "catering_refund_figures(uuid)"];
const NEW_TABLES = ["catering_refund_observed", "catering_refund_payment_state", "catering_refund_observation"];

/** A 0357-era request row written by the fixture owner (0357's sender wrote these; nothing in v2 can). */
async function legacyRow(db, { p, quote, shop, by, status = "pending", attempts = 0, firstAttempt = null, updatedAgo = "1 hour",
  claimedUntil = null, refundId = null, amount = 1000, token = randomUUID() }) {
  return (await one(db, `insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents, reason_code,
      trigger_kind, requested_by, status, attempts, first_attempt_at, requested_at, updated_at, claimed_until, claim_token, stripe_refund_id)
    values ($1, $2, $3, $4, $5, 'customer_cancelled', 'panel', $6, $7, $8, case when $9::text is null then null else clock_timestamp() - $9::interval end,
            clock_timestamp() - $10::interval - interval '1 minute', clock_timestamp() - $10::interval,
            case when $11::text is null then null else clock_timestamp() + $11::interval end,
            case when $11::text is null then null else gen_random_uuid() end, $12) returning id`,
  [p.id, quote, shop, token, amount, by, status, attempts, firstAttempt, updatedAgo, claimedUntil, refundId])).id;
}
const tableExists = async (db, t) => (await one(db, "select to_regclass($1) is not null as x", [`public.${t}`])).x;
async function applyRefused(db, needle, what) {
  let err = null;
  try { await db.exec(M0359); } catch (e) { err = e; }
  try { await db.exec("rollback"); } catch { /* not in a transaction */ }
  const s = err ? `${err.code ?? ""} ${err.message}` : "(applied)";
  check(err && s.includes(needle), err && s.includes(needle) ? `${what} -> refused: ${needle}` : `${what} -> ${needle} (got: ${s})`);
  check(!(await tableExists(db, "catering_refund_observed")) && !(await tableExists(db, "catering_refund_payment_state"))
    && (await count(db, "select count(*) as n from pg_attribute where attrelid = 'public.catering_refund_requests'::regclass and attname = 'reserve_read_token' and not attisdropped")) === 0,
  `${what}: the refused apply left nothing (no new table, no new column)`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H — install and OFF
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
await group("install_shape", async (db) => {
  for (const t of NEW_TABLES) {
    check((await one(db, "select relrowsecurity as x from pg_class where oid = $1::regclass", [`public.${t}`])).x === true, `${t}: RLS on`);
    eq((await rows(db, "select polname::text as n, polcmd::text as c, pg_get_expr(polqual, polrelid) as q, pg_get_expr(polwithcheck, polrelid) as w from pg_policy where polrelid = $1::regclass order by polname", [`public.${t}`]))
      .map((r) => `${r.n}:${r.c}:${r.q ?? ""}:${r.w ?? ""}`),
    [`${t}_no_user_delete:d:false:`, `${t}_no_user_insert:a::false`, `${t}_no_user_select:r:false:`, `${t}_no_user_update:w:false:`], `${t}: exactly the four denials`);
    eq(await count(db, "select count(*) as n from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a where cl.oid = $1::regclass and a.grantee <> cl.relowner", [`public.${t}`]), 0, `${t}: no privilege for anyone but the owner`);
    for (const r of ["anon", "authenticated", "service_role"]) {
      check(!(await one(db, "select has_table_privilege($1, $2, 'SELECT') or has_table_privilege($1, $2, 'INSERT') or has_table_privilege($1, $2, 'UPDATE') or has_table_privilege($1, $2, 'DELETE') as x", [r, `public.${t}`])).x, `${t}: ${r} holds no table privilege`);
    }
  }
  const obs = await one(db, "select * from public.catering_refund_observation");
  check((await count(db, "select count(*) as n from public.catering_refund_observation")) === 1 && obs.id === true && obs.observe_on === false && Number(obs.transitions) === 0 && obs.last_claim_at === null,
    "the observation table holds exactly ONE row: OFF, 0 transitions, never claimed");
  const ix = await one(db, "select indexdef from pg_indexes where indexname = 'catering_refund_requests_one_unresolved'");
  check(/^CREATE UNIQUE INDEX catering_refund_requests_one_unresolved ON public\.catering_refund_requests USING btree \(payment_id\) WHERE \(status = 'pending'::text\)$/.test(ix?.indexdef ?? ""),
    `the one-unresolved index is UNIQUE on (payment_id) WHERE pending (${ix?.indexdef})`);
  eq((await rows(db, "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'catering_refund_requests' and column_name in ('create_armed_at','arm_payment_intent','arm_account_slot','arm_livemode','arm_credential_fp','reserve_read_token','resolved_by','resolved_at') order by 1")).map((r) => r.column_name),
    ["arm_account_slot", "arm_credential_fp", "arm_livemode", "arm_payment_intent", "create_armed_at", "reserve_read_token", "resolved_at", "resolved_by"], "requests gains the eight columns");
  const fam = await rows(db, `select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig, p.prosecdef, p.proconfig, p.oid,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as svc, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth, has_function_privilege('public', p.oid, 'EXECUTE') as pub
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'catering\\_refund\\_%' order by 1`);
  eq(fam.map((f) => f.sig).sort(), [...PRIVATE, ...WORKER].sort(), `the refund family is exactly ${PRIVATE.length} private + ${WORKER.length} worker functions`);
  for (const f of fam) {
    const worker = WORKER.includes(f.sig);
    check(f.svc === worker, `${f.sig}: service_role ${worker ? "may" : "may NOT"} execute`);
    check(!f.anon && !f.auth && !f.pub, `${f.sig}: anon / authenticated / PUBLIC may not execute`);
    const invoker = f.sig === "catering_refund_requests_guard()" || /_interval\(\)$/.test(f.sig) || f.sig === "catering_refund_read_max_age()";
    check(f.prosecdef === !invoker, `${f.sig}: ${invoker ? "SECURITY INVOKER" : "SECURITY DEFINER"}`);
    eq((f.proconfig ?? []).map((c) => c.replace(/ /g, "")), ["search_path=pg_catalog,public"], `${f.sig}: search_path pinned, nothing else`);
  }
  // The fingerprints: the guard's live body, computed here from the FILE text and from the live catalog, equals the two
  // values the file's own assertion block writes; 0358's actor rule is unchanged.
  const guardBody = M0359.match(/create or replace function public\.catering_refund_requests_guard\(\) returns trigger\nlanguage plpgsql set search_path = pg_catalog, public as \$\$([\s\S]*?)\$\$;/)[1];
  const { createHash } = await import("node:crypto");
  const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
  const house = md5(guardBody.replace(/[^\x21-\x7E]+/g, ""));
  const exact = md5(guardBody.replace(/\s*[\r\n]+\s*/g, "\n").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""));
  const live = await fingerprints(db, "catering_refund_requests_guard()");
  eq([live.house, live.exact], [house, exact], "the guard's live fingerprints are the file's body (house and exact)");
  check(M0359.includes(`<> '${house}'`) && M0359.includes(`<> '${exact}'`), "…and they are the two values the file's assertion block compares");
  eq((await fingerprints(db, "catering_refund_actor_ok(uuid, uuid)")).house, "4076029ec89d7b777af23ff3d8fcbdee", "0358's actor rule is unchanged");
  eq((await one(db, "select public.catering_refund_parts_ready() as x")).x, false, "the B2 / B3 gate answers false at install");
  eq(await count(db, "select count(*) as n from pg_trigger where tgrelid = 'public.catering_refund_requests'::regclass and not tgisinternal"), 1, "one user trigger on requests: 0357's guard, rebound to the re-emitted body");
});

await group("stale_sender_is_refused", async (db) => {
  const s = await scene(db, { observe: false, parts: false });
  const u = randomUUID();
  await asService(db, async () => {
    await refuses(() => db.query("select public.catering_refund_reserve($1, $2, $3, $4, $5, $6, $7)", [s.owner, s.q, u, 100, "other", "x", "panel"]), "42501", "as service_role: 0357's reserve");
    await refuses(() => db.query("select public.catering_refund_claim($1)", [u]), "42501", "as service_role: 0357's claim");
    await refuses(() => db.query("select public.catering_refund_record_snapshot($1, clock_timestamp(), 1, '[]'::jsonb)", [s.p.id]), "42501", "as service_role: 0357's snapshot writer");
    for (const col of ["status = 'failed'", "stripe_refund_id = null", "claimed_until = null", "updated_at = now()", "create_armed_at = now()"]) {
      await refuses(() => db.query(`update public.catering_refund_requests set ${col}`), "42501", `as service_role: a direct UPDATE (${col.split(" ")[0]})`);
    }
    await refuses(() => db.query("insert into public.catering_refund_observed (refund_id, payment_id, amount_cents, currency, stripe_created_at, read_started_at, recorded_at, charge_id) values ('re_x1', $1, 1, 'usd', now(), now(), now(), 'ch_x')", [s.p.id]), "42501", "as service_role: a direct write to the mirror");
    await refuses(() => db.query("update public.catering_refund_observation set observe_on = true"), "42501", "as service_role: a direct write to the observation row");
    eq(Number((await one(db, "select count(*) as n from public.catering_refund_requests")).n), 0, "control: service_role still READS the requests table");
    eq((await one(db, "select public.catering_refund_read_begin($1) as r", [randomUUID()])).r, { eligible: false }, "control: service_role executes a worker RPC");
  });
});

await group("operator_statement_is_owner_only", async (db) => {
  const s = await scene(db, { observe: false, parts: false });
  const u = randomUUID();
  const calls = [
    ["F17 catering_refund_observe_set(true)", "select public.catering_refund_observe_set(true)"],
    ["F2 catering_refund_dirty_at", `select public.catering_refund_dirty_at('${s.p.id}')`],
    ["F3 catering_refund_payment_figures", `select * from public.catering_refund_payment_figures('${s.p.id}')`],
    ["F4 catering_refund_parts_ready", "select public.catering_refund_parts_ready()"],
    ["F14 catering_refund_sweep_due", "select public.catering_refund_sweep_due(50)"],
    ["catering_refund_claims", `select * from public.catering_refund_claims('${s.p.id}')`],
    ["catering_refund_answer_matches", `select public.catering_refund_answer_matches('${u}', '{}'::jsonb)`],
    ["catering_refund_release_role", `select public.catering_refund_release_role('${s.owner}', '${s.w.shop}')`],
    ["the settle constant", "select public.catering_refund_settle_interval()"],
    ["the reread constant", "select public.catering_refund_reread_interval()"],
  ];
  for (const role of ["service_role", "authenticated", "anon"]) {
    await db.exec(`set role ${role}`);
    try { for (const [what, sql] of calls) await refuses(() => db.query(sql), "42501", `as ${role}: ${what}`); }
    finally { await db.exec("reset role"); }
  }
  eq((await one(db, "select current_user::text as u")).u, "postgres", "control: the session is the fixture owner again");
  const r = await rpc(db, "catering_refund_observe_set", [true]);
  check(r.observe_on === true && Number(r.transitions) === 1, "control: the OWNER runs the operator statement (ON recorded, 1 transition)");
});

await group("preflight_refusals", async (db) => {
  // A second apply, on the migrated base.
  let err = null;
  try { await db.exec(M0359); } catch (e) { err = e; }
  try { await db.exec("rollback"); } catch { /* */ }
  check(err && err.message === "0359: already applied", `a second apply is refused: ${err?.message}`);
  // Every other refusal on ONE 0358 database: a refused apply changes nothing (checked each time), so each stand-in is
  // made, refused by name, then undone before the next.
  const d = await fresh("0358");
  const EIGHT = "('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals')";
  const cases = [
    ["an old-0359 TABLE left", "create table public.catering_refund_epochs (id int)", "drop table public.catering_refund_epochs", "public.catering_refund_epochs exists (the old 0359 is installed"],
    ["another old-0359 TABLE left", "create table public.catering_refund_issues (id int)", "drop table public.catering_refund_issues", "public.catering_refund_issues exists"],
    ["an old-0359 COLUMN left", "alter table public.catering_refund_requests add column reconcile_seq bigint", "alter table public.catering_refund_requests drop column reconcile_seq", "catering_refund_requests.reconcile_seq already exists"],
    ["a kept column name already present (a partial 0359)", "alter table public.catering_refund_requests add column create_armed_at timestamptz", "alter table public.catering_refund_requests drop column create_armed_at", "catering_refund_requests.create_armed_at already exists"],
    ["an old-0359 FUNCTION left", "create function public.catering_refund_apply() returns int language sql as $$ select 1 $$", "drop function public.catering_refund_apply()", "refund functions that are not 0357's exist (catering_refund_apply()"],
    ["an old SIGNATURE of a reused name", "create function public.catering_refund_arm(p uuid) returns int language sql as $$ select 1 $$", "drop function public.catering_refund_arm(uuid)", "refund functions that are not 0357's exist (catering_refund_arm(uuid)"],
    ["an old-0359 cron NAME (a ninth job in the CHECK)",
      `alter table public.cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals','catering-refund-sweep'))`,
      `alter table public.cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ${EIGHT})`,
      "cron_route_leases_job_check is not the 0343 eight-job union"],
    // A sim reset that restored the CHECK but left the row: a VALIDATED check cannot hold that row, so the stand-in
    // re-adds the eight-name check NOT VALID and marks it validated by hand (the refusal is defence in depth, by name).
    ["a catering-refund-sweep lease row",
      `alter table public.cron_route_leases drop constraint cron_route_leases_job_check;
       insert into public.cron_route_leases (job, lease_until) values ('catering-refund-sweep', now());
       alter table public.cron_route_leases add constraint cron_route_leases_job_check check (job in ${EIGHT}) not valid;
       update pg_constraint set convalidated = true where conname = 'cron_route_leases_job_check'`,
      `delete from public.cron_route_leases where job = 'catering-refund-sweep';
       alter table public.cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ${EIGHT})`,
      "a catering-refund-sweep lease row exists"],
  ];
  for (const [what, make, undo, needle] of cases) {
    await d.exec(make);
    await applyRefused(d, needle, what);
    await d.exec(undo);
  }
  // Rows: a live claim; a pending (or submitted) row touched in the last 15 minutes; two pending rows on one payment;
  // an attempted row whose payment has no PaymentIntent.
  const w = await world(d);
  const o = await w.user("owner", { member: null });
  const q = await w.quote();
  const p = await w.pay(q, "full", 10000);
  const bad = await w.pay(q, "full", 5000, { pi: "cs_test_session_only" });
  const rowCases = [
    ["a live 0357 claim", () => legacyRow(d, { p, quote: q, shop: w.shop, by: o, attempts: 1, firstAttempt: "1 minute", updatedAgo: "1 hour", claimedUntil: "2 minutes" }), "a live refund claim exists"],
    ["a pending row touched in the last 15 minutes", () => legacyRow(d, { p, quote: q, shop: w.shop, by: o, updatedAgo: "14 minutes" }), "changed in the last 15 minutes"],
    ["a SUBMITTED row touched in the last 15 minutes", () => legacyRow(d, { p, quote: q, shop: w.shop, by: o, status: "submitted", refundId: "re_sub1", updatedAgo: "1 minute" }), "changed in the last 15 minutes"],
    ["two pending rows on one payment", async () => { await legacyRow(d, { p, quote: q, shop: w.shop, by: o }); await legacyRow(d, { p, quote: q, shop: w.shop, by: o }); }, "more than one pending refund request on one payment"],
    ["an attempted row whose payment has no PI-shaped provider_ref", () => legacyRow(d, { p: bad, quote: q, shop: w.shop, by: o, status: "failed", attempts: 1, firstAttempt: "2 hours", updatedAgo: "2 hours" }),
      "an attempted refund request whose payment has no PaymentIntent"],
  ];
  for (const [what, make, needle] of rowCases) {
    await make();
    await applyRefused(d, needle, what);
    await d.exec("delete from public.catering_refund_requests");
  }
  // Control: the same database, with ONE old, quiet pending row, applies.
  await legacyRow(d, { p, quote: q, shop: w.shop, by: o, updatedAgo: "16 minutes" });
  await d.exec(M0359);
  check(await tableExists(d, "catering_refund_observed"), "control: the same database with one quiet pending row (16 minutes old) applies");
  // A dependency missing (last: it cannot be undone cheaply).
  const d2 = await fresh("0358");
  await d2.exec("alter table public.stripe_events drop column received_at cascade");
  await applyRefused(d2, "public.stripe_events.received_at is missing", "a dependency column missing");
});

await group("legacy_attempted_rows_are_armed", async (db) => {
  const w = await world(db);
  const o = await w.user("owner", { member: null });
  const q = await w.quote();
  const p = await w.pay(q, "full", 10000);
  const id = await legacyRow(db, { p, quote: q, shop: w.shop, by: o, attempts: 1, firstAttempt: "1 hour", updatedAgo: "1 hour", claimedUntil: "-57 minutes" });
  const before = await requestRow(db, id);
  await db.exec(M0359);
  const r = await requestRow(db, id);
  check(r.create_armed_at && +r.create_armed_at === +before.first_attempt_at, "the backfill arms it at its first attempt (possibly sent)");
  eq(r.arm_payment_intent, p.pi, "…with its payment's PaymentIntent");
  check(r.arm_credential_fp === null && r.arm_account_slot === null && r.arm_livemode === null, "…and no credential (nothing to prove which key sent it)");
  eq(r.status, "pending", "it stays reserved");
  await observing(db);
  const a = await rpc(db, "catering_refund_arm", [id, randomUUID(), 5000]);
  check(a.result === "not_armable" && a.armed === true && a.status === "pending", `F9 never arms it again: ${js(a)}`);
  const inv = await inventory(db);
  check(inv.counts.legacy_attempted === 1 && inv.counts.unconfirmed === 1 && inv.lists.unresolved_requests[0]?.legacy === true, "the inventory counts it as a legacy attempted (unconfirmed) row");
  const due = await dueNow(db);
  check(due.a.includes(p.id), "the sweep looks for it every run (class A)");
  // A person cannot release or attach it: no fingerprint at arm [T5].
  await elapse(db, "23 hours 1 minute");
  await keepAlive(db);
  const rd = await read(db, p);
  eq([rd.result, await st(db, p)], ["complete", "known"], "a fresh complete read 24 h after the attempt: known");
  await raises(() => release(db, o, id, rd.read_token), "credential_changed", "release of a backfilled row");
  await raises(() => attach(db, o, id, "re_anything1", rd.read_token), "credential_changed", "attach of a backfilled row");
  // …but a read binds it by its metadata.
  const R = refundOf(p, 1000, { request: id, created: Math.ceil(await armedEpoch(db, id)) + 1 });
  const b = await read(db, p, { refunds: [R] });
  eq(b.bound, [{ request_id: id, refund_id: R.id }], "a later complete read binds it by metadata");
  const r2 = await requestRow(db, id);
  eq([r2.status, r2.stripe_refund_id], ["submitted", R.id], "the row is submitted with that refund");
}, { upTo: "0358" });

await group("mains_tables_carry_only_the_named_foreign_keys", async (db) => {
  const T = "('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass, 'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)";
  const shape = async () => ({
    triggers: (await rows(db, `select tgrelid::regclass::text || ':' || tgname || ':' || tgtype::text || ':' || tgfoid::regproc::text || ':' || tgenabled::text as e from pg_trigger where tgrelid in ${T} and not tgisinternal order by 1`)).map((r) => r.e),
    indexes: (await rows(db, `select pg_get_indexdef(indexrelid) as e from pg_index where indrelid in ${T} order by 1`)).map((r) => r.e),
    constraints: (await rows(db, `select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) as e from pg_constraint where conrelid in ${T} order by 1`)).map((r) => r.e),
    internal: (await rows(db, `select oid::text as e from pg_trigger where tgrelid in ${T} and tgisinternal order by 1`)).map((r) => r.e),
    referencing: (await rows(db, `select conname::text as e from pg_constraint where contype = 'f' and confrelid in ${T} order by 1`)).map((r) => r.e),
  });
  const before = await shape();
  await db.exec(M0359);
  const after = await shape();
  eq(after.triggers, before.triggers, "user triggers on the five tables: identical before / after");
  eq(after.indexes, before.indexes, "indexes on the five tables: identical");
  eq(after.constraints, before.constraints, "every constraint ON the five tables (CHECK / UNIQUE / PK / their own FKs): identical");
  const newRefs = after.referencing.filter((n) => !before.referencing.includes(n)).sort();
  eq(newRefs, ["catering_refund_observed_payment_fk", "catering_refund_payment_state_payment_fk", "catering_refund_requests_resolved_by_fk"], "the only new objects naming them are the three named foreign keys");
  for (const n of newRefs) {
    const k = await one(db, "select confdeltype, confupdtype, confrelid::regclass::text as t from pg_constraint where conname = $1", [n]);
    eq([k.confdeltype, k.confupdtype], ["a", "a"], `${n} -> ${k.t}: NO ACTION on delete and update`);
  }
  const newInternal = await rows(db, `select tg.oid::text as oid, k.conname::text as c from pg_trigger tg left join pg_constraint k on k.oid = tg.tgconstraint where tg.tgrelid in ${T} and tg.tgisinternal and not (tg.oid::text = any($1::text[]))`, [before.internal]);
  eq(newInternal.map((r) => r.c).sort(), ["catering_refund_observed_payment_fk", "catering_refund_observed_payment_fk", "catering_refund_payment_state_payment_fk", "catering_refund_payment_state_payment_fk",
    "catering_refund_requests_resolved_by_fk", "catering_refund_requests_resolved_by_fk"], "the new internal triggers are exactly the RI triggers of those three constraints (two each)");
}, { upTo: "0358" });

await group("mains_payment_writes_are_unchanged_by_the_foreign_keys", async (db59) => {
  const db58 = await fresh("0358");
  const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const L = ID(1), U = ID(2), Q = ID(3), P = ID(10), N = ID(11), X = ID(12), P2 = ID(13), RQ = ID(14), PR = ID(15);
  const fixture = `insert into public.locations (id, code) values ('${L}', 'S1');
    insert into public.users (id, role) values ('${U}', 'owner');
    insert into public.catering_quotes (id, location_id, version, status) values ('${Q}', '${L}', 1, 'accepted');
    insert into public.catering_payments (id, quote_id, kind, amount_cents, status, provider, provider_ref, paid_at) values
      ('${P}', '${Q}', 'deposit', 10000, 'paid', 'stripe', 'pi_mainP1', '2026-11-01T10:00:00Z'),
      ('${P2}', '${Q}', 'balance', 4000, 'paid', 'stripe', 'pi_mainP2', '2026-11-01T11:00:00Z'),
      ('${PR}', '${Q}', 'full', 3000, 'paid', 'stripe', 'pi_mainPR', '2026-11-01T12:00:00Z');
    insert into public.catering_refund_requests (id, payment_id, quote_id, location_id, client_token, amount_cents, reason_code, trigger_kind, requested_by, status, requested_at, updated_at)
      values ('${RQ}', '${PR}', '${Q}', '${L}', gen_random_uuid(), 100, 'customer_cancelled', 'panel', '${U}', 'failed', now() - interval '2 days', now() - interval '2 days');`;
  // (the 0357 request row on PR: a payment 0357 already protects from DELETE)
  for (const d of [db58, db59]) await d.exec(fixture);
  // On 0359 only: B1 has mirrored P (a state row and a mirror row) and holds a state row for P2.
  await observing(db59);
  const p = { id: P, pi: "pi_mainP1", charge: "ch_mainP1", amount: 10000 };
  const rr = await read(db59, p, { refunds: [refundOf(p, 500)] });
  check(rr.result === "complete" && (await mirror(db59, P)).length === 1, "0359 side: B1 has mirrored P (state row + mirror row)");
  check((await begin(db59, P2)).eligible === true, "0359 side: B1 holds a state row for P2");
  const script = [
    ["insert a due row", `insert into public.catering_payments (id, quote_id, kind, amount_cents, status) values ('${N}', '${Q}', 'balance', 500, 'due')`],
    ["due -> paid with provider_ref", `update public.catering_payments set status = 'paid', provider = 'stripe', provider_ref = 'pi_mainN', paid_at = '2026-11-02T00:00:00Z' where id = '${N}' and status = 'due'`],
    ["set provider_session_id", `update public.catering_payments set provider_session_id = 'cs_mainN' where id = '${N}'`],
    ["clear provider_session_id", `update public.catering_payments set provider_session_id = null where id = '${N}'`],
    ["paid -> refunded on the MIRRORED payment", `update public.catering_payments set status = 'refunded' where id = '${P}' and status = 'paid'`],
    ["-> void", `update public.catering_payments set status = 'void' where id = '${N}'`],
    ["an amount edit on the mirrored payment", `update public.catering_payments set amount_cents = 9000 where id = '${P}'`],
    ["a refund-event insert on the mirrored payment", `insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents) values ('evt_main1', '${P}', '2026-11-03T00:00:00Z', 1000)`],
    ["insert a payment nothing references", `insert into public.catering_payments (id, quote_id, kind, amount_cents, status) values ('${X}', '${Q}', 'full', 100, 'due')`],
    ["DELETE of a payment nothing references", `delete from public.catering_payments where id = '${X}'`],
    ["DELETE of a payment with a 0357 request (refused on both)", `delete from public.catering_payments where id = '${PR}'`],
  ];
  const run = async (d, sql) => { try { const r = await d.query(sql); return `ok:${r.affectedRows}`; } catch (e) { return `err:${e.code}`; } };
  for (const [what, sql] of script) {
    const a = await run(db58, sql);
    const b = await run(db59, sql);
    eq(b, a, `${what}: the same outcome before and after 0359 (${a})`);
  }
  const state = (d) => rows(d, "select id, quote_id, kind, amount_cents, currency, status, provider, provider_ref, paid_at, provider_session_id, settlement_cleanup_at from public.catering_payments order by id");
  eq(await state(db59), await state(db58), "the resulting payment rows are identical");
  const ev = (d) => rows(d, "select stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents, refunded_at_approximate from public.catering_payment_refund_events order by 1");
  eq(await ev(db59), await ev(db58), "the resulting refund-event rows are identical");
  // The one stated difference.
  eq(await run(db58, `delete from public.catering_payments where id = '${P2}'`), "ok:1", "before 0359: DELETE of P2 (nothing references it) succeeds");
  eq(await run(db59, `delete from public.catering_payments where id = '${P2}'`), "err:23503", "after 0359: DELETE of a payment B1 holds a row for is refused 23503 (the one stated difference)");
});

await group("cron_lease_objects_are_untouched", async (db) => {
  const shape = async () => ({
    check: (await one(db, "select pg_get_constraintdef(oid) as d, convalidated from pg_constraint where conname = 'cron_route_leases_job_check'")),
    fn: (await one(db, "select prosrc, proacl::text as acl, proconfig::text as cfg, prosecdef from pg_proc where oid = 'public.claim_cron_route(text)'::regprocedure")),
    fp: await fingerprints(db, "claim_cron_route(text)"),
    rows: await rows(db, "select * from public.cron_route_leases order by job"),
    tacl: (await one(db, "select relacl::text as a from pg_class where oid = 'public.cron_route_leases'::regclass")).a,
  });
  const before = await shape();
  await db.exec(M0359);
  const after = await shape();
  eq(after.check, before.check, "the CHECK (its eight names) is byte-identical before / after");
  eq(after.fn, before.fn, "claim_cron_route's body, ACL, settings and mode are byte-identical");
  eq(after.fp, before.fp, "…and so are its two fingerprints");
  eq([after.rows, after.tacl], [before.rows, before.tacl], "no lease row and no privilege moved");
  await refuses(() => db.query("select public.claim_cron_route('catering-refund-sweep')"), "invalid_cron_route", "claim_cron_route('catering-refund-sweep')");
  eq(await count(db, "select count(*) as n from public.cron_route_leases"), 0, "…and it wrote no lease row");
}, { upTo: "0358" });

await group("mains_ledger_insert_is_untouched", async (db59) => {
  const db58 = await fresh("0358");
  const big = "x".repeat(2 * 1024 * 1024);
  const s = await scene(db59, { parts: false });
  await read(db59, s.p);
  eq(await st(db59, s.p), "known", "0359 side: a known payment");
  const payload = (pi, ch) => JSON.stringify({ id: "evt_big", type: "charge.refunded", data: { object: { id: ch, object: "charge",
    payment_intent: { id: pi, object: "payment_intent", description: big }, charge: { id: ch, object: "charge", description: big } } } });
  const ins = async (d, pi, ch) => { try { await d.query("insert into public.stripe_events (id, type, livemode, payload) values ('evt_big', 'charge.refunded', false, $1)", [payload(pi, ch)]); return "ok"; } catch (e) { return `err:${e.code} ${e.message}`; } };
  eq(await ins(db58, "pi_other_x", "ch_other_x"), "ok", "before 0359: a 4 MB ledger row (2 MB expanded payment_intent and charge) inserts");
  eq(await ins(db59, s.p.pi, s.p.charge), "ok", "after 0359: the same insert succeeds (no trigger, no index, no constraint added)");
  const len = (d) => one(d, "select octet_length(payload::text) as n from public.stripe_events where id = 'evt_big'");
  check(Number((await len(db59)).n) > 4 * 1024 * 1024, "…and the stored payload is whole");
  eq(await st(db59, s.p), "dirty", "the huge object naming the payment dirties it, and nothing raised (F2 on an expanded PaymentIntent)");
  check(Array.isArray((await dueNow(db59)).a), "F14 reads the same row without raising");
});

await group("b1_never_writes_mains_tables", async (db) => {
  // Setup (main's own rows and the fixture's, BEFORE the first digest): shops, people, three quotes, payments, the
  // ledger row that proves coverage, observation ON and live, the B2 / B3 gate.
  const s = await scene(db, { pays: [["full", 10000]] });
  const b = await another(db, s, 10000);
  const c = await another(db, s, 10000);
  const before = {};
  for (const t of MAINS) before[t] = await tableDigest(db, t);
  // EVERY 0359 function, at least once (comment = the list):
  //   F2 dirty_at, F3 payment_figures, F4 parts_ready, F5 read_begin, F6 record_read, F7 summary, F8 reserve_fresh
  //   (probe + reserve), F9 arm, F10 finish, F11 cancel_unarmed, F12 release, F13 sweep_begin, F14 sweep_due,
  //   F15 inventory, F16 attach, F17 observe_set, F18 sweep_end; helpers claims, answer_matches, release_role; the
  //   five constants; F1 (the guard) fires on every request UPDATE above.
  // Time moves only by single-column backdates of B1's own rows and the requests table (elapse() would move the ledger).
  const t1 = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const r1 = t1.reserved.requests[0];
  check((await arm(db, r1)).result === "armed", "F9 arm");
  check((await finish(db, r1.id, "unconfirmed", null, "timeout", "x")).result === "unconfirmed", "F10 finish (unconfirmed)");
  await fx(db, "update public.catering_refund_requests set create_armed_at = create_armed_at - interval '25 hours' where id = $1", [r1.id]);
  await fx(db, "update public.catering_refund_payment_state set dirty_since = dirty_since - interval '25 hours' where payment_id = $1", [s.p.id]);
  const rd1 = await read(db, s.p);
  check(rd1.result === "complete" && (await st(db, s.p)) === "known", "F5 + F6 read (known)");
  check((await release(db, s.owner, r1.id, rd1.read_token)).result === "released", "F12 release");
  const t2 = await tap(db, { actor: s.owner, quoteId: b.q, payments: [b.p], amount: 1000 });
  const r2 = t2.reserved.requests[0];
  check((await arm(db, r2)).result === "armed", "F9 arm (second)");
  await fx(db, "update public.catering_refund_payment_state set dirty_since = dirty_since - interval '6 minutes' where payment_id = $1", [b.p.id]);
  const R = refundOf(b.p, 1000, { created: Math.ceil(await armedEpoch(db, r2.id)) + 1 });
  const rd2 = await read(db, b.p, { refunds: [R] });
  check(rd2.result === "complete", "F6 mirrors a refund");
  check((await attach(db, s.owner, r2.id, R.id, rd2.read_token)).result === "attached", "F16 attach");
  check((await finish(db, r2.id, "created", answerOf(b.p, r2.id, 1000, { id: R.id }))).result === "created", "F10 finish (created, already bound)");
  const t3 = await tap(db, { actor: s.owner, quoteId: c.q, payments: [c.p], amount: 500 });
  check((await rpc(db, "catering_refund_cancel_unarmed", [t3.reserved.requests[0].id, "test"])).result === "cancelled", "F11 cancel_unarmed");
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  const sb = await rpc(db, "catering_refund_sweep_begin", [50]);
  check(sb.claimed === true, "F13 sweep_begin (+ F14 inside)");
  check((await rpc(db, "catering_refund_sweep_end", [sb.claim_id, 1, 1])).result === "ended", "F18 sweep_end");
  check(Array.isArray((await rpc(db, "catering_refund_summary", [[s.q, b.q, c.q]])).quotes), "F7 summary");
  check(typeof (await inventory(db)).counts === "object", "F15 inventory");
  check(Array.isArray((await dueNow(db)).a), "F14 sweep_due");
  await one(db, "select public.catering_refund_dirty_at($1) as x", [s.p.id]);
  await figures(db, s.p.id);
  await one(db, "select public.catering_refund_parts_ready() as x");
  await rows(db, "select * from public.catering_refund_claims($1)", [b.p.id]);
  await one(db, "select public.catering_refund_answer_matches($1, $2) as x", [r2.id, JSON.stringify(answerOf(b.p, r2.id, 1000))]);
  await one(db, "select public.catering_refund_release_role($1, $2) as x", [s.owner, s.w.shop]);
  await one(db, `select public.catering_refund_settle_interval(), public.catering_refund_liveness_interval(), public.catering_refund_fresh_interval(),
    public.catering_refund_read_max_age(), public.catering_refund_reread_interval()`);
  check((await rpc(db, "catering_refund_observe_set", [true])).observe_on === true, "F17 observe_set(true)");
  check((await rpc(db, "catering_refund_observe_set", [false])).observe_on === false, "F17 observe_set(false)");
  for (const t of MAINS) eq(await tableDigest(db, t), before[t], `${t}: row digest identical before and after every function ran`);
  check((await auditCount(db, "catering.refund.request")) === 3 && (await auditCount(db, "catering.refund.release")) === 1 && (await auditCount(db, "catering.refund.attach")) === 1,
    "the audit_log APPENDS are the named ones (T7: permitted, not in the digest)");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H — reads, dirty, known
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
await group("read_begin_opens_the_read_with_the_databases_clock_and_no_token", async (db) => {
  const s = await scene(db, { parts: false });
  const t0 = (await one(db, "select clock_timestamp()::text as t")).t;
  const b = await begin(db, s.p.id);
  const t1 = (await one(db, "select clock_timestamp()::text as t")).t;
  check(b.eligible === true && /^[0-9a-f-]{36}$/.test(b.read_id), "it opens a read with a database-made id");
  check(!Object.keys(b).some((k) => /token/.test(k)), `it returns no token (keys: ${Object.keys(b).sort().join(", ")})`);
  check((await one(db, "select $1::timestamptz between $2::timestamptz and $3::timestamptz as x", [b.started_at, t0, t1])).x, "its start is the database clock, taken inside the call");
  const row = await stateRow(db, s.p.id);
  check(row.open_read_id === b.read_id && (await one(db, "select open_read_started_at = $2::timestamptz as x from public.catering_refund_payment_state where payment_id = $1", [s.p.id, b.started_at])).x,
    "the state row holds the open read: its id and its start");
  eq(Number(row.open_read_transitions), Number((await one(db, "select transitions from public.catering_refund_observation")).transitions), "…and the transition count it was begun under");
  check(row.last_complete_read_token === null && row.payment_intent_id === null && row.captured_cents === null && row.last_complete_read_started_at === null,
    "a first call creates the row with every complete-read column null [R13]");
  eq([b.payment_intent, b.mirrored_ids, b.request_refund_ids, b.quote_id, b.location_id], [s.p.pi, [], [], s.q, s.w.shop], "it returns the PaymentIntent, the ids to retrieve, the quote and the shop");
  eq((await one(db, "select pronargs, oidvectortypes(proargtypes) as t from pg_proc where oid = 'public.catering_refund_read_begin(uuid)'::regprocedure")), { pronargs: 1, t: "uuid" }, "it takes no time (and nothing else) from the caller: one argument, the payment");
  const b2 = await begin(db, s.p.id);
  check((await one(db, "select $1::timestamptz > $2::timestamptz as x", [b2.started_at, b.started_at])).x && b2.replaced === true, "a second begin starts strictly later and says it replaced the open read");
});

await group("only_the_open_read_can_record", async (db) => {
  const s = await scene(db, { parts: false });
  const R = refundOf(s.p, 100);
  const A = await begin(db, s.p.id);
  const B = await begin(db, s.p.id);
  const ra = await record(db, s.p.id, A.read_id, { owner: ownerOf(s.p), lists: listsOf([R]), refunds: [R] });
  eq(ra.result, "read_replaced", "the replaced read's record answers read_replaced");
  eq((await mirror(db, s.p.id)).length, 0, "…and writes no mirror row");
  const row = await stateRow(db, s.p.id);
  check(row.open_read_id === B.read_id, "…and does not touch the slot (B's read is still the open one)");
  check(row.dirty_since !== null && row.last_attempt_result === "read_replaced", "…and (T2, final rule) stamps the payment dirty with the reason");
  const rb = await record(db, s.p.id, B.read_id, { owner: ownerOf(s.p), lists: listsOf([R]), refunds: [R] });
  eq(rb.result, "complete", "the open read records");
  const m1 = await mirror(db, s.p.id);
  const rb2 = await record(db, s.p.id, B.read_id, { owner: ownerOf(s.p), lists: listsOf([R]), refunds: [R] });
  eq(rb2.result, "read_replaced", "a record repeated with the same id is read_replaced");
  eq(await mirror(db, s.p.id), m1, "…and the mirror row is untouched by it");
  eq((await record(db, s.p.id, randomUUID(), { owner: ownerOf(s.p), lists: listsOf([R]), refunds: [R] })).result, "read_replaced", "an id never issued is read_replaced");
  eq((await record(db, (await another(db, s)).p.id, randomUUID(), {})).result, "read_replaced", "a record for a payment with no state row is read_replaced, and creates none");
  await refuses(() => record(db, s.p.id, null, {}), "invalid_request", "a null read id is the one raise (invalid_request)");
});

await group("a_read_opened_and_never_recorded_takes_the_figures_away_after_15_minutes", async (db) => {
  const s = await scene(db, { parts: false });
  eq((await read(db, s.p)).result, "complete", "a complete read");
  eq(await st(db, s.p), "known", "known");
  await begin(db, s.p.id);
  eq(await st(db, s.p), "known", "a read is opened and never recorded: still known at once");
  await elapse(db, "14 minutes 59 seconds");
  eq(await st(db, s.p), "known", "still known at 14:59");
  await elapse(db, "2 seconds");
  eq(await st(db, s.p), "dirty", "dirty at 15:01");
  check((await one(db, "select public.catering_refund_dirty_at($1) = open_read_started_at as x from public.catering_refund_payment_state where payment_id = $1", [s.p.id])).x, "…the dirty instant is the abandoned read's start");
  const old = (await stateRow(db, s.p.id)).open_read_started_at;
  const b2 = await begin(db, s.p.id);
  const row = await stateRow(db, s.p.id);
  check(row.dirty_since !== null && +row.dirty_since >= +old, "the next begin keeps the mark (a durable dirty stamp, before the slot is reused)");
  eq(await st(db, s.p), "dirty", "…still dirty");
  eq((await record(db, s.p.id, b2.read_id, { owner: ownerOf(s.p), lists: listsOf([]), refunds: [] })).result, "complete", "that read records complete…");
  eq(await st(db, s.p), "dirty", "…and is not known by itself (it began at the mark)");
  await elapse(db, "5 minutes 1 second");
  eq((await read(db, s.p)).result, "complete", "a complete read 5 minutes after the mark");
  eq(await st(db, s.p), "known", "known again");
});

await group("read_too_old_is_recorded_as_not_complete", async (db) => {
  const s = await scene(db, { parts: false });
  const b = await begin(db, s.p.id);
  await elapse(db, "16 minutes");
  const r = await record(db, s.p.id, b.read_id, { owner: ownerOf(s.p), lists: listsOf([]), refunds: [] });
  eq([r.result, r.reason], ["not_complete", "read_too_old"], "a record 16 minutes after its begin: not_complete, read_too_old");
  const row = await stateRow(db, s.p.id);
  check(row.open_read_id === null && row.open_read_started_at === null && row.open_read_transitions === null, "the slot is closed");
  check(row.dirty_since !== null && row.last_attempt_result === "read_too_old" && row.last_complete_read_token === null, "dirty, the reason recorded, no complete stamp");
  const inv = await inventory(db);
  check(inv.not_complete_by_reason.read_too_old === 1 && inv.lists.not_complete.some((x) => x.payment_id === s.p.id && x.reason === "read_too_old"), "the inventory lists it by reason");
});

await group("complete_read_makes_a_never_read_payment_known_after_the_settle_interval", async (db) => {
  const w = await world(db);
  const q = await w.quote();
  const p = await w.pay(q, "full", 10000);
  await ledger(db, { type: "ping", ago: "30 days" });
  await rpc(db, "catering_refund_observe_set", [true]);
  await rpc(db, "catering_refund_sweep_begin", [50]);
  const f0 = await figures(db, p.id);
  eq([f0.state, f0.refundable], ["never_read", null], "never read: no number");
  eq((await read(db, p)).result, "complete", "a complete read at once after the turn-on");
  eq(await st(db, p), "dirty", "…is not known (it did not start 5 minutes after the turn-on) [T4]");
  await elapse(db, "5 minutes 1 second");
  eq((await read(db, p)).result, "complete", "a complete read after the settle interval");
  const f = await figures(db, p.id);
  eq([f.state, f.refundable, f.captured], ["known", 10000, 10000], "known, with its number");
});

await group("first_read_that_fails_is_recorded_and_a_later_success_says_complete", async (db) => {
  const s = await scene(db, { parts: false });
  const r = await read(db, s.p, { result: "owner_unreachable", owner: null, lists: [], refunds: [] });
  eq([r.result, r.reason], ["not_complete", "owner_unreachable"], "the owner unreachable on the very first read: not_complete with the app's reason");
  const row = await stateRow(db, s.p.id);
  check(row !== undefined && row.payment_intent_id === null && row.captured_cents === null && row.last_complete_read_token === null, "the state row exists, with null owner facts [R13]");
  eq(row.last_attempt_result, "owner_unreachable", "last_attempt_result is the reason");
  const inv = await inventory(db);
  check(inv.counts.not_complete === 1 && inv.not_complete_by_reason.owner_unreachable === 1, "the inventory counts it");
  const r2 = await read(db, s.p);
  eq(r2.result, "complete", "the next read is complete");
  eq((await stateRow(db, s.p.id)).last_attempt_result, "complete", "…and says complete");
  eq((await inventory(db)).counts.not_complete, 0, "…and the inventory no longer counts it");
});

await group("complete_needs_both_terminal_lists_and_every_id", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000], ["full", 1000], ["full", 1000], ["full", 1000], ["full", 1000], ["full", 1000]] });
  const [p1, p2, p3, p4, p5, p6, p7] = s.pays;
  const R = (p) => refundOf(p, 100);
  const not = async (p, opts, what) => { const r = await read(db, p, opts); eq([r.result, r.reason], ["not_complete", "incomplete_evidence"], what); };
  const r1 = R(p1);
  await not(p1, { refunds: [r1], lists: [listsOf([r1])[0]] }, "only the PaymentIntent list (the charge list missing)");
  const r2 = R(p2);
  await not(p2, { refunds: [r2], lists: listsOf([r2], { piTerminal: false }) }, "the PaymentIntent list not terminal");
  const r3 = R(p3);
  await not(p3, { refunds: [r3], lists: listsOf([r3], { chargeTerminal: false }) }, "the charge list not terminal");
  const r4 = R(p4);
  await not(p4, { refunds: [r4], lists: [{ by: "payment_intent", terminal: true, ids: [r4.id] }, { by: "charge", terminal: true, ids: [r4.id, "re_listedonly1"] }] }, "a LISTED id not retrieved");
  const r5 = R(p5);
  eq((await read(db, p5, { refunds: [r5] })).result, "complete", "(p5 mirrors a refund)");
  await not(p5, { refunds: [], lists: listsOf([]) }, "a MIRRORED id not retrieved");
  await legacyRow(db, { p: p6, quote: s.q, shop: s.w.shop, by: s.owner, status: "submitted", refundId: "re_heldonly1" });
  await not(p6, { refunds: [], lists: listsOf([]) }, "a REQUEST-HELD refund id not retrieved");
  const r7 = R(p7);
  eq((await read(db, p7, { refunds: [r7] })).result, "complete", "control: both lists terminal and every id retrieved = complete");
  for (const p of [p1, p2, p3, p4, p5, p6]) check((await st(db, p)) !== "known", `${p === p5 ? "p5" : "each"}: not known after a read that did not end complete`);
});

await group("the_charges_refunded_amount_is_not_part_of_any_decision", async (db) => {
  const s = await armedScene(db, { amount: 1000, captured: 10000 });
  // Main's ledger of the charge: a cumulative 3000 refunded, retained although that refund later failed.
  await db.query("insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents) values ('evt_cum1', $1, now(), 3000, 10000)", [s.p.id]);
  const Rf = refundOf(s.p, 3000, { status: "failed" });
  const owner = { ...ownerOf(s.p), charge_refunded: 3000, amount_refunded: 3000 };
  const r = await read(db, s.p, { refunds: [Rf], owner });
  eq(r.result, "complete", "a retained cumulative after a failed refund, and an extra charge_refunded key in p_owner: the read is complete");
  check(!JSON.stringify(await stateRow(db, s.p.id)).includes("3000"), "no state column took the charge's amount_refunded");
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  const rd = await after24h(db, s.p, [Rf]);
  eq(rd.result, "complete", "24 h later a fresh complete read (the same evidence)");
  const f = await figures(db, s.p.id);
  eq([f.state, f.counted, f.in_flight], ["known", 0, 1000], "known: the failed refund counts 0, the unrelated armed request is in flight");
  eq((await release(db, s.owner, s.reqId, rd.read_token, "no_request", "default", false, null)).result, "released", "the unrelated armed request can be released");
});

await group("a_read_that_does_not_end_complete_takes_the_figures_away", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 100000], ["full", 10000], ["full", 10000], ["full", 10000]] });
  const [p1, p2, p3, p4] = s.pays;
  for (const p of s.pays) await read(db, p);
  for (const p of s.pays) check((await figures(db, p.id)).refundable !== null && (await st(db, p)) === "known", "known with a number before");
  const forty = Array.from({ length: 40 }, () => refundOf(p1, 1));
  const lists41 = listsOf([...forty, refundOf(p1, 1, { id: "re_unreadable41" })]);
  const r1 = await read(db, p1, { refunds: forty, lists: lists41 });
  eq([r1.result, r1.reason], ["not_complete", "incomplete_evidence"], "41 ids listed, 40 retrieved (one unreadable): not complete");
  const r2 = await read(db, p2, { refunds: [refundOf(p2, 100, { currency: "eur" })] });
  eq([r2.result, r2.reason], ["not_complete", "evidence_mismatch"], "a refund in another currency: evidence_mismatch");
  const r3 = await read(db, p3, { refunds: [{ ...refundOf(p3, 100), amount: "100" }] });
  eq([r3.result, r3.reason], ["not_complete", "evidence_malformed"], "an amount that is not a number: evidence_malformed");
  const r4 = await read(db, p4, { result: "provider_timeout" });
  eq([r4.result, r4.reason], ["not_complete", "provider_timeout"], "a named app reason: not complete with that reason");
  for (const [p, n] of [[p1, "41 ids"], [p2, "mismatch"], [p3, "malformed"], [p4, "app reason"]]) {
    const f = await figures(db, p.id);
    eq([f.state, f.known, f.refundable], ["dirty", false, null], `${n}: the figures are taken away (dirty, no number)`);
  }
  const sum = await rpc(db, "catering_refund_summary", [[s.q]]);
  eq([sum.quotes[0].all_known, sum.quotes[0].refundable_total_cents], [false, null], "the button's condition is false: not every payment known, no total");
});

await group("a_refund_id_under_two_payments_marks_dirty_and_commits", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 10000], ["full", 10000], ["full", 10000], ["full", 10000]] });
  const [p1, p2, p3, p4] = s.pays;
  for (const p of s.pays) await read(db, p);
  // By pre-existing row: the id is mirrored under p2.
  const Rz = refundOf(p2, 500, { id: "re_zconflict1" });
  eq((await read(db, p2, { refunds: [Rz] })).result, "complete", "re_zconflict1 is mirrored under p2");
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  eq((await read(db, p1)).result, "complete", "p1 is re-read");
  eq(await st(db, p1), "known", "p1 is KNOWN");
  const Ra = refundOf(p1, 100, { id: "re_aaa1" });
  const r = await read(db, p1, { refunds: [Ra, { ...Rz, payment_intent: p1.pi, charge: p1.charge }] });
  check(r && typeof r === "object" && r.result === "not_complete", "F6 returned normally (no raise)");
  eq([r.reason, r.conflict_with], ["evidence_conflict", p2.id], "evidence_conflict, naming the other payment");
  eq((await mirror(db, p1.id)).length, 0, "no mirror write of that call survives (re_aaa1, written first, was undone)");
  eq((await one(db, "select payment_id from public.catering_refund_observed where refund_id = 're_zconflict1'")).payment_id, p2.id, "the other payment's row is untouched");
  const row = await stateRow(db, p1.id);
  eq([await st(db, p1), row.last_attempt_result, row.last_attempt_conflict_with], ["dirty", "evidence_conflict", p2.id], "p1 is NOT known; the reason and the other payment are stored (committed)");
  const inv = await inventory(db);
  check(inv.lists.not_complete.some((x) => x.payment_id === p1.id && x.conflict_with === p2.id) && inv.not_complete_by_reason.evidence_conflict === 1, "the inventory lists both payment ids");
  // By the insert race: the id is written under p2 between F6's look and its insert. Single session: a fixture trigger
  // makes that write (a stand-in for the other transaction); the on-conflict insert then writes nothing (row count 0).
  await db.exec(`create function public.fx_race() returns trigger language plpgsql as $$ begin
      if new.refund_id = 're_zrace1' and new.payment_id = '${p3.id}' then
        insert into public.catering_refund_observed (refund_id, payment_id, charge_id, amount_cents, currency, stripe_created_at, read_started_at, recorded_at)
          values (new.refund_id, '${p2.id}', '${p2.charge}', 1, 'usd', now(), now(), now());
      end if; return new; end $$;
    create trigger fx_race before insert on public.catering_refund_observed for each row execute function public.fx_race();`);
  const rr = await read(db, p3, { refunds: [refundOf(p3, 100, { id: "re_arace1" }), refundOf(p3, 100, { id: "re_zrace1" })] });
  eq([rr.result, rr.reason, rr.conflict_with], ["not_complete", "evidence_conflict", p2.id], "the insert race: evidence_conflict, naming the payment that won the id");
  eq((await mirror(db, p3.id)).length, 0, "…and no mirror write of that call survives");
  eq((await stateRow(db, p3.id)).last_attempt_result, "evidence_conflict", "…the reason committed");
  await db.exec("drop trigger fx_race on public.catering_refund_observed; drop function public.fx_race()");
  // CRB02 (contested): a stored row that is NOT older than this read. Inside one clock tick F5 bridges the gap (a begin
  // starts strictly after an earlier read's start that falls in the same tick: shown first). A stored start that lies
  // further in the future (the clock was set back; here a fixture write) is NOT followed: the read records `contested`.
  const R4 = refundOf(p4, 100);
  eq((await read(db, p4, { refunds: [R4] })).result, "complete", "p4 mirrors a refund");
  await fx(db, "update public.catering_refund_observed set read_started_at = clock_timestamp() + interval '300 milliseconds' where refund_id = $1", [R4.id]);
  const b4 = await begin(db, p4.id);
  check((await one(db, "select $1::timestamptz > read_started_at as x from public.catering_refund_observed where refund_id = $2", [b4.started_at, R4.id])).x,
    "F5: a begin starts strictly after a mirrored row's read start that is inside the clock's granularity (under one second ahead)");
  eq((await record(db, p4.id, b4.read_id, { owner: ownerOf(p4), lists: listsOf([R4]), refunds: [R4] })).result, "complete", "…and that read records complete");
  await elapse(db, "6 minutes");
  await keepAlive(db);
  eq(await st(db, p4), "known", "p4 is KNOWN");
  await fx(db, "update public.catering_refund_observed set read_started_at = clock_timestamp() + interval '1 day' where refund_id = $1", [R4.id]);
  const b5 = await begin(db, p4.id);
  check((await one(db, "select $1::timestamptz < read_started_at as x from public.catering_refund_observed where refund_id = $2", [b5.started_at, R4.id])).x,
    "F5 does NOT follow a stored start that lies a day in the future: the begin starts at the clock");
  const before = await mirror(db, p4.id);
  const rc = await record(db, p4.id, b5.read_id, { owner: ownerOf(p4), lists: listsOf([R4]), refunds: [R4] });
  eq([rc.result, rc.reason], ["not_complete", "contested"], "a stored row that is not older than this read: not complete, reason `contested` (CRB02), returned and not raised");
  eq(await mirror(db, p4.id), before, "…the stored row is untouched");
  eq(await st(db, p4), "dirty", "…and the payment is not known afterwards (fails closed)");
  // A complete read whose own start lies in the future proves nothing either (F3; the sweep's twin agrees).
  await fx(db, "update public.catering_refund_payment_state set last_complete_read_started_at = clock_timestamp() + interval '1 hour', dirty_since = null where payment_id = $1", [p2.id]);
  eq(await st(db, p2), "dirty", "a complete read stamped in the future reads dirty, never known");
  eq((await rpc(db, "catering_refund_sweep_due", [50])).states[p2.id], "dirty", "…and F14 classifies it the same way");
});

await group("evidence_mismatch_writes_nothing", async (db) => {
  const s = await scene(db, { parts: false });
  const other = await another(db, s);
  const good = () => refundOf(s.p, 100);
  const cases = [
    ["another currency", { currency: "eur" }],
    ["another payment's PaymentIntent", { payment_intent: other.p.pi }],
    ["a charge that is not the owner's", { charge: other.p.charge }],
    ["neither a PaymentIntent nor a charge", { payment_intent: null, charge: null }],
    ["an amount of 0", { amount: 0 }],
  ];
  for (const [what, over] of cases) {
    const r = await read(db, s.p, { refunds: [good(), { ...good(), ...over }] });
    eq([r.result, r.reason], ["not_complete", "evidence_mismatch"], `${what}: evidence_mismatch`);
    eq((await mirror(db, s.p.id)).length, 0, `${what}: nothing written (not even the good refund of the same call)`);
  }
  const partial = Object.fromEntries(Object.entries(ownerOf(s.p)).filter(([key]) => key !== "credential_fp"));
  const r = await read(db, s.p, { refunds: [good()], owner: partial });
  eq([r.result, r.reason], ["not_complete", "evidence_mismatch"], "refunds handed over with an owner that is not whole: evidence_mismatch");
  eq((await mirror(db, s.p.id)).length, 0, "…nothing written");
  eq((await stateRow(db, s.p.id)).last_complete_read_token, null, "no complete stamp was ever written");
});

await group("refund_without_a_payment_intent_needs_the_owner_charge", async (db) => {
  const s = await armedScene(db, { amount: 1000, captured: 10000 });
  const R0 = refundOf(s.p, 300, { pi: null });
  const R1 = refundOf(s.p, 1000, { pi: null, request: s.reqId, created: Math.floor(s.armedEpoch) + 1 });
  const lists = listsOf([R0, R1]);
  eq([lists[0].ids, lists[1].ids], [[], [R0.id, R1.id]], "(listed by charge only)");
  const r = await read(db, s.p, { refunds: [R0, R1], lists });
  eq(r.result, "complete", "a refund with no PaymentIntent and the owner's charge is verified: complete");
  const m = await mirror(db, s.p.id);
  eq(m.map((x) => [x.refund_id, x.payment_intent_id, x.charge_id]).sort(), [[R0.id, null, s.p.charge], [R1.id, null, s.p.charge]].sort(), "mirrored with no PaymentIntent and the owner's charge");
  eq(r.bound, [{ request_id: s.reqId, refund_id: R1.id }], "bindable: the unique candidate (no PaymentIntent, the owner's charge) is bound");
  const o = await another(db, s);
  eq((await read(db, o.p)).result, "complete", "(another payment)");
  const bad = await read(db, o.p, { refunds: [refundOf(o.p, 100, { pi: null, charge: s.p.charge })] });
  eq([bad.result, bad.reason], ["not_complete", "evidence_mismatch"], "no PaymentIntent and ANOTHER charge: evidence_mismatch");
  eq((await mirror(db, o.p.id)).length, 0, "…nothing written");
});

await group("dirty_is_read_from_the_ledger_in_every_shape", async (db) => {
  const s = await scene(db, { parts: false, pays: Array.from({ length: 7 }, () => ["full", 1000]) });
  const [p1, p2, p3, p4, p5, p6, p7] = s.pays;
  for (const p of s.pays) await read(db, p);
  for (const p of s.pays) eq(await st(db, p), "known", "known before any event");
  await ledger(db, { pi: p1.pi });
  await ledger(db, { pi: p2.pi, shape: "expanded" });
  await ledger(db, { charge: p3.charge });
  await ledger(db, { charge: p4.charge, shape: "charge_own" });
  await ledger(db, { pi: p5.pi, shape: "pi_own" });
  await ledger(db, { charge: p6.charge, shape: "expanded" });
  for (const [p, what] of [[p1, "a scalar PaymentIntent"], [p2, "an expanded PaymentIntent"], [p3, "a refund's charge"], [p4, "a charge event's own id"], [p5, "a payment_intent.* event's own id"], [p6, "an expanded charge"]]) {
    eq(await st(db, p), "dirty", `${what} makes the payment dirty`);
  }
  await ledger(db, { pi: "pi_unrelated_x1", charge: "ch_unrelated_x1" });
  await db.query("insert into public.stripe_events (id, type, livemode, payload) values ('evt_ownid', 'invoice.paid', false, $1)", [JSON.stringify({ data: { object: { id: p7.pi } } })]);
  await db.query("insert into public.stripe_events (id, type, livemode, payload) values ('evt_odd', 'charge.refunded', false, $1)", [JSON.stringify({ data: { object: { id: ["not", "text"], payment_intent: { id: 7 }, charge: null } } })]);
  eq(await st(db, p7), "known", "an unrelated id, an object's own id on a type that is not payment_intent.* / charge.*, and an odd shape change nothing (and raise nothing)");
});

await group("the_ledger_window_is_the_reads_own", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000], ["full", 1000]] });
  const [p1, p2, p3] = s.pays;
  for (const p of s.pays) await read(db, p);
  await ledger(db, { pi: p1.pi, ago: "6 minutes" });
  eq(await st(db, p1), "known", "a row received 6 minutes before the read began (made visible only now) does not dirty it");
  await ledger(db, { pi: p2.pi, ago: "4 minutes" });
  eq(await st(db, p2), "dirty", "a row received 4 minutes before the read began dirties it, the moment it is visible");
  await elapse(db, "5 hours");
  await keepAlive(db);
  eq([await st(db, p1), await st(db, p3)], ["known", "known"], "5 hours on (the sweep claiming on schedule): the old reads are still known");
  await ledger(db, { charge: p3.charge });
  eq(await st(db, p3), "dirty", "a row received hours after an old read dirties it: no lookback constant cuts it off");
});

await group("a_ledger_that_cannot_prove_coverage_reads_dirty", async (db) => {
  const w = await world(db);
  const q = await w.quote();
  const p = await w.pay(q, "full", 1000);
  await rpc(db, "catering_refund_observe_set", [true]);
  await rpc(db, "catering_refund_sweep_begin", [50]);
  await elapse(db, "10 minutes");
  eq((await read(db, p)).result, "complete", "an EMPTY ledger: the read is complete");
  eq([await st(db, p), (await one(db, "select public.catering_refund_dirty_at($1) = 'infinity'::timestamptz as x", [p.id])).x], ["dirty", true], "…but coverage is not proven ('infinity'): dirty, never a figure");
  eq((await figures(db, p.id)).refundable, null, "…no number");
  await ledger(db, { type: "ping", ago: "1 day" });
  eq(await st(db, p), "known", "after one older row exists: known");
  // A ledger whose oldest row is NEWER than the window's start.
  const d2 = await fresh();
  const w2 = await world(d2);
  const q2 = await w2.quote();
  const p2 = await w2.pay(q2, "full", 1000);
  await rpc(d2, "catering_refund_observe_set", [true]);
  await rpc(d2, "catering_refund_sweep_begin", [50]);
  await elapse(d2, "10 minutes");
  await ledger(d2, { type: "ping", ago: "2 minutes" });
  eq((await read(d2, p2)).result, "complete", "a ledger whose oldest row is 2 minutes old: complete");
  eq(await st(d2, p2), "dirty", "…dirty (the ledger does not reach back to the window's start)");
  await elapse(d2, "6 minutes");
  await keepAlive(d2);
  eq((await read(d2, p2)).result, "complete", "a new read whose window the ledger covers");
  eq(await st(d2, p2), "known", "…is known");
});

await group("known_needs_five_minutes_after_the_dirty_instant", async (db) => {
  const s = await scene(db, { pays: [["full", 10000]] });
  await read(db, s.p);
  await db.query("update public.catering_refund_payment_state set dirty_since = last_complete_read_started_at - interval '4 minutes 59 seconds' where payment_id = $1", [s.p.id]);
  eq(await st(db, s.p), "dirty", "a read that started 4:59 after the dirty instant: not known");
  await db.query("update public.catering_refund_payment_state set dirty_since = last_complete_read_started_at - interval '5 minutes' where payment_id = $1", [s.p.id]);
  eq(await st(db, s.p), "known", "5:00 after: known");
  // Our own arm and finish stamp the same way.
  const o = await another(db, s);
  const t = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 1000 });
  const req = t.reserved.requests[0];
  eq((await arm(db, req)).result, "armed", "an arm");
  check((await one(db, "select s.dirty_since = r.create_armed_at as x from public.catering_refund_payment_state s, public.catering_refund_requests r where s.payment_id = $1 and r.id = $2", [o.p.id, req.id])).x, "the arm stamps dirty at its own instant");
  eq(await st(db, o.p), "dirty", "…so the press's read is no longer known");
  await finish(db, req.id, "unconfirmed", null, "timeout", null);
  check((await one(db, "select s.dirty_since > r.create_armed_at as x from public.catering_refund_payment_state s, public.catering_refund_requests r where s.payment_id = $1 and r.id = $2", [o.p.id, req.id])).x, "the finish stamps again, later");
  await elapse(db, "4 minutes 59 seconds");
  await keepAlive(db);
  await read(db, o.p);
  eq(await st(db, o.p), "dirty", "a read begun 4:59 after the finish stamp: not known");
  await elapse(db, "1 second");
  await read(db, o.p);
  eq(await st(db, o.p), "known", "a read begun 5:00 after it: known");
});

await group("every_turn_on_invalidates_every_payment", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000], ["full", 1000], ["full", 1000]] });
  const [p1, p2, p4, p5] = s.pays;
  await read(db, p1);
  await read(db, p2);
  const open4 = await begin(db, p4.id);
  const rows0 = await stateCount(db);
  const tr0 = Number((await one(db, "select transitions from public.catering_refund_observation")).transitions);
  const on = await rpc(db, "catering_refund_observe_set", [true]);
  eq([Number(on.transitions), on.stamped, on.observe_on], [tr0 + 1, rows0, true], "F17(true): the transition count moved, every state row stamped (the count returned)");
  eq([await st(db, p1), await st(db, p2)], ["dirty", "dirty"], "every known payment reads dirty");
  eq((await record(db, p4.id, open4.read_id, { owner: ownerOf(p4), lists: listsOf([]), refunds: [] })).result, "complete", "a read in flight across the statement records complete…");
  await elapse(db, "6 minutes");
  await keepAlive(db);
  eq(await st(db, p4), "dirty", "…but is never known (begun under the old transition count)");
  check((await stateRow(db, p5.id)) === undefined, "(p5 has no state row)");
  eq((await read(db, p1)).result, "complete", "p1 re-read 6 minutes after the turn-on");
  eq(await st(db, p1), "known", "…known");
  const on2 = await rpc(db, "catering_refund_observe_set", [true]);
  eq(Number(on2.transitions), tr0 + 2, "ON after ON: the count moves again");
  eq(await st(db, p1), "dirty", "…and invalidates again");
  const off = await rpc(db, "catering_refund_observe_set", [false]);
  eq([off.observe_on, off.stamped], [false, 0], "F17(false): recorded, no stamp");
  for (const p of s.pays) eq(await st(db, p), "paused", "everything reads paused at once");
  // A payment with NO state row at the turn-on: its first read right after it is not known [T4].
  const s2 = await fresh();
  const w2 = await world(s2);
  const q2 = await w2.quote();
  const pn = await w2.pay(q2, "full", 1000);
  await observing(s2);
  check((await stateRow(s2, pn.id)) === undefined, "a payment with no state row yet");
  await rpc(s2, "catering_refund_observe_set", [true]);
  await read(s2, pn);
  eq(await st(s2, pn), "dirty", "…its first read right after the turn-on is not known");
});

await group("a_flip_between_two_ticks_is_detected", async (db) => {
  const s = await scene(db, { parts: false });
  await read(db, s.p);
  eq(await st(db, s.p), "known", "known");
  await rpc(db, "catering_refund_observe_set", [false]);
  await rpc(db, "catering_refund_observe_set", [true]);
  const c = await rpc(db, "catering_refund_sweep_begin", [50]);
  eq([c.claimed, c.resumed, c.resumed_rows, Number(c.transitions)], [true, true, 1, 3], "OFF then ON between two ticks: the next claim answers resumed and stamps again");
  for (const n of [1, 2]) {
    const inv = await inventory(db);
    eq([Number(inv.observation.transitions), inv.counts.known], [3, 0], `inventory load ${n}: the new transition count and no known payment`);
  }
  await elapse(db, "6 minutes");
  const c2 = await rpc(db, "catering_refund_sweep_begin", [50]);
  eq([c2.claimed, c2.resumed], [true, false], "the next tick claims without resuming");
  await read(db, s.p);
  eq((await inventory(db)).counts.known, 1, "a pre-flip read never signed off; the re-read does");
});

await group("liveness_is_measured_from_the_claim", async (db) => {
  const s = await scene(db, { parts: false });
  await read(db, s.p);
  const o = await one(db, "select extract(epoch from lease_until - last_claim_at)::int as d from public.catering_refund_observation");
  eq(o.d, 330, "a claim's lease is 5:30");
  await claimAgo(db, "59 minutes 59 seconds");
  eq([await st(db, s.p), (await inventory(db)).observation.live], ["known", true], "claim at T: live at T + 59:59 (lease_until T + 5:30 long past)");
  await claimAgo(db, "60 minutes");
  eq([await st(db, s.p), (await inventory(db)).observation.live], ["paused", false], "paused at T + 60:00");
  const before = (await stateRow(db, s.p.id)).dirty_since;
  const c = await rpc(db, "catering_refund_sweep_begin", [50]);
  eq([c.claimed, c.resumed, c.resumed_rows], [true, true, 1], "a claim after 60 minutes resumes and stamps");
  check(+((await stateRow(db, s.p.id)).dirty_since ?? 0) > +(before ?? 0), "…the state row is stamped");
  await claimAgo(db, "20 minutes");
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  const d0 = (await stateRow(db, s.p.id)).dirty_since;
  const c2 = await rpc(db, "catering_refund_sweep_begin", [50]);
  eq([c2.claimed, c2.resumed, c2.resumed_rows], [true, false, 0], "a claim after 20 minutes does not resume");
  eq(+(await stateRow(db, s.p.id)).dirty_since, +d0, "…and stamps nothing");
});

await group("the_sweep_does_nothing_until_on_is_recorded", async (db) => {
  const w = await world(db);
  const q = await w.quote();
  const p = await w.pay(q, "full", 1000);
  await ledger(db, { type: "ping", ago: "30 days" });
  eq(await rpc(db, "catering_refund_sweep_begin", [50]), { claimed: false, reason: "observe_not_recorded" }, "ON never recorded: observe_not_recorded");
  const o = await one(db, "select * from public.catering_refund_observation");
  check(o.last_claim_at === null && o.lease_until === null && (await stateCount(db)) === 0, "no claim, no lease, no state row written");
  await rpc(db, "catering_refund_observe_set", [true]);
  await rpc(db, "catering_refund_observe_set", [false]);
  eq(await rpc(db, "catering_refund_sweep_begin", [50]), { claimed: false, reason: "observe_not_recorded" }, "OFF recorded: observe_not_recorded");
  eq(await stateCount(db), 0, "…still no state row");
  eq(await st(db, p), "paused", "the payment reads paused");
});

await group("figures_are_stripes_truth_or_nothing", async (db) => {
  const s = await scene(db, { parts: false, observe: false });
  const f0 = await figures(db, s.p.id);
  eq([f0.state, f0.refundable, f0.known], ["paused", null, false], "observation not recorded: paused, no number");
  await observing(db);
  eq([(await figures(db, s.p.id)).state, (await figures(db, s.p.id)).refundable], ["never_read", null], "never read: no number (unknown is never 0)");
  const refunds = [refundOf(s.p, 3000, { status: "succeeded" }), refundOf(s.p, 2000, { status: "failed" }), refundOf(s.p, 1000, { status: "canceled" }),
    refundOf(s.p, 500, { status: "pending" }), refundOf(s.p, 400, { status: null }), refundOf(s.p, 50, { status: "requires_action_new" })];
  await read(db, s.p, { refunds });
  const f = await figures(db, s.p.id);
  eq([f.state, f.captured, f.counted, f.in_flight, f.refundable], ["known", 10000, 3950, 0, 6050], "known: captured - every mirrored refund not failed / canceled (null and unfamiliar statuses COUNT)");
  await ledger(db, { pi: s.p.pi });
  const f2 = await figures(db, s.p.id);
  eq([f2.state, f2.refundable], ["dirty", null], "an event: no number again (never 0)");
  const sum = await rpc(db, "catering_refund_summary", [[s.q]]);
  eq([sum.quotes[0].payments[0].captured_cents, sum.quotes[0].payments[0].counted_cents, sum.quotes[0].payments[0].refundable_cents], [null, null, null], "the summary shows no figure while not known");
});

await group("every_refund_is_counted_once_whatever_it_claims", async (db) => {
  const s = await armedScene(db, { amount: 1000, captured: 100000 });
  const R1 = answerOf(s.p, s.reqId, 1000);
  eq((await finish(db, s.reqId, "created", R1)).result, "created", "the POST's answer binds the request (not yet mirrored)");
  const f0 = await figures(db, s.p.id);
  eq([f0.counted, f0.in_flight], [0, 1000], "until mirrored, the request's own amount is held in flight");
  const refunds = [
    refundOf(s.p, 1000, { id: R1.id, request: s.reqId }),
    refundOf(s.p, 200, { request: randomUUID() }),
    refundOf(s.p, 300),
    refundOf(s.p, 400, { request: s.reqId }),
  ];
  const r = await read(db, s.p, { refunds });
  eq([r.result, r.linked], ["complete", 1], "the read mirrors all four and links the bound one");
  const f = await figures(db, s.p.id);
  eq([f.counted, f.in_flight], [1900, 0], "each mirrored refund counted ONCE whatever it claims (bound, foreign, none, duplicate); the request is no longer in flight");
  eq(Object.values(await kindsOf(db, s.p)).sort(), ["bound", "duplicate", "foreign", "none"], "the claims: bound, foreign, none, duplicate");
});

await group("status_disagreement_is_reported_never_written", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 10000], ["full", 5000, { status: "refunded" }], ["full", 3000]] });
  const [p1, p2, p3] = s.pays;
  await read(db, p1, { refunds: [refundOf(p1, 10000)] });
  await read(db, p2, { refunds: [refundOf(p2, 5000, { status: "failed" })] });
  await read(db, p3);
  const f1 = await figures(db, p1.id);
  const f2 = await figures(db, p2.id);
  eq([f1.stripe_whole, f1.disagrees], [true, true], "paid, but whole at Stripe: a disagreement");
  eq([f2.stripe_whole, f2.disagrees], [false, true], "refunded, but its refund failed: a disagreement");
  eq((await figures(db, p3.id)).disagrees, false, "control: paid and nothing refunded agrees");
  eq((await rows(db, "select status from public.catering_payments where id = any($1::uuid[]) order by amount_cents desc", [[p1.id, p2.id]])).map((r) => r.status), ["paid", "refunded"], "B1 never corrects main's status");
  const inv = await inventory(db);
  eq([inv.counts.disagreements, inv.lists.disagreements.map((x) => x.payment_id).sort()], [2, [p1.id, p2.id].sort()], "the inventory reports both");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H — the send
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const probeOf = (db, s, { quote = s.q, actor = s.owner, token = randomUUID(), amount = 100 } = {}) =>
  rpc(db, "catering_refund_reserve_fresh", [actor, quote, token, amount, null, "customer_cancelled", null, "panel", null]);
const reserveWith = (db, s, reads, { quote = s.q, actor = s.owner, token = randomUUID(), amount = 1000, seen = 10000 } = {}) =>
  rpc(db, "catering_refund_reserve_fresh", [actor, quote, token, amount, seen, "customer_cancelled", null, "panel", JSON.stringify(reads)]);
const ready = (db) => one(db, "select public.catering_refund_parts_ready() as x").then((r) => r.x);

await group("gate_b2_b3_in_the_database", async (db) => {
  const s = await scene(db, { parts: false });
  eq(await ready(db), false, "no readiness functions: false");
  await raises(() => probeOf(db, s), "refunds_not_activated", "no readiness functions: the reserve");
  await withPartsReady(db);
  eq(await ready(db), true, "both present and true: true");
  check((await probeOf(db, s)).probe === true, "…the reserve passes the gate");
  const variants = [
    ["B2 answers false", "create or replace function public.catering_refund_b2_ready() returns boolean language sql stable as $$ select false $$"],
    ["B3 answers NULL", "create or replace function public.catering_refund_b3_ready() returns boolean language sql stable as $$ select null::boolean $$"],
    ["B2 RAISES", "create or replace function public.catering_refund_b2_ready() returns boolean language plpgsql stable as $$ begin raise exception 'boom'; end $$"],
    ["B3 returns text", "drop function public.catering_refund_b3_ready(); create function public.catering_refund_b3_ready() returns text language sql stable as $$ select 'true' $$"],
    ["B2 returns a set", "drop function public.catering_refund_b2_ready(); create function public.catering_refund_b2_ready() returns setof boolean language sql stable as $$ select true $$"],
    ["B3 missing", "drop function public.catering_refund_b3_ready()"],
  ];
  for (const [what, sql] of variants) {
    await db.exec("drop function if exists public.catering_refund_b2_ready(); drop function if exists public.catering_refund_b3_ready();");
    await withPartsReady(db);
    await db.exec(sql);
    eq(await ready(db), false, `${what}: false`);
    await raises(() => probeOf(db, s), "refunds_not_activated", `${what}: the reserve is refused`);
  }
});

await group("probe_writes_nothing_and_replays_scoped", async (db) => {
  const s = await scene(db);
  const o = await another(db, s);
  const pr = await probeOf(db, s);
  eq([pr.probe, pr.replay, pr.payments.map((x) => x.payment_id)], [true, false, [s.p.id]], "the probe names the payments a read is needed for");
  eq([await reqCount(db), await auditCount(db, "catering.refund.request"), await stateCount(db)], [0, 0, 0], "…and writes nothing (no request, no audit row, no state row)");
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const ids = t.reserved.requests.map((r) => r.id);
  await raises(() => probeOf(db, s, { quote: o.q, token: t.token, amount: 1000 }), "token_reused", "the same token on ANOTHER order");
  await raises(() => probeOf(db, s, { token: t.token, amount: 2000 }), "token_reused", "the same token with another amount");
  const rp = await probeOf(db, s, { token: t.token, amount: 1000 });
  eq([rp.replay, rp.requests.map((r) => r.id)], [true, ids], "the same token, order and amount: replay with the original rows");
  eq(await reqCount(db), 1, "…nothing new was written");
});

await group("reserve_needs_this_requests_tokens", async (db0) => {
  const cases = [
    ["no token", async () => []],
    ["the token of an earlier read", async (db, s) => { const a = await read(db, s.p); await read(db, s.p); return [{ payment_id: s.p.id, read_token: a.read_token }]; }],
    ["a sweep's later read replaced it", async (db, s) => { const a = await read(db, s.p); await read(db, s.p); return [{ payment_id: s.p.id, read_token: a.read_token }]; }],
    ["a read older than 5 minutes", async (db, s) => { const a = await read(db, s.p); await elapse(db, "5 minutes 1 second"); await keepAlive(db); return [{ payment_id: s.p.id, read_token: a.read_token }]; }],
    ["an event since the read", async (db, s) => { const a = await read(db, s.p); await ledger(db, { pi: s.p.pi }); return [{ payment_id: s.p.id, read_token: a.read_token }]; }],
    ["not known (a read that did not end complete just before)", async (db, s) => { await read(db, s.p, { result: "provider_timeout" }); const a = await read(db, s.p); return [{ payment_id: s.p.id, read_token: a.read_token }]; }],
    ["paused (the sweep's last claim 61 minutes ago)", async (db, s) => { const a = await read(db, s.p); await claimAgo(db, "61 minutes"); return [{ payment_id: s.p.id, read_token: a.read_token }]; }],
    ["a forged token", async (db, s) => { await read(db, s.p); return [{ payment_id: s.p.id, read_token: randomUUID() }]; }],
  ];
  let first = true;
  for (const [what, make] of cases) {
    const db = first ? db0 : await fresh();
    first = false;
    const s = await scene(db);
    const reads = await make(db, s);
    await raises(() => reserveWith(db, s, reads), "figures_stale", what);
    eq([await reqCount(db), await auditCount(db, "catering.refund.request")], [0, 0], `${what}: nothing inserted, no audit row`);
  }
});

await group("a_stale_reserve_call_still_replays_under_the_lock", async (db) => {
  const s = await scene(db);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const ids = t.reserved.requests.map((r) => r.id);
  const stale = [{ payment_id: s.p.id, read_token: randomUUID() }];
  const r = await reserveWith(db, s, stale, { token: t.token, amount: 1000, seen: 123 });
  eq([r.replay, r.requests.map((x) => x.id)], [true, ids], "stale tokens + the press already reserved: the original rows (replay before every freshness check)");
  await raises(() => reserveWith(db, s, stale, { token: randomUUID(), amount: 1000 }), "figures_stale", "stale tokens + nothing reserved under this press");
  eq(await reqCount(db), 1, "…nothing new");
});

await group("reserve_refuses_a_figure_the_person_did_not_see", async (db) => {
  const s = await scene(db);
  const go = (amount, seen) => tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount, seen });
  try { await go(1000, 9999); check(false, "figures_changed (no error)"); }
  catch (e) { eq([e.message, e.detail], ["figures_changed", "10000"], "the person saw 9999, the figure is 10000: figures_changed with the figure"); }
  try { await go(10001, 10000); check(false, "over_refundable (no error)"); }
  catch (e) { eq([e.message, e.detail], ["over_refundable", "10000"], "more than the figure: over_refundable with the figure"); }
  eq([await reqCount(db), await auditCount(db, "catering.refund.request")], [0, 0], "nothing inserted, no audit row");
});

await group("reserve_allocates_and_audits_as_0357", async (db) => {
  const s = await scene(db, { pays: [["deposit", 3000], ["balance", 7000]] });
  const [dep, bal] = s.pays;
  await fx(db, "update public.catering_payments set paid_at = paid_at - interval '1 day' where id = $1", [dep.id]);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 8000 });
  const got = t.reserved.requests.map((r) => [r.payment_id, r.amount_cents, r.status, r.armed, r.payment_intent]);
  eq(got, [[bal.id, 7000, "pending", false, bal.pi], [dep.id, 1000, "pending", false, dep.pi]], "0357's order: the balance whole, then the deposit; each row carries its PaymentIntent as it stands under the lock");
  for (const r of t.reserved.requests) {
    const row = await requestRow(db, r.id);
    const token = t.reads.find((x) => x.payment_id === r.payment_id).read_token;
    check(row.reserve_read_token === token && r.read_token === token, "each row remembers its payment's read token [R9]");
  }
  const audit = await rows(db, "select actor_id, actor_role, destructive, metadata from public.audit_log where action = 'catering.refund.request' order by (metadata->>'amount_cents')::int desc");
  eq(audit.map((a) => [a.actor_id, a.actor_role, a.destructive, a.metadata.amount_cents, a.metadata.requested_total_cents, a.metadata.refundable_before_cents, a.metadata.full, a.metadata.has_note]),
    [[s.owner, "owner", true, 7000, 8000, 10000, false, false], [s.owner, "owner", true, 1000, 8000, 10000, false, false]], "one destructive catering.refund.request audit row per request, as 0357");
  // The actor rule (0358): who may ask.
  const gm = await s.w.user("gm");
  const agm = await s.w.user("agm");
  const gmElsewhere = await s.w.user("gm", { member: s.w.other });
  const prep = await s.w.user("prep_mgr");
  const gone = await s.w.user("owner", { member: null, active: false });
  const o = await another(db, s);
  for (const [who, id, ok] of [["a GM at the shop", gm, true], ["an AGM at the shop", agm, true], ["a GM of another shop", gmElsewhere, false], ["a prep manager", prep, false], ["an inactive owner", gone, false]]) {
    if (ok) check((await probeOf(db, s, { quote: o.q, actor: id })).probe === true, `${who}: may ask`);
    else await raises(() => probeOf(db, s, { quote: o.q, actor: id }), "forbidden", who);
  }
});

await group("allocation_never_touches_an_ineligible_payment", async (db) => {
  const s = await scene(db, { pays: [["deposit", 3000], ["balance", 7000, { status: "due" }]] });
  const [dep] = s.pays;
  eq((await probeOf(db, s)).payments.map((x) => x.payment_id), [dep.id], "a due balance beside a paid deposit: the probe names only the deposit");
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 3000 });
  eq(t.reserved.requests.map((r) => [r.payment_id, r.amount_cents]), [[dep.id, 3000]], "only the deposit gets a row, for the whole amount");
  const q2 = await s.w.quote();
  const toast = await s.w.pay(q2, "balance", 4000, { provider: "toast" });
  const stripe = await s.w.pay(q2, "deposit", 2000);
  eq((await probeOf(db, s, { quote: q2 })).payments.map((x) => x.payment_id), [stripe.id], "a non-Stripe tender beside a Stripe one: only the Stripe one");
  const t2 = await tap(db, { actor: s.owner, quoteId: q2, payments: [toast, stripe] });
  eq(t2.reserved.requests.map((r) => [r.payment_id, r.amount_cents]), [[stripe.id, 2000]], "…and only it is allocated");
  eq((await figures(db, toast.id)).eligible, false, "(the tender is ineligible)");
});

await group("duplicate_tap_returns_the_original_request", async (db) => {
  const s = await scene(db);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const again = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000, token: t.token });
  eq([again.replay, again.probe.requests.map((r) => r.id)], [true, t.reserved.requests.map((r) => r.id)], "the same press again: the original request");
  eq([await reqCount(db), await auditCount(db, "catering.refund.request")], [1, 1], "one row, one audit row");
});

await group("one_unresolved_request_per_payment", async (db) => {
  const s = await scene(db);
  await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  eq((await figures(db, s.p.id)).blocked, true, "a pending request blocks the payment");
  await raises(() => tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 100 }), "nothing_refundable", "a second press while one is unresolved");
  await refuses(() => legacyRow(db, { p: s.p, quote: s.q, shop: s.w.shop, by: s.owner }), "23505", "a second pending row by a direct insert (the unique index)");
  eq(await reqCount(db), 1, "still one");
});

await group("arm_is_write_once", async (db) => {
  const s = await armedScene(db);
  const a = s.armed;
  eq([a.amount_cents, a.payment_intent, a.charge, a.currency, a.livemode, a.account_slot, a.credential_fp], [1000, s.p.pi, s.p.charge, "usd", false, "default", "0123456789abcdef"],
    "the arm returns the amount, the PaymentIntent, the charge, the currency, the mode, the slot and the fingerprint for the POST");
  const row = await requestRow(db, s.reqId);
  check(row.create_armed_at && +row.first_attempt_at === +row.create_armed_at && row.attempts === 1 && row.arm_payment_intent === s.p.pi, "the row is armed once: instant, PaymentIntent, attempts = 1");
  const again = await arm(db, s.req);
  eq([again.result, again.status, again.armed], ["not_armable", "pending", true], "a second arm: not_armable, naming the row's state");
  for (const col of ["create_armed_at = now()", "arm_payment_intent = 'pi_other1'", "arm_credential_fp = 'ffffffffffffffff'", "arm_account_slot = 'location'", "arm_livemode = true", "reserve_read_token = gen_random_uuid()"]) {
    await raises(() => db.query(`update public.catering_refund_requests set ${col} where id = $1`, [s.reqId]), "refund_request_immutable", `the guard: ${col.split(" ")[0]} is write-once`);
  }
});

await group("arm_rechecks_freshness_under_the_lock", async (db0) => {
  const cases = [
    ["an event between reserve and arm", async (db, s) => { await ledger(db, { pi: s.p.pi }); }],
    ["a newer read", async (db, s) => { await read(db, s.p); }],
    ["the payment's current token that is NOT this row's reserve token", async (db, s, req) => { req.read_token = (await read(db, s.p)).read_token; }],
    ["the reserve's read now older than 5 minutes", async (db) => { await elapse(db, "5 minutes 1 second"); await keepAlive(db); }],
    ["an owner change (main moved the PaymentIntent)", async (db, s) => { await db.query("update public.catering_payments set provider_ref = 'pi_changed_1' where id = $1", [s.p.id]); }],
    ["a figure gone negative (a 0357-era bound request appears)", async (db, s) => { await legacyRow(db, { p: s.p, quote: s.q, shop: s.w.shop, by: s.owner, status: "submitted", refundId: "re_legacyneg1", amount: 9500 }); }],
    ["a transition recorded in between", async (db) => { await rpc(db, "catering_refund_observe_set", [true]); }],
  ];
  let first = true;
  for (const [what, perturb] of cases) {
    const db = first ? db0 : await fresh();
    first = false;
    const s = await scene(db);
    const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
    const req = { ...t.reserved.requests[0] };
    await perturb(db, s, req);
    const a = await arm(db, req);
    eq([a.result, a.armed], ["figures_stale", false], `${what}: figures_stale`);
    eq((await requestRow(db, req.id)).create_armed_at, null, `${what}: nothing armed`);
  }
});

await group("arm_refuses_after_a_long_lock_wait", async (db) => {
  const s = await scene(db);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const req = t.reserved.requests[0];
  const a = await arm(db, req, 0);
  eq([a.result, a.armed], ["deadline_passed", false], "the locks took longer than the budget (0 ms): deadline_passed (the database clock at entry vs after the locks)");
  eq((await requestRow(db, req.id)).create_armed_at, null, "…the row is still unarmed");
  eq((await arm(db, req, -5)).result, "deadline_passed", "a negative budget is 0");
  eq((await arm(db, req, 5000)).result, "armed", "control: the same row arms inside a 5-second budget");
});

await group("s8_arm_waits_on_the_state_row_inside_its_budget", async (db) => {
  const s = await scene(db);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const req = t.reserved.requests[0];
  // Single session: no lock can be held against the arm here. What execution proves: the budget compares the clock at
  // ENTRY with the clock AFTER the locks (a zero budget always passes it, the state row read included), and a refused
  // arm leaves the state row as it was. The lock ORDER (payment, then the state row FOR UPDATE, both before the first
  // check) is the static check in tests/catering-refund-0359-migration.test.ts; the wait itself is the sim lock check.
  const before = await stateRow(db, s.p.id);
  eq((await arm(db, req, 0)).result, "deadline_passed", "a zero budget: deadline_passed");
  eq(await stateRow(db, s.p.id), before, "…and the state row is untouched (the dirty stamp comes only after every check)");
  eq((await arm(db, req, null)).result, "armed", "a null budget is the default (5 s): armed");
  check(+(await stateRow(db, s.p.id)).dirty_since === +(await requestRow(db, req.id)).create_armed_at, "…and only then the state row is stamped, at the arm's instant");
});

await group("arm_and_cancel_exactly_one_wins", async (db) => {
  for (const order of ["arm first", "cancel first"]) {
    const d = order === "arm first" ? db : await fresh();
    const s = await scene(d);
    const t = await tap(d, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
    const req = t.reserved.requests[0];
    if (order === "arm first") {
      eq((await arm(d, req)).result, "armed", "arm first: armed");
      const c = await rpc(d, "catering_refund_cancel_unarmed", [req.id, "budget"]);
      eq([c.result, c.status, c.armed], ["not_cancelled", "pending", true], "…then the cancel: not_cancelled, the row's real state (armed)");
    } else {
      const c = await rpc(d, "catering_refund_cancel_unarmed", [req.id, "budget"]);
      eq([c.result, c.status], ["cancelled", "failed"], "cancel first: cancelled");
      const a = await arm(d, req);
      eq([a.result, a.status, a.armed], ["not_armable", "failed", false], "…then the arm: not_armable, the row's real state (failed)");
      eq((await requestRow(d, req.id)).last_error_code, "never_sent", "the cancelled row says never_sent");
    }
  }
});

await group("not_armable_names_the_rows_real_state", async (db) => {
  const s = await armedScene(db);
  const a = await arm(db, s.req);
  eq([a.result, a.status, a.armed, a.stripe_refund_id], ["not_armable", "pending", true, null], "armed: pending, armed");
  const ans = answerOf(s.p, s.reqId, 1000);
  await finish(db, s.reqId, "created", ans);
  const b = await arm(db, s.req);
  eq([b.result, b.status, b.armed, b.stripe_refund_id], ["not_armable", "submitted", true, ans.id], "submitted: its refund id");
  const o = await another(db, s);
  const t = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 500 });
  await rpc(db, "catering_refund_cancel_unarmed", [t.reserved.requests[0].id, "x"]);
  const c = await arm(db, t.reserved.requests[0]);
  eq([c.result, c.status, c.armed], ["not_armable", "failed", false], "cancelled: failed, never armed");
  eq((await rpc(db, "catering_refund_arm", [randomUUID(), randomUUID(), 5000])).result, "not_found", "an unknown id: not_found");
});

await group("finish_created_binds_only_a_matching_answer", async (db) => {
  const s = await armedScene(db);
  const o = await another(db, s);
  const bad = [
    ["the right PaymentIntent and ANOTHER charge", { charge: o.p.charge }],
    ["another currency", { currency: "eur" }],
    ["another amount", { amount: 999 }],
    ["another PaymentIntent", { payment_intent: o.p.pi }],
    ["no request id in its metadata", { request_id: null }],
    ["another request's id in its metadata", { request_id: randomUUID() }],
    ["an amount sent as text", { amount: "1000" }],
  ];
  for (const [what, over] of bad) {
    const r = await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000, over));
    eq([r.result, r.status, r.stripe_refund_id], ["answer_mismatch", "pending", null], `a 2xx with ${what}: answer_mismatch, still pending (unconfirmed)`);
    eq((await requestRow(db, s.reqId)).last_error_code, "answer_mismatch", `${what}: recorded as answer_mismatch`);
  }
  const ok = answerOf(s.p, s.reqId, 1000, { payment_intent: null });
  const r = await finish(db, s.reqId, "created", ok);
  eq([r.result, r.status, r.stripe_refund_id], ["created", "submitted", ok.id], "no PaymentIntent and the owner's charge, everything else matching: created");
  eq((await requestRow(db, s.reqId)).stripe_status, "succeeded", "…with Stripe's status");
});

/** An armed request whose refund a complete read has BOUND. */
async function boundScene(db, opts = {}) {
  const s = await armedScene(db, opts);
  const R = refundOf(s.p, s.req.amount_cents, { request: s.reqId, created: Math.floor(s.armedEpoch) + 1 });
  const r = await read(db, s.p, { refunds: [R] });
  if (js(r.bound) !== js([{ request_id: s.reqId, refund_id: R.id }])) throw new Error(`boundScene: ${js(r)}`);
  return { ...s, R };
}

await group("finish_after_a_read_bound_the_same_refund_is_created", async (db) => {
  const s = await boundScene(db);
  const before = await requestRow(db, s.reqId);
  const r = await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000, { id: s.R.id }));
  eq([r.result, r.already_bound, r.status, r.stripe_refund_id], ["created", true, "submitted", s.R.id], "a read bound it first, the answer is the same refund: created, already_bound");
  eq(await requestRow(db, s.reqId), before, "…the row is unchanged");
});

await group("finish_unconfirmed_after_a_read_bound_it_says_so", async (db) => {
  const s = await boundScene(db);
  const before = await requestRow(db, s.reqId);
  const r = await finish(db, s.reqId, "unconfirmed", null, "timeout", "the answer was lost");
  eq([r.result, r.status, r.stripe_refund_id], ["already_bound_unconfirmed_answer", "submitted", s.R.id], "a timeout delivered after a read bound the row: already_bound_unconfirmed_answer");
  eq(await requestRow(db, s.reqId), before, "…the row is unchanged");
});

await group("finish_with_another_refund_is_a_conflict", async (db) => {
  const s = await boundScene(db);
  const before = await requestRow(db, s.reqId);
  const r = await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000));
  eq([r.result, r.stripe_refund_id], ["answer_conflict", s.R.id], "bound to one refund, answered with ANOTHER: answer_conflict");
  eq(await requestRow(db, s.reqId), before, "…nothing written to the row");
  const o = await another(db, s);
  const t = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 1000 });
  const r2 = t.reserved.requests[0];
  await arm(db, r2);
  const c = await finish(db, r2.id, "created", answerOf(o.p, r2.id, 1000, { id: s.R.id }));
  eq([c.result, c.status], ["answer_conflict", "pending"], "a pending row answered with a refund ANOTHER request holds: answer_conflict, still pending");
  eq((await requestRow(db, r2.id)).last_error_code, "answer_conflict", "…recorded");
});

await group("finish_after_release_changes_nothing_and_says_so", async (db) => {
  const s = await armedScene(db);
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  const rd = await after24h(db, s.p);
  eq((await release(db, s.owner, s.reqId, rd.read_token)).result, "released", "released after 24 h");
  const before = await requestRow(db, s.reqId);
  eq((await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000))).result, "answered_after_release", "a refund came back for a released row: answered_after_release");
  eq((await finish(db, s.reqId, "unconfirmed", null, "timeout", null)).result, "closed", "an unconfirmed answer for it: closed");
  eq(await requestRow(db, s.reqId), before, "…nothing written to the row either time");
});

await group("unconfirmed_stays_reserved_and_blocks", async (db) => {
  const s = await armedScene(db);
  const r = await finish(db, s.reqId, "unconfirmed", null, "timeout", "no answer");
  eq([r.result, r.status, r.armed], ["unconfirmed", "pending", true], "no 2xx: unconfirmed, the row stays reserved");
  eq((await requestRow(db, s.reqId)).last_error_code, "timeout", "…with the transport's code");
  const rd = await settleAndRead(db, s.p);
  eq(rd.result, "complete", "(a complete read after settling)");
  const f = await figures(db, s.p.id);
  eq([f.state, f.blocked, f.in_flight, f.refundable], ["known", true, 1000, 0], "it blocks the payment: known, blocked, 0 refundable");
  await raises(() => tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 100 }), "nothing_refundable", "a new press");
  eq((await arm(db, s.req)).result, "not_armable", "it is never armed (POSTed) again");
  eq((await rpc(db, "catering_refund_cancel_unarmed", [s.reqId, "x"])).result, "not_cancelled", "…and cannot be cancelled as never sent");
  check((await dueNow(db)).a.includes(s.p.id), "the sweep looks for it every run");
});

await group("read_binds_only_the_unique_candidate_of_a_complete_read", async (db) => {
  const s = await armedScene(db, { amount: 1000, captured: 10000 });
  const f0 = await figures(db, s.p.id);
  eq([f0.in_flight, f0.blocked], [1000, true], "before: in flight 1000, blocked");
  const R = refundOf(s.p, 1000, { request: s.reqId, created: Math.floor(s.armedEpoch) + 1 });
  const nc = await read(db, s.p, { refunds: [R], lists: listsOf([R], { chargeTerminal: false }) });
  eq([nc.result, nc.bound], ["not_complete", []], "the same refund in a read that did NOT end complete binds nothing");
  eq([(await requestRow(db, s.reqId)).status, (await requestRow(db, s.reqId)).stripe_refund_id], ["pending", null], "…the request is still pending, no refund id");
  const c = await read(db, s.p, { refunds: await current(db, [R]) });
  eq(c.bound, [{ request_id: s.reqId, refund_id: R.id }], "a complete read binds the unique candidate");
  const row = await requestRow(db, s.reqId);
  eq([row.status, row.stripe_refund_id, (await mirror(db, s.p.id))[0].request_id], ["submitted", R.id, s.reqId], "the request is submitted with it; the mirror row names the request");
  const f1 = await figures(db, s.p.id);
  eq([f1.counted, f1.in_flight, f1.blocked], [1000, 0, false], "counted once, no longer in flight, the block lifts");
  await settleAndRead(db, s.p, [R]);
  eq((await figures(db, s.p.id)).refundable, 9000, "after settling: 9000 refundable");
  // Two candidates bind nothing.
  const d2 = await fresh();
  const s2 = await armedScene(d2);
  const c1 = refundOf(s2.p, 1000, { request: s2.reqId, created: Math.floor(s2.armedEpoch) + 1 });
  const c2 = refundOf(s2.p, 1000, { request: s2.reqId, created: Math.floor(s2.armedEpoch) + 2 });
  const r2 = await read(d2, s2.p, { refunds: [c1, c2] });
  eq([r2.result, r2.bound], ["complete", []], "two candidates: a complete read binds nothing");
  eq([await kindsOf(d2, s2.p), (await requestRow(d2, s2.reqId)).status], [{ [c1.id]: "ambiguous", [c2.id]: "ambiguous" }, "pending"], "…both are `ambiguous`; the request stays pending (a person's)");
  const f2 = await figures(d2, s2.p.id);
  eq([f2.counted, f2.in_flight, f2.blocked], [2000, 1000, true], "…both counted, the request still held, still blocked");
  // A refund created one second before the arm's second binds nothing.
  const d3 = await fresh();
  const s3 = await armedScene(d3);
  const early = refundOf(s3.p, 1000, { request: s3.reqId, created: Math.floor(s3.armedEpoch) - 1 });
  eq((await read(d3, s3.p, { refunds: [early] })).bound, [], "a refund created one second before the arm's second binds nothing");
  eq((await kindsOf(d3, s3.p))[early.id], "mismatch", "…it is a `mismatch` claim");
});

await group("claims_that_do_not_match_are_counted_never_bound_and_block_nothing", async (db) => {
  const s = await scene(db, { pays: [["full", 100000]] });
  const P = s.p;
  const tc = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 500 });
  const cancelled = tc.reserved.requests[0].id;
  await rpc(db, "catering_refund_cancel_unarmed", [cancelled, "x"]);
  const tr = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const r = tr.reserved.requests[0].id;
  eq((await arm(db, tr.reserved.requests[0])).result, "armed", "(r is armed)");
  const o = await another(db, s, 10000);
  const tu = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 700 });
  const u = tu.reserved.requests[0].id;
  const at = Math.floor(await armedEpoch(db, r));
  const refunds = [
    refundOf(P, 999, { id: "re_cmamt1", request: r, created: at + 1 }),
    refundOf(P, 1000, { id: "re_cmold1", request: r, created: at - 1 }),
    refundOf(P, 500, { id: "re_cmrel1", request: cancelled, created: at + 1 }),
    refundOf(P, 700, { id: "re_cmfor1", request: u, created: at + 1 }),
    refundOf(P, 50, { id: "re_cmnone1", created: at + 1 }),
  ];
  const r1 = await read(db, P, { refunds });
  eq([r1.result, r1.bound], ["complete", []], "a complete read of claims that do not match: nothing bound");
  eq(await kindsOf(db, P), { re_cmamt1: "mismatch", re_cmold1: "mismatch", re_cmrel1: "released", re_cmfor1: "foreign", re_cmnone1: "none" },
    "another amount and a refund older than the arm = mismatch; a released request = released; another payment's request = foreign; none = none");
  const ru = await read(db, o.p, { refunds: [refundOf(o.p, 700, { id: "re_cmunarmed1", request: u })] });
  eq([ru.bound, (await kindsOf(db, o.p)).re_cmunarmed1], [[], "unarmed"], "a refund naming a request that was never armed: unarmed, never bound");
  const ok = refundOf(P, 1000, { id: "re_cmok1", request: r, created: at + 1 });
  const r2 = await read(db, P, { refunds: [...await current(db, refunds), ok] });
  eq(r2.bound, [{ request_id: r, refund_id: ok.id }], "the matching refund is bound (the mismatches beside it do not stop it)");
  const dup = refundOf(P, 1000, { id: "re_cmdup1", request: r, created: at + 2 });
  const r3 = await read(db, P, { refunds: [...await current(db, [...refunds, ok]), dup] });
  eq([r3.bound, (await kindsOf(db, P)).re_cmdup1, (await kindsOf(db, P)).re_cmold1], [[], "duplicate", "duplicate"], "a second refund naming the bound request: duplicate, never bound");
  const f = await figures(db, P.id);
  eq([f.counted, f.in_flight, f.blocked], [999 + 1000 + 500 + 700 + 50 + 1000 + 1000, 0, false], "every one of them is counted; nothing blocks the payment");
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  const all = await current(db, [...refunds, ok, dup]);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 100, readOptions: () => ({ refunds: all }) });
  eq(t.reserved.requests.length, 1, "a new press reserves: the claims block nothing");
});

await group("attach_binds_a_retrieved_refund_and_sends_nothing", async (db) => {
  const s = await armedScene(db, { amount: 1000, captured: 10000 });
  const gm = await s.w.user("gm");
  const o = await another(db, s);
  const tu = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 1000 });
  const u = tu.reserved.requests[0].id;
  await legacyRow(db, { p: s.p, quote: s.q, shop: s.w.shop, by: s.owner, status: "submitted", refundId: "re_atheld1", amount: 1000 }); // holds re_atheld1
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  const at = Math.floor(await armedEpoch(db, s.reqId));
  const good = refundOf(s.p, 1000, { id: "re_atgood1", created: at + 1 });
  const refunds = [good,
    refundOf(s.p, 999, { id: "re_atamt1", created: at + 1 }),
    refundOf(s.p, 1000, { id: "re_atother1", request: u, created: at + 1 }),
    refundOf(s.p, 1000, { id: "re_atheld1", created: at + 1 }),
    refundOf(s.p, 1000, { id: "re_atearly1", created: at + 1 })];
  const earlier = await read(db, s.p, { refunds });
  const rd = await read(db, s.p, { refunds });
  eq([rd.result, rd.bound, await st(db, s.p)], ["complete", [], "known"], "a complete read retrieved a refund with NO metadata, the request's amount: nothing bound by itself");
  eq((await attachableOf(db, s.p)).re_atgood1, s.reqId, "…it is attachable to the request");
  const pr = await read(db, o.p, { refunds: [refundOf(o.p, 1000, { id: "re_atp2" })] });
  const before = await requestRow(db, s.reqId);
  // A refund the token's read did NOT retrieve: unreachable through F6 (a complete read retrieves every mirrored id),
  // so the fixture moves one mirror row's read start to before that read.
  await fx(db, "update public.catering_refund_observed set read_started_at = read_started_at - interval '1 second' where refund_id = 're_atearly1'");
  const refusals = [
    ["a GM", () => attach(db, gm, s.reqId, good.id, rd.read_token), "forbidden"],
    ["a refund of another payment", () => attach(db, s.owner, s.reqId, "re_atp2", rd.read_token), "refund_not_attachable"],
    ["another amount", () => attach(db, s.owner, s.reqId, "re_atamt1", rd.read_token), "refund_not_attachable"],
    ["a refund bound (held) elsewhere", () => attach(db, s.owner, s.reqId, "re_atheld1", rd.read_token), "refund_not_attachable"],
    ["a refund naming another request", () => attach(db, s.owner, s.reqId, "re_atother1", rd.read_token), "refund_not_attachable"],
    ["a refund the token's read did not retrieve (mirrored earlier)", () => attach(db, s.owner, s.reqId, "re_atearly1", rd.read_token), "refund_not_attachable"],
    ["an id never mirrored", () => attach(db, s.owner, s.reqId, "re_atnever1", rd.read_token), "refund_not_attachable"],
    ["a stale token (an earlier read's)", () => attach(db, s.owner, s.reqId, good.id, earlier.read_token), "figures_stale"],
    ["a foreign token", () => attach(db, s.owner, s.reqId, good.id, pr.read_token), "figures_stale"],
    ["a request that is not armed", () => attach(db, s.owner, u, "re_atp2", pr.read_token), "not_attachable"],
  ];
  for (const [what, fn, name] of refusals) await raises(fn, name, what);
  await ledger(db, { pi: s.p.pi });
  await raises(() => attach(db, s.owner, s.reqId, good.id, rd.read_token), "figures_stale", "not known (an event since the read)");
  eq([await requestRow(db, s.reqId), await auditCount(db, "catering.refund.attach")], [before, 0], "every refusal changed nothing and wrote no audit row");
  const fin = await settleAndRead(db, s.p, refunds);
  const a = await attach(db, s.owner, s.reqId, good.id, fin.read_token, "seen in the dashboard");
  eq([a.result, a.status, a.refund_id], ["attached", "submitted", good.id], "attached by the owner with a fresh token");
  const row = await requestRow(db, s.reqId);
  eq([row.status, row.stripe_refund_id, row.resolved_by, row.resolved_at !== null], ["submitted", good.id, s.owner, true], "the request is submitted with that refund, resolved by the person");
  eq((await one(db, "select request_id from public.catering_refund_observed where refund_id = $1", [good.id])).request_id, s.reqId, "the mirror row is bound to it");
  const f = await figures(db, s.p.id);
  eq([f.in_flight, f.blocked], [0, false], "counted once (the request is no longer in flight), the block lifts");
  const au = await rows(db, "select actor_id, actor_role, destructive, metadata from public.audit_log where action = 'catering.refund.attach'");
  eq(au.length, 1, "one destructive catering.refund.attach audit row, written after the row moved");
  const m = au[0].metadata;
  eq([au[0].actor_role, au[0].destructive, m.refund_id, m.amount_cents, m.refund_status, m.metadata_named_request, m.account_slot, m.livemode, m.credential_fp, m.has_note],
    ["owner", true, good.id, 1000, "succeeded", false, "default", false, "0123456789abcdef", true], "…naming the refund, its status, the slot, mode and fingerprint; has_note");
  check(!JSON.stringify(au[0]).includes("dashboard") && m.refund_created_at && m.armed_at, "…never the note text; the refund's created time and the arm's instant");
  await raises(() => attach(db, s.owner, s.reqId, good.id, fin.read_token), "not_attachable", "a request that is no longer pending and armed");
  eq(await reqCount(db), 3, "it created nothing (no request row, and the SQL has no way to reach Stripe)");
});

await group("two_candidates_are_resolved_by_attach_not_release", async (db) => {
  const s = await armedScene(db);
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  const c1 = refundOf(s.p, 1000, { id: "re_tc1", request: s.reqId, created: Math.floor(s.armedEpoch) + 1 });
  const c2 = refundOf(s.p, 1000, { id: "re_tc2", request: s.reqId, created: Math.floor(s.armedEpoch) + 2 });
  const rd = await after24h(db, s.p, [c1, c2]);
  eq([rd.result, rd.bound], ["complete", []], "two candidates: nothing bound by the read");
  eq(await kindsOf(db, s.p), { re_tc1: "ambiguous", re_tc2: "ambiguous" }, "…both ambiguous");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token), "refund_candidates", "release");
  eq((await attach(db, s.owner, s.reqId, "re_tc1", rd.read_token)).result, "attached", "attach of one");
  eq((await kindsOf(db, s.p)).re_tc2, "duplicate", "the other is then a duplicate claim");
  eq((await figures(db, s.p.id)).counted, 2000, "…still counted");
});

await group("release_needs_24_hours_a_token_read_after_them_a_release_role_the_right_account_and_a_releasable_finding", async (db) => {
  const s = await armedScene(db);
  const o = await another(db, s);
  const t3 = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 1000 });
  const r3 = t3.reserved.requests[0];
  await arm(db, r3);
  const gm = await s.w.user("gm");
  const moo = await s.w.user("moo");
  const mooElsewhere = await s.w.user("moo", { member: s.w.other });
  const cgs = await s.w.user("cgs", { member: null });
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  const press = await read(db, s.p);
  await raises(() => release(db, gm, s.reqId, press.read_token), "forbidden", "a GM");
  await raises(() => release(db, mooElsewhere, s.reqId, press.read_token), "forbidden", "a MoO of another shop");
  try { await release(db, s.owner, s.reqId, press.read_token); check(false, "not_releasable_yet (no error)"); }
  catch (e) {
    const want = (await one(db, "select to_char((create_armed_at + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as d from public.catering_refund_requests where id = $1", [s.reqId])).d;
    eq([e.message, e.detail], ["not_releasable_yet", want], "before 24 hours: not_releasable_yet, with the instant");
  }
  await elapse(db, "24 hours 1 minute");
  await keepAlive(db);
  await raises(() => release(db, s.owner, s.reqId, press.read_token), "figures_stale", "after 24 h with a token read BEFORE them");
  const mis = refundOf(s.p, 999, { request: s.reqId, created: Math.floor(await armedEpoch(db, s.reqId)) + 1 });
  const rd = await read(db, s.p, { refunds: [mis] });
  eq([rd.result, (await kindsOf(db, s.p))[mis.id]], ["complete", "mismatch"], "a fresh complete read (with a mismatching claim)");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token, "request_succeeded"), "use_attach", "finding request_succeeded");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token, "unclear"), "finding_not_releasable", "finding unclear (a timeout or an unreadable log)");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token, null), "finding_not_releasable", "no finding");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token, "no_request", "location", false), "wrong_account", "the other slot");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token, "no_request", "default", true), "wrong_account", "the other mode");
  await raises(() => release(db, s.owner, s.reqId, randomUUID()), "figures_stale", "a forged token");
  eq([(await requestRow(db, s.reqId)).status, await auditCount(db, "catering.refund.release")], ["pending", 0], "every refusal changed nothing, no audit row");
  const r = await release(db, moo, s.reqId, rd.read_token, "no_request", "default", false, "the request log was empty");
  eq([r.result, r.status], ["released", "failed"], "a MoO of the request's shop, 24 h on, a fresh token, the right account and mode, finding no_request: released (a mismatching claim did not refuse)");
  const row = await requestRow(db, s.reqId);
  eq([row.status, row.last_error_code, row.resolved_by, row.stripe_refund_id], ["failed", "released_no_refund", moo, null], "the row: failed, released_no_refund, resolved by the MoO");
  const au = await rows(db, "select actor_id, actor_role, destructive, metadata from public.audit_log where action = 'catering.refund.release'");
  eq(au.length, 1, "one destructive catering.refund.release audit row, only after the row moved");
  const m = au[0].metadata;
  eq([au[0].actor_role, au[0].destructive, m.finding, m.account_slot, m.livemode, m.credential_fp, m.unmatched_claims, m.has_note, m.amount_cents],
    ["moo", true, "no_request", "default", false, "0123456789abcdef", 1, true, 1000], "…with the finding, the slot and mode, the fingerprint, the unmatched claim counted, has_note");
  check(!JSON.stringify(au[0]).includes("request log was empty"), "…never the note text");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token), "not_releasable", "a second release of the same row");
  // The other releasable finding, by the CGS (any shop).
  const rd3 = await read(db, o.p);
  eq((await release(db, cgs, r3.id, rd3.read_token, "request_failed")).result, "released", "finding request_failed, by the CGS: released");
  const t4 = await tap(db, { actor: s.owner, quoteId: o.q, payments: [o.p], amount: 500, readOptions: () => ({}) });
  await raises(() => release(db, s.owner, t4.reserved.requests[0].id, t4.reads[0].read_token), "not_releasable", "an unarmed row (F11's, not a release)");
});

await group("bind_and_release_in_both_orders", async (db) => {
  // Bind first, then release.
  const s = await armedScene(db);
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  const R = refundOf(s.p, 1000, { request: s.reqId, created: Math.floor(s.armedEpoch) + 1 });
  const rd = await after24h(db, s.p, [R]);
  eq(rd.bound, [{ request_id: s.reqId, refund_id: R.id }], "bind first: the read binds it");
  await raises(() => release(db, s.owner, s.reqId, rd.read_token), "not_releasable", "…then the release");
  // Release first, then the refund appears.
  const d2 = await fresh();
  const s2 = await armedScene(d2);
  await finish(d2, s2.reqId, "unconfirmed", null, "timeout", null);
  const rd2 = await after24h(d2, s2.p);
  eq((await release(d2, s2.owner, s2.reqId, rd2.read_token)).result, "released", "release first: released");
  const R2 = refundOf(s2.p, 1000, { request: s2.reqId, created: Math.floor(await armedEpoch(d2, s2.reqId)) + 1 });
  const b = await read(d2, s2.p, { refunds: [R2] });
  eq([b.result, b.bound, (await requestRow(d2, s2.reqId)).status], ["complete", [], "failed"], "…then a read meets its refund: nothing bound, the row stays failed");
  eq([(await kindsOf(d2, s2.p))[R2.id], (await figures(d2, s2.p.id)).counted], ["released", 1000], "…a released claim, counted");
});

await group("released_then_the_refund_appears", async (db) => {
  const s = await armedScene(db);
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  const rd = await after24h(db, s.p);
  await release(db, s.owner, s.reqId, rd.read_token);
  const before = await requestRow(db, s.reqId);
  const R = refundOf(s.p, 1000, { request: s.reqId, created: Math.floor(await armedEpoch(db, s.reqId)) + 60 });
  await read(db, s.p, { refunds: [R] });
  const inv = await inventory(db);
  eq([inv.counts.released_with_refund, inv.lists.claims.find((c) => c.refund_id === R.id)?.kind], [1, "released"], "the inventory counts a released request whose refund later appeared");
  eq(await requestRow(db, s.reqId), before, "the request is unchanged (a person reads the inventory)");
  const f = await figures(db, s.p.id);
  eq([f.counted, f.in_flight], [1000, 0], "the refund is counted, the released request is not in flight");
  eq((await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000, { id: R.id }))).result, "answered_after_release", "a late answer for it: answered_after_release");
});

await group("attach_and_finish_in_both_orders", async (db) => {
  // Attach first, then the POST's answer arrives.
  const s = await armedScene(db);
  const R = refundOf(s.p, 1000, { created: Math.floor(s.armedEpoch) + 1 });
  const rd = await settleAndRead(db, s.p, [R]);
  eq((await attach(db, s.owner, s.reqId, R.id, rd.read_token)).result, "attached", "attach first");
  const same = await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000, { id: R.id }));
  eq([same.result, same.already_bound], ["created", true], "…then the matching answer for the same refund: created, already_bound");
  eq((await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000))).result, "answer_conflict", "…an answer naming another refund: answer_conflict");
  // The answer first, then a person tries to attach.
  const d2 = await fresh();
  const s2 = await armedScene(d2);
  const ans = answerOf(s2.p, s2.reqId, 1000);
  eq((await finish(d2, s2.reqId, "created", ans)).result, "created", "finish first: created");
  const rd2 = await settleAndRead(d2, s2.p, [refundOf(s2.p, 1000, { id: ans.id, request: s2.reqId, created: Math.floor(await armedEpoch(d2, s2.reqId)) + 1 })]);
  await raises(() => attach(d2, s2.owner, s2.reqId, ans.id, rd2.read_token), "not_attachable", "…then the attach");
});

await group("crash_after_reserve_is_cancelled_by_the_sweep", async (db) => {
  const s = await scene(db);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const id = t.reserved.requests[0].id;
  eq((await dueNow(db)).stale_unarmed, [], "a fresh reserved row is not stale");
  await elapse(db, "15 minutes 1 second");
  await keepAlive(db);
  const c = await rpc(db, "catering_refund_sweep_begin", [50]);
  eq(c.due.stale_unarmed, [id], "15 minutes on, the sweep's work list names the unarmed row");
  const x = await rpc(db, "catering_refund_cancel_unarmed", [id, "stale_unarmed"]);
  eq([x.result, x.status], ["cancelled", "failed"], "F11 cancels it");
  eq((await requestRow(db, id)).last_error_code, "never_sent", "…as never sent");
  eq((await dueNow(db)).stale_unarmed, [], "…and it is gone from the list");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H — sweep and inventory
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
await group("sweep_begin_is_the_one_claim_and_the_work_list", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000]] });
  await read(db, s.pays[0]);
  await elapse(db, "50 minutes");
  await keepAlive(db);
  const c = await rpc(db, "catering_refund_sweep_begin", [50]);
  check(c.claimed === true && /^[0-9a-f-]{36}$/.test(c.claim_id), "a claim, with its id");
  eq([c.due.a, c.due.c], [[s.pays[1].id], [s.pays[0].id]], "…and its work list in the same answer: class A (never read) and class C (the re-read), separately");
  const o = await one(db, "select last_claim_id, lease_until > clock_timestamp() as held, last_claim_at from public.catering_refund_observation");
  check(o.last_claim_id === c.claim_id && o.held, "the lease is held on B1's own row, with the claim id");
  eq(await rpc(db, "catering_refund_sweep_begin", [50]), { claimed: false, reason: "busy" }, "a second run while the lease is held: busy");
  // A failure while selecting the work leaves no claim (the fixture owner makes F14 fail).
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  const before = await one(db, "select * from public.catering_refund_observation");
  await db.exec("create or replace function public.catering_refund_sweep_due(p_limit integer) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$ begin raise exception 'work_list_failed'; end $$");
  await refuses(() => rpc(db, "catering_refund_sweep_begin", [50]), "work_list_failed", "the work list fails");
  eq(await one(db, "select * from public.catering_refund_observation"), before, "…and the claim was not recorded either (no lease, no claim instant, no claim id)");
});

await group("sweep_due_classes", async (db) => {
  const s = await scene(db, { pays: Array.from({ length: 7 }, () => ["full", 10000]) });
  const [never, dirty, aband, trans, day100, day130, quiet] = s.pays;
  for (const p of [dirty, aband, trans, day100, day130, quiet]) await read(db, p);
  const ou = await another(db, s);
  const tu = await tap(db, { actor: s.owner, quoteId: ou.q, payments: [ou.p], amount: 100 });
  await arm(db, tu.reserved.requests[0]);
  const U = ou.p;
  const A = async () => (await dueNow(db)).a;
  const C = async () => (await dueNow(db)).c;
  check((await A()).includes(never.id), "never read: class A");
  check((await A()).includes(U.id), "an armed unresolved request: class A at once (every run), whatever its dirty instant");
  await ledger(db, { pi: dirty.pi });
  check(!(await A()).includes(dirty.id), "dirty by an event just now: NOT yet due (a read before the settle interval would be wasted)");
  await begin(db, aband.id);
  check(!(await A()).includes(aband.id) && !(await C()).includes(aband.id), "a read in flight: in neither list (a begin would replace it)");
  await fx(db, "update public.catering_refund_payment_state set last_complete_read_transitions = last_complete_read_transitions - 1 where payment_id = $1", [trans.id]);
  eq(await st(db, trans), "dirty", "(a moved transition count: dirty)");
  await fx(db, "update public.catering_payments set paid_at = clock_timestamp() - interval '130 days' where id = $1", [day130.id]);
  await fx(db, "update public.catering_payments set paid_at = clock_timestamp() - interval '130 days' where id = $1", [day100.id]);
  await read(db, day100, { refunds: [refundOf(day100, 100, { created: Math.floor(await nowEpoch(db)) - 100 * 86400 })] });
  await read(db, day130, { refunds: [refundOf(day130, 100, { created: Math.floor(await nowEpoch(db)) - 130 * 86400 })] });
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  check((await A()).includes(dirty.id), "dirty only after 5 minutes: now class A");
  check((await A()).includes(trans.id), "a moved transition count: class A");
  await elapse(db, "40 minutes");
  await keepAlive(db);
  const a1 = await A();
  check(a1.includes(aband.id), "an abandoned read (opened 45 minutes ago, never recorded): class A");
  const c1 = await C();
  check(c1.includes(day100.id), "known, read 45 minutes ago or more, a succeeded refund 100 days old: class C");
  check(!c1.includes(day130.id), "…130 days old: not due");
  check(c1.includes(quiet.id), "…paid 2 days ago: due");
  // Least recently attempted first: `never` (never attempted) heads the list; then by last attempt.
  const order = a1.filter((id) => [never.id, dirty.id, trans.id, aband.id].includes(id));
  eq(order[0], never.id, "least recently attempted first: a never-attempted payment heads class A");
  const att = await rows(db, "select payment_id, last_attempt_at from public.catering_refund_payment_state where payment_id = any($1::uuid[]) order by last_attempt_at, payment_id", [[dirty.id, trans.id, aband.id]]);
  eq(order.slice(1), att.map((r) => r.payment_id), "…then oldest attempt first");
  // Unprovable coverage once a day (a database whose ledger cannot prove the window).
  const d2 = await fresh();
  const w2 = await world(d2);
  const q2 = await w2.quote();
  const p2 = await w2.pay(q2, "full", 1000);
  await rpc(d2, "catering_refund_observe_set", [true]);
  await rpc(d2, "catering_refund_sweep_begin", [50]);
  await elapse(d2, "10 minutes");
  await read(d2, p2);
  eq((await one(d2, "select public.catering_refund_dirty_at($1) = 'infinity' as x", [p2.id])).x, true, "(coverage unprovable)");
  check(!(await dueNow(d2)).a.includes(p2.id), "unprovable coverage, last attempt just now: not due");
  await elapse(d2, "20 hours 1 minute");
  await keepAlive(d2);
  check((await dueNow(d2)).a.includes(p2.id), "…20 hours after the last attempt: class A (once a day)");
});

await group("sweep_due_reads_the_ledger_once", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000], ["full", 1000]] });
  for (const p of s.pays) await read(db, p);
  for (let i = 0; i < 5; i++) await ledger(db, { pi: i < 2 ? s.pays[i].pi : `pi_none_${i}` });
  const w = (await one(db, "select min(last_complete_read_started_at) - interval '5 minutes' as w from public.catering_refund_payment_state")).w;
  const inWindow = await count(db, "select count(*) as n from public.stripe_events where received_at > $1", [w]);
  const due = await dueNow(db);
  eq([due.counts.ledger_rows_read, inWindow], [5, 5], "ledger_rows_read = the rows in the window (5), not rows x payments (15); the 30-day ping is outside it");
  eq([due.states[s.pays[0].id], due.states[s.pays[1].id], due.states[s.pays[2].id]], ["dirty", "dirty", "known"], "…and the one pass still attributes each row to its payment");
});

await group("inventory_counts_and_lists", async (db) => {
  // A 0357 row first (base at 0358), then 0359.
  const w = await world(db);
  const owner = await w.user("owner", { member: null });
  const q = await w.quote();
  const pL = await w.pay(q, "full", 10000);
  const legacy = await legacyRow(db, { p: pL, quote: q, shop: w.shop, by: owner, attempts: 1, firstAttempt: "2 hours", updatedAgo: "2 hours" });
  await db.exec(M0359);
  await withPartsReady(db);
  const s = { w, owner, q };
  const mk = async (amount = 10000, opts = {}) => (await another(db, s, amount, opts)).p;
  await mk(); // a payment that is never read
  const pKnown = await mk(), pConflict = await mk(), pOpen = await mk(), pClaims = await mk();
  const qd = await w.quote();
  const pDue = await w.pay(qd, "balance", 500, { status: "due", session: "cs_test_unsettled1" });
  await observing(db);
  await read(db, pKnown, { refunds: [refundOf(pKnown, 100, { id: "re_invz1" })] });
  await read(db, pConflict);
  const rc = await read(db, pConflict, { refunds: [refundOf(pConflict, 100, { id: "re_invz1" })] });
  eq(rc.reason, "evidence_conflict", "(a conflict)");
  await begin(db, pOpen.id);
  const tq = await tap(db, { actor: owner, quoteId: (await one(db, "select quote_id from public.catering_payments where id = $1", [pClaims.id])).quote_id, payments: [pClaims], amount: 1000 });
  const rq = tq.reserved.requests[0];
  await arm(db, rq);
  const at = Math.floor(await armedEpoch(db, rq.id));
  await read(db, pClaims, { refunds: [refundOf(pClaims, 999, { request: rq.id, created: at + 1 }), refundOf(pClaims, 1000, { id: "re_invatt1", created: at + 1 })] });
  const inv = await inventory(db);
  const o = await one(db, "select * from public.catering_refund_observation");
  eq([inv.observation.observe_on, Number(inv.observation.transitions), inv.observation.live, inv.observation.last_claim_at !== null], [o.observe_on, Number(o.transitions), true, true], "the observation as recorded (ON, the count, live, the claim)");
  eq(inv.counts.in_scope, 6, "in scope: the six eligible payments (the due checkout is not)");
  eq([inv.counts.never_read, inv.counts.known], [3, 1], "never read (the legacy payment, one more, the one with only an open read); known");
  eq(inv.counts.dirty, 2, "dirty: the conflict, and the claims payment after its arm");
  eq([inv.counts.not_complete, inv.not_complete_by_reason], [1, { evidence_conflict: 1 }], "not complete, by reason");
  check(inv.lists.not_complete.some((x) => x.payment_id === pConflict.id && x.conflict_with === pKnown.id), "…with both ids of the conflict");
  eq([inv.counts.open_reads, inv.lists.open_reads.map((x) => x.payment_id)], [1, [pOpen.id]], "open reads");
  eq(inv.counts.claims, { mismatch: 1 }, "claims by kind");
  eq([inv.counts.attachable, inv.lists.claims.find((c) => c.refund_id === "re_invatt1")?.attachable_to], [1, rq.id], "attachable refunds, with the request");
  eq([inv.counts.legacy_attempted, inv.counts.unconfirmed, inv.counts.unresolved_requests], [1, 2, 2], "a 0357 row (legacy attempted); unconfirmed; unresolved");
  check(inv.lists.unresolved_requests.some((x) => x.request_id === legacy && x.legacy === true), "…the 0357 row listed as legacy");
  eq([inv.counts.unsettled_checkouts, inv.lists.unsettled_checkouts], [1, [{ payment_id: pDue.id, status: "due" }]], "unsettled_checkouts: a due row carrying a session, reported as NOT covered");
  const oldest = await one(db, "select min(coalesce(s.last_complete_read_started_at, p.paid_at, p.created_at)) as t from public.catering_payments p left join public.catering_refund_payment_state s on s.payment_id = p.id cross join lateral public.catering_refund_payment_figures(p.id) f where f.o_eligible and f.o_state <> 'known'");
  eq(new Date(inv.oldest_unchecked_at).getTime(), oldest.t.getTime(), "oldest_unchecked_at: the oldest payment in scope that is not known");
  check(JSON.stringify(inv).length < 20000 && !/name|email|phone/i.test(JSON.stringify(Object.keys(inv.lists))), "ids, cents, states and instants only");
  await claimAgo(db, "61 minutes");
  const inv2 = await inventory(db);
  eq([inv2.counts.paused, inv2.observation.live], [6, false], "the sweep not live: every payment paused");
}, { upTo: "0358" });

await group("sweep_due_agrees_with_figures", async (db) => {
  const s = await scene(db, { pays: Array.from({ length: 7 }, () => ["full", 10000]) });
  const [never, stamp, event, unprovable, moved, known, open] = s.pays;
  for (const p of [stamp, event, unprovable, moved, known, open]) await read(db, p);
  await read(db, stamp, { result: "provider_timeout" });
  await ledger(db, { charge: event.charge });
  await fx(db, "update public.catering_refund_payment_state set last_complete_read_started_at = last_complete_read_started_at - interval '31 days' where payment_id = $1", [unprovable.id]);
  await fx(db, "update public.catering_refund_payment_state set last_complete_read_transitions = last_complete_read_transitions - 1 where payment_id = $1", [moved.id]);
  await begin(db, open.id);
  const want = { [never.id]: "never_read", [stamp.id]: "dirty", [event.id]: "dirty", [unprovable.id]: "dirty", [moved.id]: "dirty", [known.id]: "known", [open.id]: "known" };
  const compare = async (when) => {
    const due = await dueNow(db);
    const fig = {};
    for (const p of s.pays) fig[p.id] = await st(db, p);
    eq(due.states, fig, `${when}: sweep_due's states equal payment_figures' o_state for every payment`);
    return fig;
  };
  eq(await compare("at once"), want, "…and they are the expected mix (never read, dirty by stamp / event / unprovable coverage / moved count, known, an open read)");
  await elapse(db, "16 minutes");
  await keepAlive(db);
  const later = await compare("16 minutes on (the open read abandoned)");
  eq(later[open.id], "dirty", "…the abandoned read is dirty in both");
  const o2 = await another(db, s);
  await tap(db, { actor: s.owner, quoteId: o2.q, payments: [o2.p], amount: 100 }).then((t) => arm(db, t.reserved.requests[0]));
  s.pays.push(o2.p);
  await compare("after an arm");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H — section 15.3 (the rulings, by id)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
await group("t1_strict_arm_time_never_binds_a_pre_arm_refund", async (db) => {
  for (const [what, delta, binds] of [["created a second before the arm's second", -1, false], ["created in the arm's own second", 0, null], ["created after it", 1, true]]) {
    const d = delta === -1 ? db : await fresh();
    const s = await armedScene(d);
    const R = refundOf(s.p, 1000, { request: s.reqId, created: Math.floor(s.armedEpoch) + delta });
    const expect = binds ?? (Math.floor(s.armedEpoch) === s.armedEpoch);
    const r = await read(d, s.p, { refunds: [R] });
    eq(r.bound.length === 1, expect, `${what}: ${expect ? "bound" : "NOT auto-bound"} (the arm's full precision)`);
    if (!expect) {
      eq([(await kindsOf(d, s.p))[R.id], (await attachableOf(d, s.p))[R.id]], ["mismatch", s.reqId], `${what}: a mismatch claim, attachable by a person`);
    }
  }
  const d4 = await fresh();
  const s4 = await armedScene(d4);
  const forged = refundOf(s4.p, 1000, { request: s4.reqId, created: Math.floor(s4.armedEpoch) - 3600 });
  eq((await read(d4, s4.p, { refunds: [forged] })).bound, [], "forged metadata on an earlier refund does not bind");
  eq((await requestRow(d4, s4.reqId)).status, "pending", "…the request stays pending");
});

await group("t1_attach_has_no_time_condition", async (db) => {
  for (const [what, delta, meta] of [["a refund created in the arm's own second (no metadata)", 0, false], ["a refund created a second early (naming the request)", -1, true]]) {
    const d = delta === 0 ? db : await fresh();
    const s = await armedScene(d);
    await elapse(d, "5 minutes 1 second"); // settle first: the refund's `created` is then taken against the arm as it now stands
    await keepAlive(d);
    const R = refundOf(s.p, 1000, { request: meta ? s.reqId : null, created: Math.floor(await armedEpoch(d, s.reqId)) + delta });
    const rd = await read(d, s.p, { refunds: [R] });
    eq(await st(d, s.p), "known", `${what}: (known)`);
    eq([rd.bound, (await attachableOf(d, s.p))[R.id]], [[], s.reqId], `${what}: not auto-bound, attachable`);
    eq((await attach(d, s.owner, s.reqId, R.id, rd.read_token)).result, "attached", `${what}: attached`);
  }
});

await group("t2_a_replaced_read_marks_dirty", async (db) => {
  const s = await scene(db);
  const A = await begin(db, s.p.id);
  const B = await begin(db, s.p.id);
  const rb = await record(db, s.p.id, B.read_id, { owner: ownerOf(s.p), lists: listsOf([]), refunds: [] });
  eq(rb.result, "complete", "A opens, B replaces, B records complete");
  eq(await st(db, s.p), "dirty", "…B is NOT known (the replacement stamped dirty at B's start)");
  await raises(() => reserveWith(db, s, [{ payment_id: s.p.id, read_token: rb.read_token }]), "figures_stale", "…and cannot reserve");
  const d0 = (await stateRow(db, s.p.id)).dirty_since;
  const ra = await record(db, s.p.id, A.read_id, { owner: ownerOf(s.p), lists: listsOf([]), refunds: [] });
  eq(ra.result, "read_replaced", "A's late record answers read_replaced");
  const row = await stateRow(db, s.p.id);
  check(+row.dirty_since > +d0 && row.last_attempt_result === "read_replaced", "…and stamps again");
  // A crashed read replaced every 14 minutes is dirty each time.
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  await read(db, s.p);
  eq(await st(db, s.p), "known", "(known again)");
  await begin(db, s.p.id);
  for (const n of [1, 2, 3]) {
    await elapse(db, "14 minutes");
    await keepAlive(db);
    eq(await st(db, s.p), n === 1 ? "known" : "dirty", `crash ${n}: 14 minutes after the open read (under the 15-minute rule) it is ${n === 1 ? "still known" : "dirty from the previous replacement"}`);
    await begin(db, s.p.id);
    eq(await st(db, s.p), "dirty", `crash ${n}: the replacing begin makes it dirty at once`);
  }
});

await group("t3_reread_is_hourly_inside_120_days", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000], ["full", 1000]] });
  const [p, old, hole] = s.pays;
  await fx(db, "update public.catering_payments set paid_at = clock_timestamp() - interval '130 days' where id = $1", [old.id]);
  for (const x of s.pays) await read(db, x);
  eq((await one(db, "select extract(epoch from public.catering_refund_reread_interval())::int as s")).s, 2700, "the re-read interval is 45 minutes");
  await elapse(db, "44 minutes");
  await keepAlive(db);
  check(!(await dueNow(db)).c.includes(p.id), "a known payment read 44 minutes ago: not due");
  await elapse(db, "1 minute");
  await keepAlive(db);
  const c = (await dueNow(db)).c;
  check(c.includes(p.id), "45 minutes: due (class C)");
  check(!c.includes(old.id), "activity 130 days ago: not due");
  await read(db, hole);
  eq(await st(db, hole), "known", "(known)");
  const ev = await ledger(db, { pi: hole.pi });
  eq(await st(db, hole), "dirty", "an event dirties it…");
  await db.query("delete from public.stripe_events where id = $1", [ev]);
  eq(await st(db, hole), "known", "…a ledger row deleted INSIDE the window leaves the payment known: the stated residual [T3]");
});

await group("t4_never_read_payment_waits_after_turn_on_and_resume", async (db) => {
  const w = await world(db);
  const q = await w.quote();
  const p = await w.pay(q, "full", 1000);
  const p2 = await w.pay(q, "full", 1000);
  await ledger(db, { type: "ping", ago: "30 days" });
  await rpc(db, "catering_refund_observe_set", [true]);
  await rpc(db, "catering_refund_sweep_begin", [50]);
  await elapse(db, "4 minutes 59 seconds");
  await read(db, p);
  eq(await st(db, p), "dirty", "a never-read payment read 4:59 after the turn-on: not known");
  await elapse(db, "1 second");
  await read(db, p);
  eq(await st(db, p), "known", "read 5:00 after it: known");
  // A resume (the last claim 60 minutes or more ago): p2 has NO state row.
  await claimAgo(db, "61 minutes");
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  check((await stateRow(db, p2.id)) === undefined, "(p2 has no state row)");
  const c = await rpc(db, "catering_refund_sweep_begin", [50]);
  eq([c.resumed, (await one(db, "select resumed_at = last_claim_at as x from public.catering_refund_observation")).x], [true, true], "a claim after a gap resumes and records the instant");
  await read(db, p2);
  eq(await st(db, p2), "dirty", "a never-read payment (no state row) read at once after the resume: not known");
  await elapse(db, "5 minutes 1 second");
  await keepAlive(db);
  await read(db, p2);
  eq(await st(db, p2), "known", "5 minutes after the resume: known");
});

await group("t5_credential_fingerprint_at_arm", async (db) => {
  const s = await armedScene(db);
  const row = await requestRow(db, s.reqId);
  eq([row.arm_account_slot, row.arm_livemode, row.arm_credential_fp], ["default", false, "0123456789abcdef"], "the arm copies the read's slot, mode and fingerprint onto the request");
  await finish(db, s.reqId, "unconfirmed", null, "timeout", null);
  for (const [what, over] of [["a changed fingerprint", { fp: "fedcba9876543210" }], ["a changed slot", { slot: "location" }], ["a changed mode", { livemode: true }]]) {
    await elapse(db, "24 hours 1 minute");
    await keepAlive(db);
    const rd = await read(db, s.p, { owner: ownerOf(s.p, over) });
    eq([rd.result, await st(db, s.p)], ["complete", "known"], `${what}: a fresh complete read (known)`);
    await raises(() => release(db, s.owner, s.reqId, rd.read_token, "no_request", over.slot ?? "default", over.livemode ?? false), "credential_changed", `${what}: release`);
    await raises(() => attach(db, s.owner, s.reqId, "re_any1", rd.read_token), "credential_changed", `${what}: attach`);
  }
  eq((await requestRow(db, s.reqId)).status, "pending", "a refused request stays reserved (the CC exit)");
  const rd = await read(db, s.p);
  eq((await release(db, s.owner, s.reqId, rd.read_token)).result, "released", "the same credential again: released");
  const m = (await one(db, "select metadata from public.audit_log where action = 'catering.refund.release'")).metadata;
  eq([m.account_slot, m.livemode, m.credential_fp], ["default", false, "0123456789abcdef"], "the release audit row carries all three");
  // Attach's audit row, and a backfilled row (no fingerprint) is refused.
  const d2 = await fresh();
  const s2 = await armedScene(d2);
  const R = refundOf(s2.p, 1000, { created: Math.floor(s2.armedEpoch) + 1 });
  const rd2 = await settleAndRead(d2, s2.p, [R]);
  await attach(d2, s2.owner, s2.reqId, R.id, rd2.read_token);
  const m2 = (await one(d2, "select metadata from public.audit_log where action = 'catering.refund.attach'")).metadata;
  eq([m2.account_slot, m2.livemode, m2.credential_fp], ["default", false, "0123456789abcdef"], "the attach audit row carries all three");
  const o = await another(d2, s2);
  const leg = await legacyRow(d2, { p: o.p, quote: o.q, shop: s2.w.shop, by: s2.owner, status: "pending", amount: 500 });
  await fx(d2, "update public.catering_refund_requests set create_armed_at = clock_timestamp() - interval '2 days', arm_payment_intent = $2, attempts = 1, first_attempt_at = clock_timestamp() - interval '2 days' where id = $1", [leg, o.p.pi]);
  const rd3 = await read(d2, o.p);
  await raises(() => release(d2, s2.owner, leg, rd3.read_token), "credential_changed", "a backfilled row (armed, no fingerprint): release");
  await raises(() => attach(d2, s2.owner, leg, "re_any2", rd3.read_token), "credential_changed", "…attach");
  await refuses(() => d2.query("update public.catering_refund_requests set arm_credential_fp = 'aaaaaaaaaaaaaaaa', arm_account_slot = 'default', arm_livemode = false where id = $1", [leg]), "refund_request_immutable",
    "the guard: a credential cannot be added to a row that is already armed");
});

await group("t6_pass_end_stamp", async (db) => {
  await scene(db, { parts: false });
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  const c1 = await rpc(db, "catering_refund_sweep_begin", [50]);
  let inv = await inventory(db);
  eq([inv.observation.last_pass_ended_at, inv.observation.last_pass_is_of_last_claim], [null, false], "a claim with no end: the last claim is newer than the last finished pass");
  const e1 = await rpc(db, "catering_refund_sweep_end", [c1.claim_id, 3, 2]);
  eq(e1.result, "ended", "the run that holds the newest claim ends its pass");
  inv = await inventory(db);
  eq([inv.observation.last_pass_reads, inv.observation.last_pass_complete, inv.observation.last_pass_is_of_last_claim], [3, 2, true], "the inventory shows the finished pass with its read counts");
  await elapse(db, "6 minutes");
  const c2 = await rpc(db, "catering_refund_sweep_begin", [50]);
  check(c2.claimed && c2.claim_id !== c1.claim_id, "a new claim (the next tick)");
  inv = await inventory(db);
  check(inv.observation.last_pass_is_of_last_claim === false && new Date(inv.observation.last_claim_at) > new Date(inv.observation.last_pass_ended_at), "a sweep that claims and dies: the claim is newer than its last finished pass");
  const before = await one(db, "select * from public.catering_refund_observation");
  eq(await rpc(db, "catering_refund_sweep_end", [c1.claim_id, 9, 9]), { result: "superseded" }, "a stale claim id: superseded");
  eq(await one(db, "select * from public.catering_refund_observation"), before, "…nothing written");
});

await group("s7_conflict_with_is_stored", async (db) => {
  const s = await scene(db, { parts: false, pays: [["full", 1000], ["full", 1000]] });
  const [p1, p2] = s.pays;
  await read(db, p2, { refunds: [refundOf(p2, 100, { id: "re_s7x" })] });
  await read(db, p1, { refunds: [refundOf(p1, 100, { id: "re_s7x" })] });
  const row = await stateRow(db, p1.id);
  eq([row.last_attempt_result, row.last_attempt_conflict_with], ["evidence_conflict", p2.id], "the other payment of the conflict is stored on the state row");
  check((await inventory(db)).lists.not_complete.some((x) => x.payment_id === p1.id && x.conflict_with === p2.id), "the inventory lists both from it");
  await read(db, p1, { result: "provider_timeout" });
  eq((await stateRow(db, p1.id)).last_attempt_conflict_with, null, "any other result clears it");
  await read(db, p1, { refunds: [refundOf(p1, 100, { id: "re_s7x" })] });
  await read(db, p1);
  eq([(await stateRow(db, p1.id)).last_attempt_result, (await stateRow(db, p1.id)).last_attempt_conflict_with], ["complete", null], "…a complete read too");
});

await group("s9_finish_same_refund_is_verified", async (db) => {
  const s = await boundScene(db);
  const before = await requestRow(db, s.reqId);
  for (const [what, over] of [["another amount", { amount: 999 }], ["another currency", { currency: "eur" }], ["no request id", { request_id: null }], ["another charge", { charge: "ch_someone_else1" }]]) {
    const r = await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000, { id: s.R.id, ...over }));
    eq([r.result, r.already_bound], ["answer_mismatch", true], `the SAME refund id with ${what}: answer_mismatch`);
  }
  eq(await requestRow(db, s.reqId), before, "…nothing written to the row");
  eq((await finish(db, s.reqId, "created", answerOf(s.p, s.reqId, 1000, { id: s.R.id }))).result, "created", "the verified same refund: created");
});

await group("s12_live_at_5959_paused_at_6000", async (db) => {
  const s = await scene(db, { parts: false });
  await read(db, s.p);
  await claimAgo(db, "59 minutes 59 seconds");
  eq([await st(db, s.p), (await inventory(db)).observation.live], ["known", true], "F3 / F15 at 59:59: live");
  await claimAgo(db, "60 minutes");
  eq([await st(db, s.p), (await inventory(db)).observation.live], ["paused", false], "F3 / F15 at exactly 60:00: paused");
  await claimAgo(db, "59 minutes 59 seconds");
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  eq((await rpc(db, "catering_refund_sweep_begin", [50])).resumed, false, "F13 at 59:59: not resumed");
  await claimAgo(db, "60 minutes");
  await fx(db, "update public.catering_refund_observation set lease_until = null");
  eq((await rpc(db, "catering_refund_sweep_begin", [50])).resumed, true, "F13 at exactly 60:00: resumed (the same comparison as F3)");
});

await group("f10_closed_and_not_armed", async (db) => {
  const s = await scene(db);
  const t = await tap(db, { actor: s.owner, quoteId: s.q, payments: s.pays, amount: 1000 });
  const id = t.reserved.requests[0].id;
  const before = await requestRow(db, id);
  eq((await finish(db, id, "created", answerOf(s.p, id, 1000))).result, "not_armed", "pending and never armed, answered created: not_armed");
  eq((await finish(db, id, "unconfirmed")).result, "not_armed", "…answered unconfirmed: not_armed");
  eq(await requestRow(db, id), before, "…nothing written to the row");
  await rpc(db, "catering_refund_cancel_unarmed", [id, "x"]);
  eq((await finish(db, id, "unconfirmed")).result, "closed", "failed (never sent) and unconfirmed: closed");
  const o = await another(db, s);
  const leg = await legacyRow(db, { p: o.p, quote: o.q, shop: s.w.shop, by: s.owner, status: "succeeded", refundId: "re_legacysucc1", amount: 500 });
  const lb = await requestRow(db, leg);
  eq([(await finish(db, leg, "created", answerOf(o.p, leg, 500, { id: "re_legacysucc1" }))).result, (await finish(db, leg, "unconfirmed")).result], ["closed", "closed"], "0357's legacy `succeeded`: closed either way");
  eq(await requestRow(db, leg), lb, "…nothing written");
  eq((await finish(db, randomUUID(), "unconfirmed")).result, "not_found", "an unknown id: not_found");
  await refuses(() => finish(db, id, "other"), "invalid_request", "an outcome that is neither created nor unconfirmed raises invalid_request");
});

await group("f5_on_an_ineligible_payment_writes_nothing", async (db) => {
  const s = await scene(db, { parts: false, pays: [["balance", 500, { status: "due" }], ["full", 500, { provider: "toast" }], ["full", 500, { status: "void" }], ["full", 500, { pi: "cs_test_notapi1" }]] });
  for (const [p, what] of [[s.pays[0], "a due row"], [s.pays[1], "a non-Stripe tender"], [s.pays[2], "a void row"], [s.pays[3], "a payment whose ref is not a PaymentIntent"], [{ id: randomUUID() }, "no such payment"]]) {
    eq(await begin(db, p.id), { eligible: false }, `${what}: { eligible: false }`);
  }
  eq(await stateCount(db), 0, "…and no state row was written");
  eq((await record(db, s.pays[0].id, randomUUID(), {})).result, "read_replaced", "a record on it: read_replaced, nothing written");
  eq(await stateCount(db), 0, "…still no state row");
});

// ── the dispatch ────────────────────────────────────────────────────────────────────────────────────────────
const { Worker, isMainThread, parentPort, workerData } = await import("node:worker_threads");
if (isMainThread) {
  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt > -1 ? process.argv[onlyAt + 1] : null;
  const picked = GROUPS.map((g, i) => [g, i]).filter(([g]) => !only || g.name.includes(only)).map(([, i]) => i);
  const { cpus } = await import("node:os");
  const jobs = Math.max(1, Math.min(Number(process.env.SQL_HARNESS_JOBS) || Math.min(4, cpus().length - 1), picked.length));
  const results = new Array(GROUPS.length);
  if (jobs === 1) {
    for (const i of picked) results[i] = await runGroup(GROUPS[i]);
  } else {
    await Promise.all(Array.from({ length: jobs }, (_, j) => new Promise((resolve, reject) => {
      const mine = picked.filter((_, k) => k % jobs === j);
      const w = new Worker(new URL(import.meta.url), { workerData: { indices: mine } });
      w.on("message", (m) => { results[m.index] = m.result; });
      w.on("error", reject);
      w.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${j} exited ${code}`))));
    })));
  }
  let total = 0;
  let failed = 0;
  const failedGroups = [];
  for (const i of picked) {
    const r = results[i] ?? { name: GROUPS[i].name, lines: [[true, `FAIL ${GROUPS[i].name} :: the group never reported`]], checks: 1, failures: 1 };
    for (const [err, line] of r.lines) (err ? console.error : console.log)(line);
    total += r.checks;
    failed += r.failures;
    if (r.failures) failedGroups.push(r.name);
  }
  console.log(`0359 harness: ${picked.length} groups, ${total} checks run, ${failed} failed${failedGroups.length ? ` (groups: ${failedGroups.join(", ")})` : ""}`);
  if (failed || picked.length === 0) process.exitCode = 1;
  else console.log(`PASS 0359: ${total} checks in ${picked.length} groups (PGlite, one fresh database per group, the REAL 0357 -> 0358 -> 0359)`);
} else {
  for (const index of workerData.indices) parentPort.postMessage({ index, result: await runGroup(GROUPS[index]) });
}
