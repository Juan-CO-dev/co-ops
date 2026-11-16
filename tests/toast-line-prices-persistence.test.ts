// Item 1 PR B (phase 1): no migration. The REAL 0221 tables, the REAL 0239 accounting CHECK and the
// REAL 0239 toast_capture_page snapshot + check inserts (extracted from the migration files) run in
// PGlite against switch-ON capture output: line prices are accepted as they are, and an order already
// captured with the switch OFF reuses its snapshot (on conflict … do nothing) — no new row, no new checks.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import corpus from "./fixtures/toast/line-price-corpus.json";
import { normalizeToastOrder } from "@/lib/toast/capture-shared";
import { toastContentHash } from "@/lib/toast/content-hash";

const m0221 = readFileSync("supabase/migrations/0221_toast_order_capture.sql", "utf8");
const m0239 = readFileSync("supabase/migrations/0239_sales_true_net.sql", "utf8");
const block = (sql: string, start: string) => { const i = sql.indexOf(start); expect(i).toBeGreaterThan(-1); return sql.slice(i, sql.indexOf(");\n", i) + 2); };
const line = (sql: string, start: string) => { const l = sql.split("\n").find((x) => x.trim().startsWith(start)); expect(l).toBeTruthy(); return l!.trim(); };

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  const orders = block(m0221, "create table public.toast_orders (").replace(" references public.locations(id)", "");
  const checks = block(m0221, "create table public.toast_order_checks (");
  const accounting = /alter table public\.toast_order_checks add column accounting jsonb\s+check \(([\s\S]*?)\);\n/.exec(m0239)![0];
  const insertOrder = [line(m0239, "insert into public.toast_orders("), line(m0239, "values(p_location_id,v_order->>'order_guid'"), line(m0239, "on conflict(location_id,order_guid,content_hash) do nothing")].join("\n");
  const reuse = line(m0239, "if not v_new then select id into strict v_snapshot from public.toast_orders");
  const insertChecks = line(m0239, "insert into public.toast_order_checks(snapshot_id,check_guid,amount_cents,tax_cents,total_cents,voided,deleted,accounting)");
  await db.exec(`create schema if not exists public; ${orders} ${checks} ${accounting}
    create function public.capture_one(p_location_id uuid, p_business_date date, v_entry jsonb) returns boolean language plpgsql as $$
    declare v_order jsonb := v_entry->'order'; v_snapshot uuid; v_new boolean;
    begin
      ${insertOrder}
      v_new := v_snapshot is not null;
      ${reuse}
      if v_new then ${insertChecks} end if;
      return v_new;
    end $$;`);
}, 120_000);

const shop = "00000000-0000-4000-8000-000000000001";
const entry = (raw: unknown, linePrices: boolean) => {
  const order = normalizeToastOrder(raw, "2026-10-08", { linePrices });
  return { ...order, content_hash: toastContentHash(order) };
};
const capture = async (e: unknown) => (await db.query<{ capture_one: boolean }>("select public.capture_one($1, '2026-10-08', $2::jsonb)", [shop, JSON.stringify(e)])).rows[0]!.capture_one;
const count = async (table: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0]!.n);

describe("no migration: 0239 stores switch-ON output unchanged", () => {
  it("an unchanged order captured OFF then ON keeps ONE snapshot and its original checks", async () => {
    for (const raw of corpus.valid) expect(await capture(entry(raw, false))).toBe(true);
    const [orders, checks] = [await count("toast_orders"), await count("toast_order_checks")];
    for (const raw of corpus.valid) expect(await capture(entry(raw, true))).toBe(false);
    expect([await count("toast_orders"), await count("toast_order_checks")]).toEqual([orders, checks]);
    const stored = await db.query<{ n: number }>("select count(*)::int as n from public.toast_order_checks where accounting ? 'line_prices'");
    expect(stored.rows[0]!.n).toBe(0);
  });
  it("a genuinely new order captured ON stores line_prices under the version='1' CHECK and price fields in selection_units", async () => {
    const raw = { ...corpus.valid[0], guid: "lp-brand-new" };
    expect(await capture(entry(raw, true))).toBe(true);
    const row = await db.query<{ accounting: { version: number; line_prices: { net_complete: boolean } }; units: { price_v: number; net_cents: number }[] }>(
      `select c.accounting, o.selection_units as units from public.toast_order_checks c join public.toast_orders o on o.id = c.snapshot_id where o.order_guid = 'lp-brand-new'`);
    expect(row.rows[0]!.accounting).toMatchObject({ version: 1, line_prices: { net_complete: true } });
    expect(row.rows[0]!.units[0]).toMatchObject({ price_v: 1, net_cents: 2400 });
  });
  it("the CHECK still refuses an accounting without version '1' (the harness is live, not vacuous)", async () => {
    const bad = entry({ ...corpus.valid[0], guid: "lp-bad-version" }, true);
    (bad.checks[0]!.accounting as { version: number }).version = 2;
    await expect(capture(bad)).rejects.toThrow(/check constraint/);
  });
});
