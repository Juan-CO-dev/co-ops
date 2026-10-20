/**
 * Scheduling Phase 2, chunk G (CC on 6fe40756: "the same bug class") — the step-up tiers the schedule routes assert must
 * SURVIVE their own `requireSession`, run UNMOCKED over the predicate-aware fake (tests/fake-supabase), the way
 * tests/catalog-window-lifecycle.test.ts runs it:
 *  - Tier E on POST /api/schedule/settings: a password typed on /schedule/settings (catalogWindow) opens the 15-minute
 *    edit window; the settings PAGE visit and the route's own requireSession clear only the shared Tier B flag, never
 *    the window, so the structure / shop save passes the route's `assertStepUp(ctx, "E")`;
 *  - Tier B on POST /api/schedule (6fe40756): the board page clears the flag, a fresh password sets it, and the action
 *    route's own requireSession keeps it, so Approve passes `assertStepUp(ctx, "B")`;
 *  - without a password neither passes (403 step_up_required) — the test is not vacuous.
 * The lib writers are mocked (their rules are tested elsewhere); requireSession, unlockStepUp and assertStepUp are real.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("@/lib/scheduling/settings", () => ({
  saveStructure: vi.fn(async () => ({ id: "sv-1" })),
  saveShopSettings: vi.fn(async () => ({ id: "ss-1" })),
  acceptBudgetSuggestion: vi.fn(), keepBudget: vi.fn(), recordPersonSettings: vi.fn(), recordPersonPositions: vi.fn(), setBudget: vi.fn(), setDayType: vi.fn(), setPin: vi.fn(),
}));
vi.mock("@/lib/scheduling/schedules", () => ({
  approveWeek: vi.fn(async () => ({ approvalId: "ap-1" })),
  applyHorizon: vi.fn(), generateWeek: vi.fn(), previewHorizon: vi.fn(), saveEdit: vi.fn(),
}));

import { requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { POST as settingsPOST } from "@/app/api/schedule/settings/route";
import { POST as schedulePOST } from "@/app/api/schedule/route";

const LOC = "1c000000-0000-4000-8000-000000000002";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const page = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  return ctx;
};
const post = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin: "http://localhost", "content-type": "application/json" },
});
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;
const STRUCTURE = { action: "structure", locationId: LOC, expectedId: null, structure: {} };
const APPROVE = { action: "approve", locationId: LOC, weekStart: "2026-10-26", expectedHead: "rev-1" };

beforeEach(() => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: future, revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
  });
});

describe("Tier E on POST /api/schedule/settings survives an UNMOCKED requireSession", () => {
  it("a password on the settings page opens the window; the page visit and the route keep it; the save passes", async () => {
    await page("/schedule/settings");
    await unlockStepUp("session-1", { catalogWindow: true }); // the settings page's StepUpProvider (catalogWindow)
    await page("/schedule/settings"); // a refresh / navigation back to the page
    const res = await settingsPOST(post("/api/schedule/settings", STRUCTURE));
    expect(res.status).toBe(200);
    // The shared Tier B flag was cleared by those paths; the window was not.
    expect(sessionRow().step_up_unlocked).toBe(false);
    expect(sessionRow().catalog_edit_unlocked_at).toEqual(expect.any(String));
  });

  it("without a password: 403 step_up_required (not vacuous); a password with no window (Tier B only) does not open it", async () => {
    const none = await settingsPOST(post("/api/schedule/settings", STRUCTURE));
    expect(none.status).toBe(403);
    expect(await none.json()).toMatchObject({ code: "step_up_required" });
    await unlockStepUp("session-1");
    const bOnly = await settingsPOST(post("/api/schedule/settings", STRUCTURE));
    expect(bOnly.status).toBe(403);
  });
});

describe("Tier B on POST /api/schedule survives the route's own UNMOCKED requireSession (6fe40756)", () => {
  it("board page → password → Approve passes", async () => {
    await page("/schedule");
    await unlockStepUp("session-1");
    const res = await schedulePOST(post("/api/schedule", APPROVE));
    expect(res.status).toBe(200);
  });

  it("a page visit AFTER the password clears it: Approve is refused step_up_required; no password at all is refused too", async () => {
    await unlockStepUp("session-1");
    await page("/schedule");
    const after = await schedulePOST(post("/api/schedule", APPROVE));
    expect(after.status).toBe(403);
    const none = await schedulePOST(post("/api/schedule", APPROVE));
    expect(none.status).toBe(403);
  });
});
