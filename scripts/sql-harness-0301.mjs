/**
 * Local Postgres proof of migration 0301 (per-shop 7shifts user links, Juan's ruling 2026-11-11), SYNTHETIC
 * ROWS ONLY — PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0301.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, the REAL level helpers (0217 / 0228 / 0233), the REAL
 * 0243 + 0268 + 0269, then 0301, and proves:
 *   P0  the preflight refuses without 0269, on a second apply (the index set has moved on) and on a drifted
 *       index set (an extra index on the table); EXISTING single links made through the 0269 RPC survive
 *       the apply unchanged and still count
 *   P1  the index set after apply: one_live_user and one_live_remote gone; one_live_user_shop UNIQUE
 *       (user_id, linked_at_location_id) and one_live_remote_shop UNIQUE (sevenshifts_user_id,
 *       linked_at_location_id), both WHERE active; a direct duplicate on either side at the same shop is
 *       refused by the index itself; service_role still SELECT only
 *   P2  link_sevenshifts_user: definer, search_path pinned, service_role only, takes the one link lock, no name
 *   P3  the ruling: two remotes for ONE user at TWO shops OK; two remotes for one user at the SAME shop refused
 *       `user_already_linked`; the SAME remote + the same user at two shops OK (a both-shops account); the same
 *       remote + ANOTHER user refused `remote_already_linked` at any shop; the same pair again → changed:false;
 *       unlinking one shop's link leaves the other live; relink = a new row
 *   P4  every 0269 rule still holds: GM own shop only, subject ≤ actor, ruling (a) remote_not_at_shop below 8
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0243 = read("supabase/migrations/0243_cron_route_leases.sql");
const M0268 = read("supabase/migrations/0268_sevenshifts_sync.sql");
const M0269 = read("supabase/migrations/0269_sevenshifts_links.sql");
const M0301 = read("supabase/migrations/0301_sevenshifts_per_shop_links.sql");

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

async function base({ m0269 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(HELPERS);
  await db.exec(M0243);
  await db.exec(M0268);
  if (m0269) await db.exec(M0269);
  return db;
}
const indexNames = async (db) => (await db.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'sevenshifts_user_links' order by 1")).rows.map((r) => r.indexname);
const indexDef = async (db, name) => (await db.query("select indexdef from pg_indexes where indexname = $1", [name])).rows[0]?.indexdef ?? "";

const db = await base();
try {
  // P0 — the preflight
  {
    const no0269 = await base({ m0269: false });
    await refuses(() => no0269.exec(M0301), "0301: 0269 (the 7shifts links) must be applied first", "P0 the preflight refuses without 0269");
    await no0269.close();
    const drifted = await base();
    await drifted.exec("create index sevenshifts_user_links_extra on public.sevenshifts_user_links (linked_by);");
    await refuses(() => drifted.exec(M0301), "0301: the live index set on sevenshifts_user_links differs from 0269", "P0 the preflight refuses a drifted index set");
    await drifted.close();
    const again = await base();
    await again.exec(M0301);
    await refuses(() => again.exec(M0301), "0301: the live index set on sevenshifts_user_links differs from 0269", "P0 a second apply is refused by the preflight");
    await again.close();
  }

  // ── fixtures (superuser) BEFORE the apply: prod already holds single links made by the 0269 RPC ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = (active = true) => id("insert into public.locations (active) values ($1) returning id", [active]);
  const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
  const SA = await shop(), SB = await shop();
  const moo = await user("moo"), gmA = await user("gm"), gmB = await user("gm"), owner = await user("owner");
  const both = await user("employee"); // works at BOTH shops with a 7shifts account at each
  const onlyA = await user("employee"), onlyB = await user("employee"), legacy = await user("employee");
  for (const [u, l] of [[gmA, SA], [gmB, SB], [moo, SA], [both, SA], [both, SB], [onlyA, SA], [onlyB, SB], [legacy, SA]]) await member(u, l);
  await db.exec(`insert into public.sevenshifts_locations (id, company_id, name, active) values (4569, 1234, 'P', true), (4570, 1234, 'C', true);
    insert into public.sevenshifts_users (id, company_id, first_name, active) values
      (501, 1234, 'Ana', true), (502, 1234, 'Ana', true), (503, 1234, 'Ana', true), (504, 1234, 'Bo', true), (505, 1234, 'Cy', true),
      (506, 1234, 'Ow', true), (507, 1234, 'Le', true);`);
  await db.exec("set role service_role");
  const runId = (await db.query("insert into public.sevenshifts_sync_run_ids (trigger) values ('cron') returning id")).rows[0].id;
  const edges = async (u, locs) => db.query("select public.reconcile_sevenshifts_user_snapshot($1, $2, 'assignments', true, $3::jsonb)",
    [runId, u, JSON.stringify(locs.map((loc) => ({ edge_key: `${u}:${loc}:-:-`, user_id: String(u), location_id: String(loc), department_id: null, role_id: null, is_primary: null })))]);
  // 501, 502, 504, 507 are shop A accounts (4569); 503, 505 are shop B accounts (4570); 506 (the owner) is ONE account at BOTH.
  await edges(501, [4569]); await edges(502, [4569]); await edges(503, [4570]); await edges(504, [4569]); await edges(505, [4570]); await edges(506, [4569, 4570]); await edges(507, [4569]);

  const rpc = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
  const linkShop = (actor, loc, remote) => rpc("link_sevenshifts_location", [actor, loc, remote]);
  const linkUser = (actor, loc, remote, u) => rpc("link_sevenshifts_user", [actor, loc, remote, u]);
  const unlinkUser = (actor, loc, link) => rpc("unlink_sevenshifts_user", [actor, loc, link]);
  const count = async (where = "true") => (await db.query(`select count(*)::int as n from public.sevenshifts_user_links where ${where}`)).rows[0].n;
  await linkShop(moo, SA, 4569);
  await linkShop(moo, SB, 4570);
  const legacyLink = await linkUser(gmA, SA, 507, legacy);
  check(legacyLink.changed === true, "P0 an existing single link made through the 0269 RPC (before the apply)");
  await db.exec("reset role");

  await db.exec(M0301);
  check(true, "0301 applied with every SQL guard, over existing rows");
  const kept = (await db.query("select active, user_id, linked_at_location_id from public.sevenshifts_user_links where id = $1", [legacyLink.id])).rows[0];
  check(kept?.active === true && kept.user_id === legacy && kept.linked_at_location_id === SA && (await count("active")) === 1, "P0 the existing link survives the apply unchanged");

  // P1 — the index set and the SELECT ceiling
  check(JSON.stringify(await indexNames(db)) === JSON.stringify(["sevenshifts_user_links_one_live_remote_shop", "sevenshifts_user_links_one_live_user_shop", "sevenshifts_user_links_pkey", "sevenshifts_user_links_shop"]),
    "P1 index set: one_live_user and one_live_remote gone; one_live_user_shop and one_live_remote_shop added; shop kept");
  check(/UNIQUE INDEX .* \(user_id, linked_at_location_id\) WHERE active$/.test(await indexDef(db, "sevenshifts_user_links_one_live_user_shop")), "P1 one_live_user_shop is UNIQUE (user_id, linked_at_location_id) WHERE active");
  check(/UNIQUE INDEX .* \(sevenshifts_user_id, linked_at_location_id\) WHERE active$/.test(await indexDef(db, "sevenshifts_user_links_one_live_remote_shop")), "P1 one_live_remote_shop is UNIQUE (sevenshifts_user_id, linked_at_location_id) WHERE active");
  {
    let ok = true;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const g = (await db.query(`select has_table_privilege('service_role', 'public.sevenshifts_user_links', $1) as s`, [p])).rows[0];
      if (g.s !== (p === "SELECT")) ok = false;
    }
    check(ok, "P1 service_role still exactly SELECT on sevenshifts_user_links");
  }
  // the indexes themselves, whatever the writer (superuser inserts)
  await refuses(() => db.query("insert into public.sevenshifts_user_links (sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values (501, $1, $2, $3)", [legacy, SA, moo]),
    "23505", "P1 the index refuses a second live (user, shop) row directly");
  await refuses(() => db.query("insert into public.sevenshifts_user_links (sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values (507, $1, $2, $3)", [onlyA, SA, moo]),
    "23505", "P1 the index refuses a second live (remote, shop) row directly");
  const direct = (await db.query("insert into public.sevenshifts_user_links (sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values (507, $1, $2, $3) returning id", [legacy, SB, moo])).rows[0].id;
  check(!!direct, "P1 … and admits the same (remote, user) at another shop");
  await db.query("update public.sevenshifts_user_links set active = false, unlinked_by = $2, unlinked_at = clock_timestamp() where id = $1", [direct, moo]);

  // P2 — the re-emitted RPC
  {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, p.prosrc as src, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = 'public.link_sevenshifts_user(uuid, uuid, bigint, uuid)'::regprocedure`)).rows[0];
    check(r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      "P2 link_sevenshifts_user: definer, search_path pinned, service_role only");
    check(r.src.includes("pg_advisory_xact_lock(hashtextextended('sevenshifts-link', 0))"), "P2 … takes the one link lock");
    check(!/name/i.test(r.src), "P2 … never mentions a name");
    check(r.src.includes("user_id = p_user and linked_at_location_id = p_location and active") && r.src.includes("sevenshifts_user_id = p_remote_user and user_id <> p_user and active"),
      "P2 … judges user_already_linked per (user, shop) and remote_already_linked per person at any shop");
  }

  await db.exec("set role service_role");
  // P3 — the ruling
  const a = await linkUser(gmA, SA, 501, both);
  check(a.changed === true, "P3 GM A links the person's shop-A account (501) at shop A");
  const b = await linkUser(gmB, SB, 503, both);
  check(b.changed === true && b.id !== a.id, "P3 GM B links the SAME person's shop-B account (503) at shop B — two remotes, one user, two shops");
  check((await count(`user_id = '${both}' and active`)) === 2, "P3 the person holds two live links, one per shop");
  await refuses(() => linkUser(gmA, SA, 502, both), "user_already_linked", "P3 two remotes for one user at the SAME shop → user_already_linked");
  await refuses(() => linkUser(moo, SA, 502, both), "user_already_linked", "P3 … for a MoO too");
  await refuses(() => linkUser(moo, SB, 501, both), "user_already_linked", "P3 … the shop-A account asked at shop B while the shop-B account is live → user_already_linked");
  await refuses(() => linkUser(gmA, SA, 501, onlyA), "remote_already_linked", "P3 the same remote + ANOTHER user → remote_already_linked (same shop)");
  await refuses(() => linkUser(moo, SB, 501, onlyB), "remote_already_linked", "P3 … and at another shop");
  const same = await linkUser(gmA, SA, 501, both);
  check(same.changed === false && same.id === a.id, "P3 the same pair again → changed:false, the same row");
  // a both-shops account (506, the owner, linked by the owner: subject ≤ actor): the same remote + the same user at two shops
  const o1 = await linkUser(owner, SA, 506, owner);
  const o2 = await linkUser(owner, SB, 506, owner);
  check(o1.changed === true && o2.changed === true && o1.id !== o2.id && (await count("sevenshifts_user_id = 506 and active")) === 2,
    "P3 the SAME remote + the same user at two shops → two live links (a both-shops account)");
  check((await linkUser(owner, SB, 506, owner)).changed === false, "P3 … asked again at shop B → changed:false");
  await refuses(() => linkUser(owner, SA, 506, onlyA), "remote_already_linked", "P3 … the both-shops account to another person → remote_already_linked");
  // unlink one shop's link: the other stays live
  const off = await unlinkUser(gmA, SA, a.id);
  check(off.changed === true && (await count(`user_id = '${both}' and active`)) === 1
    && (await db.query("select active from public.sevenshifts_user_links where id = $1", [b.id])).rows[0].active === true,
    "P3 unlinking the shop-A link leaves the shop-B link live");
  const againA = await linkUser(gmA, SA, 501, both);
  check(againA.changed === true && againA.id !== a.id && (await count(`user_id = '${both}'`)) === 3, "P3 relink at shop A is a NEW row; history kept");
  await refuses(() => unlinkUser(gmB, SB, againA.id), "link_not_found", "P3 GM B cannot unlink shop A's link (reads as not found)");
  const oOff = await unlinkUser(owner, SA, o1.id);
  check(oOff.changed === true && (await db.query("select active from public.sevenshifts_user_links where id = $1", [o2.id])).rows[0].active === true,
    "P3 unlinking the both-shops account at shop A leaves its shop-B link live");

  // P4 — the 0269 rules still hold
  await refuses(() => linkUser(gmB, SA, 504, onlyA), "location_access_denied", "P4 a GM at another shop is refused");
  await refuses(() => linkUser(gmA, SA, 504, onlyB), "location_access_denied", "P4 the subject must be an active member of the shop");
  await refuses(() => linkUser(gmA, SA, 504, moo), "role_insufficient", "P4 subject ≤ actor");
  await refuses(() => linkUser(gmA, SA, 505, onlyA), "remote_not_at_shop", "P4 ruling (a): a GM cannot claim another shop's 7shifts account");
  await refuses(() => linkUser(gmA, SA, 9999, onlyA), "remote_unknown", "P4 an unknown 7shifts user → remote_unknown");
  check((await linkUser(moo, SA, 505, onlyA)).changed === true, "P4 MoO+ is exempt from ruling (a)");
  await db.exec("reset role");
  const bodies = (await db.query(`select prosrc from pg_proc where proname in ('link_sevenshifts_user', 'unlink_sevenshifts_user')`)).rows;
  check(bodies.length === 2 && bodies.every((b) => !/name/i.test(b.prosrc)), "P4 neither person-link function mentions a name");
} catch (e) {
  failures++;
  console.error(`FAIL 0301 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0301: ${checks} checks`);
