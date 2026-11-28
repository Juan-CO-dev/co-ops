/**
 * Catering refunds Part B1 flow tests — a synthetic world on the REAL 0357 -> 0358 -> 0359 (PGlite, see
 * tests/helpers/refund-pglite.ts) wired to the in-memory Stripe fake (tests/helpers/refund-flow-stripe.ts).
 * SYNTHETIC ROWS ONLY. No network.
 */
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

import type { AuthContext } from "@/lib/session";
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { harnessKit, harnessLib, type KitWorld } from "./refund-pglite";
import { FlowStripe } from "./refund-flow-stripe";

export const KEY_A = "sk_test_flow_shop_A";
export const KEY_ROTATED = "sk_test_flow_shop_A_rotated";
export const KEY_SHARED = "sk_test_flow_shared";
export const ACCT_A = "acct_flow_shop";
export const ACCT_SHARED = "acct_flow_shared";

export type Account = { secretKey: string; webhookSecret: string; source: "location" | "default" };
export const account = (secretKey: string, source: "location" | "default" = "location"): Account => ({ secretKey, webhookSecret: "whsec_flow_fake", source });

/** A signed-in person whose session row EXISTS in the database (the SQL checks the session's user). */
export async function actorFor(w: KitWorld, role: RoleCode, opts: { locations?: string[]; member?: string | null; fresh?: boolean } = {}): Promise<AuthContext> {
  const member = opts.member === undefined ? (["owner", "cgs"].includes(role) ? null : w.shop) : opts.member;
  const id = await w.user(role, { member });
  const sessionId = await w.session(id, { fresh: opts.fresh ?? false });
  const locations = opts.locations ?? (member ? [member] : []);
  return {
    user: { id, role, active: true, language: "en", name: "Flow Tester" },
    session: { id: sessionId, stepUpUnlocked: opts.fresh ?? false, stepUpUnlockedAt: opts.fresh ? new Date().toISOString() : null },
    role,
    level: getRoleLevel(role),
    locations,
  } as unknown as AuthContext;
}

/**
 * The PGlite base (scripts/sql-harness-0359-lib.mjs) creates the pre-0357 tables as the fixture owner and grants
 * `service_role` NOTHING on them, while on Supabase `service_role` holds the default table privileges on every
 * ordinary public table. Without this the app's own first read (`catering_quotes`) is a 42501 here and never in
 * production. Granted ONLY on the tables the refund migrations do not govern; 0357 / 0359's own tables keep exactly
 * the privileges those migrations left (reported to the lead: the helper's "exactly the app's privileges" claim needs it).
 */
export const APP_TABLES = ["audit_log", "catering_customers", "catering_delivery_zones", "catering_payments", "catering_pipeline", "catering_quotes",
  "locations", "sessions", "stripe_events", "user_locations", "users"] as const;
export async function grantAppTables(db: PGlite): Promise<PGlite> {
  await db.exec(`grant select, insert, update on ${APP_TABLES.map((t) => `public.${t}`).join(", ")} to service_role;
    grant usage on all sequences in schema public to service_role;`);
  return db;
}

export interface Flow {
  db: PGlite;
  w: KitWorld;
  stripe: FlowStripe;
  quote: string;
  pay: { id: string; pi: string };
}

/** One shop, one accepted quote with a $300 deposit paid through Stripe, the fake charge in the shop's account. */
export async function flowWorld(db: PGlite, opts: { captured?: number; live?: boolean; amount?: number } = {}): Promise<Flow> {
  const w = await harnessKit.world(db);
  const stripe = new FlowStripe().account(KEY_A, ACCT_A).account(KEY_ROTATED, ACCT_A).account(KEY_SHARED, ACCT_SHARED);
  const quote = await w.quote();
  const pay = await w.pay(quote, "deposit", opts.amount ?? 30000);
  stripe.charge(pay.pi, { account: ACCT_A, captured: opts.captured ?? 30000 });
  if (opts.live !== false) await harnessKit.goLive(db);
  return { db, w, stripe, quote, pay };
}

export const req = (db: PGlite, id: string) => harnessLib.one(db, "select * from public.catering_refund_requests where id = $1", [id]);
export const reqs = (db: PGlite) => harnessLib.rows(db, "select * from public.catering_refund_requests order by requested_at, id");
export const openIssues = (db: PGlite, payment?: string) =>
  harnessLib.rows(db, `select code, state, blocking, request_id, refund_id, event_id, detail from public.catering_refund_issues
    where state <> 'resolved' ${payment ? "and payment_id = $1" : ""} order by opened_at, code`, payment ? [payment] : []);
export const work = (db: PGlite, payment: string) => harnessLib.one(db, "select * from public.catering_refund_payment_work where payment_id = $1", [payment]);
export const rpcNames = (calls: Array<{ kind: string; name: string }>) => calls.filter((c) => c.kind === "rpc").map((c) => c.name);
export const writes = (calls: Array<{ kind: string; name: string }>) => calls.filter((c) => c.kind === "insert" || c.kind === "update" || c.kind === "delete");
