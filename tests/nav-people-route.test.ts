/**
 * Nav PR 9, S2: GET /api/nav/people (plan r2 3.3, 4.4, 9; lead rulings r1 F4, F7 and r2 G1).
 *
 * `requireSession` is NOT mocked (as tests/labor-burden-route.test.ts): it runs over a recording fake, so every query
 * of the request is recorded. G1: the exact baseline of session queries is asserted first (the four session
 * operations, identified by table, columns and predicates), then ZERO directory queries for the social media manager.
 * Directory-read failures are injected only after authentication succeeds (at a non-session query). Also: exact body
 * fields, the query scope, paging and chunking, the pinned read counts, step-up neutrality and validation.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeCalls, has, isSessionOp, recordingSupabase, SESSION_BASELINE, type RecordedQuery, type RecordingDb, type Row } from "./recording-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./recording-supabase").RecordingDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { GET } from "@/app/api/nav/people/route";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";

const A = "1c000000-0000-4000-8000-00000000000a";
const B = "1c000000-0000-4000-8000-00000000000b";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const get = (q: string | null) => GET(new NextRequest(`http://localhost/api/nav/people${q === null ? "" : `?q=${encodeURIComponent(q)}`}`, { headers: cookie }));

const directoryQueries = (db: RecordingDb) => db.queries.filter((q) => !isSessionOp(q));
const kind = (q: RecordedQuery) => `${q.table}:${q.op}`;

function user(id: string, name: string, role: string, active = true): Row {
  return { id, name, role, active, email: `${id}@example.test`, phone: "555-0100", language: "en" };
}
function seed(viewerRole: string, viewerShops: string[], opts: { unlocked?: boolean; extraUsers?: Row[]; extraMemberships?: Row[] } = {}) {
  h.db = recordingSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "pin",
      step_up_unlocked: opts.unlocked ?? false, step_up_unlocked_at: opts.unlocked ? new Date().toISOString() : null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [
      user("user-1", "Viewer Person", viewerRole),
      user("u-teammate", "Tessa Teammate", "employee"),
      user("u-bonly", "Bertha Bonly", "employee"),
      user("u-gone", "Gus Gone", "employee", false),
      user("u-moo", "Mona Moo", "moo"),
      user("u-oldlead", "Olga Oldlead", "owner", false),
      ...(opts.extraUsers ?? []),
    ],
    user_locations: [
      ...viewerShops.map((s) => ({ user_id: "user-1", location_id: s, active: true })),
      { user_id: "u-teammate", location_id: A, active: true },
      { user_id: "u-bonly", location_id: B, active: true },
      { user_id: "u-gone", location_id: A, active: true },
      ...(opts.extraMemberships ?? []),
    ],
  });
}
beforeEach(() => seed("key_holder", [A]));

describe("G1: the session baseline, then the rule", () => {
  it("the first four queries are exactly the four session operations (table + columns + predicates)", async () => {
    await get("Tessa");
    const first = h.db.queries.slice(0, 4);
    expect(first.map(kind)).toEqual([...SESSION_BASELINE]);
    for (const q of first) expect(isSessionOp(q), describeCalls(q)).toBe(true);
    expect(describeCalls(first[0]!)).toBe(`select("*") eq("id","session-1") maybeSingle()`);
    expect(Object.keys(first[1]!.payload as object)).toEqual(["last_activity_at"]);
    expect(describeCalls(first[2]!)).toBe(`select("*") eq("id","user-1") maybeSingle()`);
    expect(describeCalls(first[3]!)).toBe(`select("location_id") eq("user_id","user-1") eq("active",true)`);
  });
  it("the social media manager: 403 people_search_refused, the four session operations and ZERO directory queries", async () => {
    seed("social_media_mgr", [A]);
    const res = await get("Tessa");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("people_search_refused");
    expect(h.db.queries.map(kind)).toEqual([...SESSION_BASELINE]);
    expect(h.db.queries.every((q) => isSessionOp(q))).toBe(true);
    expect(directoryQueries(h.db)).toEqual([]);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("refused before validation too: a bad query from the SMM is still 403 with no directory read", async () => {
    seed("social_media_mgr", [A]);
    const res = await get("x");
    expect(res.status).toBe(403);
    expect(directoryQueries(h.db)).toEqual([]);
  });
  it("served: a key holder, an AGM, a GM, a MoO with memberships and an owner", async () => {
    for (const role of ["key_holder", "agm", "gm", "moo", "owner"]) {
      seed(role, role === "owner" ? [] : [A]);
      const res = await get("Tessa");
      expect(res.status, role).toBe(200);
    }
  });
});

describe("exact fields", () => {
  it("the body is exactly { people, hasMore }; each person exactly { userId, name, role }; at most 10", async () => {
    const many = Array.from({ length: 14 }, (_, i) => user(`u-zed-${i}`, `Zed Person ${String(i).padStart(2, "0")}`, "employee"));
    seed("key_holder", [A], { extraUsers: many, extraMemberships: many.map((u) => ({ user_id: u.id, location_id: A, active: true })) });
    const res = await get("Zed");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["hasMore", "people"]);
    expect(body.people).toHaveLength(10);
    expect(body.hasMore).toBe(true);
    for (const p of body.people) expect(Object.keys(p).sort()).toEqual(["name", "role", "userId"]);
    expect(JSON.stringify(body)).not.toMatch(/example\.test|555-0100|mvp/i);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("scope", () => {
  const names = async (q: string) => ((await (await get(q)).json()).people as Array<{ name: string }>).map((p) => p.name);
  it("a key holder at shop A finds an A teammate and active leadership, never a B-only staffer or an inactive user", async () => {
    expect(await names("Tessa")).toEqual(["Tessa Teammate"]);
    expect(await names("Bertha")).toEqual([]);
    expect(await names("Gus")).toEqual([]);
    expect(await names("Mona")).toEqual(["Mona Moo"]);
    expect(await names("Olga")).toEqual([]);
  });
  it("the owner (all shops) finds a B-only staffer; the inactive stay out", async () => {
    seed("owner", []);
    expect(await names("Bertha")).toEqual(["Bertha Bonly"]);
    expect(await names("Gus")).toEqual([]);
    expect(await names("Olga")).toEqual([]);
  });
  it("a member viewer reads users only through its shops' memberships and the leadership roles", async () => {
    await get("Tessa");
    const d = directoryQueries(h.db);
    expect(d.map(kind)).toEqual(["user_locations:select", "users:select", "users:select"]);
    expect(describeCalls(d[0]!)).toBe(`select("user_id") in("location_id",["${A}"]) eq("active",true) order("user_id",{"ascending":true}) range(0,999)`);
    expect(has(d[1]!, "in", "id")).toBe(true);
    expect(has(d[1]!, "eq", "active", true)).toBe(true);
    expect(d[1]!.columns).toBe("id, name, role");
    expect(has(d[2]!, "in", "role", ["cgs", "owner", "moo"])).toBe(true);
    expect(d[2]!.columns).toBe("id, name, role");
    for (const q of d) {
      expect(q.table).not.toBe("pm_reports");
      if (q.columns) expect(q.columns).not.toMatch(/email|phone|blurb/);
    }
  });
});

describe("errors (F4): a failed read is 503 people_unavailable, never an empty list", () => {
  const injections: Array<[string, (q: RecordedQuery) => boolean]> = [
    ["the membership page", (q) => q.table === "user_locations" && has(q, "in", "location_id")],
    ["a users chunk", (q) => q.table === "users" && q.calls.some(([n, c]) => n === "in" && c === "id")],
    ["the leadership read", (q) => q.table === "users" && q.calls.some(([n, c]) => n === "in" && c === "role")],
  ];
  it.each(injections)("member scope: %s", async (_name, match) => {
    h.db.fail = (q) => (!isSessionOp(q) && match(q) ? { message: "boom" } : null);
    const res = await get("Tessa");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("people_unavailable");
  });
  it("all scope: the all-users page", async () => {
    seed("owner", []);
    h.db.fail = (q) => (!isSessionOp(q) && q.table === "users" && !q.calls.some(([n]) => n === "in") ? { message: "boom" } : null);
    const res = await get("Bertha");
    expect([res.status, (await res.json()).code]).toEqual([503, "people_unavailable"]);
  });
  it("no memberships: the leadership read", async () => {
    seed("key_holder", []);
    h.db.fail = (q) => (!isSessionOp(q) && q.table === "users" ? { message: "boom" } : null);
    expect((await get("Mona")).status).toBe(503);
  });
});

describe("paging and chunking", () => {
  it("1,001 membership rows: two pages of the membership read", async () => {
    const extra = Array.from({ length: 1000 }, (_, i) => ({ user_id: `u-m-${String(i).padStart(4, "0")}`, location_id: A, active: true }));
    seed("key_holder", [A], { extraMemberships: extra });
    await get("Tessa");
    const pages = directoryQueries(h.db).filter((q) => q.table === "user_locations");
    expect(pages.map((q) => q.calls.find(([n]) => n === "range"))).toEqual([["range", 0, 999], ["range", 1000, 1999]]);
  });
  it("250 member ids: three users chunks of at most 100", async () => {
    const extraUsers = Array.from({ length: 247 }, (_, i) => user(`u-c-${String(i).padStart(3, "0")}`, `Chunk ${i}`, "employee"));
    seed("key_holder", [A], { extraUsers, extraMemberships: extraUsers.map((u) => ({ user_id: u.id, location_id: A, active: true })) });
    await get("Tessa");
    // 247 + user-1 + teammate + gone = 250 unique member ids.
    const chunks = directoryQueries(h.db).filter((q) => q.table === "users" && q.calls.some(([n, c]) => n === "in" && c === "id"));
    expect(chunks.map((q) => (q.calls.find(([n, c]) => n === "in" && c === "id")![2] as unknown[]).length)).toEqual([100, 100, 50]);
  });
});

describe("counts (F7), pinned: data reads + the 4 session reads", () => {
  it("member scope: 3 + 4 = 7", async () => {
    await get("Tessa");
    expect(directoryQueries(h.db)).toHaveLength(3);
    expect(h.db.queries).toHaveLength(7);
  });
  it("all scope (owner): 1 + 4 = 5", async () => {
    seed("owner", []);
    await get("Tessa");
    expect(directoryQueries(h.db)).toHaveLength(1);
    expect(h.db.queries).toHaveLength(5);
  });
  it("no memberships: 1 + 4 = 5", async () => {
    seed("key_holder", []);
    await get("Mona");
    expect(directoryQueries(h.db).map(kind)).toEqual(["users:select"]);
    expect(h.db.queries).toHaveLength(5);
  });
});

describe("step-up: the search is neutral", () => {
  it("an unlocked session stays unlocked through a search", async () => {
    seed("gm", [A], { unlocked: true });
    expect((await get("Tessa")).status).toBe(200);
    expect(h.db.tables.sessions![0]!.step_up_unlocked).toBe(true);
  });
  it("control: a non-neutral path clears it", async () => {
    seed("gm", [A], { unlocked: true });
    const ctx = await requireSession(new NextRequest("http://localhost/api/nav/peoplex", { headers: cookie }), "/api/nav/peoplex");
    expect(ctx instanceof Response).toBe(false);
    expect(h.db.tables.sessions![0]!.step_up_unlocked).toBe(false);
  });
});

describe("validation", () => {
  it.each([["a"], [" b "], ["x".repeat(65)], [""], [null]])("q=%s → 400 with no directory read", async (q) => {
    const res = await get(q as string | null);
    expect(res.status).toBe(400);
    expect(directoryQueries(h.db)).toEqual([]);
  });
  it("2 and 64 characters are accepted", async () => {
    expect((await get("Te")).status).toBe(200);
    seed("key_holder", [A]);
    expect((await get("T".repeat(64))).status).toBe(200);
  });
});
