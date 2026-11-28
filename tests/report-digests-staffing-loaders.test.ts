/**
 * Digests round 3, PR 2 fix round (F8): a throwing schedule reader is caught by its OWN small wrapper in both loaders.
 *
 * The shipped reader never throws, but a `ScheduleReader` that does could carry response text or a credential in its
 * message. Both loaders (the shop digest's `loadShopV2Facts`, the catering digest's `loadCateringFacts` through
 * `scheduleWindow`) log ONE fixed code (`[digests] schedule: reader_threw`) and nothing from the error, yield
 * `{ kind: "error" }` ("Schedule not available" for a permitted recipient), and never reject the load. Proven for a
 * rejected promise and for a synchronous throw: the marker appears in NO console call and in no returned fact.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduleReader } from "@/lib/report-digests-schedule-shared";

vi.mock("@/lib/toast/captured-day", () => ({ loadCapturedToastDay: vi.fn(async () => null) }));
vi.mock("@/lib/catering/booked-events", () => ({ loadBookedCateringEvents: vi.fn(async () => []) }));
vi.mock("@/lib/catering/not-in-toast", () => ({ readNotInToast: vi.fn(async () => []) }));
vi.mock("@/lib/toast/labor", () => ({ laborPullEnabled: () => false, runToastLaborPull: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no live client in tests"); } }));

import { loadCateringFacts, scheduleWindow } from "@/lib/report-digests";
import { loadShopV2Facts } from "@/lib/report-digests-v2";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const D = "2026-10-07";
const MARKER = "MARKER_tok_FAKE_do_not_leak response body";

/** A reader whose window rejects with the marker, and one whose `shopWindow` throws synchronously. */
const READERS: Array<[string, ScheduleReader]> = [
  ["rejects", { shopWindow: () => Promise.reject(new Error(MARKER)) }],
  ["throws synchronously", { shopWindow: () => { throw new Error(MARKER); } }],
];

/** Every read answers empty (no rows, no error): the other areas load as "nothing today". */
function emptyQuery(): unknown {
  const result = { data: [], error: null, count: 0 };
  const q: unknown = new Proxy(() => q, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      if (prop === "range") return () => q;
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
      return () => q;
    },
  });
  return q;
}
/** `locations` answers two active shops so the catering loader asks the reader for each. */
function fakeSb(): SupabaseClient {
  const shops = { data: [{ id: A }, { id: B }], error: null };
  const locations = (): unknown => {
    const q: unknown = new Proxy(() => q, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(shops).then(res, rej);
        return () => q;
      },
    });
    return q;
  };
  return { from: (table: string) => table === "locations" ? locations() : emptyQuery(), rpc: () => emptyQuery() } as unknown as SupabaseClient;
}

let spies: MockInstance[] = [];
beforeEach(() => {
  spies = (["error", "warn", "log", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { for (const s of spies) s.mockRestore(); });

/** No console call of any kind carried the marker (or any part of the error). */
function noMarkerLogged() {
  for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call.map(String))).not.toContain("MARKER");
}
const readerThrewLogged = () =>
  expect(spies[0]!.mock.calls.some((c) => c.length === 1 && c[0] === "[digests] schedule: reader_threw")).toBe(true);

describe("F8: a throwing schedule reader logs one fixed code and yields 'not available'", () => {
  for (const [how, reader] of READERS) {
    it(`loadShopV2Facts: a reader that ${how} → schedule { kind: "error" }, the load resolves, nothing of the error leaks`, async () => {
      const v = await loadShopV2Facts(fakeSb(), A, D, new Date("2026-10-08T02:00:00Z"), { schedule: reader });
      expect(v.schedule).toEqual({ kind: "error" });
      expect(JSON.stringify(v)).not.toContain("MARKER");
      readerThrewLogged();
      noMarkerLogged();
    });

    it(`loadCateringFacts: a reader that ${how} → every shop's schedule { kind: "error" }, the load resolves, nothing leaks`, async () => {
      const f = await loadCateringFacts(fakeSb(), D, new Date("2026-10-07T11:00:00Z"), { schedule: reader });
      expect(f.schedule).toEqual({ [A]: { kind: "error" }, [B]: { kind: "error" } });
      expect(JSON.stringify(f)).not.toContain("MARKER");
      readerThrewLogged();
      noMarkerLogged();
    });

    it(`scheduleWindow (the catering wrapper) alone: a reader that ${how}`, async () => {
      await expect(scheduleWindow(reader, A, D, "2026-10-08")).resolves.toEqual({ kind: "error" });
      expect(spies[0]!.mock.calls).toEqual([["[digests] schedule: reader_threw"]]);
      noMarkerLogged();
    });
  }
});
