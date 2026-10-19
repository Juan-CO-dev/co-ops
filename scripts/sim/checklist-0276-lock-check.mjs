/**
 * FILE ONLY / NOT RUN by the builder. Real multi-session proof for 0276; PGlite
 * has one backend and cannot establish competing PostgreSQL row-lock ordering.
 * CC may run ONLY after applying 0276 on SIM and preparing three disposable,
 * OPEN checklist instances dated 2099 or later with the same template/item.
 * Each fixture must already have a live completion of that item and no final
 * submission. Actor must be active, a shop member and eligible to confirm.
 *
 * Set SIM_DATABASE_URL explicitly in the process environment (never loads .env).
 * With `pg` installed:
 * node scripts/sim/checklist-0276-lock-check.mjs --actor=<uuid> --item=<uuid> 
 *   --replace-first=<uuid> --confirm-first=<uuid> --confirm-race=<uuid>
 *
 * THIS SCRIPT WRITES/COMMITS TO THE SIM when explicitly run. It leaves all three
 * fixture instances confirmed, including replacement history and final
 * submissions. It never deletes, resets, or silently reuses existing history.
 * A failed run may leave partial committed history: use fresh fixtures to retry.
 * Two writer connections use SET LOCAL ROLE service_role; a third read-only
 * observer verifies the second writer is blocked by the first backend (not a
 * sleep-based guess). No production URL is accepted; the existing tested guard
 * builds the effective pg config before any connection is opened.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { simDatabaseTarget } from "../sim-0270-0271-lock-check-lib.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE = `select public.checklist_write_completion(
  $1::uuid, $2::uuid, $3::uuid, null::numeric, null::uuid, 'SIM 0276 concurrency proof') as result`;
const CONFIRM = `select public.checklist_confirm_instance(
  $1::uuid, $2::uuid, clock_timestamp(), '[]'::jsonb, $3::uuid[]) as result`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const race = (client, sql, params) => client.query(sql, params).then(
  (value) => ({ ok: true, value }),
  (error) => ({ ok: false, code: error.code, message: error.message }),
);
const refused = (result, name) => {
  assert.equal(result.ok, false, `expected refusal: ${name}`);
  assert.equal(result.code, "P0001");
  assert.ok(result.message.includes(name), `expected named refusal: ${name}`);
};

export async function main() {
  const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
  if (!target.ok) throw new Error(target.reason);
  const names = ["actor", "item", "replace-first", "confirm-first", "confirm-race"];
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match || !names.includes(match[1]) || args[match[1]] || !UUID.test(match[2])) {
      throw new Error("Require exactly --actor, --item, --replace-first, --confirm-first, --confirm-race UUID arguments");
    }
    args[match[1]] = match[2].toLowerCase();
  }
  if (names.some((key) => !args[key])) throw new Error("Missing required fixture UUID argument");
  const fixtureIds = names.slice(2).map((key) => args[key]);
  assert.equal(new Set(fixtureIds).size, 3, "three distinct fixture instances required");
  const { default: pg } = await import("pg");
  const clients = Array.from({ length: 3 }, () => new pg.Client(target.config));
  const [a, b, observer] = clients;
  const connected = [];
  const begin = async (client) => {
    await client.query("begin isolation level read committed");
    await client.query("set local statement_timeout = '15s'");
    await client.query("set local lock_timeout = '12s'");
    await client.query("set local role service_role");
  };
  const heads = async (client, id) => (await client.query(`
    select to_jsonb(c) as row from public.checklist_completions c
    where instance_id = $1 and superseded_at is null order by id`, [id])).rows.map((r) => r.row);
  const ids = (rows) => rows.map((r) => r.id).sort();
  const attested = async (id, expectedHeads) => {
    assert.deepEqual(await heads(observer, id), expectedHeads, "attested live rows unchanged after confirm");
    const { rows } = await observer.query(`select i.status, i.confirmed_by,
      (select count(*)::int from public.checklist_submissions s
       where s.instance_id = i.id and s.is_final_confirmation) as finals
      from public.checklist_instances i where i.id = $1`, [id]);
    assert.equal(rows[0]?.status, "confirmed");
    assert.equal(rows[0]?.confirmed_by, args.actor);
    assert.equal(rows[0]?.finals, 1, "exactly one final confirmation");
  };
  try {
    for (const client of clients) { await client.connect(); connected.push(client); }
    await observer.query("set default_transaction_read_only = on");
    const pidA = (await a.query("select pg_backend_pid() as pid")).rows[0].pid;
    const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
    assert.notEqual(pidA, pidB, "independent PostgreSQL backends required");
    const proveBlocked = async () => {
      for (const started = Date.now(); Date.now() - started < 5000; await pause(25)) {
        const r = await observer.query("select $1::int = any(pg_blocking_pids($2::int)) as blocked", [pidA, pidB]);
        if (r.rows[0].blocked) return;
      }
      assert.fail("B never blocked on A: shared parent serialization is absent");
    };
    // Validate ALL fixtures before the first commit. Probe both function paths
    // in rolled-back transactions, catching unsuitable actors/items up front.
    for (const id of fixtureIds) {
      const { rows } = await observer.query(`select i.id from public.checklist_instances i
        join public.checklist_template_items t on t.template_id = i.template_id and t.id = $2
        where i.id = $1 and i.status = 'open' and i.date >= date '2099-01-01'
        and exists (select 1 from public.checklist_completions c where c.instance_id = i.id
          and c.template_item_id = t.id and c.superseded_at is null)
        and not exists (select 1 from public.checklist_submissions s where s.instance_id = i.id
          and s.is_final_confirmation)`, [id, args.item]);
      assert.equal(rows.length, 1, "fixture must be disposable/open/2099+ with live item and no final submission");
      await begin(a);
      await a.query(WRITE, [args.actor, id, args.item]);
      await a.query("rollback");
      await begin(a);
      await a.query(CONFIRM, [args.actor, id, ids(await heads(a, id))]);
      await a.query("rollback");
    }

    // Replacement locks first: a pending confirm's prevalidated snapshot must
    // be refused after the replacement commits, then a refreshed confirm wins.
    const first = args["replace-first"];
    const before = await heads(observer, first);
    await begin(a);
    await a.query(WRITE, [args.actor, first, args.item]);
    await begin(b);
    const staleConfirm = race(b, CONFIRM, [args.actor, first, ids(before)]);
    await proveBlocked();
    await a.query("commit");
    refused(await staleConfirm, "completion_set_changed");
    await b.query("rollback");
    const replaced = await heads(observer, first);
    assert.notDeepEqual(ids(replaced), ids(before), "replacement must change the live head");
    await begin(b);
    await b.query(CONFIRM, [args.actor, first, ids(replaced)]);
    await b.query("commit");
    await attested(first, replaced);
    console.log("PASS replacement first: stale confirm refused; refreshed set attested");

    // Confirmation locks first: competing replacement waits, then is refused.
    const second = args["confirm-first"];
    const confirmedHeads = await heads(observer, second);
    await begin(a);
    await a.query(CONFIRM, [args.actor, second, ids(confirmedHeads)]);
    await begin(b);
    const lateReplace = race(b, WRITE, [args.actor, second, args.item]);
    await proveBlocked();
    await a.query("commit");
    refused(await lateReplace, "instance_not_open");
    await b.query("rollback");
    await attested(second, confirmedHeads);
    console.log("PASS confirmation first: competing replacement refused; attested set unchanged");

    // Two confirmations: one transaction claims and records the final; the
    // waiter refuses and cannot overwrite the winner or append a second final.
    const third = args["confirm-race"];
    const doubleHeads = await heads(observer, third);
    await begin(a);
    await a.query(CONFIRM, [args.actor, third, ids(doubleHeads)]);
    await begin(b);
    const secondConfirm = race(b, CONFIRM, [args.actor, third, ids(doubleHeads)]);
    await proveBlocked();
    await a.query("commit");
    refused(await secondConfirm, "instance_not_open");
    await b.query("rollback");
    await attested(third, doubleHeads);
    console.log("PASS concurrent confirmations: exactly one winner and final submission");
  } finally {
    // Release A before B: B may still be waiting if a check failed mid-race.
    for (const client of connected) await client.query("rollback").catch(() => {});
    for (const client of connected) await client.end().catch(() => {});
    console.log(`SIM fixture history retained: ${fixtureIds.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    if (e?.name === "AssertionError" || e?.code === "P0001") console.error(e.message);
    // Do not print connection errors: drivers may embed credential-bearing URLs.
    console.error("FAIL 0276 concurrency proof (fixture, connection, or invariant failure); no credentials logged");
    process.exitCode = 1;
  });
}
