// Juan's ruling 2026-11-15 on audit W01/B001 (review W01-r3 P1, lib/portal/draft-shared.ts): when two or
// more active delivery zones cover an order, charge the MOST EXPENSIVE one ("cheapest may have us lose
// money"), record it, and enforce its minimum. A delivery order with no zone is refused, never free.
// Staff acceptance re-checks the same rule. The submit paths live in tests/portal-draft-w01.test.ts and
// the SQL twin in scripts/sql-harness-0302.mjs.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSupabaseMock } from "./helpers/supabase-mock";
import {
  acceptDeliveryRefusal,
  portalDeliveryInfo,
  portalDeliveryRefusal,
  resolvePortalDeliveryZone,
  reviewFailure,
} from "@/lib/portal/draft-shared";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
import { getServiceRoleClient } from "@/lib/supabase-server";
import { setQuoteStatus } from "@/lib/catering/quotes";

const A = "aaaaaaaa-0000-4000-8000-000000000000";
const B = "bbbbbbbb-0000-4000-8000-000000000000";
const C = "cccccccc-0000-4000-8000-000000000000";

describe("resolvePortalDeliveryZone", () => {
  it("pickup: no zone, no fee", () => {
    expect(resolvePortalDeliveryZone([{ id: A, feeCents: 900 }], false)).toEqual({ zoneId: null, feeCents: 0, minOrderCents: null, reason: "pickup" });
  });
  it("delivery with no active zone: unresolved (refused at submit, never free)", () => {
    const z = resolvePortalDeliveryZone([], true);
    expect(z).toMatchObject({ zoneId: null, reason: "no_zones" });
    expect(portalDeliveryRefusal(z, 1_000_000)).toBe("delivery_unavailable");
  });
  it("one zone: that zone, its fee and its minimum", () => {
    expect(resolvePortalDeliveryZone([{ id: A, feeCents: 1500, minOrderCents: 5000 }], true)).toEqual({ zoneId: A, feeCents: 1500, minOrderCents: 5000, reason: "single_zone" });
  });
  it("two or more zones: the MORE EXPENSIVE one, whatever the row order", () => {
    const zones = [{ id: A, feeCents: 1500 }, { id: B, feeCents: 3500, minOrderCents: 8000 }, { id: C, feeCents: 2500 }];
    for (const order of [zones, [...zones].reverse(), [zones[1]!, zones[0]!, zones[2]!]]) {
      expect(resolvePortalDeliveryZone(order, true)).toEqual({ zoneId: B, feeCents: 3500, minOrderCents: 8000, reason: "highest_fee" });
    }
  });
  it("a fee tie goes to the higher minimum, then the lower id (the order 0302 uses)", () => {
    expect(resolvePortalDeliveryZone([{ id: A, feeCents: 2000, minOrderCents: null }, { id: B, feeCents: 2000, minOrderCents: 6000 }], true).zoneId).toBe(B);
    expect(resolvePortalDeliveryZone([{ id: B, feeCents: 2000 }, { id: A, feeCents: 2000 }], true).zoneId).toBe(A);
  });
});

describe("the delivery minimum", () => {
  const z = resolvePortalDeliveryZone([{ id: A, feeCents: 1500, minOrderCents: 8000 }], true);
  it("exactly AT the minimum passes; one cent under refuses with the amount still needed", () => {
    expect(portalDeliveryRefusal(z, 8000)).toBeNull();
    expect(portalDeliveryRefusal(z, 7999)).toBe("below_delivery_minimum");
    expect(portalDeliveryInfo(z, 7999)).toEqual({ isDelivery: true, zoneId: A, feeCents: 1500, minOrderCents: 8000, shortByCents: 1, refusal: "below_delivery_minimum" });
    expect(portalDeliveryInfo(z, 8000)).toMatchObject({ shortByCents: 0, refusal: null });
  });
  it("no minimum on the zone: any subtotal passes; pickup is never held to one", () => {
    expect(portalDeliveryRefusal(resolvePortalDeliveryZone([{ id: A, feeCents: 1500, minOrderCents: null }], true), 1)).toBeNull();
    expect(portalDeliveryRefusal(resolvePortalDeliveryZone([{ id: A, feeCents: 1500, minOrderCents: 8000 }], false), 1)).toBeNull();
  });
});

describe("acceptDeliveryRefusal (staff accepting a self-serve delivery order)", () => {
  const order = { origin: "self_serve", isDelivery: true, deliveryZoneId: B, deliveryFeeCents: 3500, subtotalCents: 10000 };
  const zones = [{ id: A, feeCents: 1500 }, { id: B, feeCents: 3500, minOrderCents: 8000 }];
  it("passes when the order carries the zone and fee the rule picks today and meets its minimum", () => {
    expect(acceptDeliveryRefusal(order, zones)).toBeNull();
  });
  it("an order priced free (no zone) or on the cheaper zone is refused: revise first", () => {
    expect(acceptDeliveryRefusal({ ...order, deliveryZoneId: null, deliveryFeeCents: 0 }, zones)).toBe("delivery_fee_changed");
    expect(acceptDeliveryRefusal({ ...order, deliveryZoneId: A, deliveryFeeCents: 1500 }, zones)).toBe("delivery_fee_changed");
    expect(acceptDeliveryRefusal(order, [{ id: B, feeCents: 4000, minOrderCents: 8000 }])).toBe("delivery_fee_changed");
  });
  it("no active zone today, or under the minimum: refused by name", () => {
    expect(acceptDeliveryRefusal(order, [])).toBe("delivery_unavailable");
    expect(acceptDeliveryRefusal({ ...order, subtotalCents: 7999 }, zones)).toBe("below_delivery_minimum");
    expect(acceptDeliveryRefusal({ ...order, subtotalCents: 8000 }, zones)).toBeNull();
  });
  it("pickup and staff-built quotes are not re-judged (staff chose their zone)", () => {
    expect(acceptDeliveryRefusal({ ...order, isDelivery: false }, [])).toBeNull();
    expect(acceptDeliveryRefusal({ ...order, origin: "staff", deliveryZoneId: null, deliveryFeeCents: 0 }, [])).toBeNull();
  });
});

describe("setQuoteStatus(accepted) re-checks a self-serve delivery order", () => {
  const LOC = "11111111-1111-4111-8111-111111111111";
  const actor = { user: { id: "u-1", role: "owner" }, locations: [LOC] } as never;
  const quote = { id: "q-1", location_id: LOC, status: "submitted", superseded_at: null, origin: "self_serve", is_delivery: true, delivery_zone_id: B, delivery_fee_cents: 3500, subtotal_cents: 10000 };
  let sb: ReturnType<typeof makeSupabaseMock>;
  const wire = (q: Record<string, unknown>, zones: Array<Record<string, unknown>>) => {
    sb = makeSupabaseMock({
      table: (table, ops) => {
        if (table === "catering_quotes" && ops.includes("maybeSingle")) return { data: q };
        if (table === "catering_delivery_zones") return { data: zones };
        if (table === "catering_quotes" && ops.includes("update")) return { count: 1 };
        return {};
      },
    });
    vi.mocked(getServiceRoleClient).mockReturnValue(sb.client as never);
  };
  beforeEach(() => vi.mocked(getServiceRoleClient).mockReset());

  it("accepts when the order carries today's most expensive zone and meets its minimum", async () => {
    wire(quote, [{ id: A, fee_cents: 1500, min_order_cents: null }, { id: B, fee_cents: 3500, min_order_cents: 8000 }]);
    await setQuoteStatus(actor, "q-1", "accepted");
    expect(sb.wrote("catering_quotes")).toBe(true);
  });
  it("refuses (and writes nothing) an order priced free, under the minimum, or with no zone left at the shop", async () => {
    for (const [q, zones, code] of [
      [{ ...quote, delivery_zone_id: null, delivery_fee_cents: 0 }, [{ id: B, fee_cents: 3500, min_order_cents: null }], "delivery_fee_changed"],
      [{ ...quote, subtotal_cents: 7999 }, [{ id: B, fee_cents: 3500, min_order_cents: 8000 }], "below_delivery_minimum"],
      [quote, [], "delivery_unavailable"],
    ] as const) {
      wire(q, [...zones]);
      await expect(setQuoteStatus(actor, "q-1", "accepted")).rejects.toMatchObject({ status: 409, code });
      expect(sb.wrote("catering_quotes")).toBe(false);
    }
  });
  it("declining is never blocked by delivery, and a staff-built quote keeps its chosen zone", async () => {
    wire({ ...quote, delivery_zone_id: null, delivery_fee_cents: 0 }, []);
    await setQuoteStatus(actor, "q-1", "declined");
    expect(sb.tableCalls.some((c) => c.table === "catering_delivery_zones")).toBe(false);
    wire({ ...quote, origin: "staff", delivery_zone_id: A, delivery_fee_cents: 1500 }, [{ id: B, fee_cents: 3500, min_order_cents: null }]);
    await setQuoteStatus(actor, "q-1", "accepted");
    expect(sb.wrote("catering_quotes")).toBe(true);
  });
});

describe("the review page and the staff screen speak these refusals", () => {
  it("reviewFailure maps the submit refusals to their own messages", () => {
    expect(reviewFailure(409, "delivery_unavailable", true)).toBe("delivery_unavailable");
    expect(reviewFailure(409, "below_delivery_minimum", true)).toBe("below_delivery_minimum");
  });
  it("en + es keys exist for every new message", () => {
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    for (const k of ["order.review.delivery_minimum", "order.review.delivery_minimum_short", "order.review.delivery_minimum_generic", "order.review.delivery_unavailable",
      "catering.quotes.error.delivery_unavailable", "catering.quotes.error.below_delivery_minimum", "catering.quotes.error.delivery_fee_changed"]) {
      expect(en[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["order.review.delivery_minimum_short"]).toContain("{min}");
    expect(es["order.review.delivery_minimum_short"]).toContain("{short}");
  });
  it("the review page shows the minimum, holds Submit while delivery is refused, and the staff screen knows the codes", () => {
    const page = readFileSync("app/order/review/page.tsx", "utf8");
    expect(page).toContain('t("order.review.delivery_minimum", { min: centsToMoney(delivery.minOrderCents) })');
    expect(page).toContain("disabled={submitting || deliveryBlock != null}");
    const shared = readFileSync("components/catering/quotes/shared.ts", "utf8");
    for (const code of ["delivery_unavailable", "below_delivery_minimum", "delivery_fee_changed"]) expect(shared).toContain(`"${code}"`);
  });
});
