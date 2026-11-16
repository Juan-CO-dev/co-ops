/**
 * W23/B126 (owner decision W23-1 a) — an un-cancelled ezCater order stayed in Lost for good: the
 * webhook flags it for a human, and the board refuses every move out of Lost. Reopen is the narrow
 * human path: the pure target rule, the lib (shop bind before any RPC, prep re-reserved on
 * Confirmed only, audited `catering.pipeline.reopen`), and the board rule left untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { ezcaterReopenTarget } from "@/lib/ezcater/lifecycle-shared";
import { canTransition } from "@/lib/catering/pipeline-shared";

const state = vi.hoisted(() => ({
  lead: null as null | Record<string, unknown>,
  order: null as null | Record<string, unknown>,
  events: [] as Array<{ event_key: string; received_at: string }>,
  rpc: vi.fn(),
}));
const reserve = vi.hoisted(() => vi.fn(async () => undefined));
const prep = vi.hoisted(() => {
  class PrepDemandNeedsRepairError extends Error {}
  return { PrepDemandNeedsRepairError, ready: vi.fn(async (..._args: unknown[]) => undefined) };
});
const audit = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/catering/prep-demand", () => ({
  reservePrepDemand: reserve, consumePrepDemand: vi.fn(), releasePrepDemand: vi.fn(),
  assertQuoteReadyForPrep: prep.ready, PrepDemandNeedsRepairError: prep.PrepDemandNeedsRepairError,
}));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn(), canReadCateringLead: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const q = {
        select: () => q, eq: () => q, in: () => q, returns: () => q,
        maybeSingle: async () => ({ data: table === "catering_pipeline" ? state.lead : state.order, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: state.events, error: null }).then(res),
      };
      return q;
    },
  }),
}));

import { reopenEzcaterLead } from "@/lib/catering/pipeline";

const SHOP = "shop-a";
const actor = (role: string, locations: string[]) => ({ user: { id: "u-1", role }, role, locations } as unknown as AuthContext);
const lostLead = { id: "lead-1", stage: "lost", lead_source: "ezcater", external_ref: "prov-1", location_id: SHOP };

beforeEach(() => {
  vi.clearAllMocks();
  prep.ready.mockImplementation(async () => undefined);
  state.lead = { ...lostLead };
  state.order = { status: "accepted", pending_event_key: null };
  state.events = [{ event_key: "cancelled", received_at: "2026-11-10T10:00:00Z" }, { event_key: "uncancelled", received_at: "2026-11-10T11:00:00Z" }];
  state.rpc.mockResolvedValue({ data: { from_stage: "lost", to_stage: "confirmed" }, error: null });
});

describe("ezcaterReopenTarget (the button rule)", () => {
  const base = { stage: "lost", leadSource: "ezcater", orderStatus: "accepted", pendingEventKey: null,
    lastLossAt: "2026-11-10T10:00:00Z", lastUncancelAt: "2026-11-10T11:00:00Z" };
  it("uncancel after cancel and ezCater 'accepted' -> Confirmed (W23-1 a)", () => expect(ezcaterReopenTarget(base)).toBe("confirmed"));
  it("any other status -> Inquiry", () => {
    expect(ezcaterReopenTarget({ ...base, orderStatus: null })).toBe("inquiry");
    expect(ezcaterReopenTarget({ ...base, orderStatus: "submitted" })).toBe("inquiry");
  });
  it("a cancel after the uncancel, a pending loss, a still-cancelled status, a non-ezCater or non-lost lead -> none", () => {
    expect(ezcaterReopenTarget({ ...base, lastLossAt: "2026-11-10T12:00:00Z" })).toBeNull();
    expect(ezcaterReopenTarget({ ...base, lastUncancelAt: null })).toBeNull();
    expect(ezcaterReopenTarget({ ...base, pendingEventKey: "cancelled" })).toBeNull();
    expect(ezcaterReopenTarget({ ...base, orderStatus: "CANCELLED" })).toBeNull();
    expect(ezcaterReopenTarget({ ...base, leadSource: "web" })).toBeNull();
    expect(ezcaterReopenTarget({ ...base, stage: "confirmed" })).toBeNull();
  });
  it("the board's legality rule is unchanged: Lost still has no move (the bug's other half)", () => {
    expect(canTransition("lost", "confirmed")).toBe(false);
    expect(canTransition("lost", "inquiry")).toBe(false);
  });
});

describe("reopenEzcaterLead", () => {
  it("reopens to Confirmed, re-reserves prep and audits catering.pipeline.reopen", async () => {
    expect(await reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).toEqual({ fromStage: "lost", toStage: "confirmed" });
    expect(state.rpc).toHaveBeenCalledWith("reopen_ezcater_lead", {
      p_lead_id: "lead-1", p_actor_id: "u-1", p_expected_location_id: SHOP, p_expected_target: "confirmed",
    });
    expect(prep.ready).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls.map(([a]) => (a as { action: string }).action)).toContain("catering.pipeline.reopen");
  });

  it("reopening to Inquiry reserves no prep", async () => {
    state.order = { status: null, pending_event_key: null };
    state.rpc.mockResolvedValue({ data: { from_stage: "lost", to_stage: "inquiry" }, error: null });
    expect((await reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).toStage).toBe("inquiry");
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_expected_target: "inquiry" });
    expect(reserve).not.toHaveBeenCalled();
  });

  describe("review r2 (BC-007/BC-040): the target can change between the advisory read and the lock", () => {
    // The advisory read sees ezCater 'submitted' (Inquiry: no readiness check); an accepted webhook
    // commits before the RPC takes the provider lock; SQL refuses `reopen_target_changed`.
    const interleave = () => {
      state.order = { status: "submitted", pending_event_key: null };
      state.rpc.mockImplementationOnce(async () => {
        state.order = { status: "accepted", pending_event_key: null }; // the webhook won the race
        return { data: null, error: { code: "P0001", message: "reopen_target_changed" } };
      });
    };

    it("an unrepaired quote is refused quote_needs_repair on the re-read; the lead is never confirmed", async () => {
      interleave();
      prep.ready.mockImplementation(async () => { throw new prep.PrepDemandNeedsRepairError("legacy package line"); });
      await expect(reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).rejects.toMatchObject({ status: 409, code: "quote_needs_repair" });
      expect(state.rpc).toHaveBeenCalledTimes(1);
      expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_expected_target: "inquiry" });
      expect(reserve).not.toHaveBeenCalled();
      expect(audit.mock.calls.map(([a]) => (a as { action: string }).action)).not.toContain("catering.pipeline.reopen");
    });

    it("a ready quote is re-checked and the retry passes the new target", async () => {
      interleave();
      expect(await reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).toEqual({ fromStage: "lost", toStage: "confirmed" });
      expect(state.rpc.mock.calls.map((c) => (c[1] as { p_expected_target: string }).p_expected_target)).toEqual(["inquiry", "confirmed"]);
      expect(prep.ready).toHaveBeenCalledTimes(1);
      expect(reserve).toHaveBeenCalledTimes(1);
    });

    it("a target that keeps changing is a named 409 after one retry, with its own en + es message", async () => {
      state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "reopen_target_changed" } });
      await expect(reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).rejects.toMatchObject({ status: 409, code: "reopen_target_changed" });
      expect(state.rpc).toHaveBeenCalledTimes(2);
      const { resolveErrorKey } = await import("@/components/catering/pipeline/shared");
      const { readFileSync } = await import("node:fs");
      expect(resolveErrorKey("reopen_target_changed")).toBe("catering.pipeline.error.reopen_target_changed");
      for (const lang of ["en", "es"]) {
        const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
        expect(dict["catering.pipeline.error.reopen_target_changed"], lang).toBeTruthy();
      }
    });
  });

  it("a GM of another shop is refused before any RPC", async () => {
    await expect(reopenEzcaterLead(actor("gm", ["shop-b"]), "lead-1")).rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("review r1: the RPC is told the shop the actor was authorized for, and a lead moved since is a named 409", async () => {
    // A transfer commits between assertCanWriteLead and the RPC's lock: the RPC compares the shop
    // the lib authorized (passed as p_expected_location_id) with the locked lead's shop.
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "reopen_lead_moved" } });
    await expect(reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).rejects.toMatchObject({ status: 409, code: "reopen_lead_moved" });
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_expected_location_id: SHOP });
    expect(reserve).not.toHaveBeenCalled();
    expect(audit.mock.calls.map(([a]) => (a as { action: string }).action)).not.toContain("catering.pipeline.reopen");
  });

  it("the moved-lead refusal has its own en + es message on the board", async () => {
    const { resolveErrorKey } = await import("@/components/catering/pipeline/shared");
    const { readFileSync } = await import("node:fs");
    expect(resolveErrorKey("reopen_lead_moved")).toBe("catering.pipeline.error.reopen_lead_moved");
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      expect(dict["catering.pipeline.error.reopen_lead_moved"], lang).toBeTruthy();
    }
  });

  it("an SQL refusal comes back by name; a missing 0330 is 503 reopen_unavailable", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "reopen_no_uncancel" } });
    await expect(reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).rejects.toMatchObject({ status: 409, code: "reopen_no_uncancel" });
    state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    await expect(reopenEzcaterLead(actor("gm", [SHOP]), "lead-1")).rejects.toMatchObject({ status: 503, code: "reopen_unavailable" });
    expect(audit.mock.calls.map(([a]) => (a as { action: string }).action)).not.toContain("catering.pipeline.reopen");
  });
});
