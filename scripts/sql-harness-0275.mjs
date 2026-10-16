/**
 * Local Postgres proof of migration 0275 (Scheduling Phase 2, Task 14), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0275.mjs
 *
 * THE EXECUTION CONTRACT (plan chunk D, r2 P3-13): tests/fixtures/scheduling-pglite-stub.sql first (the Supabase roles
 * and DEFAULT privileges, which the migrations must revoke), the REAL level helpers (0217 / 0228 / 0233), the REAL
 * 0243 + 0268 (the cron lease 0275 re-emits), 0270, the 0272 posture, the REAL 0274, then 0275. Every writer is called
 * `set role service_role` with the EXACT named arguments the lib sends (lib/scheduling/rpc-args-shared.ts). The ET
 * clock is a parameter: after the grant checks the harness swaps public.schedule_et_today() for one that reads the
 * session setting `schedule.test_today` (time injection; the real body is pinned by the vitest pin).
 *
 *   W0  the preflight refuses without 0274, over a claim_cron_route that is not 0268's, and on a second apply
 *   W1  seven tables: RLS on, no policy; PUBLIC / anon / authenticated hold NOTHING; service_role exactly SELECT —
 *       direct INSERT / UPDATE / DELETE / TRUNCATE refused; anon / authenticated cannot even SELECT
 *   W2  every function: search_path pinned, EXECUTE service_role only (by calling under anon / authenticated and by
 *       information_schema.routine_privileges), the writers SECURITY DEFINER
 *   W3  THE SHARED CASE FILES (segment-cases.json, certificate-cases.json — the TS twins' tables) on the SQL functions
 *       and the table CHECKs; and every shift and every certificate of the 27 generator goldens accepted
 *   W4  commit basics: generated over no head, head_moved, the payload refusals, shop_not_enabled, past_week, the actor
 *       rule, the cron path (no actor: only 'generated' over no head)
 *   W5  the historical contract END TO END (r2 P1-3): a past Monday shift of U on P; U deactivated, P retired; a
 *       revision carrying Monday unchanged → ACCEPTED; a NEW future shift for U → person_not_at_shop, one on P →
 *       position_retired; an unchanged FUTURE shift of U → accepted
 *   W6  r4 P1: Sunday carries an unresolved_search gap → a partial rebuild (Oct 28–31 rebuilt, Sunday inherited with its
 *       gap unchanged) → approve_schedule_week refuses unresolved_gaps
 *   W7  inheritance integrity (r3 P2-3): a future inherited shift moved to another ACTIVE position, a future inherited
 *       gap's to_q changed, a past inherited gap dropped → each history_changed; a past day re-judged → day_locked
 *   W8  edited_week_unconfirmed — a CONFIRMATION check, not a password check: generated → edited → regenerated without
 *       the flag refused, with it accepted; generated → regenerated with no edit accepted
 *   W9  gaps round-trip (P2-5) and the context (P2-4): certificates persist byte for byte; capacity and
 *       unresolved_search accepted; a malformed certificate → gap_certificate_invalid; one context row per revision
 *   W10 approval: rules_failing on a NEW error, an inherited error does not block, approve writes NO revision and copies
 *       nothing, approving again is a no-op, the AGM never approves, head_moved, week_not_found
 *   W11 the daily maximum (shift_over_maximum) on new or changed future shifts only; an inherited long day is never
 *       re-judged
 *   W12 append-only: UPDATE / DELETE of weeks, revisions, shifts, days, gaps, contexts and approvals refused
 *   W13 concurrency, single session: two commits on the same expected head — the second is head_moved; the lock is
 *       taken before the week row is read (source order)
 *   W14 the cron lease: claim_cron_route('schedule-draft') claims once and refuses within the lease; the old jobs still
 *       claim; the job CHECK carries all four under its 0243 name
 *   W15 a real generator week (golden F1, ids mapped to synthetic users and positions) commits as a revision and reads
 *       back complete
 */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { approveWeekCall, commitRevisionCall, saveShopSettingsCall } from "../lib/scheduling/rpc-args-shared.ts";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0243 = read("supabase/migrations/0243_cron_route_leases.sql");
const M0268 = read("supabase/migrations/0268_sevenshifts_sync.sql");
const M0270 = read("supabase/migrations/0270_people_layer.sql");
const M0274 = read("supabase/migrations/0274_schedule_settings.sql");
const M0275 = read("supabase/migrations/0275_schedule_weeks.sql");
function extract(sql, start) {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start} not found`);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}
const HELPERS = [
  extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
  extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
  extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
].join("\n");
const LOCKDOWN_0272 = "revoke insert, update, delete, truncate on public.locations, public.user_locations from anon, authenticated;";
const CLOCK = `create or replace function public.schedule_et_today() returns date language sql stable set search_path = pg_catalog, public as $$
  select coalesce(nullif(current_setting('schedule.test_today', true), ''), (now() at time zone 'America/New_York')::date::text)::date
$$;`;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ m0268 = true, m0274 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(HELPERS);
  await db.exec(M0243);
  if (m0268) await db.exec(M0268);
  await db.exec(M0270);
  await db.exec(LOCKDOWN_0272);
  if (m0274) await db.exec(M0274);
  return db;
}

const TABLES = ["schedule_weeks", "schedule_revisions", "schedule_revision_shifts", "schedule_revision_days", "schedule_revision_gaps",
  "schedule_revision_contexts", "schedule_week_approvals"];
const FNS = [
  ["schedule_uuid_ok(text)", false], ["valid_schedule_segments(jsonb, integer, integer)", false], ["schedule_json_strings(jsonb)", false],
  ["schedule_json_nonneg(jsonb)", false], ["valid_gap_certificate(text, jsonb)", false], ["schedule_problems_canon(jsonb)", false],
  ["schedule_day_canon(uuid, date, boolean)", false], ["schedule_day_same_as_head(uuid, uuid, date)", false],
  ["commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)", true],
  ["approve_schedule_week(uuid, uuid, date, uuid)", true], ["claim_cron_route(text)", true],
];

const db = await base();
async function rpc(call) {
  const keys = Object.keys(call.args);
  const vals = keys.map((k) => {
    const v = call.args[k];
    const scalarArray = Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
    return v !== null && typeof v === "object" && !scalarArray ? JSON.stringify(v) : v;
  });
  return (await db.query(`select public.${call.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, vals)).rows[0].r;
}
/** Canonical JSON (keys sorted at every level): jsonb keeps its own key order. */
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const setToday = (d) => db.query("select set_config('schedule.test_today', $1, false)", [d]);
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = "2026-10-26";
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(WEEK, i)); // Mon Oct 26 … Sun Nov 1
const [MON, TUE, WED, THU, FRI, SAT, SUN] = DAYS;

try {
  // W0 — the preflight
  {
    const no0274 = await base({ m0274: false });
    await refuses(() => no0274.exec(M0275), "0275: 0274 must be applied first", "W0 the preflight refuses without 0274");
    await no0274.close();
    const no0268 = await base({ m0268: false });
    await refuses(() => no0268.exec(M0275), "0275: claim_cron_route is not 0268's body", "W0 the preflight refuses over 0243's claim_cron_route (0268 missing)");
    await no0268.close();
  }
  await db.exec(M0275);
  check(true, "0275 applied with every SQL guard");
  {
    const again = await base();
    await again.exec(M0275);
    await refuses(() => again.exec(M0275), "0275: claim_cron_route is not 0268's body", "W0 a second apply is refused by the preflight (the lease already carries schedule-draft)");
    await again.close();
  }

  // W1 — the ceilings
  for (const t of TABLES) {
    const r = (await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${t}`])).rows[0];
    const pol = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t])).rows[0].n;
    let ok = true;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const g = (await db.query(`select has_table_privilege('service_role', $1, $2) as s, has_table_privilege('anon', $1, $2) as a,
        has_table_privilege('authenticated', $1, $2) as u`, [`public.${t}`, p])).rows[0];
      if (g.s !== (p === "SELECT") || g.a || g.u) ok = false;
    }
    const grants = (await db.query(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = $1
      and grantee in ('PUBLIC', 'anon', 'authenticated')`, [t])).rows[0].n;
    check(r?.rls === true && pol === 0 && ok && grants === 0, `W1 ${t}: RLS on, no policy; PUBLIC/anon/authenticated nothing; service_role exactly SELECT`);
  }
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select * from public.schedule_revisions"), "42501", `W1 ${role} cannot SELECT a revision`);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  for (const [t, sql] of [
    ["schedule_weeks", "insert into public.schedule_weeks (location_id, week_start) values (gen_random_uuid(), '2026-10-26')"],
    ["schedule_revisions", "update public.schedule_revisions set kind = 'edited'"],
    ["schedule_revision_shifts", "delete from public.schedule_revision_shifts"],
    ["schedule_revision_days", "truncate public.schedule_revision_days"],
    ["schedule_revision_gaps", "delete from public.schedule_revision_gaps"],
    ["schedule_revision_contexts", "update public.schedule_revision_contexts set context = '{}'"],
    ["schedule_week_approvals", "insert into public.schedule_week_approvals (week_id, location_id, revision_id, approved_by) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())"],
  ]) await refuses(() => db.query(sql), "42501", `W1 service_role cannot write ${t} directly`);
  check((await db.query("select count(*)::int as n from public.schedule_weeks")).rows[0].n === 0, "W1 service_role CAN select");
  await db.exec("reset role");

  // W2 — functions
  for (const [fn, definer] of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    const pinned = JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]);
    check(pinned && !r.a && !r.u && r.s && (!definer || r.d === true), `W2 ${fn.split("(")[0]}: search_path pinned, service_role only${definer ? ", SECURITY DEFINER" : ""}`);
  }
  const pub = (await db.query(`select count(*)::int as n from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name = any($1) and grantee in ('PUBLIC', 'anon', 'authenticated')`, [FNS.map(([f]) => f.split("(")[0])])).rows[0].n;
  check(pub === 0, "W2 information_schema.routine_privileges: no PUBLIC / anon / authenticated EXECUTE on any 0275 function");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select public.commit_schedule_revision(p_actor => null, p_location => null, p_week_start => null, p_expected_head => null, p_kind => null, p_structure_version => null, p_shifts => null, p_days => null, p_gaps => null, p_context => null, p_meta => null)"),
      "42501", `W2 ${role} cannot EXECUTE commit_schedule_revision`);
    await refuses(() => db.query("select public.approve_schedule_week(p_actor => null, p_location => null, p_week_start => null, p_expected_head => null)"), "42501", `W2 ${role} cannot EXECUTE approve_schedule_week`);
    await refuses(() => db.query("select public.claim_cron_route('schedule-draft')"), "42501", `W2 ${role} cannot claim a cron lease`);
    await db.exec("reset role");
  }
  // Time injection (after the grant checks): the ET clock reads `schedule.test_today` when set.
  await db.exec(CLOCK);

  // W3 — the shared case files + the goldens, on the SQL functions
  {
    const seg = JSON.parse(read("tests/fixtures/schedule/segment-cases.json")).cases;
    let agree = 0;
    for (const c of seg) {
      const v = (await db.query("select public.valid_schedule_segments($1::jsonb, $2, $3) as v", [JSON.stringify(c.segments), c.startQ, c.endQ])).rows[0].v;
      if (v === c.valid) agree++; else console.error(`FAIL W3 valid_schedule_segments disagrees on "${c.name}": got ${v}`);
    }
    check(agree === seg.length, `W3 valid_schedule_segments agrees with the shared segment case file on all ${seg.length} cases`);
    const cert = JSON.parse(read("tests/fixtures/schedule/certificate-cases.json")).cases;
    agree = 0;
    for (const c of cert) {
      const v = (await db.query("select public.valid_gap_certificate($1, $2::jsonb) as v", [c.cause, JSON.stringify(c.certificate)])).rows[0].v;
      if (v === c.valid) agree++; else console.error(`FAIL W3 valid_gap_certificate disagrees on "${c.name}": got ${v}`);
    }
    check(agree === cert.length, `W3 valid_gap_certificate agrees with the shared certificate case file on all ${cert.length} cases`);
    let shifts = 0, gaps = 0, bad = 0;
    for (const f of readdirSync("tests/fixtures/schedule").filter((x) => x.startsWith("golden-"))) {
      const j = JSON.parse(read(`tests/fixtures/schedule/${f}`));
      for (const s of j.shifts) { shifts++; if (!(await db.query("select public.valid_schedule_segments($1::jsonb, $2, $3) as v", [JSON.stringify(s.segments), s.startQ, s.endQ])).rows[0].v) { bad++; console.error(`FAIL W3 ${f} segments ${s.userId} ${s.date}`); } }
      for (const g of j.gaps) { gaps++; if (!(await db.query("select public.valid_gap_certificate($1, $2::jsonb) as v", [g.cause, JSON.stringify(g.certificate)])).rows[0].v) { bad++; console.error(`FAIL W3 ${f} certificate ${g.date} ${g.cause}`); } }
    }
    check(bad === 0 && shifts > 1000 && gaps > 50, `W3 every golden shift (${shifts}) and certificate (${gaps}) has the shape SQL accepts`);
  }

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = (active = true) => id("insert into public.locations (active) values ($1) returning id", [active]);
  const member = (u, l, active = true) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [u, l, active]);
  const station = (l) => id("insert into public.stations (location_id) values ($1) returning id", [l]);
  const position = (s, l, name) => id("insert into public.station_positions (station_id, location_id, name) values ($1, $2, $3) returning id", [s, l, name]);
  const SA = await shop(), SB = await shop(), SC = await shop(), SD = await shop(), SE = await shop();
  const moo = await user("moo"), gmA = await user("gm"), gmB = await user("gm"), agmA = await user("agm"), smmA = await user("social_media_mgr");
  const U = await user("employee"), E1 = await user("employee"), E2 = await user("employee"), E3 = await user("trainer"), EB = await user("employee");
  for (const [u, l] of [[gmA, SA], [gmA, SC], [gmA, SD], [gmA, SE], [gmB, SB], [agmA, SA], [smmA, SA], [U, SA], [E1, SA], [E2, SA], [E3, SA], [EB, SB],
    [E1, SC], [E2, SC], [E1, SE], [E2, SE]]) await member(u, l);
  const stA = await station(SA), stB = await station(SB), stC = await station(SC), stE = await station(SE);
  const REG = await position(stA, SA, "Register"), WALK = await position(stA, SA, "Walk-ins"), EXPO = await position(stA, SA, "Expeditor");
  const P = await position(stA, SA, "To retire"), posB = await position(stB, SB, "Register");
  const REGC = await position(stC, SC, "Register"), REGE = await position(stE, SE, "Register");
  await db.exec("set role service_role");
  for (const l of [SA, SC, SD, SE]) await rpc(saveShopSettingsCall({ actorId: moo, locationId: l, enabled: true, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "edit" }));
  await rpc(saveShopSettingsCall({ actorId: moo, locationId: SB, enabled: false, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "read" }));

  // ── payload builders (the lib's shapes, through the lib's own builder) ──
  const seg = (pos, a, z) => ({ positionId: pos, startQ: a, endQ: z });
  const sh = (u, date, a, z, pos = REG, extra = {}) => ({ userId: u, date, startQ: a, endQ: z, segments: [seg(pos, a, z)], closingManager: false, flex: false, pinned: false, ...extra });
  const dayRec = (date, o = {}) => ({ date, originRevisionId: o.origin ?? null, structureVersionId: o.sv ?? null, inherited: o.inherited ?? false, problems: o.problems ?? [] });
  const ctx = (loc, built, maxShiftH = 10.5, week = WEEK) => ({ version: 1, locationId: loc, weekStart: week, today: WEEK, dates: DAYS,
    days: Object.fromEntries(built.map((d) => [d, { structure: { limits: { maxShiftH } } }])), budgetByDate: {}, closingWindowByDate: {}, people: {} });
  const unresolved = (date, pos, a, z) => ({ code: "coverage_gap", date, positionId: pos, fromQ: a, toQ: z, cause: "unresolved_search",
    certificate: { searched: { steps: 200, donorsTried: 8, chainDepth: 3 }, limits: { REPAIR_MAX_STEPS: 200, maxDonors: 8, maxChainDepth: 3 }, candidateIds: [E1] } });
  const capacity = (date, pos, a, z) => ({ code: "coverage_gap", date, positionId: pos, fromQ: a, toQ: z, cause: "capacity",
    certificate: { fromQ: a, toQ: z, positionIds: [pos], requiredHeads: 2, peopleIds: [E1], people: 1, shortBy: 1 } });
  const meta = (o = {}) => ({ actorContext: "user", inputsDigest: "inputs-1", generatorVersion: "p2.2", problemsSummary: { counts: {}, first: [] },
    contextDigest: "0123456789abcdef", ...o });
  /** One commit through rpc-args-shared's commitRevisionCall — the exact call the lib makes. */
  const commit = (o) => rpc(withRaw(o, commitRevisionCall({
    actorId: o.actor === undefined ? gmA : o.actor, locationId: o.loc ?? SA, weekStart: o.week ?? WEEK, expectedHead: o.head ?? null, kind: o.kind ?? "generated",
    structureVersionId: o.sv ?? null, shifts: o.shifts ?? [], days: o.days ?? DAYS.map((d) => dayRec(d)), gaps: o.gaps ?? [],
    context: o.context ?? ctx(o.loc ?? SA, (o.days ?? DAYS.map((d) => dayRec(d))).filter((d) => !d.inherited).map((d) => d.date)),
    reasons: o.reasons, meta: meta(o.meta),
  })));
  /** A raw meta key the builder would never send (to prove SQL refuses it on its own). */
  function withRaw(o, call) { if (o.rawMeta) Object.assign(call.args.p_meta, o.rawMeta); return call; }
  /** The head's content for some dates, as an INHERITED payload (exactly what the generator carries). */
  const carry = async (rev, dates) => {
    const days = (await db.query("select business_date::text as d, origin_revision_id as o, structure_version_id as sv, problems from public.schedule_revision_days where revision_id = $1 and business_date::text = any($2) order by business_date", [rev, dates])).rows
      .map((r) => ({ date: r.d, originRevisionId: r.o, structureVersionId: r.sv, inherited: true, problems: r.problems.map((p) => ({ ...p, inherited: true })) }));
    const shifts = (await db.query("select user_id as u, business_date::text as d, start_q as a, end_q as z, segments, closing_manager as cm, flex, pinned from public.schedule_revision_shifts where revision_id = $1 and business_date::text = any($2) order by business_date, user_id, start_q", [rev, dates])).rows
      .map((r) => ({ userId: r.u, date: r.d, startQ: r.a, endQ: r.z, segments: r.segments, closingManager: r.cm, flex: r.flex, pinned: r.pinned }));
    const gaps = (await db.query("select business_date::text as d, code, position_id as p, from_q as a, to_q as z, cause, certificate from public.schedule_revision_gaps where revision_id = $1 and business_date::text = any($2) order by business_date, code, from_q", [rev, dates])).rows
      .map((r) => ({ date: r.d, code: r.code, positionId: r.p, fromQ: r.a, toQ: r.z, cause: r.cause, certificate: r.certificate }));
    return { days, shifts, gaps };
  };
  const head = async (loc, week = WEEK) => (await db.query("select head_revision_id as h, approved_revision_id as a from public.schedule_weeks where location_id = $1 and week_start = $2", [loc, week])).rows[0];
  const count = async (t, where = "true", params = []) => (await db.query(`select count(*)::int as n from public.${t} where ${where}`, params)).rows[0].n;

  // ═══ Phase 1: the clock on Monday Oct 26 — nothing of the week is past ═══
  await setToday(MON);
  const g1Shifts = [
    sh(U, MON, 44, 60, P), sh(E1, MON, 44, 60, REG), sh(E1, TUE, 44, 60, REG), sh(E2, WED, 44, 60, REG), sh(E2, THU, 44, 60, REG),
    sh(E3, FRI, 44, 60, REG), sh(U, SAT, 44, 60, REG), sh(E1, SAT, 64, 80, WALK), sh(E2, SUN, 44, 60, REG),
  ];
  const g1Gaps = [capacity(MON, WALK, 46, 50), capacity(FRI, WALK, 46, 56), unresolved(SUN, EXPO, 60, 64)];
  const g1Days = DAYS.map((d) => dayRec(d, { problems: d === MON ? [{ code: "coverage_gap", severity: "gap", day: MON, params: {}, inherited: false, positionId: WALK, q: 46 }] : [] }));

  // W4 — commit basics
  await refuses(() => commit({ kind: "regenerated", shifts: g1Shifts }), "invalid_payload", "W4 'regenerated' with no expected head → invalid_payload");
  await refuses(() => commit({ days: DAYS.slice(0, 6).map((d) => dayRec(d)) }), "invalid_payload", "W4 six day rows → invalid_payload (a revision is the COMPLETE week)");
  await refuses(() => commit({ shifts: [sh(E1, addDays(SUN, 1), 44, 60)] }), "invalid_payload", "W4 a shift outside the week → invalid_payload");
  await refuses(() => commit({ rawMeta: { surprise: 1 } }), "invalid_payload", "W4 an unknown meta key → invalid_payload");
  await refuses(() => commit({ context: ctx(SB, DAYS) }), "invalid_payload", "W4 a context of another shop → invalid_payload");
  await refuses(() => commit({ context: [] }), "invalid_payload", "W4 a context that is not an object → invalid_payload");
  await refuses(() => commit({ context: ctx(SA, DAYS.slice(1)) }), "invalid_payload", "W4 a built day with no context in the snapshot → invalid_payload");
  await refuses(() => commit({ shifts: [{ ...sh(E1, MON, 44, 60), segments: [seg(REG, 44, 50), seg(REG, 52, 60)] }] }), "edit_segments_malformed", "W4 segments with a hole → edit_segments_malformed");
  await refuses(() => commit({ shifts: [sh(E1, MON, 44, 60), sh(E1, MON, 56, 70)] }), "edit_overlap", "W4 two overlapping shifts of one person → edit_overlap");
  await refuses(() => commit({ gaps: [{ ...unresolved(SUN, EXPO, 60, 64), certificate: { searched: {} } }] }), "gap_certificate_invalid", "W4 a malformed certificate → gap_certificate_invalid");
  await refuses(() => commit({ gaps: [{ ...unresolved(SUN, EXPO, 60, 64), positionId: null }] }), "invalid_payload", "W4 a coverage gap without its position → invalid_payload");
  await refuses(() => commit({ loc: SB, actor: gmB, context: ctx(SB, DAYS) }), "shop_not_enabled", "W4 a shop whose switch is off → shop_not_enabled");
  await refuses(() => commit({ week: "2026-10-12", context: ctx(SA, [], 10.5, "2026-10-12"), days: Array.from({ length: 7 }, (_, i) => dayRec(addDays("2026-10-12", i))) }), "past_week", "W4 a week that is entirely past → past_week");
  await refuses(() => commit({ actor: smmA }), "schedule_role_refused", "W4 the social media manager → schedule_role_refused");
  await refuses(() => commit({ actor: gmB }), "shop_not_allowed", "W4 a GM of another shop → shop_not_allowed");
  await refuses(() => commit({ shifts: [sh(EB, MON, 44, 60)] }), "person_not_at_shop", "W4 a NEW shift for a person of another shop → person_not_at_shop");
  await refuses(() => commit({ shifts: [sh(E1, MON, 44, 60, posB)] }), "position_not_at_shop", "W4 a NEW shift on another shop's position → position_not_at_shop");
  check((await count("schedule_revisions")) === 0 && (await count("schedule_weeks")) === 0, "W4 every refusal left NOTHING behind (one transaction)");
  const g1 = await commit({ shifts: g1Shifts, gaps: g1Gaps, days: g1Days });
  check(typeof g1.revision_id === "string" && g1.kind === "generated" && (await head(SA)).h === g1.revision_id, "W4 a generated revision over no head; the head moves to it");
  await refuses(() => commit({ shifts: g1Shifts }), "head_moved", "W4 'generated' over an existing head → head_moved (the cron's idempotence)");
  await refuses(() => commit({ kind: "regenerated", head: "00000000-0000-4000-8000-000000000000", shifts: g1Shifts }), "head_moved", "W4 a stale expected head → head_moved");
  // The cron: no actor, 'generated' over no head only.
  const W3 = "2026-11-02";
  const W3DAYS = Array.from({ length: 7 }, (_, i) => addDays(W3, i));
  const cron = await commit({ actor: null, week: W3, days: W3DAYS.map((d) => dayRec(d)), context: ctx(SA, W3DAYS, 10.5, W3), meta: { actorContext: "cron" } });
  check(typeof cron.revision_id === "string" && (await db.query("select created_by, actor_context from public.schedule_revisions where id = $1", [cron.revision_id])).rows[0].actor_context === "cron",
    "W4 the cron (no actor) creates a week that has no revision; created_by NULL, actor_context 'cron'");
  await refuses(() => commit({ actor: null, week: W3, kind: "regenerated", head: cron.revision_id, days: W3DAYS.map((d) => dayRec(d)), context: ctx(SA, W3DAYS, 10.5, W3), meta: { actorContext: "cron" } }),
    "schedule_forbidden", "W4 the cron may never regenerate → schedule_forbidden");
  await refuses(() => commit({ actor: null, week: W3, days: W3DAYS.map((d) => dayRec(d)), context: ctx(SA, W3DAYS, 10.5, W3), meta: { actorContext: "cron" } }), "head_moved", "W4 the cron finding the week built → head_moved (skipped)");
  await refuses(() => commit({ actor: null, meta: { actorContext: "user" } }), "schedule_forbidden", "W4 no actor without the cron context → schedule_forbidden");

  // W9 (part) — the round trip: gaps and certificates byte for byte, the context, one row per revision
  const storedGaps = (await db.query("select business_date::text as d, cause, certificate from public.schedule_revision_gaps where revision_id = $1 order by business_date, from_q", [g1.revision_id])).rows;
  check(storedGaps.length === 3 && storedGaps.map((r) => r.cause).join(",") === "capacity,capacity,unresolved_search"
    && canon(storedGaps[2].certificate) === canon(g1Gaps[2].certificate) && canon(storedGaps[0].certificate) === canon(g1Gaps[0].certificate), "W9 the COMPLETE gap set persists: capacity and unresolved_search, certificates byte for byte");
  check((await count("schedule_revision_gaps", "revision_id = $1 and origin_revision_id = $1", [g1.revision_id])) === 3, "W9 a built day's gaps take the new revision as their origin");
  const c1 = (await db.query("select context, context_digest from public.schedule_revision_contexts where revision_id = $1", [g1.revision_id])).rows[0];
  check(c1.context.locationId === SA && c1.context_digest === "0123456789abcdef" && (await count("schedule_revision_contexts")) === (await count("schedule_revisions")),
    "W9 the context snapshot persists, one row per revision, with its digest");

  // ═══ Phase 2: the clock on Wednesday Oct 28 — Mon / Tue are past ═══
  await setToday(WED);
  // W5 — the historical contract end to end
  await db.exec("reset role");
  await db.query("update public.users set active = false where id = $1", [U]);
  await db.query("update public.user_locations set active = false where user_id = $1", [U]);
  await db.query("update public.station_positions set active = false where id = $1", [P]);
  await db.exec("set role service_role");
  const keep = await carry(g1.revision_id, [MON, TUE, SUN]);
  const rebuilt = [WED, THU, FRI, SAT];
  const r2Shifts = [...keep.shifts, sh(E1, WED, 44, 60, REG), sh(E2, THU, 44, 60, REG), sh(E3, FRI, 44, 60, REG), sh(U, SAT, 44, 60, REG), sh(E1, SAT, 64, 80, WALK)];
  const r2Days = DAYS.map((d) => keep.days.find((x) => x.date === d) ?? dayRec(d));
  const r2 = (o = {}) => commit({ kind: "regenerated", head: g1.revision_id, shifts: o.shifts ?? r2Shifts, gaps: o.gaps ?? [...keep.gaps, capacity(FRI, WALK, 46, 56)], days: o.days ?? r2Days, context: ctx(SA, rebuilt) });
  await refuses(() => r2({ shifts: [...r2Shifts, sh(U, THU, 64, 80, WALK)] }), "person_not_at_shop", "W5 (d) a NEW future shift for the deactivated U → person_not_at_shop");
  await refuses(() => r2({ shifts: [...r2Shifts, sh(E3, THU, 64, 80, P)] }), "position_retired", "W5 (d) a NEW future shift on the retired P → position_retired");
  // W7 — inheritance integrity, on the same payload
  {
    const sunMoved = r2Shifts.map((s) => (s.date === SUN ? { ...s, segments: [seg(WALK, s.startQ, s.endQ)] } : s));
    await refuses(() => r2({ shifts: sunMoved }), "history_changed", "W7 (a) a FUTURE inherited shift moved to another ACTIVE position → history_changed");
    const gapsSunLonger = [...keep.gaps.map((g) => (g.date === SUN ? { ...g, toQ: g.toQ + 2 } : g)), capacity(FRI, WALK, 46, 56)];
    await refuses(() => r2({ gaps: gapsSunLonger }), "history_changed", "W7 (b) a future inherited gap's to_q changed → history_changed");
    const noMonGap = [...keep.gaps.filter((g) => g.date !== MON), capacity(FRI, WALK, 46, 56)];
    await refuses(() => r2({ gaps: noMonGap }), "history_changed", "W7 (c) a PAST inherited gap dropped → history_changed");
    const monProblemsChanged = r2Days.map((d) => (d.date === MON ? { ...d, problems: [] } : d));
    await refuses(() => r2({ days: monProblemsChanged }), "history_changed", "W7 a past inherited day's problems changed → history_changed");
    const monRejudged = r2Days.map((d) => (d.date === MON ? { ...d, inherited: false, originRevisionId: null } : d));
    await refuses(() => commit({ kind: "regenerated", head: g1.revision_id, shifts: r2Shifts, gaps: [...keep.gaps, capacity(FRI, WALK, 46, 56)], days: monRejudged, context: ctx(SA, [MON, ...rebuilt]) }),
      "day_locked", "W7 a PAST day re-judged instead of carried (identical content, its own origin) → day_locked");
  }
  const r2ok = await r2();
  check(typeof r2ok.revision_id === "string", "W5 (c) Monday carried UNCHANGED after U was deactivated and P retired → ACCEPTED (history is never re-judged)");
  check((await count("schedule_revision_shifts", "revision_id = $1 and user_id = $2 and business_date = $3", [r2ok.revision_id, U, SAT])) === 1,
    "W5 (e) an unchanged FUTURE shift of U (Saturday, identical to the head's) → accepted, never re-judged");
  const monRow = (await db.query("select origin_revision_id as o, inherited from public.schedule_revision_days where revision_id = $1 and business_date = $2", [r2ok.revision_id, MON])).rows[0];
  const wedRow = (await db.query("select origin_revision_id as o, inherited from public.schedule_revision_days where revision_id = $1 and business_date = $2", [r2ok.revision_id, WED])).rows[0];
  check(monRow.o === g1.revision_id && monRow.inherited && wedRow.o === r2ok.revision_id && !wedRow.inherited, "W5 an inherited day keeps its origin; a rebuilt day's origin is the new revision");
  // W6 — r4 P1: Sunday's inherited unresolved_search gap blocks Approve
  const sunGap = (await db.query("select cause, origin_revision_id as o from public.schedule_revision_gaps where revision_id = $1 and business_date = $2", [r2ok.revision_id, SUN])).rows[0];
  check(sunGap.cause === "unresolved_search" && sunGap.o === g1.revision_id, "W6 the partial rebuild (Oct 28–31) carried Sunday's unresolved_search gap unchanged, origin the first build");
  await refuses(() => rpc(approveWeekCall({ actorId: gmA, locationId: SA, weekStart: WEEK, expectedHead: r2ok.revision_id })), "unresolved_gaps",
    "W6 r4 P1: Approve refuses while ANY unresolved_search gap exists — inherited or not → unresolved_gaps");

  // W8 — edited_week_unconfirmed, a confirmation check (shop C)
  {
    const cA = await commit({ loc: SC, shifts: [sh(E1, WED, 44, 60, REGC)], days: DAYS.map((d) => dayRec(d, { inherited: d < WED })), context: ctx(SC, DAYS.filter((d) => d >= WED)) });
    const keepE = await carry(cA.revision_id, DAYS.filter((d) => d !== THU));
    const edit = await commit({ loc: SC, kind: "edited", head: cA.revision_id, shifts: [...keepE.shifts, sh(E2, THU, 44, 60, REGC)],
      days: DAYS.map((d) => keepE.days.find((x) => x.date === d) ?? dayRec(d)), gaps: keepE.gaps, context: ctx(SC, [THU]) });
    const regenPayload = (headId, confirmed) => commit({ loc: SC, kind: "regenerated", head: headId, shifts: [sh(E1, WED, 44, 60, REGC)],
      days: DAYS.map((d) => dayRec(d, { inherited: d < WED })), context: ctx(SC, DAYS.filter((d) => d >= WED)), meta: confirmed === undefined ? {} : { confirmedOverwrite: confirmed } });
    await refuses(() => regenPayload(edit.revision_id), "edited_week_unconfirmed", "W8 generated → edited → regenerated WITHOUT the confirmation → edited_week_unconfirmed (a CONFIRMATION check, not a password check)");
    await refuses(() => regenPayload(edit.revision_id, false), "edited_week_unconfirmed", "W8 … and with confirmed_overwrite = false");
    const ok = await regenPayload(edit.revision_id, true);
    check(typeof ok.revision_id === "string", "W8 … with confirmed_overwrite = true → accepted");
    const again = await regenPayload(ok.revision_id);
    check(typeof again.revision_id === "string", "W8 a regenerate after a regenerate (no edit since) needs no confirmation");
    const W2 = "2026-11-09";
    const W2D = Array.from({ length: 7 }, (_, i) => addDays(W2, i));
    const g = await commit({ loc: SC, week: W2, days: W2D.map((d) => dayRec(d)), context: ctx(SC, W2D, 10.5, W2) });
    const rg = await commit({ loc: SC, week: W2, kind: "regenerated", head: g.revision_id, days: W2D.map((d) => dayRec(d)), context: ctx(SC, W2D, 10.5, W2) });
    check(typeof rg.revision_id === "string", "W8 generated → regenerated with no edit → accepted");
    const src = (await db.query("select prosrc from pg_proc where oid = 'public.commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)'::regprocedure")).rows[0].prosrc;
    const code = src.split(String.fromCharCode(10)).map((l) => l.replace(/--.*$/, "")).join(String.fromCharCode(10));
    check(code.includes("confirmed_overwrite") && !/password|step_up|sessions/i.test(code), "W8 SQL sees only the confirmation flag — never a password or a step-up clock (J12)");
  }

  // W10 — approval (shop E, week Nov 9: nothing past)
  {
    const W = "2026-11-09";
    const WD = Array.from({ length: 7 }, (_, i) => addDays(W, i));
    const err = { code: "person_overlap", severity: "error", day: WD[2], params: {}, inherited: false, userId: E1, q: 44 };
    const bad = await commit({ loc: SE, week: W, shifts: [sh(E1, WD[2], 44, 60, REGE)], days: WD.map((d) => dayRec(d, { problems: d === WD[2] ? [err] : [] })), context: ctx(SE, WD, 10.5, W) });
    await refuses(() => rpc(approveWeekCall({ actorId: gmA, locationId: SE, weekStart: W, expectedHead: bad.revision_id })), "rules_failing", "W10 a NEW error-class problem → rules_failing");
    await setToday(WD[3]);
    const keepBad = await carry(bad.revision_id, WD.slice(0, 3));
    const inh = await commit({ loc: SE, week: W, kind: "regenerated", head: bad.revision_id, shifts: keepBad.shifts,
      days: WD.map((d) => keepBad.days.find((x) => x.date === d) ?? dayRec(d)), gaps: keepBad.gaps, context: ctx(SE, WD.slice(3), 10.5, W) });
    const before = await count("schedule_revisions");
    await refuses(() => rpc(approveWeekCall({ actorId: agmA, locationId: SE, weekStart: W, expectedHead: inh.revision_id })), "shop_not_allowed", "W10 an AGM of another shop is refused");
    await refuses(() => rpc(approveWeekCall({ actorId: gmA, locationId: SE, weekStart: W, expectedHead: bad.revision_id })), "head_moved", "W10 approving a stale head → head_moved");
    await refuses(() => rpc(approveWeekCall({ actorId: gmA, locationId: SE, weekStart: "2026-11-16", expectedHead: inh.revision_id })), "week_not_found", "W10 a week with no revision → week_not_found");
    const ap = await rpc(approveWeekCall({ actorId: gmA, locationId: SE, weekStart: W, expectedHead: inh.revision_id }));
    check(ap.already_approved === false && ap.revision_id === inh.revision_id, "W10 an INHERITED error does not block: approved");
    check((await count("schedule_revisions")) === before && (await count("schedule_week_approvals", "revision_id = $1", [inh.revision_id])) === 1
      && (await head(SE, W)).a === inh.revision_id, "W10 approve writes NO revision (an approval NAMES the snapshot) and moves approved_revision_id");
    const ap2 = await rpc(approveWeekCall({ actorId: moo, locationId: SE, weekStart: W, expectedHead: inh.revision_id }));
    check(ap2.already_approved === true && (await count("schedule_week_approvals", "revision_id = $1", [inh.revision_id])) === 1, "W10 approving the approved head again is a no-op");
    await setToday(WED);
  }
  await refuses(() => rpc(approveWeekCall({ actorId: agmA, locationId: SA, weekStart: WEEK, expectedHead: r2ok.revision_id })), "schedule_forbidden",
    "W10 the AGM never approves, even with agm_access 'edit'");

  // W11 — the daily maximum on new or changed future shifts only (shop D)
  {
    await setToday(MON);
    const long = await commit({ loc: SD, shifts: [sh(E1, SAT, 30, 74, REG)].map((s) => ({ ...s, userId: E1 })), days: DAYS.map((d) => dayRec(d)), context: ctx(SD, DAYS, 12) })
      .catch((e) => e);
    // E1 is not a member of shop D: membership first, then the cap.
    check(String(long.message ?? "").includes("person_not_at_shop"), "W11 (setup) a non-member is refused first → person_not_at_shop");
    await db.exec("reset role");
    await member(E1, SD);
    const stD = await station(SD);
    const REGD = await position(stD, SD, "Register");
    await db.exec("set role service_role");
    await refuses(() => commit({ loc: SD, shifts: [sh(E1, SAT, 30, 74, REGD)], context: ctx(SD, DAYS, 10.5) }), "shift_over_maximum", "W11 a NEW 11 h shift under a 10.5 h maximum → shift_over_maximum");
    await refuses(() => commit({ loc: SD, shifts: [sh(E1, SAT, 30, 54, REGD), sh(E1, SAT, 54, 74, REGD)], context: ctx(SD, DAYS, 10.5) }), "shift_over_maximum", "W11 two shifts that day (6 + 5 h) → shift_over_maximum (per person per DATE)");
    const ok12 = await commit({ loc: SD, shifts: [sh(E1, SAT, 30, 74, REGD)], context: ctx(SD, DAYS, 12) });
    check(typeof ok12.revision_id === "string", "W11 the same 11 h shift under that day's 12 h maximum → accepted (the snapshot decides)");
    await setToday(WED);
    const keepSat = await carry(ok12.revision_id, [MON, TUE, SAT]);
    const later = await commit({ loc: SD, kind: "regenerated", head: ok12.revision_id, shifts: keepSat.shifts,
      days: DAYS.map((d) => keepSat.days.find((x) => x.date === d) ?? dayRec(d)), gaps: keepSat.gaps, context: ctx(SD, [WED, THU, FRI, SUN], 10.5) });
    check(typeof later.revision_id === "string", "W11 that 11 h Saturday CARRIED (inherited) under a 10.5 h snapshot → accepted (inherited history is never re-judged)");
  }

  // W12 — append-only (service_role, after rows exist)
  for (const [t, sql] of [
    ["schedule_weeks", "update public.schedule_weeks set head_revision_id = null"],
    ["schedule_revisions", "delete from public.schedule_revisions"],
    ["schedule_revision_shifts", "update public.schedule_revision_shifts set start_q = 0"],
    ["schedule_revision_days", "update public.schedule_revision_days set problems = '[]'"],
    ["schedule_revision_gaps", "update public.schedule_revision_gaps set cause = 'budget'"],
    ["schedule_revision_contexts", "delete from public.schedule_revision_contexts"],
    ["schedule_week_approvals", "delete from public.schedule_week_approvals"],
  ]) await refuses(() => db.query(sql), "42501", `W12 ${t} is append-only for service_role`);

  // W13 — concurrency, single session: the second commit on the same expected head loses
  {
    const h = (await head(SA)).h;
    const keepAll = await carry(h, DAYS);
    const next = () => commit({ kind: "edited", head: h, shifts: keepAll.shifts, days: keepAll.days.map((d) => (d.date === THU ? { ...d, inherited: false, originRevisionId: null, structureVersionId: null } : d)),
      gaps: keepAll.gaps.filter((g) => g.date !== THU), context: ctx(SA, [THU]) });
    const first = await next();
    check(typeof first.revision_id === "string", "W13 the first edit on head H lands");
    await refuses(next, "head_moved", "W13 the second edit on the same H → head_moved (serialised by the week lock)");
    const src = (await db.query("select prosrc from pg_proc where oid = 'public.commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)'::regprocedure")).rows[0].prosrc;
    check(src.indexOf("pg_advisory_xact_lock") > -1 && src.indexOf("pg_advisory_xact_lock") < src.indexOf("select * into v_week"), "W13 the week lock is taken before the week row is read (source order)");
  }

  // W14 — the cron lease
  {
    const claim = async (job) => (await db.query("select public.claim_cron_route($1) as c", [job])).rows[0].c;
    check((await claim("schedule-draft")) === true, "W14 claim_cron_route('schedule-draft') claims");
    check((await claim("schedule-draft")) === false, "W14 … and refuses within the lease");
    check((await claim("sevenshifts-sync")) === true && (await claim("toast-sales-today")) === true && (await claim("toast-catering-scan")) === true, "W14 the three older jobs still claim");
    await refuses(() => claim("nope"), "invalid_cron_route", "W14 an unknown job is refused");
    const def = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'cron_route_leases_job_check'")).rows[0]?.d ?? "";
    check(["schedule-draft", "sevenshifts-sync", "toast-sales-today", "toast-catering-scan"].every((j) => def.includes(j)), "W14 the job CHECK carries all four jobs under its 0243 name");
  }

  // W15 — a real generator week (golden F1) commits as one revision and reads back complete
  {
    await setToday(MON);
    const F1 = JSON.parse(read("tests/fixtures/schedule/golden-F1-mockup-v17.json"));
    await db.exec("reset role");
    const SF = await shop();
    const stF = await station(SF);
    const map = new Map();
    const roles = { "u-15-alex": "gm", "u-16-jules": "agm", "u-05-dani": "shift_lead", "u-06-iris": "key_holder", "u-10-nora": "key_holder" };
    for (const s of F1.shifts) if (!map.has(s.userId)) { const u = await user(roles[s.userId] ?? "employee"); map.set(s.userId, u); await member(u, SF); }
    const positions = new Set(F1.shifts.flatMap((s) => s.segments.map((g) => g.positionId)).concat(F1.gaps.map((g) => g.positionId)).filter((x) => x && x !== "mod"));
    for (const p of positions) map.set(p, await position(stF, SF, `F1 ${p.slice(-2)}`));
    await db.exec("set role service_role");
    await rpc(saveShopSettingsCall({ actorId: moo, locationId: SF, enabled: true, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "read" }));
    const remap = (v) => (typeof v === "string" ? (map.get(v) ?? v) : Array.isArray(v) ? v.map(remap)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [map.get(k) ?? k, remap(x)])) : v);
    const shifts = remap(F1.shifts);
    const gaps = remap(F1.gaps);
    const days = remap(F1.days).map((d) => ({ ...d, structureVersionId: null }));
    const reasons = Object.fromEntries(Object.entries(F1.reasons).map(([k, v]) => { const [d, u, q] = k.split("|"); return [`${d}|${map.get(u) ?? u}|${q}`, remap(v)]; }));
    const out = await commit({ actor: moo, loc: SF, shifts, gaps, days, reasons, context: ctx(SF, DAYS) });
    const n = await count("schedule_revision_shifts", "revision_id = $1", [out.revision_id]);
    const g = await count("schedule_revision_gaps", "revision_id = $1", [out.revision_id]);
    const withReasons = await count("schedule_revision_shifts", "revision_id = $1 and reasons is not null", [out.revision_id]);
    const probs = (await db.query("select sum(jsonb_array_length(problems))::int as n from public.schedule_revision_days where revision_id = $1", [out.revision_id])).rows[0].n;
    check(n === F1.shifts.length && g === F1.gaps.length && withReasons === F1.shifts.length && probs === F1.days.reduce((a, d) => a + d.problems.length, 0),
      `W15 golden F1 (${F1.shifts.length} shifts, ${F1.gaps.length} gaps) commits as one revision and reads back complete, reasons and problems included`);
  }
} catch (e) {
  failures++;
  console.error(`FAIL 0275 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0275: ${checks} checks`);
