/**
 * Audit W22 — the capacity check (lib/catering/capacity.ts).
 *   B202: an event that is OUT for delivery still holds its day (booked = CATERING_BOOKED_STAGES).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkCateringCapacity } from "@/lib/catering/capacity";
import { CATERING_BOOKED_STAGES } from "@/lib/catering/fulfillment-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

let policy: Record<string, unknown> | null;
let blackout: boolean;
let leads: Array<{ id: string; headcount: number | null; stage: string }>;
let calls: FakeCall[];

function install() {
  const fake = fakeSupabase((call) => {
    if (call.table === "catering_capacity_policy") return { data: policy };
    if (call.table === "catering_blackout_dates") return { data: blackout ? { id: "b1" } : null };
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
