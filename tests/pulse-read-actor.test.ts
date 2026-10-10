import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { LocationActor } from "@/lib/locations";
import { lockLocationContext } from "@/lib/locations";
import { pulseReadActor, requirePulseReadScope, type PulseScopedReadActor } from "@/lib/pulse/read-actor";
import {
  loadShiftBoard, loadOwnTaskAssignments, writeStationEvent, writeStationBreak, endShift,
  assignTask, retractTask, saveStationConfig, saveStationSpanish, saveStationTiming, type AssignmentActor,
} from "@/lib/assignments";
import { loadRecentDeliveries, recordDelivery, addDeliveryLines, completeDelivery, attachDeliveryReceipt } from "@/lib/receiving";
import { loadOrderingAttention, submitParPass, generateDraftForVendor } from "@/lib/ordering";
import { saveStationLayout } from "@/lib/pulse/layout";
import { createHandoffNote, ackHandoffNote, supersedeHandoffNote } from "@/lib/pulse/handoff";

const io = vi.hoisted(() => ({ touched: vi.fn(() => { throw new Error("unexpected I/O"); }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: io.touched }));
vi.mock("@/lib/audit", () => ({ audit: io.touched }));
const service = { from: io.touched, rpc: io.touched } as never;
const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const auth = (level = 8): AuthContext => ({
  user: { id: ID, role: level === 8 ? "moo" : "gm", language: "es" } as AuthContext["user"],
  session: {} as AuthContext["session"], role: level === 8 ? "moo" : "gm", level, locations: [SHOP],
});
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("WHOS_HERE", "1"); });
afterEach(() => vi.unstubAllEnvs());

describe("Pulse-only read capability", () => {
  it("is shop-bound, immutable, not copyable, and cannot be passed to operational actor APIs", () => {
    expectTypeOf<PulseScopedReadActor>().not.toExtend<AuthContext>();
    expectTypeOf<PulseScopedReadActor>().not.toExtend<AssignmentActor>();
    expectTypeOf<PulseScopedReadActor>().not.toExtend<LocationActor>();
    const original = auth();
    const actor = pulseReadActor(original, OTHER);
    expect(requirePulseReadScope(actor, OTHER)).toMatchObject({ userId: ID, level: 8, language: "es" });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(Object.isFrozen(requirePulseReadScope(actor, OTHER))).toBe(true);
    expect(() => requirePulseReadScope(actor, SHOP)).toThrow("location_access_denied");
    expect(() => requirePulseReadScope({ ...actor }, OTHER)).toThrow("location_access_denied");
    expect(() => requirePulseReadScope(JSON.parse(JSON.stringify(actor)), OTHER)).toThrow("location_access_denied");
    expect(() => pulseReadActor(auth(7), OTHER)).toThrow("location_access_denied");
    expect(original.locations).toEqual([SHOP]);
    expect(lockLocationContext(original, OTHER)).toBe(false);
    expect(io.touched).not.toHaveBeenCalled();
  });

  it("preserves operational membership checks on all three original readers", async () => {
    const original = auth();
    await expect(loadShiftBoard(service, { actor: { userId: ID, ...original }, locationId: OTHER, date: "2026-10-09" })).rejects.toThrow("location_access_denied");
    await expect(loadRecentDeliveries(original, OTHER)).rejects.toMatchObject({ code: "not_found" });
    await expect(loadOrderingAttention(original, OTHER)).rejects.toMatchObject({ code: "not_found" });
    expect(io.touched).not.toHaveBeenCalled();
  });

  it("rejects cross-shop reuse and copied capabilities at all three readers before I/O", async () => {
    const actor = pulseReadActor(auth(), OTHER);
    for (const [candidate, shop] of [[actor, SHOP], [{ ...actor }, OTHER]] as const) {
      await expect(loadShiftBoard(service, { actor: candidate, locationId: shop, date: "2026-10-09" })).rejects.toThrow("location_access_denied");
      await expect(loadRecentDeliveries(candidate, shop)).rejects.toThrow("location_access_denied");
      await expect(loadOrderingAttention(candidate, shop)).rejects.toThrow("location_access_denied");
    }
    expect(io.touched).not.toHaveBeenCalled();
  });

  it("keeps the Inventory role floor even for a valid own-shop Pulse actor", async () => {
    const crew = { ...auth(), level: 3, role: "employee" as const };
    const actor = pulseReadActor(crew, SHOP);
    await expect(loadRecentDeliveries(actor, SHOP)).rejects.toThrow("location_access_denied");
    await expect(loadOrderingAttention(actor, SHOP)).rejects.toThrow("location_access_denied");
    expect(io.touched).not.toHaveBeenCalled();
  });
});

// Deliberately bypass the compiler here to prove runtime refusal if a JS caller misroutes it.
describe("read actors cannot enter operational writes", () => {
  const calls = {
    station: (actor: never) => writeStationEvent(service, { actor, locationId: OTHER, userId: ID, stationId: ID, positionId: null }),
    break: (actor: never) => writeStationBreak(service, { actor, locationId: OTHER, userId: ID, onBreak: true }),
    end: (actor: never) => endShift(service, { actor, locationId: OTHER, userId: ID }),
    assign: (actor: never) => assignTask(service, { actor, locationId: OTHER, userId: ID, task: "am_prep" }),
    retract: (actor: never) => retractTask(service, { actor, locationId: OTHER, assignmentId: ID }),
    config: (actor: never) => saveStationConfig(service, { actor, locationId: OTHER, stationId: ID, operation: "staffed", staffed: true }),
    spanish: (actor: never) => saveStationSpanish(service, { actor, locationId: OTHER, id: ID, nameEs: "Prueba" }),
    timing: (actor: never) => saveStationTiming(service, { actor, locationId: OTHER, stationId: ID, usuallyClosesAt: "18:00" }),
    receive: (actor: never) => recordDelivery(actor, { locationId: OTHER } as never),
    addLines: (actor: never) => addDeliveryLines(actor, ID, []),
    complete: (actor: never) => completeDelivery(actor, ID),
    receipt: (actor: never) => attachDeliveryReceipt(actor, ID, ID),
    parPass: (actor: never) => submitParPass(actor, OTHER, []),
    draft: (actor: never) => generateDraftForVendor(actor, OTHER, ID),
  };
  it.each(Object.entries(calls))("%s refuses before any I/O", async (_name, write) => {
    await expect(write(pulseReadActor(auth(), OTHER) as never)).rejects.toMatchObject({ code: "read_only_actor" });
    expect(io.touched).not.toHaveBeenCalled();
  });

  it("does not widen other assignment readers or Pulse layout/handoff writers", async () => {
    const actor = pulseReadActor(auth(), OTHER) as never;
    const args = { locationId: OTHER, noteId: ID, ip: null, userAgent: null };
    await expect(loadOwnTaskAssignments(service, { actor, locationId: OTHER, date: "2026-10-09" })).rejects.toThrow();
    await expect(saveStationLayout(service, actor, { ...args, layout: {} })).rejects.toThrow();
    await expect(createHandoffNote(service, actor, { ...args, date: "2026-10-09", audience: "all", body: "test" })).rejects.toThrow();
    await expect(ackHandoffNote(service, actor, args)).rejects.toThrow();
    await expect(supersedeHandoffNote(service, actor, args)).rejects.toThrow();
    // The original session still cannot write the cross-shop layout/handoff either.
    await expect(saveStationLayout(service, auth(), { ...args, layout: {} })).rejects.toMatchObject({ code: "location_access_denied" });
    await expect(ackHandoffNote(service, auth(), args)).rejects.toMatchObject({ code: "location_access_denied" });
    expect(io.touched).not.toHaveBeenCalled();
  });
});
