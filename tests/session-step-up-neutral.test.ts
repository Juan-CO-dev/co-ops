/**
 * Nav PR 9, S1 (plan r2 6.2, 8.2; lead rulings r1 "Neutral step-up paths"): the top bar's background requests are
 * step-up NEUTRAL by EXACT path. Run through the real `requireSession` (so the real `requireSessionCore`) over the
 * predicate-aware fake, which records every write and its payload. CI proves a neutral request:
 *   - never unlocks a locked session;
 *   - never stamps `step_up_unlocked_at` or `catalog_edit_unlocked_at`;
 *   - never extends Tier B or Tier E;
 *   - never restores a flag that navigation cleared;
 * and that matching is exact (a prefix, a suffix or another case is an ordinary path, and clears).
 */
import { readFileSync, existsSync } from "node:fs";
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

import { assertStepUp } from "@/lib/admin/step-up";
import {
  isStepUpNeutralPath,
  isStepUpSurface,
  requireSession,
  SESSION_COOKIE_NAME,
  STEP_UP_NEUTRAL_PATHS,
  type AuthContext,
} from "@/lib/session";

const NEUTRAL = [
  "/api/auth/heartbeat",
  "/api/nav/people",
  "/api/notifications/unread",
  "/api/notifications/mark-all-read",
  "/api/notifications/mark-read",
  "/api/users/me/language",
  "/api/users/me/profile-blurb",
] as const;
const NOT_NEUTRAL = [
  "/api/nav/people/", "/api/nav/peoplex", "/api/nav/people/x", "/API/nav/people", "/api/notifications/unread/x",
  "/api/notifications", "/api/users/me", "/api/users/me/language/x", "/api/auth/heartbeatx",
] as const;

const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
async function request(path: string): Promise<AuthContext> {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  return ctx;
}
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;
const sessionUpdates = () => h.db.writes.filter((w) => w.table === "sessions" && w.op === "update");
const STEP_KEYS = ["step_up_unlocked", "step_up_unlocked_at", "catalog_edit_unlocked_at"];

function seed(session: { unlocked: boolean; unlockedAt: string | null; catalogAt: string | null }) {
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: session.unlocked, step_up_unlocked_at: session.unlockedAt, catalog_edit_unlocked_at: session.catalogAt,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [],
  });
}
beforeEach(() => seed({ unlocked: false, unlockedAt: null, catalogAt: null }));

describe("S1 (a): the closed set", () => {
  it("is exactly the seven paths", () => {
    expect([...STEP_UP_NEUTRAL_PATHS].sort()).toEqual([...NEUTRAL].sort());
  });
  it("no neutral path is a step-up surface (none can keep an unlock for a gate)", () => {
    for (const p of NEUTRAL) expect(isStepUpSurface(p), p).toBe(false);
  });
  it("isStepUpSurface is unchanged for every existing case", () => {
    for (const p of ["/admin", "/admin/skus", "/api/admin", "/api/admin/users/u1/role", "/api/catering/quotes/q1/send",
      "/api/catering/quotes/q1/resend", "/api/catering/pipeline/p1/transfer", "/api/operations/counts", "/operations/counts",
      "/api/schedule", "/api/catering/inbox/1c000000-0000-4000-8000-000000000002/send", "/api/operations/receiving/email-receipts"]) {
      expect(isStepUpSurface(p), p).toBe(true);
    }
    for (const p of ["/dashboard", "/administrator", "/api/adminx", "/operations/closing", "/api/schedule/settings"]) {
      expect(isStepUpSurface(p), p).toBe(false);
    }
  });
});

describe("S1 (b): matching is EXACT", () => {
  it("a prefix, a suffix or another case is not neutral", () => {
    for (const p of NOT_NEUTRAL) expect(isStepUpNeutralPath(p), p).toBe(false);
  });
  it("and such a request CLEARS an unlocked flag, like any ordinary path", async () => {
    for (const p of NOT_NEUTRAL) {
      seed({ unlocked: true, unlockedAt: new Date().toISOString(), catalogAt: null });
      const ctx = await request(p);
      expect(ctx.session.stepUpUnlocked, p).toBe(false);
      expect(sessionRow().step_up_unlocked, p).toBe(false);
    }
  });
  it("each neutral path leaves an unlocked flag set (control for the above)", async () => {
    for (const p of NEUTRAL) {
      seed({ unlocked: true, unlockedAt: new Date().toISOString(), catalogAt: null });
      const ctx = await request(p);
      expect(ctx.session.stepUpUnlocked, p).toBe(true);
      expect(sessionRow().step_up_unlocked, p).toBe(true);
    }
  });
});

describe("S1 (c): a neutral request never unlocks", () => {
  it("a locked session stays locked; its only sessions UPDATE is the activity touch", async () => {
    for (const p of NEUTRAL) {
      seed({ unlocked: false, unlockedAt: null, catalogAt: null });
      const ctx = await request(p);
      const updates = sessionUpdates();
      expect(updates.length, p).toBe(1);
      expect(Object.keys(updates[0]!.payload as object), p).toEqual(["last_activity_at"]);
      expect(ctx.session.stepUpUnlocked, p).toBe(false);
      expect(ctx.session.stepUpUnlockedAt, p).toBeNull();
      expect(ctx.session.catalogEditUnlockedAt ?? null, p).toBeNull();
      expect(sessionRow().step_up_unlocked, p).toBe(false);
    }
  });
});

describe("S1 (d): a neutral request never stamps and never extends Tier B or Tier E", () => {
  it("the stored stamps stand; Tier B goes stale on its old clock; Tier E's end is unchanged", async () => {
    for (const p of NEUTRAL) {
      const T = Date.now();
      const unlockedAt = new Date(T - 100_000).toISOString();
      const catalogAt = new Date(T - 600_000).toISOString();
      seed({ unlocked: true, unlockedAt, catalogAt });
      const ctx = await request(p);
      for (const w of sessionUpdates()) {
        for (const k of STEP_KEYS) expect(Object.keys(w.payload as object), `${p} ${k}`).not.toContain(k);
      }
      expect(ctx.session.stepUpUnlockedAt, p).toBe(unlockedAt);
      expect(ctx.session.catalogEditUnlockedAt, p).toBe(catalogAt);
      expect(sessionRow().step_up_unlocked_at, p).toBe(unlockedAt);
      expect(sessionRow().catalog_edit_unlocked_at, p).toBe(catalogAt);
      // Tier B: 120 s from the ORIGINAL stamp. At T + 30 s it is 130 s old: stale.
      expect(assertStepUp(ctx, "B", T + 30_000), p).toEqual({ ok: false, code: "step_up_stale" });
      expect(assertStepUp(ctx, "A", T + 30_000), p).toEqual({ ok: true });
      // Tier E: 15 minutes from the ORIGINAL stamp (T - 600 s), i.e. it ends at T + 300 s, exclusive.
      expect(assertStepUp(ctx, "E", T + 299_000), p).toEqual({ ok: true });
      expect(assertStepUp(ctx, "E", T + 300_000), p).toEqual({ ok: false, code: "step_up_stale" });
    }
  });
});

describe("S1 (e): a neutral request never restores a flag navigation cleared", () => {
  it("a page visit clears; a following neutral request leaves it false (no UPDATE sets it true)", async () => {
    for (const p of NEUTRAL) {
      seed({ unlocked: true, unlockedAt: new Date().toISOString(), catalogAt: null });
      await request("/dashboard");
      expect(sessionRow().step_up_unlocked, p).toBe(false);
      const before = h.db.writes.length;
      const ctx = await request(p);
      expect(ctx.session.stepUpUnlocked, p).toBe(false);
      expect(sessionRow().step_up_unlocked, p).toBe(false);
      for (const w of h.db.writes.slice(before)) {
        expect((w.payload as Record<string, unknown>).step_up_unlocked, p).not.toBe(true);
      }
    }
  });
});

describe("S1 (f): no neutral route imports the unlock", () => {
  // The route files of the neutral paths (the mark-read label is the action's, components/nav/notification-actions.ts).
  // Each lands with its own commit; this list is extended in the commit that adds the file.
  const FILES = [
    "app/api/auth/heartbeat/route.ts",
    "app/api/nav/people/route.ts",
    "app/api/notifications/mark-all-read/route.ts",
    "app/api/users/me/language/route.ts",
    "app/api/users/me/profile-blurb/route.ts",
  ];
  it("none of them names unlockStepUp", () => {
    for (const f of FILES) {
      expect(existsSync(f), f).toBe(true);
      expect(readFileSync(f, "utf8"), f).not.toMatch(/unlockStepUp/);
    }
  });
});
