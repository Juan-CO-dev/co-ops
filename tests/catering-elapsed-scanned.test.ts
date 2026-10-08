import { beforeEach, expect, it, vi } from "vitest";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

/**
 * Digest polish item 9: scanned ezCater / Toast catering orders land `confirmed`; the nightly
 * rollover must complete them once their date has passed, exactly like a phone order. Pinned
 * here: the candidate query filters on STAGE and DATE only (never on lead_source), and a scanned
 * lead moves confirmed → completed with the auto note.
 */
const calls: Array<{ op: string; col?: string; val?: unknown }> = [];
const updated: string[] = [];
const events: Array<{ pipeline_id: string; from_stage: string; to_stage: string; note: string }> = [];

beforeEach(() => {
  calls.length = 0; updated.length = 0; events.length = 0;
  const rows = [
    { id: "ez", stage: "confirmed", location_id: "L", lead_source: "ezcater" },
    { id: "toast", stage: "out", location_id: "L", lead_source: "toast_catering" },
    { id: "phone", stage: "confirmed", location_id: "L", lead_source: "phone" },
  ];
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from(table: string) {
      if (table === "catering_pipeline_events") return { insert: (row: (typeof events)[number]) => { events.push(row); return { abortSignal: async () => ({ error: null }) }; } };
      const q: Record<string, unknown> = {
        select: () => q,
        in: (col: string, val: unknown) => { calls.push({ op: "in", col, val }); return q; },
        lt: (col: string, val: unknown) => { calls.push({ op: "lt", col, val }); return q; },
        eq: (col: string, val: unknown) => { calls.push({ op: "eq", col, val }); if (col === "id") updated.push(val as string); return q; },
        returns: async () => ({ data: rows.map((r) => ({ id: r.id, stage: r.stage, location_id: r.location_id })), error: null }),
        update: () => q,
        abortSignal: async () => ({ error: null, count: 1 }),
      };
      return q;
    },
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});

it("selects elapsed confirmed/out leads by stage and date only, so scanned platform orders are included", async () => {
  const res = await completeElapsedCateringEvents("2026-10-08");
  expect(calls).toContainEqual({ op: "in", col: "stage", val: ["confirmed", "out"] });
  expect(calls).toContainEqual({ op: "lt", col: "event_date", val: "2026-10-08" });
  expect(calls.some((c) => c.col === "lead_source" || c.col === "external_ref")).toBe(false);
  expect(res.completed.sort()).toEqual(["ez", "phone", "toast"]);
  expect(events.filter((e) => e.to_stage === "completed").map((e) => [e.pipeline_id, e.from_stage, e.note])).toEqual([
    ["ez", "confirmed", "auto: event date passed"],
    ["toast", "out", "auto: event date passed"],
    ["phone", "confirmed", "auto: event date passed"],
  ]);
});
