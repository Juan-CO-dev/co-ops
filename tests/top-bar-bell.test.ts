/**
 * Nav PR 9, B1: the bar's bell read under ONE deadline (plan r2 3.1 TopBarBell, 4.2; lead ruling r1 F3).
 *
 * The unread read and the shop-code read share ONE absolute 6 s deadline and ONE signal: a hanging or rejecting code
 * read ends the whole unit (aborting the signal, leaving no timer), the unit never rejects, a hanging unread read means
 * no code query is ever built (`withAbortStrict`), and no notice with a shop means no locations query. For the social
 * media manager nothing is built at all. Fake timers and a recording client: no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingSupabase, type Row } from "./recording-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./recording-supabase").RecordingDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));

import { loadBellUnit, TOP_BAR_BELL_DEADLINE_MS } from "@/lib/top-bar-bell";

let n = 0;
function notice(locationId: string | null): Row {
  n++;
  return {
    id: `r${n}`, notification_id: `n${n}`, user_id: "me", delivery_method: "in_app", delivery_status: "sent", read_at: null, acknowledged_at: null,
    notifications: { id: `n${n}`, type: "under_par_alert", priority: "urgent", title: "t", body: null, data: {}, related_table: null,
      related_id: null, location_id: locationId, created_at: "2026-11-01T12:00:00Z" },
  };
}
const viewer = (role = "key_holder") => ({ role: role as never, level: 4, locations: ["A"], user: { id: "me" } });
const locQueries = () => h.db.queries.filter((q) => q.table === "locations");
const unreadQueries = () => h.db.queries.filter((q) => q.table === "notification_recipients");

beforeEach(() => {
  n = 0;
  h.db = recordingSupabase({ notification_recipients: [notice("A"), notice(null)], locations: [{ id: "A", code: "AAA" }] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("B1: one deadline over the unread read and the code read", () => {
  it("the deadline is 6 s", () => expect(TOP_BAR_BELL_DEADLINE_MS).toBe(6_000));

  it("(a) both reads ok: { notices, locationCodes }, no timer left", async () => {
    const r = await loadBellUnit(viewer())!;
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.notices.map((x) => x.recipient.id).sort()).toEqual(["r1", "r2"]);
    expect(r.value.locationCodes).toEqual({ A: "AAA" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(b) unread ok, the code read hangs: timed_out at 6 s, the code query's signal aborted, no timer left", async () => {
    h.db.hang = (q) => q.table === "locations";
    const p = loadBellUnit(viewer())!;
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(done).toBe(false);
    expect(locQueries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: "timed_out" });
    expect(locQueries()[0]!.signal?.aborted).toBe(true);
    expect(unreadQueries()[0]!.signal).toBe(locQueries()[0]!.signal); // ONE signal for both
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(c) unread ok, the code read rejects: failed, the signal aborted, no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    h.db.fail = (q) => (q.table === "locations" ? { message: "boom" } : null);
    expect(await loadBellUnit(viewer())!).toEqual({ kind: "failed" });
    expect(locQueries()[0]!.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("(d) the unread read hangs: no code query is ever built", async () => {
    h.db.hang = (q) => q.table === "notification_recipients";
    const p = loadBellUnit(viewer())!;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await p).toEqual({ kind: "timed_out" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(locQueries()).toEqual([]);
    expect(unreadQueries()[0]!.signal?.aborted).toBe(true);
  });

  it("(e) zero notices, or only shop-less notices: no locations query", async () => {
    for (const rows of [[], [notice(null), notice(null)]]) {
      h.db = recordingSupabase({ notification_recipients: rows, locations: [] });
      const r = await loadBellUnit(viewer())!;
      expect(r.kind).toBe("ok");
      if (r.kind === "ok") expect(r.value.locationCodes).toEqual({});
      expect(locQueries()).toEqual([]);
    }
  });

  it("(f) never rejects: an unread failure is `failed`", async () => {
    h.db.fail = (q) => (q.table === "notification_recipients" ? { message: "boom" } : null);
    await expect(loadBellUnit(viewer())!).resolves.toEqual({ kind: "failed" });
    expect(locQueries()).toEqual([]);
  });

  it("(g) the social media manager: null before any query is built", () => {
    expect(loadBellUnit(viewer("social_media_mgr"))).toBeNull();
    expect(h.db.queries).toEqual([]);
  });
});

// ─── Step 8: the streamed component (TopBarBell) hands the island exactly what the unit settled ─────────────────────
import { isValidElement, type ReactElement } from "react";
import { TopBarBell } from "@/components/nav/TopBarBell";
import { BellIsland } from "@/components/nav/BellIsland";

const auth = (role = "key_holder") => ({
  role, level: 4, locations: ["A"], user: { id: "me" }, session: { id: "sess-1" },
}) as unknown as Parameters<typeof TopBarBell>[0]["auth"];

describe("B1: TopBarBell", () => {
  it("(a) both ok: the island receives { notices, locationCodes }, keyed by role and session", async () => {
    const el = (await TopBarBell({ auth: auth() })) as ReactElement<{ initial: unknown }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe(BellIsland);
    expect(el.key).toBe("key_holder:sess-1");
    const initial = el.props.initial as { notices: Array<{ recipient: { id: string } }>; locationCodes: Record<string, string> };
    expect(Object.keys(initial).sort()).toEqual(["locationCodes", "notices"]);
    expect(initial.locationCodes).toEqual({ A: "AAA" });
  });
  it("(b) the code read hangs: at 6 s the island is 'unavailable' (initial null), never a 0", async () => {
    h.db.hang = (q) => q.table === "locations";
    const p = TopBarBell({ auth: auth() });
    await vi.advanceTimersByTimeAsync(6_000);
    const el = (await p) as ReactElement<{ initial: unknown }>;
    expect(el.type).toBe(BellIsland);
    expect(el.props.initial).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("(c) the code read rejects: 'unavailable'", async () => {
    h.db.fail = (q) => (q.table === "locations" ? { message: "boom" } : null);
    const el = (await TopBarBell({ auth: auth() })) as ReactElement<{ initial: unknown }>;
    expect(el.props.initial).toBeNull();
  });
  it("(g) the social media manager: null, and no query is ever built", async () => {
    expect(await TopBarBell({ auth: auth("social_media_mgr") })).toBeNull();
    expect(h.db.queries).toEqual([]);
  });
});
