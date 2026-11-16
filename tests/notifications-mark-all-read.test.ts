/**
 * tests/notifications-mark-all-read.test.ts — owner decision W26-5 b ("Mark all read").
 *
 * `markAllNotificationsRead` marks the ACTOR'S OWN unread in-app recipient rows read — exactly the
 * set the dashboard widget can show (same filters, same location context) — and reports the number
 * of rows its UPDATEs actually changed. The route refuses a cross-site POST before the session is
 * consulted, answers 401 without a session, and passes the session user and the widget's location
 * context to the lib.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { markAllNotificationsRead, notificationLocationContext } from "@/lib/notifications";

// ─── an in-memory fake of the two tables, honest about every filter the lib sends ───

type Recip = {
  id: string;
  notification_id: string;
  user_id: string;
  delivery_method: string;
  delivery_status: string;
  read_at: string | null;
};
type Notif = { id: string; location_id: string | null; created_at: string };

const ME = "user-me";
const OTHER = "user-other";
const LOC_A = "loc-a";
const LOC_B = "loc-b";

function makeDb() {
  const notifs = new Map<string, Notif>();
  const recips: Recip[] = [];
  let k = 0;
  const add = (r: Partial<Recip> & { location_id?: string | null }) => {
    const nid = `n${k}`;
    notifs.set(nid, {
      id: nid,
      location_id: r.location_id === undefined ? LOC_A : r.location_id,
      created_at: new Date(Date.UTC(2026, 10, 1) + k * 1000).toISOString(),
    });
    recips.push({
      id: `r${k}`,
      notification_id: nid,
      user_id: r.user_id ?? ME,
      delivery_method: r.delivery_method ?? "in_app",
      delivery_status: r.delivery_status ?? "pending",
      read_at: r.read_at ?? null,
    });
    k++;
  };
  return { notifs, recips, add };
}

type Db = ReturnType<typeof makeDb>;

function fakeClient(db: Db) {
  const log: Array<{ op: string; filters: string[] }> = [];
  const client = {
    from(table: string) {
      if (table !== "notification_recipients") throw new Error(`unexpected table ${table}`);
      const preds: Array<(r: Recip) => boolean> = [];
      const filters: string[] = [];
      let patch: Partial<Recip> | null = null;
      let limit = Infinity;
      let orLocs: { ids: string[]; nullOk: boolean } | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.update = (p: Partial<Recip>) => {
        patch = p;
        return b;
      };
      b.eq = (c: keyof Recip, v: unknown) => {
        filters.push(`eq:${String(c)}`);
        preds.push((r) => r[c] === v);
        return b;
      };
      b.neq = (c: keyof Recip, v: unknown) => {
        filters.push(`neq:${String(c)}`);
        preds.push((r) => r[c] !== v);
        return b;
      };
      b.is = (c: keyof Recip, v: unknown) => {
        filters.push(`is:${String(c)}`);
        preds.push((r) => r[c] === v);
        return b;
      };
      b.in = (c: keyof Recip, vs: unknown[]) => {
        filters.push(`in:${String(c)}`);
        preds.push((r) => vs.includes(r[c]));
        return b;
      };
      b.or = (expr: string, opts?: { referencedTable?: string }) => {
        if (opts?.referencedTable !== "notifications") throw new Error("or must target notifications");
        const parts = expr.split(",");
        orLocs = {
          ids: parts.filter((p) => p.startsWith("location_id.eq.")).map((p) => p.slice(15)),
          nullOk: parts.includes("location_id.is.null"),
        };
        return b;
      };
      b.order = () => b;
      b.limit = (n: number) => {
        limit = n;
        return b;
      };
      b.then = (resolve: (v: unknown) => void) => {
        log.push({ op: patch ? "update" : "select", filters });
        const visible = (r: Recip) => {
          if (!orLocs) return true;
          const loc = db.notifs.get(r.notification_id)?.location_id ?? null;
          return loc === null ? orLocs.nullOk : orLocs.ids.includes(loc);
        };
        const hit = db.recips.filter((r) => preds.every((p) => p(r)) && visible(r)).slice(0, limit);
        if (patch) for (const r of hit) Object.assign(r, patch);
        resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

describe("markAllNotificationsRead", () => {
  it("marks only the actor's unread in-app, non-disabled rows and counts them", async () => {
    const db = makeDb();
    for (let i = 0; i < 3; i++) db.add({});
    db.add({ user_id: OTHER }); // someone else's
    db.add({ read_at: "2026-11-01T00:00:00Z" }); // already read
    db.add({ delivery_method: "email" }); // not in-app
    db.add({ delivery_status: "disabled" }); // never shown
    const { client, log } = fakeClient(db);

    const { marked } = await markAllNotificationsRead(client, { userId: ME });

    expect(marked).toBe(3);
    expect(db.recips.filter((r) => r.read_at !== null && r.user_id === ME).map((r) => r.id).sort()).toEqual(
      ["r0", "r1", "r2", "r4"].sort(),
    );
    expect(db.recips.find((r) => r.user_id === OTHER)?.read_at).toBeNull();
    expect(db.recips.find((r) => r.delivery_method === "email")?.read_at).toBeNull();
    expect(db.recips.find((r) => r.delivery_status === "disabled")?.read_at).toBeNull();
    expect(db.recips.find((r) => r.id === "r4")?.read_at).toBe("2026-11-01T00:00:00Z"); // first read kept
    // every UPDATE re-states the owner + unread + in-app guard (defence in depth on service role)
    for (const u of log.filter((l) => l.op === "update")) {
      expect(u.filters).toEqual(expect.arrayContaining(["eq:user_id", "is:read_at", "eq:delivery_method"]));
    }
  });

  it("with a location context marks only what the widget shows (its shops + shop-wide)", async () => {
    const db = makeDb();
    db.add({ location_id: LOC_A });
    db.add({ location_id: null });
    db.add({ location_id: LOC_B });
    const { client } = fakeClient(db);

    const { marked } = await markAllNotificationsRead(client, { userId: ME, locationContext: [LOC_A] });

    expect(marked).toBe(2);
    expect(db.recips.find((r) => r.id === "r2")?.read_at).toBeNull();
  });

  it("marks far more than one page without an unbounded id list", async () => {
    const db = makeDb();
    for (let i = 0; i < 730; i++) db.add({ location_id: i % 2 ? LOC_A : null });
    const { client, log } = fakeClient(db);

    const { marked } = await markAllNotificationsRead(client, { userId: ME, locationContext: [LOC_A] });

    expect(marked).toBe(730);
    expect(db.recips.every((r) => r.read_at !== null)).toBe(true);
    expect(log.filter((l) => l.op === "update").length).toBeGreaterThan(1);
  });

  it("returns 0 when nothing is unread", async () => {
    const { client } = fakeClient(makeDb());
    expect(await markAllNotificationsRead(client, { userId: ME })).toEqual({ marked: 0 });
  });
});

describe("notificationLocationContext", () => {
  it("is unfiltered only for the level-9 all-locations override", () => {
    expect(notificationLocationContext({ level: 9, locations: [] })).toBeUndefined();
    expect(notificationLocationContext({ level: 9, locations: [LOC_A] })).toEqual([LOC_A]);
    expect(notificationLocationContext({ level: 7, locations: [LOC_A] })).toEqual([LOC_A]);
  });
});

// ─── the route ───

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/notifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications")>("@/lib/notifications");
  return { ...actual, markAllNotificationsRead: vi.fn(actual.markAllNotificationsRead) };
});

const { requireSession } = await import("@/lib/session");
const notifications = await import("@/lib/notifications");
const { POST } = await import("@/app/api/notifications/mark-all-read/route");

const HOST = "https://example.com";
const post = (headers: Record<string, string>) =>
  new NextRequest(`${HOST}/api/notifications/mark-all-read`, { method: "POST", headers });

describe("POST /api/notifications/mark-all-read", () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockReset();
    vi.mocked(notifications.markAllNotificationsRead).mockReset();
  });

  it("refuses a cross-site POST before the session is consulted", async () => {
    const res = await POST(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("refuses a POST with no Origin", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it("answers 401 without a session and marks nothing", async () => {
    vi.mocked(requireSession).mockResolvedValue(
      new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 }) as never,
    );
    const res = await POST(post({ origin: HOST, "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(401);
    expect(notifications.markAllNotificationsRead).not.toHaveBeenCalled();
  });

  it("marks the session user's rows in the widget's location context and returns the count", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: ME },
      level: 7,
      locations: [LOC_A],
    } as never);
    vi.mocked(notifications.markAllNotificationsRead).mockResolvedValue({ marked: 4 });
    const res = await POST(post({ origin: HOST, "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: 4 });
    expect(notifications.markAllNotificationsRead).toHaveBeenCalledWith(expect.anything(), {
      userId: ME,
      locationContext: [LOC_A],
    });
  });

  it("answers 500 server_error when the write fails", async () => {
    vi.mocked(requireSession).mockResolvedValue({ user: { id: ME }, level: 9, locations: [] } as never);
    vi.mocked(notifications.markAllNotificationsRead).mockRejectedValue(new Error("boom"));
    const res = await POST(post({ origin: HOST, "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("server_error");
    expect(notifications.markAllNotificationsRead).toHaveBeenCalledWith(expect.anything(), {
      userId: ME,
      locationContext: undefined,
    });
  });
});

// ─── i18n: every new string ships en + es ───

describe("Mark all read strings", () => {
  it("exist in en and es", async () => {
    const en = (await import("@/lib/i18n/en.json")).default as Record<string, string>;
    const es = (await import("@/lib/i18n/es.json")).default as Record<string, string>;
    for (const k of [
      "notifications.sheet.mark_all_read",
      "notifications.sheet.mark_all_read_aria",
      "notifications.sheet.mark_all_read_pending",
      "notifications.sheet.mark_all_read_error",
    ]) {
      expect(en[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
      expect(es[k]).not.toBe(en[k]);
    }
  });
});
