// Item 1 PR B (phase 1): line price fields, per-check completeness flags, and the lenient
// SELECTION-only parser. Plan: C:\co\audit\item1-toast-r3.md §3.1–§3.5.
import { describe, expect, it } from "vitest";
import corpus from "./fixtures/toast/line-price-corpus.json";
import { captureCents, normalizeToastOrder } from "@/lib/toast/capture-shared";
import { projectCheckSales } from "@/lib/toast/sales-accounting-shared";
import { checkLinePrices, lineCents, lineRevenue, type CheckLinePrices } from "@/lib/toast/line-prices-shared";

const on = (raw: unknown, date = "2026-10-08") => normalizeToastOrder(raw, date, { linePrices: true });
const valid = (guid: string) => corpus.valid.find((o) => o.guid === guid)!;
const unit = (o: ReturnType<typeof on>, guid: string) => o.order.selection_units.find((s) => s.selection_guid === guid)!;
const flags = (lp: CheckLinePrices | undefined) => lp && [lp.source_complete, lp.net_complete, lp.gross_complete, lp.receipt_line_complete];
const order = (checks: unknown[]) => ({ guid: "o", businessDate: 20261008, checks });
const head = (extra: Record<string, unknown> = {}) => ({ guid: "h", item: { guid: "i" }, quantity: 1, price: 10, preDiscountPrice: 10, receiptLinePrice: 10, ...extra });
const lpOf = (checks: unknown[]) => on(order(checks)).checks.map((c) => (c.accounting as { line_prices?: CheckLinePrices }).line_prices!);

describe("lineCents", () => {
  it("parses exactly as captureCents for every valid input", () => {
    for (const x of [0, 1, -1, 12.345, 1.005, "1.005", "-3.10", "27.98", 99999.99, null, undefined]) expect(lineCents(x)).toBe(captureCents(x));
  });
  it("returns null and never throws for anything captureCents refuses", () => {
    for (const x of ["abc", "", "1e3", {}, [], true, false, NaN, Infinity, -Infinity, 1e300, "1.2.3"]) {
      expect(() => captureCents(x)).toThrow("toast_capture_invalid_money");
      expect(lineCents(x)).toBeNull();
    }
  });
});

describe("line fields (switch on)", () => {
  const o = on(valid("lp-instore"));
  it("maps the §3.1 fields after the eight original keys, in a fixed order", () => {
    expect(Object.keys(unit(o, "lp-s1"))).toEqual(["check_guid", "selection_guid", "parent_selection_guid", "item_guid", "name", "quantity", "voided", "deleted",
      "price_v", "net_cents", "gross_cents", "receipt_line_cents", "tax_cents", "tax_inclusion", "selection_type", "deferred"]);
    expect(unit(o, "lp-s1")).toMatchObject({ price_v: 1, net_cents: 2400, gross_cents: 2500, receipt_line_cents: 1150, tax_cents: 240,
      tax_inclusion: "NOT_INCLUDED", selection_type: "NONE", deferred: false, quantity: 2 });
  });
  it("modifiers carry their own net but are never heads", () => {
    expect(unit(o, "lp-s1m1")).toMatchObject({ parent_selection_guid: "lp-s1", net_cents: 100, receipt_line_cents: 50 });
    expect((o.checks[0]!.accounting as { line_prices: CheckLinePrices }).line_prices).toMatchObject({ heads: 2, net_cents: 2650 });
  });
  it("never captures externalPriceAmount or openPriceAmount, even when the payload carries them", () => {
    const text = JSON.stringify(on(valid("lp-marketplace"))) + JSON.stringify(o);
    expect(text).not.toMatch(/external|open_?price|1399[^0-9]*external/i);
    expect(Object.keys(unit(o, "lp-s1"))).not.toContain("external_price_cents");
  });
  it("enums keep only ^[A-Z_]{1,40}$; free text becomes null", () => {
    expect(unit(on(valid("lp-service")), "lp-sc-s1")).toMatchObject({ tax_inclusion: null, selection_type: null });
  });
  it("is deterministic and adds no PII (notes, names, customers, provider order ids)", () => {
    for (const raw of corpus.valid) {
      expect(JSON.stringify(on(raw))).toBe(JSON.stringify(on(raw)));
      expect(JSON.stringify(on(raw))).not.toMatch(/PRIVATE|customer|thirdPartyOrderId/);
    }
  });
  it("string money is parsed; receipt is never multiplied by quantity", () => {
    expect(unit(on(valid("lp-marketplace")), "lp-mk-s1")).toMatchObject({ net_cents: 2798, receipt_line_cents: 1399, tax_cents: 280, quantity: 2 });
  });
  it("switch off adds no key at all", () => {
    const off = normalizeToastOrder(valid("lp-instore"), "2026-10-08");
    expect(Object.keys(off.order.selection_units[0]!)).toHaveLength(8);
    expect(off.checks[0]!.accounting).not.toHaveProperty("line_prices");
  });
});

describe("per-check completeness flags [source, net, gross, receipt]", () => {
  it("all complete for a clean in-store check (quantity 2, net equals Toast's price exactly)", () => {
    const lp = (on(valid("lp-instore")).checks[0]!.accounting as { line_prices: CheckLinePrices }).line_prices;
    expect(lp).toEqual({ v: 1, selections_present: true, heads: 2, uncaptured_heads: 0, mixed_heads: 0, net_cents: 2650,
      source_complete: true, net_complete: true, gross_complete: true, receipt_line_complete: true });
  });
  it("a captured $10 head plus an uncaptured $5 head: everything false", () => {
    const [lp] = lpOf([{ guid: "c", amount: 15, selections: [head(), { guid: "n", quantity: 1, price: 5 }] }]);
    expect(lp).toMatchObject({ heads: 2, uncaptured_heads: 1 });
    expect(flags(lp)).toEqual([false, false, false, false]);
  });
  it("a wholly uncaptured check (one $5 head, no GUID): everything false", () => {
    expect(flags(lpOf([{ guid: "c", amount: 5, selections: [{ guid: "n", quantity: 1, price: 5 }] }])[0])).toEqual([false, false, false, false]);
  });
  it("selections missing, and selections not an array: refused by name", () => {
    const [missing] = lpOf([{ guid: "c", amount: 0 }]);
    expect(missing).toMatchObject({ selections_present: false });
    expect(flags(missing)).toEqual([false, false, false, false]);
    const check = { guid: "c", amount: 0, selections: { not: "an array" } };
    const lp = checkLinePrices(check, projectCheckSales(check, captureCents), lineCents);
    expect(lp.selections_present).toBe(false);
    expect(flags(lp)).toEqual([false, false, false, false]);
  });
  it("no heads: complete at amount 0, incomplete at amount 5", () => {
    const [zero, five] = lpOf([{ guid: "a", amount: 0, selections: [] }, { guid: "b", amount: 5, selections: [] }]);
    expect(flags(zero)).toEqual([true, true, true, true]);
    expect(flags(five)).toEqual([false, false, false, false]);
  });
  it("an excluded gift-card modifier under a normal head: net false, gross false, receipt true", () => {
    const [lp] = lpOf([{ guid: "c", amount: 12, selections: [head({ price: 12, preDiscountPrice: 12,
      modifiers: [{ guid: "g", item: { guid: "gc" }, quantity: 1, price: 2, preDiscountPrice: 2, selectionType: "TOAST_CARD_SELL" }] })] }]);
    expect(lp).toMatchObject({ heads: 1, mixed_heads: 1, net_cents: 1200 });
    expect(flags(lp)).toEqual([true, false, false, true]);
  });
  it("a voided modifier makes gross incomplete; net and receipt stay complete", () => {
    const lp = (on(valid("lp-voids")).checks[0]!.accounting as { line_prices: CheckLinePrices }).line_prices;
    expect(lp).toMatchObject({ heads: 1, mixed_heads: 1, net_cents: 1200 });
    expect(flags(lp)).toEqual([true, true, false, true]);
  });
  it("a gift-card root head is not a head; the rest of the check stays complete except its excluded descendant", () => {
    const lp = (on(valid("lp-giftcard")).checks[0]!.accounting as { line_prices: CheckLinePrices }).line_prices;
    expect(lp).toMatchObject({ heads: 1, uncaptured_heads: 0, net_cents: 1000 });
    const [clean] = lpOf([{ guid: "c", amount: 35, selections: [head(), head({ guid: "gift", price: 25, preDiscountPrice: 25, selectionType: "TOAST_CARD_SELL" })] }]);
    expect(clean).toMatchObject({ heads: 1, net_cents: 1000 });
    expect(flags(clean)).toEqual([true, true, true, true]);
  });
  it("a priced root special request: everything incomplete; a zero-priced one is ignored", () => {
    const [priced, free] = lpOf([
      { guid: "a", amount: 14, selections: [head(), { guid: "sr", selectionType: "SPECIAL_REQUEST", quantity: 1, price: 4 }] },
      { guid: "b", amount: 10, selections: [head({ guid: "h2" }), { guid: "sr2", selectionType: "SPECIAL_REQUEST", quantity: 1, price: 0 }] },
    ]);
    expect(priced).toMatchObject({ uncaptured_heads: 1 });
    expect(flags(priced)).toEqual([false, false, false, false]);
    expect(flags(free)).toEqual([true, true, true, true]);
  });
  it("a marketplace line whose receipt price differs from in-store is still complete", () => {
    const lp = (on(valid("lp-marketplace")).checks[0]!.accounting as { line_prices: CheckLinePrices }).line_prices;
    expect(flags(lp)).toEqual([true, true, true, true]);
  });
  it("a null receipt price or a zero quantity makes only receipt incomplete", () => {
    const [noReceipt, zeroQty] = lpOf([
      { guid: "a", amount: 10, selections: [head({ receiptLinePrice: null })] },
      { guid: "b", amount: 10, selections: [head({ guid: "h2", quantity: 0 })] },
    ]);
    expect(flags(noReceipt)).toEqual([true, true, true, false]);
    expect(flags(zeroQty)).toEqual([true, true, true, false]);
  });
  it("deleted and voided heads count as nothing", () => {
    const [lp] = lpOf([{ guid: "c", amount: 10, selections: [head(), head({ guid: "v", voided: true }), head({ guid: "d", deleted: true, price: 99 })] }]);
    expect(lp).toMatchObject({ heads: 1, net_cents: 1000 });
    expect(flags(lp)).toEqual([true, true, true, true]);
  });
});

describe("malformed prices through the full normalizer", () => {
  const raw = (label: string) => corpus.malformed.find((m) => m.label === label)!.raw;
  it("root price 'abc' (switch on): the capture succeeds, pre_refund and gross are null, net incomplete", () => {
    const o = on(raw("root price not money"));
    expect(o.checks[0]!.accounting).toMatchObject({ pre_refund_cents: null, gross_cents: null });
    expect(unit(o, "bad-root-s").net_cents).toBeNull();
    expect((o.checks[0]!.accounting as { line_prices: CheckLinePrices }).line_prices).toMatchObject({ net_cents: null, net_complete: false });
  });
  it("a malformed voided root preDiscountPrice (switch on): voids unknown, never zero", () => {
    expect(on(raw("root preDiscountPrice not money on a voided root")).checks[0]!.accounting).toMatchObject({ voids_cents: null, gross_cents: null });
  });
  it("modifier price {} (switch on): only that line's field is null", () => {
    const o = on(raw("modifier price is an object"));
    const off = normalizeToastOrder(raw("modifier price is an object"), "2026-10-08");
    expect(unit(o, "bad-mod-m").net_cents).toBeNull();
    expect(unit(o, "bad-mod-s").net_cents).toBe(1000);
    const { line_prices: _lp, ...accounting } = o.checks[0]!.accounting as { line_prices: unknown };
    expect(accounting).toEqual(off.checks[0]!.accounting);
  });
  it.each(["check amount not money", "discount amount not money", "refund amount not money", "service charge not money", "quantity missing on an item"])(
    "%s still throws with the switch on, exactly as main", (label) => {
      const frozen = corpus.malformed.find((m) => m.label === label)!.raw;
      let offError = "", onError = "";
      try { normalizeToastOrder(frozen, "2026-10-08"); } catch (e) { offError = (e as Error).message; }
      try { on(frozen); } catch (e) { onError = (e as Error).message; }
      expect(offError).toMatch(/^toast_capture_invalid_/);
      expect(onError).toBe(offError);
    });
});

describe("valid inputs: strict and lenient accounting are byte-identical", () => {
  it("the whole corpus gives deep-equal accounting through both parsers", () => {
    for (const o of corpus.valid) for (const c of o.checks) {
      expect(projectCheckSales(c as never, captureCents, lineCents)).toEqual(projectCheckSales(c as never, captureCents));
    }
  });
  it("property: generated valid checks give projectCheckSales(c, strict) ≡ projectCheckSales(c, strict, lineCents)", () => {
    let seed = 20261116;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const money = () => pick<unknown>([0, 1, 2.5, 10, 13.99, "4.20", "0.005", 1.005, -1, null, undefined]);
    const sel = (depth: number): Record<string, unknown> => ({
      guid: `s${Math.floor(rand() * 1e9)}`, item: rand() < 0.8 ? { guid: "i" } : null, quantity: pick([1, 2, 0.5]),
      price: money(), preDiscountPrice: money(), voided: rand() < 0.15, deleted: rand() < 0.1, deferred: rand() < 0.1,
      selectionType: pick([undefined, "NONE", "SPECIAL_REQUEST", "TOAST_CARD_SELL", "HOUSE_ACCOUNT_PAY_BALANCE"]),
      appliedDiscounts: rand() < 0.3 ? [{ nonTaxDiscountAmount: money() }] : [],
      modifiers: depth < 2 && rand() < 0.5 ? [sel(depth + 1), sel(depth + 1)] : [],
    });
    for (let n = 0; n < 2000; n++) {
      const check = { amount: money(), selections: rand() < 0.95 ? [sel(0), sel(0), sel(0)].slice(0, 1 + Math.floor(rand() * 3)) : undefined,
        appliedServiceCharges: rand() < 0.3 ? [{ chargeAmount: money(), gratuity: rand() < 0.5 }] : [], appliedDiscounts: [] };
      expect(projectCheckSales(check, captureCents, lineCents)).toEqual(projectCheckSales(check, captureCents));
    }
  });
});

// §3.3 / §3.4 coverage: the pure revenue helper phase 3 readers will call. A shop-day is covered for a
// measure only when the capture day is covered, every sale-class check is priced, and every priced
// check is complete for THAT measure. Anything else is uncovered with its counts — never 0.
describe("lineRevenue: per-measure coverage and sums over revenue heads", () => {
  const captured = (raws: unknown[]) => raws.map((raw) => on(raw));
  const input = (orders: ReturnType<typeof on>[], extra: Partial<Parameters<typeof lineRevenue>[0]> = {}) => ({
    captureCovered: true,
    checks: orders.flatMap((o) => o.checks.map((c) => ({ checkGuid: c.check_guid, saleClass: true, linePrices: (c.accounting as { line_prices?: CheckLinePrices }).line_prices ?? null }))),
    units: orders.flatMap((o) => o.order.selection_units),
    ...extra,
  });
  it("sums net, gross and receipt × quantity over heads only (modifiers never summed)", () => {
    const i = input(captured([valid("lp-instore"), valid("lp-marketplace")]));
    expect(lineRevenue(i, "net")).toMatchObject({ covered: true, cents: 2650 + 2798, checks: 2, unpriced: 0, incomplete: 0 });
    expect(lineRevenue(i, "gross")).toMatchObject({ covered: true, cents: 2750 + 2798 });
    expect(lineRevenue(i, "receipt_line")).toMatchObject({ covered: true, cents: 1150 * 2 + 250 + 1399 * 2 });
  });
  it("an uncovered capture day is uncovered for every measure, never 0", () => {
    for (const m of ["net", "gross", "receipt_line"] as const) {
      expect(lineRevenue(input(captured([valid("lp-instore")]), { captureCovered: false }), m)).toMatchObject({ covered: false, cents: null, reason: "capture_uncovered" });
    }
  });
  it("a sale check with no line prices (unpriced snapshot) is uncovered with its count", () => {
    const off = normalizeToastOrder(valid("lp-instore"), "2026-10-08");
    const i = input([on(valid("lp-marketplace")), off]);
    expect(lineRevenue(i, "net")).toMatchObject({ covered: false, cents: null, reason: "unpriced_checks", unpriced: 1, checks: 2 });
  });
  it("source_complete gates every measure; each measure has its own completeness", () => {
    const [mixed] = captured([valid("lp-voids")]); // voided modifier: net ok, gross refused
    expect(lineRevenue(input([mixed!]), "net")).toMatchObject({ covered: true, cents: 1200 });
    expect(lineRevenue(input([mixed!]), "gross")).toMatchObject({ covered: false, cents: null, reason: "incomplete_checks", incomplete: 1 });
    expect(lineRevenue(input([mixed!]), "receipt_line")).toMatchObject({ covered: true, cents: 1200 });
    const [uncaptured] = captured([valid("lp-uncaptured")]);
    for (const m of ["net", "gross", "receipt_line"] as const) expect(lineRevenue(input([uncaptured!]), m)).toMatchObject({ covered: false, cents: null });
  });
  it("non-sale checks (ezCater-linked, gift card, voided) are outside the population", () => {
    const orders = captured([valid("lp-instore"), valid("lp-uncaptured")]);
    const i = input(orders);
    i.checks = i.checks.map((c) => ({ ...c, saleClass: c.checkGuid === "lp-instore-c1" }));
    expect(lineRevenue(i, "net")).toMatchObject({ covered: true, cents: 2650, checks: 1 });
  });
  it("a day with no sale checks and a covered capture is a true zero", () => {
    expect(lineRevenue({ captureCovered: true, checks: [], units: [] }, "net")).toMatchObject({ covered: true, cents: 0, checks: 0 });
  });
});
