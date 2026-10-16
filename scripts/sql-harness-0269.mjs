/**
 * Local Postgres proof of migration 0269 (Scheduling Phase 1, Task 9), SYNTHETIC ROWS ONLY — PGlite,
 * in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0269.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, the REAL level helpers (0217 assignment_user_level,
 * 0228 assignment_author_level, 0233 toast_link_actor_level — extracted verbatim from their migrations),
 * the REAL 0243 + 0268, then 0269, and proves:
 *   L0  the preflight refuses without 0268, without the helpers, and on a second apply
 *   L1  both tables: RLS on, no policy; anon / authenticated nothing; service_role exactly SELECT
 *       (INSERT / UPDATE / DELETE / TRUNCATE refused) — append-only by grant, the RPCs are the only writers
 *   L2  the four RPCs: SECURITY DEFINER, search_path pinned, not executable by anon / authenticated
 *   L3  shop links: every refusal by name, one live link per side, same pair → changed:false,
 *       unlink → relink is a NEW row (history kept), a deactivated actor is refused
 *   L4  person links: every refusal by name (GM own shop only, subject ≤ actor, an active member,
 *       remote_unknown, remote_not_at_shop for a GM — another location, a RETIRED assignment, a shop with
 *       no live or an UNLINKED 7shifts link (ruling (a)) — one live link per side), MoO any shop, unlink at the
 *       link's shop (GM) or anywhere (MoO), relink = a new row, a deactivated actor is refused
 *   L5  NO function in 0269 compares names (source scan of every function body)
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0243 = read("supabase/migrations/0243_cron_route_leases.sql");
const M0268 = read("supabase/migrations/0268_sevenshifts_sync.sql");
const M0269 = read("supabase/migrations/0269_sevenshifts_links.sql");

/** One function definition, verbatim from its migration: `start` … the first `end $$;` after it. */
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

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ helpers = true, m0268 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  if (helpers) await db.exec(HELPERS);
  await db.exec(M0243);
  if (m0268) await db.exec(M0268);
  return db;
}

const db = await base();
try {
  // L0 — the preflight
  {
    const no0268 = await base({ m0268: false });
    await refuses(() => no0268.exec(M0269), "0269: 0268 (the 7shifts mirrors) must be applied first", "L0 the preflight refuses without 0268");
    await no0268.close();
    const noHelpers = await base({ helpers: false });
    await refuses(() => noHelpers.exec(M0269), "0269: the 0217 / 0228 / 0233 level helpers must exist", "L0 the preflight refuses without the level helpers");
    await noHelpers.close();
  }
  await db.exec(M0269);
  check(true, "0269 applied with every SQL guard");
  {
    const again = await base();
    await again.exec(M0269);
    await refuses(() => again.exec(M0269), "0269: already applied", "L0 a second apply is refused by the preflight");
    await again.close();
  }

  // L1 — tables, RLS, the SELECT ceiling
  for (const t of ["sevenshifts_location_links", "sevenshifts_user_links"]) {
    const r = (await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${t}`])).rows[0];
    const pol = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t])).rows[0].n;
    check(r?.rls === true && pol === 0, `L1 ${t}: RLS on, no policy`);
    let ok = true;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const g = (await db.query(`select has_table_privilege('service_role', $1, $2) as s, has_table_privilege('anon', $1, $2) as a,
        has_table_privilege('authenticated', $1, $2) as u`, [`public.${t}`, p])).rows[0];
      if (g.s !== (p === "SELECT") || g.a || g.u) ok = false;
    }
    check(ok, `L1 ${t}: anon/authenticated nothing; service_role exactly SELECT`);
  }
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public'
    and table_name in ('sevenshifts_location_links', 'sevenshifts_user_links') and column_name in ('source', 'name', 'match_score')`)).rows;
  check(cols.length === 0, "L1 no `source`, name or score column: every link is manual");
  const notNull = (await db.query(`select table_name, is_nullable from information_schema.columns where table_schema = 'public'
    and table_name in ('sevenshifts_location_links', 'sevenshifts_user_links') and column_name = 'linked_by'`)).rows;
  check(notNull.length === 2 && notNull.every((r) => r.is_nullable === "NO"), "L1 linked_by is NOT NULL on both tables (no machine link)");

  // L2 — the RPCs
  const FNS = ["link_sevenshifts_location(uuid, uuid, bigint)", "unlink_sevenshifts_location(uuid, uuid)",
    "link_sevenshifts_user(uuid, uuid, bigint, uuid)", "unlink_sevenshifts_user(uuid, uuid, uuid)"];
  for (const fn of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      `L2 ${fn.split("(")[0]}: definer, search_path pinned, service_role only`);
  }

  // ── fixtures (superuser), then everything as service_role ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = (active = true) => id("insert into public.locations (active) values ($1) returning id", [active]);
  const member = (u, l, active = true) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [u, l, active]);
  const SA = await shop(), SB = await shop(), SX = await shop(false);
  const owner = await user("owner"), moo = await user("moo"), mooOff = await user("moo", false);
  const gmA = await user("gm"), gmB = await user("gm"), gmOff = await user("gm", false), agmA = await user("agm"), smmA = await user("social_media_mgr");
  const empA = await user("employee"), emp2A = await user("employee"), empB = await user("employee"), empOff = await user("employee", false), gm2A = await user("gm");
  // Ruling (a) fixtures: shop C has NO 7shifts link; emp3A is a free employee of shop A.
  const SC = await shop(), gmC = await user("gm"), empC = await user("employee"), emp3A = await user("employee");
  for (const [u, l] of [[gmA, SA], [gmB, SB], [gmOff, SA], [agmA, SA], [smmA, SA], [empA, SA], [emp2A, SA], [empB, SB], [empOff, SA], [gm2A, SA], [moo, SA],
    [gmC, SC], [empC, SC], [emp3A, SA]]) await member(u, l);
  await db.exec(`insert into public.sevenshifts_locations (id, company_id, name, active) values (4569, 1234, 'P', true), (4570, 1234, 'C', true);
    insert into public.sevenshifts_users (id, company_id, first_name, active) values (501, 1234, 'Ana', true), (502, 1234, 'Ana', true),
      (503, 1234, 'Bo', true), (504, 1234, 'Cy', true), (505, 1234, 'Di', true), (506, 1234, 'Ed', true);`);
  await db.exec("set role service_role");
  const runId = (await db.query("insert into public.sevenshifts_sync_run_ids (trigger) values ('cron') returning id")).rows[0].id;
  const edges = async (u, loc) => db.query("select public.reconcile_sevenshifts_user_snapshot($1, $2, 'assignments', true, $3::jsonb)",
    [runId, u, JSON.stringify([{ edge_key: `${u}:${loc}:-:-`, user_id: String(u), location_id: String(loc), department_id: null, role_id: null, is_primary: null }])]);
  await edges(501, 4569); await edges(502, 4569); await edges(503, 4570); await edges(504, 4569); await edges(505, 4569); await edges(506, 4569);
  // 505's assignment at 4569 is RETIRED by a later complete, empty snapshot.
  const runId2 = (await db.query("insert into public.sevenshifts_sync_run_ids (trigger) values ('cron') returning id")).rows[0].id;
  await db.query("select public.reconcile_sevenshifts_user_snapshot($1, 505, 'assignments', true, '[]'::jsonb)", [runId2]);
  check((await db.query("select active from public.sevenshifts_user_assignments where user_id = 505")).rows.every((r) => r.active === false),
    "L4 ruling (a) fixture: 505's 4569 assignment is retired");

  const rpc = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
  const linkShop = (actor, loc, remote) => rpc("link_sevenshifts_location", [actor, loc, remote]);
  const unlinkShop = (actor, link) => rpc("unlink_sevenshifts_location", [actor, link]);
  const linkUser = (actor, loc, remote, u) => rpc("link_sevenshifts_user", [actor, loc, remote, u]);
  const unlinkUser = (actor, loc, link) => rpc("unlink_sevenshifts_user", [actor, loc, link]);
  const count = async (t, where = "true") => (await db.query(`select count(*)::int as n from public.${t} where ${where}`)).rows[0].n;

  await refuses(() => db.query("insert into public.sevenshifts_user_links (sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values (501, $1, $2, $3)", [empA, SA, moo]),
    "42501", "L1 service_role cannot INSERT a link directly");
  await refuses(() => db.query("update public.sevenshifts_location_links set active = false"), "42501", "L1 service_role cannot UPDATE a link directly");
  await refuses(() => db.query("delete from public.sevenshifts_user_links"), "42501", "L1 service_role cannot DELETE a link");

  // L3 — shop links (MoO+)
  await refuses(() => linkShop(null, SA, 4569), "invalid_payload", "L3 no actor → invalid_payload (no machine link)");
  await refuses(() => linkShop(moo, SA, 0), "invalid_payload", "L3 a zero 7shifts id → invalid_payload");
  await refuses(() => linkShop(gmA, SA, 4569), "role_insufficient", "L3 a GM cannot link a shop (company-level config)");
  await refuses(() => linkShop(smmA, SA, 4569), "role_insufficient", "L3 the social media manager cannot link a shop");
  await refuses(() => linkShop(mooOff, SA, 4569), "role_insufficient", "L3 a deactivated MoO is refused");
  await refuses(() => linkShop(moo, SX, 4569), "location_access_denied", "L3 an inactive shop is refused");
  await refuses(() => linkShop(moo, SA, 9999), "remote_unknown", "L3 a 7shifts location not in the mirror → remote_unknown");
  const shopA = await linkShop(moo, SA, 4569);
  check(shopA.changed === true && (await count("sevenshifts_location_links", "active")) === 1, "L3 MoO links shop A ↔ 4569");
  const linkedBy = (await db.query("select linked_by from public.sevenshifts_location_links where id = $1", [shopA.id])).rows[0].linked_by;
  check(linkedBy === moo, "L3 the link records who linked it");
  const same = await linkShop(owner, SA, 4569);
  check(same.changed === false && same.id === shopA.id, "L3 the same pair again → changed:false, same row");
  await refuses(() => linkShop(moo, SA, 4570), "shop_already_linked", "L3 a second live link for shop A → shop_already_linked");
  await refuses(() => linkShop(moo, SB, 4569), "remote_already_linked", "L3 4569 already linked → remote_already_linked");
  await refuses(() => unlinkShop(gmA, shopA.id), "role_insufficient", "L3 a GM cannot unlink a shop");
  await refuses(() => unlinkShop(moo, "00000000-0000-4000-8000-000000000000"), "link_not_found", "L3 unlink of an unknown link → link_not_found");
  const off = await unlinkShop(moo, shopA.id);
  check(off.changed === true && (await unlinkShop(moo, shopA.id)).changed === false, "L3 unlink → changed; again → changed:false");
  const relink = await linkShop(moo, SA, 4569);
  check(relink.changed === true && relink.id !== shopA.id && (await count("sevenshifts_location_links")) === 2
    && (await count("sevenshifts_location_links", "active")) === 1, "L3 relink is a NEW row; the unlinked row stays as history");
  const hist = (await db.query("select unlinked_by, unlinked_at is not null as at from public.sevenshifts_location_links where id = $1", [shopA.id])).rows[0];
  check(hist.unlinked_by === moo && hist.at === true, "L3 the history row records who unlinked it and when");
  await linkShop(moo, SB, 4570);

  // L4 — person links
  await refuses(() => linkUser(gmA, SA, 501, null), "invalid_payload", "L4 no subject → invalid_payload");
  await refuses(() => linkUser(null, SA, 501, empA), "invalid_payload", "L4 no actor → invalid_payload (no machine link)");
  await refuses(() => linkUser(agmA, SA, 501, empA), "role_insufficient", "L4 an AGM cannot link people");
  await refuses(() => linkUser(smmA, SA, 501, empA), "role_insufficient", "L4 the social media manager cannot link people");
  await refuses(() => linkUser(gmOff, SA, 501, empA), "role_insufficient", "L4 a deactivated GM is refused");
  await refuses(() => linkUser(gmB, SA, 501, empA), "location_access_denied", "L4 a GM at another shop is refused");
  await refuses(() => linkUser(gmA, SA, 501, empB), "location_access_denied", "L4 the subject must be an active member of the shop");
  await refuses(() => linkUser(gmA, SA, 501, empOff), "assignee_unavailable", "L4 a deactivated subject is refused");
  await refuses(() => linkUser(gmA, SA, 501, moo), "role_insufficient", "L4 a GM cannot link a MoO (subject ≤ actor)");
  await refuses(() => linkUser(gmA, SA, 9999, empA), "remote_unknown", "L4 a 7shifts user not in the mirror → remote_unknown");
  await refuses(() => linkUser(gmA, SA, 503, empA), "remote_not_at_shop", "L4 a GM cannot claim a 7shifts person of another 7shifts location");
  await refuses(() => linkUser(gmA, SA, 505, emp3A), "remote_not_at_shop", "L4 ruling (a): a RETIRED assignment at the shop's 7shifts location does not count");
  await refuses(() => linkUser(gmC, SC, 506, empC), "remote_not_at_shop", "L4 ruling (a): a shop with NO live 7shifts link → a GM can claim nobody");
  const a = await linkUser(gmA, SA, 501, empA);
  check(a.changed === true, "L4 GM links 7shifts 501 → an employee of their shop");
  const gmPeer = await linkUser(gmA, SA, 504, gm2A);
  check(gmPeer.changed === true, "L4 a GM may link a subject of EQUAL level (another GM of the shop)");
  check((await linkUser(gmA, SA, 501, empA)).changed === false, "L4 the same pair again → changed:false");
  await refuses(() => linkUser(gmA, SA, 501, emp2A), "remote_already_linked", "L4 7shifts 501 already linked → remote_already_linked");
  await refuses(() => linkUser(gmA, SA, 502, empA), "user_already_linked", "L4 the CO-OPS user already linked → user_already_linked");
  const cross = await linkUser(moo, SB, 503, empB);
  check(cross.changed === true, "L4 MoO links at any shop");
  const mooAny = await linkUser(owner, SA, 502, emp2A);
  check(mooAny.changed === true, "L4 owner links (no remote_not_at_shop needed at 8+)");
  check((await count("sevenshifts_user_links", "active")) === 4, "L4 four live person links");
  // ruling (a): once shop B's 7shifts link is UNLINKED, its GM can no longer claim a 4570 person; MoO still can.
  const shopBLink = (await db.query("select id from public.sevenshifts_location_links where location_id = $1 and active", [SB])).rows[0].id;
  await unlinkShop(moo, shopBLink);
  const empB2 = await (async () => { await db.exec("reset role"); const u = await user("employee"); await member(u, SB); await db.exec("set role service_role"); return u; })();
  await db.exec("reset role");
  await db.query("insert into public.sevenshifts_users (id, company_id, first_name, active) values (507, 1234, 'Fy', true)");
  await db.exec("set role service_role");
  await edges(507, 4570);
  await refuses(() => linkUser(gmB, SB, 507, empB2), "remote_not_at_shop", "L4 ruling (a): an UNLINKED shop link no longer admits its GM");
  check((await linkUser(moo, SB, 507, empB2)).changed === true, "L4 ruling (a): MoO+ is exempt (links 507 at an unlinked shop)");
  // unlink
  await refuses(() => unlinkUser(gmB, SB, a.id), "link_not_found", "L4 a GM cannot unlink another shop's link (reads as not found)");
  await refuses(() => unlinkUser(gmB, SA, a.id), "location_access_denied", "L4 a GM cannot act for a shop they do not belong to");
  await refuses(() => unlinkUser(agmA, SA, a.id), "role_insufficient", "L4 an AGM cannot unlink");
  const u1 = await unlinkUser(gmA, SA, a.id);
  check(u1.changed === true && (await unlinkUser(gmA, SA, a.id)).changed === false, "L4 GM unlinks at the link's shop; again → changed:false");
  const u2 = await unlinkUser(moo, SA, cross.id);
  check(u2.changed === true, "L4 MoO unlinks a link made at another shop");
  const again = await linkUser(gmA, SA, 501, empA);
  check(again.changed === true && again.id !== a.id && (await count("sevenshifts_user_links", "sevenshifts_user_id = 501")) === 2,
    "L4 relink is a NEW row; the old one stays as history");
  check((await count("sevenshifts_user_links", "not active and unlinked_by is not null and unlinked_at is not null")) === 2,
    "L4 every unlinked row records who and when");
  await refuses(() => unlinkUser(gmOff, SA, again.id), "role_insufficient", "L4 a deactivated GM cannot unlink");

  // L5 — no function compares names
  await db.exec("reset role");
  const bodies = (await db.query(`select proname, prosrc from pg_proc where proname in
    ('link_sevenshifts_location', 'unlink_sevenshifts_location', 'link_sevenshifts_user', 'unlink_sevenshifts_user')`)).rows;
  check(bodies.length === 4 && bodies.every((b) => !/name/i.test(b.prosrc)), "L5 no 0269 function body mentions a name (ids only, never a name match)");
  const fileBodies = [...M0269.matchAll(/as \$\$([\s\S]*?)end \$\$;/g)].map((m) => m[1]);
  check(fileBodies.length === 4 && fileBodies.every((b) => !/name/i.test(b)), "L5 … and the same holds in the migration source");
} catch (e) {
  failures++;
  console.error(`FAIL 0269 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0269: ${checks} checks`);
