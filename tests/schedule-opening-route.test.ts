/**
 * PR SCH (plan r5 20.4; rulings C8, D4): POST /api/schedule `action: "opening"` — the exact request shape (a forged accept
 * carrying a start, an unknown key or kind, a missing key → 400 bad_request before the lib), Tier B at the route (missing →
 * 403 before the lib), the session's actor and an IDENTITY passed to `setDayOpening`, and a refusal answered by its code.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({ fake: true })) }));
vi.mock("@/lib/scheduling/schedules", () => ({
  generateWeek: vi.fn(), previewHorizon: vi.fn(), applyHorizon: vi.fn(), saveEdit: vi.fn(), approveWeek: vi.fn(),
  setDayOpening: vi.fn(async () => ({ revisionId: "r", opening: null, problems: [] })),
}));
vi.mock("@/lib/scheduling/settings", () => ({
  setBudget: vi.fn(), acceptBudgetSuggestion: vi.fn(), keepBudget: vi.fn(), setDayType: vi.fn(), setPin: vi.fn(), recordPersonSettings: vi.fn(), recordPersonPositions: vi.fn(),
}));

const { requireSession } = await import("@/lib/session");
const { assertStepUp } = await import("@/lib/admin/step-up");
const sched = await import("@/lib/scheduling/schedules");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
const { scheduleActRefusal, stepUpFor, SCHEDULE_ACTS } = await import("@/lib/scheduling/access-shared");
const route = await import("@/app/api/schedule/route");

const SHOP = "11111111-1111-4111-8111-111111111111";
const WEEK = "2026-10-26";
const HEAD = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) => route.POST(new NextRequest("http://localhost/api/schedule", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost" },
}));
const body = (decision: unknown, extra: Record<string, unknown> = {}) => ({ action: "opening", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD, date: WEEK, decision, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "actor-1" }, role: "gm", level: 7, locations: [SHOP], session: {} } as never);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
});

describe("POST /api/schedule — action: opening", () => {
  it("the exact keys are the contract's", () => {
    expect(SCHEDULE_ACTIONS.opening).toEqual(["action", "locationId", "weekStart", "expectedHead", "date", "decision"]);
  });

  it("each valid shape reaches the lib with the session's actor and the identity it posted, under Tier B", async () => {
    for (const decision of [{ kind: "accept" }, { kind: "decline" }, { kind: "clear" }, { kind: "manual", startQ: 22 }]) {
      const r = await post(body(decision));
      expect(r.status, JSON.stringify(decision)).toBe(200);
      expect(sched.setDayOpening).toHaveBeenLastCalledWith({ service: { fake: true } },
        { actor: { userId: "actor-1", role: "gm", level: 7, locations: [SHOP] }, locationId: SHOP, weekStart: WEEK, expectedHead: HEAD, date: WEEK, decision });
    }
    expect(vi.mocked(assertStepUp).mock.calls.map((c) => c[1])).toEqual(["B", "B", "B", "B"]);
  });

  it("a forged accept with a start, an unknown kind or key, a missing key, a non-string date → 400 bad_request before the lib", async () => {
    const bads: unknown[] = [
      body({ kind: "accept", startQ: 2 }), body({ kind: "accepted", startQ: 22 }), body({ kind: "manual" }), body({ kind: "manual", startQ: "22" }),
      body({ kind: "clear", x: 1 }), body(null), body({ kind: "manual", startQ: 22 }, { start: 22 }),
      { action: "opening", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD, decision: { kind: "clear" } },
      body({ kind: "clear" }, { date: 20261026 }), body({ kind: "clear" }, { expectedHead: null }),
    ];
    for (const b of bads) {
      const r = await post(b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect((await r.json()).code).toBe("bad_request");
    }
    expect(sched.setDayOpening).not.toHaveBeenCalled();
  });

  it("Tier B missing → 403 with the step-up code, and the lib never runs", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    const r = await post(body({ kind: "manual", startQ: 22 }));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("step_up_required");
    expect(sched.setDayOpening).not.toHaveBeenCalled();
  });

  it("a refusal answers its code and status", async () => {
    for (const [c, status] of [["opening_no_proposal", 409], ["opening_start_invalid", 422], ["opening_date_not_in_week", 422], ["head_moved", 409], ["schedule_forbidden", 403]] as const) {
      vi.mocked(sched.setDayOpening).mockRejectedValueOnce(new ScheduleError(c));
      const r = await post(body({ kind: "accept" }));
      expect(r.status, c).toBe(status);
      expect((await r.json()).code).toBe(c);
    }
  });
});

describe("the opening act's rule (C8): the Approve rule, Tier B", () => {
  it("for every role, shop and AGM setting, deciding an opening is allowed exactly where approving is; it is Tier B", () => {
    expect(SCHEDULE_ACTS).toContain("opening");
    expect(stepUpFor("opening", { confirmedEditedWeeks: 0 })).toBe("B");
    const roles = ["employee", "key_holder", "shift_lead", "agm", "gm", "catering_mgr", "prep_mgr", "social_media_mgr", "moo", "owner", "cgs"] as const;
    const levels: Record<string, number> = { employee: 3, key_holder: 4, shift_lead: 5, agm: 6, gm: 7, catering_mgr: 6, prep_mgr: 6, social_media_mgr: 6, moo: 8, owner: 9, cgs: 9 };
    for (const role of roles) for (const loc of [SHOP, "other", ""]) for (const agmAccess of ["read", "edit"] as const) {
      const a = { userId: "u", role, level: levels[role]!, locations: [SHOP] };
      expect(scheduleActRefusal(a, loc, "opening", { agmAccess }), `${role} ${loc} ${agmAccess}`).toBe(scheduleActRefusal(a, loc, "approve", { agmAccess }));
    }
  });
});

describe("nothing outbound (plan r5 10): the no-notify pin covers SCH's modules and the route", async () => {
  const { importClosure, outboundViolations, sinkViolations } = await import("./fixtures/schedule/no-notify-closure");
  const SCH = ["lib/scheduling/opening-shared.ts", "lib/scheduling/gap-partition-shared.ts", "lib/scheduling/schedules.ts", "app/api/schedule/route.ts",
    "components/schedule/OpeningPanel.tsx", "lib/day-plan-load-shared.ts", "lib/day-plan-shared.ts"];
  // (lib/day-plan.ts, PR 6's loader, already reaches lib/notifications.ts through lib/assignments.ts — merged before SCH; SCH
  // adds only read queries to it, pinned in tests/day-plan-load-reads.test.ts.)
  it("their import closure reaches no notification / email / SMS / push module or sending package", () => {
    expect(sinkViolations(importClosure(SCH), SCH)).toEqual([]);
  });
  it("no outbound HTTP in the scheduling ones (the board's own POST goes through the step-up hook, not a raw fetch)", () => {
    expect(outboundViolations(SCH.filter((f) => f.startsWith("lib/scheduling") || f.startsWith("app/")))).toEqual([]);
  });
});
