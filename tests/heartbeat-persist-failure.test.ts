// @vitest-environment jsdom
/**
 * Audit W06/B013 (fix round 3) — a heartbeat 200 must mean the server's idle clock actually advanced.
 *
 * requireSession touches sessions.last_activity_at best-effort: an ordinary page load or route keeps flowing when the
 * touch UPDATE fails. The heartbeat is different — its ONLY job is that touch, and the client clears its pending
 * activity on a 2xx. A 200 over a failed (or zero-row) UPDATE left the server clock behind the client's, and resumed
 * typing later hit a 401 and lost the draft. The heartbeat now answers a retryable 503 `session_unavailable` that keeps
 * the cookie when the touch did not land; the client's existing backoff retries it.
 *
 * Real heartbeat route + real requireSession over the predicate-aware fake (tests/fake-supabase), and the real
 * IdleTimeoutWarning wired to that route.
 */
import { act } from "react";
import { jsx } from "react/jsx-runtime";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeDb } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  zeroRowTouch: false,
  push: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    if (!h.zeroRowTouch) return h.db.client;
    // A touch UPDATE that succeeds but matches no row (e.g. the row vanished between the read and the write).
    const real = h.db.client;
    return {
      ...real,
      from: (table: string) => {
        const q = real.from(table);
        if (table !== "sessions") return q;
        return new Proxy(q, {
          get(target, prop, receiver) {
            if (prop !== "update") return Reflect.get(target, prop, receiver);
            return (payload: Record<string, unknown>) => {
              if (!("last_activity_at" in payload)) return target.update(payload);
              const noRow = {
                eq: () => noRow,
                select: () => noRow,
                then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
              };
              return noRow;
            };
          },
        });
      },
    };
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }));

import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { POST as heartbeat } from "@/app/api/auth/heartbeat/route";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { TranslationProvider } from "@/lib/i18n/provider";

const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const beat = () => heartbeat(new NextRequest("http://localhost/api/auth/heartbeat", {
  method: "POST", headers: { ...cookie, origin: "http://localhost" },
}));
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;
const freshDb = () => fakeSupabase({
  sessions: [{
    id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
    step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
    created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 12 * 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
  }],
  users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
  user_locations: [],
});
const expectCookieKept = (res: Response) => {
  expect(res.headers.get("set-cookie") ?? "").not.toContain(SESSION_COOKIE_NAME);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.zeroRowTouch = false;
  h.db = freshDb();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/operations/counts?loc=a");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the heartbeat succeeds only when the idle clock was saved (B013 round 3)", () => {
  it("a failed last_activity_at UPDATE answers a retryable 503 session_unavailable and keeps the cookie", async () => {
    const before = sessionRow().last_activity_at;
    await vi.advanceTimersByTimeAsync(60_000);
    h.db.failUpdates = 1;
    const res = await beat();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe("session_unavailable");
    expectCookieKept(res);
    expect(sessionRow().last_activity_at).toBe(before);
  });

  it("a touch UPDATE that matches no row is not an acknowledgment either", async () => {
    h.zeroRowTouch = true;
    const res = await beat();
    expect(res.status).toBe(503);
    expectCookieKept(res);
  });

  it("the next heartbeat after the blip is a 200 that advances the clock", async () => {
    h.db.failUpdates = 1;
    expect((await beat()).status).toBe(503);
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await beat();
    expect(res.status).toBe(200);
    expect(sessionRow().last_activity_at).toBe(new Date().toISOString());
  });

  it("an ordinary request keeps today's best-effort touch (a failed UPDATE does not fail the page)", async () => {
    h.db.failUpdates = 1;
    const ctx = await requireSession(new NextRequest("http://localhost/api/operations/counts", { headers: cookie }), "/api/operations/counts");
    expect(ctx).not.toBeInstanceOf(Response);
  });

  it("client: 200, then a 503 from a failed save, then a retried 200 — resumed typing is not signed out", async () => {
    // The round-3 review sequence end to end: type 2:00 (saved), type 3:59, the 4:00 trailing beat's UPDATE fails,
    // the client retries, the operator pauses and types again at 12:29 (only 8:30 of client inactivity).
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/heartbeat") return beat();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const beats = () => fetchMock.mock.calls.filter((c) => c[0] === "/api/auth/heartbeat").length;
    const advance = (s: number) => act(async () => { await vi.advanceTimersByTimeAsync(s * 1000); });
    const statuses: number[] = [];
    const realBeat = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => {
      const res = await realBeat(url);
      if (url === "/api/auth/heartbeat") statuses.push(res.status);
      return res;
    });

    render(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(IdleTimeoutWarning, { userId: "user-1", sessionId: "session-1" }) }));
    await advance(120); // 2:00
    fireEvent.keyDown(window, { key: "a" });
    await advance(0);
    expect(beats()).toBe(1);
    await advance(119); // 3:59
    fireEvent.keyDown(window, { key: "b" });
    h.db.failUpdates = 1; // the 4:00 trailing beat's UPDATE fails
    await advance(1);
    expect(beats()).toBe(2);
    await advance(60); // the unacknowledged activity is retried and saved
    expect(beats()).toBeGreaterThanOrEqual(3);
    await advance(449); // 12:29
    fireEvent.keyDown(window, { key: "c" });
    await advance(1);

    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(503);
    expect(statuses.slice(2).every((s) => s === 200)).toBe(true);
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/auth/logout")).toHaveLength(0);
    expect(h.push).not.toHaveBeenCalled();
  });
});
