/**
 * Nav PR 9, S3: the bell's three server surfaces (plan r2 3.3, 3.4, 4.2; lead rulings r1 F3, A2).
 *
 * `requireSession` / `requireSessionFromHeaders` are NOT mocked: they run over a recording fake, so every query of the
 * request is recorded. GET /api/notifications/unread, POST /api/notifications/mark-all-read and the per-item mark-read
 * action each refuse the social media manager BEFORE any notification read; serve a key holder; and, all three, leave
 * an unlocked step-up flag set (their session paths are step-up neutral).
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSessionOp, recordingSupabase, type RecordingDb, type Row } from "./recording-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./recording-supabase").RecordingDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "co_ops_session" || name.includes("session") ? { value: "jwt" } : undefined) }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

import { GET as unread } from "@/app/api/notifications/unread/route";
import { POST as markAll } from "@/app/api/notifications/mark-all-read/route";
import { markNotificationReadAction } from "@/components/nav/notification-actions";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const A = "loc-a";
const B = "loc-b";
const GONE = "loc-gone";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const getUnread = () => unread(new NextRequest("http://localhost/api/notifications/unread", { headers: cookie }));
const postMarkAll = () => markAll(new NextRequest("http://localhost/api/notifications/mark-all-read", {
  method: "POST", headers: { ...cookie, origin: "http://localhost", "sec-fetch-site": "same-origin" },
}));
const notificationReads = (db: RecordingDb) => db.queries.filter((q) => !isSessionOp(q) && (q.table === "notification_recipients" || q.table === "notifications"));
const locationReads = (db: RecordingDb) => db.queries.filter((q) => !isSessionOp(q) && q.table === "locations");

let n = 0;
function notice(locationId: string | null, opts: { userId?: string; read?: boolean } = {}): Row {
  n++;
  return {
    id: `r${n}`, notification_id: `n${n}`, user_id: opts.userId ?? "user-1", delivery_method: "in_app", delivery_status: "sent",
    read_at: opts.read ? "2026-11-01T00:00:00Z" : null, acknowledged_at: null,
    notifications: { id: `n${n}`, type: "under_par_alert", priority: "urgent", title: "t", body: null, data: {}, related_table: null,
      related_id: null, location_id: locationId, created_at: `2026-11-0${(n % 9) + 1}T12:00:00Z` },
  };
}

function seed(role: string, shops: string[], recipients: Row[], opts: { unlocked?: boolean } = {}) {
  h.db = recordingSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "pin",
      step_up_unlocked: opts.unlocked ?? false, step_up_unlocked_at: opts.unlocked ? new Date().toISOString() : null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "Viewer", email: "v@example.test", role, active: true, language: "en" }],
    user_locations: shops.map((s) => ({ user_id: "user-1", location_id: s, active: true })),
    notification_recipients: recipients,
    locations: [{ id: A, code: "AAA", name: "Shop A" }, { id: B, code: "BBB", name: "Shop B" }],
  });
}
beforeEach(() => { n = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("GET /api/notifications/unread", () => {
  it("the SMM: 403 bell_refused with no notification_recipients and no locations read", async () => {
    seed("social_media_mgr", [A], [notice(A), notice(B)]);
    const res = await getUnread();
    expect([res.status, (await res.json()).code]).toEqual([403, "bell_refused"]);
    expect(notificationReads(h.db)).toEqual([]);
    expect(locationReads(h.db)).toEqual([]);
    expect(h.db.queries.every((q) => isSessionOp(q))).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("a key holder: 200, exactly { notices, locationCodes }; codes = exactly the notices' distinct shops", async () => {
    // B is addressed to the KH but is not one of its shops: with memberships [A] the filter keeps A + shop-wide only.
    seed("key_holder", [], [notice(A), notice(B), notice(null), notice(GONE), notice(A, { read: true }), notice(A, { userId: "other" })]);
    const res = await getUnread();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["locationCodes", "notices"]);
    expect(body.notices).toHaveLength(4); // A, B, null, gone (no memberships: no location predicate, F6)
    // A shop the KH is not a member of gets its code (B); a deleted shop row gets none (GONE).
    expect(body.locationCodes).toEqual({ [A]: "AAA", [B]: "BBB" });
    const loc = locationReads(h.db);
    expect(loc).toHaveLength(1);
    expect(loc[0]!.calls.find(([c]) => c === "in")![2]).toEqual(expect.arrayContaining([A, B, GONE]));
    expect((loc[0]!.calls.find(([c]) => c === "in")![2] as unknown[]).length).toBe(3);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("only shop-less notices: no locations query, codes {}", async () => {
    seed("key_holder", [A], [notice(null)]);
    const body = await (await getUnread()).json();
    expect(body.locationCodes).toEqual({});
    expect(locationReads(h.db)).toEqual([]);
  });
  it("the unread read hanging: 503 notifications_unavailable at 6 s, and no codes query built", async () => {
    seed("key_holder", [A], [notice(A)]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.db.hang = (q) => q.table === "notification_recipients";
    const p = getUnread();
    await vi.advanceTimersByTimeAsync(5_999);
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await p;
    expect([res.status, (await res.json()).code]).toEqual([503, "notifications_unavailable"]);
    expect(locationReads(h.db)).toEqual([]);
    expect(notificationReads(h.db)[0]!.signal?.aborted).toBe(true);
  });
  it("the codes read rejecting: 503", async () => {
    seed("key_holder", [A], [notice(A)]);
    h.db.fail = (q) => (q.table === "locations" ? { message: "boom" } : null);
    const res = await getUnread();
    expect([res.status, (await res.json()).code]).toEqual([503, "notifications_unavailable"]);
  });
  it("leaves an unlocked step-up flag set (neutral)", async () => {
    seed("gm", [A], [notice(A)], { unlocked: true });
    expect((await getUnread()).status).toBe(200);
    expect(h.db.tables.sessions![0]!.step_up_unlocked).toBe(true);
  });
});

describe("POST /api/notifications/mark-all-read (A2)", () => {
  it("the SMM: 403 bell_refused with no read", async () => {
    seed("social_media_mgr", [A], [notice(A)]);
    const res = await postMarkAll();
    expect([res.status, (await res.json()).code]).toEqual([403, "bell_refused"]);
    expect(notificationReads(h.db)).toEqual([]);
    expect(h.db.tables.notification_recipients![0]!.read_at).toBeNull();
  });
  it("a key holder: today's behaviour (marks its own visible unread)", async () => {
    seed("key_holder", [A], [notice(A), notice(null), notice(B), notice(A, { userId: "other" })]);
    const res = await postMarkAll();
    expect(res.status).toBe(200);
    expect((await res.json()).marked).toBe(2); // A + shop-wide; B is outside its shops; another person's never
    const rows = h.db.tables.notification_recipients!;
    expect(rows.map((r) => r.read_at !== null)).toEqual([true, true, false, false]);
  });
  it("leaves an unlocked step-up flag set (neutral)", async () => {
    seed("gm", [A], [notice(A)], { unlocked: true });
    expect((await postMarkAll()).status).toBe(200);
    expect(h.db.tables.sessions![0]!.step_up_unlocked).toBe(true);
  });
});

describe("the mark-read action (components/nav/notification-actions.ts)", () => {
  it("the SMM: bell_refused with no read", async () => {
    seed("social_media_mgr", [A], [notice(A)]);
    expect(await markNotificationReadAction({ recipientId: "r1" })).toEqual({ ok: false, errorCode: "bell_refused" });
    expect(notificationReads(h.db)).toEqual([]);
    expect(h.db.tables.notification_recipients![0]!.read_at).toBeNull();
  });
  it("a key holder marks its own notice", async () => {
    seed("key_holder", [A], [notice(A)]);
    expect(await markNotificationReadAction({ recipientId: "r1" })).toEqual({ ok: true, newlyMarked: true });
    expect(h.db.tables.notification_recipients![0]!.read_at).not.toBeNull();
  });
  it("its session label is /api/notifications/mark-read, and it leaves an unlocked flag set", async () => {
    expect(readFileSync("components/nav/notification-actions.ts", "utf8")).toContain(`"/api/notifications/mark-read"`);
    seed("gm", [A], [notice(A)], { unlocked: true });
    expect((await markNotificationReadAction({ recipientId: "r1" })).ok).toBe(true);
    expect(h.db.tables.sessions![0]!.step_up_unlocked).toBe(true);
  });
  it("no revalidatePath: the island refetches", () => {
    expect(readFileSync("components/nav/notification-actions.ts", "utf8")).not.toMatch(/revalidatePath\(|next\/cache/);
  });
});
