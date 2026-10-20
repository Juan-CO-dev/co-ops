/**
 * Local Postgres proof of migration 0279 (user_employment_events: on leave / separated / rehired), SYNTHETIC ROWS ONLY —
 * PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0279.mjs
 *
 * THE EXECUTION CONTRACT (as sql-harness-0278.mjs): the stub (Supabase roles + default privileges, users / locations /
 * user_locations), a stub `sessions` (user_id, revoked_at), the REAL 0228 level helper, then 0279. Every write is called
 * `set role service_role` with the EXACT named arguments the lib sends — the object comes from
 * lib/admin/employment-core-shared.ts `recordEmploymentEventCall`, and the stored rows are re-read through the lib's own
 * `employmentStateOf` (the TS status must equal the SQL status).
 *
 *   S0  the preflight: refuses without 0228's helper, without sessions, and on a second apply
 *   S1  the posture: RLS on with four deny-all policies; anon / authenticated can neither read nor write the table nor
 *       execute the functions; service_role SELECT only (INSERT / UPDATE / DELETE refused: append-only by grant);
 *       every function SECURITY DEFINER with search_path pinned
 *   S2  the actor rule: GM own shop (every membership of the person at the GM's shops), never oneself, never a GM or
 *       above; an AGM or an inactive MoO refused; MoO+ any shop
 *   S3  the transitions: leave → back; separate from active and from on leave; a second leave / separation / back /
 *       rehire refused; users.active follows the status and leaving active revokes every live session (count returned)
 *   S4  the head: a stale or missing p_expected is employment_moved and writes nothing
 *   S5  the payload by exact keys: missing / blank reason, a rehire setting needing a note without one, an unknown key,
 *       an impossible date, an over-long reason → invalid_payload; rehire = yes drops a stray rehire note
 *   S6  the rehire gate: yes → a GM; only_with_owner_ok → owner / MoO / CGS (GM refused), with a reason; no → the owner
 *       only (MoO and CGS refused), with a reason
 *   S7  corrections: a new row naming the event in force; the status is unchanged; loosening `no` needs the owner;
 *       naming another event or correcting an active person is refused; the TS state reads the corrected fields
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { employmentStateOf, recordEmploymentEventCall } from "../lib/admin/employment-core-shared.ts";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0279 = read("supabase/migrations/0279_user_employment_events.sql");
function extract(sql, start) {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start} not found`);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}
const LEVEL = extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)");
const SESSIONS = `create table public.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  revoked_at timestamptz);`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
async function base({ level = true, sessions = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  if (level) await db.exec(LEVEL);
  if (sessions) await db.exec(SESSIONS);
  return db;
}
const FNS = ["user_employment_json_date(jsonb, text)", "user_employment_text(jsonb, text, integer)", "record_user_employment_event(uuid, uuid, uuid, text, jsonb)"];

const db = await base();
async function rpc(call) {
  const keys = Object.keys(call.args);
  const vals = keys.map((k) => { const v = call.args[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
  await db.exec("set role service_role");
  try { return (await db.query(`select public.${call.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, vals)).rows[0].r; }
  finally { await db.exec("reset role"); }
}

try {
  // S0 — the preflight
  {
    const noLevel = await base({ level: false });
    await refuses(() => noLevel.exec(M0279), "0279: assignment_author_level (0228) must be applied first", "S0 the preflight refuses without 0228's level helper");
    await noLevel.close();
    const noSessions = await base({ sessions: false });
    await refuses(() => noSessions.exec(M0279), "0279: users, user_locations and sessions must exist", "S0 the preflight refuses without sessions");
    await noSessions.close();
  }
  await db.exec(M0279);
  check(true, "0279 applied with every SQL guard (the ceiling guard included)");
  {
    const again = await base();
    await again.exec(M0279);
    await refuses(() => again.exec(M0279), "0279: already applied", "S0 a second apply is refused by the preflight");
    await again.close();
  }

  // S1 — the posture
  const t = (await db.query(`select relrowsecurity as rls from pg_class where oid = 'public.user_employment_events'::regclass`)).rows[0];
  const pol = (await db.query(`select policyname, cmd, qual, with_check from pg_policies where tablename = 'user_employment_events' order by policyname`)).rows;
  check(t.rls === true && pol.length === 4 && pol.every((p) => (p.qual ?? "false") === "false" && (p.with_check ?? "false") === "false")
    && pol.map((p) => p.policyname).join(",") === "user_employment_events_no_user_delete,user_employment_events_no_user_insert,user_employment_events_no_user_select,user_employment_events_no_user_update",
  "S1 RLS on, four deny-all policies named <table>_no_user_<op>");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select * from public.user_employment_events"), "42501", `S1 ${role} cannot read the table`);
    await refuses(() => db.query("insert into public.user_employment_events (user_id, kind, actor_id) values (gen_random_uuid(), 'leave_end', gen_random_uuid())"), "42501", `S1 ${role} cannot insert`);
    await refuses(() => db.query("update public.user_employment_events set note = 'x'"), "42501", `S1 ${role} cannot update`);
    await refuses(() => db.query("delete from public.user_employment_events"), "42501", `S1 ${role} cannot delete`);
    await refuses(() => db.query("select public.record_user_employment_event(null, null, null, null, null)"), "42501", `S1 ${role} cannot EXECUTE the writer`);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  check((await db.query("select count(*)::int as n from public.user_employment_events")).rows[0].n === 0, "S1 service_role reads the table");
  await refuses(() => db.query("insert into public.user_employment_events (user_id, kind, actor_id) values (gen_random_uuid(), 'leave_end', gen_random_uuid())"), "42501", "S1 service_role cannot insert directly (the writer is the only writer)");
  await refuses(() => db.query("update public.user_employment_events set note = 'x'"), "42501", "S1 service_role cannot update (append-only)");
  await refuses(() => db.query("delete from public.user_employment_events"), "42501", "S1 service_role cannot delete (append-only)");
  await db.exec("reset role");
  for (const fn of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      `S1 ${fn.split("(")[0]}: SECURITY DEFINER, search_path pinned, service_role only`);
  }

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = () => id("insert into public.locations (active) values (true) returning id");
  const member = (u, l, active = true) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [u, l, active]);
  const SA = await shop(), SB = await shop();
  const owner = await user("owner"), cgs = await user("cgs"), moo = await user("moo"), mooOff = await user("moo", false);
  const gmA = await user("gm"), gmA2 = await user("gm"), gmB = await user("gm"), agmA = await user("agm");
  const e1 = await user("employee"), e2 = await user("employee"), e3 = await user("employee"), e4 = await user("employee");
  const both = await user("employee"), none = await user("employee"), slA = await user("shift_lead");
  for (const u of [gmA, gmA2, agmA, e1, e2, e3, e4, slA]) await member(u, SA);
  await member(gmB, SB);
  await member(both, SA); await member(both, SB);
  await member(none, SA, false); // only an inactive membership
  const sess = (u, n) => db.query("insert into public.sessions (user_id) select $1 from generate_series(1, $2)", [u, n]);
  await sess(e1, 2); await sess(e3, 1);

  const head = async (u) => (await db.query("select id from public.user_employment_events where user_id = $1 order by created_at desc, id desc limit 1", [u])).rows[0]?.id ?? null;
  const rows = async (u) => (await db.query("select * from public.user_employment_events where user_id = $1", [u])).rows.map((r) => ({
    id: r.id, userId: r.user_id, kind: r.kind, correctsId: r.corrects_id, leaveReason: r.leave_reason,
    expectedBack: r.expected_back ? new Date(r.expected_back).toISOString().slice(0, 10) : null, separationType: r.separation_type,
    lastDayWorked: r.last_day_worked ? new Date(r.last_day_worked).toISOString().slice(0, 10) : null, reason: r.reason, rehire: r.rehire,
    rehireNote: r.rehire_note, note: r.note, actorId: r.actor_id, createdAt: new Date(r.created_at).toISOString(),
  }));
  const count = async (u) => (await db.query("select count(*)::int as n from public.user_employment_events where user_id = $1", [u])).rows[0].n;
  const active = async (u) => (await db.query("select active from public.users where id = $1", [u])).rows[0].active;
  const live = async (u) => (await db.query("select count(*)::int as n from public.sessions where user_id = $1 and revoked_at is null", [u])).rows[0].n;
  const ev = async (actor, u, kind, fields, expected) => rpc(recordEmploymentEventCall({ actorId: actor, userId: u, kind, fields,
    expectedId: expected === undefined ? await head(u) : expected }));
  const LEAVE = { leaveReason: "school", expectedBack: "2027-01-05", note: "Back after the fall semester" };
  const SEP = (rehire, o = {}) => ({ separationType: "fired", lastDayWorked: "2026-10-18", reason: "Repeated no-shows after warnings", rehire,
    ...(rehire === "yes" ? {} : { rehireNote: "Talk to the owner first" }), ...o });
  const tsStatus = async (u) => employmentStateOf(await rows(u)).status;

  // S2 — the actor rule
  await refuses(() => ev(gmA, gmA, "leave_start", LEAVE), "employment_forbidden", "S2 a GM never records their OWN leave");
  await refuses(() => ev(gmA, gmA2, "leave_start", LEAVE), "employment_forbidden", "S2 a GM never records another GM's");
  await refuses(() => ev(gmA, moo, "leave_start", LEAVE), "employment_forbidden", "S2 a GM never records the MoO's");
  await refuses(() => ev(agmA, e1, "leave_start", LEAVE), "employment_forbidden", "S2 an AGM records nothing (GM and up only)");
  await refuses(() => ev(mooOff, e1, "leave_start", LEAVE), "employment_forbidden", "S2 an inactive MoO records nothing");
  await refuses(() => ev(gmB, e1, "leave_start", LEAVE), "employment_outside_shop", "S2 another shop's GM is refused");
  await refuses(() => ev(gmA, both, "leave_start", LEAVE), "employment_outside_shop", "S2 a GM is refused a person who also works at a shop the GM does not belong to");
  await refuses(() => ev(gmA, none, "leave_start", LEAVE), "employment_outside_shop", "S2 a GM is refused a person with no active membership");
  await refuses(() => ev(gmA, crypto.randomUUID(), "leave_start", LEAVE, null), "employment_not_found", "S2 an unknown person → employment_not_found");
  check(await count(e1) === 0 && await count(both) === 0, "S2 every refusal wrote nothing");
  const rBoth = await ev(moo, both, "leave_start", LEAVE);
  check(rBoth.status_after === "on_leave", "S2 MoO records at any shop (a two-shop person)");
  const rAgm = await ev(gmA, agmA, "leave_start", { leaveReason: "personal" });
  check(rAgm.status_after === "on_leave", "S2 a GM records an AGM of their own shop (below GM)");

  // S3 — the transitions, users.active, sessions
  const l1 = await ev(gmA, e1, "leave_start", LEAVE);
  check(l1.status_before === "active" && l1.status_after === "on_leave" && l1.sessions_revoked === 2 && !(await active(e1)) && await live(e1) === 0,
    "S3 leave: on leave, deactivated, both live sessions revoked in the same transaction");
  check(await tsStatus(e1) === "on_leave", "S3 the TS state reads on_leave from the stored rows");
  await refuses(() => ev(gmA, e1, "leave_start", LEAVE), "employment_invalid_transition", "S3 a second leave is refused");
  await refuses(() => ev(gmA, e1, "rehired", { note: "x" }), "employment_invalid_transition", "S3 a rehire of someone on leave is refused");
  const b1 = await ev(gmA, e1, "leave_end", {});
  check(b1.status_after === "active" && await active(e1) && b1.sessions_revoked === 0 && await tsStatus(e1) === "active", "S3 back from leave: active again, nothing revoked");
  await refuses(() => ev(gmA, e1, "leave_end", {}), "employment_invalid_transition", "S3 back from leave when not on leave is refused");
  await ev(gmA, e1, "leave_start", { leaveReason: "seasonal" });
  const s1 = await ev(gmA, e1, "separated", SEP("yes"));
  check(s1.status_before === "on_leave" && s1.status_after === "separated" && !(await active(e1)), "S3 separated from on leave");
  const s3 = await ev(gmA, e3, "separated", SEP("no"));
  check(s3.status_before === "active" && s3.sessions_revoked === 1 && await live(e3) === 0 && !(await active(e3)) && await tsStatus(e3) === "separated",
    "S3 separated from active: deactivated, its live session revoked");
  await refuses(() => ev(gmA, e3, "separated", SEP("no")), "employment_invalid_transition", "S3 a second separation is refused");
  await refuses(() => ev(gmA, e2, "rehired", { note: "x" }), "employment_invalid_transition", "S3 a rehire of an active person is refused");

  // S4 — the head
  const n2 = await count(e2);
  await ev(gmA, e2, "leave_start", LEAVE);
  const stale = await head(e2);
  await ev(gmA, e2, "leave_end", {});
  await refuses(() => ev(gmA, e2, "leave_start", LEAVE, stale), "employment_moved", "S4 a stale p_expected → employment_moved");
  await refuses(() => ev(gmA, e2, "leave_start", LEAVE, null), "employment_moved", "S4 p_expected null while events exist → employment_moved");
  check(await count(e2) === n2 + 2 && await active(e2), "S4 the refused writes wrote nothing");

  // S5 — the payload
  await refuses(() => ev(gmA, e2, "separated", SEP("yes", { reason: undefined })), "invalid_payload", "S5 a separation without a reason");
  await refuses(() => ev(gmA, e2, "separated", SEP("yes", { reason: "   " })), "invalid_payload", "S5 a blank reason");
  await refuses(() => ev(gmA, e2, "separated", { ...SEP("no"), rehireNote: null }), "invalid_payload", "S5 rehire = no without its note");
  await refuses(() => ev(gmA, e2, "separated", { ...SEP("only_with_owner_ok"), rehireNote: " " }), "invalid_payload", "S5 owner OK needed without its note");
  await refuses(() => ev(gmA, e2, "separated", SEP("yes", { lastDayWorked: "2026-02-30" })), "invalid_payload", "S5 an impossible last day");
  await refuses(() => ev(gmA, e2, "separated", SEP("yes", { reason: "x".repeat(2001) })), "invalid_payload", "S5 a reason over 2000 characters");
  await refuses(() => ev(gmA, e2, "separated", SEP("yes", { why: "x" })), "invalid_payload", "S5 an unknown key");
  await refuses(() => ev(gmA, e2, "separated", SEP("yes", { separationType: "laid_off" })), "invalid_payload", "S5 an unknown separation type");
  await refuses(() => ev(gmA, e2, "leave_start", { leaveReason: "vacation" }), "invalid_payload", "S5 an unknown leave reason");
  await refuses(() => ev(gmA, e2, "leave_start", { leaveReason: "school", note: 5 }), "invalid_payload", "S5 a note that is not text");
  await refuses(() => ev(gmA, agmA, "leave_end", { leaveReason: "school" }), "invalid_payload", "S5 back from leave takes only a note");
  const s2 = await ev(gmA, e2, "separated", { ...SEP("yes"), rehireNote: "ignored" });
  const r2 = (await rows(e2)).find((r) => r.id === s2.id);
  check(r2.rehire === "yes" && r2.rehireNote === null && r2.reason === "Repeated no-shows after warnings", "S5 rehire = yes stores no rehire note; the reason is stored trimmed");

  // S6 — the rehire gate
  const ry = await ev(gmA, e2, "rehired", {});
  check(ry.status_after === "active" && await active(e2) && await tsStatus(e2) === "active", "S6 rehire OK → the GM rehires (no reason needed)");
  await ev(gmA, e4, "separated", SEP("only_with_owner_ok"));
  await refuses(() => ev(gmA, e4, "rehired", { note: "Owner said yes" }), "rehire_owner_ok_required", "S6 owner OK needed → a GM is refused");
  await refuses(() => ev(moo, e4, "rehired", {}), "invalid_payload", "S6 owner OK needed → the MoO must give a reason");
  const r4 = await ev(moo, e4, "rehired", { note: "Owner approved by phone" });
  check(r4.status_after === "active" && await active(e4), "S6 owner OK needed → the MoO rehires with a reason");
  await refuses(() => ev(moo, e3, "rehired", { note: "x" }), "rehire_owner_required", "S6 not eligible → the MoO is refused");
  await refuses(() => ev(cgs, e3, "rehired", { note: "x" }), "rehire_owner_required", "S6 not eligible → the CGS is refused (owner only)");
  await refuses(() => ev(owner, e3, "rehired", {}), "invalid_payload", "S6 not eligible → the owner must give a reason");

  // S7 — corrections
  const sepId = (await rows(e3)).find((r) => r.kind === "separated").id;
  await refuses(() => ev(gmA, e3, "correction", { correctsId: sepId, ...SEP("yes") }), "rehire_owner_required", "S7 a GM may not loosen `no` by a correction");
  const c1 = await ev(gmA, e3, "correction", { correctsId: sepId, ...SEP("no", { separationType: "quit", reason: "Quit without notice" }) });
  check(c1.status_before === "separated" && c1.status_after === "separated" && c1.sessions_revoked === 0, "S7 a correction keeps the status");
  const st3 = employmentStateOf(await rows(e3));
  check(st3.status === "separated" && st3.current?.kind === "separated" && st3.current.separationType === "quit" && st3.current.reason === "Quit without notice"
    && st3.current.corrected === true && st3.current.eventId === sepId && st3.headId === c1.id, "S7 the TS state reads the corrected fields; the head is the correction");
  await refuses(() => ev(gmA, e3, "correction", { correctsId: c1.id, ...SEP("no") }), "employment_invalid_transition", "S7 a correction naming another event (the correction itself) is refused");
  await refuses(() => ev(gmA, e3, "correction", { correctsId: sepId, ...LEAVE }), "invalid_payload", "S7 a correction with the other kind's fields is refused");
  await refuses(() => ev(gmA, e1, "correction", { correctsId: sepId, ...SEP("yes") }), "employment_invalid_transition", "S7 a correction naming another person's event is refused");
  await refuses(() => ev(gmA, e2, "correction", { correctsId: sepId, ...SEP("yes") }), "employment_invalid_transition", "S7 correcting an active person is refused");
  const c2 = await ev(owner, e3, "correction", { correctsId: sepId, ...SEP("yes", { separationType: "quit" }) });
  check(employmentStateOf(await rows(e3)).current?.rehire === "yes" && c2.status_after === "separated", "S7 the owner loosens `no` to rehire OK; the newest correction wins");
  const leaveId = (await rows(agmA)).find((r) => r.kind === "leave_start").id;
  await ev(gmA, agmA, "correction", { correctsId: leaveId, leaveReason: "school", expectedBack: "2027-05-30" });
  const sa = employmentStateOf(await rows(agmA));
  check(sa.status === "on_leave" && sa.current?.kind === "on_leave" && sa.current.expectedBack === "2027-05-30" && sa.current.leaveReason === "school",
    "S7 a leave's expected-back date is corrected; still on leave");

  // the table stays append-only by CHECK too (a superuser insert of a malformed row is refused by the constraints)
  await refuses(() => db.query("insert into public.user_employment_events (user_id, kind, actor_id, separation_type, last_day_worked, reason, rehire) values ($1, 'separated', $2, 'fired', '2026-10-01', 'r', 'no')", [e1, gmA]),
    "user_employment_events_separation_fields", "S7 a separation row with rehire = no and no note violates its CHECK");
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures > 0) { console.error(`FAILED 0279: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0279: ${checks} checks`);
