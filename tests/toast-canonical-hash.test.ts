// Toast content_hash churn fix, PR 1 (plan r2 §1 / §3): the hash is computed over a CANONICAL form of
// the captured order, so the same Toast content returned with its arrays in another order (checks,
// selections, modifiers, discounts, service charges, payments) is ONE hash, hence ONE snapshot.
// Prod evidence: ~342k of 501k toast_orders rows were extra snapshots of the same
// (location, order_guid, modified_at), 4-7k a day, each one detaching the ezCater links joined on it.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import corpus from "./fixtures/toast/line-price-corpus.json";
import sample from "./fixtures/toast/orders-v2-sample.json";
import paymentStates from "./fixtures/toast/order-payment-states.json";
import { canonicalHashInput, legacyHashInput, normalizeToastOrder, type ToastCapturedOrder } from "@/lib/toast/capture-shared";
import { normalizeModifiedOrder } from "@/lib/toast/capture-modified-shared";
import { toastContentHash } from "@/lib/toast/content-hash";

type Raw = Record<string, unknown>;
const DATE = "2026-10-08";
/** The pre-fix hash, computed HERE so production keeps one hashing site. */
const legacyHash = (o: ToastCapturedOrder) => createHash("sha256").update(JSON.stringify(legacyHashInput(o))).digest("hex");

// ---- A deterministic shuffle (mulberry32), so a failure reproduces exactly. ----
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = <T>(xs: T[], r: () => number): T[] => {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
};
const ARRAYS = ["checks", "selections", "modifiers", "appliedDiscounts", "appliedServiceCharges", "payments"];
/** Every array Toast may return in another order, at every depth, shuffled. */
function permute(x: unknown, r: () => number): unknown {
  if (Array.isArray(x)) return x.map((v) => permute(v, r));
  if (x === null || typeof x !== "object") return x;
  const out: Raw = {};
  for (const [k, v] of Object.entries(x as Raw)) out[k] = ARRAYS.includes(k) && Array.isArray(v) ? shuffled(v, r).map((e) => permute(e, r)) : permute(v, r);
  return out;
}

// ---- Synthetic orders built to break a naive sort (no real customer data). ----
const sel = (guid: string, item: string, extra: Raw = {}): Raw => ({ guid, item: { guid: item }, displayName: item, quantity: 1, price: 5, ...extra });
const rich: Raw = {
  guid: "cn-rich", businessDate: 20261008, modifiedDate: "2026-10-08T16:00:00.000Z", source: "In Store",
  checks: [
    { guid: "cn-c2", amount: 40, taxAmount: 4, totalAmount: 44,
      appliedDiscounts: [
        // Tied, null identity (no guid): differ only by amount, plus an exact duplicate pair.
        { name: "Open", discountAmount: 1 },
        { name: "Open", discountAmount: 2 },
        { name: "Dup", discountAmount: 3, approver: { guid: "emp-1" } },
        { name: "Dup", discountAmount: 3, approver: { guid: "emp-1" } },
        { guid: "ad-z", discount: { guid: "d-1" }, name: "Loyalty", discountAmount: 1 },
      ],
      selections: [
        sel("s-b", "it-italian", { quantity: 2,
          appliedDiscounts: [{ guid: "ad-s1", name: "Comp", discountAmount: 1.5, appliedDiscountReason: { name: "Late", discountReason: { guid: "r-1" } } },
                             { name: "Comp", discountAmount: 0.5 }],
          modifiers: [
            sel("s-b-m2", "it-peppers", { modifiers: [sel("s-b-m2-x", "it-extra", { modifiers: [sel("s-b-m2-x-y", "it-deep")] })] }),
            sel("s-b-m1", "it-cheese", { appliedDiscounts: [{ name: "Mod comp", discountAmount: 0.25 }] }),
            { guid: "s-b-note", item: null, selectionType: "SPECIAL_REQUEST", displayName: "PRIVATE note", quantity: 1, price: 0 },
          ] }),
        sel("s-a", "it-chips"),
        sel("s-c", "it-soda", { voided: true, modifiers: [sel("s-c-m1", "it-ice")] }),
        sel("s-d", "it-cookie", { deleted: true }),
      ],
      appliedServiceCharges: [
        // Same guid / name / amount, differing only in gratuity or taxable.
        { serviceCharge: { guid: "sc-1" }, name: "Delivery", chargeAmount: 3, gratuity: false, taxable: true },
        { serviceCharge: { guid: "sc-1" }, name: "Delivery", chargeAmount: 3, gratuity: false, taxable: false },
        { serviceCharge: { guid: "sc-2" }, name: "Tip", chargeAmount: 2, gratuity: true },
        { serviceCharge: { guid: "sc-2" }, name: "Tip", chargeAmount: 2, gratuity: false },
        // No identity at all, duplicated exactly.
        { name: "Fee", chargeAmount: 1 },
        { name: "Fee", chargeAmount: 1 },
      ],
      payments: [
        { guid: "pay-c", type: "CREDIT", paymentStatus: "CAPTURED", amount: 20, tipAmount: 1, paidBusinessDate: 20261008 },
        { guid: "pay-a", type: "CASH", paymentStatus: "CAPTURED", amount: 14, paidBusinessDate: 20261008,
          refund: { refundAmount: 5, tipRefundAmount: 0, refundBusinessDate: 20261009, refundTransaction: { guid: "rtx-1" } } },
        { guid: "pay-b", type: "CREDIT", paymentStatus: "VOIDED", amount: 10, paidBusinessDate: 20261008, voidInfo: { voidBusinessDate: 20261008 } },
      ] },
    { guid: "cn-c1", amount: 12, taxAmount: 1, totalAmount: 13,
      appliedDiscounts: [{ name: "Open", discountAmount: 1 }],
      selections: [sel("s-e", "it-turkey", { appliedDiscounts: [{ name: "Comp", discountAmount: 2 }] }), sel("s-f", "it-blt")],
      appliedServiceCharges: [{ name: "Fee", chargeAmount: 1 }],
      payments: [{ guid: "pay-d", type: "CASH", paymentStatus: "CAPTURED", amount: 13, paidBusinessDate: 20261008 }] },
    { guid: "cn-c3", amount: 9, deleted: true,
      selections: [sel("s-g", "it-meatball")],
      payments: [{ guid: "pay-e", type: "CREDIT", paymentStatus: "DENIED", amount: 9, paidBusinessDate: 20261008 }] },
  ],
};
const fixtures: { label: string; raw: unknown; date: string }[] = [
  { label: "rich multi-check", raw: rich, date: DATE },
  ...sample.map((raw) => ({ label: `sample:${raw.guid}`, raw, date: "2026-07-22" })),
  { label: "payment-states", raw: paymentStates, date: "2026-07-23" },
  ...corpus.valid.map((raw) => ({ label: `valid:${raw.guid}`, raw, date: DATE })),
];

describe("permutation invariance: one Toast content = one hash", () => {
  it.each(fixtures)("$label: 50 seeded shuffles of every array give exactly one hash", ({ label, raw, date }) => {
    const r = rng([...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
    const hashes = new Set<string>([toastContentHash(normalizeToastOrder(raw, date))]);
    for (let i = 0; i < 50; i++) hashes.add(toastContentHash(normalizeToastOrder(permute(raw, r), date)));
    expect(hashes.size).toBe(1);
  });
  it("the rich fixture really has orderings that the legacy hash splits (the test is not vacuous)", () => {
    const r = rng(42);
    const legacy = new Set<string>();
    for (let i = 0; i < 50; i++) legacy.add(legacyHash(normalizeToastOrder(permute(rich, r), DATE)));
    expect(legacy.size).toBeGreaterThan(40);
  });
  it("the day capture and the modified sweep agree on a multi-check order (the sweep re-sorts payments)", () => {
    const window = { start: "2026-10-08T15:00:00.000Z", end: "2026-10-08T17:00:00.000Z" };
    const r = rng(9);
    for (let i = 0; i < 20; i++) {
      const raw = permute(rich, r);
      expect(toastContentHash(normalizeModifiedOrder(raw, window)!)).toBe(toastContentHash(normalizeToastOrder(raw, DATE)));
    }
  });
  it("the synthetic ordinals never enter the hash: renumbering them is the same content", () => {
    const o = normalizeToastOrder(rich, DATE);
    const renumbered = { ...o, discounts: o.discounts.map((d) => ({ ...d, ordinal: d.ordinal + 7 })), service_charges: o.service_charges.map((s, i) => ({ ...s, ordinal: 100 - i })) };
    expect(toastContentHash(renumbered)).toBe(toastContentHash(o));
  });
});

describe("the canonical form", () => {
  const o = normalizeToastOrder(rich, DATE);
  const c = canonicalHashInput(o);
  it("reassigns ordinals 0..k-1 per check, separately for discounts and service charges", () => {
    const per = (xs: { check_guid: string; ordinal: number }[]) => {
      const m = new Map<string, number[]>();
      for (const x of xs) m.set(x.check_guid, [...(m.get(x.check_guid) ?? []), x.ordinal]);
      return Object.fromEntries(m);
    };
    expect(per(c.discounts)).toEqual({ "cn-c1": [0, 1], "cn-c2": [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(per(c.service_charges)).toEqual({ "cn-c1": [0], "cn-c2": [0, 1, 2, 3, 4, 5] });
  });
  it("keeps duplicates (multiset, never deduplicated) and sorts every collection", () => {
    expect(c.discounts).toHaveLength(o.discounts.length);
    expect(c.service_charges).toHaveLength(o.service_charges.length);
    expect(c.order.selection_units).toHaveLength(o.order.selection_units.length);
    expect(c.checks.map((x) => x.check_guid)).toEqual(["cn-c1", "cn-c2", "cn-c3"]);
    expect(c.payments.map((x) => x.payment_guid)).toEqual(["pay-d", "pay-a", "pay-b", "pay-c", "pay-e"]);
    expect(c.order.selection_units.map((s) => s.selection_guid)).toEqual(
      ["s-e", "s-f", "s-a", "s-b", "s-b-m1", "s-b-m2", "s-b-m2-x", "s-b-m2-x-y", "s-c", "s-c-m1", "s-d", "s-g"]);
    // Discounts: per check, check-level (null selection) first, nulls first on applied_discount_guid.
    // Ties on (selection, applied guid) break on the ordinal-free row text: "Dup" < "Open", 100 < 200.
    expect(c.discounts.filter((d) => d.check_guid === "cn-c2").map((d) => `${d.selection_guid}|${d.applied_discount_guid}|${d.name}|${d.amount_cents}`)).toEqual(
      ["null|null|Dup|300", "null|null|Dup|300", "null|null|Open|100", "null|null|Open|200", "null|ad-z|Loyalty|100",
       "s-b|null|Comp|50", "s-b|ad-s1|Comp|150", "s-b-m1|null|Mod comp|25"]);
    // Service charges: null identity first; then gratuity / taxable false before true.
    expect(c.service_charges.filter((s) => s.check_guid === "cn-c2").map((s) => `${s.service_charge_guid}|${s.gratuity}|${s.taxable}`)).toEqual(
      ["null|false|false", "null|false|false", "sc-1|false|false", "sc-1|false|true", "sc-2|false|false", "sc-2|true|false"]);
  });
  it("rebuilds every object with an explicit key list (legacy key order, line prices excluded)", () => {
    const on = canonicalHashInput(normalizeToastOrder(corpus.valid[0], DATE, { linePrices: true }));
    expect(Object.keys(on)).toEqual(["order", "checks", "discounts", "service_charges", "payments"]);
    expect(Object.keys(on.order.selection_units[0]!)).toEqual(["check_guid", "selection_guid", "parent_selection_guid", "item_guid", "name", "quantity", "voided", "deleted"]);
    expect(Object.keys(on.checks[0]!.accounting)).toEqual(["version", "gross_cents", "discounts_comps_cents", "voids_cents", "service_charges_cents", "pre_refund_cents"]);
    expect(Object.keys(on.payments[0]!)).toEqual(["check_guid", "payment_guid", "payment_status", "refund_status", "type", "amount_cents", "tip_cents", "paid_business_date", "refund_amount_cents", "refund_tip_cents", "refund_business_date", "void_business_date", "server_guid", "sales_refund_cents"]);
  });
  it("is a fixed point: canonical of canonical is itself, and its LEGACY hash is the canonical hash", () => {
    expect(canonicalHashInput(c)).toEqual(c);
    expect(legacyHash(c)).toBe(toastContentHash(o));
  });
  it("never mutates its input (sorts copies only)", () => {
    const input = normalizeToastOrder(permute(rich, rng(3)), DATE);
    const before = structuredClone(input);
    toastContentHash(input);
    canonicalHashInput(input);
    expect(input).toEqual(before);
  });
});

describe("an order already in canonical order keeps its legacy hash", () => {
  it.each(fixtures.filter((f) => f.label !== "rich multi-check" && f.label !== "payment-states"))("$label", ({ raw, date }) => {
    const o = normalizeToastOrder(raw, date);
    expect(toastContentHash(o)).toBe(legacyHash(o));
  });
  it("payment-states is NOT in canonical order (payments voided, denied, refunded), so its hash changes", () => {
    const o = normalizeToastOrder(paymentStates, "2026-07-23");
    expect(toastContentHash(o)).not.toBe(legacyHash(o));
  });
});

describe("change sensitivity: a real change in any field is a different hash", () => {
  const base = normalizeToastOrder(rich, DATE);
  const h0 = toastContentHash(base);
  const edit = (f: (o: ToastCapturedOrder) => void) => { const o = structuredClone(base); f(o); return toastContentHash(o); };
  const at = <T>(xs: T[], pred: (x: T) => boolean): T => { const x = xs.find(pred); if (!x) throw new Error("fixture"); return x; };
  const cases: [string, (o: ToastCapturedOrder) => void][] = [
    ["order modified_at", (o) => { o.order.modified_at = "2026-10-08T16:00:01.000Z"; }],
    ["order voided", (o) => { o.order.voided = true; }],
    ["order dining option", (o) => { o.order.dining_option_guid = "do-x"; }],
    ["check amount", (o) => { at(o.checks, (c) => c.check_guid === "cn-c1").amount_cents! += 1; }],
    ["check tax", (o) => { at(o.checks, (c) => c.check_guid === "cn-c1").tax_cents = 99; }],
    ["check voided", (o) => { at(o.checks, (c) => c.check_guid === "cn-c1").voided = true; }],
    ["check accounting gross", (o) => { at(o.checks, (c) => c.check_guid === "cn-c1").accounting.gross_cents = 1; }],
    ["selection moves to another check", (o) => { at(o.order.selection_units, (s) => s.selection_guid === "s-e").check_guid = "cn-c2"; }],
    ["selection parent", (o) => { at(o.order.selection_units, (s) => s.selection_guid === "s-b-m1").parent_selection_guid = "s-a"; }],
    ["selection quantity", (o) => { at(o.order.selection_units, (s) => s.selection_guid === "s-a").quantity = 2; }],
    ["selection own voided", (o) => { at(o.order.selection_units, (s) => s.selection_guid === "s-a").voided = true; }],
    ["selection own deleted", (o) => { at(o.order.selection_units, (s) => s.selection_guid === "s-a").deleted = true; }],
    ["selection item", (o) => { at(o.order.selection_units, (s) => s.selection_guid === "s-a").item_guid = "it-other"; }],
    ["discount amount", (o) => { at(o.discounts, (d) => d.applied_discount_guid === "ad-z").amount_cents = 5; }],
    ["discount reason", (o) => { at(o.discounts, (d) => d.applied_discount_guid === "ad-s1").reason_guid = "r-2"; }],
    ["discount approver", (o) => { at(o.discounts, (d) => d.applied_discount_guid === "ad-z").approver_guid = "emp-9"; }],
    ["discount moves selection", (o) => { at(o.discounts, (d) => d.applied_discount_guid === "ad-s1").selection_guid = "s-a"; }],
    ["discount moves check", (o) => { at(o.discounts, (d) => d.applied_discount_guid === "ad-z").check_guid = "cn-c1"; }],
    ["service charge gratuity", (o) => { at(o.service_charges, (s) => s.name === "Tip" && s.gratuity).gratuity = false; }],
    ["service charge taxable", (o) => { at(o.service_charges, (s) => s.name === "Delivery" && s.taxable).taxable = false; }],
    ["service charge amount", (o) => { at(o.service_charges, (s) => s.name === "Fee").amount_cents = 2; }],
    ["payment status", (o) => { at(o.payments, (p) => p.payment_guid === "pay-c").payment_status = "VOIDED"; }],
    ["payment refund status", (o) => { at(o.payments, (p) => p.payment_guid === "pay-c").refund_status = "FULL"; }],
    ["payment refund amount", (o) => { at(o.payments, (p) => p.payment_guid === "pay-a").refund_amount_cents = 1; }],
    ["payment sales_refund_cents", (o) => { at(o.payments, (p) => p.payment_guid === "pay-a").sales_refund_cents = 1; }],
    ["payment moves check", (o) => { at(o.payments, (p) => p.payment_guid === "pay-d").check_guid = "cn-c2"; }],
    ["remove one of two identical discounts", (o) => { o.discounts.splice(o.discounts.findIndex((d) => d.name === "Dup"), 1); }],
    ["add a third identical discount", (o) => { o.discounts.push({ ...at(o.discounts, (d) => d.name === "Dup") }); }],
    ["remove one of two identical service charges", (o) => { o.service_charges.splice(o.service_charges.findIndex((s) => s.name === "Fee" && s.check_guid === "cn-c2"), 1); }],
    ["add a third identical service charge", (o) => { o.service_charges.push({ ...at(o.service_charges, (s) => s.name === "Fee" && s.check_guid === "cn-c2") }); }],
  ];
  it.each(cases)("%s", (_label, f) => { expect(edit(f)).not.toBe(h0); });
  it("an inherited void (parent voided in Toast) changes the hash", () => {
    const raw = structuredClone(rich) as { checks: { selections: Raw[] }[] };
    raw.checks[0]!.selections[0]!.voided = true; // s-b: its modifiers inherit voided
    expect(toastContentHash(normalizeToastOrder(raw, DATE))).not.toBe(h0);
  });
  it("an inherited delete (check deleted in Toast) changes the hash", () => {
    const raw = structuredClone(rich) as { checks: Raw[] };
    raw.checks[1]!.deleted = true; // cn-c1
    expect(toastContentHash(normalizeToastOrder(raw, DATE))).not.toBe(h0);
  });
});
