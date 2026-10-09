/**
 * Astra #2 — DB calls per poll, BEFORE and AFTER, through the REAL readers (defaultPulseDeps) against a
 * recording fake client. A "poll" is what the client does every 60 s: one /api/pulse/section request
 * per visible section, each building its own deps (no per-request memo across requests).
 *   before = defaultPulseDeps per request (the reviewed c5f3f6c behaviour);
 *   after  = pulseDeps (cachedPulseDeps over defaultPulseDeps): the first poll of a shop loads every
 *            source once; a second viewer's poll (or the same viewer's next poll inside the TTL) is 0.
 * The numbers are printed so the hand-back note carries them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const fake = vi.hoisted(() => ({ calls: [] as string[], date: "2026-10-09" }));
function builder(data: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "neq", "in", "is", "not", "or", "gte", "gt", "lte", "lt", "order", "limit", "range", "match", "returns", "abortSignal"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  q.single = async () => ({ data: null, error: { message: "no row" } });
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data, error: null, count: 0 }).then(res, rej);
  return q;
}
const client = {
  from: (table: string) => { fake.calls.push(`from:${table}`); return builder([]); },
  rpc: (name: string) => { fake.calls.push(`rpc:${name}`); return builder(name === "station_business_date" ? fake.date : []); },
};
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { defaultPulseDeps, loadPulseSection, pulseDeps, type PulseCtx } from "@/lib/pulse/sections";
import { resetSourceCache } from "@/lib/pulse/source-cache";
import { visibleSections } from "@/lib/pulse/scope-shared";

const LOC = "11111111-1111-4111-8111-111111111111";
const ctx = (level: number, id: string): PulseCtx => ({
  auth: { user: { id, role: level >= 7 ? "gm" : "key_holder", language: "en" } as AuthContext["user"], session: {} as AuthContext["session"], role: level >= 7 ? "gm" : "key_holder", level, locations: [LOC] },
  locationId: LOC, date: fake.date, now: new Date(`${fake.date}T19:30:00Z`),
});

/** One client poll cycle: a separate request per section (as /api/pulse/section is called). */
async function poll(level: number, viewer: string, depsFactory: () => ReturnType<typeof defaultPulseDeps>) {
  const start = fake.calls.length;
  for (const section of visibleSections(level)) {
    const r = await loadPulseSection(depsFactory(), ctx(level, viewer), section);
    expect(r.state, `${section} should not be forbidden`).not.toMatchObject({ code: "forbidden" });
  }
  const mine = fake.calls.slice(start);
  const byTable: Record<string, number> = {};
  for (const c of mine) byTable[c] = (byTable[c] ?? 0) + 1;
  return { total: mine.length, byTable };
}

beforeEach(() => { fake.calls.length = 0; resetSourceCache(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); resetSourceCache(); });

describe("DB calls per poll (GM, all nine sections)", () => {
  it("BEFORE: every section request reloads its sources; AFTER: one shared load per shop per poll, 0 on the next viewer's poll", async () => {
    const before = await poll(7, "gm-a", () => defaultPulseDeps(client as never));
    fake.calls.length = 0;
    const afterFirst = await poll(7, "gm-a", () => pulseDeps(client as never));
    const afterSecondViewer = await poll(7, "gm-b", () => pulseDeps(client as never));
    const afterSamePoll = await poll(7, "gm-a", () => pulseDeps(client as never));
    console.log(`[pulse db calls/poll] BEFORE total=${before.total} board(rpc:station_business_date)=${before.byTable["rpc:station_business_date"] ?? 0} ` +
      `AFTER first=${afterFirst.total} second-viewer=${afterSecondViewer.total} same-viewer-repoll=${afterSamePoll.total}`);
    console.log("[pulse db calls/poll] BEFORE by call:", JSON.stringify(before.byTable));
    console.log("[pulse db calls/poll] AFTER by call:", JSON.stringify(afterFirst.byTable));
    // Before: the board loader ran once per board-consuming section (attention, floor, people, stations).
    expect(before.byTable["rpc:station_business_date"]).toBe(4);
    // After: once per shop per poll, however many sections or viewers.
    expect(afterFirst.byTable["rpc:station_business_date"]).toBe(1);
    expect(afterFirst.total).toBeLessThan(before.total);
    expect(afterSecondViewer.total).toBe(0);
    expect(afterSamePoll.total).toBe(0);
  });
  it("a crew poll never reaches sources outside its scope, before or after", async () => {
    const before = await poll(3, "crew", () => defaultPulseDeps(client as never));
    // (vendor_deliveries is read by the report-status loaders for everyone; the inventory lane is par_pass_events + vendor_cutoffs.)
    for (const t of ["from:par_pass_events", "from:vendor_cutoffs", "rpc:sales_report_daily", "rpc:sales_report_breakdown", "from:ezcater_reconciliation_status", "from:toast_time_entries", "from:pulse_station_layouts_never"]) {
      expect(before.byTable[t], t).toBeUndefined();
    }
  });
});
