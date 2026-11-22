/**
 * Nav PR 6 (plan r3, 4.2 and 8.9): the route operations `mid_day_trigger` and `not_phase_station`, through the REAL
 * writers in lib/assignments.ts over the recording client. The GM gate and step-up B come first; the key allowlist and
 * a boolean `on` are checked before any I/O; ruling B3: a direct request for a non-floor station is 409
 * station_not_floor with NO RPC and NO audit row; the functions' codes map (404, 409, 503); a change is audited.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";
import { fakeSupabase, type FakeCall, type FakeRpc } from "./helpers/fake-supabase";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FLOOR = "33333333-3333-4333-8333-333333333333";
const UNSTAFFED = "44444444-4444-4444-8444-444444444444";
const NO_POSITION = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(), audit: vi.fn(), client: null as unknown, rpc: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: mocks.step }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => mocks.client }));
import { POST } from "@/app/api/admin/stations/route";

const STATIONS: Record<string, { id: string; active: boolean; staffed: boolean; positions: boolean[] }> = {
  [FLOOR]: { id: FLOOR, active: true, staffed: true, positions: [false, true] },
  [UNSTAFFED]: { id: UNSTAFFED, active: true, staffed: false, positions: [true] },
  [NO_POSITION]: { id: NO_POSITION, active: true, staffed: true, positions: [false] },
};
let fake: ReturnType<typeof fakeSupabase>;
let rpcAnswer: { data?: unknown; error?: unknown };
function respond(c: FakeCall) {
  const id = (c.arg("eq", 1) as string) ?? "";
  const shop = c.ops.filter((o) => o.op === "eq" && o.args[0] === "location_id").map((o) => o.args[1])[0];
  const s = shop === SHOP ? STATIONS[c.table === "stations" ? id : (c.ops.find((o) => o.args[0] === "station_id")?.args[1] as string)] : undefined;
  if (c.table === "stations") return { data: s ? { id: s.id, active: s.active, staffed: s.staffed } : null };
  if (c.table === "station_positions") return { data: (s?.positions ?? []).map((active) => ({ active })) };
  return { data: null };
}
beforeEach(() => {
  vi.clearAllMocks();
  rpcAnswer = { data: { changed: true, previous_station_id: null, cleared_mid_day: false } };
  fake = fakeSupabase(respond, (r: FakeRpc) => { mocks.rpc(r); return rpcAnswer; });
  mocks.client = fake.client;
  mocks.session.mockResolvedValue({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, role: "gm", level: 7, locations: [SHOP] });
  mocks.step.mockReturnValue({ ok: true });
});
const request = (data: Record<string, unknown>) => new NextRequest("http://localhost/api/admin/stations",
  { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify(data) });
const OPS = ["mid_day_trigger", "not_phase_station"] as const;
const ACTION = { mid_day_trigger: "station.mid_day_trigger", not_phase_station: "station.not_phase_station" } as const;
const FN = { mid_day_trigger: "set_station_mid_day_trigger", not_phase_station: "set_station_not_phase" } as const;
const ok = (operation: string, p: Record<string, unknown> = {}) => ({ operation, locationId: SHOP, stationId: FLOOR, on: true, ...p });

describe.each(OPS)("route operation %s", (operation) => {
  it.each([3, 4, 5, 6])("level %s → 403 before any I/O", async (level) => {
    mocks.session.mockResolvedValue({ user: { id: "x" }, role: "agm", level, locations: [SHOP] });
    const res = await POST(request(ok(operation)));
    expect(res.status).toBe(403);
    expect(fake.calls).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("no step-up → 403 step_up_required, nothing read or saved; step-up B is the tier", async () => {
    mocks.step.mockReturnValue({ ok: false, code: "step_up_required" });
    const res = await POST(request(ok(operation)));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_required");
    expect(fake.calls).toEqual([]);
    expect(mocks.step).toHaveBeenLastCalledWith(expect.anything(), "B");
  });

  it("a GM who is not a member of the shop → location_access_denied, no I/O", async () => {
    mocks.session.mockResolvedValue({ user: { id: "x" }, role: "gm", level: 7, locations: [OTHER] });
    const res = await POST(request(ok(operation)));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("location_access_denied");
    expect(fake.calls).toEqual([]);
  });

  it("an extra key or a non-boolean on → 400 before any I/O", async () => {
    for (const bad of [ok(operation, { extra: 1 }), ok(operation, { on: "true" }), ok(operation, { on: undefined }), ok(operation, { stationId: 5 })]) {
      expect((await POST(request(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(fake.calls).toEqual([]);
  });

  it("a floor station: the RPC once with exactly its arguments; a change is audited", async () => {
    const res = await POST(request(ok(operation)));
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith({ name: FN[operation], args: { p_actor_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", p_location_id: SHOP, p_station_id: FLOOR, p_on: true } });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit.mock.calls[0]![0]).toMatchObject({ action: ACTION[operation], resourceTable: "stations", resourceId: FLOOR, metadata: { location_id: SHOP, on: true } });
  });

  it("unchanged → no audit row", async () => {
    rpcAnswer = { data: { changed: false, previous_station_id: null, cleared_mid_day: false } };
    expect((await POST(request(ok(operation)))).status).toBe(200);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([true, false])("ruling B3, on=%s: an unstaffed station and a station with no active position → 409 station_not_floor, no RPC, no audit", async (on) => {
    for (const stationId of [UNSTAFFED, NO_POSITION]) {
      const res = await POST(request(ok(operation, { stationId, on })));
      expect(res.status, stationId).toBe(409);
      expect((await res.json()).code).toBe("station_not_floor");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(fake.calls.filter((c) => c.kind !== "select")).toEqual([]);
  });

  it("a station of another shop → 404 station_unavailable, no RPC", async () => {
    mocks.session.mockResolvedValue({ user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, role: "moo", level: 8, locations: [] });
    const res = await POST(request(ok(operation, { locationId: OTHER })));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("station_unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("the functions' codes map: conflict and not-phase 409, not installed 503, a refusal by the SQL who-check 403", async () => {
    const cases: Array<[unknown, number, string]> = [
      [{ message: "mid_day_trigger_conflict", code: "P0001" }, 409, "mid_day_trigger_conflict"],
      [{ message: "station_not_phase", code: "P0001" }, 409, "station_not_phase"],
      [{ message: "Could not find the function", code: "PGRST202" }, 503, "station_flags_unavailable"],
      [{ message: "function does not exist", code: "42883" }, 503, "station_flags_unavailable"],
      [{ message: "station_unavailable", code: "P0001" }, 403, "station_unavailable"],
      [{ message: "role_insufficient", code: "P0001" }, 403, "role_insufficient"],
    ];
    for (const [error, status, code] of cases) {
      rpcAnswer = { error };
      const res = await POST(request(ok(operation)));
      expect(res.status, code).toBe(status);
      expect((await res.json()).code).toBe(code);
    }
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("the audit vocabulary", () => {
  it("both actions are registered destructive", () => {
    expect(DESTRUCTIVE_ACTIONS).toContain("station.mid_day_trigger");
    expect(DESTRUCTIVE_ACTIONS).toContain("station.not_phase_station");
  });
});
