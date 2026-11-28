/**
 * Catering refunds Part B1 v2 — the flow tests' shared world (tests/catering-refunds-flow.test.ts,
 * tests/catering-refund-sends-nothing.test.ts). The REAL 0357 -> 0358 -> 0359 in PGlite (tests/helpers/refund-pglite.ts)
 * under the REAL lib, with Stripe as the HTTP fake (tests/stripe-http-fake.ts). SYNTHETIC ROWS AND FAKE KEYS ONLY.
 *
 * One database per describe (a fresh PGlite costs seconds): every test makes its own order (quote + payments) in it,
 * so tests share the database but never a row. Time moves with the kit's `elapse()` only.
 */
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

import type { AuthContext } from "@/lib/session";
import { harnessKit as kit, harnessLib as lib, refundDb, withDb, type KitPayment, type KitWorld } from "./refund-pglite";

/** Fake keys (never real). The shop's own slot (`STRIPE_SECRET_KEY__S1`) and the shared one. */
export const KEY_LOC = "sk_test_fake_refund_flow_location_S1";
export const KEY_LOC_ROTATED = "sk_test_fake_refund_flow_location_S1_rotated";
export const KEY_DEF = "sk_test_fake_refund_flow_default";

/** main's five tables (the harness's `MAINS`): B1 never writes them. */
export const MAIN_TABLES = ["catering_payments", "catering_payment_refund_events", "stripe_events", "users", "cron_route_leases"] as const;

export interface FlowDb {
  db: PGlite;
  w: KitWorld;
  /** Staff ids (synthetic): two refund-role people and a release-role person at the shop, and an owner. */
  gm: string;
  gm2: string;
  moo: string;
  owner: string;
}

/** A database with the REAL SQL, the B2 / B3 readiness fixture, one shop and its staff, observation ON and live. */
export async function flowDb(): Promise<FlowDb> {
  const db = await refundDb({ partsReady: true });
  const w = await kit.world(db);
  const gm = await w.user("gm");
  const gm2 = await w.user("gm");
  const moo = await w.user("moo");
  const owner = await w.user("owner", { member: null });
  await kit.observing(db);
  return { db, w, gm, gm2, moo, owner };
}

/** The signed-in person the lib sees (the session object the routes pass). */
export function actorOf(id: string, role: string, locations: string[]): AuthContext {
  return {
    user: { id, role, active: true, language: "en", name: "Flow Tester" },
    locations,
    session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() },
  } as unknown as AuthContext;
}

/**
 * Make observation LIVE now, with nothing about it still settling: 6 minutes pass (any 330-second lease runs out),
 * the sweep's claim is made (no GET: the fixture owner calls F13 directly), and when that claim RESUMED (the last one
 * was 60 minutes old or more, so every payment was stamped dirty) another 6 minutes pass. Call it only while no lib
 * call is in flight (or inside `withDb`).
 */
export async function live(db: PGlite, elapse: (interval: string) => Promise<void> = (i) => kit.elapse(db, i)): Promise<void> {
  await elapse("6 minutes");
  const claim = (await kit.rpc(db, "catering_refund_sweep_begin", [1])) as { claimed?: boolean; resumed?: boolean };
  if (claim?.claimed !== true) throw new Error(`refund-flow-kit: live() could not claim (${JSON.stringify(claim)})`);
  if (claim.resumed) await elapse("6 minutes");
}

/** "6 minutes", "24 hours 1 minute", "61 minutes" -> seconds (the intervals these tests pass to `elapse`). */
export function secondsOf(interval: string): number {
  let s = 0;
  for (const m of interval.matchAll(/(\d+)\s*(second|minute|hour|day)s?/g)) {
    s += Number(m[1]) * ({ second: 1, minute: 60, hour: 3600, day: 86400 } as const)[m[2] as "second" | "minute" | "hour" | "day"];
  }
  if (s === 0) throw new Error(`refund-flow-kit: unsupported interval ${interval}`);
  return s;
}

/**
 * The kit's `elapse()` moves every instant the DATABASE holds; Stripe's own clock (`created`, whole seconds) lives in
 * the fake. Both must move together, or after a time travel every refund looks created LATER than it was (relative to
 * an arm the database moved back), which no real clock does. This moves the fake's `created` back by the same amount.
 */
export async function elapseBoth(db: PGlite, refunds: Array<{ created: number }>, interval: string): Promise<void> {
  await kit.elapse(db, interval);
  const s = secondsOf(interval);
  for (const r of refunds) r.created -= s;
}

/**
 * A row digest of each of main's five tables. `stripe_events.received_at` is left out: `elapse()` moves it (that is
 * the harness's time travel, not a write); every other column of every row is in.
 */
export async function mainDigest(db: PGlite): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of MAIN_TABLES) {
    const cols = t === "stripe_events" ? "id, type, livemode, payload" : "*";
    const r = await lib.one(db, `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as d from (select ${cols} from public.${t}) x`);
    out[t] = String(r.d);
  }
  return out;
}

/** Run fixture-owner work under the client's mutex (safe while a lib call is in flight). */
export const owned = <T>(db: PGlite, fn: () => Promise<T>) => withDb(db, fn);

export const requestRow = (db: PGlite, id: string) => kit.requestRow(db, id);
export const requestsOf = (db: PGlite, paymentId: string) =>
  lib.rows(db, "select * from public.catering_refund_requests where payment_id = $1 order by requested_at, id", [paymentId]) as Promise<Array<Record<string, any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const auditOf = (db: PGlite, requestId: string) =>
  lib.rows(db, "select action, destructive, metadata from public.audit_log where resource_id = $1 order by id", [requestId]);
export const claimsOf = (db: PGlite, paymentId: string) =>
  lib.rows(db, "select * from public.catering_refund_claims($1) order by refund_id", [paymentId]) as Promise<Array<{ refund_id: string; kind: string; attachable_to: string | null }>>;
export const inventory = async (db: PGlite) => (await kit.rpc(db, "catering_refund_inventory", [])) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The arm instant as epoch seconds (microsecond precision), or null when the row is not armed. */
export async function armedEpoch(db: PGlite, requestId: string): Promise<number | null> {
  const r = await lib.one(db, "select extract(epoch from create_armed_at)::float8 as e from public.catering_refund_requests where id = $1", [requestId]);
  return r?.e == null ? null : Number(r.e);
}

export type { KitPayment };
