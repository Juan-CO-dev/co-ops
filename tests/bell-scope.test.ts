/**
 * Nav PR 9, B3: the bell's scope AS THE CODE REALLY WORKS (plan r2 4.2, 4.5; lead ruling r1 F6).
 *
 * TODAY'S BEHAVIOUR, KEPT BY RULING: PR 9 changes no notification scope. The reader (`loadUnreadForUser`) and "Mark all
 * read" (`markAllNotificationsRead`) add a location predicate (the memberships, or a NULL shop, on the embedded
 * notification) ONLY for a NON-EMPTY membership array; `[]` (a crew member, a MoO or an owner with no membership) and
 * `undefined` (owner / CGS with none) apply NO location predicate, so the person reads every unread notice addressed to
 * them. This is not a leak: every row is still addressed to that person (`user_id`). The `undefined` = all / `[]` =
 * shop-wide-only correction is filed against the access plan's PR 3, which will change this test.
 *
 * The real reader and the real mark-all run over a recording client; the test pins the exact filters they send.
 */
import { describe, expect, it } from "vitest";
import { markAllNotificationsRead, loadUnreadForUser, notificationLocationContext } from "@/lib/notifications";
import { has, recordingSupabase, type RecordedQuery } from "./recording-supabase";

const ME = "me";
const recipientFilters = (q: RecordedQuery) => {
  expect(has(q, "eq", "user_id", ME)).toBe(true);
  expect(has(q, "is", "read_at", null)).toBe(true);
  expect(has(q, "eq", "delivery_method", "in_app")).toBe(true);
};
const orCalls = (q: RecordedQuery) => q.calls.filter(([n]) => n === "or");

describe("the reader", () => {
  it("memberships [A, B]: exactly one or() on the embedded notifications (A, B or a NULL shop)", async () => {
    const db = recordingSupabase({ notification_recipients: [] });
    await loadUnreadForUser(db.client, ME, { locationContext: ["A", "B"] });
    const [q] = db.queries;
    recipientFilters(q!);
    expect(has(q!, "neq", "delivery_status", "disabled")).toBe(true);
    expect(orCalls(q!)).toEqual([["or", "location_id.eq.A,location_id.eq.B,location_id.is.null", { referencedTable: "notifications" }]]);
  });
  it.each([
    ["[] (a crew member with no membership)", []],
    ["[] (a MoO with no membership)", []],
    ["[] (an owner with no membership)", []],
    ["undefined (owner / CGS with none)", undefined],
  ] as const)("%s: NO location predicate", async (_label, ctx) => {
    const db = recordingSupabase({ notification_recipients: [] });
    await loadUnreadForUser(db.client, ME, { locationContext: ctx as string[] | undefined });
    recipientFilters(db.queries[0]!);
    expect(has(db.queries[0]!, "neq", "delivery_status", "disabled")).toBe(true);
    expect(orCalls(db.queries[0]!)).toEqual([]);
  });
});

describe("mark all read: the identical condition on every pass", () => {
  const row = (id: string, loc: string | null) => ({
    id, notification_id: `n-${id}`, user_id: ME, delivery_method: "in_app", delivery_status: "sent", read_at: null,
    notifications: { id: `n-${id}`, location_id: loc, created_at: "2026-11-01T00:00:00Z" },
  });
  it("memberships [A, B]: every read pass carries the same or()", async () => {
    const db = recordingSupabase({ notification_recipients: [row("1", "A"), row("2", null), row("3", "C")] });
    await markAllNotificationsRead(db.client, { userId: ME, locationContext: ["A", "B"] });
    const reads = db.queries.filter((q) => q.op === "select");
    expect(reads.length).toBeGreaterThanOrEqual(1);
    for (const q of reads) {
      recipientFilters(q);
      expect(has(q, "neq", "delivery_status", "disabled")).toBe(true);
      expect(orCalls(q)).toEqual([["or", "location_id.eq.A,location_id.eq.B,location_id.is.null", { referencedTable: "notifications" }]]);
    }
    for (const q of db.queries.filter((x) => x.op === "update")) recipientFilters(q);
    expect(db.tables.notification_recipients!.map((r) => r.read_at !== null)).toEqual([true, true, false]);
  });
  it.each([["[]", []], ["undefined", undefined]] as const)("%s: no or() on any pass; every row addressed to the person is marked", async (_l, ctx) => {
    const db = recordingSupabase({ notification_recipients: [row("1", "A"), row("2", null), row("3", "C")] });
    await markAllNotificationsRead(db.client, { userId: ME, locationContext: ctx as string[] | undefined });
    for (const q of db.queries.filter((x) => x.op === "select")) expect(orCalls(q)).toEqual([]);
    expect(db.tables.notification_recipients!.every((r) => r.read_at !== null)).toBe(true);
  });
});

describe("notificationLocationContext", () => {
  it.each([
    ["owner with none", { level: 9, locations: [] }, undefined],
    ["CGS with none", { level: 10, locations: [] }, undefined],
    ["owner with memberships", { level: 9, locations: ["A"] }, ["A"]],
    ["MoO with none", { level: 8, locations: [] }, []],
    ["MoO with memberships", { level: 8, locations: ["A", "B"] }, ["A", "B"]],
    ["crew with none", { level: 3, locations: [] }, []],
  ] as const)("%s", (_l, auth, expected) => {
    expect(notificationLocationContext({ level: auth.level, locations: [...auth.locations] })).toEqual(expected);
  });
});
