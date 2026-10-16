import { afterEach, describe, expect, it, vi } from "vitest";
import { operationalDayUtcRange } from "@/lib/operational-day";
import { stubUtcDateParsing } from "./helpers/utc-date";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));

import { checkCateringCapacity } from "@/lib/catering/capacity";
import { routeDelivery } from "@/lib/catering/fulfillment-routing";

const DAYS = [
  ["2026-07-10", "2026-07-10T04:00:00.000Z"],
  ["2026-01-14", "2026-01-14T05:00:00.000Z"],
  ["2026-11-01", "2026-11-01T04:00:00.000Z"],
  ["2027-03-14", "2027-03-14T05:00:00.000Z"],
] as const;

function client() {
  const data: Record<string, unknown> = {
    catering_capacity_policy: { max_covers_per_day: null, max_events_per_day: null, min_lead_time_hours: 1 },
    catering_blackout_dates: null,
    catering_pipeline: [],
    catering_orders: [],
    catering_fulfillment_nodes: [{ location_id: "shop", lat: 38.9, lng: -77.03, delivery_radius_meters: 1000,
      offers_delivery: true, offers_pickup: true }],
    locations: [{ id: "shop", name: "Shop" }],
  };
  return { from(table: string) {
    const query = {
      select: () => query, eq: () => query, is: () => query, in: () => query,
      maybeSingle: async () => ({ data: data[table], error: null }),
      returns: async () => ({ data: data[table], error: null }),
    };
    return query;
  } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("catering lead time uses the start of the ET event day", () => {
  it.each(DAYS)("capacity on %s", async (day, startIso) => {
    mocks.client.mockReturnValue(client());
    expect(operationalDayUtcRange(day).startIso).toBe(startIso);
    const start = Date.parse(startIso);
    const tooLate = await checkCateringCapacity({ locationId: "shop", eventDate: day, requestedCovers: 1,
      now: new Date(start - 30 * 60_000) });
    expect(tooLate).toMatchObject({ meetsLeadTime: false, signal: "below_lead_time" });
    const onTime = await checkCateringCapacity({ locationId: "shop", eventDate: day, requestedCovers: 1,
      now: new Date(start - 90 * 60_000) });
    expect(onTime).toMatchObject({ meetsLeadTime: true, signal: "available" });
  });

  it.each(DAYS)("delivery routing on %s", async (day, startIso) => {
    mocks.client.mockReturnValue(client());
    const start = Date.parse(startIso);
    vi.useFakeTimers();
    vi.setSystemTime(start - 30 * 60_000);
    stubUtcDateParsing();
    expect(await routeDelivery({ lat: 38.9, lng: -77.03, eventDate: day, headcount: 1 })).toEqual({ status: "no_capacity" });
    vi.setSystemTime(start - 90 * 60_000);
    expect(await routeDelivery({ lat: 38.9, lng: -77.03, eventDate: day, headcount: 1 })).toMatchObject({ status: "routed", locationId: "shop" });
  });

  it.each(["bad-date", "2026-7-10", "2026-07-10T00:00:00Z"])(
    "malformed date %s fails the capacity and routing lead-time gates without throwing",
    async (eventDate) => {
      mocks.client.mockReturnValue(client());
      const capacity = await checkCateringCapacity({ locationId: "shop", eventDate, requestedCovers: 1 });
      expect(capacity).toMatchObject({ meetsLeadTime: false, signal: "below_lead_time" });
      expect(await routeDelivery({ lat: 38.9, lng: -77.03, eventDate, headcount: 1 })).toEqual({ status: "no_capacity" });
    },
  );
});
