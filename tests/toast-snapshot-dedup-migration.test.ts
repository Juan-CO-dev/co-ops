/**
 * Toast duplicate cleanup PR 2: Migration 0351_toast_snapshot_dedup. File only; CC applies sim then prod on Juan's word.
 * Runs the REAL 0221 file, 0225's link table, 0239's page writer, 0337's fact tables, 0344 / 0347's house link and
 * conflict tables and the REAL 0351 file in PGlite (tests/helpers/toast-dedup-harness.ts), and proves: the stored-content
 * equivalence; the cutover (registry copy, register trigger, membership FK swap); the manifest (who is retained, who
 * survives, chunked = whole, the digest); the apply (exactly the manifest, children before parents, memberships
 * untouched, one audit row per batch, EVERY refusal by name with nothing deleted); verify under planted faults; the
 * ceilings. PGlite has ONE backend: lock waits and the open-transaction refusal are proven on sim
 * (scripts/sim/toast-dedup-lock-check-management.mjs). Migrations are pinned BY NAME, never "the latest".
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { DAY, SHOP, baseSchema, capture, cut, errorOf, hash, m0351, one, schema, uuid, type OrderSpec } from "./helpers/toast-dedup-harness";

const sql = m0351;
const code = sql.replace(/--[^\n]*/g, "");
const fn = (name: string) => sql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\n(?:end \\$\\$;|\\$\\$;)`))![0];
const DAY2 = "2026-10-11";
const CUTOFF = "2026-10-31";
const T1 = "2026-10-10T18:00:00Z", T2 = "2026-10-10T19:00:00Z";

/** One order's content. `turn` permutes array order and renumbers ordinals: the SAME stored content, another layout. */
const dup = (guid: string, tag: string, turn = 0, extra: Partial<OrderSpec> = {}): OrderSpec => ({
  guid, hash: tag, modified: T1,
  units: turn % 2 ? [{ selection_guid: "s2", qty: 1 }, { selection_guid: "s1", qty: 2 }] : [{ selection_guid: "s1", qty: 2 }, { selection_guid: "s2", qty: 1 }],
  checks: [{ check_guid: "c1", amount_cents: 1500 }],
  discounts: turn % 2
    ? [{ check_guid: "c1", ordinal: 0, applied_discount_guid: "d-b", amount_cents: 200 }, { check_guid: "c1", ordinal: 1, applied_discount_guid: "d-a", amount_cents: 100 }]
    : [{ check_guid: "c1", ordinal: 0, applied_discount_guid: "d-a", amount_cents: 100 }, { check_guid: "c1", ordinal: 1, applied_discount_guid: "d-b", amount_cents: 200 }],
  payments: [{ check_guid: "c1", payment_guid: "p1", amount_cents: 1500 }],
  ...extra,
});

/** The fixture. Each array is one order's captures in time order (one run per column, real writers). */
async function seed(db: PGlite) {
  const id: Record<string, string> = {};
  const orders: OrderSpec[][] = [
    // dup: four equal captures; the last is the pointer target.
    [dup("dup", "dup1", 0), dup("dup", "dup2", 1), dup("dup", "dup3", 0), dup("dup", "dup4", 1)],
    // enrich: same modified_at, different content (accounting null vs present) = class N, never listed.
    [dup("enrich", "enr1", 0), dup("enrich", "enr2", 0, { checks: [{ check_guid: "c1", amount_cents: 1500, accounting: { version: "1", net: 1500 } }] })],
    // edit: a real older version.
    [dup("edit", "edit1", 0), dup("edit", "edit2", 0, { modified: T2, checks: [{ check_guid: "c1", amount_cents: 1700 }] })],
    // linked: an ezCater link names the FIRST capture; the last is the pointer target.
    [dup("linked", "lnk1", 0), dup("linked", "lnk2", 1), dup("linked", "lnk3", 0)],
    // nopointer: three equal captures, then a real edit takes the pointer. Survivor = the earliest first seen.
    [dup("nopointer", "np1", 0), dup("nopointer", "np2", 1), dup("nopointer", "np3", 0), dup("nopointer", "np4", 0, { modified: T2, payments: [] })],
    // evidence: every capture but the last two is named somewhere with no foreign key.
    [dup("evidence", "ev1", 0), dup("evidence", "ev2", 1), dup("evidence", "ev3", 0), dup("evidence", "ev4", 1), dup("evidence", "ev5", 0),
      dup("evidence", "ev6", 1), dup("evidence", "ev7", 0)],
  ];
  const runs: string[] = [];
  for (let column = 0; column < Math.max(...orders.map((o) => o.length)); column++) {
    const batch = orders.map((o) => o[column]).filter((o): o is OrderSpec => !!o);
    const { run, ids } = await capture(db, batch);
    runs.push(run);
    for (const o of batch) id[o.hash] = ids[o.guid]!;
  }
  // Another business day (chunked build, by_month).
  for (const [turn, tag] of ["oth1", "oth2"].entries()) {
    const { run, ids } = await capture(db, [{ ...dup("other", tag, turn), date: DAY2, modified: "2026-10-11T18:00:00Z" }], { date: DAY2 });
    runs.push(run); id[tag] = ids.other!;
  }
  await db.query(`insert into public.ezcater_toast_links(order_id, snapshot_id, location_id, toast_snapshot_id, order_guid, check_guid, selection_guid, business_date, evidence, reconciliation_details)
    values ($1, $2, $3, $4, 'linked', 'c1', '', $5, 'normalized_code', $6::jsonb)`, [uuid(), uuid(), SHOP, id.lnk1, DAY, JSON.stringify({ seen: [{ toast_snapshot: id.ev4 }] })]);
  await db.query(`insert into public.catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence) values ($1, $2, 'evidence', 'c1', $3, 'ring_code')`, [uuid(), SHOP, id.ev1]);
  await db.query(`insert into public.fact_order_snapshot(location_id, business_date, order_guid, snapshot_id, run_member, check_count) values ($1, $2, 'evidence', $3, true, 1)`, [SHOP, DAY, id.ev2]);
  await db.query(`insert into public.audit_log(action, resource_table, metadata) values ('ezcater.toast_reconciled', 'ezcater_toast_links', $1::jsonb)`, [JSON.stringify({ snapshots: [id.ev3!.toUpperCase()] })]);
  await db.query(`insert into public.catering_toast_conflicts(location_id, order_guid, check_guid, kind, ezcater_order_id, toast_snapshot_id) values ($1, 'evidence', 'c1', 'dual_code', $2, $3)`, [SHOP, uuid(), id.ev5]);
  return { id, runs };
}
/** What the manifest must list: snapshot -> survivor. */
const expectedItems = (id: Record<string, string>) => ({
  [id.dup1!]: id.dup4!, [id.dup2!]: id.dup4!, [id.dup3!]: id.dup4!,
  [id.lnk2!]: id.lnk3!,
  [id.np2!]: id.np1!, [id.np3!]: id.np1!,
  [id.ev6!]: id.ev7!,
  [id.oth1!]: id.oth2!,
});
type Built = { items: number; batches: number; digest: string; totals: Record<string, unknown> };
async function build(db: PGlite, version: number, ranges: [string, string][] = [["2026-10-01", "2026-11-01"]], batchSize = 3): Promise<Built> {
  await db.query("select public.toast_snapshot_dedup_begin($1, $2)", [version, CUTOFF]);
  for (const [from, to] of ranges) await db.query("select public.toast_snapshot_dedup_build_range($1, $2, $3)", [version, from, to]);
  return one<Built>(db, "select public.toast_snapshot_dedup_finish($1, $2) v", [version, batchSize]);
}
const itemsOf = async (db: PGlite, version: number) => Object.fromEntries((await db.query<{ snapshot_id: string; survivor_id: string }>(
  `select i.snapshot_id, i.survivor_id from public.toast_snapshot_dedup_items i join public.toast_snapshot_dedup_manifests m on m.id = i.manifest_id where m.version = $1`, [version])).rows
  .map((r) => [r.snapshot_id, r.survivor_id]));
const expectedOf = (db: PGlite, version: number, batch: number) => one<Record<string, number>>(db,
  `select jsonb_build_object('snapshots', b.snapshots, 'checks', b.checks, 'discounts', b.discounts, 'service_charges', b.service_charges, 'payments', b.payments) v
     from public.toast_snapshot_dedup_batches b join public.toast_snapshot_dedup_manifests m on m.id = b.manifest_id where m.version = $1 and b.batch = $2`, [version, batch]);
const apply = async (db: PGlite, version: number, digest: string, batch: number, expected?: Record<string, number>) =>
  one<Record<string, unknown>>(db, "select public.toast_snapshot_dedup_apply($1, $2, $3, $4::jsonb) v", [version, digest, batch, JSON.stringify(expected ?? await expectedOf(db, version, batch))]);
const PAYLOAD = ["toast_orders", "toast_order_checks", "toast_check_discounts", "toast_check_service_charges", "toast_payments"] as const;
const counts = async (db: PGlite) => one<Record<string, number>>(db, `select jsonb_build_object(${[...PAYLOAD, "toast_capture_run_orders", "toast_snapshot_registry", "audit_log"]
  .map((t) => `'${t}', (select count(*) from public.${t})`).join(", ")}) v`);
const memberships = (db: PGlite) => one<string>(db, "select md5(string_agg(to_jsonb(ro)::text, ',' order by run_id, order_guid)) v from public.toast_capture_run_orders ro");
const content = (db: PGlite, id: string) => one<unknown>(db, "select public.toast_snapshot_content($1) v", [id]);

describe("0351 header and shape", () => {
  it("gate header, one transaction, file only", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0351_toast_snapshot_dedup");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-19 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
  });

  it("the file deletes nothing when applied, and the only deletes anywhere are the apply's five, children before parents", () => {
    const apply = fn("toast_snapshot_dedup_apply");
    const deletes = [...code.matchAll(/delete\s+from\s+public\.(\w+)/g)].map((m) => m[1]);
    expect(deletes).toEqual(["toast_check_discounts", "toast_check_service_charges", "toast_payments", "toast_order_checks", "toast_orders"]);
    expect([...apply.replace(/--[^\n]*/g, "").matchAll(/delete\s+from\s+public\.(\w+)/g)].map((m) => m[1])).toEqual(deletes);
    expect(code).not.toMatch(/\btruncate\b/i);
    // No membership, run, pointer or link row is ever written by this file.
    expect(code).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.(toast_capture_run_orders|toast_capture_runs|toast_capture_pages|toast_order_latest_pointers|ezcater_toast_links)\b/i);
  });

  it("the apply takes ONE table lock, toast_orders first, and no row lock on runs, pointers or links (plan r3 section 2)", () => {
    const body = fn("toast_snapshot_dedup_apply").replace(/--[^\n]*/g, "");
    const statements = body.slice(body.indexOf("\nbegin\n")).split(";").map((s) => s.trim());
    expect(statements[0]).toBe("begin\n  begin\n    lock table public.toast_orders in share row exclusive mode");
    expect(body.match(/lock\s+table/gi)).toHaveLength(1);
    expect(body.match(/for\s+(no\s+key\s+)?(update|share)/gi)).toEqual(["for update"]);
    expect(body).toMatch(/from public\.toast_snapshot_dedup_manifests where version = p_version for update/);
    expect(body).not.toMatch(/advisory/i);
    expect(fn("toast_snapshot_dedup_apply")).toMatch(/set lock_timeout = '5s'/);
    // The migration's own cutover: the same first lock, and the FK drop is the last statement that takes one.
    expect(code.indexOf("lock table public.toast_orders in share row exclusive mode;")).toBeLessThan(code.indexOf("create table"));
    expect(code.match(/^lock table [^\n]*$/gm)).toEqual(["lock table public.toast_orders in share row exclusive mode;"]);
    const drop = code.indexOf("alter table public.toast_capture_run_orders drop constraint");
    expect(drop).toBeGreaterThan(code.indexOf("add constraint toast_capture_run_orders_snapshot_registry_fkey"));
    expect(code.slice(drop + 10)).not.toMatch(/\b(create table|create index|create trigger|lock table|alter table|insert into|update public|delete from)\b/i);
  });

  it("stored content is PR 1's expression, line for line (scripts/toast-hash-acceptance.sql)", () => {
    const acceptance = readFileSync("scripts/toast-hash-acceptance.sql", "utf8").replace(/\r\n/g, "\n");
    const expr = (src: string) => cut(src, "jsonb_build_object(\n    'order', to_jsonb(o)", "  ) as content\n");
    const mine = expr(fn("toast_snapshot_content"));
    expect(mine).toContain("to_jsonb(o) - 'id' - 'content_hash' - 'selection_units'");
    const theirs = acceptance.split("jsonb_build_object(\n    'order', to_jsonb(o)").slice(1).map((part) => `jsonb_build_object(\n    'order', to_jsonb(o)${part.slice(0, part.indexOf("  ) as content\n") + "  ) as content\n".length)}`);
    expect(theirs).toHaveLength(2);
    for (const t of theirs) expect(t).toBe(mine);
  });

  it("no app code path: nothing in lib/ or app/ names a dedup function, and service_role may not execute one", () => {
    const grep = (pattern: string) => {
      try { return execFileSync("git", ["grep", "-l", "-E", pattern, "--", "lib", "app", "components", "proxy.ts"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean); }
      catch (e) { if ((e as { status?: number }).status !== 1) throw e; return []; }
    };
    // The only mentions are the two audit-vocabulary registries (comments beside the action name).
    expect(grep("toast_snapshot_(dedup|content|registry|reference|evidence|register)")).toEqual(["lib/audit-actions.ts", "lib/destructive-actions.ts"]);
    // And nothing calls or reads any of it.
    expect(grep("(rpc|from)[(][^)]*toast_snapshot_")).toEqual([]);
    expect(code).toMatch(/revoke all on function public\.%s from public, anon, authenticated, service_role/);
  });

  it("the audit row: the registered action, destructive, migration_apply, and no snapshot id", () => {
    const body = fn("toast_snapshot_dedup_apply");
    expect(body).toContain("'toast.snapshot_dedup'");
    expect(body).toContain("'actor_context', 'migration_apply'");
    expect(body).toMatch(/'counts', v_expected\), true\)/);
    expect(body.match(/insert into public\.audit_log/g)).toHaveLength(1);
    expect(code.match(/insert into public\.audit_log/g)).toHaveLength(1);
  });

  it("ONE reference census, asked by build and apply, with exactly the reviewed exclusions (plan r6)", () => {
    const census = fn("toast_snapshot_reference_ids");
    const excluded = census.match(/c[.]table_name not in [(]([^)]*)[)]/)![1]!.match(/[a-z_]+/g)!;
    expect([...excluded].sort()).toEqual([
      // the deletable payload's own children
      "toast_check_discounts", "toast_check_service_charges", "toast_order_checks", "toast_payments",
      // the preserved memberships
      "toast_capture_run_orders",
      // the cleanup's own bookkeeping
      "toast_snapshot_dedup_items", "toast_snapshot_dedup_retained", "toast_snapshot_registry",
    ].sort());
    expect(census).toContain("c.column_name like '%snapshot%'");
    expect(census).toContain("from public.toast_snapshot_registry where survivor_id is not null");
    for (const caller of ["toast_snapshot_dedup_build_range", "toast_snapshot_dedup_apply"]) expect(fn(caller)).toContain("public.toast_snapshot_reference_ids()");
    // No second list of referencing tables anywhere in the file.
    expect(code.match(/toast_snapshot_reference_ids[(][)]/g)!.length).toBe(4);
    const evidence = fn("toast_snapshot_evidence_ids");
    expect(evidence).toContain("c.table_name not in ('toast_orders','toast_order_checks') and c.table_name !~ '^toast_snapshot_'");
    expect(evidence).toContain("(c.table_name = 'audit_log' or c.table_name ~ '^(toast|ezcater|catering_toast|fact)_')");
  });

  it("the transaction guard is written against pg_stat_activity and prepared transactions (proven live on sim)", () => {
    const body = fn("toast_snapshot_dedup_apply");
    expect(body).toMatch(/a\.pid <> pg_backend_pid\(\) and a\.datname = current_database\(\)\s+and a\.xact_start is not null and a\.xact_start < m\.begun_at/);
    expect(body).toContain("raise exception 'open_transaction_older_than_manifest'");
    expect(body).toContain("raise exception 'prepared_transaction_open'");
    expect(body).toContain("raise exception 'cannot_see_transactions'");
    expect(body).toContain("raise exception 'dedup_busy'");
  });

  it("quiescence comes BEFORE every reference scan, and only under READ COMMITTED (review TOASTDUP-r1 P1)", () => {
    // A reference committed by a transaction that ended between a scan and the open-transaction check would be missed
    // by both. So: the guard first (backends, then prepared transactions), every scan after it as a later statement.
    const body = fn("toast_snapshot_dedup_apply").replace(/--[^\n]*/g, "");
    const at = (needle: string) => { const i = body.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    const guard = [at("raise exception 'isolation_not_read_committed'"), at("raise exception 'cannot_see_transactions'"), at("perform pg_stat_clear_snapshot()"),
      at("from pg_stat_activity a"), at("from pg_prepared_xacts x")];
    expect([...guard].sort((a, b) => a - b)).toEqual(guard);
    const scans = [at("raise exception 'candidate_missing'"), at("from public.toast_snapshot_reference_ids() f"), at("from public.toast_snapshot_evidence_ids("),
      at("raise exception 'candidate_in_running_run'"), at("raise exception 'candidate_order_recently_captured'"), at("raise exception 'content_changed'"),
      at("update public.toast_snapshot_registry g"), at("delete from public.toast_check_discounts")];
    for (const scan of scans) expect(scan).toBeGreaterThan(Math.max(...guard));
    expect(body.match(/from pg_stat_activity/g)).toHaveLength(1);
    expect(body.match(/from pg_prepared_xacts/g)).toHaveLength(1);
  });
});

describe("stored content: equal means equal after ignoring storage identity, array order and synthetic ordinals only", () => {
  let db: PGlite; const id: Record<string, string> = {};
  const snap = async (tag: string, spec: Partial<OrderSpec> & { turn?: number }) => {
    const { ids } = await capture(db, [dup("o", tag, spec.turn ?? 0, spec)]);
    id[tag] = ids.o!;
  };
  beforeAll(async () => {
    db = await schema();
    await snap("base", {});
    await snap("same", {});
    await snap("permuted", { turn: 1 });
    await snap("one-discount-less", { discounts: [{ check_guid: "c1", ordinal: 0, applied_discount_guid: "d-a", amount_cents: 100 }] });
    await snap("twin-discounts", { discounts: [{ check_guid: "c1", ordinal: 0, applied_discount_guid: "d-a", amount_cents: 100 }, { check_guid: "c1", ordinal: 1, applied_discount_guid: "d-a", amount_cents: 100 }] });
    await snap("one-twin", { discounts: [{ check_guid: "c1", ordinal: 0, applied_discount_guid: "d-a", amount_cents: 100 }] });
    await snap("accounting", { checks: [{ check_guid: "c1", amount_cents: 1500, accounting: { version: "1", net: 1500 } }] });
    await snap("refund-null", { payments: [{ check_guid: "c1", payment_guid: "p1", amount_cents: 1500, sales_refund_cents: null }] });
    await snap("refund-zero", { payments: [{ check_guid: "c1", payment_guid: "p1", amount_cents: 1500, sales_refund_cents: 0 }] });
    await snap("priced-unit", { units: [{ selection_guid: "s1", qty: 2, price_cents: 900 }, { selection_guid: "s2", qty: 1 }] });
    await snap("charges-a", { charges: [{ check_guid: "c1", ordinal: 0, name: "fee", amount_cents: 50 }, { check_guid: "c1", ordinal: 1, name: "bag", amount_cents: 10 }] });
    await snap("charges-b", { charges: [{ check_guid: "c1", ordinal: 0, name: "bag", amount_cents: 10 }, { check_guid: "c1", ordinal: 1, name: "fee", amount_cents: 50 }] });
    await snap("captured", { payments: [{ check_guid: "c1", payment_guid: "p1", amount_cents: 1500, payment_status: "AUTHORIZED" }] });
  }, 120_000);

  it("distinct snapshot ids with identical rows are equal; so are permuted selections and renumbered discounts / service charges", async () => {
    expect(new Set(Object.values(id)).size).toBe(Object.keys(id).length);
    expect(await content(db, id.same!)).toEqual(await content(db, id.base!));
    expect(await content(db, id.permuted!)).toEqual(await content(db, id.base!));
    expect(await content(db, id["charges-b"]!)).toEqual(await content(db, id["charges-a"]!));
    expect(await one(db, "select public.toast_snapshot_content_md5($1) = public.toast_snapshot_content_md5($2) v", [id.permuted, id.base])).toBe(true);
  });

  it.each([["one-discount-less"], ["accounting"], ["refund-zero"], ["priced-unit"], ["charges-a"], ["captured"]])("%s differs from the base", async (tag) => {
    expect(await content(db, id[tag]!)).not.toEqual(await content(db, id.base!));
    expect(await one(db, "select public.toast_snapshot_content_md5($1) <> public.toast_snapshot_content_md5($2) v", [id[tag], id.base])).toBe(true);
  });

  it("multiplicity counts: two identical discounts are not one; null is not zero", async () => {
    expect(await content(db, id["twin-discounts"]!)).not.toEqual(await content(db, id["one-twin"]!));
    expect(await content(db, id["refund-null"]!)).toEqual(await content(db, id.base!));
    expect(await content(db, id["refund-zero"]!)).not.toEqual(await content(db, id["refund-null"]!));
  });

  it("the content carries no storage identity and does not depend on the session time zone", async () => {
    const text = await one<string>(db, "select public.toast_snapshot_content($1)::text v", [id.base]);
    expect(text).not.toContain(id.base);
    expect(text).not.toContain(hash("base"));
    expect(text).not.toContain("ordinal");
    const utc = await one<string>(db, "select public.toast_snapshot_content_md5($1) v", [id.base]);
    await db.exec("set timezone = 'America/New_York'");
    expect(await one<string>(db, "select public.toast_snapshot_content_md5($1) v", [id.base])).toBe(utc);
    await db.exec("reset timezone");
  });
});

describe("the cutover: registry copy, register trigger, membership FK swap", () => {
  let db: PGlite; let before: { id: Record<string, string>; runs: string[] }; let memberBefore: string;
  beforeAll(async () => {
    db = await baseSchema();
    before = await seed(db);
    memberBefore = await memberships(db);
    await db.exec(m0351);
  }, 120_000);

  it("every snapshot that existed is in the registry with its original identity and hash; no membership changed", async () => {
    expect(await one(db, "select count(*)::int v from public.toast_snapshot_registry")).toBe(await one(db, "select count(*)::int v from public.toast_orders"));
    expect(await one(db, `select count(*)::int v from public.toast_orders o join public.toast_snapshot_registry g on g.id = o.id
      where g.location_id = o.location_id and g.order_guid = o.order_guid and g.business_date = o.business_date and g.content_hash = o.content_hash
        and g.modified_at is not distinct from o.modified_at and g.payload_deleted_at is null and g.survivor_id is null`)).toBe(Object.keys(before.id).length);
    expect(await memberships(db)).toBe(memberBefore);
  });

  it("memberships reference the registry; the 0221 FK to toast_orders is gone; pointers, links and checks keep theirs", async () => {
    const fks = await one<string[]>(db, "select jsonb_agg(conrelid::regclass::text order by conrelid::regclass::text collate \"C\") v from pg_constraint where contype = 'f' and confrelid = 'public.toast_orders'::regclass");
    expect(fks).toEqual(["ezcater_toast_links", "toast_order_checks", "toast_order_latest_pointers", "toast_snapshot_registry"]);
    expect(await one(db, "select jsonb_agg(confrelid::regclass::text order by confrelid::regclass::text collate \"C\") v from pg_constraint where contype = 'f' and conrelid = 'public.toast_capture_run_orders'::regclass"))
      .toEqual(["toast_capture_pages", "toast_capture_runs", "toast_snapshot_registry"]);
  });

  it("a new snapshot registers in the writer's transaction; a recapture of a stored hash adds nothing", async () => {
    const n = await one<number>(db, "select count(*)::int v from public.toast_snapshot_registry");
    const fresh = await capture(db, [dup("fresh", "fresh1", 0)]);
    expect(await one(db, "select count(*)::int v from public.toast_snapshot_registry")).toBe(n + 1);
    expect(await one(db, "select content_hash v from public.toast_snapshot_registry where id = $1", [fresh.ids.fresh])).toBe(hash("fresh1"));
    const again = await capture(db, [dup("fresh", "fresh1", 0)]);
    expect(again.ids.fresh).toBe(fresh.ids.fresh);
    expect(await one(db, "select count(*)::int v from public.toast_snapshot_registry")).toBe(n + 1);
  });

  it("the registry is the membership's parent: a membership cannot name an unknown snapshot, and a registry row cannot go", async () => {
    const run = uuid();
    await db.query("insert into public.toast_capture_runs(id, location_id, business_date) values ($1, $2, $3)", [run, SHOP, DAY]);
    await db.query("insert into public.toast_capture_pages(run_id, page, orders, payload_hash) values ($1, 1, 1, 'x')", [run]);
    expect(await errorOf(() => db.query("insert into public.toast_capture_run_orders(run_id, snapshot_id, location_id, business_date, order_guid, page) values ($1, $2, $3, $4, 'ghost', 1)", [run, uuid(), SHOP, DAY])))
      .toMatch(/toast_capture_run_orders_snapshot_registry_fkey/);
    expect(await errorOf(() => db.query("delete from public.toast_snapshot_registry where id = $1", [before.id.dup1]))).toMatch(/violates foreign key/);
  });

  it("refuses a second apply and a changed foreign-key census by name", async () => {
    expect(await errorOf(() => db.exec(m0351))).toMatch(/0351: already applied/);
    await db.exec("rollback");
    const other = await baseSchema();
    await other.exec("create table public.toast_order_tips(snapshot_id uuid references public.toast_orders(id))");
    expect(await errorOf(() => other.exec(m0351))).toMatch(/0351: snapshot_fk_census_changed/);
    const grand = await baseSchema();
    await grand.exec("create table public.toast_check_taxes(snapshot_id uuid, check_guid text, foreign key(snapshot_id, check_guid) references public.toast_order_checks(snapshot_id, check_guid))");
    expect(await errorOf(() => grand.exec(m0351))).toMatch(/0351: snapshot_fk_census_changed/);
  });

  it("ceilings: deny-all RLS, service_role SELECT only, nobody but the owner executes a function", async () => {
    const tables = ["toast_snapshot_registry", "toast_snapshot_dedup_manifests", "toast_snapshot_dedup_days", "toast_snapshot_dedup_retained",
      "toast_snapshot_dedup_items", "toast_snapshot_dedup_batches", "toast_snapshot_dedup_runs"];
    expect((await db.query<{ t: string }>("select tablename t from pg_tables where schemaname = 'public' and tablename like 'toast\\_snapshot\\_%' order by 1")).rows.map((r) => r.t)).toEqual([...tables].sort());
    for (const t of tables) {
      expect(await one(db, "select relrowsecurity v from pg_class where oid = $1::regclass", [`public.${t}`]), t).toBe(true);
      expect(await one(db, "select jsonb_agg(policyname order by policyname) v from pg_policies where tablename = $1", [t]), t)
        .toEqual(["delete", "insert", "select", "update"].map((op) => `${t}_no_user_${op}`));
      for (const role of ["anon", "authenticated", "service_role"]) for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"])
        expect(await one(db, "select has_table_privilege($1, $2, $3) v", [role, `public.${t}`, p]), `${role} ${p} ${t}`).toBe(false);
      expect(await one(db, "select has_table_privilege('service_role', $1, 'SELECT') v", [`public.${t}`])).toBe(true);
      expect(await one(db, "select has_table_privilege('authenticated', $1, 'SELECT') or has_table_privilege('anon', $1, 'SELECT') v", [`public.${t}`])).toBe(false);
    }
    const fns = (await db.query<{ p: string }>("select oid::regprocedure::text p from pg_proc where pronamespace = 'public'::regnamespace and proname like 'toast\\_snapshot\\_%'")).rows.map((r) => r.p);
    expect(fns).toHaveLength(12);
    for (const p of fns) {
      for (const role of ["anon", "authenticated", "service_role"]) expect(await one(db, "select has_function_privilege($1, $2, 'EXECUTE') v", [role, p]), `${role} ${p}`).toBe(false);
      expect(await one(db, "select prosecdef and proconfig @> array['search_path=pg_catalog, public'] v from pg_proc where oid = $1::regprocedure", [p]), p).toBe(true);
    }
    // The payload tables keep 0221's ceiling: this file grants nothing on them.
    for (const t of PAYLOAD) expect(await one(db, "select has_table_privilege('service_role', $1, 'DELETE') v", [`public.${t}`])).toBe(false);
  });
});

describe("the manifest: who is listed, who is retained, who survives", () => {
  let db: PGlite; let id: Record<string, string>; let built: Built;
  beforeAll(async () => {
    db = await schema();
    ({ id } = await seed(db));
    built = await build(db, 1);
  }, 120_000);

  it("lists exactly the exact duplicates, each with its survivor", async () => {
    expect(await itemsOf(db, 1)).toEqual(expectedItems(id));
    expect(built.items).toBe(8);
    expect(built.batches).toBe(3);
    expect(built.totals).toEqual({ snapshots: 8, checks: 8, discounts: 16, service_charges: 0, payments: 8, by_month: { "2026-10": 8 } });
    expect(built.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never lists a pointer target, a link target, a snapshot named in a uuid column or in jsonb, an enrichment pair or an older version", async () => {
    const items = await itemsOf(db, 1);
    for (const tag of ["dup4", "lnk1", "lnk3", "np1", "np4", "ev1", "ev2", "ev3", "ev4", "ev5", "ev7", "enr1", "enr2", "edit1", "edit2", "oth2"]) expect(items[id[tag]!], tag).toBeUndefined();
    const reasons = (await db.query<{ snapshot_id: string; reason: string }>("select snapshot_id, reason from public.toast_snapshot_reference_ids()")).rows;
    const of = (tag: string) => reasons.filter((r) => r.snapshot_id === id[tag]).map((r) => r.reason).sort();
    expect(of("ev1")).toEqual(["catering_toast_links.toast_snapshot_id"]);
    expect(of("ev2")).toEqual(["fact_order_snapshot.snapshot_id"]);
    expect(of("ev5")).toEqual(["catering_toast_conflicts.toast_snapshot_id"]);
    expect(of("lnk1")).toEqual(["ezcater_toast_links.toast_snapshot_id"]);
    expect(of("dup4")).toEqual(["toast_order_latest_pointers.snapshot_id"]);
    expect((await db.query<{ snapshot_id: string; reason: string }>("select r.snapshot_id, r.reason from public.toast_snapshot_dedup_retained r order by reason")).rows)
      .toEqual([{ snapshot_id: id.ev3, reason: "audit_log.metadata" }, { snapshot_id: id.ev4, reason: "ezcater_toast_links.reconciliation_details" }]);
  });

  it("a column a LATER migration adds is covered with no change to this file", async () => {
    await db.exec("begin");
    await db.exec("create table public.catering_toast_note_lookups(id uuid primary key default gen_random_uuid(), toast_snapshot_id uuid)");
    await db.query("insert into public.catering_toast_note_lookups(toast_snapshot_id) select snapshot_id from public.toast_snapshot_dedup_items where batch = 1 limit 1");
    expect(await errorOf(() => apply(db, 1, built.digest, 1))).toMatch(/candidate_now_evidence/);
    await db.exec("rollback");
  });

  it("refusals of begin / build / finish, by name", async () => {
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_begin(2, $1)", [CUTOFF]))).toMatch(/manifest_in_progress/);
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_begin(1, $1)", [CUTOFF]))).toMatch(/manifest_version_exists/);
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_begin(0, $1)", [CUTOFF]))).toMatch(/invalid_request/);
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_build_range(1, '2026-09-01', '2026-09-02')"))).toMatch(/manifest_not_building/);
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_finish(1, 3)"))).toMatch(/manifest_not_building/);
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_build_range(9, '2026-09-01', '2026-09-02')"))).toMatch(/manifest_not_found/);
    const other = await schema();
    await seed(other);
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_begin(1, (now() at time zone 'UTC')::date - 4)"))).toMatch(/cutoff_too_recent/);
    await other.query("select public.toast_snapshot_dedup_begin(1, $1)", [CUTOFF]);
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_build_range(1, '2026-10-10', '2026-10-10')"))).toMatch(/invalid_range/);
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_build_range(1, '2026-10-30', '2026-11-02')"))).toMatch(/range_past_cutoff/);
    await other.query("select public.toast_snapshot_dedup_build_range(1, '2026-10-01', '2026-10-11')");
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_build_range(1, '2026-10-10', '2026-10-12')"))).toMatch(/range_already_built/);
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_finish(1, 3)"))).toMatch(/build_incomplete/);
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_finish(1, 0)"))).toMatch(/invalid_batch_size/);
    // Abandon, then the next version builds in three chunks: the same items and the same digest as the whole build.
    await other.query("select public.toast_snapshot_dedup_abandon(1)");
    expect(await errorOf(() => other.query("select public.toast_snapshot_dedup_abandon(1)"))).toMatch(/manifest_not_active/);
    const chunked = await build(other, 2, [["2026-10-11", "2026-10-12"], ["2026-09-01", "2026-10-10"], ["2026-10-10", "2026-10-11"], ["2026-10-12", "2026-11-01"]], 100);
    expect(chunked.items).toBe(8);
    expect(chunked.batches).toBe(1);
    expect(Object.keys(await itemsOf(other, 2))).toHaveLength(8);
    // Same fixture, same order of captures: the digests differ only because ids differ, so compare the shape instead.
    expect(await one(other, `select jsonb_agg(jsonb_build_array(d.business_date, d.snapshots, d.items) order by d.business_date) v
      from public.toast_snapshot_dedup_days d join public.toast_snapshot_dedup_manifests m on m.id = d.manifest_id where m.version = 2 and d.snapshots > 0`))
      .toEqual([["2026-10-10", 22, 7], ["2026-10-11", 2, 1]]);
  });

  it("the digest binds every item: it is stable for the same list and moves when one survivor or one md5 changes", async () => {
    const digest = (extra = "") => one<string>(db, `select encode(sha256(convert_to(string_agg(i.snapshot_id::text || '|' || i.survivor_id::text || '|' || i.content_md5 ${extra}, E'\\n' order by i.snapshot_id), 'UTF8')), 'hex') v
      from public.toast_snapshot_dedup_items i`);
    expect(await digest()).toBe(built.digest);
    expect(await digest("|| case when i.snapshot_id = (select min(snapshot_id::text)::uuid from public.toast_snapshot_dedup_items) then 'x' else '' end")).not.toBe(built.digest);
  });

  it("a build with nothing to delete ends applied, with no batch", async () => {
    const empty = await schema();
    await capture(empty, [dup("solo", "solo1", 0)]);
    const b = await build(empty, 1);
    expect(b).toMatchObject({ items: 0, batches: 0 });
    expect(await one(empty, "select status v from public.toast_snapshot_dedup_manifests where version = 1")).toBe("applied");
  });
});

describe("the apply: exactly the manifest, and every refusal leaves the database untouched", () => {
  let db: PGlite; let id: Record<string, string>; let runs: string[]; let built: Built;
  let batch1: string[];
  beforeAll(async () => {
    db = await schema();
    ({ id, runs } = await seed(db));
    built = await build(db, 1);
    batch1 = (await db.query<{ snapshot_id: string }>("select snapshot_id from public.toast_snapshot_dedup_items where batch = 1 order by 1")).rows.map((r) => r.snapshot_id);
  }, 120_000);
  const tagOf = (snapshot: string) => Object.keys(id).find((k) => id[k] === snapshot)!;
  const survivorOf = (snapshot: string) => expectedItems(id)[snapshot]!;
  const guidOf = (snapshot: string) => one<string>(db, "select order_guid v from public.toast_snapshot_registry where id = $1", [snapshot]);
  const dateOf = (snapshot: string) => one<string>(db, "select business_date::text v from public.toast_snapshot_registry where id = $1", [snapshot]);

  /** Runs `mutate`, expects the apply of batch 1 to refuse with `name`, proves nothing was deleted, then rolls back. */
  async function refuses(name: string, mutate: (candidate: string) => Promise<unknown>, call?: () => Promise<unknown>) {
    await db.exec("begin");
    try {
      await mutate(batch1[0]!);
      const before = await counts(db);
      await db.exec("savepoint s");
      const error = await errorOf(call ?? (() => apply(db, 1, built.digest, 1)));
      await db.exec("rollback to savepoint s");
      expect(error, name).toContain(name);
      expect(await counts(db)).toEqual(before);
    } finally { await db.exec("rollback"); }
  }

  it.each<[string, (c: string) => Promise<unknown>]>([
    ["candidate_now_target", (c) => db.query(`update public.toast_order_latest_pointers p set snapshot_id = g.id
      from public.toast_snapshot_registry g where g.id = $1 and p.location_id = g.location_id and p.order_guid = g.order_guid`, [c])],
    ["candidate_now_linked", (c) => db.query(`insert into public.ezcater_toast_links(order_id, snapshot_id, location_id, toast_snapshot_id, order_guid, check_guid, selection_guid, business_date, evidence)
      values ($1, $2, $3, $4, 'x', 'c9', '', $5, 'normalized_code')`, [uuid(), uuid(), SHOP, c, DAY])],
    ["candidate_now_survivor", async (c) => {
      const manifest = await one<string>(db, "select id v from public.toast_snapshot_dedup_manifests where version = 1");
      await db.query(`update public.toast_snapshot_registry set payload_deleted_at = now(), survivor_id = $1, content_md5 = 'x', manifest_id = $2
        where id = (select g.id from public.toast_snapshot_registry g, public.toast_snapshot_registry me where me.id = $1 and g.id <> me.id
                      and g.location_id = me.location_id and g.business_date = me.business_date
                      and g.id not in (select snapshot_id from public.toast_snapshot_dedup_items) order by g.id limit 1)`, [c, manifest]);
    }],
    ["candidate_now_evidence", (c) => db.query("insert into public.fact_order_snapshot(location_id, business_date, order_guid, snapshot_id, run_member, check_count) values ($1, $2, 'zz', $3, true, 1)", [SHOP, DAY, c])],
    ["candidate_now_evidence", async (c) => (await db.exec("alter table public.fact_refund disable trigger all"), db.query("insert into public.fact_refund(location_id, order_business_date, order_guid, payment_guid, check_guid, snapshot_id, check_accounting_present, order_voided, order_deleted, check_voided, check_deleted, excess_food) values ($1, $2, 'evidence', 'p1', 'c1', $3, false, false, false, false, false, false)", [SHOP, DAY, c]))],
    ["candidate_now_evidence", (c) => db.query("insert into public.catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence) values ($1, $2, 'zz', 'c1', $3, 'ring_code')", [uuid(), SHOP, c])],
    ["candidate_now_evidence", (c) => db.query("insert into public.catering_toast_conflicts(location_id, order_guid, check_guid, kind, ezcater_order_id, toast_snapshot_id) values ($1, 'zz', 'c1', 'dual_code', $2, $3)", [SHOP, uuid(), c])],
    ["candidate_now_evidence", (c) => db.query("insert into public.audit_log(action, resource_table, metadata) values ('ezcater.toast_reconciled', 'ezcater_toast_links', $1::jsonb)", [JSON.stringify({ note: `saw ${c}` })])],
    ["candidate_now_evidence", (c) => db.query("update public.ezcater_toast_links set reconciliation_details = $1::jsonb", [JSON.stringify({ old: c })])],
    ["candidate_now_evidence", (c) => db.query("insert into public.toast_capture_reconciliations(location_id, business_date, run_id, status, mismatched_items) values ($1, $2, $3, 'skipped', $4::jsonb)", [SHOP, DAY, runs[0], JSON.stringify([{ snapshot: c }])])],
    ["candidate_in_running_run", async (c) => capture(db, [{ ...dup(await guidOf(c), tagOf(c), 0), date: await dateOf(c) }], { finish: false, date: await dateOf(c) })],
    ["candidate_order_recently_captured", async (c) => capture(db, [{ ...dup(await guidOf(c), tagOf(survivorOf(c)), 1), date: await dateOf(c) }], { date: await dateOf(c) })],
    ["candidate_order_recently_captured", (c) => db.query("update public.toast_capture_runs set finished_at = clock_timestamp() where id in (select run_id from public.toast_capture_run_orders where snapshot_id = $1)", [c])],
    ["content_changed", (c) => db.query("update public.toast_order_checks set amount_cents = 1 where snapshot_id = $1", [c])],
    ["content_changed", (c) => db.query("update public.toast_orders set selection_units = '[]'::jsonb where id = $1", [c])],
    ["content_not_equal", (c) => db.query("update public.toast_payments set payment_status = 'AUTHORIZED' where snapshot_id = $1", [survivorOf(c)])],
    ["candidate_missing", async (c) => {
      for (const t of ["toast_check_discounts", "toast_payments", "toast_order_checks"]) await db.query(`delete from public.${t} where snapshot_id = $1`, [c]);
      await db.query("delete from public.toast_orders where id = $1", [c]);
    }],
    ["snapshot_fk_census_changed", () => db.exec("create table public.toast_order_tips(snapshot_id uuid references public.toast_orders(id))")],
    ["snapshot_fk_census_changed", () => db.exec("create table public.toast_check_taxes(snapshot_id uuid, check_guid text, foreign key(snapshot_id, check_guid) references public.toast_order_checks(snapshot_id, check_guid))")],
    ["manifest_count_mismatch", () => db.query("update public.toast_snapshot_dedup_batches set payments = payments + 1 where batch = 1")],
    ["manifest_count_mismatch", (c) => db.query("update public.toast_snapshot_dedup_items set batch = 2 where snapshot_id = $1", [c])],
  ])("refuses %s", async (name, mutate) => {
    await refuses(name, mutate);
  });

  it("refuses a wrong digest, wrong totals, a batch out of order, an unknown batch or manifest", async () => {
    const none = async () => undefined;
    await refuses("digest_mismatch", none, () => apply(db, 1, "0".repeat(64), 1));
    await refuses("digest_mismatch", none, () => db.query("select public.toast_snapshot_dedup_apply(1, null, 1, '{}'::jsonb)"));
    const good = await expectedOf(db, 1, 1);
    for (const key of Object.keys(good)) await refuses("expected_mismatch", none, () => apply(db, 1, built.digest, 1, { ...good, [key]: good[key]! + 1 }));
    await refuses("expected_mismatch", none, () => db.query("select public.toast_snapshot_dedup_apply(1, $1, 1, null)", [built.digest]));
    await refuses("batch_out_of_order", none, () => apply(db, 1, built.digest, 2));
    await refuses("batch_not_found", none, () => apply(db, 1, built.digest, 9, good));
    await refuses("manifest_not_found", none, () => apply(db, 7, built.digest, 1, good));
  });

  it("refuses any isolation level but READ COMMITTED: a frozen snapshot would not see a reference committed before the guard", async () => {
    for (const level of ["repeatable read", "serializable"]) {
      await db.exec(`begin isolation level ${level}`);
      try {
        const before = await counts(db);
        await db.exec("savepoint s");
        const error = await errorOf(() => apply(db, 1, built.digest, 1));
        await db.exec("rollback to savepoint s");
        expect(error, level).toContain("isolation_not_read_committed");
        expect(await counts(db)).toEqual(before);
      } finally { await db.exec("rollback"); }
    }
  });

  it("refuses when the survivor's payload is gone (only reachable for a survivor nothing else protects)", async () => {
    const np = (await db.query<{ snapshot_id: string; batch: number }>("select snapshot_id, batch from public.toast_snapshot_dedup_items where survivor_id = $1 order by batch limit 1", [id.np1])).rows[0]!;
    await db.exec("begin");
    try {
      await db.query("update public.toast_snapshot_dedup_items set batch = case when snapshot_id = $1 then 1 else 2 end", [np.snapshot_id]);
      await db.query("delete from public.toast_snapshot_dedup_batches where batch > 1");
      await db.query("update public.toast_snapshot_dedup_batches set snapshots = 1, checks = 1, discounts = 2, service_charges = 0, payments = 1");
      for (const t of ["toast_check_discounts", "toast_payments", "toast_order_checks"]) await db.query(`delete from public.${t} where snapshot_id = $1`, [id.np1]);
      await db.query("delete from public.toast_orders where id = $1", [id.np1]);
      expect(await errorOf(() => apply(db, 1, built.digest, 1))).toContain("survivor_missing");
    } finally { await db.exec("rollback"); }
  });

  it("deletes exactly the manifest, batch by batch: children with their parents, memberships untouched, one audit row each", async () => {
    const before = await counts(db), membersBefore = await memberships(db);
    const pointersBefore = await one<string>(db, "select md5(string_agg(to_jsonb(p)::text, ',' order by location_id, order_guid)) v from public.toast_order_latest_pointers p");
    const kept = async () => Object.fromEntries(await Promise.all(Object.entries(id).filter(([, v]) => !(v in expectedItems(id))).map(async ([k, v]) => [k, await content(db, v)])));
    const keptBefore = await kept();
    const results: Record<string, unknown>[] = [];
    for (let batch = 1; batch <= built.batches; batch++) {
      results.push(await apply(db, 1, built.digest, batch));
      if (batch < built.batches) expect(await errorOf(() => apply(db, 1, built.digest, batch))).toContain("batch_already_applied");
      expect(await one<boolean>(db, "select (public.toast_snapshot_dedup_verify(1)->>'ok')::boolean v"), `verify after batch ${batch}`).toBe(true);
    }
    expect(results.map((r) => r.status)).toEqual(["applying", "applying", "applied"]);
    const after = await counts(db);
    expect(after).toEqual({ ...before, toast_orders: before.toast_orders! - 8, toast_order_checks: before.toast_order_checks! - 8,
      toast_check_discounts: before.toast_check_discounts! - 16, toast_payments: before.toast_payments! - 8, audit_log: before.audit_log! + 3 });
    // Gone: every listed snapshot and all its children. Kept: everything else, byte for byte.
    for (const t of PAYLOAD) expect(await one(db, `select count(*)::int v from public.${t} where ${t === "toast_orders" ? "id" : "snapshot_id"} = any($1::uuid[])`, [Object.keys(expectedItems(id))]), t).toBe(0);
    expect(await kept()).toEqual(keptBefore);
    expect(await memberships(db)).toBe(membersBefore);
    expect(await one(db, "select md5(string_agg(to_jsonb(p)::text, ',' order by location_id, order_guid)) v from public.toast_order_latest_pointers p")).toBe(pointersBefore);
    // The readers' guard: every completed run still has runs.orders memberships.
    expect(await one(db, "select count(*)::int v from public.toast_capture_runs r where r.status = 'completed' and r.orders <> (select count(*) from public.toast_capture_run_orders ro where ro.run_id = r.id)")).toBe(0);
    // Identity: the registry row of each deleted snapshot names its survivor, the manifest and the content.
    const stamped = (await db.query<{ id: string; survivor_id: string; content_hash: string }>("select id, survivor_id, content_hash from public.toast_snapshot_registry where payload_deleted_at is not null")).rows;
    expect(Object.fromEntries(stamped.map((r) => [r.id, r.survivor_id]))).toEqual(expectedItems(id));
    for (const r of stamped) expect(r.content_hash).toBe(hash(tagOf(r.id)));
    // Audit: one destructive row per batch, no snapshot id inside.
    const audit = (await db.query<{ action: string; destructive: boolean; resource_table: string; metadata: Record<string, unknown> }>(
      "select action, destructive, resource_table, metadata from public.audit_log where action = 'toast.snapshot_dedup' order by (metadata->>'batch')::int")).rows;
    expect(audit.map((a) => [a.action, a.destructive, a.resource_table, a.metadata.actor_context, a.metadata.batch, a.metadata.digest]))
      .toEqual([1, 2, 3].map((b) => ["toast.snapshot_dedup", true, "toast_snapshot_dedup_manifests", "migration_apply", b, built.digest]));
    expect((audit[0]!.metadata.counts as Record<string, number>).snapshots).toBe(3);
    for (const a of audit) for (const snapshot of Object.values(id)) expect(JSON.stringify(a.metadata)).not.toContain(snapshot);
    const verify = await one<{ ok: boolean; checks: Record<string, { ok: boolean }> }>(db, "select public.toast_snapshot_dedup_verify(1) v");
    expect(Object.fromEntries(Object.entries(verify.checks).map(([k, v]) => [k, v.ok]))).toEqual({ identity: true, memberships: true, payload: true, survivors: true, targets: true, audit: true });
  });

  it("an applied batch cannot be applied again, and an applied manifest takes no more", async () => {
    expect(await errorOf(() => apply(db, 1, built.digest, 1))).toMatch(/manifest_not_built/);
    expect(await errorOf(() => db.query("select public.toast_snapshot_dedup_abandon(1)"))).toMatch(/manifest_not_active/);
  });

  it("a survivor can never be deleted, by anyone: the registry's foreign key holds it", async () => {
    await db.exec("begin");
    for (const t of ["toast_check_discounts", "toast_payments", "toast_order_checks"]) await db.query(`delete from public.${t} where snapshot_id = $1`, [id.np1]);
    expect(await errorOf(() => db.query("delete from public.toast_orders where id = $1", [id.np1]))).toMatch(/toast_snapshot_registry_survivor_id/);
    await db.exec("rollback");
  });

  it("a hash whose payload was deleted, captured again, is a NEW snapshot with its own registry row", async () => {
    const again = await capture(db, [dup("dup", "dup1", 0)]);
    expect(again.ids.dup).not.toBe(id.dup1);
    expect(await one(db, "select count(*)::int v from public.toast_snapshot_registry where content_hash = $1", [hash("dup1")])).toBe(2);
    expect(await one(db, "select payload_deleted_at is null v from public.toast_snapshot_registry where id = $1", [again.ids.dup])).toBe(true);
    id.dup1b = again.ids.dup!;
  });

  it("the next manifest never lists an earlier survivor, even when a retained twin of it appears (Astra r4 P2 #4)", async () => {
    // np1 survived manifest 1 with no other protection. A later capture stores an equal twin that a fact row names.
    const twin = await capture(db, [dup("nopointer", "np9", 1)]);
    expect(twin.ids.nopointer).not.toBe(id.np1);
    await db.query("insert into public.fact_order_snapshot(location_id, business_date, order_guid, snapshot_id, run_member, check_count) values ($1, $2, 'np-twin', $3, true, 1)", [SHOP, DAY, twin.ids.nopointer]);
    const second = await build(db, 2);
    const items = await itemsOf(db, 2);
    expect(items[id.np1!]).toBeUndefined();
    // dup1 captured again above: dup4 (the pointer moved to the recapture? no: same modified_at, later run) -- whatever
    // the pointer is, only a non-retained, non-survivor twin is listed.
    for (const [snapshot, survivor] of Object.entries(items)) {
      expect(await one(db, "select exists(select 1 from public.toast_snapshot_reference_ids() f where f.snapshot_id = $1) v", [snapshot])).toBe(false);
      expect(await content(db, snapshot)).toEqual(await content(db, survivor));
    }
    for (let batch = 1; batch <= second.batches; batch++) await apply(db, 2, second.digest, batch);
    expect(await one<boolean>(db, "select (public.toast_snapshot_dedup_verify(2)->>'ok')::boolean v")).toBe(true);
    expect(await one<boolean>(db, "select (public.toast_snapshot_dedup_verify(1)->'checks'->'survivors'->>'ok')::boolean v")).toBe(true);
  });
});

describe("verify: each check turns false under a planted fault", () => {
  let db: PGlite; let id: Record<string, string>; let built: Built;
  beforeAll(async () => {
    db = await schema();
    ({ id } = await seed(db));
    built = await build(db, 1, undefined, 100);
  }, 120_000);
  const checks = async () => {
    const v = await one<{ ok: boolean; checks: Record<string, { ok: boolean }> }>(db, "select public.toast_snapshot_dedup_verify(1) v");
    return { ok: v.ok, failed: Object.entries(v.checks).filter(([, c]) => !c.ok).map(([k]) => k).sort() };
  };
  const planted = async (fault: () => Promise<unknown>) => {
    await db.exec("begin");
    try { await fault(); return await checks(); } finally { await db.exec("rollback"); }
  };

  it("a run that was still running at begin may grow; a finished run may not change (Astra r4 P2 #3)", async () => {
    const other = await schema();
    await seed(other);
    const open = uuid();
    await other.query("insert into public.toast_capture_runs(id, location_id, business_date) values ($1, $2, '2026-11-18')", [open, SHOP]);
    const page = (pageNo: number, guid: string) => other.query("select public.toast_capture_page($1, $2, '2026-11-18', $3, $4::jsonb)", [open, SHOP, pageNo,
      JSON.stringify([{ content_hash: hash(guid), order: { order_guid: guid, business_date: "2026-11-18", modified_at: null, deleted: false, voided: false, excess_food: false }, checks: [], discounts: [], service_charges: [], payments: [] }])]);
    await page(1, "late-a");
    const b = await build(other, 1, undefined, 100);
    await page(2, "late-b");
    await apply(other, 1, b.digest, 1);
    const v = await one<{ ok: boolean; checks: { memberships: Record<string, unknown> } }>(other, "select public.toast_snapshot_dedup_verify(1) v");
    expect(v.checks.memberships).toMatchObject({ ok: true, runs_with_fewer_memberships: 0, finished_runs_changed: 0 });
    expect(v.ok).toBe(true);
  });

  it("clean before the apply and after it", async () => {
    expect(await checks()).toEqual({ ok: true, failed: [] });
    await apply(db, 1, built.digest, 1);
    expect(await checks()).toEqual({ ok: true, failed: [] });
  });

  it("names the broken check", async () => {
    expect(await planted(() => db.query("delete from public.toast_capture_run_orders where snapshot_id = $1", [id.dup1]))).toEqual({ ok: false, failed: ["memberships"] });
    expect(await planted(() => db.query("update public.toast_order_checks set amount_cents = 2 where snapshot_id = $1", [id.dup4]))).toEqual({ ok: false, failed: ["survivors"] });
    expect(await planted(() => db.query("delete from public.audit_log where action = 'toast.snapshot_dedup'"))).toEqual({ ok: false, failed: ["audit"] });
    expect(await planted(() => db.query("update public.toast_snapshot_dedup_items set applied_at = null where snapshot_id = $1", [id.dup1]))).toEqual({ ok: false, failed: ["payload"] });
    expect(await planted(async () => {
      await db.exec("alter table public.toast_snapshot_registry disable trigger all; alter table public.toast_capture_run_orders disable trigger all");
      await db.query("delete from public.toast_snapshot_registry where id = $1", [id.enr1]);
    })).toEqual({ ok: false, failed: ["identity"] });
    expect(await planted(async () => {
      await db.exec("alter table public.toast_order_latest_pointers disable trigger all; alter table public.toast_orders disable trigger all; alter table public.toast_order_checks disable trigger all");
      await db.query("delete from public.toast_orders where id = $1", [id.edit2]);
    })).toMatchObject({ ok: false, failed: expect.arrayContaining(["targets"]) });
  });
});
