/**
 * Nav PR 6 (plan r3, 8.2): each read's REAL query, through the recording client (tests/helpers/fake-supabase.ts).
 */
import { describe, expect, it } from "vitest";
import { findPrepDayInstances } from "@/lib/checklist-day-instance";
import { loadPriorAmPrepStatus } from "@/lib/midshift";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

const SHOP = "11111111-1111-4111-8111-111111111111";
const filters = (c: FakeCall) => c.ops.filter((o) => o.op === "eq").map((o) => JSON.stringify(o.args));

describe("findPrepDayInstances: loadPriorAmPrepStatus's filters, every version, no limit, paged", () => {
  it("the same embed and the same equality filters (template type, subtype, shop, in the join)", async () => {
    const prior = fakeSupabase(() => ({ data: null }));
    await loadPriorAmPrepStatus(prior.client as never, { locationId: SHOP, date: "2026-11-18" });
    const priorCall = prior.calls.find((c) => c.table === "checklist_instances")!;

    const mine = fakeSupabase(() => ({ data: [] }));
    await findPrepDayInstances(mine.client as never, { locationId: SHOP, subtype: "am_prep", date: "2026-11-18", columns: "id, template_id, status, created_at" });
    const call = mine.calls[0]!;
    expect(call.table).toBe("checklist_instances");
    expect(filters(call)).toEqual(filters(priorCall));
    expect(String(call.arg("select"))).toContain("checklist_templates!inner(type, prep_subtype, location_id)");
    expect(String(priorCall.arg("select"))).toContain("checklist_templates!inner(type, prep_subtype, location_id)");
    expect(call.has("limit")).toBe(false);
    expect(call.has("maybeSingle")).toBe(false);
    expect(call.has("order", "created_at", { ascending: true })).toBe(true);
    expect(call.has("order", "id", { ascending: true })).toBe(true);
    expect(call.arg("range", 0)).toBe(0);
  });

  it("mid-day: the subtype filter follows the argument; pages past 1,000 rows; a read error throws", async () => {
    const rows = (from: number) => Array.from({ length: from === 0 ? 1000 : 2 }, (_, i) => ({ id: `i-${from + i}`, template_id: "t", status: "open", created_at: "x" }));
    const paged = fakeSupabase((c) => ({ data: rows(c.arg("range", 0) as number) }));
    const got = await findPrepDayInstances(paged.client as never, { locationId: SHOP, subtype: "mid_day_prep", date: "2026-11-18", columns: "id, template_id, status, created_at" });
    expect(got).toHaveLength(1002);
    expect(paged.calls.every((c) => c.has("eq", "checklist_templates.prep_subtype", "mid_day_prep"))).toBe(true);
    const bad = fakeSupabase(() => ({ error: { message: "down" } }));
    await expect(findPrepDayInstances(bad.client as never, { locationId: SHOP, subtype: "am_prep", date: "2026-11-18", columns: "id" })).rejects.toThrow(/findPrepDayInstances am_prep: .*down/);
  });
});
