/**
 * Scheduling Phase 2, chunk G, Task 25 — `loadReconciliation`, over the in-memory PostgREST fake
 * (tests/fixtures/schedule/lib-store) and the real generator / commit mirror for the CO-OPS proposal:
 *  - the permission rule BEFORE any I/O (SMM by role; AGM / KH refused by name; a GM elsewhere → shop_not_allowed);
 *  - 7shifts not ready → NO 7shifts table is read (the fake has none: a read would fail), every 7shifts tick
 *    "not connected"; Toast links and the first name only;
 *  - 7shifts ready → the published (draft = false) shifts at the shop's linked location decide attendance; a draft does not;
 *  - a missing 0275 → no proposal (never a 500); a missing 0233 → no Toast links;
 *  - members: levels 1–7 at the shop, the social media manager aside (MoO is presence only);
 *  - the deep links to the existing link screens; the view never writes (no RPC called).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const lib = await import("@/lib/scheduling/schedules");
const { loadReconciliation } = await import("@/lib/scheduling/reconcile");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
import type { PeopleActor } from "@/lib/people/access-shared";
import { A, AGM, B, GM, KH, MOO, SMM, STAFF, noIoClient, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-28T16:00:00Z"); // Wed Oct 28, noon ET → the window Oct 15 … Oct 28
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const moo = actor(MOO, "moo", 8, []);
const READY = { SEVENSHIFTS_ACCESS_TOKEN: "t", SEVENSHIFTS_SYNC: "1" };
const OFF = {};
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; } };
const at = (date: string, hhmm: string) => `${date}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`; // EDT

function shop(mut: (t: ReturnType<typeof shopTables>) => void = () => {}) {
  const t = shopTables();
  t.toast_employee_links = [
    { id: "l1", location_id: A, employee_guid: "tg-kai", user_id: KH, active: true },
    { id: "l2", location_id: A, employee_guid: "tg-old", user_id: STAFF[0], active: false },
  ];
  t.toast_time_entries = [
    { location_id: A, time_entry_guid: "e1", business_date: "2026-10-27", employee_guid: "tg-kai", employee_first_name: "Kai", user_id: KH, in_at: at("2026-10-27", "11:00"), out_at: at("2026-10-27", "15:00"), hours: 4, deleted: false },
    { location_id: A, time_entry_guid: "e2", business_date: "2026-10-27", employee_guid: "tg-new", employee_first_name: "Ana", user_id: null, in_at: at("2026-10-27", "07:00"), out_at: at("2026-10-27", "11:00"), hours: 4, deleted: false },
    { location_id: A, time_entry_guid: "e3", business_date: "2026-10-27", employee_guid: "tg-gone", employee_first_name: "Zed", user_id: null, in_at: at("2026-10-27", "07:00"), out_at: null, hours: null, deleted: true },
    { location_id: B, time_entry_guid: "e4", business_date: "2026-10-27", employee_guid: "tg-b", employee_first_name: "Bo", user_id: null, in_at: at("2026-10-27", "07:00"), out_at: null, hours: null, deleted: false },
    { location_id: A, time_entry_guid: "e5", business_date: "2026-10-01", employee_guid: "tg-early", employee_first_name: "Old", user_id: null, in_at: at("2026-10-01", "07:00"), out_at: null, hours: null, deleted: false },
  ];
  mut(t);
  const s = scheduleStore(t);
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId } };
}
function sevenTables(t: ReturnType<typeof shopTables>) {
  t.sevenshifts_location_links = [{ id: "sl1", location_id: A, sevenshifts_location_id: 9001, active: true }];
  t.sevenshifts_user_assignments = [{ id: "as1", user_id: 701, location_id: 9001, active: true }, { id: "as2", user_id: 702, location_id: 9001, active: true }];
  t.sevenshifts_users = [
    { id: 701, first_name: "Kai", last_name: "Nguyen", preferred_first_name: null, employee_id: "E701", active: true },
    { id: 702, first_name: "Rosa", last_name: "Vega", preferred_first_name: null, employee_id: "E702", active: true },
  ];
  t.sevenshifts_user_links = [{ id: "ul1", sevenshifts_user_id: 701, user_id: KH, linked_at_location_id: A, active: true }];
  t.sevenshifts_shifts = [
    { id: 1, user_id: 701, location_id: 9001, start_at: at("2026-10-27", "07:00"), end_at: at("2026-10-27", "11:00"), draft: false, deleted: false },
    { id: 2, user_id: 701, location_id: 9001, start_at: at("2026-10-26", "11:00"), end_at: at("2026-10-26", "15:00"), draft: true, deleted: false },
  ];
  t.sevenshifts_time_punches = [];
}

describe("loadReconciliation — permissions first", () => {
  it("the social media manager by ROLE, before any read; AGM and KH by name; a GM at another shop → shop_not_allowed", async () => {
    expect(await code(loadReconciliation({ service: noIoClient(), now: NOW }, { actor: actor(SMM, "social_media_mgr", 6, [A]), locationId: A }, OFF))).toBe("schedule_role_refused");
    expect(await code(loadReconciliation({ service: noIoClient(), now: NOW }, { actor: actor(AGM, "agm", 6, [A]), locationId: A }, OFF))).toBe("schedule_forbidden");
    expect(await code(loadReconciliation({ service: noIoClient(), now: NOW }, { actor: actor(KH, "key_holder", 4, [A]), locationId: A }, OFF))).toBe("schedule_forbidden");
    expect(await code(loadReconciliation({ service: noIoClient(), now: NOW }, { actor: gm, locationId: B }, OFF))).toBe("shop_not_allowed");
    expect(await code(loadReconciliation(shop().deps, { actor: moo, locationId: A }, OFF))).toBe("ok");
  });
});

describe("loadReconciliation — 7shifts not connected", () => {
  it("reads no 7shifts table; ticks 'not connected'; Toast links by link only; the first name only; the window is 14 ET days", async () => {
    const s = shop();
    const page = await loadReconciliation(s.deps, { actor: gm, locationId: A }, OFF);
    expect(page.dates).toHaveLength(14);
    expect(page.dates[0]).toBe("2026-10-15");
    expect(page.dates[13]).toBe("2026-10-28");
    expect(page.sevenStatus).toBe("not_connected");
    expect(page.view.rows.every((r) => r.ticks.seven === "not_connected")).toBe(true);
    // Members: levels 1–7, never the social media manager; MoO (no membership) is not a row.
    const ids = page.view.rows.map((r) => r.userId);
    expect(ids).toContain(KH);
    expect(ids).toContain(GM);
    expect(ids).not.toContain(SMM);
    expect(ids).not.toContain(MOO);
    expect(page.view.rows.find((r) => r.userId === KH)!.ticks.toast).toBe("linked");
    // STAFF[0]'s link is INACTIVE: missing.
    expect(page.view.rows.find((r) => r.userId === STAFF[0])!.ticks.toast).toBe("missing");
    // The unlinked clock-in in the window, at THIS shop, not deleted: first name only.
    expect(page.view.toastUnlinked).toEqual([{ employeeGuid: "tg-new", firstName: "Ana", punchDays: 1, flags: [{ code: "toast_clockin_no_user" }] }]);
    expect(JSON.stringify(page)).not.toMatch(/Nguyen|Vega/);
    expect(page.links).toEqual({ toast: `/admin/toast-employees?loc=${A}`, seven: `/admin/sevenshifts?loc=${A}` });
    expect(s.calls).toEqual([]);
  });
});

describe("loadReconciliation — 7shifts ready", () => {
  it("the published shift decides (Kai worked 11–15, published 7–11 → shift_no_punch + punch_no_shift); the draft does not; Rosa is unlinked", async () => {
    const s = shop(sevenTables);
    const page = await loadReconciliation(s.deps, { actor: gm, locationId: A }, READY);
    expect(page.sevenStatus).toBe("ready");
    expect(page.shopLinkedToSeven).toBe(true);
    const kai = page.view.rows.find((r) => r.userId === KH)!;
    expect(kai.ticks).toEqual({ coops: true, toast: "linked", seven: "linked" });
    expect(kai.flags.map((f) => f.code)).toEqual(["shift_no_punch", "punch_no_shift"]);
    expect(kai.days.find((d) => d.date === "2026-10-26")).toBeUndefined(); // only a draft that day: nothing to compare
    expect(page.view.sevenUnlinked).toEqual([{ sevenUserId: "702", displayName: "Rosa V.", employeeId: "E702", flags: [{ code: "seven_user_unlinked" }] }]);
    expect(page.view.rows.find((r) => r.userId === GM)!.flags.map((f) => f.code)).toEqual(["member_no_toast", "member_no_seven"]);
    expect(JSON.stringify(page)).not.toMatch(/Nguyen|Vega/);
  });
});

describe("loadReconciliation — the CO-OPS proposal and missing migrations", () => {
  it("a generated week is the proposal for its dates; without 0275 there is no proposal and no 500; without 0233 no Toast links", async () => {
    const s = shop();
    await lib.generateWeek({ ...s.deps, now: new Date("2026-10-21T16:00:00Z") }, { actor: gm, locationId: A, weekStart: "2026-10-26", expectedHead: null });
    const page = await loadReconciliation(s.deps, { actor: gm, locationId: A }, OFF);
    expect(page.proposalAvailable).toBe(true);
    expect(page.view.rows.some((r) => r.days.some((d) => d.proposal && d.basis === "proposal_not_published" && d.missing === "seven_not_connected"))).toBe(true);
    const no75 = await loadReconciliation(shop((t) => { delete t.schedule_weeks; }).deps, { actor: gm, locationId: A }, OFF);
    expect(no75.proposalAvailable).toBe(false);
    const no33 = await loadReconciliation(shop((t) => { delete t.toast_employee_links; }).deps, { actor: gm, locationId: A }, OFF);
    expect(no33.toastLinksAvailable).toBe(false);
    expect(no33.view.rows.every((r) => r.ticks.toast === "missing")).toBe(true);
  });
});

describe("Astra chunk G review — the loader passes its clock and counts the inactive 7shifts users (P2-2, P3-5)", () => {
  it("an inactive 7shifts user assigned at the shop is not listed but counted; an open punch now is on shift, a later shift upcoming", async () => {
    const s = shop((t) => {
      sevenTables(t);
      t.sevenshifts_user_assignments.push({ id: "as3", user_id: 703, location_id: 9001, active: true });
      t.sevenshifts_users.push({ id: 703, first_name: "Old", last_name: "Timer", preferred_first_name: null, employee_id: "E703", active: false });
      // Wed Oct 28, published 11:00–15:00 and 16:00–20:00; clocked in 10:55, still open at noon ET (NOW).
      t.sevenshifts_shifts.push(
        { id: 3, user_id: 701, location_id: 9001, start_at: at("2026-10-28", "11:00"), end_at: at("2026-10-28", "15:00"), draft: false, deleted: false },
        { id: 4, user_id: 701, location_id: 9001, start_at: at("2026-10-28", "16:00"), end_at: at("2026-10-28", "20:00"), draft: false, deleted: false },
      );
      t.toast_time_entries.push({ location_id: A, time_entry_guid: "e6", business_date: "2026-10-28", employee_guid: "tg-kai", employee_first_name: "Kai", user_id: KH, in_at: at("2026-10-28", "10:55"), out_at: null, hours: null, deleted: false });
    });
    const page = await loadReconciliation(s.deps, { actor: gm, locationId: A }, READY);
    expect(page.view.sevenUnlinked.map((u) => u.sevenUserId)).toEqual(["702"]);
    expect(page.view.counts.sevenInactiveHidden).toBe(1);
    const kai = page.view.rows.find((r) => r.userId === KH)!;
    expect(kai.days.find((d) => d.date === "2026-10-28")).toMatchObject({ onShiftNow: true, upcoming: 1, flags: [] });
  });
});
