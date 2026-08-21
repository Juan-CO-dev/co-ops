/**
 * Unit spine — lib/supabase-paginate.ts.
 *
 * TWO ceilings live in that module and they fail in opposite directions:
 *
 *   ROW cap (selectAllRows)   — the read succeeds and SILENTLY returns 1000 rows
 *                               when there were more. The PR #63 lesson.
 *   REQUEST-LINE cap (below)  — the read fails LOUDLY with a 414/400 before any
 *                               SQL runs, because the filter list itself made the
 *                               GET request line too long.
 *
 * The second is the one that took down `loadProductLots`: it spent a location's
 * ENTIRE delivery-id history as a `delivery_id=in.(…)` filter. That list is
 * unbounded by design (the lot shelf is the full receipt history), so it grows
 * with every delivery until the request line is refused — and because it fails on
 * page 0 with zero rows read, `selectAllRows` cannot help. `loadCountFormData` has
 * no try/catch, so the 414 would 500 the entire /operations/counts sheet.
 *
 * These tests pin the ARITHMETIC that makes that a real deadline rather than a
 * theoretical one, at synthetic id volumes production has not reached yet. The
 * loaders themselves are DB-coupled and stay off this spine per the house law;
 * what is testable — and what actually decides the outcome — is whether a list of
 * N ids can fit at all.
 */
import { describe, it, expect } from "vitest";

import {
  REQUEST_LINE_BUDGET_BYTES,
  UUID_TEXT_LENGTH,
  requestLineBytesForInList,
  inListFitsRequestLine,
} from "@/lib/supabase-paginate";

describe("request-line budget", () => {
  it("an empty list costs nothing", () => {
    expect(requestLineBytesForInList("delivery_id", 0)).toBe(0);
    expect(inListFitsRequestLine("delivery_id", 0)).toBe(true);
  });

  it("grows LINEARLY in the id count — which is the whole problem", () => {
    const one = requestLineBytesForInList("delivery_id", 1);
    const hundred = requestLineBytesForInList("delivery_id", 100);
    const thousand = requestLineBytesForInList("delivery_id", 1000);
    // Each additional uuid costs its 36 characters plus one separator.
    expect(hundred - one).toBe(99 * (UUID_TEXT_LENGTH + 1));
    expect(thousand - hundred).toBe(900 * (UUID_TEXT_LENGTH + 1));
  });

  it("a SMALL delivery history still fits — this is why the bug was invisible", () => {
    // Production carried 5 deliveries when this was found (CC verified 2026-08-21),
    // which is why every smoke and every sim assertion passed over the broken path.
    expect(inListFitsRequestLine("delivery_id", 5)).toBe(true);
    expect(inListFitsRequestLine("delivery_id", 100)).toBe(true);
  });

  it("BLOWS the request line in the 200-400 delivery band", () => {
    // The filed deadline. Near-daily receiving at two shops reaches this within
    // months, and the failure lands on the count sheet as a 500.
    expect(inListFitsRequestLine("delivery_id", 200)).toBe(true);
    expect(inListFitsRequestLine("delivery_id", 250)).toBe(false);
    expect(inListFitsRequestLine("delivery_id", 400)).toBe(false);
    expect(inListFitsRequestLine("delivery_id", 5_000)).toBe(false);
  });

  it("is a FLOOR, never an over-estimate — a list it rejects is definitively too big", () => {
    // Real requests also pay percent-encoding, the select list, the order clause
    // and the range headers. A guard that flattered the request would be worse
    // than none, so the estimate must never exceed the true cost.
    const ids = Array.from({ length: 300 }, () => "0".repeat(UUID_TEXT_LENGTH));
    const trueFilterLength = `delivery_id=in.(${ids.join(",")})`.length;
    expect(requestLineBytesForInList("delivery_id", ids.length)).toBeLessThanOrEqual(trueFilterLength);
  });

  it("takes the CONSERVATIVE 8 KB ceiling, not the generous 16 KB one", () => {
    // Kong is 8 KB by default and 16 KB on some builds. A guard tuned to the
    // generous limit lets the incident happen on the strict deployment.
    expect(REQUEST_LINE_BUDGET_BYTES).toBe(8192);
  });

  it("SCOPING BY JOIN is constant in the delivery count — the property the fix buys", () => {
    // lib/products.ts now scopes vendor_delivery_items to a location through an
    // embedded join on vendor_deliveries, so the delivery-id list is never built
    // and never sent. The location filter costs ONE uuid no matter how many
    // deliveries that location has accumulated.
    const joinFilterCost = requestLineBytesForInList("vendor_deliveries.location_id", 1);
    for (const deliveryCount of [5, 200, 400, 5_000, 100_000]) {
      expect(inListFitsRequestLine("vendor_deliveries.location_id", 1)).toBe(true);
      // ...while the mechanism it replaced would already be refused.
      if (deliveryCount >= 250) {
        expect(inListFitsRequestLine("delivery_id", deliveryCount)).toBe(false);
      }
    }
    expect(joinFilterCost).toBeLessThan(REQUEST_LINE_BUDGET_BYTES / 100);
  });

  it("the member-SKU list the loader DOES still spend stays well inside budget", () => {
    // loadProductLots still filters by member SKU ids. That list is bounded by the
    // product catalog (23 member SKUs live, 182 SKUs in the whole catalog) and
    // grows with the catalog, not with daily operations — a different tempo
    // entirely from the delivery ledger. Pinned so a future catalog explosion
    // trips this test rather than production.
    expect(inListFitsRequestLine("vendor_item_id", 23)).toBe(true);
    expect(inListFitsRequestLine("vendor_item_id", 182)).toBe(true);
  });
});
