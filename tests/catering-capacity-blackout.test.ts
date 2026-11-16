/**
 * Audit W22 — the capacity check (lib/catering/capacity.ts).
 *   B202: an event that is OUT for delivery still holds its day (booked = CATERING_BOOKED_STAGES).
 *   B123: a blackout counts even with no caps seeded; public delivery routing and the pickup check read the ONE
 *         rule (isBookableSignal); a date no shop can take is a WARNING + flag, never a refusal (W22-2 modified).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkCateringCapacity, isBookableSignal } from "@/lib/catering/capacity";
import { routeDelivery, orderDateNeedsReview } from "@/lib/catering/fulfillment-routing";
import { checkPickupDateAction } from "@/app/order/start/actions";
import { readFileSync } from "node:fs";
import { CATERING_BOOKED_STAGES } from "@/lib/catering/fulfillment-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

let policy: Record<string, unknown> | null;
let blackout: boolean;
let leads: Array<{ id: string; headcount: number | null; stage: string }>;
let blackoutAt: Set<string> | null;
let leadStage: string;
let calls: FakeCall[];

function install() {
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_capacity_policy") return { data: policy };
    if (call.table === "catering_blackout_dates") {
      const loc = call.arg("eq", 1) as string;
      return { data: (blackoutAt ? blackoutAt.has(loc) : blackout) ? { id: "b1" } : null };
    }
    if (call.table === "catering_fulfillment_nodes") {
      return { data: [
        { location_id: "11111111-1111-4111-8111-111111111111", lat: 38.9, lng: -77.0, delivery_radius_meters: 10000, offers_delivery: true, offers_pickup: true },
        { location_id: "22222222-2222-4222-8222-222222222222", lat: 38.95, lng: -77.0, delivery_radius_meters: 10000, offers_delivery: true, offers_pickup: true },
      ] };
    }
    if (call.table === "locations") return { data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Near" }, { id: "22222222-2222-4222-8222-222222222222", name: "Far" }] };
    if (call.table === "catering_pipeline" && call.ops.some((o) => o.op === "maybeSingle")) return { data: { stage: leadStage } };
    if (call.table === "catering_pipeline") {
      const stages = call.arg("in", 1) as string[];
      return { data: leads.filter((l) => stages.includes(l.stage)) };
    }
    if (call.table === "catering_orders") return { data: [] };
    return { data: null };
  });
  calls = fake.calls;
  vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
}

beforeEach(() => {
  policy = { max_covers_per_day: 200, max_events_per_day: 2, min_lead_time_hours: null };
  blackout = false;
  blackoutAt = null;
  leadStage = "inquiry";
  leads = [];
  install();
});

describe("B202: booked stages include out", () => {
  it("counts the booked stages from the one shared definition", async () => {
    await checkCateringCapacity({ locationId: "L", eventDate: "2030-01-10", requestedCovers: 10 });
    const pipe = calls.find((c) => c.table === "catering_pipeline")!;
    expect(pipe.arg("in", 0)).toBe("stage");
    expect(pipe.arg("in", 1)).toEqual([...CATERING_BOOKED_STAGES]);
  });

  it("an event out for delivery still uses the day's covers", async () => {
    leads = [{ id: "A", headcount: 150, stage: "out" }];
    const r = await checkCateringCapacity({ locationId: "L", eventDate: "2030-01-10", requestedCovers: 100 });
    expect(r.consumedCovers).toBe(150);
    expect(r.consumedEvents).toBe(1);
    expect(r.signal).toBe("unavailable");
  });
});

const NEAR = "11111111-1111-4111-8111-111111111111";
const FAR = "22222222-2222-4222-8222-222222222222";

describe("B123: blackout precedence and the one bookable rule", () => {
  it("a blackout with NO capacity policy is still a blackout (not 'unconfigured')", async () => {
    policy = null;
    blackout = true;
    const r = await checkCateringCapacity({ locationId: "L", eventDate: "2030-01-10", requestedCovers: 10 });
    expect(r.signal).toBe("blackout");
    expect(isBookableSignal(r)).toBe(false);
  });

  it("no policy and no blackout stays advisory (bookable)", async () => {
    policy = null;
    const r = await checkCateringCapacity({ locationId: "L", eventDate: "2030-01-10", requestedCovers: 10 });
    expect(r.signal).toBe("unconfigured");
    expect(isBookableSignal(r)).toBe(true);
  });

  it.each([["available", true], ["limited", true], ["unconfigured", true], ["unavailable", false], ["below_lead_time", false], ["blackout", false]] as const)(
    "isBookableSignal(%s) = %s", (signal, ok) => {
      expect(isBookableSignal({ signal, isBlackout: signal === "blackout" })).toBe(ok);
    });
});

describe("B123: public delivery routing", () => {
  it("skips a blacked-out nearer shop and routes to the next", async () => {
    blackoutAt = new Set([NEAR]);
    const r = await routeDelivery({ lat: 38.9, lng: -77.0, eventDate: "2030-01-10", headcount: 20 });
    expect(r).toMatchObject({ status: "routed", locationId: FAR });
    expect("dateUnavailable" in r && r.dateUnavailable).toBeFalsy();
  });

  it("when NO in-zone shop can take the date: the nearest, flagged dateUnavailable — never a refusal", async () => {
    blackoutAt = new Set([NEAR, FAR]);
    const r = await routeDelivery({ lat: 38.9, lng: -77.0, eventDate: "2030-01-10", headcount: 20 });
    expect(r).toMatchObject({ status: "routed", locationId: NEAR, dateUnavailable: true });
  });

  it("no date yet → the nearest, no warning", async () => {
    blackoutAt = new Set([NEAR, FAR]);
    const r = await routeDelivery({ lat: 38.9, lng: -77.0, eventDate: null, headcount: 20 });
    expect(r).toMatchObject({ status: "routed", locationId: NEAR });
    expect("dateUnavailable" in r && r.dateUnavailable).toBeFalsy();
  });
});

describe("B123: the pickup check and the order flag", () => {
  it("pickup on a blacked-out date answers bookable: false (the page warns)", async () => {
    blackoutAt = new Set([NEAR]);
    expect(await checkPickupDateAction({ locationId: NEAR, eventDate: "2030-01-10", headcount: 20 })).toEqual({ bookable: false });
    expect(await checkPickupDateAction({ locationId: FAR, eventDate: "2030-01-10", headcount: 20 })).toEqual({ bookable: true });
  });

  it("a malformed shop id is not judged (no warning, never a throw)", async () => {
    expect(await checkPickupDateAction({ locationId: "nope", eventDate: "2030-01-10", headcount: 20 })).toEqual({ bookable: true });
  });

  it("an unaccepted order on an unavailable date needs review; a confirmed one never does (it always pays)", async () => {
    blackoutAt = new Set([NEAR]);
    expect(await orderDateNeedsReview({ pipelineId: "P", locationId: NEAR, eventDate: "2030-01-10", headcount: 20 })).toBe(true);
    leadStage = "confirmed";
    expect(await orderDateNeedsReview({ pipelineId: "P", locationId: NEAR, eventDate: "2030-01-10", headcount: 20 })).toBe(false);
  });

  it("source pins: submit flags (never refuses), the order page warns, payment is not refused", () => {
    const draft = readFileSync("lib/portal/draft.ts", "utf8");
    const page = readFileSync("app/order/quote/[id]/page.tsx", "utf8");
    const pay = readFileSync("lib/portal/quotes.ts", "utf8");
    const start = readFileSync("app/order/start/start-client.tsx", "utf8");
    expect(draft).toContain("const dateFlagged = await flagUnavailableDate(sb, quoteId, header);");
    expect(draft).toContain("Confirm to accept the order, or mark it Lost to refuse.");
    expect(page).toContain('t("order.quote.date_needs_review")');
    expect(pay).not.toContain("date_unavailable");
    expect(start).toContain('t("order.start.date_warning" as TranslationKey)');
    // the warning never joins the Continue gate
    expect(start).not.toMatch(/deliveryBlocked[^;]*dateUnavailable/);
    expect(start).not.toMatch(/canSubmit[\s\S]{0,300}pickupDateWarning/);
  });
});
