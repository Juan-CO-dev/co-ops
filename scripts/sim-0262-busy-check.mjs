/**
 * 0262 'recipe_version:dependencies_busy' — the ONE refusal PGlite (one session) cannot prove. Run on the SIM ONLY,
 * after 0262 is applied there (plan Task 12), by CC:
 *
 *   SIM_DATABASE_URL='postgres://…sim…' node scripts/sim-0262-busy-check.mjs
 *
 * Needs the `pg` client (not a project dependency): `npx -y -p pg node scripts/sim-0262-busy-check.mjs`, or
 * `npm i --no-save pg` first. It refuses to run without SIM_DATABASE_URL, and refuses a URL that names the prod project.
 *
 * Two real sessions:
 *   A  begins, and takes FOR UPDATE on a SKU in the change's dependency closure (what any pack / price / receipt writer
 *      holds) — and keeps it.
 *   B  begins, sets statement_timeout 5 s, and calls save_recipe_version for that recipe at a shop with a FRESH snapshot.
 *      recipe_change_lock takes the closure locks NOWAIT, so B must fail AT ONCE with recipe_version:dependencies_busy —
 *      never wait (a statement_timeout here means a lock was taken without NOWAIT: a FAIL).
 *   Then a control: with A released, the SAME call succeeds (and is rolled back).
 * BOTH sessions ROLL BACK. Nothing persists.
 */
const URL = process.env.SIM_DATABASE_URL;
const PROD_PROJECT = "bgcvurheqzylyfehqgzh";
if (!URL) { console.error("SIM_DATABASE_URL is not set"); process.exit(2); }
if (URL.includes(PROD_PROJECT)) { console.error("refusing: that URL names the PROD project — this check runs on the sim only"); process.exit(2); }

let pg;
try { pg = (await import("pg")).default; }
catch { console.error("the `pg` client is missing — run with `npx -y -p pg node scripts/sim-0262-busy-check.mjs`"); process.exit(2); }

const a = new pg.Client({ connectionString: URL });
const b = new pg.Client({ connectionString: URL });
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
const one = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];

await a.connect();
await b.connect();
try {
  // A recipe with a SKU line, an active shop with NO version of it yet, the global head, an actor.
  const pick = await one(a, `
    select r.id as recipe, ri.component_sku_id as sku,
           (select id from public.locations s where s.active
             and not exists (select 1 from public.recipe_versions v where v.recipe_id = r.id and v.location_id = s.id and v.active)
            order by id limit 1) as shop,
           (select id from public.recipe_versions v where v.recipe_id = r.id and v.location_id is null and v.active) as head,
           (select id from public.users where active and role in ('owner', 'moo', 'cgs') order by id limit 1) as actor
      from public.recipes r join public.recipe_inputs ri on ri.recipe_id = r.id and ri.component_sku_id is not null
     where r.active order by r.id, ri.id limit 1`);
  if (!pick?.recipe || !pick.shop || !pick.head) throw new Error(`sim has no usable recipe / shop / head: ${JSON.stringify(pick)}`);
  const lines = (await one(a, `
    select jsonb_agg(jsonb_build_object('keep_id', null, 'component_sku_id', component_sku_id, 'component_item_id', component_item_id,
             'component_product_id', component_product_id, 'quantity', quantity, 'unit', unit,
             'each_container_label', each_container_label, 'portioned', portioned) order by display_order, id) as l
      from public.recipe_inputs where recipe_id = $1`, [pick.recipe])).l;
  const inClosure = await one(a, `select exists (select 1 from public.recipe_change_closure($1, $2, $3::jsonb)
                                    where member_kind = 'sku' and member_id = $4::text) as yes`, [pick.recipe, pick.shop, JSON.stringify(lines), pick.sku]);
  check(inClosure.yes, "setup: the held SKU is in the change's dependency closure");

  const callSave = async (c) => {
    const snap = (await one(c, "select public.recipe_change_snapshot($1, $2, $3::jsonb) as s", [pick.recipe, pick.shop, JSON.stringify(lines)])).s;
    return one(c, `select public.save_recipe_version($1, $2, $3::jsonb, null, $4, 'busy-check (rolled back)', $5, null, null, null, $6::jsonb) as r`,
      [pick.recipe, pick.shop, JSON.stringify(lines), pick.head, pick.actor, JSON.stringify(snap)]);
  };

  // A holds a closure row lock.
  await a.query("begin");
  await a.query("select 1 from public.vendor_items where id = $1 for update", [pick.sku]);

  // B must refuse at once, by name.
  await b.query("begin");
  await b.query("set local statement_timeout = '5s'");
  const t0 = Date.now();
  try {
    await callSave(b);
    check(false, "B: the save succeeded while A held a dependency (expected recipe_version:dependencies_busy)");
  } catch (e) {
    const msg = String(e.message);
    check(msg.includes("recipe_version:dependencies_busy"), `B: refused recipe_version:dependencies_busy (got: ${msg})`);
    check(!msg.includes("statement timeout") && Date.now() - t0 < 4000, `B: refused WITHOUT waiting (${Date.now() - t0} ms)`);
  }
  await b.query("rollback");

  // Control: A releases; the same call goes through (rolled back).
  await a.query("rollback");
  await b.query("begin");
  await b.query("set local statement_timeout = '15s'");
  try {
    const r = await callSave(b);
    check(Boolean(r?.r?.version_id), "control: with the lock released the same save succeeds");
  } catch (e) {
    check(false, `control: the save failed with the lock released (${e.message})`);
  }
  await b.query("rollback");
} finally {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
  await a.end();
  await b.end();
}
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
else console.log("\nPASS 0262 dependencies_busy: a held closure lock refuses the save at once, by name; released, the same save succeeds (all rolled back)");
