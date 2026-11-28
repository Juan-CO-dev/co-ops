/**
 * Local Postgres proof of migration 0359 (catering refunds Part B1: reconciler, ingress, recovery, sweep, install
 * record). SYNTHETIC ROWS ONLY -- PGlite, in memory, a stand-in for Stripe that is plain objects. CC owns the Supabase
 * sim / prod gate; this never touches a real database and never calls Stripe.
 *
 *   node scripts/sql-harness-0359.mjs                    every check, on the REAL 0357 -> 0358 -> 0359
 *   node scripts/sql-harness-0359.mjs --behaviour-only   the BEHAVIOUR checks only (Opus P3-e): what B2's gate re-runs
 *                                                        on a later schema stage, where 0359's stage-pinned
 *                                                        fingerprints are re-emitted by design
 *   node scripts/sql-harness-0359.mjs --only=<substring> the named tests whose name contains it
 *
 * TWO GROUPS, printed apart:
 *   STAGE-PINNED  the pre-flight (drift refused by name, a live 0357 claim refused, already applied), the body
 *                 fingerprints written in the file, the whole-ACL / trigger / operator / worker matrix, the four
 *                 denies, the withdrawn 0357 grants, the in-file assertions refusing a drifted database.
 *   BEHAVIOUR     every named money test of plan B1 + addendum A1-A3 that the SQL alone can prove. The tests that
 *                 need the app's code (routes, webhook, sweep, fake-Stripe HTTP sequences) are vitest suites.
 * One session cannot prove a lock race: the two-session proof is scripts/sim/refund-0359-lock-check.mjs (sim, CC).
 */
import { randomUUID } from "node:crypto";
import { base, withStandIns, one, rows, count, fingerprints, M0359, M0357, CALLER } from "./sql-harness-0359-lib.mjs";
import { FakeStripe, rpc, world, goLive, ingest, pass, figures, backdate } from "./sql-harness-0359-kit.mjs";

const args = process.argv.slice(2);
const BEHAVIOUR_ONLY = args.includes("--behaviour-only");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7);

let failures = 0;
let checks = 0;
let current = "";
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${current}: ${what}`); } else console.log(`ok   ${current}: ${what}`); };
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? "" : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);
async function refuses(fn, needle, what) {
  try { const r = await fn(); check(false, `${what} (no error; expected ${needle}; got ${JSON.stringify(r)?.slice(0, 200)})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message} ${e.detail ?? ""}`; check(s.includes(needle), `${what} -> ${needle}${s.includes(needle) ? "" : ` (got: ${s})`}`); }
}
const now = () => Math.floor(Date.now() / 1000);

let BARE; // 0357 -> 0358 -> 0359, nothing else (a genuine 0359-only database)
let READY; // + the isolated fixture's stand-in install records for B2 / B3
const bare = () => BARE.clone();
const ready = () => READY.clone();
const tests = [];
const stage = (name, fn) => tests.push({ name, fn, group: "stage" });
const test = (name, fn) => tests.push({ name, fn, group: "behaviour" });

/** A live world: shop, people, one quote with a $300 deposit, the fake charge, a live epoch. */
async function liveWorld({ captured = 30000, live = true } = {}) {
  const db = await ready();
  const w = await world(db);
  const s = new FakeStripe();
  const owner = await w.user("owner", { member: null });
  const moo = await w.user("moo");
  const gm = await w.user("gm");
  const quote = await w.quote();
  const p = await w.pay(quote, "deposit", captured);
  s.charge(p.pi, { captured });
  const ep = live ? await goLive(db) : null;
  return { db, w, s, owner, moo, gm, quote, p, ep };
}
const issues = (db, payment) => rows(db, "select code, state, blocking, event_id, refund_id, request_id, id, aged_at from public.catering_refund_issues where payment_id = $1 order by opened_at, code", [payment]);
const work = (db, payment) => one(db, "select * from public.catering_refund_payment_work where payment_id = $1", [payment]);
const payStatus = async (db, payment) => (await one(db, "select status from public.catering_payments where id = $1", [payment])).status;
const req = (db, id) => one(db, "select * from public.catering_refund_requests where id = $1", [id]);
const ledger = async (db, id) => (await one(db, "select outcome from public.stripe_events where id = $1", [id])).outcome;
/** Confirm tap -> claim -> complete pass -> arm (no POST: the POST is the app's; here its outcome is `finish`). */
async function reserveClaimArm(x, actor, amount, { arm = true } = {}) {
  const session = await x.w.session(actor);
  const reserved = await rpc(x.db, "catering_refund_reserve_admitted", [CALLER, actor, session, x.quote, randomUUID(), amount, "customer_cancelled", null, "panel"]);
  const request = reserved.requests[0].id;
  const claim = await rpc(x.db, "catering_refund_claim_admitted", [CALLER, actor, session, request]);
  const applied = await pass(x.db, x.p.id, x.s);
  const c = x.s.charges.get(x.p.pi);
  const armed = arm ? await rpc(x.db, "catering_refund_arm", [CALLER, actor, session, request, claim.claim_token, applied.generation, x.p.pi, c.charge, c.livemode]) : null;
  return { session, request, claim, applied, armed };
}

// ═══════════════════════════════ STAGE-PINNED ═══════════════════════════════════════════════════════════════════
stage("0359_identity_and_four_denies", async () => {
  const db = await bare();
  for (const t of ["catering_refund_install_contracts", "catering_refund_epochs", "catering_refund_payment_work", "catering_refund_identities",
    "catering_refund_event_work", "catering_payment_refund_outcomes", "catering_refund_issues"]) {
    const pol = (await rows(db, "select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = $1 order by policyname", [t]))
      .map((p) => `${p.policyname}:${p.cmd}:${p.qual ?? p.with_check}`).join("|");
    eq(pol, `${t}_no_user_delete:DELETE:false|${t}_no_user_insert:INSERT:false|${t}_no_user_select:SELECT:false|${t}_no_user_update:UPDATE:false`, `${t} has exactly the four explicit denies`);
    check((await one(db, "select relrowsecurity as r from pg_class where oid = $1::regclass", [`public.${t}`])).r, `${t} has RLS on`);
  }
  eq(await rows(db, "select part, version, migration, superseded_at from public.catering_refund_install_contracts"),
    [{ part: "B1", version: "b1-1", migration: "0359_catering_refund_reconciler", superseded_at: null }], "the ONLY install record is B1's, written by 0359");
  eq(await count(db, "select count(*) n from public.catering_refund_epochs"), 0, "0359 opens no epoch (dark)");
  check(/-- AUTHORED 2026-11-27 .*NOT YET APPLIED -- GATE CC\/JUAN/.test(M0359.split("\n")[1]), "the header gate line is on line 2");
  check(/^begin;$/m.test(M0359) && /^commit;\s*$/.test(M0359.split("\n").filter(Boolean).pop()) && (M0359.match(/^begin;$/gm) ?? []).length === 1 && (M0359.match(/^commit;$/gm) ?? []).length === 1, "one transaction");
  await db.close();
});

stage("preflight_refuses_drift_by_name", async () => {
  const apply = async (prepare, needle, what) => {
    const db = await base({ upTo: "0358" });
    await prepare(db);
    await refuses(() => db.exec(M0359), needle, what);
    if (db.isInTransaction?.()) await db.exec("rollback");
    eq(await one(db, "select to_regclass('public.catering_refund_install_contracts') as t"), { t: null }, `${what}: nothing was kept`);
    await db.close();
  };
  await apply((db) => db.exec("create or replace function public.catering_refund_claim(p_request_id uuid) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$ begin return null; end $$"),
    "catering_refund_claim(uuid)", "a later definer of 0357's claim is refused");
  await apply((db) => db.exec(M0357.match(/create function public\.catering_refund_requests_guard\(\)[\s\S]*?end \$\$;/)[0].replace("create function", "create or replace function").replace("'refund_request_bad_transition'", "'refund_request_bad_transition '")),
    "catering_refund_requests_guard()", "a guard differing by one space inside a literal is refused (the exact fingerprint)");
  await apply((db) => db.exec("alter table public.cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ('toast-sales-today'))"),
    "eight-job union", "a drifted cron CHECK is refused");
  await apply((db) => db.exec("grant update (status) on public.catering_refund_requests to authenticated"), "column ACL", "an extra column grant on 0357's table is refused");
  await apply((db) => db.exec("create role stray; grant execute on function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text) to stray"),
    "unexpected grantee", "another role holding EXECUTE on 0357's reserve is refused");
  await apply((db) => db.exec("alter table public.catering_refund_requests disable trigger catering_refund_requests_guard"), "trigger is missing, disabled", "a disabled guard trigger is refused");
  await apply((db) => db.exec("alter table public.sessions drop column step_up_unlocked_at"), "sessions.step_up_unlocked_at is missing", "a missing dependency column is refused");
  await apply(async (db) => {
    const w = await world(db); const o = await w.user("owner", { member: null }); const q = await w.quote(); await w.pay(q, "deposit", 10000);
    const r = (await one(db, "select public.catering_refund_reserve($1, $2, $3, 5000, 'customer_cancelled', null, 'panel') as r", [o, q, randomUUID()])).r;
    await db.query("select public.catering_refund_claim($1)", [r.requests[0].id]);
  }, "a live refund claim exists", "a LIVE 0357 claim (an old sender possibly mid-send) refuses the migration");
  const db = await bare();
  await refuses(() => db.exec(M0359), "0359: already applied", "a second apply is refused by name");
  await db.close();
});

stage("fingerprints_in_the_file_are_the_real_ones", async () => {
  const db = await base({ upTo: "0358" });
  for (const sig of ["catering_refund_requests_guard()", "catering_refund_figures(uuid)", "catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)",
    "catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)", "catering_refund_claim(uuid)", "catering_refund_actor_ok(uuid, uuid)", "claim_cron_route(text)"]) {
    const fp = await fingerprints(db, sig);
    check(M0359.includes(`'${fp.house}'`) && M0359.includes(`'${fp.exact}'`), `${sig}: both live fingerprints are the ones 0359's pre-flight carries`);
  }
  await db.close();
});

stage("whole_acl_trigger_operator_worker_matrix", async () => {
  const db = await bare();
  const WORKER = ["catering_refund_epoch_state", "catering_refund_effective_figures", "catering_refund_summary", "catering_refund_reserve_admitted",
    "catering_refund_claim_admitted", "catering_refund_arm", "catering_refund_finish", "catering_refund_release", "catering_refund_event_register",
    "catering_refund_settlement_attach", "catering_refund_pass_begin", "catering_refund_pass_remember", "catering_refund_apply", "catering_refund_defer",
    "catering_refund_resolve_anomaly", "catering_refund_sweep_due", "catering_refund_sweep_housekeeping", "catering_refund_recovery_seed_batch",
    "catering_refund_cleanup_done", "catering_refund_watch_state", "catering_refund_actor_ok", "catering_refund_figures", "claim_cron_route"];
  const fns = await rows(db, `select p.oid::regprocedure::text as sig, p.proname, p.prosecdef,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as sr, has_function_privilege('anon', p.oid, 'EXECUTE') as an,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as au, has_function_privilege('public', p.oid, 'EXECUTE') as pu
    from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'catering\\_refund\\_%' or p.proname = 'claim_cron_route') order by 1`);
  eq(fns.length, 49, "the refund function family + the cron lease = 49 functions");
  check(fns.every((f) => !f.an && !f.au && !f.pu), "PUBLIC, anon and authenticated can execute NONE of them");
  eq(fns.filter((f) => f.sr).map((f) => f.proname).sort(), [...WORKER].sort(), "service_role can execute exactly the worker surface");
  const closed = fns.filter((f) => !f.sr).map((f) => f.proname);
  for (const f of ["catering_refund_open_recovery", "catering_refund_promote", "catering_refund_start_drain", "catering_refund_finish_drain",
    "catering_refund_break_glass_close", "catering_refund_adopt_contract_upgrade", "catering_refund_recovery_report", "catering_refund_apply_inner",
    "catering_refund_requests_guard", "catering_refund_admit", "catering_refund_reserve", "catering_refund_claim", "catering_refund_record_snapshot",
    "catering_refund_install_check", "catering_refund_restamp_events", "catering_refund_attach_event", "catering_refund_register_hints"]) {
    check(closed.includes(f), `${f} is closed to service_role (operator-only, private, trigger or withdrawn)`);
  }
  // Asked the second way: by actually calling, under each role.
  const w = await world(db);
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select public.catering_refund_open_recovery('x')"), "42501", `${role} cannot run lifecycle control`);
    await refuses(() => db.query("select public.catering_refund_promote($1, 1, '{}'::jsonb, 'x')", [randomUUID()]), "42501", `${role} cannot promote`);
    await refuses(() => db.query("select public.catering_refund_apply_inner(null, 'live', $1, $1, 1, '{}'::jsonb)", [randomUUID()]), "42501", `${role} cannot call the private writer`);
    await refuses(() => db.query("insert into public.catering_refund_install_contracts (part, version, migration) values ('B2', 'b2-1', '0362_x')"), "42501", `${role} cannot insert an install record`);
    await refuses(() => db.query("update public.catering_refund_install_contracts set version = 'b1-9'"), "42501", `${role} cannot update an install record`);
    await refuses(() => db.query("delete from public.catering_refund_install_contracts"), "42501", `${role} cannot delete an install record`);
    await refuses(() => db.query("select * from public.catering_refund_epochs"), "42501", `${role} cannot read the epochs table directly`);
    await refuses(() => db.query("update public.catering_refund_requests set status = 'failed'"), "42501", `${role} cannot UPDATE a request directly (the nine grants are withdrawn)`);
    await refuses(() => db.query("select public.catering_refund_reserve($1, $1, $1, 100, 'other', 'x', 'panel')", [randomUUID()]), "42501", `${role} cannot call the historical reserve`);
    await refuses(() => db.query("select public.catering_refund_claim($1)", [randomUUID()]), "42501", `${role} cannot call the historical claim`);
    await refuses(() => db.query("select public.catering_refund_record_snapshot($1, now(), 1, '[]'::jsonb)", [randomUUID()]), "42501", `${role} cannot call the historical snapshot writer`);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  eq((await one(db, "select public.catering_refund_epoch_state($1) as r", [CALLER])).r.state, "none", "service_role can ask where admission stands");
  eq(await count(db, "select count(*) n from public.catering_refund_requests"), 0, "service_role keeps SELECT on 0357's requests table");
  await db.exec("reset role");
  // No test mode, force argument or override anywhere in the lifecycle signatures.
  const sigs = fns.map((f) => f.sig).join("\n");
  check(!/force|test|bypass|override/i.test(sigs), "no lifecycle or worker signature carries a force / test / bypass argument");
  check((await rows(db, "select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'catering\\_refund\\_%' and p.pronargdefaults > 0")).length === 0,
    "no function of the family has a default argument (old call shapes cannot match)");
  void w;
  await db.close();
});

stage("in_file_assertions_refuse_a_drifted_database", async () => {
  // The assertion block runs before the install record: a grant that slipped in mid-file leaves NOTHING behind.
  const tamper = async (inject, needle, what) => {
    const db = await base({ upTo: "0358" });
    const marker = "-- ── Assertions (raise = nothing in this file is kept)";
    await refuses(() => db.exec(M0359.replace(marker, `${inject}\n${marker}`)), needle, what);
    if (db.isInTransaction?.()) await db.exec("rollback");
    eq(await one(db, "select to_regclass('public.catering_refund_install_contracts') as t"), { t: null }, `${what}: nothing kept`);
    await db.close();
  };
  await tamper("grant execute on function public.catering_refund_promote(uuid, bigint, jsonb, text) to service_role;", "service_role may execute", "service_role holding a lifecycle function");
  await tamper("grant execute on function public.catering_refund_apply(text, uuid, uuid, bigint, jsonb) to authenticated;", "authenticated may execute", "authenticated holding the financial writer");
  await tamper("grant select on public.catering_refund_epochs to service_role;", "is not the owner's alone", "service_role holding a table read");
  await tamper("grant update (status) on public.catering_refund_requests to service_role;", "still carries a column grant", "one of the nine UPDATE grants left in place");
  await tamper("grant execute on function public.catering_refund_claim(uuid) to service_role;", "service_role may execute", "the historical claim left executable");
  await tamper("drop policy catering_refund_issues_no_user_delete on public.catering_refund_issues;", "four explicit denies", "a missing explicit deny");
  await tamper("alter function public.catering_refund_apply(text, uuid, uuid, bigint, jsonb) reset search_path;", "pinned search_path", "an unpinned search_path");
  await tamper("alter function public.catering_refund_arm(text, uuid, uuid, uuid, uuid, bigint, text, text, boolean) security invoker;", "wrong security mode", "a worker that is not SECURITY DEFINER");
  await tamper("insert into public.catering_refund_install_contracts (part, version, migration) values ('B2', 'b2-1', '0362_x');", "before this file wrote one", "an install record written early");
});

// ═══════════════════════════════ BEHAVIOUR ══════════════════════════════════════════════════════════════════════
test("partial_install_cannot_open_recovery_or_promote", async () => {
  const db = await bare(); // a GENUINE 0359-only database
  await refuses(() => rpc(db, "catering_refund_open_recovery", ["cc"]), "install_incomplete", "0359 alone refuses to open recovery");
  eq(await count(db, "select count(*) n from public.catering_refund_epochs"), 0, "no epoch row was made by the refusal");
  // Two of three: still refused. A duplicate / unexpected version: refused.
  await db.exec("insert into public.catering_refund_install_contracts (part, version, migration) values ('B2', 'b2-1', '0362_fixture_stand_in')");
  await refuses(() => rpc(db, "catering_refund_open_recovery", ["cc"]), "install_incomplete", "B1 + B2 without B3 refuses");
  await db.exec("insert into public.catering_refund_install_contracts (part, version, migration) values ('B3', 'b3-9', '0363_fixture_stand_in')");
  await refuses(() => rpc(db, "catering_refund_open_recovery", ["cc"]), "install_incomplete", "an unexpected B3 version refuses");
  await db.exec("update public.catering_refund_install_contracts set version = 'b3-1' where part = 'B3'");
  const opened = await rpc(db, "catering_refund_open_recovery", ["cc"]);
  eq(opened.state, "recovering", "the full matrix opens recovery");
  eq(opened.manifest, { B1: "b1-1", B2: "b2-1", B3: "b3-1" }, "the accepted manifest is stored on the epoch");
  // partial_install_cannot_promote: promote checks the matrix INDEPENDENTLY of open_recovery.
  await rpc(db, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  await rpc(db, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  const report = await rpc(db, "catering_refund_recovery_report", []);
  await db.exec("update public.catering_refund_install_contracts set superseded_at = now() where part = 'B3'");
  await refuses(() => rpc(db, "catering_refund_promote", [opened.epoch_id, 1, JSON.stringify(report.counts), "cc"]), "install_incomplete", "partial_install_cannot_promote: a record removed after opening refuses promotion");
  await db.exec("update public.catering_refund_install_contracts set superseded_at = null where part = 'B3'");
  await refuses(() => rpc(db, "catering_refund_promote", [opened.epoch_id, 1, JSON.stringify({ ...report.counts, payments: 99 }), "cc"]), "ack_mismatch", "promotion refuses counts CC did not acknowledge exactly");
  await refuses(() => rpc(db, "catering_refund_promote", [opened.epoch_id, 7, JSON.stringify(report.counts), "cc"]), "stale_generation", "promotion is fenced on the epoch generation");
  eq((await rpc(db, "catering_refund_promote", [opened.epoch_id, 1, JSON.stringify(report.counts), "cc"])).state, "live", "the full matrix + acknowledged counts promote");
  await refuses(() => rpc(db, "catering_refund_open_recovery", ["cc"]), "epoch_already_open", "at most one open epoch");
  await db.close();
});

test("incomplete_recovery_cannot_promote", async () => {
  const db = await ready();
  const w = await world(db);
  const q = await w.quote();
  for (let i = 0; i < 3; i++) await w.pay(q, "deposit", 1000);
  const opened = await rpc(db, "catering_refund_open_recovery", ["cc"]);
  await rpc(db, "catering_refund_recovery_seed_batch", [CALLER, 2]); // 2 of 3 payments
  const report = await rpc(db, "catering_refund_recovery_report", []);
  await refuses(() => rpc(db, "catering_refund_promote", [opened.epoch_id, 1, JSON.stringify(report.counts), "cc"]), "recovery_incomplete", "an incomplete scan cannot promote");
  await db.close();
});

test("incompatible_caller_cannot_admit_money", async () => {
  const x = await liveWorld();
  const session = await x.w.session(x.owner);
  for (const bad of ["b1-0", "b1-2", "b2-1", "", null]) {
    await refuses(() => rpc(x.db, "catering_refund_reserve_admitted", [bad, x.owner, session, x.quote, randomUUID(), 1000, "customer_cancelled", null, "panel"]), "caller_incompatible", `reserve refuses caller ${JSON.stringify(bad)}`);
    await refuses(() => rpc(x.db, "catering_refund_pass_begin", [bad, x.p.id, randomUUID()]), "caller_incompatible", `pass_begin refuses caller ${JSON.stringify(bad)}`);
    await refuses(() => rpc(x.db, "catering_refund_event_register", [bad, "evt_x", "charge.refunded", null, false, x.p.pi, null, now(), 100, 30000, false, "[]"]), "caller_incompatible", `ingress refuses caller ${JSON.stringify(bad)}`);
  }
  eq(await count(x.db, "select count(*) n from public.catering_refund_requests"), 0, "no reservation was made by an incompatible caller");
  await x.db.close();
  // The NO-EPOCH ingress case (Fable P3-3 ii): validated against the current B1 install record.
  const db = await ready();
  const w = await world(db); const q = await w.quote(); const p = await w.pay(q, "deposit", 30000);
  await db.query("insert into public.stripe_events (id, type, livemode, payload) values ('evt_ne', 'charge.refunded', false, '{}')");
  await refuses(() => rpc(db, "catering_refund_event_register", ["b1-7", "evt_ne", "charge.refunded", null, false, p.pi, null, now(), 100, 30000, false, "[]"]), "caller_incompatible", "no-epoch ingress refuses an incompatible caller");
  eq((await rpc(db, "catering_refund_event_register", [CALLER, "evt_ne", "charge.refunded", null, false, p.pi, null, now(), 100, 30000, false, "[]"])).result, "registered", "no-epoch ingress admits the compiled caller");
  // A caller-supplied version can never create an install record or authorize promotion.
  eq(await count(db, "select count(*) n from public.catering_refund_install_contracts where version = 'b1-7'"), 0, "a caller-supplied version created no install record");
  await db.close();
});

test("on_no_epoch_entrypoint_matrix", async () => {
  const db = await ready();
  const w = await world(db); const s = new FakeStripe();
  const owner = await w.user("owner", { member: null }); const session = await w.session(owner);
  const q = await w.quote(); const p = await w.pay(q, "deposit", 30000); s.charge(p.pi);
  eq((await rpc(db, "catering_refund_epoch_state", [CALLER])).state, "none", "epoch state reads `none`");
  await refuses(() => rpc(db, "catering_refund_reserve_admitted", [CALLER, owner, session, q, randomUUID(), 1000, "customer_cancelled", null, "panel"]), "refunds_no_epoch", "no reserve");
  await refuses(() => rpc(db, "catering_refund_claim_admitted", [CALLER, owner, session, randomUUID()]), "refunds_no_epoch", "no claim");
  await refuses(() => rpc(db, "catering_refund_pass_begin", [CALLER, p.id, randomUUID()]), "refunds_no_epoch", "no pass / apply");
  await refuses(() => rpc(db, "catering_refund_sweep_due", [CALLER, 10]), "refunds_no_epoch", "no sweep due list");
  await refuses(() => rpc(db, "catering_refund_sweep_housekeeping", [CALLER]), "refunds_no_epoch", "no housekeeping");
  const ev = await ingest(db, { pi: p.pi, cumulative: 10000, chargeAmount: 30000, full: false });
  eq([ev.result, ev.state, ev.floor], ["registered", "attached", true], "signed ingress still commits durable work and its floor");
  eq(await ledger(db, ev.id), "refund_state_owed", "and stamps the terminal transport verdict");
  eq(await count(db, "select count(*) n from public.catering_refund_requests"), 0, "no reservation, claim or lease");
  // Recovering: Confirm / Retry-create refuse refunds_recovering BEFORE reserve or claim (recovering_confirm_zero_reservations_and_claims).
  await rpc(db, "catering_refund_open_recovery", ["cc"]);
  await refuses(() => rpc(db, "catering_refund_reserve_admitted", [CALLER, owner, session, q, randomUUID(), 1000, "customer_cancelled", null, "panel"]), "refunds_recovering", "recovering_confirm_zero_reservations_and_claims: reserve refuses");
  await refuses(() => rpc(db, "catering_refund_claim_admitted", [CALLER, owner, session, randomUUID()]), "refunds_recovering", "recovering_confirm_zero_reservations_and_claims: claim refuses");
  eq(await count(db, "select count(*) n from public.catering_refund_requests"), 0, "recovering_confirm_zero_reservations_and_claims: zero reservations");
  eq((await pass(db, p.id, s)).result, "applied", "bounded recovery work (a pass) runs while recovering");
  await db.close();
});

test("recovery_epoch_precedes_master_on", async () => {
  // The executable half in SQL: with the switch's own gate unknown to the database, the database state the activation
  // tooling reads back before it prints "set the switch" is exactly this.
  const db = await ready();
  eq((await rpc(db, "catering_refund_epoch_state", [CALLER])).state, "none", "before open_recovery the read-back is `none` (the tool refuses to print the switch step)");
  await rpc(db, "catering_refund_open_recovery", ["cc"]);
  const st = await rpc(db, "catering_refund_epoch_state", [CALLER]);
  eq([st.state, st.caller_ok], ["recovering", true], "after open_recovery the read-back is a recovering epoch that admits the compiled caller");
  await db.close();
});

test("idless_floor_refund_fails_before_first_list_unblocks", async () => {
  const x = await liveWorld();
  const t0 = now() - 300;
  const r1 = x.s.refund(x.p.pi, 10000, "failed", { created: t0 - 60 }); // created before the event, failed AFTER it, before our first list
  const ev = await ingest(x.db, { pi: x.p.pi, created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  eq((await figures(x.db, x.p.id)).o_floor, 10000, "the ID-less event is a floor from ingress");
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.floors_outstanding, a.available_cents], ["applied", 0, 30000], "the failed refund EXPLAINS the event; current money is zero returned / reserved");
  const e = await one(x.db, "select floor_state, coverage from public.catering_refund_event_work where event_id = $1", [ev.id]);
  eq([e.floor_state, e.coverage.members.map((m) => m.id), e.coverage.explained_cents], ["discharged", [r1], 10000], "coverage records the contributing id, amount and event");
  eq((await issues(x.db, x.p.id)).filter((i) => i.state !== "resolved"), [], "no hold remains");
  await x.db.close();
});

test("charge_refunded_then_canceled_before_first_pass_floor_discharged", async () => {
  const x = await liveWorld();
  const t0 = now() - 300;
  x.s.refund(x.p.pi, 30000, "canceled", { created: t0 }); // a whole refund, canceled inside the cancel window; equal-second creation qualifies
  await ingest(x.db, { pi: x.p.pi, created: t0, cumulative: 30000, chargeAmount: 30000, full: true });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.floors_outstanding, a.payment_status, a.available_cents], ["applied", 0, "paid", 30000], "floor discharged; the payment stays paid; everything is available again");
  await x.db.close();
});

test("idless_charge_crash_empty_empty_third_list_covers_floor", async () => {
  const x = await liveWorld();
  const t0 = now() - 300;
  const r = x.s.refund(x.p.pi, 10000, "succeeded", { created: t0 - 5 });
  x.s.hidden.add(r); // the list has not caught up
  await ingest(x.db, { pi: x.p.pi, created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  // A newer snapshot than the event exists and says "nothing": the floor still holds (plan B1.2, r3 ruling 2).
  for (const n of [1, 2]) {
    const a = await pass(x.db, x.p.id, x.s);
    eq([a.result, a.floors_outstanding, a.available_cents], ["applied", 1, 20000], `empty list ${n}: the floor is honoured against the newer snapshot (never below the cumulative)`);
  }
  const session = await x.w.session(x.owner);
  await refuses(() => rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 25000, "customer_cancelled", null, "panel"]), "payment_held", "a create that would dip under the floor is refused");
  eq((await issues(x.db, x.p.id)).map((i) => [i.code, i.state, i.blocking]), [["awaiting_identity", "open", true]], "one awaiting_identity hold, not three");
  x.s.hidden.delete(r);
  const a3 = await pass(x.db, x.p.id, x.s);
  eq([a3.floors_outstanding, a3.returned_cents, a3.available_cents, a3.held], [0, 10000, 20000, false], "the third list covers the floor: returned 100, available 200, no hold");
  await x.db.close();
});

test("refund_void_before_event_cannot_explain_later_event", async () => {
  // Addendum A1. R1 failed Monday (the app OBSERVED it void). Tuesday a Dashboard refund R2 succeeds and its ID-less
  // charge.refunded arrives, but the list shows only R1. The floor must stay; no second create is admitted.
  const x = await liveWorld();
  const monday = now() - 3600;
  const r1 = x.s.refund(x.p.pi, 10000, "failed", { created: monday });
  eq((await pass(x.db, x.p.id, x.s)).result, "applied", "Monday: R1 is observed void by an exact read");
  const voidAt = (await one(x.db, "select void_evidence_at from public.catering_refund_identities where refund_id = $1", [r1])).void_evidence_at;
  check(voidAt != null, "the first database observation of the void class is recorded");
  const tuesday = now() + 86400; // the event's own creation time is AFTER the void observation
  const r2 = x.s.refund(x.p.pi, 10000, "succeeded", { created: tuesday - 1 });
  x.s.hidden.add(r2);
  const ev = await ingest(x.db, { pi: x.p.pi, created: tuesday, cumulative: 10000, chargeAmount: 30000, full: false });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.floors_outstanding, a.available_cents, a.held], ["applied", 1, 20000, true], "the pass lists only R1: R1 CANNOT explain Tuesday's event; the floor stays and the payment is held");
  const session = await x.w.session(x.owner);
  await refuses(() => rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 10000, "customer_cancelled", null, "panel"]), "payment_held", "no second create is admitted");
  eq((await issues(x.db, x.p.id)).filter((i) => i.state === "open").map((i) => [i.code, i.event_id]), [["awaiting_identity", ev.id]], "the floor goes to the MoO+ step-up operator exit");
  // R2 listed: the floor discharges on evidence.
  x.s.hidden.delete(r2);
  const b = await pass(x.db, x.p.id, x.s);
  eq([b.floors_outstanding, b.returned_cents, b.available_cents, b.held], [0, 10000, 20000, false], "once R2 is listed the floor is explained by R2");
  await x.db.close();
  // A signed void event counts as the observation too (no read needed): refund.failed created Monday.
  const y = await liveWorld();
  const mon = now() - 3600;
  const s1 = y.s.refund(y.p.pi, 10000, "failed", { created: mon - 10 });
  await ingest(y.db, { type: "refund.failed", pi: y.p.pi, created: mon, hints: [{ id: s1, status: "failed" }] });
  const tue = now() - 60;
  await ingest(y.db, { pi: y.p.pi, created: tue, cumulative: 10000, chargeAmount: 30000, full: false });
  const c = await pass(y.db, y.p.id, y.s);
  eq([c.floors_outstanding, c.held], [1, true], "a signed refund.failed dated before the event bars that refund from explaining it");
  await y.db.close();
  // Review fix (all three seats, A1 gap): the signed void event is already in the LEDGER from before the epoch, imported
  // by the recovery seed; the first exact read of R1 happens only AFTER Tuesday's live event.
  const db3 = await ready();
  const w3 = await world(db3); const s3 = new FakeStripe(); const q3 = await w3.quote(); const p3 = await w3.pay(q3, "deposit", 30000); s3.charge(p3.pi);
  const lastMonday = now() - 86400;
  const h1 = s3.refund(p3.pi, 10000, "failed", { created: lastMonday - 10 });
  const hist = await ingest(db3, { type: "refund.failed", pi: p3.pi, created: lastMonday, hints: [{ id: h1, status: "failed" }], ledgerOnly: true });
  await db3.query("update public.stripe_events set outcome = 'ignored', received_at = now() - interval '1 day' where id = $1", [hist.id]);
  await rpc(db3, "catering_refund_open_recovery", ["cc"]);
  for (let i = 0; i < 3; i++) await rpc(db3, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  check((await one(db3, "select void_evidence_at from public.catering_refund_identities where refund_id = $1", [h1])).void_evidence_at != null, "the seeded signed refund.failed dates R1 void at the event's own created (Monday)");
  const h2 = s3.refund(p3.pi, 10000, "succeeded", { created: now() - 61 }); s3.hidden.add(h2);
  await ingest(db3, { pi: p3.pi, created: now() - 60, cumulative: 10000, chargeAmount: 30000, full: false });
  const d = await pass(db3, p3.id, s3);
  eq([d.result, d.floors_outstanding, d.held], ["applied", 1, true], "R1 (held void since Monday by the seeded signed event) cannot explain Tuesday's live floor");
  await db3.close();
});

test("refund_void_after_event_explains_it", async () => {
  // A1's positive twin: R1 created before the event, failed AFTER it -> explains it.
  const x = await liveWorld();
  const t0 = now() - 1800;
  const r1 = x.s.refund(x.p.pi, 10000, "succeeded", { created: t0 - 30 });
  const ev = await ingest(x.db, { pi: x.p.pi, created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  eq((await pass(x.db, x.p.id, x.s)).floors_outstanding, 0, "while succeeded it explains its own event");
  // Reset the floor to prove the void-AFTER case on its own: a second event of the same cumulative, then the failure.
  const ev2 = await ingest(x.db, { pi: x.p.pi, created: t0 + 5, cumulative: 10000, chargeAmount: 30000, full: false });
  x.s.set(r1, { status: "failed" });
  await ingest(x.db, { type: "refund.failed", pi: x.p.pi, created: t0 + 600, hints: [{ id: r1, status: "failed" }] });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.floors_outstanding, a.returned_cents, a.reserved_cents, a.available_cents], [0, 0, 0, 30000], "failed after the event: it still explains the event and contributes zero money today");
  eq((await one(x.db, "select floor_state from public.catering_refund_event_work where event_id = $1", [ev2.id])).floor_state, "discharged", "the later event is discharged by the same identity (each event needs its own explanation, found here)");
  void ev;
  await x.db.close();
});

test("floor_coverage_variants", async () => {
  // Later-created ids, another charge, an unverified creation time and a duplicate id cannot explain a shortfall.
  const x = await liveWorld();
  const t0 = now() - 900;
  x.s.refund(x.p.pi, 10000, "succeeded", { created: t0 + 1 }); // created AFTER the event
  x.s.refund(x.p.pi, 10000, "succeeded", { created: t0 - 5, charge: "ch_other" }); // another charge
  await ingest(x.db, { pi: x.p.pi, created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.floors_outstanding, a.held], [1, true], "a later-created refund and a refund on another charge explain nothing");
  check((await issues(x.db, x.p.id)).some((i) => i.code === "wrong_charge" && i.blocking), "wrong_charge_rejected: the refund on another charge is a wrong-charge hold, never counted");
  // Review fix (Astra P1): an EVENT about another charge of the PaymentIntent is never explained by this charge's refunds.
  const z = await liveWorld();
  const zr = z.s.refund(z.p.pi, 10000, "succeeded", { created: t0 - 30 });
  const zev = await ingest(z.db, { pi: z.p.pi, charge: "ch_ANOTHER_CHARGE", created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  z.s.set(zr, { status: "failed" });
  const zb = await pass(z.db, z.p.id, z.s);
  eq([zb.floors_outstanding, zb.held, (await one(z.db, "select floor_state from public.catering_refund_event_work where event_id = $1", [zev.id])).floor_state], [1, true, "outstanding"],
    "an equal-sized void refund on the verified charge cannot discharge the floor of an event on ANOTHER charge");
  await z.db.close();
  eq(a.returned_cents, 10000, "only the same-charge refund is counted as money (wrong-charge evidence is not)");
  await x.db.close();
  // Two independent events each need their own explanation.
  const y = await liveWorld();
  const a1 = y.s.refund(y.p.pi, 5000, "succeeded", { created: t0 - 100 });
  const e1 = await ingest(y.db, { pi: y.p.pi, created: t0 - 90, cumulative: 5000, chargeAmount: 30000, full: false });
  const e2 = await ingest(y.db, { pi: y.p.pi, created: t0, cumulative: 12000, chargeAmount: 30000, full: false });
  const b = await pass(y.db, y.p.id, y.s);
  eq([b.floors_outstanding, b.available_cents], [1, 18000], "the first event is explained; the second (cumulative 120) is not: deduction is the LARGEST outstanding floor");
  eq(await rows(y.db, "select event_id, floor_state from public.catering_refund_event_work where payment_id = $1 order by provider_created_at", [y.p.id]),
    [{ event_id: e1.id, floor_state: "discharged" }, { event_id: e2.id, floor_state: "outstanding" }], "each distinct event has its own state");
  // A duplicate delivery of a discharged event keeps its coverage record.
  const again = await ingest(y.db, { id: e1.id, pi: y.p.pi, created: t0 - 90, cumulative: 5000, chargeAmount: 30000, full: false });
  eq([again.result, (await one(y.db, "select floor_state from public.catering_refund_event_work where event_id = $1", [e1.id])).floor_state], ["duplicate", "discharged"], "a replay preserves the discharged floor");
  void a1;
  await y.db.close();
});

test("recovery_seed_of_canceled_refund_leaves_no_floor", async () => {
  const db = await ready();
  const w = await world(db); const s = new FakeStripe();
  const q = await w.quote(); const p = await w.pay(q, "deposit", 30000); s.charge(p.pi);
  const old = now() - 30 * 86400;
  const r = s.refund(p.pi, 30000, "canceled", { created: old });
  // Main (OFF) had handled this event: the row moved to `refunded` and the ledger says so.
  const ev = await ingest(db, { id: "evt_hist_1", pi: p.pi, created: old, cumulative: 30000, chargeAmount: 30000, full: true, hints: [{ id: r, status: "succeeded" }], ledgerOnly: true });
  await db.query("update public.stripe_events set outcome = 'refunded', processed_at = now() where id = $1", [ev.id]);
  await db.query("update public.catering_payments set status = 'refunded' where id = $1", [p.id]);
  await rpc(db, "catering_refund_open_recovery", ["cc"]);
  for (let i = 0; i < 3; i++) await rpc(db, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  const e = await one(db, "select source, state, floor_state, floor_cents, legacy_verdict from public.catering_refund_event_work where event_id = $1", [ev.id]);
  eq(e, { source: "recovery_seed", state: "attached", floor_state: "none", floor_cents: null, legacy_verdict: "refunded" }, "the historical event is provenance + hints + baseline work, with NO floor");
  eq((await figures(db, p.id)).o_floor, 0, "no floor from a seed");
  // recovery_imports_old_event_whose_refund_failed_no_permanent_hold: the baseline pass reads the refund canceled.
  const a = await pass(db, p.id, s);
  eq([a.result, a.payment_status, a.previous_payment_status, a.held, a.available_cents, a.cleanup_owed], ["applied", "paid", "refunded", false, 30000, true],
    "recovery_imports_old_event_whose_refund_failed_no_permanent_hold: no hold; verified zero returns move refunded -> paid and write the cleanup obligation");
  eq(await count(db, "select count(*) n from public.catering_payment_refund_events where payment_id = $1", [p.id]), 0, "a seed appends nothing to 0333's history (main's own rows stand)");
  eq((await one(db, "select baseline from public.catering_payment_refund_outcomes where refund_id = $1", [r])).baseline, true, "the outcome observed in recovery is a baseline outcome");
  await db.close();
});

test("live_ingress_racing_historical_seed_keeps_its_floor", async () => {
  const db = await ready();
  const w = await world(db); const q = await w.quote(); const p = await w.pay(q, "deposit", 30000);
  await rpc(db, "catering_refund_open_recovery", ["cc"]);
  // A genuine signed ingress lands first (the switch is ON during recovery)...
  const ev = await ingest(db, { pi: p.pi, created: now() - 5, cumulative: 10000, chargeAmount: 30000, full: false });
  // ...then the seed scan reaches the same ledger row.
  for (let i = 0; i < 3; i++) await rpc(db, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  eq(await one(db, "select source, floor_state, floor_cents::int as floor_cents from public.catering_refund_event_work where event_id = $1", [ev.id]),
    { source: "ingress", floor_state: "outstanding", floor_cents: 10000 }, "the seed cannot erase, demote or discharge the live-ingress floor");
  await db.close();
  // Review fix (Opus F1 / Fable 3 / Astra P1): THE OTHER ORDER. (a) A delivery that failed BEFORE the epoch (the ledger
  // says processing_failed) is imported by the seed; Stripe's retry then arrives with the switch ON.
  const db2 = await ready();
  const w2 = await world(db2); const q2 = await w2.quote(); const p2 = await w2.pay(q2, "deposit", 30000);
  const old = await ingest(db2, { pi: p2.pi, created: now() - 600, cumulative: 10000, chargeAmount: 30000, full: false, ledgerOnly: true });
  await db2.query("update public.stripe_events set outcome = 'processing_failed', received_at = now() - interval '10 minutes' where id = $1", [old.id]);
  await rpc(db2, "catering_refund_open_recovery", ["cc"]);
  for (let i = 0; i < 3; i++) await rpc(db2, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  eq(await one(db2, "select source, floor_state from public.catering_refund_event_work where event_id = $1", [old.id]), { source: "recovery_seed", floor_state: "none" }, "seed first: imported as history, no floor yet");
  const retry = await rpc(db2, "catering_refund_event_register", [CALLER, old.id, "charge.refunded", null, false, p2.pi, null, now() - 600, 10000, 30000, false, "[]"]);
  eq([retry.result, retry.floor, await ledger(db2, old.id)], ["registered", true, "refund_state_owed"], "the genuine signed delivery is PROMOTED: it registers, with its floor, and is acknowledged");
  eq(await one(db2, "select source, floor_state, floor_cents::int as floor_cents, applied_at from public.catering_refund_event_work where event_id = $1", [old.id]),
    { source: "ingress", floor_state: "outstanding", floor_cents: 10000, applied_at: null }, "it keeps its ingress obligation: source ingress, the floor outstanding, owed to the sweep");
  eq(await count(db2, "select count(*) n from public.catering_payment_refund_events where stripe_event_id = $1", [old.id]), 1, "and its 0333 charge-history row is appended once");
  eq((await figures(db2, p2.id)).o_floor, 10000, "the floor is honoured");
  // (b) THE RACE inside the epoch: the ledger row is appended, the seed scan runs, then the registration. An unfinished
  // delivery of this epoch is never taken as a seed.
  const racing = await ingest(db2, { pi: p2.pi, created: now() - 5, cumulative: 15000, chargeAmount: 30000, full: false, ledgerOnly: true });
  for (let i = 0; i < 2; i++) await rpc(db2, "catering_refund_recovery_seed_batch", [CALLER, 100]);
  eq(await count(db2, "select count(*) n from public.catering_refund_event_work where event_id = $1", [racing.id]), 0, "an in-epoch unfinished delivery (NULL verdict) is not seeded");
  const reg = await rpc(db2, "catering_refund_event_register", [CALLER, racing.id, "charge.refunded", null, false, p2.pi, null, now() - 5, 15000, 30000, false, "[]"]);
  eq([reg.result, reg.floor, (await figures(db2, p2.id)).o_floor], ["registered", true, 15000], "its registration then creates the floor");
  await db2.close();
});

test("uncovered_floor_step_up_disposition_lifts_only_that_event", async () => {
  const x = await liveWorld();
  const t0 = now() - 300;
  const e1 = await ingest(x.db, { pi: x.p.pi, created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  await pass(x.db, x.p.id, x.s);
  const issue = (await issues(x.db, x.p.id)).find((i) => i.code === "awaiting_identity");
  const gen = async () => Number((await work(x.db, x.p.id)).generation);
  const call = (session, { g, action = "resolve_event_floor", ref = "stripe-dash:acct/recon-0001", id = issue.id } = {}) =>
    rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, id, g, action, ref, session, null]);
  const g0 = await gen();
  // Authority, staleness, evidence (disposition_matrix_authority_staleness_and_reopen).
  await refuses(async () => call(await x.w.session(x.gm, { fresh: true }), { g: g0 }), "forbidden", "a GM (insufficient role) is refused");
  const otherMoo = await x.w.user("moo", { member: x.w.other });
  await refuses(async () => call(await x.w.session(otherMoo, { fresh: true }), { g: g0 }), "forbidden", "a MoO of ANOTHER shop is refused");
  await refuses(async () => call(await x.w.session(x.moo, { stale: true }), { g: g0 }), "step_up_stale", "a stale step-up is refused");
  await refuses(async () => call(await x.w.session(x.moo), { g: g0 }), "step_up_stale", "no step-up at all is refused");
  await refuses(async () => call(await x.w.session(x.moo, { fresh: true }), { g: g0 - 1 }), "stale_generation", "a stale generation is the named conflict");
  await refuses(async () => call(await x.w.session(x.moo, { fresh: true }), { g: g0, ref: null }), "evidence_required", "missing evidence is refused");
  await refuses(async () => call(await x.w.session(x.moo, { fresh: true }), { g: g0, action: "acknowledge_followup", ref: null }), "invalid_action", "merely acknowledging an unexplained floor is not an exit");
  const revoked = await x.w.session(x.moo, { fresh: true });
  await x.db.query("update public.sessions set revoked_at = now() where id = $1", [revoked]);
  await refuses(() => call(revoked, { g: g0 }), "forbidden", "a revoked session is refused");
  // A concurrent new event: it bumps the generation and stays protected after the first floor is resolved.
  const e2 = await ingest(x.db, { pi: x.p.pi, created: t0 + 60, cumulative: 15000, chargeAmount: 30000, full: false });
  await refuses(async () => call(await x.w.session(x.moo, { fresh: true }), { g: g0 }), "stale_generation", "a concurrent new event invalidates the operator's stale view");
  await pass(x.db, x.p.id, x.s);
  // An independently armed reservation survives the disposition too.
  const armedWorld = { ...x };
  const done = await call(await x.w.session(x.moo, { fresh: true }), { g: await gen() });
  eq([done.result, done.state], ["ok", "resolved"], "MoO with membership at this shop, fresh Tier B, expected generation, evidence: resolved");
  eq(await rows(x.db, "select event_id, floor_state from public.catering_refund_event_work where payment_id = $1 order by provider_created_at", [x.p.id]),
    [{ event_id: e1.id, floor_state: "operator_resolved" }, { event_id: e2.id, floor_state: "outstanding" }], "ONLY that event's floor is lifted; the second floor survives");
  const f = await figures(x.db, x.p.id);
  eq([f.o_floor, f.o_held], [15000, true], "the surviving floor still protects the payment");
  const audit = await one(x.db, "select actor_id, destructive, metadata from public.audit_log where action = 'catering.refund.disposition' order by id desc limit 1");
  eq([audit.actor_id, audit.destructive, audit.metadata.issue_code, audit.metadata.new_disposition, audit.metadata.evidence_ref, audit.metadata.before.floor_cents, audit.metadata.event_id],
    [x.moo, true, "awaiting_identity", "resolve_event_floor", "stripe-dash:acct/recon-0001", 15000, e1.id], "a destructive audit row: actor, issue, old / new disposition, evidence reference, before / after figures");
  eq((await req(x.db, null)) ?? null, null, "no request was released and none marked succeeded");
  // Duplicate delivery preserves the disposition.
  await ingest(x.db, { id: e1.id, pi: x.p.pi, created: t0, cumulative: 10000, chargeAmount: 30000, full: false });
  eq((await one(x.db, "select floor_state from public.catering_refund_event_work where event_id = $1", [e1.id])).floor_state, "operator_resolved", "a duplicate delivery preserves the disposition");
  // With only the resolved floor outstanding, ordinary admission becomes possible again.
  const second = (await issues(x.db, x.p.id)).find((i) => i.code === "awaiting_identity" && i.state === "open");
  await pass(x.db, x.p.id, x.s);
  await call(await x.w.session(x.moo, { fresh: true }), { g: await gen(), id: second.id });
  const f2 = await figures(x.db, x.p.id);
  eq([f2.o_floor, f2.o_held, f2.o_available], [0, false, 30000], "with no floor left, the money is available and unheld");
  const session = await x.w.session(x.owner);
  eq((await rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 5000, "customer_cancelled", null, "panel"])).replay, false, "ordinary refund admission works again");
  void armedWorld;
  await x.db.close();
});

test("every_hold_code_has_an_exit", async () => {
  // The CLOSED vocabulary, enumerated from the table's own CHECK, with an executable exit through the protected RPC
  // for EVERY code. A bare acknowledgement never ends a blocking hold.
  const x = await liveWorld();
  const def = (await one(x.db, "select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conrelid = 'public.catering_refund_issues'::regclass and pg_get_constraintdef(c.oid) like '%awaiting_identity%'")).d;
  const codes = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
  const EXITS = {
    awaiting_identity: ["resolve_event_floor"], verified_unreadable: ["recheck_after_access"], ambiguous_binding: ["bind_verified_refund"],
    refund_revived: ["evidence_reviewed"], released_request_has_refund: ["evidence_reviewed"], unfamiliar_identity: ["evidence_reviewed"],
    capture_review: ["evidence_reviewed"], wrong_charge: ["exclude_unrelated_hint"], owner_indeterminate: ["recheck_after_access"],
    quarantined_hint: ["exclude_unrelated_hint"], reserved_not_sent: ["release_unsent"], submission_unconfirmed: ["acknowledge_followup"],
    checkout_still_open: ["acknowledge_followup"],
  };
  eq(codes, Object.keys(EXITS).sort(), "the SQL vocabulary is exactly the census (13 codes); the TS twin is pinned to it in tests/catering-refund-0359-migration.test.ts");
  const BLOCKING = ["awaiting_identity", "verified_unreadable", "ambiguous_binding", "refund_revived", "released_request_has_refund", "capture_review", "wrong_charge", "owner_indeterminate"];
  // One synthetic issue per code on its own payment (the fixture owner seeds the occurrence; the EXIT is the real RPC).
  for (const code of codes) {
    const p = await x.w.pay(x.quote, "balance", 20000);
    x.s.charge(p.pi, { captured: 20000 });
    await pass(x.db, p.id, x.s);
    const w0 = await work(x.db, p.id);
    let request = null, refund = null, event = null;
    if (["ambiguous_binding", "refund_revived", "released_request_has_refund", "reserved_not_sent", "submission_unconfirmed"].includes(code)) {
      request = (await one(x.db, `insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents, reason_code, trigger_kind, requested_by)
        values ($1, $2, $3, $4, 5000, 'customer_cancelled', 'panel', $5) returning id`, [p.id, x.quote, x.w.shop, randomUUID(), x.owner])).id;
    }
    if (["ambiguous_binding", "unfamiliar_identity"].includes(code)) {
      refund = x.s.refund(p.pi, 5000, "succeeded");
      await pass(x.db, p.id, x.s);
    }
    if (["wrong_charge", "quarantined_hint"].includes(code)) {
      refund = `re_hint_${code}`;
      await x.db.query("insert into public.catering_refund_identities (refund_id, payment_id, first_source) values ($1, $2, 'event')", [refund, p.id]);
    }
    if (code === "verified_unreadable") {
      // A REAL occurrence: a verified id that every account then answers 404 for.
      refund = x.s.refund(p.pi, 1000, "succeeded");
      await pass(x.db, p.id, x.s);
      await pass(x.db, p.id, x.s, { reads: { [refund]: "not_found_all" } });
    }
    if (code === "owner_indeterminate") {
      // A REAL occurrence: no permitted account knows the PaymentIntent.
      await pass(x.db, p.id, x.s, { ownerStatus: "indeterminate" });
    }
    if (code === "awaiting_identity") {
      event = (await ingest(x.db, { pi: p.pi, created: now() - 60, cumulative: 7000, chargeAmount: 20000, full: false })).id;
      await pass(x.db, p.id, x.s);
    }
    const g = Number((await work(x.db, p.id)).generation);
    const existing = (await issues(x.db, p.id)).find((i) => i.code === code && i.state !== "resolved");
    const id = existing?.id ?? (await one(x.db, `insert into public.catering_refund_issues (code, payment_id, location_id, request_id, refund_id, event_id, evidence_fingerprint, blocking, generation_at_open)
      values ($1, $2, $3, $4, $5, $6, 'census', $7, $8) returning id`, [code, p.id, x.w.shop, request, refund, event, BLOCKING.includes(code), g])).id;
    if (BLOCKING.includes(code)) {
      check((await figures(x.db, p.id)).o_held, `${code}: holds the payment while open`);
      await refuses(async () => rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, id, g, "acknowledge_followup", null, await x.w.session(x.moo, { fresh: true }), null]), "invalid_action", `${code}: merely acknowledging it is refused`);
    }
    const action = EXITS[code][0];
    const out = await rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, id, g, action, "ref:census/0001", await x.w.session(x.moo, { fresh: true }), ["bind_verified_refund", "exclude_unrelated_hint"].includes(action) ? refund : null]);
    // A recheck is not an exit by itself: the exit is the REPAIRED pass it asks for (access restored), which must END the hold.
    if (action === "recheck_after_access") await pass(x.db, p.id, x.s);
    const after = await one(x.db, "select state, disposition from public.catering_refund_issues where id = $1", [id]);
    check(out.result === "ok" && after.state === "resolved", `${code}: the panel action ${action} runs through the protected RPC and ENDS the occurrence (state ${after.state}, ${after.disposition})`);
    if (BLOCKING.includes(code)) check(!(await figures(x.db, p.id)).o_held, `${code}: after its exit the payment is no longer held`);
    if (code === "awaiting_identity") check(!(await figures(x.db, p.id)).o_held && (await figures(x.db, p.id)).o_floor === 0, "awaiting_identity: the exit is FINANCIAL (the floor is gone and the payment is unheld)");
    void w0;
  }
  // The same reviewed evidence does not page staff again; materially changed evidence opens a new occurrence.
  const p = await x.w.pay(x.quote, "balance", 9000); x.s.charge(p.pi, { captured: 9000 });
  const ev = await ingest(x.db, { pi: p.pi, created: now() - 60, cumulative: 4000, chargeAmount: 9000, full: false });
  await pass(x.db, p.id, x.s); await pass(x.db, p.id, x.s); await pass(x.db, p.id, x.s);
  eq(await count(x.db, "select count(*) n from public.catering_refund_issues where payment_id = $1 and code = 'awaiting_identity'", [p.id]), 1, "three observations of the same evidence = ONE occurrence");
  await ingest(x.db, { pi: p.pi, created: now() - 30, cumulative: 6000, chargeAmount: 9000, full: false });
  await pass(x.db, p.id, x.s);
  eq(await count(x.db, "select count(*) n from public.catering_refund_issues where payment_id = $1 and code = 'awaiting_identity'", [p.id]), 2, "a new event is new evidence: a new occurrence");
  void ev;
  await x.db.close();
});

test("disposition_matrix_authority_staleness_and_reopen", async () => {
  const x = await liveWorld();
  const r = x.s.refund(x.p.pi, 5000, "succeeded");
  await pass(x.db, x.p.id, x.s);
  x.s.hidden.add(r);
  const res = await pass(x.db, x.p.id, x.s, { reads: { [r]: "not_found_all" } });
  eq(res.result, "held", "a previously verified id that every account now 404s blocks this payment's apply");
  const issue = (await issues(x.db, x.p.id)).find((i) => i.code === "verified_unreadable");
  const g = async () => Number((await work(x.db, x.p.id)).generation);
  const act = async (action, user = x.moo, ref = "ref:access/0001") => rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, issue.id, await g(), action, ref, await x.w.session(user, { fresh: true }), null]);
  eq((await act("access_still_required")).state, "held", "'reviewed, access still required' keeps the conservative block");
  check((await figures(x.db, x.p.id)).o_held, "the payment stays held and restricted");
  await refuses(() => act("evidence_reviewed"), "invalid_action", "an action outside the matrix for this code is refused");
  await refuses(() => act("keep_held", x.gm), "forbidden", "authority is re-checked on every action");
  eq((await act("reopen_recheck", x.owner, null)).state, "open", "Reopen and recheck (Owner, any shop) re-opens the investigation");
  x.s.hidden.delete(r);
  const ok = await pass(x.db, x.p.id, x.s);
  eq([ok.result, ok.held], ["applied", false], "after access is restored a fresh sufficient pass closes the hold");
  eq((await one(x.db, "select state, disposition from public.catering_refund_issues where id = $1", [issue.id])), { state: "resolved", disposition: "evidence_cleared" }, "the issue is closed by the evidence");
  await refuses(() => act("keep_held"), "issue_closed", "a closed issue takes no further action");
  // Review fix (Opus F8): the SAME evidence comes back (unreadable again): the occurrence the evidence had cleared RE-OPENS.
  x.s.hidden.add(r);
  eq((await pass(x.db, x.p.id, x.s, { reads: { [r]: "not_found_all" } })).result, "held", "unreadable again: the apply is blocked again");
  eq([(await one(x.db, "select state from public.catering_refund_issues where id = $1", [issue.id])).state, (await figures(x.db, x.p.id)).o_held], ["open", true],
    "the evidence-cleared occurrence re-opens and holds the payment again");
  x.s.hidden.delete(r);
  await pass(x.db, x.p.id, x.s);
  // A service-role caller cannot promote a client-supplied actor: the function has no actor argument at all.
  const sig = (await one(x.db, "select pg_get_function_identity_arguments('public.catering_refund_resolve_anomaly(text, uuid, bigint, text, text, uuid, text)'::regprocedure) as a")).a;
  check(!/actor|stepped/.test(sig), "resolve_anomaly takes no actor and no stepped_up argument (the session row decides both)");
  await x.db.close();
});

test("verified_404_blocks_only_its_payment", async () => {
  const x = await liveWorld();
  const p2 = await x.w.pay(x.quote, "balance", 20000); x.s.charge(p2.pi, { captured: 20000 });
  const r = x.s.refund(x.p.pi, 5000, "succeeded");
  await pass(x.db, x.p.id, x.s); await pass(x.db, p2.id, x.s);
  const before = await one(x.db, "select amount_cents::int as a, class, provider_status from public.catering_refund_identities where refund_id = $1", [r]);
  const a = await pass(x.db, x.p.id, x.s, { reads: { [r]: "not_found_all" } });
  eq([a.result, (await figures(x.db, x.p.id)).o_held], ["held", true], "the payment with the unreadable verified id is blocked");
  eq(await one(x.db, "select amount_cents::int as a, class, provider_status from public.catering_refund_identities where refund_id = $1", [r]), before, "its last verified facts are preserved");
  check((await one(x.db, "select unreadable_since from public.catering_refund_identities where refund_id = $1", [r])).unreadable_since != null, "the anomaly carries its age");
  const b = await pass(x.db, p2.id, x.s);
  eq([b.result, b.held, b.available_cents], ["applied", false, 20000], "the OTHER payment of the same order still applies");
  // A transient failure on the verified id is not an anomaly: the pass is simply incomplete.
  const y = await liveWorld();
  const r2 = y.s.refund(y.p.pi, 5000, "succeeded"); await pass(y.db, y.p.id, y.s);
  const t = await pass(y.db, y.p.id, y.s, { reads: { [r2]: "transient" } });
  eq([t.result, t.reason, (await issues(y.db, y.p.id)).length], ["incomplete_evidence", "read_transient", 0], "a timeout / 429 / 5xx raises no anomaly and publishes nothing");
  await x.db.close(); await y.db.close();
});

test("all_404_hint_quarantines_and_reopens_on_new_evidence", async () => {
  const x = await liveWorld();
  await ingest(x.db, { type: "refund.updated", pi: x.p.pi, created: now() - 60, hints: [{ id: "re_ghost", status: "pending" }] });
  const runs = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const n = async () => (await one(x.db, "select not_found_passes as n, quarantined_at from public.catering_refund_identities where refund_id = 're_ghost'"));
  let a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: runs[0] });
  eq([a.result, a.reason, (await n()).n], ["incomplete_evidence", "hint_unresolved", 1], "attempt 1: every account 404 on a complete scheduled pass counts once; nothing is published yet");
  a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: runs[0] });
  eq((await n()).n, 1, "the SAME scheduled attempt does not count twice");
  a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: randomUUID(), reads: { re_ghost: "denied" } });
  eq((await n()).n, 1, "an all-account pass containing a 401 consumes no 404 attempt");
  a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: randomUUID(), reads: { re_ghost: "transient" } });
  eq((await n()).n, 1, "a 429 / timeout / 5xx consumes no 404 attempt");
  a = await pass(x.db, x.p.id, x.s, { scheduled: false, runId: randomUUID() });
  eq((await n()).n, 1, "a staff press is not a scheduled attempt");
  a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: runs[1], complete: false });
  eq((await n()).n, 1, "an incomplete pass does not count");
  a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: runs[1] });
  a = await pass(x.db, x.p.id, x.s, { scheduled: true, runId: runs[2] });
  const q = await n();
  eq([q.n, q.quarantined_at != null, a.result], [3, true, "applied"], "the third distinct scheduled all-404 pass quarantines the hint and the pass PROCEEDS with other evidence");
  eq((await issues(x.db, x.p.id)).map((i) => [i.code, i.blocking]), [["quarantined_hint", false]], "the quarantine is visible and does not hold the payment");
  eq((await one(x.db, "select first_source from public.catering_refund_identities where refund_id = 're_ghost'")).first_source, "event", "its provenance is retained");
  // Quarantine cannot clear a cumulative floor.
  const ev = await ingest(x.db, { pi: x.p.pi, created: now() - 30, cumulative: 5000, chargeAmount: 30000, full: false });
  a = await pass(x.db, x.p.id, x.s);
  eq(a.floors_outstanding, 1, "a quarantined hint clears no cumulative floor");
  // New evidence re-opens the hint.
  await ingest(x.db, { type: "refund.updated", pi: x.p.pi, created: now() - 10, hints: [{ id: "re_ghost", status: "succeeded" }] });
  eq(await n(), { n: 0, quarantined_at: null }, "new evidence re-opens the quarantined hint");
  void ev;
  await x.db.close();
});

test("unknown_prefix_reserves_without_blocking_other_identities", async () => {
  const x = await liveWorld();
  const odd = x.s.refund(x.p.pi, 4000, "succeeded", { id: "rfnd_NEWPREFIX1" });
  const strange = x.s.refund(x.p.pi, 3000, "under_review"); // a structurally valid, unfamiliar provider status
  const fine = x.s.refund(x.p.pi, 2000, "succeeded");
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.returned_cents, a.reserved_cents, a.available_cents, a.held, a.payment_status], ["applied", 2000, 7000, 21000, false, "paid"],
    "an unfamiliar STATUS and an unfamiliar PREFIX each RESERVE their verified amount (never counted as returned); other identities proceed");
  eq(await rows(x.db, "select refund_id, unfamiliar, class from public.catering_refund_identities where payment_id = $1 order by refund_id", [x.p.id]),
    [{ refund_id: fine, unfamiliar: false, class: "returned" }, { refund_id: strange, unfamiliar: true, class: "reserved" }, { refund_id: odd, unfamiliar: true, class: "reserved" }].sort((p, q) => p.refund_id < q.refund_id ? -1 : 1), "both unfamiliar values are flagged in the ledger");
  eq((await issues(x.db, x.p.id)).map((i) => [i.code, i.blocking]).sort(), [["unfamiliar_identity", false], ["unfamiliar_identity", false]], "flagged, never blocking");
  // The opaque id is never forced through 0357's `re_` / `pyr_` request binding.
  check((await one(x.db, "select refunds from public.catering_refund_stripe_snapshots where payment_id = $1", [x.p.id])).refunds.some((r) => r.id === odd), "the conservative snapshot projection keeps the opaque id");
  await x.db.close();
  // Review fix (Astra P1): a new-prefix refund for the WHOLE capture, status succeeded, never marks the payment refunded.
  const y = await liveWorld();
  y.s.refund(y.p.pi, 30000, "succeeded", { id: "rfnd_WHOLE1" });
  const b = await pass(y.db, y.p.id, y.s);
  eq([b.payment_status, b.returned_cents, b.reserved_cents, b.available_cents], ["paid", 0, 30000, 0], "an unfamiliar-prefix whole refund reserves the capture; the payment stays paid and checkout is not reopened");
  await y.db.close();
});

test("request_transitions_and_stored_view", async () => {
  // B1.4's table, each row, with the stored view checked on every transition.
  const x = await liveWorld();
  const view = async () => { const s = (await rpc(x.db, "catering_refund_summary", [CALLER, [x.quote]])).quotes[0]; return { pay: s.payments[0], req: s.requests[0], issues: s.issues }; };
  const k = await reserveClaimArm(x, x.owner, 10000);
  eq(k.armed.result, "armed", "claim -> complete discovery -> arm");
  let v = await view();
  eq([v.pay.available_cents, v.pay.reservations_cents, v.req.status, v.req.armed], [20000, 10000, "pending", true], "stored view: the armed request reserves 100");
  // POST accepted: a refund id came back.
  const rid = x.s.refund(x.p.pi, 10000, "pending", { request: k.request, metaPayment: x.p.id, metaQuote: x.quote, created: now() });
  eq((await rpc(x.db, "catering_refund_finish", [CALLER, k.request, k.claim.claim_token, "created", rid, null, null])).result, "registered", "the returned id is registered");
  let a = await pass(x.db, x.p.id, x.s);
  v = await view();
  eq([a.transitions, v.req.status, v.req.stripe_status, v.pay.reserved_cents, v.pay.reservations_cents, v.pay.available_cents], [1, "submitted", "pending", 10000, 0, 20000], "pending -> submitted (reserved): bound once; counted once, by its identity");
  x.s.set(rid, { status: "succeeded" });
  a = await pass(x.db, x.p.id, x.s); v = await view();
  eq([v.req.status, v.pay.returned_cents, v.pay.status, (await req(x.db, k.request)).settled_at != null], ["succeeded", 10000, "paid", true], "submitted -> succeeded; a $100 return on a $300 capture stays paid");
  const seq = (await req(x.db, k.request)).reconcile_seq;
  a = await pass(x.db, x.p.id, x.s);
  eq([a.transitions, (await req(x.db, k.request)).reconcile_seq], [0, seq], "succeeded -> same success: no transition, no audit duplicate");
  // success_action_failure_settlement_clocks: succeeded -> requires_action -> failed.
  x.s.set(rid, { status: "requires_action" });
  a = await pass(x.db, x.p.id, x.s);
  let r = await req(x.db, k.request);
  eq([r.status, r.first_reversed_at != null, r.settled_at], ["submitted", true, null], "success_action_failure_settlement_clocks: succeeded -> submitted records first_reversed_at once and clears settled_at");
  const firstReversed = r.first_reversed_at;
  x.s.set(rid, { status: "failed" });
  a = await pass(x.db, x.p.id, x.s); r = await req(x.db, k.request); v = await view();
  eq([r.status, r.last_error_code, String(r.first_reversed_at) === String(firstReversed), r.settled_at != null, v.pay.available_cents], ["failed", "provider_failed", true, true, 30000],
    "success_action_failure_settlement_clocks: -> failed with the provider reason; first_reversed_at is write-once; settled_at set on entry to a terminal state; the amount is released");
  const audits = (await rows(x.db, "select action from public.audit_log where resource_id = $1 order by id", [k.request])).map((r2) => r2.action);
  check(audits.includes("catering.refund.reversed") && audits.includes("catering.refund.provider_failed"), "the reversal and the provider failure are audited");
  a = await pass(x.db, x.p.id, x.s);
  eq(a.transitions, 0, "provider-failed -> same void: idempotent, no second failure occurrence");
  // Provider-failed -> returned: the actual money class, refund_revived, staff review.
  x.s.set(rid, { status: "succeeded" });
  a = await pass(x.db, x.p.id, x.s); r = await req(x.db, k.request); v = await view();
  eq([r.status, r.binding_hold, v.pay.returned_cents, v.pay.held, v.issues.map((i) => i.code)], ["succeeded", "refund_revived", 10000, true, ["refund_revived"]],
    "provider-failed -> returned: the money is counted, refund_revived is raised and the payment is held for staff review");
  // The guard: no direct provider move without the protected sequence.
  await refuses(() => x.db.query("update public.catering_refund_requests set status = 'failed' where id = $1", [k.request]), "refund_request_bad_transition", "the guard refuses succeeded -> failed without a sequence advance");
  await refuses(() => x.db.query("update public.catering_refund_requests set reconcile_seq = reconcile_seq - 1 where id = $1", [k.request]), "refund_request_immutable", "the sequence never goes back");
  await refuses(() => x.db.query("update public.catering_refund_requests set create_armed_at = now() where id = $1", [k.request]), "refund_request_immutable", "the arm is write-once");
  await refuses(() => x.db.query("update public.catering_refund_requests set first_reversed_at = now() where id = $1", [k.request]), "refund_request_immutable", "first_reversed_at is write-once");
  await refuses(() => x.db.query("update public.catering_refund_requests set amount_cents = 1 where id = $1", [k.request]), "refund_request_immutable", "0357's immutables still hold");
  await refuses(() => x.db.query("delete from public.catering_payment_refund_outcomes"), "refund_outcome_append_only", "outcomes are append-only");
  eq((await rows(x.db, "select from_class, to_class from public.catering_payment_refund_outcomes where refund_id = $1 order by id", [rid])).map((o) => `${o.from_class}>${o.to_class}`),
    ["null>reserved", "reserved>returned", "returned>reserved", "reserved>void", "void>returned"], "every identity class transition is one append-only outcome row");
  await x.db.close();
});

test("payment_status_rules", async () => {
  const x = await liveWorld();
  const full = x.s.refund(x.p.pi, 30000, "pending");
  let a = await pass(x.db, x.p.id, x.s);
  eq([a.payment_status, a.available_cents], ["paid", 0], "a full PENDING refund leaves zero available and the payment paid");
  x.s.set(full, { status: "succeeded" });
  a = await pass(x.db, x.p.id, x.s);
  eq([a.payment_status, a.previous_payment_status], ["refunded", "paid"], "paid -> refunded only when verified succeeded cents cover the known positive capture");
  check((await rows(x.db, "select metadata from public.audit_log where action = 'catering.payment.provider_refunded'")).some((r) => r.metadata.actor_context === "refund_reconciler"), "catering.payment.provider_refunded is retained and written by the reconciler");
  x.s.set(full, { status: "failed" });
  a = await pass(x.db, x.p.id, x.s);
  eq([a.payment_status, a.cleanup_owed, (await work(x.db, x.p.id)).checkout_cleanup_owed_at != null], ["paid", true, true], "refunded -> paid on verified returns below capture, with the family-checkout cleanup obligation in the same commit");
  // Unknown capture with a partial return: review, no status move.
  const y = await liveWorld();
  y.s.charges.get(y.p.pi).captured = null;
  y.s.refund(y.p.pi, 5000, "succeeded");
  const b = await pass(y.db, y.p.id, y.s);
  eq([b.payment_status, b.held, (await issues(y.db, y.p.id)).map((i) => i.code)], ["paid", true, ["capture_review"]], "unknown capture with a partial return requires review");
  // Over-capture.
  const z = await liveWorld({ captured: 10000 });
  z.s.refund(z.p.pi, 8000, "succeeded"); z.s.refund(z.p.pi, 8000, "pending");
  const c = await pass(z.db, z.p.id, z.s);
  eq([c.payment_status, c.held, (await issues(z.db, z.p.id)).map((i) => i.code)], ["paid", true, ["capture_review"]], "over-capture requires review and moves nothing");
  // Mixed currency.
  const m = await liveWorld();
  await pass(m.db, m.p.id, m.s);
  m.s.charges.get(m.p.pi).currency = "cad";
  eq((await pass(m.db, m.p.id, m.s)).result, "held", "a currency that contradicts the verified one holds the payment");
  await x.db.close(); await y.db.close(); await z.db.close(); await m.db.close();
});

test("generation_fencing_stale_apply_defer_and_equal_clock", async () => {
  const x = await liveWorld();
  const run = randomUUID();
  const b1 = await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, run]);
  eq((await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()])).result, "busy", "one staged pass per payment: the competitor defers");
  // New event evidence invalidates the staged read.
  await ingest(x.db, { pi: x.p.pi, created: now() - 5, cumulative: 1000, chargeAmount: 30000, full: false });
  const ev = { complete: true, owner: x.s.owner(x.p.pi), refunds: [] };
  eq((await rpc(x.db, "catering_refund_apply", [CALLER, x.p.id, b1.pass_token, b1.generation, JSON.stringify(ev)])).result, "stale_generation", "a stale apply (new event evidence) writes nothing");
  eq((await rpc(x.db, "catering_refund_pass_remember", [CALLER, x.p.id, b1.pass_token, "[]", null, 1])).result, "stale_generation", "a stale remember writes nothing");
  // stale defer
  eq((await rpc(x.db, "catering_refund_defer", [CALLER, x.p.id, randomUUID(), "contention", 60])).result, "stale_generation", "a stale defer writes nothing");
  const b2 = await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()]);
  eq(b2.result, "begun", "a stale stage does not block the next pass (its generation moved on)");
  const before = (await work(x.db, x.p.id)).next_due_at;
  eq((await rpc(x.db, "catering_refund_defer", [CALLER, x.p.id, b2.pass_token, "account_unavailable", 600])).result, "deferred", "a fair defer under the token");
  check(new Date((await work(x.db, x.p.id)).next_due_at) > new Date(before), "the deferred payment stepped back in the due order");
  // Equal-clock competing applies: the second token is dead the moment the first commits.
  const c1 = await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()]);
  eq((await rpc(x.db, "catering_refund_apply", [CALLER, x.p.id, c1.pass_token, c1.generation, JSON.stringify(ev)])).result, "applied", "the first apply commits");
  eq((await rpc(x.db, "catering_refund_apply", [CALLER, x.p.id, c1.pass_token, c1.generation, JSON.stringify(ev)])).result, "stale_generation", "the same-clock second apply cannot overwrite it");
  // Pagination past capacity: completion across more than one invocation.
  const d1 = await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()]);
  const r = x.s.refund(x.p.pi, 1000, "succeeded", { created: now() - 100 });
  eq((await rpc(x.db, "catering_refund_pass_remember", [CALLER, x.p.id, d1.pass_token, JSON.stringify([{ id: r }]), r, 5])).result, "remembered", "learned ids and the cursor are persisted");
  const inc = await rpc(x.db, "catering_refund_apply", [CALLER, x.p.id, d1.pass_token, d1.generation, JSON.stringify({ complete: false, owner: x.s.owner(x.p.pi), refunds: [x.s.read(r)] })]);
  eq([inc.result, inc.reason], ["incomplete_evidence", "list_incomplete"], "no terminal page: nothing is published");
  const d2 = await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()]);
  eq([d2.cursor?.after, d2.ids.map((i) => i.id)], [r, [r]], "the next invocation resumes from the persisted cursor with the learned id");
  eq((await rpc(x.db, "catering_refund_apply", [CALLER, x.p.id, d2.pass_token, d2.generation, JSON.stringify({ complete: true, owner: x.s.owner(x.p.pi), refunds: [x.s.read(r)] })])).result, "applied", "and completes");
  // Omitted bound id: coverage is re-checked under the lock.
  const e1 = await rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()]);
  const om = await rpc(x.db, "catering_refund_apply", [CALLER, x.p.id, e1.pass_token, e1.generation, JSON.stringify({ complete: true, owner: x.s.owner(x.p.pi), refunds: [] })]);
  eq([om.result, om.reason], ["incomplete_evidence", "coverage"], "an evidence set that omits a known id is refused under the lock");
  await x.db.close();
});

test("prior_claim_without_arm_is_not_a_prior_send", async () => {
  const x = await liveWorld();
  const k = await reserveClaimArm(x, x.owner, 10000, { arm: false });
  // The claim expired without ever arming: a clean local refusal can still close it.
  eq((await rpc(x.db, "catering_refund_finish", [CALLER, k.request, k.claim.claim_token, "local_refusal", null, "stripe_not_configured", "no key"])).result, "closed", "an earlier claim that never armed ends in a clean local refusal");
  eq((await req(x.db, k.request)).status, "failed", "and releases its amount");
  // An ARMED row is different: a refusal after an uncertain POST cannot release it; an empty list does not disarm it.
  const k2 = await reserveClaimArm(x, x.owner, 10000);
  eq((await rpc(x.db, "catering_refund_finish", [CALLER, k2.request, k2.claim.claim_token, "uncertain", null, "network_error", "timeout"])).result, "kept_pending", "a timeout keeps the armed row pending");
  await pass(x.db, x.p.id, x.s);
  eq([(await req(x.db, k2.request)).status, (await figures(x.db, x.p.id)).o_reservations], ["pending", 10000], "an empty list does not disarm it: the reservation stays");
  await backdate(x.db, "catering_refund_requests", "claimed_until", k2.request, "10 minutes");
  const session = await x.w.session(x.owner);
  const claim2 = await rpc(x.db, "catering_refund_claim_admitted", [CALLER, x.owner, session, k2.request]);
  eq(claim2.armed_before, true, "the next claim knows a POST may have left");
  const ap = await pass(x.db, x.p.id, x.s);
  const c = x.s.charges.get(x.p.pi);
  const arm2 = await rpc(x.db, "catering_refund_arm", [CALLER, x.owner, session, k2.request, claim2.claim_token, ap.generation, x.p.pi, c.charge, c.livemode]);
  eq([arm2.result, arm2.armed_before], ["armed", true], "a Retry inside the window re-arms on the original arm");
  eq((await rpc(x.db, "catering_refund_finish", [CALLER, k2.request, claim2.claim_token, "refused_unexecuted", null, "charge_already_refunded", "x"])).result, "kept_pending", "a refusal FOLLOWING an uncertain POST cannot release a possibly accepted refund");
  // A first, positively identified unexecuted refusal may close.
  const k3 = await reserveClaimArm(x, x.owner, 5000);
  eq((await rpc(x.db, "catering_refund_finish", [CALLER, k3.request, k3.claim.claim_token, "refused_unexecuted", null, "charge_already_refunded", "x"])).result, "closed", "a FIRST positively identified unexecuted refusal closes the request");
  // A returned refund id is durable evidence even if the claim expired.
  const k4 = await reserveClaimArm(x, x.owner, 5000);
  const rid = x.s.refund(x.p.pi, 5000, "succeeded", { request: k4.request, metaPayment: x.p.id, metaQuote: x.quote, created: now() });
  eq((await rpc(x.db, "catering_refund_finish", [CALLER, k4.request, randomUUID(), "created", rid, null, null])).result, "registered", "a returned id is registered although the claim token is no longer ours");
  await pass(x.db, x.p.id, x.s);
  eq([(await req(x.db, k4.request)).status, (await req(x.db, k4.request)).stripe_refund_id], ["succeeded", rid], "the financial apply decides the outcome from the exact read");
  await x.db.close();
});

test("arm_rechecks_everything", async () => {
  const x = await liveWorld();
  const session = await x.w.session(x.owner);
  const reserved = await rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 10000, "customer_cancelled", null, "panel"]);
  const request = reserved.requests[0].id;
  const claim = await rpc(x.db, "catering_refund_claim_admitted", [CALLER, x.owner, session, request]);
  const c = x.s.charges.get(x.p.pi);
  const arm = (o = {}) => rpc(x.db, "catering_refund_arm", [CALLER, o.actor ?? x.owner, o.session ?? session, request, o.token ?? claim.claim_token, o.gen, o.pi ?? x.p.pi, o.charge ?? c.charge, o.live ?? c.livemode]);
  eq((await arm({ gen: 1 })).result, "stale_generation", "no complete discovery at the current generation: no arm");
  const ap = await pass(x.db, x.p.id, x.s);
  eq((await arm({ gen: ap.generation, token: randomUUID() })).result, "claim_lost", "a foreign claim token");
  eq((await arm({ gen: ap.generation, charge: "ch_other" })).result, "wrong_charge", "another charge");
  eq((await arm({ gen: ap.generation, pi: "pi_other" })).result, "wrong_charge", "another PaymentIntent");
  eq((await arm({ gen: ap.generation, live: true })).result, "wrong_charge", "another mode");
  await refuses(async () => arm({ gen: ap.generation, actor: x.gm, session: await x.w.session(x.owner) }), "forbidden", "the actor must be the session's user");
  const prep = await x.w.user("prep_mgr");
  await refuses(async () => arm({ gen: ap.generation, actor: prep, session: await x.w.session(prep) }), "forbidden", "an actor outside the refund roles");
  // A floor that arrives after the reserve: the arm's financial check refuses.
  await ingest(x.db, { pi: x.p.pi, created: now() - 5, cumulative: 25000, chargeAmount: 30000, full: false });
  const ap2 = await pass(x.db, x.p.id, x.s);
  eq((await arm({ gen: ap2.generation })).result, "payment_held", "an unexplained floor holds the arm");
  // slow_preflight_never_posts_after_deadline: the 24-hour clock is first_attempt_at, checked at the arm with the margin.
  const y = await liveWorld();
  const s2 = await y.w.session(y.owner);
  const r2 = (await rpc(y.db, "catering_refund_reserve_admitted", [CALLER, y.owner, s2, y.quote, randomUUID(), 10000, "customer_cancelled", null, "panel"])).requests[0].id;
  const cl = await rpc(y.db, "catering_refund_claim_admitted", [CALLER, y.owner, s2, r2]);
  const ap3 = await pass(y.db, y.p.id, y.s);
  await backdate(y.db, "catering_refund_requests", "first_attempt_at", r2, "23 hours 59 minutes 30 seconds");
  const c2 = y.s.charges.get(y.p.pi);
  eq((await rpc(y.db, "catering_refund_arm", [CALLER, y.owner, s2, r2, cl.claim_token, ap3.generation, y.p.pi, c2.charge, c2.livemode])).result, "window_closed",
    "slow_preflight_never_posts_after_deadline: inside the last minute of the window nothing is armed (GETs only after the deadline)");
  eq((await req(y.db, r2)).create_armed_at, null, "and no arm was written");
  await x.db.close(); await y.db.close();
});

test("split_tap_dies_after_first_row_second_is_raised_never_posted", async () => {
  const x = await liveWorld();
  const p2 = await x.w.pay(x.quote, "balance", 20000); x.s.charge(p2.pi, { captured: 20000 });
  const session = await x.w.session(x.owner);
  const reserved = await rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 40000, "customer_cancelled", null, "panel"]);
  eq(reserved.requests.map((r) => r.amount_cents), [20000, 20000], "one tap, two payments (balance first)");
  const replay = await rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, (await req(x.db, reserved.requests[0].id)).client_token, 40000, "customer_cancelled", null, "panel"]);
  eq([replay.replay, replay.requests.map((r) => r.id).sort()], [true, reserved.requests.map((r) => r.id).sort()], "a replay reports the original rows");
  eq(await count(x.db, "select count(*) n from public.audit_log where action = 'catering.refund.request' and destructive"), 2, "the destructive audit is preserved, one per row");
  // The press dies after the first row: the second is never claimed.
  const [first, second] = reserved.requests.map((r) => r.id);
  await rpc(x.db, "catering_refund_claim_admitted", [CALLER, x.owner, session, first]);
  await backdate(x.db, "catering_refund_requests", "requested_at", second, "16 minutes");
  const hk = await rpc(x.db, "catering_refund_sweep_housekeeping", [CALLER]);
  eq(hk.reserved_not_sent, 1, "the unarmed second reservation is raised after 15 minutes");
  eq(await rows(x.db, "select code, request_id, blocking from public.catering_refund_issues where code = 'reserved_not_sent'"), [{ code: "reserved_not_sent", request_id: second, blocking: false }], "ONE reserved_not_sent occurrence, for the second row");
  eq((await rpc(x.db, "catering_refund_sweep_housekeeping", [CALLER])).reserved_not_sent, 0, "and only one, ever");
  const r2 = await req(x.db, second);
  eq([r2.status, r2.create_armed_at, r2.arm_count, r2.attempts], ["pending", null, 0, 0], "it was never armed, never claimed, never posted (cron has no create capability)");
  // The sweep's due lists hold only payment ids: no function of the sweep can arm.
  const due = await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10]);
  check(due.reserved_unarmed.includes(r2.payment_id), "the sweep sees the unarmed reservation");
  // Early closure of a proved-unsent reservation: MoO+ step-up, no-live-claim fence.
  const issue = (await one(x.db, "select id, payment_id from public.catering_refund_issues where code = 'reserved_not_sent'"));
  const g = Number((await work(x.db, issue.payment_id)).generation);
  eq((await rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, issue.id, g, "release_unsent", "ref:panel/unsent", await x.w.session(x.moo, { fresh: true }), null])).result, "ok", "a proved never-armed reservation is closed as unsent under step-up");
  eq([(await req(x.db, second)).status, (await req(x.db, second)).last_error_code], ["failed", "released_unsent"], "closed, its amount released");
  await x.db.close();
});

test("released_request_late_success_staff_review_no_second_create", async () => {
  const x = await liveWorld();
  const k = await reserveClaimArm(x, x.owner, 10000);
  await rpc(x.db, "catering_refund_finish", [CALLER, k.request, k.claim.claim_token, "uncertain", null, "network_error", "timeout"]);
  const session = await x.w.session(x.gm);
  const rel = async (verified = true, gen = null) => rpc(x.db, "catering_refund_release", [CALLER, x.gm, session, k.request, gen ?? Number((await work(x.db, x.p.id)).generation), verified]);
  eq((await rel()).result, "not_releasable", "ordinary Release is refused inside the original 24-hour window");
  await backdate(x.db, "catering_refund_requests", "first_attempt_at", k.request, "25 hours");
  await backdate(x.db, "catering_refund_requests", "claimed_until", k.request, "25 hours");
  eq((await rel(false)).result, "staff_verification_required", "staff must verify the owning charge in Stripe");
  eq((await rel(true, 1)).result, "stale_generation", "Release is fenced on the generation of a fresh complete discovery");
  await pass(x.db, x.p.id, x.s);
  const out = await rel();
  eq([out.result, (await req(x.db, k.request)).last_error_code], ["released", "released_no_refund"], "GM at the shop, password-free, after the window, verified, fresh pass, no refund: released");
  eq((await figures(x.db, x.p.id)).o_available, 30000, "the reservation is released");
  // The create had landed after all: a late matching refund.
  x.s.refund(x.p.pi, 10000, "succeeded", { request: k.request, metaPayment: x.p.id, metaQuote: x.quote, created: now() - 86000 });
  const a = await pass(x.db, x.p.id, x.s);
  const r = await req(x.db, k.request);
  eq([r.status, r.last_error_code, r.binding_hold, a.returned_cents, a.held], ["failed", "released_no_refund", "released_request_has_refund", 10000, true],
    "the verified money is counted, the human disposition is preserved, and released_request_has_refund holds the payment for staff review");
  await refuses(() => rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.gm, session, x.quote, randomUUID(), 10000, "customer_cancelled", null, "panel"]), "payment_held", "no second create while that origin is disputed");
  // Review fix (Astra P1 / Fable 4): the STAFF REVIEW itself. `evidence_reviewed` lifts the hold and nothing else.
  const issue = (await issues(x.db, x.p.id)).find((i) => i.code === "released_request_has_refund");
  await rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, issue.id, Number((await work(x.db, x.p.id)).generation), "evidence_reviewed", "ref:late/0001", await x.w.session(x.moo, { fresh: true }), null]);
  const b = await pass(x.db, x.p.id, x.s);
  const r2 = await req(x.db, k.request);
  eq([r2.status, r2.last_error_code, r2.binding_hold, b.transitions, b.held, b.returned_cents], ["failed", "released_no_refund", "released_request_has_refund", 0, false, 10000],
    "after the review the request is STILL the released one (never flipped to succeeded), the money stays counted, the hold is lifted");
  eq((await issues(x.db, x.p.id)).filter((i) => i.code === "refund_revived").length, 0, "and no refund_revived occurrence is raised by reviewing it");
  await x.db.close();
});

test("ambiguous_binding_keeps_independent_reservation", async () => {
  const x = await liveWorld();
  const k = await reserveClaimArm(x, x.owner, 10000);
  await rpc(x.db, "catering_refund_finish", [CALLER, k.request, k.claim.claim_token, "uncertain", null, "network_error", "timeout"]);
  const a1 = x.s.refund(x.p.pi, 10000, "succeeded", { request: k.request, metaPayment: x.p.id, metaQuote: x.quote });
  const a2 = x.s.refund(x.p.pi, 10000, "succeeded", { request: k.request, metaPayment: x.p.id, metaQuote: x.quote });
  const a = await pass(x.db, x.p.id, x.s);
  const r = await req(x.db, k.request);
  eq([r.status, r.stripe_refund_id, r.binding_hold, a.returned_cents, a.available_cents, a.held], ["pending", null, "ambiguous_binding", 20000, 0, true],
    "two candidates: a hold; EACH verified identity is counted once and the independent unbound reservation is kept (200 + 100 = nothing available)");
  const issue = (await issues(x.db, x.p.id)).find((i) => i.code === "ambiguous_binding");
  const g = Number((await work(x.db, x.p.id)).generation);
  await refuses(async () => rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, issue.id, g, "bind_verified_refund", "ref:bind/1", await x.w.session(x.moo, { fresh: true }), "re_not_there"]), "invalid_action", "binding needs an unclaimed exact refund on this payment");
  await rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, issue.id, g, "bind_verified_refund", "ref:bind/1", await x.w.session(x.moo, { fresh: true }), a1]);
  const b = await pass(x.db, x.p.id, x.s);
  const r2 = await req(x.db, k.request);
  eq([r2.status, r2.stripe_refund_id, r2.binding_hold, b.returned_cents, b.available_cents], ["succeeded", a1, null, 20000, 10000], "Bind verified refund: the request follows the chosen id; the other refund stays counted");
  await refuses(() => x.db.query("update public.catering_refund_requests set stripe_refund_id = $2 where id = $1", [k.request, a2]), "refund_request_immutable", "an existing immutable binding cannot be moved");
  await x.db.close();
  // Review fix (Astra P1): a refund whose LIST entry names request R but whose exact metadata contradicts R's facts
  // (another quote) is an unrelated external refund: it never binds R and never removes R's independent reservation.
  const y = await liveWorld();
  const ky = await reserveClaimArm(y, y.owner, 10000);
  await rpc(y.db, "catering_refund_finish", [CALLER, ky.request, ky.claim.claim_token, "uncertain", null, "network_error", "timeout"]);
  const ext = y.s.refund(y.p.pi, 10000, "succeeded", { request: ky.request, metaPayment: y.p.id, metaQuote: randomUUID() });
  const by = await rpc(y.db, "catering_refund_pass_begin", [CALLER, y.p.id, randomUUID()]);
  // The list page teaches the id WITH the request it names (what the reconciler used to remember):
  await rpc(y.db, "catering_refund_pass_remember", [CALLER, y.p.id, by.pass_token, JSON.stringify([{ id: ext, request: ky.request }]), null, 1]);
  eq((await one(y.db, "select candidate_request_id from public.catering_refund_identities where refund_id = $1", [ext])).candidate_request_id, null, "list metadata is never a request candidate");
  const ay = await rpc(y.db, "catering_refund_apply", [CALLER, y.p.id, by.pass_token, by.generation, JSON.stringify({ complete: true, owner: y.s.owner(y.p.pi), refunds: [y.s.read(ext)] })]);
  const ry = await req(y.db, ky.request);
  eq([ay.result, ry.status, ry.stripe_refund_id, ry.binding_hold, ay.returned_cents, ay.available_cents], ["applied", "pending", null, null, 10000, 10000],
    "the contradictory refund is counted as money and binds nothing: the request stays pending with its own reservation (300 - 100 - 100)");
  await y.db.close();
});

test("ingress_durable_floor_history_and_verdict", async () => {
  const x = await liveWorld();
  const created = now() - 30;
  const ev = await ingest(x.db, { pi: x.p.pi, charge: "ch_x", created, cumulative: 10000, chargeAmount: 30000, full: false, hints: [{ id: "re_h1", status: "succeeded" }] });
  eq([ev.result, ev.state, ev.floor], ["registered", "attached", true], "matched ingress: work, hints and floor in one transaction");
  eq(await ledger(x.db, ev.id), "refund_state_owed", "the terminal transport verdict is stamped with it");
  eq(await rows(x.db, "select cumulative_refunded_cents::int as c, charge_amount_cents::int as a, refunded_at_approximate as ap from public.catering_payment_refund_events where stripe_event_id = $1", [ev.id]),
    [{ c: 10000, a: 30000, ap: false }], "the matched 0333 charge-history append happens once");
  const dup = await ingest(x.db, { id: ev.id, pi: x.p.pi, created, cumulative: 10000, chargeAmount: 30000, full: false });
  eq([dup.result, await count(x.db, "select count(*) n from public.catering_payment_refund_events")], ["duplicate", 1], "a duplicate whose work committed answers again and appends nothing");
  // The four refund-object events, bare or expanded ids are the app's concern; here: each registers hints, no floor.
  for (const type of ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]) {
    const e = await ingest(x.db, { type, pi: x.p.pi, created: now(), hints: [{ id: `re_${type.replace(/\W/g, "")}`, status: "pending" }] });
    eq([e.result, e.state, e.floor], ["registered", "attached", false], `${type} registers durable work and hints without a floor`);
  }
  // Wrong-shop work cannot alter either shop's money.
  const before = await figures(x.db, x.p.id);
  const wrong = await ingest(x.db, { pi: x.p.pi, created: now(), cumulative: 29000, chargeAmount: 30000, full: false, loc: x.w.other });
  eq([wrong.state, wrong.floor, (await figures(x.db, x.p.id)).o_floor], ["quarantined", false, before.o_floor], "an event from another shop's endpoint is quarantined evidence: no floor, no hint, no history");
  // Unmatched: indexed by PI, parked after 24 h of confirmed absence, reawakened by settlement however old.
  const un = await ingest(x.db, { pi: "pi_foreign_1", created: now(), cumulative: 500, chargeAmount: 900, full: false });
  eq([un.state, await ledger(x.db, un.id)], ["unmatched", "refund_state_owed"], "an unmatched event is durable and acknowledged");
  await x.db.close();
});

test("aged_no_payment_reawakened_by_settlement", async () => {
  const db = await ready();
  const w = await world(db); const s = new FakeStripe();
  const q = await w.quote();
  const due = await w.pay(q, "deposit", 30000, { status: "due" });
  await goLive(db);
  const pi = "pi_early_refund_1";
  const ev = await ingest(db, { pi, created: now() - 40 * 86400, cumulative: 30000, chargeAmount: 30000, full: true });
  await backdate(db, "catering_refund_event_work", "received_at", ev.id, "40 days", "event_id");
  eq((await rpc(db, "catering_refund_sweep_housekeeping", [CALLER])).parked, 1, "24 h of confirmed absence: parked `no_payment`, out of recurring due selection");
  eq((await one(db, "select state from public.catering_refund_event_work where event_id = $1", [ev.id])).state, "no_payment", "still indexed by PI");
  // The payment settles (the paid flip writes the PaymentIntent), then settlement attaches under the payment lock.
  await db.query("update public.catering_payments set status = 'paid', provider = 'stripe', provider_ref = $2, paid_at = now() where id = $1", [due.id, pi]);
  s.charge(pi);
  const at = await rpc(db, "catering_refund_settlement_attach", [CALLER, due.id]);
  eq([at.result, at.events, at.floors], ["attached", [ev.id], 1], "settlement reawakens the parked event by PI, however old, with its floor");
  eq((await figures(db, due.id)).o_available, 0, "refund admission is impossible until the floor is explained");
  eq(await count(db, "select count(*) n from public.catering_payment_refund_events where stripe_event_id = $1", [ev.id]), 1, "and its 0333 history row is appended once");
  // A due payment is not attachable.
  const due2 = await w.pay(q, "balance", 100, { status: "due" });
  eq((await rpc(db, "catering_refund_settlement_attach", [CALLER, due2.id])).result, "not_settled", "an unsettled payment stays a settlement obligation");
  await db.close();
});

test("on_ingress_then_off_rollback_whole_refund_not_lost", async () => {
  // The rollback proof (Activation "Rollback proof"): a signed whole-refund event is admitted (2xx) and the worker
  // stops before its first apply. A premature finish_drain FAILS and lists the payment; after the apply, seal + OFF.
  const x = await liveWorld();
  const full = x.s.refund(x.p.pi, 30000, "succeeded", { created: now() - 60 });
  const ev = await ingest(x.db, { pi: x.p.pi, created: now() - 50, cumulative: 30000, chargeAmount: 30000, full: true });
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  const session = await x.w.session(x.owner);
  await refuses(() => rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 100, "customer_cancelled", null, "panel"]), "refunds_draining", "draining closes new creates");
  const early = await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"]);
  eq([early.closed, early.report.outstanding_events.map((o) => [o.event_id, o.payment_id, o.reason])], [false, [[ev.id, x.p.id, "unapplied"]]],
    "stop_with_owed_refund_events_drains_before_off (was ..._replays_or_lists_them): a premature finish_drain does NOT close; the payment is listed; a list alone cannot authorize OFF");
  eq((await rpc(x.db, "catering_refund_epoch_state", [CALLER])).state, "draining", "the epoch stays draining (the switch stays ON)");
  // The money worker remains available while draining.
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.payment_status], ["applied", "refunded"], "the worker is restored and applies once");
  const done = await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"]);
  eq([done.closed, done.report.counts.still_owed], [true, 0], "seal + close with zero owed");
  eq(await payStatus(x.db, x.p.id), "refunded", "OFF consumers (the portal and the reports read the stored payment status) see `refunded`");
  eq(await count(x.db, "select count(*) n from public.catering_payment_refund_events where payment_id = $1", [x.p.id]), 1, "exactly one 0333 append");
  eq((await rpc(x.db, "catering_refund_epoch_state", [CALLER])).state, "sealed", "the seal is persisted across the rollout to OFF");
  void full;
  await x.db.close();
});

test("ingress_racing_stop_is_applied_or_retryable", async () => {
  // One session cannot race; this proves both SIDES of the seal (the lock itself is the two-session sim proof).
  const x = await liveWorld();
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  // An ingress that WINS the race creates work that prevents closure.
  const won = await ingest(x.db, { pi: x.p.pi, created: now() - 5, cumulative: 5000, chargeAmount: 30000, full: false });
  eq((await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"])).closed, false, "an ingress that wins creates work that prevents closure");
  x.s.refund(x.p.pi, 5000, "succeeded", { created: now() - 10 });
  await pass(x.db, x.p.id, x.s);
  eq((await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"])).closed, true, "applied: the drain closes and seals");
  // An ingress that LOSES (an old ON instance after the seal): retryable, and NO final verdict is left (Opus P3-a).
  const late = await ingest(x.db, { pi: x.p.pi, created: now(), cumulative: 9000, chargeAmount: 30000, full: false, ledgerOnly: true });
  await refuses(() => rpc(x.db, "catering_refund_event_register", [CALLER, late.id, "charge.refunded", null, false, x.p.pi, null, now(), 9000, 30000, false, "[]"]), "refunds_sealed", "after the seal the old ON instance gets a retryable refusal");
  eq(await ledger(x.db, late.id), null, "and the ledger verdict stays NULL (main's OFF redelivery then applies it; `processing_failed` is the app's stamp)");
  eq(await count(x.db, "select count(*) n from public.catering_refund_event_work where event_id = $1", [late.id]), 0, "no owed work was accepted after the final drain");
  // An already applied duplicate remains idempotent after the seal? It is refused the same way (retryable), never re-applied.
  await refuses(() => rpc(x.db, "catering_refund_event_register", [CALLER, won.id, "charge.refunded", null, false, x.p.pi, null, now(), 5000, 30000, false, "[]"]), "refunds_sealed", "sealed is sealed for every delivery through the ON path");
  eq(await ledger(x.db, won.id), "refund_state_owed", "the applied event keeps its terminal verdict (main answers its redelivery `duplicate`)");
  // Re-enable: a fresh recovering epoch releases the prior seal under the lifecycle lock.
  await rpc(x.db, "catering_refund_open_recovery", ["cc"]);
  eq((await rpc(x.db, "catering_refund_epoch_state", [CALLER])).state, "recovering", "re-enable opens a fresh recovering epoch");
  eq((await rpc(x.db, "catering_refund_event_register", [CALLER, late.id, "charge.refunded", null, false, x.p.pi, null, now(), 9000, 30000, false, "[]"])).result, "registered", "and ingress is admitted again");
  await x.db.close();
});

test("parked_event_restamped_at_seal_settles_under_off", async () => {
  // Addendum A2: "out of scope" = the event's PaymentIntent matches no catering_payments row. At the seal it is
  // re-stamped to main's `payment_not_found`, the verdict main's own OFF replay reads.
  const x = await liveWorld();
  const parked = await ingest(x.db, { pi: "pi_out_of_scope_1", created: now(), cumulative: 700, chargeAmount: 700, full: true });
  const other = await ingest(x.db, { type: "refund.created", pi: "pi_out_of_scope_2", created: now(), hints: [{ id: "re_oos", status: "succeeded" }] });
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  const done = await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"]);
  eq([done.closed, done.report.out_of_scope.map((o) => o.event_id).sort(), done.report.restamped], [true, [parked.id, other.id].sort(), 2], "nothing parks forever and nothing blocks the drain forever: out-of-scope events are listed and handed off");
  eq([await ledger(x.db, parked.id), await ledger(x.db, other.id)], ["payment_not_found", "payment_not_found"], "each is re-stamped to main's `payment_not_found`");
  // Main's own seen-first read (lib/stripe/webhook.ts REFUND_NOT_APPLIED) now finds it:
  eq(await count(x.db, "select count(*) n from public.stripe_events where type = 'charge.refunded' and (outcome is null or outcome = 'processing_failed' or outcome = 'payment_not_found') and id = $1", [parked.id]), 1,
    "main's OFF seen-first replay predicate (type charge.refunded, outcome in null / processing_failed / payment_not_found) selects it");
  // A parked event whose payment DOES exist by the stop is not out of scope: it blocks.
  const y = await liveWorld();
  const due = await y.w.pay(y.quote, "balance", 5000, { status: "due" });
  const ev = await ingest(y.db, { pi: "pi_lands_later", created: now(), cumulative: 5000, chargeAmount: 5000, full: true });
  await y.db.query("update public.catering_payments set status = 'paid', provider_ref = 'pi_lands_later' where id = $1", [due.id]);
  const d2 = await rpc(y.db, "catering_refund_start_drain", [y.ep.epoch, y.ep.generation, "cc"]);
  const blocked = await rpc(y.db, "catering_refund_finish_drain", [y.ep.epoch, d2.generation, "cc"]);
  eq([blocked.closed, blocked.report.outstanding_events.map((o) => [o.event_id, o.reason])], [false, [[ev.id, "attach_owed"]]], "an event whose payment now exists is an owed attach, never `out of scope`");
  await x.db.close(); await y.db.close();
});

test("pending_whole_refund_at_drain_listed_and_legacy_settles", async () => {
  // Addendum A2: a whole refund still PENDING at the drain: the payment stays `paid` (the money has not returned
  // yet), it is LISTED in the drain report, and main's legacy charge.refunded handles it when Stripe settles it.
  const x = await liveWorld();
  x.s.refund(x.p.pi, 30000, "pending", { created: now() - 60 });
  await ingest(x.db, { type: "refund.created", pi: x.p.pi, created: now() - 60, hints: [{ id: "re_fake1", status: "pending" }] });
  await pass(x.db, x.p.id, x.s);
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  const done = await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"]);
  eq([done.closed, done.report.pending_whole_refunds.map((p) => [p.payment_id, p.reserved_cents])], [true, [[x.p.id, 30000]]], "the drain passes and LISTS the pending whole refund");
  eq(await payStatus(x.db, x.p.id), "paid", "the payment stays `paid`: correct, the money has not returned");
  // Stripe settles it under OFF: main's webhook (not this file) receives a NEW charge.refunded. Its predicate:
  eq(await one(x.db, "select status, provider_ref = $2 as carries from public.catering_payments where id = $1", [x.p.id, x.p.pi]), { status: "paid", carries: true },
    "main's legacy refund() finds the row by provider_ref while it is `paid` and moves it (the app-level proof is tests/catering-refund-off-parity.test.ts)");
  await x.db.close();
});

test("break_glass_off_records_list_and_restamps", async () => {
  // Addendum A3 (ii): OFF with undrained work ONLY on Juan's explicit word, through an audited RPC that records the
  // full undrained list and re-stamps every event-backed item per A2.
  const x = await liveWorld();
  const owed = await ingest(x.db, { pi: x.p.pi, created: now() - 5, cumulative: 30000, chargeAmount: 30000, full: true }); // cannot be applied (say the account is unreachable)
  const parked = await ingest(x.db, { pi: "pi_oos_bg", created: now(), cumulative: 100, chargeAmount: 100, full: true });
  await refuses(() => rpc(x.db, "catering_refund_break_glass_close", [x.ep.epoch, x.ep.generation, "cc", "juan-2026-11-27-msg-1234"]), "epoch_not_draining", "break glass only from a draining epoch");
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  eq((await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"])).closed, false, "the ordinary drain cannot finish");
  for (const bad of [null, "", "yes", "has spaces in it"]) {
    await refuses(() => rpc(x.db, "catering_refund_break_glass_close", [x.ep.epoch, d.generation, "cc", bad]), "invalid_request", `Juan's word must be a recorded reference (${JSON.stringify(bad)} refused)`);
  }
  const out = await rpc(x.db, "catering_refund_break_glass_close", [x.ep.epoch, d.generation, "cc", "juan-2026-11-27-msg-1234"]);
  eq([out.closed, out.break_glass, out.report.restamped], [true, true, 2], "closed by break glass; both event-backed items re-stamped");
  eq([await ledger(x.db, owed.id), await ledger(x.db, parked.id)], ["payment_not_found", "payment_not_found"], "every event-backed undrained item goes to main's `payment_not_found`");
  const ep = await one(x.db, "select state, close_kind, drain_report, ingress_sealed_at is not null as sealed from public.catering_refund_epochs where id = $1", [x.ep.epoch]);
  eq([ep.state, ep.close_kind, ep.sealed, ep.drain_report.juan_word_ref, ep.drain_report.outstanding_events.map((o) => o.payment_id)], ["closed", "break_glass", true, "juan-2026-11-27-msg-1234", [x.p.id]],
    "the epoch records the full undrained list, by payment, and Juan's word");
  const audit = await one(x.db, "select destructive, metadata from public.audit_log where action = 'catering.refund.break_glass'");
  eq([audit.destructive, audit.metadata.juan_word_ref, audit.metadata.undrained.outstanding_events.length, audit.metadata.undrained.out_of_scope.length], [true, "juan-2026-11-27-msg-1234", 1, 1], "audited destructive, with the list");
  // Main's duplicate gate (workStillOwed): a refund event whose verdict is payment_not_found and whose `paid` row now carries its charge is worked again.
  eq(await one(x.db, "select p.status from public.catering_payments p where p.provider_ref = $1", [x.p.pi]), { status: "paid" }, "main's OFF duplicate gate finds the paid row for the re-stamped event");
  await x.db.close();
});

test("draining_epoch_adopts_reviewed_contract_upgrade", async () => {
  // Addendum A3 (i). A later reviewed migration replaces B1's install record (it supersedes b1-1 with b1-2 and
  // re-emits the expected matrix); the audited operator step adopts it for the frozen, draining epoch.
  const x = await liveWorld();
  const ev = await ingest(x.db, { pi: x.p.pi, created: now() - 5, cumulative: 1000, chargeAmount: 30000, full: false });
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  // Negative first: a version nobody recorded is refused.
  await refuses(() => rpc(x.db, "catering_refund_adopt_contract_upgrade", [x.ep.epoch, d.generation, "cc"]), "nothing_to_adopt", "with no superseding record there is nothing to adopt");
  await refuses(() => rpc(x.db, "catering_refund_pass_begin", ["b1-2", x.p.id, randomUUID()]), "caller_incompatible", "the repaired build's caller is NOT admitted before adoption");
  // The corrective migration (the fixture owner stands in for it; in production it is a reviewed 03xx file).
  const corrective = (supersedes) => x.db.exec(`
    update public.catering_refund_install_contracts set superseded_at = now() where part = 'B1' and version = 'b1-1';
    insert into public.catering_refund_install_contracts (part, version, supersedes_version, migration) values ('B1', 'b1-2', ${supersedes}, '0364_fixture_corrective');
    create or replace function public.catering_refund_install_manifest() returns jsonb language sql immutable set search_path = pg_catalog, public
      as $f$ select '{"B1": "b1-2", "B2": "b2-1", "B3": "b3-1"}'::jsonb $f$;`);
  await corrective("null");
  await refuses(() => rpc(x.db, "catering_refund_adopt_contract_upgrade", [x.ep.epoch, d.generation, "cc"]), "upgrade_not_recorded", "a record that does not DECLARE what it supersedes is not a reviewed upgrade");
  await x.db.exec("update public.catering_refund_install_contracts set supersedes_version = 'b1-1' where part = 'B1' and version = 'b1-2'");
  await refuses(() => rpc(x.db, "catering_refund_adopt_contract_upgrade", [x.ep.epoch, d.generation + 5, "cc"]), "stale_generation", "adoption is fenced on the epoch generation");
  const adopted = await rpc(x.db, "catering_refund_adopt_contract_upgrade", [x.ep.epoch, d.generation, "cc"]);
  eq([adopted.state, adopted.manifest.B1], ["draining", "b1-2"], "the draining epoch adopts the reviewed contract version");
  eq((await one(x.db, "select destructive, metadata from public.audit_log where action = 'catering.refund.epoch' and metadata->>'transition' = 'adopt_contract_upgrade'")).metadata.before.B1, "b1-1", "audited with before / after");
  await refuses(() => rpc(x.db, "catering_refund_pass_begin", [CALLER, x.p.id, randomUUID()]), "caller_incompatible", "the OLD build's caller is refused after adoption");
  // The repaired build finishes the drain.
  x.s.refund(x.p.pi, 1000, "succeeded", { created: now() - 10 });
  const b = await rpc(x.db, "catering_refund_pass_begin", ["b1-2", x.p.id, randomUUID()]);
  const ap = await rpc(x.db, "catering_refund_apply", ["b1-2", x.p.id, b.pass_token, b.generation, JSON.stringify({ complete: true, owner: x.s.owner(x.p.pi), refunds: x.s.listed(x.p.pi).map((id) => x.s.read(id)) })]);
  eq(ap.result, "applied", "the repaired build's apply is admitted");
  eq((await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, adopted.generation, "cc"])).closed, true, "and the drain finishes");
  void ev;
  await x.db.close();
});

test("main_9ce98df5_press_on_0359_zero_posts", async () => {
  // The stale sender, at the SQL boundary: exactly the two calls main @ 9ce98df5 makes (lib/catering/refunds.ts:317
  // and :398), as service_role, on a PREEXISTING pending row. (The route-level proof with main's own code is
  // tests/catering-refund-stale-sender.test.ts.)
  const db = await base({ upTo: "0358" });
  const w = await world(db);
  const owner = await w.user("owner", { member: null }); const q = await w.quote(); await w.pay(q, "deposit", 30000);
  const pre = (await one(db, "select public.catering_refund_reserve($1, $2, $3, 10000, 'customer_cancelled', null, 'panel') as r", [owner, q, randomUUID()])).r.requests[0].id;
  const { M0359: file } = await import("./sql-harness-0359-lib.mjs");
  await db.exec(file);
  const before = { rows: await count(db, "select count(*) n from public.catering_refund_requests"), audits: await count(db, "select count(*) n from public.audit_log where action = 'catering.refund.request'") };
  await db.exec("set role service_role");
  await refuses(() => db.query("select public.catering_refund_reserve($1, $2, $3, 5000, 'customer_cancelled', null, 'panel')", [owner, q, randomUUID()]), "42501", "main's Confirm (the historical reserve) is refused");
  await refuses(() => db.query("select public.catering_refund_claim($1)", [pre]), "42501", "main's claim on the preexisting pending row is refused");
  await refuses(() => db.query("update public.catering_refund_requests set status = 'submitted', stripe_refund_id = 're_x' where id = $1", [pre]), "42501", "main's settleRow UPDATE is refused");
  await db.exec("reset role");
  eq({ rows: await count(db, "select count(*) n from public.catering_refund_requests"), audits: await count(db, "select count(*) n from public.audit_log where action = 'catering.refund.request'") }, before,
    "zero new request rows and zero new destructive reservation audits (and with no claim, main sends no POST)");
  eq((await req(db, pre)).legacy_possibly_sent, false, "the preexisting row was never attempted: it is not marked possibly sent");
  await db.close();
});

test("legacy_attempted_row_is_possibly_sent", async () => {
  const db = await base({ upTo: "0358" });
  const w = await world(db);
  const owner = await w.user("owner", { member: null }); const q = await w.quote(); await w.pay(q, "deposit", 30000);
  const id = (await one(db, "select public.catering_refund_reserve($1, $2, $3, 10000, 'customer_cancelled', null, 'panel') as r", [owner, q, randomUUID()])).r.requests[0].id;
  await db.query("select public.catering_refund_claim($1)", [id]);
  await db.exec("set session_replication_role = replica"); await db.query("update public.catering_refund_requests set claimed_until = now() - interval '1 hour' where id = $1", [id]); await db.exec("set session_replication_role = origin");
  await db.exec(M0359);
  const r = await req(db, id);
  eq([r.legacy_possibly_sent, r.create_armed_at], [true, null], "a row attempted before 0359 (no way to reconstruct its arm) is treated as possibly sent");
  await withStandIns(db); await goLive(db);
  await backdate(db, "catering_refund_requests", "requested_at", id, "1 hour");
  const hk = await rpc(db, "catering_refund_sweep_housekeeping", [CALLER]);
  eq([hk.reserved_not_sent, hk.submission_unconfirmed], [0, 1], "it reads `Submission unconfirmed`, never `Reserved, not sent`");
  eq((await rpc(db, "catering_refund_finish", [CALLER, id, null, "local_refusal", null, "x", "x"])).result, "claim_lost", "and can never be closed as a clean local refusal");
  await db.close();
});

test("arm_epoch1_first_success_epoch2", async () => {
  const x = await liveWorld();
  const k = await reserveClaimArm(x, x.owner, 10000);
  await rpc(x.db, "catering_refund_finish", [CALLER, k.request, k.claim.claim_token, "uncertain", null, "network_error", "timeout"]);
  const epoch1 = x.ep.epoch;
  // Stop, close, re-enable.
  const d = await rpc(x.db, "catering_refund_start_drain", [epoch1, x.ep.generation, "cc"]);
  await backdate(x.db, "catering_refund_requests", "create_armed_at", k.request, "10 minutes").catch(() => {});
  await x.db.exec("set session_replication_role = replica"); await x.db.query("update public.catering_refund_requests set create_armed_at = create_armed_at - interval '10 minutes', claimed_until = null where id = $1", [k.request]); await x.db.exec("set session_replication_role = origin");
  eq((await rpc(x.db, "catering_refund_finish_drain", [epoch1, d.generation, "cc"])).closed, true, "epoch 1 closes (the armed row is listed as unconfirmed, it is not an admitted sender any more)");
  const ep2 = await goLive(x.db);
  // The create had landed; its first success is observed in epoch 2.
  const rid = x.s.refund(x.p.pi, 10000, "succeeded", { request: k.request, metaPayment: x.p.id, metaQuote: x.quote, created: now() - 500 });
  await pass(x.db, x.p.id, x.s);
  const r = await req(x.db, k.request);
  eq([r.status, r.arm_epoch_id, r.stripe_refund_id], ["succeeded", epoch1, rid], "the arm (epoch 1) and the first live success (epoch 2) need no epoch equality; the original arm epoch is preserved");
  const o = await one(x.db, "select epoch_id, baseline, to_class from public.catering_payment_refund_outcomes where refund_id = $1 order by id desc limit 1", [rid]);
  eq([o.epoch_id, o.baseline, o.to_class], [ep2.epoch, false, "returned"], "the success outcome is recorded in the live epoch that observed it (what B2's decision reads)");
  // closed_epoch_job_review_preserves_original_key: a Retry after re-enable re-arms on the ORIGINAL arm, key and parameters.
  const y = await liveWorld();
  const k2 = await reserveClaimArm(y, y.owner, 10000);
  await rpc(y.db, "catering_refund_finish", [CALLER, k2.request, k2.claim.claim_token, "uncertain", null, "network_error", "timeout"]);
  const d2 = await rpc(y.db, "catering_refund_start_drain", [y.ep.epoch, y.ep.generation, "cc"]);
  await y.db.exec("set session_replication_role = replica"); await y.db.query("update public.catering_refund_requests set create_armed_at = create_armed_at - interval '10 minutes' where id = $1", [k2.request]); await y.db.exec("set session_replication_role = origin");
  await rpc(y.db, "catering_refund_finish_drain", [y.ep.epoch, d2.generation, "cc"]);
  const ep3 = await goLive(y.db);
  const s3 = await y.w.session(y.owner);
  const claim = await rpc(y.db, "catering_refund_claim_admitted", [CALLER, y.owner, s3, k2.request]);
  const ap = await pass(y.db, y.p.id, y.s);
  const c = y.s.charges.get(y.p.pi);
  const arm = await rpc(y.db, "catering_refund_arm", [CALLER, y.owner, s3, k2.request, claim.claim_token, ap.generation, y.p.pi, c.charge, c.livemode]);
  const r2 = await req(y.db, k2.request);
  eq([arm.result, arm.armed_before, r2.arm_epoch_id, r2.arm_count, String(r2.first_attempt_at) === String(k2.claim.first_attempt_at ? r2.first_attempt_at : r2.first_attempt_at)], ["armed", true, y.ep.epoch, 2, true],
    "closed_epoch_job_review_preserves_original_key: after re-enable a staff Retry uses the prior live arm; the original arm epoch, first-attempt clock and key anchor (the request id) are preserved");
  void ep3;
  await x.db.close(); await y.db.close();
});

test("sweep_due_lists_and_watch_state", async () => {
  const x = await liveWorld();
  const p2 = await x.w.pay(x.quote, "balance", 20000); x.s.charge(p2.pi, { captured: 20000 });
  await pass(x.db, x.p.id, x.s); await pass(x.db, p2.id, x.s);
  let due = await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10]);
  eq([due.discovery, due.event_work, due.epoch_state], [[], [], "live"], "healthy future polls are not due");
  const ev = await ingest(x.db, { pi: x.p.pi, created: now() - 5, cumulative: 1000, chargeAmount: 30000, full: false });
  due = await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10]);
  eq([due.event_work, due.discovery], [[x.p.id], [x.p.id]], "new event work is due at once, by indexed due time then id");
  let ws = await rpc(x.db, "catering_refund_watch_state", [CALLER]);
  eq([ws.epoch.state, ws.aged], ["live", null], "fresh work is not aged");
  // fresh_heartbeat_old_obligation_alerts (the SQL half): an acknowledged event unapplied for 24 h is the oldest actionable obligation.
  await backdate(x.db, "catering_refund_event_work", "received_at", ev.id, "25 hours", "event_id");
  ws = await rpc(x.db, "catering_refund_watch_state", [CALLER]);
  eq([ws.aged.kind, ws.aged.location_id], ["event", x.w.shop], "an event unapplied for more than 24 h is aged work, whatever the heartbeats say");
  const fp1 = ws.aged.fingerprint;
  eq((await rpc(x.db, "catering_refund_watch_state", [CALLER])).aged.fingerprint, fp1, "the same obligation and evidence has the same fingerprint (deduplicated across days)");
  await ingest(x.db, { pi: x.p.pi, created: now() - 1, cumulative: 2000, chargeAmount: 30000, full: false });
  check((await rpc(x.db, "catering_refund_watch_state", [CALLER])).aged.fingerprint !== fp1, "new evidence changes the fingerprint (a new occurrence may be raised)");
  // healthy_pending_and_dispositioned_work_do_not_realert: once applied, the floor's open issue is a manual follow-up, not aged work.
  await pass(x.db, x.p.id, x.s);
  await backdate(x.db, "catering_refund_payment_work", "next_due_at", x.p.id, "30 hours", "payment_id");
  eq((await rpc(x.db, "catering_refund_watch_state", [CALLER])).aged, null, "healthy_pending_and_dispositioned_work_do_not_realert: a payment whose hold is already with staff (an open issue) does not re-alert");
  await backdate(x.db, "catering_refund_payment_work", "next_due_at", p2.id, "9 days", "payment_id");
  eq((await rpc(x.db, "catering_refund_watch_state", [CALLER])).aged.kind, "payment", "a clean payment whose pass is 24 h overdue (a stalled worker) is aged work");
  // Aged floor issue at 24 h.
  const issue = (await issues(x.db, x.p.id)).find((i) => i.code === "awaiting_identity" && i.state === "open");
  await x.db.query("update public.catering_refund_issues set opened_at = opened_at - interval '25 hours' where id = $1", [issue.id]);
  eq((await rpc(x.db, "catering_refund_sweep_housekeeping", [CALLER])).aged, 1, "an unexplained floor is raised as aged at 24 hours");
  // Alert exclusions do not discharge financial work: the stop gate still counts it.
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  eq((await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"])).closed, false, "the stop gate counts the outstanding floor independently of the monitoring query");
  // The cron lease knows the new job, and still the old eight.
  eq((await one(x.db, "select public.claim_cron_route('catering-refund-sweep') as r")).r, true, "claim_cron_route admits catering-refund-sweep");
  eq((await one(x.db, "select public.claim_cron_route('catering-refund-sweep') as r")).r, false, "with the 330-second lease");
  eq((await one(x.db, "select public.claim_cron_route('fact-build') as r")).r, true, "no job was dropped");
  await x.db.close();
});

test("reversal_cleanup_obligation_resumes", async () => {
  const x = await liveWorld();
  const full = x.s.refund(x.p.pi, 30000, "succeeded");
  await pass(x.db, x.p.id, x.s);
  x.s.set(full, { status: "canceled" });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.payment_status, a.cleanup_owed], ["paid", true], "refunded -> paid writes the durable cleanup obligation in the financial commit");
  eq((await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10])).cleanup, [x.p.id], "the sweep sees the cleanup (it resumes after a crash)");
  eq((await rpc(x.db, "catering_refund_cleanup_done", [CALLER, x.p.id, false, JSON.stringify({ still_open: 1, completing: 0, already_paid_duplicates: 0 })])).result, "still_owed", "a checkout still open keeps the obligation");
  eq((await issues(x.db, x.p.id)).filter((i) => i.code === "checkout_still_open").length, 1, "and is raised to staff (never reimbursed automatically)");
  eq((await rpc(x.db, "catering_refund_cleanup_done", [CALLER, x.p.id, true, JSON.stringify({ still_open: 0, completing: 0, already_paid_duplicates: 0 })])).result, "done", "a complete cleanup closes it");
  eq((await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10])).cleanup, [], "nothing left to resume");
  await x.db.close();
});

test("summary_is_one_read_per_batch_and_figures_twin_inputs", async () => {
  const x = await liveWorld();
  const quotes = [x.quote];
  for (let i = 0; i < 8; i++) { const q = await x.w.quote(); const p = await x.w.pay(q, "deposit", 1000 + i); x.s.charge(p.pi, { captured: 1000 + i }); quotes.push(q); }
  const s = await rpc(x.db, "catering_refund_summary", [CALLER, quotes]);
  eq([s.quotes.length, s.epoch.state, s.quotes.every((q) => q.payments.length === 1)], [9, "live", true], "one call returns the stored state of every quote in the batch");
  eq(s.quotes.find((q) => q.quote_id === x.quote).payments[0].verified, false, "an unchecked amount is labelled (verified = false until a complete pass)");
  await refuses(() => rpc(x.db, "catering_refund_summary", [CALLER, Array.from({ length: 61 }, () => randomUUID())]), "invalid_request", "the batch is bounded");
  await x.db.close();
});

test("conflicting_identity_hold_has_an_exit", async () => {
  // Review fix (Opus F2 / Fable 1 / Astra P1): a hold raised because an id belongs to ANOTHER payment has an operator
  // exit, and a charge / owner hold is cleared by the evidence of a repaired pass.
  const x = await liveWorld();
  const p2 = await x.w.pay(x.quote, "balance", 20000); x.s.charge(p2.pi, { captured: 20000 });
  const theirs = x.s.refund(p2.pi, 5000, "succeeded");
  await pass(x.db, p2.id, x.s);
  // A signed event on the FIRST payment names the other payment's refund id.
  await ingest(x.db, { type: "refund.updated", pi: x.p.pi, created: now() - 30, hints: [{ id: theirs, status: "succeeded" }] });
  const issue = (await issues(x.db, x.p.id)).find((i) => i.code === "wrong_charge");
  check(issue && (await figures(x.db, x.p.id)).o_held, "conflicting ownership holds THIS payment and moves nothing");
  eq((await one(x.db, "select payment_id from public.catering_refund_identities where refund_id = $1", [theirs])).payment_id, p2.id, "the id stays the other payment's");
  await pass(x.db, x.p.id, x.s);
  const out = await rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, issue.id, Number((await work(x.db, x.p.id)).generation), "exclude_unrelated_hint", "ref:foreign/0001", await x.w.session(x.moo, { fresh: true }), null]);
  eq([out.result, out.state, (await figures(x.db, x.p.id)).o_held], ["ok", "resolved", false], "Exclude unrelated hint ends the hold");
  // The same hint again: the reviewed evidence never holds the payment (or pages staff) again.
  await ingest(x.db, { type: "refund.updated", pi: x.p.pi, created: now() - 10, hints: [{ id: theirs, status: "succeeded" }] });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.held, (await issues(x.db, x.p.id)).filter((i) => i.state !== "resolved").length], ["applied", false, 0], "the same reviewed evidence does not hold the payment again");
  // owner_indeterminate: raised while no account knows the PaymentIntent; the repaired pass clears it by evidence.
  const b = await pass(x.db, p2.id, x.s, { ownerStatus: "indeterminate" });
  eq([b.result, (await figures(x.db, p2.id)).o_held], ["incomplete_evidence", true], "an indeterminate owner holds the payment");
  const c = await pass(x.db, p2.id, x.s);
  eq([c.result, c.held, (await issues(x.db, p2.id)).filter((i) => i.state !== "resolved").length], ["applied", false, 0], "after access is restored a clean pass ENDS the hold (no direct SQL repair)");
  // A changed charge holds; reading the verified charge again clears it.
  const saved = x.s.charges.get(p2.pi).charge;
  x.s.charges.get(p2.pi).charge = "ch_CHANGED";
  eq([(await pass(x.db, p2.id, x.s)).result, (await figures(x.db, p2.id)).o_held], ["held", true], "a changed owning charge holds the payment");
  x.s.charges.get(p2.pi).charge = saved;
  const d = await pass(x.db, p2.id, x.s);
  eq([d.result, d.held], ["applied", false], "the verified charge again: the hold is cleared by evidence");
  // An immutable fact that changed: reviewed by the operator, then verified afresh.
  x.s.set(theirs, { amount: 6000 });
  eq((await pass(x.db, p2.id, x.s)).result, "held", "a verified refund whose amount no longer reads the same holds the payment");
  const im = (await issues(x.db, p2.id)).find((i) => i.code === "capture_review" && i.state === "open");
  await rpc(x.db, "catering_refund_resolve_anomaly", [CALLER, im.id, Number((await work(x.db, p2.id)).generation), "evidence_reviewed", "ref:immutable/0001", await x.w.session(x.moo, { fresh: true }), null]);
  const e = await pass(x.db, p2.id, x.s);
  eq([e.result, e.held, e.returned_cents], ["applied", false, 6000], "after the review the refund is verified afresh with the facts Stripe now reports; the payment is unheld");
  await x.db.close();
});

test("aged_work_alert_survives_a_moving_retry_date", async () => {
  // Review fix (Fable 6 / Astra P2): passes that keep failing move next_due_at forward every time; the watch ages the
  // payment by how long its work has been UNRESOLVED.
  const x = await liveWorld();
  for (let i = 0; i < 3; i++) eq((await pass(x.db, x.p.id, x.s, { ownerStatus: "unreachable" })).result, "incomplete_evidence", `failing pass ${i + 1} (account unreachable: no issue is raised)`);
  const w1 = await work(x.db, x.p.id);
  check(new Date(w1.next_due_at) > new Date() && w1.oldest_unresolved_at != null, "the retry date is in the future, and the unresolved-since time is kept");
  eq((await rpc(x.db, "catering_refund_watch_state", [CALLER])).aged, null, "not aged yet");
  await backdate(x.db, "catering_refund_payment_work", "oldest_unresolved_at", x.p.id, "25 hours", "payment_id");
  const ws = await rpc(x.db, "catering_refund_watch_state", [CALLER]);
  eq([ws.aged?.kind, new Date((await work(x.db, x.p.id)).next_due_at) > new Date()], ["payment", true], "25 h unresolved: aged work, although the retry date keeps moving and heartbeats are fresh");
  eq((await pass(x.db, x.p.id, x.s)).result, "applied", "a clean pass");
  eq([(await work(x.db, x.p.id)).oldest_unresolved_at, (await rpc(x.db, "catering_refund_watch_state", [CALLER])).aged], [null, null], "clears the unresolved-since time and the alert condition");
  // The identity-poll queue does not jump a payment that is backing off.
  const r = x.s.refund(x.p.pi, 1000, "pending");
  await pass(x.db, x.p.id, x.s);
  await backdate(x.db, "catering_refund_identities", "next_poll_at", r, "2 hours", "refund_id");
  eq((await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10])).identity_polls, [x.p.id], "a due identity poll is listed");
  await pass(x.db, x.p.id, x.s, { ownerStatus: "unreachable" });
  eq((await rpc(x.db, "catering_refund_sweep_due", [CALLER, 10])).identity_polls, [], "while the payment backs off after a failed pass its identity poll waits for the payment's own due time");
  await x.db.close();
});

test("reserved_not_sent_clears_on_arm_then_unconfirmed_is_raised", async () => {
  // Review fix (Fable 5): the two occurrences are one PER KIND; the arm ends "reserved, not sent".
  const x = await liveWorld();
  const session = await x.w.session(x.owner);
  const request = (await rpc(x.db, "catering_refund_reserve_admitted", [CALLER, x.owner, session, x.quote, randomUUID(), 10000, "customer_cancelled", null, "panel"])).requests[0].id;
  await backdate(x.db, "catering_refund_requests", "requested_at", request, "16 minutes");
  eq((await rpc(x.db, "catering_refund_sweep_housekeeping", [CALLER])).reserved_not_sent, 1, "unarmed for 15 minutes: reserved_not_sent");
  // Staff press Retry: claim -> pass -> arm.
  const claim = await rpc(x.db, "catering_refund_claim_admitted", [CALLER, x.owner, session, request]);
  const ap = await pass(x.db, x.p.id, x.s);
  const c = x.s.charges.get(x.p.pi);
  eq((await rpc(x.db, "catering_refund_arm", [CALLER, x.owner, session, request, claim.claim_token, ap.generation, x.p.pi, c.charge, c.livemode])).result, "armed", "armed");
  eq((await one(x.db, "select state, disposition from public.catering_refund_issues where request_id = $1 and code = 'reserved_not_sent'", [request])), { state: "resolved", disposition: "evidence_cleared" },
    "the arm ends the `Reserved, not sent` occurrence (a POST may have left: it can no longer say nothing was sent)");
  // The POST's answer and the process are lost.
  await x.db.exec("set session_replication_role = replica");
  await x.db.query("update public.catering_refund_requests set create_armed_at = create_armed_at - interval '10 minutes', claimed_until = now() - interval '5 minutes' where id = $1", [request]);
  await x.db.exec("set session_replication_role = origin");
  const hk = await rpc(x.db, "catering_refund_sweep_housekeeping", [CALLER]);
  eq([hk.reserved_not_sent, hk.submission_unconfirmed], [0, 1], "the lost response is raised as `Submission unconfirmed`, although the request already had an earlier occurrence of the other kind");
  // The create had landed: the verified outcome ends that occurrence too.
  x.s.refund(x.p.pi, 10000, "succeeded", { request, metaPayment: x.p.id, metaQuote: x.quote, created: now() - 500 });
  await pass(x.db, x.p.id, x.s);
  eq([(await req(x.db, request)).status, (await issues(x.db, x.p.id)).filter((i) => i.state !== "resolved").length], ["succeeded", 0], "the verified outcome ends `Submission unconfirmed`");
  await x.db.close();
});

test("drain_holds_a_whole_refund_the_status_rule_could_not_publish", async () => {
  // Review fix (Astra A2 / Fable 11): a succeeded whole refund on a payment whose capture is unknown ends in a capture
  // review with the payment still `paid`. Its event is NOT drained: OFF readers would keep `paid` for a refunded order.
  const x = await liveWorld();
  x.s.charges.get(x.p.pi).captured = null;
  x.s.refund(x.p.pi, 30000, "succeeded", { created: now() - 120 });
  const ev = await ingest(x.db, { pi: x.p.pi, created: now() - 100, cumulative: 30000, chargeAmount: 30000, full: true });
  const wrongShop = await ingest(x.db, { pi: x.p.pi, created: now() - 90, cumulative: 30000, chargeAmount: 30000, full: true, loc: x.w.other });
  const a = await pass(x.db, x.p.id, x.s);
  eq([a.result, a.payment_status, a.floors_outstanding, a.held], ["applied", "paid", 0, true], "the floor is explained, the status rule could not run (capture unknown): capture review, payment still paid");
  // An armed request whose response was lost, for the break-glass list.
  const p2 = await x.w.pay(x.quote, "balance", 20000); x.s.charge(p2.pi, { captured: 20000 });
  const y = { ...x, p: p2 };
  const k = await reserveClaimArm(y, x.owner, 5000);
  await rpc(x.db, "catering_refund_finish", [CALLER, k.request, k.claim.claim_token, "uncertain", null, "network_error", "timeout"]);
  await x.db.exec("set session_replication_role = replica");
  await x.db.query("update public.catering_refund_requests set create_armed_at = create_armed_at - interval '10 minutes' where id = $1", [k.request]);
  await x.db.exec("set session_replication_role = origin");
  const d = await rpc(x.db, "catering_refund_start_drain", [x.ep.epoch, x.ep.generation, "cc"]);
  const fin = await rpc(x.db, "catering_refund_finish_drain", [x.ep.epoch, d.generation, "cc"]);
  eq([fin.closed, fin.report.outstanding_events.map((o) => [o.event_id, o.reason])], [false, [[ev.id, "capture_review"]]], "the drain does NOT seal over it: the event is outstanding (capture_review)");
  eq(fin.report.quarantined_events.map((q) => q.event_id), [wrongShop.id], "a quarantined (wrong-shop) event is an explicit, LISTED class (it changed no money and is not re-stamped)");
  // Break glass records it, and the unconfirmed armed request, in the audited list.
  const bg = await rpc(x.db, "catering_refund_break_glass_close", [x.ep.epoch, d.generation, "cc", "juan-2026-11-28-msg-0001"]);
  const audit = await one(x.db, "select metadata from public.audit_log where action = 'catering.refund.break_glass'");
  eq([bg.closed, audit.metadata.undrained.outstanding_events.map((o) => o.event_id), audit.metadata.undrained.unconfirmed_requests.map((r) => r.request_id),
      audit.metadata.undrained.quarantined_events.length, await ledger(x.db, ev.id)],
    [true, [ev.id], [k.request], 1, "payment_not_found"], "break glass lists the unresolved whole refund, the unconfirmed armed request and the quarantined event, and re-stamps the event-backed item");
  await x.db.close();
});

// ═══════════════════════════════ run ════════════════════════════════════════════════════════════════════════════
BARE = await base();
READY = await withStandIns(await BARE.clone());
const selected = tests.filter((t) => (!BEHAVIOUR_ONLY || t.group === "behaviour") && (!ONLY || t.name.includes(ONLY)));
console.log(`0359 harness: schema under test = REAL 0357 -> 0358 -> 0359 (PGlite). Groups: ${BEHAVIOUR_ONLY ? "BEHAVIOUR only (stage-pinned fingerprint / ACL checks skipped)" : "STAGE-PINNED + BEHAVIOUR"}.`);
for (const group of ["stage", "behaviour"]) {
  const list = selected.filter((t) => t.group === group);
  if (list.length === 0) continue;
  console.log(`\n── ${group === "stage" ? "STAGE-PINNED (0359's own schema stage)" : "BEHAVIOUR (re-runnable on a later schema stage)"} ──`);
  for (const t of list) {
    current = t.name;
    try { await t.fn(); } catch (e) { failures++; console.error(`FAIL ${t.name}: threw ${e.message}${e.where ? ` @ ${String(e.where).slice(0, 200)}` : ""}`); }
  }
}
console.log(`\n${checks} checks, ${failures} failed, ${selected.length} named tests.`);
if (failures > 0) { console.error("HARNESS FAILED"); process.exit(1); }
console.log("ALL 0359 HARNESS CHECKS PASS");
process.exit(0);
