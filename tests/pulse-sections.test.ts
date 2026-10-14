import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PeopleSection } from "@/components/pulse/sections/PeopleSection";
import { TranslationProvider } from "@/lib/i18n/provider";
/**
 * Section loaders: scope BEFORE any read, per-section isolation (one failure never blanks another),
 * the 7 s deadline, "not installed" states, and the crew / money stripping — all with fake deps.
 */
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { ShiftBoard } from "@/lib/assignments-shared";
import {
  defaultPulseDeps, loadPulseSection, loadPulseSections, memoDeps, parPassLow, withDeadline, type PulseCtx, type PulseDeps,
} from "@/lib/pulse/sections";
import { PulseNotInstalledError, type HandoffRaw } from "@/lib/pulse/handoff";
import { SalesReportError } from "@/lib/sales-reports";
import type { AttentionData, CateringData, FloorData, FoodSafetyData, HandoffData, InventoryData, PeopleData, StationsData } from "@/lib/pulse/types";

const LOC = "11111111-1111-4111-8111-111111111111";
const auth = (level: number, id = "me"): AuthContext => ({
  user: { id, role: level >= 7 ? "gm" : level >= 4 ? "key_holder" : "employee", language: "en" } as AuthContext["user"],
  session: {} as AuthContext["session"], role: level >= 7 ? "gm" : level >= 4 ? "key_holder" : "employee", level, locations: [LOC],
});
// 2026-10-09 15:30 ET = 19:30Z
const NOW = new Date("2026-10-09T19:30:00Z");
const ctx = (level: number, id = "me"): PulseCtx => ({ auth: auth(level, id), locationId: LOC, date: "2026-10-09", now: NOW });

function board(): ShiftBoard {
  return {
    locationId: LOC, date: "2026-10-09", viewerId: "me", viewerLevel: 3, whosHere: true,
    stations: [
      { id: "s1", name: "Line", nameEs: "Línea", sort: 1, active: true, staffed: true, closedAt: null, usuallyClosesAt: null, positions: [
        { id: "s1p1", stationId: "s1", name: "First", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true },
      ] },
      { id: "s2", name: "Expo", nameEs: null, sort: 2, active: true, staffed: true, closedAt: null, usuallyClosesAt: "16:00:00", positions: [
        { id: "s2p1", stationId: "s2", name: "First", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true },
      ] },
    ],
    people: [
      { id: "me", name: "Val Viewer", level: 3, hasWork: true, presence: { onShift: true, source: "toast_clock", since: "2026-10-09T14:00:00Z" } },
      { id: "other", name: "Ana Perez", level: 3, hasWork: true, presence: { onShift: true, source: "coops_activity", since: "2026-10-09T14:05:00Z", activity: "station" } },
    ],
    events: [
      { id: "e1", sequence: "1", locationId: LOC, businessDate: "2026-10-09", userId: "me", stationId: "s2", positionId: "s2p1", kind: "assign", actorId: "mgr", actorName: "Mgr", at: "2026-10-09T14:10:00Z", source: "assigned" },
    ],
    tasks: [
      { id: "t1", task: "am_prep", assigneeId: "me", assignerId: "mgr", assignerName: "Mgr", note: null, assigneeName: "Val Viewer", available: true },
      { id: "t2", task: "cash_report", assigneeId: "other", assignerId: "mgr", assignerName: "Mgr", note: null, assigneeName: "Ana Perez", available: true },
    ],
  };
}

function deps(over: Partial<PulseDeps> = {}): PulseDeps {
  return {
    board: vi.fn(async () => board()),
    reports: vi.fn(async () => ({
      rows: [
        { key: "opening" as const, progress: "done" as const, doneAt: null, doneByName: null },
        { key: "am_prep" as const, progress: "not_started" as const, doneAt: null, doneByName: null },
        { key: "mid_day" as const, progress: "not_started" as const, doneAt: null, doneByName: null, count: 0 },
        { key: "cash" as const, progress: "not_started" as const, doneAt: null, doneByName: null },
        { key: "closing" as const, progress: "done" as const, doneAt: null, doneByName: null },
      ],
      closingDone: true, midDayDoneCount: 0,
    })),
    fridges: vi.fn(async () => [
      { id: "f1", name: "Walk-in A", latestF: 44, status: "out_of_range" as const, readings: [40, 44] },
      { id: "f2", name: "Reach-in", latestF: null, status: "no_reading_today" as const, readings: [] },
    ]),
    cateringToday: vi.fn(async () => [{ id: "c1", timeWindow: "4:00 PM", name: "Acme lunch", headcount: 20, isDelivery: true, stage: "confirmed" as const, source: "ezcater" }]),
    cateringTomorrow: vi.fn(async () => ({ count: 1, firstWindow: "11:00 AM" })),
    notRung: vi.fn(async () => [{ order_id: "o1", lead_id: null, location_id: LOC, event_date: "2026-10-09", order_number: "EZ-1", handoff_time: "2026-10-09T17:00:00Z", event_timestamp: null, headcount: 12, total_cents: 12000 }]),
    unlinkedClockIns: vi.fn(async () => ({ count: 1, entries: [{ employeeGuid: "pat", firstName: "Pat", since: "2026-10-09T14:00:00Z" }] })),
    lastParPass: vi.fn(async () => ({ at: "2026-10-09T13:00:00Z", byName: "Mgr", lines: [
      { skuName: "Ham", parQty: 4, orderQty: 4, unitLabel: "case" }, { skuName: "Rolls", parQty: 10, orderQty: 2, unitLabel: "bag" }, { skuName: "Napkins", parQty: 5, orderQty: 0, unitLabel: "case" },
    ] })),
    deliveries: vi.fn(async () => []),
    cutoffs: vi.fn(async () => ({ count: 0, vendors: [] })),
    sales: vi.fn(async () => { throw new Error("sales should not be read in this test"); }),
    handoff: vi.fn(async () => ({ notes: [], acks: [], names: {} })),
    layout: vi.fn(async () => null),
    ...over,
  };
}

describe("scope before any read", () => {
  it("crew asking for sales/people/catering/inventory are refused without touching a dep", async () => {
    const d = deps();
    for (const section of ["sales", "people", "inventory"] as const) {
      expect(await loadPulseSection(d, ctx(3), section)).toMatchObject({ state: "error", code: "forbidden" });
    }
    for (const fn of Object.values(d)) expect(fn).not.toHaveBeenCalled();
  });
  it("KH asking for sales is refused; GM is served", async () => {
    const d = deps({ sales: vi.fn(async () => { throw new SalesReportError(503, "sales_reads_not_installed"); }) });
    expect(await loadPulseSection(d, ctx(5), "sales")).toMatchObject({ state: "error", code: "forbidden" });
    expect(d.sales).not.toHaveBeenCalled();
    expect(await loadPulseSection(d, ctx(7), "sales")).toMatchObject({ state: "not_installed" });
    expect(d.sales).toHaveBeenCalledTimes(1);
  });
});

describe("isolation + deadline + not installed", () => {
  it("one failing section renders its own error; the others are ok", async () => {
    const d = deps({ fridges: vi.fn(async () => { throw new Error("boom"); }) });
    const out = await loadPulseSections(d, ctx(5), ["floor", "food_safety", "stations", "handoff"]);
    expect(out.food_safety).toMatchObject({ state: "error", code: "failed" });
    expect(out.floor?.state).toBe("ok");
    expect(out.stations?.state).toBe("ok");
    expect(out.handoff?.state).toBe("ok");
  });
  it("shared sources are read ONCE per request (board for floor + stations + people + attention)", async () => {
    const d = deps();
    await loadPulseSections(d, ctx(5), ["attention", "floor", "people", "stations"]);
    expect(d.board).toHaveBeenCalledTimes(1);
    expect(d.reports).toHaveBeenCalledTimes(1);
  });
  it("a slow source times out with its own code", async () => {
    await expect(withDeadline(new Promise(() => {}), 5)).rejects.toThrow("timeout");
    const d = deps({ handoff: vi.fn(() => new Promise<HandoffRaw>(() => {})) });
    vi.useFakeTimers();
    const p = loadPulseSection(d, ctx(5), "handoff");
    await vi.advanceTimersByTimeAsync(7_100);
    vi.useRealTimers();
    expect(await p).toMatchObject({ state: "error", code: "timeout" });
  });
  it("an unapplied 0240 is an explicit not_installed, never an empty list", async () => {
    const d = deps({ handoff: vi.fn(async () => { throw new PulseNotInstalledError("pulse_handoff_notes"); }) });
    expect(await loadPulseSection(d, ctx(3), "handoff")).toMatchObject({ state: "not_installed" });
  });
  it("memoDeps keys on location + date + viewer", async () => {
    const d = memoDeps(deps());
    await Promise.all([d.board(ctx(5)), d.board(ctx(5)), d.board(ctx(5, "you"))]);
    expect((deps as unknown as { mock?: unknown }).mock).toBeUndefined();
  });
});

describe("crew stripping", () => {
  it("floor: crew see statuses and only their own first name", async () => {
    const r = await loadPulseSection(deps(), ctx(3), "floor");
    expect(r.state).toBe("ok");
    const data = (r as { data: FloorData }).data;
    expect(data.showNames).toBe(false);
    expect(data.canArrange).toBe(false);
    expect(data.viewerStationId).toBe("s2");
    expect(data.stations.find((s) => s.id === "s2")!.people).toEqual(["Val"]);
    expect(JSON.stringify(data)).not.toContain("Ana");
    expect(data.layout).toBeTruthy();
  });
  it("stations: crew get counts + their own station/tasks, no other names; KH get every task with names", async () => {
    const crew = (await loadPulseSection(deps(), ctx(3), "stations")) as { data: StationsData };
    expect(crew.data.mine).toEqual({ stationName: "Expo", positionName: "First", tasks: [{ task: "am_prep", href: `/operations/am-prep?location=${LOC}`, done: false }] });
    expect(crew.data.tasks).toEqual([]);
    expect(crew.data.counts.uncovered).toBe(1);
    expect(JSON.stringify(crew.data)).not.toContain("Ana");
    const kh = (await loadPulseSection(deps(), ctx(5), "stations")) as { data: StationsData };
    expect(kh.data.mine).toBeNull();
    expect(kh.data.tasks.map((t) => t.assigneeName)).toEqual(["Val Viewer", "Ana Perez"]);
    expect(kh.data.tasksLeft).toBe(2);
  });
  it("food safety: crew get counts + the reminder, no fridge rows", async () => {
    const crew = (await loadPulseSection(deps(), ctx(3), "food_safety")) as { data: FoodSafetyData };
    expect(crew.data.counts).toEqual({ ok: 0, outOfRange: 1, unchecked: 1, total: 2 });
    expect(crew.data.fridges).toEqual([]);
    expect(crew.data.reminder).toBe(true);
    const kh = (await loadPulseSection(deps(), ctx(4), "food_safety")) as { data: FoodSafetyData };
    expect(kh.data.fridges).toHaveLength(2);
    expect(kh.data.fridges[1]!.latestF).toBeNull(); // unread today never prints a stale number
  });
  it("catering: money only at 7+", async () => {
    const kh = (await loadPulseSection(deps(), ctx(5), "catering")) as { data: CateringData };
    expect(kh.data.redacted).toBe(false);
    expect(kh.data.today[0]!.name).toBe("Acme lunch");
    expect(kh.data.notRung[0]).not.toHaveProperty("totalCents");
    expect(kh.data.prep).toEqual({ amPrep: "not_started", midDay: "not_started" });
    const gm = (await loadPulseSection(deps(), ctx(7), "catering")) as { data: CateringData };
    expect(gm.data.notRung[0]!.totalCents).toBe(12000);
  });
});

describe("needs attention", () => {
  it("KH: ranked list from every source, with one-tap hrefs; failed sources are named in `partial`", async () => {
    const d = deps({ unlinkedClockIns: vi.fn(async () => { throw new Error("toast down"); }) });
    const r = (await loadPulseSection(d, ctx(5), "attention")) as { data: AttentionData };
    const kinds = r.data.items.map((i) => i.kind);
    // D-27: red facts first, stations after, yellow advisories last.
    expect(kinds).toEqual(["checklist_missed", "checklist_missed", "task_late", "task_late", "fridge_out_of_range", "catering_not_rung", "station_uncovered", "station_closing_soon", "fridge_unchecked", "item_low", "catering_unprepped"]);
    expect(r.data.items.find((i) => i.kind === "station_uncovered")!.href).toBe(`/assignments?loc=${LOC}`);
    expect(r.data.score).toBe("red");
    expect(r.data.partial).toEqual(["unlinked"]);
    // Closing is done, so am_prep + cash are overdue: both assigned tasks are late, each naming its holder.
    expect(r.data.items.filter((i) => i.kind === "task_late").map((i) => i.key)).toEqual(["task_late:am_prep:me", "task_late:cash_report:other"]);
    expect(r.data.items.filter((i) => i.kind === "task_late").map((i) => i.params.name)).toEqual(["Val Viewer", "Ana Perez"]);
  });
  it("D-63: a passed cutoff with no placed order is a RED 'missed cutoff' row, ranked with the red facts", async () => {
    const d = deps({ cutoffs: vi.fn(async () => ({ count: 2, vendors: [
      { vendorId: "pfg", vendorName: "PFG", cutoffTime: "11:00 AM", hasDraft: true, missed: true },
      { vendorId: "ferraro", vendorName: "Ferraro", cutoffTime: "5:00 PM", hasDraft: false, missed: false },
    ] })) });
    const r = (await loadPulseSection(d, ctx(5), "attention")) as { data: AttentionData };
    const missed = r.data.items.filter((i) => i.kind === "cutoff_missed");
    expect(missed).toEqual([{ key: "cutoff_missed:pfg", kind: "cutoff_missed", severity: "red", params: { vendor: "PFG", time: "11:00 AM" }, href: `/ordering?location=${LOC}`, action: "order" }]);
    const kinds = r.data.items.map((i) => i.kind);
    expect(kinds.indexOf("cutoff_missed")).toBeLessThan(kinds.indexOf("station_uncovered"));
    // The still-open cutoff stays an Inventory fact, not an attention row.
    expect(JSON.stringify(r.data.items)).not.toContain("Ferraro");
    const inv = (await loadPulseSection(d, ctx(5), "inventory")) as { data: InventoryData };
    expect(inv.data.cutoffs).toEqual([
      { vendorName: "PFG", time: "11:00 AM", hasDraft: true, missed: true },
      { vendorName: "Ferraro", time: "5:00 PM", hasDraft: false, missed: false },
    ]);
  });
  it("D-63: a failed cutoffs read is named in partial, never a silent all-clear", async () => {
    const d = deps({ cutoffs: vi.fn(async () => { throw new Error("down"); }) });
    const r = (await loadPulseSection(d, ctx(5), "attention")) as { data: AttentionData };
    expect(r.data.partial).toContain("cutoffs");
  });
  it("crew: only their own rows + shop-wide reminders; no catering/inventory/clock-in sources are even read", async () => {
    const d = deps();
    const r = (await loadPulseSection(d, ctx(3), "attention")) as { data: AttentionData };
    // Their own station (Expo) closes at 16:00 and it is 15:30: that row is THEIRS; the uncovered Line is not.
    expect(r.data.items.map((i) => i.kind)).toEqual(["task_late", "fridge_out_of_range", "station_closing_soon", "fridge_unchecked", "catering_unprepped"]);
    expect(r.data.items[0]!.params).not.toHaveProperty("name");
    expect(JSON.stringify(r.data)).not.toContain("Ana");
    expect(d.notRung).not.toHaveBeenCalled();
    expect(d.lastParPass).not.toHaveBeenCalled();
    expect(d.unlinkedClockIns).not.toHaveBeenCalled();
    expect(d.cutoffs).not.toHaveBeenCalled(); // D-63: ordering is KH+ — crew never read cutoffs
    // Astra #11: shop catering timing reaches crew, with no event name.
    expect(r.data.items[4]!.params).toEqual({ time: "4:00 PM" });
    expect(JSON.stringify(r.data)).not.toContain("Acme");
    expect(d.cateringToday).toHaveBeenCalledTimes(1);
  });
});

describe("Astra #4 — authorization metadata never leaves the server", () => {
  it("no attention row carries subjectUserIds or shopWide, for crew or KH", async () => {
    for (const level of [3, 5]) {
      const r = (await loadPulseSection(deps(), ctx(level), "attention")) as { data: AttentionData };
      expect(r.data.items.length).toBeGreaterThan(0);
      for (const row of r.data.items) {
        expect(row).not.toHaveProperty("subjectUserIds");
        expect(row).not.toHaveProperty("shopWide");
      }
    }
    const crew = (await loadPulseSection(deps(), ctx(3), "attention")) as { data: AttentionData };
    expect(JSON.stringify(crew.data)).not.toContain("other"); // the coworker's id never rides along
  });
});

describe("Astra #7 — failed sources never produce a reassuring state", () => {
  const failing = () => vi.fn(async () => { throw new Error("down"); });
  const quietDeps = (over: Partial<PulseDeps> = {}) => deps({
    board: vi.fn(async () => ({ ...board(), stations: [], events: [], tasks: [] })),
    reports: vi.fn(async () => ({ rows: [], closingDone: false, midDayDoneCount: 0 })),
    fridges: vi.fn(async () => []), cateringToday: vi.fn(async () => []), notRung: vi.fn(async () => []),
    lastParPass: vi.fn(async () => null), unlinkedClockIns: vi.fn(async () => ({ count: 0, entries: [] })),
    ...over,
  });
  it("every attention source failing → evidence unavailable, score null, no items", async () => {
    const d = deps({ board: failing(), reports: failing(), fridges: failing(), cateringToday: failing(), notRung: failing(), lastParPass: failing(), unlinkedClockIns: failing(), cutoffs: failing() });
    const r = (await loadPulseSection(d, ctx(5), "attention")) as { data: AttentionData };
    expect(r.data).toMatchObject({ items: [], score: null, evidence: "unavailable" });
    expect([...r.data.partial].sort()).toEqual(["board", "cateringToday", "cutoffs", "fridges", "notRung", "parPass", "reports", "unlinked"]);
  });
  it("a quiet shop with one source down → partial, score null (no all-clear); rows present → partial but scored; all up → green", async () => {
    const partial = (await loadPulseSection(quietDeps({ unlinkedClockIns: failing() }), ctx(5), "attention")) as { data: AttentionData };
    expect(partial.data).toMatchObject({ items: [], score: null, evidence: "partial", partial: ["unlinked"] });
    const loud = (await loadPulseSection(deps({ unlinkedClockIns: failing() }), ctx(5), "attention")) as { data: AttentionData };
    expect(loud.data.evidence).toBe("partial");
    expect(loud.data.score).toBe("red");
    const complete = (await loadPulseSection(quietDeps(), ctx(5), "attention")) as { data: AttentionData };
    expect(complete.data).toMatchObject({ items: [], score: "green", evidence: "complete", partial: [] });
  });
  it("inventory: failed receiving/cutoff reads are null (unavailable), never empty lists", async () => {
    const r = (await loadPulseSection(deps({ deliveries: failing(), cutoffs: failing() }), ctx(5), "inventory")) as { data: InventoryData };
    expect(r.data.receiving).toBeNull();
    expect(r.data.cutoffs).toBeNull();
    const ok = (await loadPulseSection(deps(), ctx(5), "inventory")) as { data: InventoryData };
    expect(ok.data.receiving).toEqual([]);
    expect(ok.data.cutoffs).toEqual([]);
  });
  it("people: a failed clock-in read is null, never 0 unlinked", async () => {
    const r = (await loadPulseSection(deps({ unlinkedClockIns: failing() }), ctx(5), "people")) as { data: PeopleData };
    expect(r.data.unlinked).toBeNull();
  });
});

describe("Astra #11 — crew catering timing, server-redacted", () => {
  it("crew get when / how many / stage; no names, sources, order numbers or money; not-rung orders are not even read", async () => {
    const d = deps();
    const r = (await loadPulseSection(d, ctx(3), "catering")) as { data: CateringData };
    expect(r.data.redacted).toBe(true);
    expect(r.data.today).toEqual([{ id: "c1", name: null, timeWindow: "4:00 PM", headcount: 20, isDelivery: true, stage: "confirmed", source: null }]);
    expect(r.data.notRung).toEqual([]);
    expect(r.data.tomorrow).toEqual({ count: 1, firstWindow: "11:00 AM" });
    expect(JSON.stringify(r.data)).not.toMatch(/Acme|EZ-1|12000|ezcater/);
    expect(d.notRung).not.toHaveBeenCalled();
  });
});

describe("handoff projection per viewer over the shop-shared raw set", () => {
  const raw: HandoffRaw = {
    notes: [
      { id: "n1", author_id: "mgr", audience: "managers", body: "Walk-in compressor is loud", created_at: "2026-10-09T18:00:00Z" },
      { id: "n2", author_id: "mgr", audience: "crew", body: "Use the back fryer only", created_at: "2026-10-09T18:05:00Z" },
    ],
    acks: [{ note_id: "n2", user_id: "me", acked_at: "2026-10-09T18:10:00Z" }],
    names: { mgr: "Morgan GM", me: "Val Viewer" },
  };
  it("crew get crew/all notes with no author or ack names; KH+ get every audience with names; ackedByMe is per viewer", async () => {
    const d = deps({ handoff: vi.fn(async () => raw) });
    const crew = (await loadPulseSection(d, ctx(3), "handoff")) as { data: HandoffData };
    expect(crew.data.notes.map((n) => n.id)).toEqual(["n2"]);
    expect(crew.data.notes[0]).toMatchObject({ authorName: null, acks: [], ackedByMe: true });
    expect(JSON.stringify(crew.data)).not.toContain("Morgan");
    const kh = (await loadPulseSection(d, ctx(5, "you"), "handoff")) as { data: HandoffData };
    expect(kh.data.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(kh.data.notes[1]).toMatchObject({ authorName: "Morgan GM", acks: [{ name: "Val Viewer", at: "2026-10-09T18:10:00Z" }], ackedByMe: false });
  });
});

describe("parPassLow", () => {
  it("order-up-to-par estimate: pct of par, 86 risk at ≤15%, zero-order lines excluded, lowest first", () => {
    const low = parPassLow({ at: "x", byName: null, lines: [
      { skuName: "Ham", parQty: 4, orderQty: 4, unitLabel: "case" }, { skuName: "Rolls", parQty: 10, orderQty: 2, unitLabel: "bag" },
      { skuName: "Napkins", parQty: 5, orderQty: 0, unitLabel: "case" }, { skuName: "Mystery", parQty: null, orderQty: 1, unitLabel: null },
    ] });
    expect(low.map((l) => l.skuName)).toEqual(["Ham", "Rolls", "Mystery"]);
    expect(low[0]).toMatchObject({ pctOfPar: 0, risk86: true });
    expect(low[1]).toMatchObject({ pctOfPar: 0.8, risk86: false });
    expect(low[2]).toMatchObject({ pctOfPar: null, risk86: false });
  });
});


describe("Here now includes unlinked Toast employees", () => {
  // eslint-disable-next-line react/no-children-prop -- TranslationProvider requires children in its props type.
  const render = (data: PeopleData, mode: "card" | "detail" = "card", language: "en" | "es" = "en") => renderToStaticMarkup(createElement(TranslationProvider, {
    initialLanguage: language, children: createElement(PeopleSection, { data, mode, locationId: LOC }),
  }));
  it("counts everyone, sorts linked and unlinked together, and preserves station coverage in both views", async () => {
    const entries = ["Santos", "Veronica", "Akia", "Olivia"].map((firstName) => ({ employeeGuid: firstName, firstName, since: "2026-10-09T14:00:00Z" }));
    const d = deps({ unlinkedClockIns: async () => ({ count: entries.length, entries }) });
    const { data } = await loadPulseSection(d, ctx(7), "people") as { data: PeopleData };
    const baseline = await loadPulseSection(deps({ unlinkedClockIns: async () => ({ count: 0, entries: [] }) }), ctx(7), "people") as { data: PeopleData };
    expect(data.here.length + data.hereUnlinked.length).toBe(6);
    expect(data.hereUnlinked[0]).toEqual({ key: "Santos", name: "Santos", since: entries[0]!.since });
    expect([data.stationsCovered, data.stationsOpen]).toEqual([baseline.data.stationsCovered, baseline.data.stationsOpen]);
    expect(data.canLink).toBe(true);
    for (const mode of ["card", "detail"] as const) {
      const html = render(data, mode);
      expect(html).toContain("Here now (6)");
      expect(html).toContain("Not linked yet");
      expect(html).toContain("Clocked in");
      expect(html).toContain(`/admin/toast-employees?loc=${LOC}`);
      expect(html).toContain(">Link</a>");
      const names = ["Akia", "Ana Perez", "Olivia", "Santos", "Val Viewer", "Veronica"];
      expect(names.map((name) => html.indexOf(`>${name}</span>`))).toEqual(names.map((name) => html.indexOf(`>${name}</span>`)).sort((a, b) => a - b));
    }
    expect(render(data, "card", "es")).toContain("Sin vincular todavía");
    expect(render(data, "card", "es")).toContain(">Vincular</a>");
  });
  it("shows unnamed Toast employees without station claims and hides Link below level 7", async () => {
    for (const level of [4, 5, 6]) {
      const { data } = await loadPulseSection(deps({ unlinkedClockIns: async () => ({ count: 1, entries: [{ employeeGuid: "unknown", firstName: null, since: "2026-10-09T14:00:00Z" }] }) }), ctx(level), "people") as { data: PeopleData };
      expect(data.canLink).toBe(false);
      const html = render(data);
      expect(html).toContain("Toast employee");
      expect(html).toContain("Here now (3)");
      expect(html).not.toContain("/admin/toast-employees");
      const row = html.split("<li ").find((part) => part.includes("Toast employee"))!.split("</li>")[0];
      expect(row).not.toContain("No station");
    }
  });
  it("renders unavailable on read failure, retaining linked people", async () => {
    const { data } = await loadPulseSection(deps({ unlinkedClockIns: async () => { throw new Error("read failed"); } }), ctx(7), "people") as { data: PeopleData };
    expect(data.unlinked).toBeNull();
    expect(data.hereUnlinked).toEqual([]);
    expect(render(data)).toContain("Toast clock-ins could not be checked right now.");
    expect(render(data)).toContain("Here now (2)");
  });
  it("uses the selected shop in the attention link", async () => {
    const { data } = await loadPulseSection(deps(), ctx(7), "attention") as { data: AttentionData };
    expect(data.items.find((r) => r.kind === "clockin_unlinked")?.href).toBe(`/admin/toast-employees?loc=${LOC}`);
  });
  it("deduplicates the bounded, scoped read by GUID, keeping the earliest entry and null names", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({ data: [
        { employee_guid: "a", employee_first_name: "Pat Smith", in_at: "2026-10-09T03:00:00Z" },
        { employee_guid: "b", employee_first_name: null, in_at: "2026-10-09T14:00:00Z" },
        { employee_guid: "a", employee_first_name: "Pat", in_at: "2026-10-09T15:00:00Z" },
        { employee_guid: "c", employee_first_name: "Pat", in_at: "2026-10-09T16:00:00Z" },
      ], error: null }),
    };
    const service = { from: vi.fn(() => query) };
    const read = defaultPulseDeps(service as unknown as SupabaseClient).unlinkedClockIns;
    expect(await read(ctx(7))).toEqual({ count: 3, entries: [
      { employeeGuid: "a", firstName: "Pat", since: "2026-10-09T03:00:00Z" },
      { employeeGuid: "b", firstName: null, since: "2026-10-09T14:00:00Z" },
      { employeeGuid: "c", firstName: "Pat", since: "2026-10-09T16:00:00Z" },
    ] });
    expect(service.from).toHaveBeenCalledWith("toast_time_entries");
    expect(query.select).toHaveBeenCalledWith("employee_guid,employee_first_name,in_at");
    expect(query.eq.mock.calls).toEqual([["location_id", LOC], ["deleted", false]]);
    expect(query.in).toHaveBeenCalledWith("business_date", ["2026-10-08", "2026-10-09"]);
    expect(query.is.mock.calls).toEqual([["user_id", null], ["out_at", null]]);
    expect(query.order).toHaveBeenCalledWith("in_at", { ascending: true });
    expect(query.limit).toHaveBeenCalledWith(50);
    query.returns.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await expect(read(ctx(7))).rejects.toThrow("offline");
  });
});
