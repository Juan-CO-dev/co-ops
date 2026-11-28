/**
 * Catering refunds Part B1 — THE FIGURES TWIN. SQL `catering_refund_effective_figures` (0359, the authority) and TS
 * `effectiveRefundFigures` (lib/catering/refund-outcomes-shared.ts, what the panel and tests reason with) must give
 * IDENTICAL numbers. For a matrix of states the rows are inserted as the fixture owner on the REAL 0357 -> 0358 ->
 * 0359 (PGlite), and the TS input is built FROM THE SAME ROWS (`tsInput` below: the selection a caller makes from
 * the stored rows, documented on `EffectiveFiguresInput`). Synthetic rows only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

import { refundDb, harnessKit, harnessLib } from "./helpers/refund-pglite";
import { effectiveRefundFigures, type EffectiveFiguresInput, type RefundClass } from "@/lib/catering/refund-outcomes-shared";

type ReqStatus = "pending" | "submitted" | "succeeded" | "failed";
interface Scenario {
  name: string;
  payment?: { amount?: number; status?: string; provider?: string | null; ref?: string | null };
  /** No work row at all = never touched by 0359. */
  work?: { verified: boolean; captureKnown?: boolean; captured?: number | null; restricted?: boolean };
  events?: Array<{ cumulative: number; charge: number | null }>;
  snapshot?: { captured: number | null; refunds: Array<{ id: string; amount: number; status: string | null }> };
  identities?: Array<{ id: string; amount: number; cls: RefundClass; verified?: boolean; wrongCharge?: boolean; request?: number }>;
  floors?: Array<{ cents: number; state?: "outstanding" | "discharged" | "operator_resolved" }>;
  requests?: Array<{ amount: number; status: ReqStatus; stripeRefundId?: string }>;
  issues?: Array<{ code: string; blocking: boolean; state?: "open" | "held" | "resolved" }>;
  /** Another payment's floor on the same PaymentIntent family must not leak in. */
  exclude?: number;
}

const SCENARIOS: Scenario[] = [
  { name: "never verified, no snapshot, no events, no requests" },
  { name: "never verified, 0333 events only", events: [{ cumulative: 5000, charge: 30000 }, { cumulative: 12000, charge: 30000 }] },
  { name: "never verified, snapshot only (failed / canceled not counted)", snapshot: { captured: 28000, refunds: [{ id: "re_s1", amount: 4000, status: "succeeded" }, { id: "re_s2", amount: 3000, status: "failed" }, { id: "re_s3", amount: 2000, status: "canceled" }, { id: "re_s4", amount: 1000, status: "pending" }] } },
  { name: "never verified, snapshot below the 0333 cumulative", events: [{ cumulative: 9000, charge: null }], snapshot: { captured: null, refunds: [{ id: "re_s1", amount: 4000, status: "succeeded" }] } },
  { name: "never verified, a `refunded` row with events and a snapshot", payment: { status: "refunded" }, events: [{ cumulative: 30000, charge: 30000 }], snapshot: { captured: 30000, refunds: [{ id: "re_s1", amount: 30000, status: "canceled" }] } },
  { name: "never verified, a `refunded` row and nothing else", payment: { status: "refunded" } },
  { name: "never verified, a request whose refund the snapshot lists is not reserved twice", snapshot: { captured: 30000, refunds: [{ id: "re_s9", amount: 5000, status: "pending" }] }, requests: [{ amount: 5000, status: "submitted", stripeRefundId: "re_s9" }, { amount: 2000, status: "pending" }] },
  { name: "never verified (work row exists, no complete pass), with a floor", work: { verified: false }, events: [{ cumulative: 3000, charge: 30000 }], floors: [{ cents: 8000 }] },
  { name: "verified: returned, reserved and void identities", work: { verified: true, captureKnown: true, captured: 30000 },
    identities: [{ id: "re_v1", amount: 5000, cls: "returned" }, { id: "re_v2", amount: 3000, cls: "reserved" }, { id: "re_v3", amount: 7000, cls: "void" }] },
  { name: "verified: unverified and wrong-charge identities do not count", work: { verified: true, captureKnown: true, captured: 30000 },
    identities: [{ id: "re_v1", amount: 5000, cls: "returned" }, { id: "re_u1", amount: 9000, cls: "returned", verified: false }, { id: "re_w1", amount: 4000, cls: "returned", wrongCharge: true }] },
  { name: "verified: the outstanding floor ABOVE the identity sum", work: { verified: true, captureKnown: true, captured: 30000 },
    identities: [{ id: "re_v1", amount: 5000, cls: "returned" }], floors: [{ cents: 12000 }, { cents: 9000 }, { cents: 20000, state: "discharged" }] },
  { name: "verified: the outstanding floor BELOW the identity sum", work: { verified: true, captureKnown: true, captured: 30000 },
    identities: [{ id: "re_v1", amount: 15000, cls: "returned" }, { id: "re_v2", amount: 2000, cls: "reserved" }], floors: [{ cents: 9000 }] },
  { name: "verified: a NEWER snapshot saying less than an outstanding floor", work: { verified: true, captureKnown: true, captured: 30000 },
    snapshot: { captured: 30000, refunds: [] }, floors: [{ cents: 10000 }] },
  { name: "never verified: a newer snapshot saying nothing, an outstanding floor", snapshot: { captured: 30000, refunds: [] }, events: [{ cumulative: 10000, charge: 30000 }], floors: [{ cents: 10000 }] },
  { name: "verified, capture unknown: the 0333 charge amount, else the row's amount", work: { verified: true, captureKnown: false, captured: null }, events: [{ cumulative: 0, charge: 25000 }] },
  { name: "verified, capture unknown and no event", work: { verified: true, captureKnown: false, captured: null }, payment: { amount: 22000 } },
  { name: "bound and unbound requests", work: { verified: true, captureKnown: true, captured: 30000 },
    identities: [{ id: "re_b1", amount: 6000, cls: "reserved", request: 0 }],
    requests: [{ amount: 6000, status: "submitted", stripeRefundId: "re_b1" }, { amount: 4000, status: "pending" }, { amount: 1000, status: "submitted", stripeRefundId: "re_nb" }, { amount: 2500, status: "failed" }, { amount: 1500, status: "succeeded" }] },
  { name: "a held payment (blocking issue open)", work: { verified: true, captureKnown: true, captured: 30000 }, issues: [{ code: "awaiting_identity", blocking: true }, { code: "unfamiliar_identity", blocking: false }] },
  { name: "a held payment (blocking issue held; a resolved one ignored)", work: { verified: true, captureKnown: true, captured: 30000 }, issues: [{ code: "verified_unreadable", blocking: true, state: "held" }, { code: "wrong_charge", blocking: true, state: "resolved" }] },
  { name: "a restricted payment", work: { verified: true, captureKnown: true, captured: 30000, restricted: true } },
  { name: "the exclude-request argument", work: { verified: true, captureKnown: true, captured: 30000 }, requests: [{ amount: 4000, status: "pending" }, { amount: 3000, status: "pending" }], exclude: 0 },
  { name: "ineligible: not Stripe", payment: { provider: "manual", ref: null } },
  { name: "ineligible: due", payment: { status: "due", ref: null }, requests: [] },
  { name: "ineligible: a malformed PaymentIntent ref", payment: { ref: "ch_not_a_pi" } },
  { name: "over-deducted: never below zero", work: { verified: true, captureKnown: true, captured: 10000 }, identities: [{ id: "re_v1", amount: 9000, cls: "returned" }], requests: [{ amount: 5000, status: "pending" }] },
  // LEAD MUST FIX (left failing on purpose): a bound identity later read as wrong-charge evidence (apply re-derives
  // `wrong_charge` on every read, 0359 ~line 1956, and keeps `request_id`). SQL drops the request from the
  // reservations (its `not exists ... i.request_id = r.id and i.verified` ignores wrong_charge) AND from the money
  // (`not i.wrong_charge`), so its amount vanishes from the deduction (available 30000); the TS twin keeps it reserved
  // (24000). Only the wrong_charge HOLD stops an over-refund. The two must agree, and conservatively.
  { name: "LEAD_MUST_FIX a request bound to an identity that is wrong-charge evidence", work: { verified: true, captureKnown: true, captured: 30000 },
    identities: [{ id: "re_wb", amount: 6000, cls: "returned", wrongCharge: true, request: 0 }], requests: [{ amount: 6000, status: "submitted", stripeRefundId: "re_wb" }] },
];

let BASE: PGlite;
beforeAll(async () => {
  BASE = await refundDb();
}, 60_000);
afterAll(async () => {
  await BASE?.close();
});

async function insert(db: PGlite, s: Scenario): Promise<{ payment: string; requestIds: string[]; input: EffectiveFiguresInput }> {
  const w = await harnessKit.world(db);
  const owner = await w.user("owner", { member: null });
  const quote = await w.quote();
  const pay = { amount: 30000, status: "paid", provider: "stripe" as string | null, ref: `pi_twin_${crypto.randomUUID().slice(0, 8)}` as string | null, ...s.payment };
  // Fixture-owner inserts without the guards (replica mode: no row triggers), exactly the rows listed.
  await db.exec("set session_replication_role = replica");
  try {
    const payment = (await harnessLib.one(db, `insert into public.catering_payments (quote_id, kind, amount_cents, status, provider, provider_ref, paid_at)
      values ($1, 'deposit', $2, $3, $4, $5, now()) returning id`, [quote, pay.amount, pay.status, pay.provider, pay.ref])).id as string;
    const pi = /^pi_[A-Za-z0-9_]+$/.test(pay.ref ?? "") ? pay.ref! : `pi_twin_other_${crypto.randomUUID().slice(0, 8)}`;
    if (s.work) {
      await db.query(`insert into public.catering_refund_payment_work (payment_id, location_id, payment_intent_id, baseline_source, last_complete_pass_at, capture_known, captured_cents, restricted_at, charge_id, currency, livemode)
        values ($1, $2, $3, 'staff', $4, $5, $6, $7, 'ch_twin', 'usd', false)`,
        [payment, w.shop, pi, s.work.verified ? new Date() : null, s.work.captureKnown ?? false, s.work.captured ?? null, s.work.restricted ? new Date() : null]);
    }
    let n = 0;
    for (const e of s.events ?? []) {
      await db.query("insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents, charge_amount_cents) values ($1, $2, now(), $3, $4)",
        [`evt_twin_${payment.slice(0, 8)}_${++n}`, payment, e.cumulative, e.charge]);
    }
    if (s.snapshot) {
      await db.query("insert into public.catering_refund_stripe_snapshots (payment_id, listed_at, captured_cents, refunds) values ($1, now(), $2, $3)",
        [payment, s.snapshot.captured, JSON.stringify(s.snapshot.refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status, request_id: null })))]);
    }
    const requestIds: string[] = [];
    for (const r of s.requests ?? []) {
      requestIds.push((await harnessLib.one(db, `insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents, reason_code, trigger_kind, requested_by, status, stripe_refund_id)
        values ($1, $2, $3, $4, $5, 'customer_cancelled', 'panel', $6, $7, $8) returning id`, [payment, quote, w.shop, crypto.randomUUID(), r.amount, owner, r.status, r.stripeRefundId ?? null])).id as string);
    }
    for (const i of s.identities ?? []) {
      const verified = i.verified ?? true;
      await db.query(`insert into public.catering_refund_identities (refund_id, payment_id, verified, charge_id, amount_cents, currency, provider_created_at, class, wrong_charge, request_id, verified_at, first_source)
        values ($1, $2, $3, 'ch_twin', $4, 'usd', now(), $5, $6, $7, $8, 'list')`,
        [i.id, payment, verified, i.amount, i.cls, i.wrongCharge ?? false, i.request === undefined ? null : requestIds[i.request], verified ? new Date() : null]);
    }
    n = 0;
    for (const f of s.floors ?? []) {
      const ev = `evt_twin_floor_${payment.slice(0, 8)}_${++n}`;
      await db.query("insert into public.stripe_events (id, type, livemode, payload) values ($1, 'charge.refunded', false, '{}')", [ev]);
      await db.query(`insert into public.catering_refund_event_work (event_id, event_type, source, livemode, payment_intent_id, payment_id, state, floor_state, floor_cents)
        values ($1, 'charge.refunded', 'ingress', false, $2, $3, 'attached', $4, $5)`, [ev, pi, payment, f.state ?? "outstanding", f.cents]);
    }
    n = 0;
    for (const i of s.issues ?? []) {
      await db.query(`insert into public.catering_refund_issues (code, payment_id, location_id, evidence_fingerprint, state, blocking, generation_at_open)
        values ($1, $2, $3, $4, $5, $6, 1)`, [i.code, payment, w.shop, `twin:${++n}`, i.state ?? "open", i.blocking]);
    }

    // THE TS INPUT, from the same rows.
    const input: EffectiveFiguresInput = {
      payment: { amountCents: pay.amount, status: pay.status, provider: pay.provider, providerRef: pay.ref },
      verified: s.work?.verified === true,
      knownCapturedCents: s.work?.captureKnown ? (s.work.captured ?? null) : null,
      eventChargeCents: (s.events ?? []).some((e) => e.charge != null) ? Math.max(...(s.events ?? []).flatMap((e) => (e.charge == null ? [] : [e.charge]))) : null,
      eventCumulativeCents: (s.events ?? []).length ? Math.max(...(s.events ?? []).map((e) => e.cumulative)) : null,
      snapshot: s.snapshot ? { capturedCents: s.snapshot.captured, refunds: s.snapshot.refunds.map((r) => ({ id: r.id, amountCents: r.amount, status: r.status })) } : null,
      identities: (s.identities ?? []).filter((i) => (i.verified ?? true) && !i.wrongCharge)
        .map((i) => ({ amountCents: i.amount, class: i.cls, requestId: i.request === undefined ? null : requestIds[i.request]! })),
      floors: (s.floors ?? []).filter((f) => (f.state ?? "outstanding") === "outstanding").map((f) => f.cents),
      requests: (s.requests ?? []).map((r, k) => ({ id: requestIds[k]!, amountCents: r.amount, status: r.status, stripeRefundId: r.stripeRefundId ?? null })),
      held: s.work?.restricted === true || (s.issues ?? []).some((i) => i.blocking && (i.state ?? "open") !== "resolved"),
      excludeRequestId: s.exclude === undefined ? null : requestIds[s.exclude]!,
    };
    return { payment, requestIds, input };
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

describe("effective_figures_twin", () => {
  for (const s of SCENARIOS) {
    it(`effective_figures_twin: ${s.name}`, async () => {
      const db = await BASE.clone();
      try {
        const { payment, requestIds, input } = await insert(db, s);
        const sql = await harnessKit.figures(db, payment, s.exclude === undefined ? null : requestIds[s.exclude]!);
        const ts = effectiveRefundFigures(input);
        expect({
          capturedCents: ts.capturedCents, returnedCents: ts.returnedCents, reservedCents: ts.reservedCents, floorCents: ts.floorCents,
          deductionCents: ts.deductionCents, reservationsCents: ts.reservationsCents, availableCents: ts.availableCents,
          eligible: ts.eligible, held: ts.held, verified: ts.verified,
        }).toEqual({
          capturedCents: sql.o_captured, returnedCents: sql.o_returned, reservedCents: sql.o_reserved, floorCents: sql.o_floor,
          deductionCents: sql.o_deduction, reservationsCents: sql.o_reservations, availableCents: sql.o_available,
          eligible: sql.o_eligible, held: sql.o_held, verified: sql.o_verified,
        });
      } finally {
        await db.close();
      }
    });
  }
});
