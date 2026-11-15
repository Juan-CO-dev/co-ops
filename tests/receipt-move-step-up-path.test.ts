/**
 * Audit W06/B014 — the Tier A unlock for "move conflicted receipt" must SURVIVE the email-receipts route's own
 * requireSession.
 *
 * `requireSession(req, "/api/operations/receiving/email-receipts")` auto-clears `step_up_unlocked` on any path outside
 * the step-up surface, BEFORE the route's `assertStepUp(ctx, "A")` for action=move reads it — so the password modal
 * reopened forever (the same bug class as counts and the schedule board). Exactly that endpoint keeps the unlock; the
 * receiving pages and every other receiving route still clear it.
 *
 * Run UNMOCKED over the predicate-aware fake (tests/fake-supabase), like tests/schedule-settings-tier-e-session.test.ts:
 * requireSession, unlockStepUp and assertStepUp are real; only the lib writer is mocked.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, move: null as unknown as ReturnType<typeof import("vitest").vi.fn> }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("@/lib/email-receipts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email-receipts")>("@/lib/email-receipts");
  const { vi: v } = await import("vitest");
  h.move = v.fn(async () => {});
  return { ...actual, moveConflictedReceipt: h.move };
});
vi.mock("@/lib/receipt-parse", () => ({ parseReceiptForActor: vi.fn() }));

import { isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { PATCH } from "@/app/api/operations/receiving/email-receipts/route";

const LOC = "1c000000-0000-4000-8000-000000000002";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const page = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  return ctx;
};
const patchMove = () => new NextRequest("http://localhost/api/operations/receiving/email-receipts", {
  method: "PATCH",
  body: JSON.stringify({ action: "move", receiptId: "r1" }),
  headers: { ...cookie, origin: "http://localhost", "content-type": "application/json" },
});

beforeEach(() => {
  h.move?.mockClear();
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

describe("the email-receipts route keeps the Tier A unlock (B014)", () => {
  it("keeps the unlock on the email-receipts endpoint", () => {
    expect(isStepUpSurface("/api/operations/receiving/email-receipts")).toBe(true);
  });
  it.each([
    "/operations/receiving",
    "/operations/receiving/abc",
    "/api/operations/receiving/email-receipts/x",
    "/api/operations/receiving",
    "/api/operations/receiving/email-receiptsx",
  ])("clears it on %s", (path) => { expect(isStepUpSurface(path)).toBe(false); });

  it("the route passes exactly that path to requireSession", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/api/operations/receiving/email-receipts/route.ts", "utf8"))
      .toContain('requireSession(req, "/api/operations/receiving/email-receipts")');
  });

  it("receiving page → password → Move passes", async () => {
    await page("/operations/receiving/d1");
    await unlockStepUp("session-1");
    const res = await PATCH(patchMove());
    expect(res.status).toBe(200);
    expect(h.move).toHaveBeenCalledTimes(1);
  });

  it("no password → 403 step_up_required (not vacuous)", async () => {
    const res = await PATCH(patchMove());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step_up_required" });
    expect(h.move).not.toHaveBeenCalled();
  });

  it("a page visit after the password clears it → 403", async () => {
    await unlockStepUp("session-1");
    await page("/operations/receiving/d1");
    const res = await PATCH(patchMove());
    expect(res.status).toBe(403);
    expect(h.move).not.toHaveBeenCalled();
  });
});
