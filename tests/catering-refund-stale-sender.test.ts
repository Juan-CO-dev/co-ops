/**
 * Catering refunds Part B1 — THE STALE SENDER. During the rollout an old deployment (main @ 9ce98df5) may still be
 * serving while 0359 is applied. This runs MAIN'S OWN `requestRefund` and `retryRefundRequest` (the frozen copy in
 * tests/fixtures/main-9ce98df5/lib/catering/refunds.ts) as `service_role` against the REAL 0359 (PGlite), on a
 * PREEXISTING pending row reserved through 0357's own function BEFORE 0359 was applied, with a fake Stripe that counts
 * every call. Synthetic rows only; no network.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

import { refundClient, harnessKit, harnessLib, type RefundClientOpts } from "./helpers/refund-pglite";
import { grantAppTables, actorFor } from "./helpers/refund-flow-world";

const h = vi.hoisted(() => ({
  client: null as unknown,
  gets: 0,
  posts: 0,
  audits: [] as Array<{ action: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (a: { action: string }) => void h.audits.push(a)) }));
vi.mock("@/lib/stripe/session-owner", () => ({ stripeAccountsForShop: () => [{ secretKey: "sk_test_stale_fake", webhookSecret: "whsec_fake", source: "location" }] }));
vi.mock("@/lib/stripe/client", async (orig) => {
  const real = await orig<typeof import("@/lib/stripe/client")>();
  // Main's four Stripe calls. Any of them would be a provider call; the create is the one that moves money.
  return {
    ...real,
    retrievePaymentIntentCharge: async () => (h.gets++, { status: "found", amountCapturedCents: 30000, amountRefundedCents: 0 }),
    listRefundsForPaymentIntent: async () => (h.gets++, []),
    retrieveRefund: async (_k: string, id: string) => (h.gets++, { id, status: "succeeded", amountCents: 10000, requestId: null }),
    createRefund: async (_k: string, input: { amountCents: number; metadata: { refund_request_id: string } }) =>
      (h.posts++, { id: "re_stale_should_never_exist", status: "succeeded", amountCents: input.amountCents, requestId: input.metadata.refund_request_id }),
  };
});

import * as main from "./fixtures/main-9ce98df5/lib/catering/refunds";

let BUILT: PGlite;
let fixture: { quote: string; payment: string; request: string };
beforeAll(async () => {
  // 0357 -> 0358 ONLY: main's world. The row is reserved by 0357's own function (as main's Confirm made it).
  const db = await harnessLib.base({ upTo: "0358" });
  const w = await harnessKit.world(db);
  const owner = await w.user("owner", { member: null });
  const quote = await w.quote();
  const p = await w.pay(quote, "deposit", 30000);
  const r = (await harnessLib.one(db, "select public.catering_refund_reserve($1, $2, $3, 10000, 'customer_cancelled', null, 'panel') as r", [owner, quote, crypto.randomUUID()])).r as { requests: Array<{ id: string }> };
  // THEN 0359 is applied (and, for the live case, the isolated fixture's install records).
  await db.exec(harnessLib.M0359);
  await harnessLib.withStandIns(db);
  BUILT = await grantAppTables(db);
  fixture = { quote, payment: p.id, request: r.requests[0]!.id };
}, 120_000);

let db: PGlite;
let calls: NonNullable<RefundClientOpts["calls"]>;
beforeEach(() => {
  process.env.CATERING_REFUNDS = "1";
  h.gets = 0;
  h.posts = 0;
  h.audits = [];
});
afterEach(async () => {
  await db?.close().catch(() => {});
});

const counts = async () => ({
  rows: await harnessLib.count(db, "select count(*) n from public.catering_refund_requests"),
  audits: await harnessLib.count(db, "select count(*) n from public.audit_log where action = 'catering.refund.request'"),
});

describe("main @ 9ce98df5 against 0359", () => {
  for (const epoch of ["no epoch", "a live epoch"] as const) {
    it(`main_9ce98df5_press_on_0359_zero_posts: ${epoch}: main's Confirm, Retry and Release on a PREEXISTING pending row make zero rows, zero reservation audits and ZERO Stripe POSTs`, async () => {
      db = await BUILT.clone();
      if (epoch === "a live epoch") await harnessKit.goLive(db);
      calls = [];
      h.client = refundClient(db, { calls });
      const w = await harnessKit.world(db);
      const actor = await actorFor(w, "owner");
      const before = await counts();
      const pre = await harnessLib.one(db, "select status, attempts, claim_token, legacy_possibly_sent from public.catering_refund_requests where id = $1", [fixture.request]);
      expect([pre.status, pre.attempts, pre.legacy_possibly_sent]).toEqual(["pending", 0, false]);

      // Confirm: main calls 0357's historical reserve, whose grant 0359 withdrew.
      await expect(main.requestRefund(actor, fixture.quote, { clientToken: crypto.randomUUID(), amountCents: 5000, reasonCode: "customer_cancelled", reasonNote: null, trigger: "panel" }))
        .rejects.toThrow(/permission denied|refunds_unavailable/);
      // Retry of the preexisting row: main's claim (0357 `catering_refund_claim`) is refused too.
      await expect(main.retryRefundRequest(actor, fixture.quote, fixture.request, Date.now(), "retry")).rejects.toThrow(/permission denied|refunds_unavailable/);
      // Past the window, main's Release / reconcile path: whatever it reads, it cannot write an outcome or send.
      await harnessKit.backdate(db, "catering_refund_requests", "requested_at", fixture.request, "25 hours");
      await main.retryRefundRequest(actor, fixture.quote, fixture.request, Date.now(), "release").catch(() => null);

      expect(h.posts).toBe(0);
      expect(await counts()).toEqual(before);
      expect(h.audits.filter((a) => a.action === "catering.refund.request")).toEqual([]);
      const after = await harnessLib.one(db, "select status, attempts, claim_token, create_armed_at, stripe_refund_id from public.catering_refund_requests where id = $1", [fixture.request]);
      expect([after.status, after.attempts, after.claim_token, after.create_armed_at, after.stripe_refund_id]).toEqual(["pending", 0, null, null, null]);
      // Main reached the historical functions and nothing else that writes.
      const rpcs = calls.filter((c) => c.kind === "rpc").map((c) => c.name);
      expect(rpcs).toEqual(expect.arrayContaining(["catering_refund_reserve", "catering_refund_claim"]));
      expect(rpcs.filter((n) => /admitted|arm|finish|apply/.test(n))).toEqual([]);
      expect(calls.filter((c) => c.kind === "update" || c.kind === "insert" || c.kind === "delete").every((c) => c.name === "catering_refund_requests")).toBe(true);
    });
  }
});
