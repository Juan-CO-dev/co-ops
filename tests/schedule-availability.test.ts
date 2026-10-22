import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { isPersonAvailability, type PersonAvailability } from "@/lib/scheduling/availability-shared";
import { firstSeenFor } from "@/lib/scheduling/inputs-shared";
import { assumedAvailability, punchPatterns, toSchedPeople, type PersonSettingsRow, type PunchEntry } from "@/lib/scheduling/people-input-shared";
import { addDays } from "@/lib/scheduling/time-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { fillRun, rankCandidates, RELAX_TIERS, type BuildCtx, type WeekState } from "@/lib/scheduling/generator/assign-shared";
import { DATES, I, SMALL_SPECS, day, fixture, repairShop, structure } from "./fixtures/schedule/fixtures";
import { A, GM, STAFF, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
const { recordPersonSettings } = await import("@/lib/scheduling/settings");
const { requireSession } = await import("@/lib/session");
const { getServiceRoleClient } = await import("@/lib/supabase-server");
const route = await import("@/app/api/schedule/route");

const SHOP_DAY = { fromQ: 28, toQ: 84 };
const USER = STAFF[1]!;
const actor = { userId: GM, role: "gm" as const, level: 7, locations: [A] };
const row = (availability?: PersonAvailability | null): PersonSettingsRow => ({
  userId: USER, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [],
  softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, availability,
});
const availability = (): PersonAvailability => ({
  1: { mode: "off" }, 2: { mode: "works" }, 3: { mode: "works", fromQ: 64, toQ: 84 },
  4: { mode: "if_needed", fromQ: 64, toQ: 80 }, 5: { mode: "if_needed" }, 6: { mode: "works" }, 7: { mode: "works" },
});
function roster(value?: PersonAvailability | null) {
  return toSchedPeople({ members: [{ userId: USER, role: "employee", active: true }], settings: [row(value)],
    patterns: {}, dates: DATES, structure: structure(), shopDay: SHOP_DAY, skills: null,
    wages: { byUserCents: {}, estimateHourlyCents: 1900 } }).people[0]!;
}

describe("Days they work: history and generator inputs", () => {
  it("an April worker added to the app October 21 retains eight weeks of weekend history", () => {
    const punch = (userId: string, date: string): PunchEntry => ({ userId, businessDate: date,
      inAt: `${date}T14:00:00Z`, outAt: `${date}T20:00:00Z`, hours: 6, deleted: false });
    const history: PunchEntry[] = [punch(USER, "2026-04-04")];
    for (let w = 0; w < 8; w++) {
      const mon = addDays("2026-08-24", 7 * w);
      for (let d = 0; d < 7; d++) history.push(punch("shop", addDays(mon, d)));
      history.push(punch(USER, addDays(mon, 5)), punch(USER, addDays(mon, 6)));
    }
    // The loader only reads the eight-week window, even though the employee started in April.
    const window = history.filter((p) => p.businessDate >= "2026-08-24");
    const firstSeen = firstSeenFor([{ userId: USER, name: "Worker", role: "employee", memberSince: "2026-10-21" }], window, "2026-08-24");
    expect(firstSeen[USER]).toBeUndefined();
    const pattern = punchPatterns(window, { asOf: "2026-10-21", firstSeen })[USER]!;
    expect(pattern.byDow[6]).toMatchObject({ weeksObserved: 8, weeksWorked: 8 });
    expect(assumedAvailability(pattern.byDow[6], SHOP_DAY)?.source).toBe("toast_pattern");
    expect(assumedAvailability(pattern.byDow[3], SHOP_DAY)).toBeNull();
  });

  it("explicit modes replace the Toast fallback, retain time limits and prefer if-needed dates off", () => {
    const p = roster(availability());
    expect(p.availability[DATES[0]!]).toBeNull();
    expect(p.availability[DATES[1]!]).toEqual({ ...SHOP_DAY, source: "manager_set" });
    expect(p.availability[DATES[2]!]).toEqual({ fromQ: 64, toQ: 84, source: "manager_set" });
    expect(p.availability[DATES[3]!]).toEqual({ fromQ: 64, toQ: 80, source: "manager_set" });
    expect(p.availability[DATES[4]!]).toEqual({ ...SHOP_DAY, source: "manager_set" });
    expect(p.offPreferredDates).toEqual([DATES[3], DATES[4]]);
    expect(p.observedDowShare).toMatchObject({ 1: 0, 2: 1, 3: 1, 6: 1, 7: 1 });
    expect(p.observedDowShare![4]).toBeGreaterThan(0);
    expect(p.observedDowShare![4]).toBeLessThan(1);
  });

  it("null and omitted settings keep Toast's insufficient-history behavior", () => {
    expect(roster(null)).toEqual(roster(undefined));
    expect(roster(null).availability[DATES[0]!]).toEqual({ ...SHOP_DAY, source: "insufficient_history" });
  });

  it("first tier selects another worker; if-needed becomes usable only in a later tier", () => {
    const mon = DATES[0]!;
    const input = fixture({ specs: SMALL_SPECS, days: [day(mon)] });
    const ctx = buildWeek(input).context;
    const people = Object.fromEntries(input.people.filter((p) => ["u-b-bo", "u-c-cy"].includes(p.userId)).map((p) => [p.userId, p]));
    const b: BuildCtx = { ctx, structure: input.structure, people, lookup: input.skills,
      budgetedDates: [], budgetHours: 0, busiest: {}, notes: [], pinCover: {}, offPreferred: { "u-b-bo": new Set([mon]) } };
    const fresh = (): WeekState => ({ built: { [mon]: [] }, inherited: [] });
    const fill = (week: WeekState, tiers = RELAX_TIERS) => fillRun(b, week, mon, I.$REG, 44, 60,
      { source: "shape", essential: false, closingLead: false }, [I.$REG], { allowCover: false, budgetStop: false, tiers });
    const first = fresh();
    expect(fill(first, RELAX_TIERS.slice(0, 1))).toBe("placed");
    expect(first.built[mon]!.map((s) => s.userId)).toEqual(["u-c-cy"]);
    delete b.people["u-c-cy"];
    const onlyIfNeeded = fresh();
    expect(fill(onlyIfNeeded, RELAX_TIERS.slice(0, 1))).toBe("none");
    expect(onlyIfNeeded.built[mon]).toEqual([]);
    expect(fill(onlyIfNeeded)).toBe("placed");
    expect(onlyIfNeeded.built[mon]!.map((s) => s.userId)).toEqual(["u-b-bo"]);
  });

  it.each(["gm", "agm"] as const)("treats salaried %s if-needed dates as Works defensively", (role) => {
    const mon = DATES[0]!;
    const input = fixture({ specs: [{ id: "manager", role }], days: [day(mon)] });
    const works = buildWeek(input);
    expect(works.shifts.some((s) => s.userId === "manager")).toBe(true);
    input.people[0]!.offPreferredDates = [mon];
    expect(buildWeek(input).shifts).toEqual(works.shifts);
  });

  it("prefers a manager backup day over an algorithm off day after tier gates, keeping position rank first", () => {
    const mon = DATES[0]!;
    const input = fixture({ specs: [
      { id: "algorithm", role: "employee", softMin: 32 },
      { id: "backup", role: "employee", softMin: 0 },
    ], days: [day(mon)] });
    const ctx = buildWeek(input).context;
    input.people[1]!.offPreferredDates = [mon];
    const b: BuildCtx = { ctx, structure: input.structure, people: Object.fromEntries(input.people.map((p) => [p.userId, p])),
      lookup: input.skills, budgetedDates: [], budgetHours: 0, busiest: {}, notes: [], pinCover: {},
      offPreferred: { algorithm: new Set([mon]), backup: new Set([mon]) } };
    const week: WeekState = { built: { [mon]: [] }, inherited: [] };
    const opts = { date: mon, plan: { startQ: 44, endQ: 60, segments: [{ positionId: I.$REG, startQ: 44, endQ: 60, kind: "core" as const }] },
      positionId: I.$REG, closingLead: false, allowOvertime: false, mod: false };
    expect(rankCandidates(b, week, [], { ...opts, allowOffDay: false })).toEqual([]);
    expect(rankCandidates(b, week, [], { ...opts, allowOffDay: true }).map((c) => c.person.userId)).toEqual(["backup", "algorithm"]);
    input.people[1]!.offPreferredDates = [];
    expect(rankCandidates(b, week, [], { ...opts, allowOffDay: true })[0]!.person.userId).toBe("algorithm");
    input.people[1]!.offPreferredDates = [mon];
    input.people[0]!.coverPositions = [I.$REG];
    expect(rankCandidates(b, week, [], { ...opts, allowOffDay: true })[0]!.person.userId).toBe("algorithm");
  });

  it("buildWeek honors manager modes even on a one-day build, with no automatic off-day quota", () => {
    const mon = DATES[0]!;
    const s = repairShop((s) => {
      s.positions = { [I.$REG]: { ...s.positions[I.$REG]!, openQ: 44, trimQ: 60, closeQ: 60 } };
      s.priority = [];
      for (const type of ["slow", "normal", "busy", "weekend"] as const) {
        s.crews[type].waves = { setup: { heads: 1, atQ: 44 }, service: { heads: 0 }, rush: { heads: 0, atQ: 44 } };
        s.crews[type].lineMinHeads = { [I.$REG]: 1 };
      }
    });
    const fallback = "u-a-fallback", regular = "u-z-regular", off = "u-off";
    const specs = [fallback, regular, off].map((id) => ({ id, role: "employee" as const, softMin: 0, softMax: 40 }));
    const input = fixture({ structure: s, specs, days: [day(mon, { demandKind: "no_history", hourlyCents: null, dayCents: null }, s)] });
    const settings = specs.map(({ id }): PersonSettingsRow => ({ ...row(), userId: id, softMinH: 0, softMaxH: 40,
      availability: { ...availability(), 1: { mode: id === off ? "off" : id === fallback ? "if_needed" : "works", fromQ: 44, toQ: 60 } } }));
    input.people = toSchedPeople({ members: specs.map(({ id, role }) => ({ userId: id, role, active: true })), settings,
      patterns: {}, dates: DATES, structure: s, shopDay: SHOP_DAY, skills: input.skills,
      wages: { byUserCents: {}, estimateHourlyCents: 1900 } }).people;
    const preferred = buildWeek(input);
    expect(preferred.shifts.length).toBeGreaterThan(0);
    expect(new Set(preferred.shifts.map((x) => x.userId))).toEqual(new Set([regular]));
    const backup = buildWeek({ ...input, people: input.people.filter((p) => p.userId !== regular) });
    expect(backup.shifts.length).toBeGreaterThan(0);
    expect(new Set(backup.shifts.map((x) => x.userId))).toEqual(new Set([fallback]));
    for (const out of [preferred, backup]) for (const shift of out.shifts) {
      expect(shift.startQ).toBeGreaterThanOrEqual(44);
      expect(shift.endQ).toBeLessThanOrEqual(60);
    }
  });
});

const invalid: Array<[string, unknown]> = [
  ["array", []], ["string", "works"], ["empty", {}],
  ["missing day", { ...availability(), 7: undefined }], ["extra day", { ...availability(), 8: { mode: "works" } }],
  ["unknown mode", { ...availability(), 1: { mode: "sometimes" } }],
  ["extra day key", { ...availability(), 1: { mode: "works", extra: true } }],
  ["missing to", { ...availability(), 1: { mode: "works", fromQ: 64 } }],
  ["missing from", { ...availability(), 1: { mode: "works", toQ: 84 } }],
  ["fractional", { ...availability(), 1: { mode: "works", fromQ: 64.5, toQ: 84 } }],
  ["negative", { ...availability(), 1: { mode: "works", fromQ: -1, toQ: 84 } }],
  ["too late", { ...availability(), 1: { mode: "works", fromQ: 64, toQ: 97 } }],
  ["empty window", { ...availability(), 1: { mode: "works", fromQ: 64, toQ: 64 } }],
  ["reversed", { ...availability(), 1: { mode: "works", fromQ: 84, toQ: 64 } }],
  ["null time", { ...availability(), 1: { mode: "works", fromQ: null, toQ: null } }],
  ["string time", { ...availability(), 1: { mode: "works", fromQ: "64", toQ: 84 } }],
];

describe("Days they work: payload boundary", () => {
  it("accepts null, every mode, and inclusive 0/96 quarter endpoints", () => {
    expect(isPersonAvailability(null)).toBe(true);
    expect(isPersonAvailability(availability())).toBe(true);
    expect(isPersonAvailability({ ...availability(), 1: { mode: "works", fromQ: 0, toQ: 96 } })).toBe(true);
  });

  it.each(invalid)("refuses %s in the guard, writer and HTTP route before any write", async (_name, value) => {
    expect(isPersonAvailability(value)).toBe(false);
    const store = scheduleStore(shopTables());
    const settings = { ...row(), availability: value as PersonAvailability };
    await expect(recordPersonSettings({ service: store.client }, { actor, locationId: A, settings, expectedId: null }))
      .rejects.toMatchObject({ code: "invalid_payload" });
    vi.mocked(requireSession).mockResolvedValue({ user: { id: GM }, role: "gm", level: 7, locations: [A], session: {} } as never);
    vi.mocked(getServiceRoleClient).mockReturnValue(store.client);
    const response = await route.POST(new NextRequest("http://localhost/api/schedule", { method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ action: "person", locationId: A, settings, expectedId: null }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_payload");
    expect(store.calls).toEqual([]);
  });

  it("passes explicit values and reset-to-null through the guarded writer", async () => {
    for (const value of [availability(), null]) {
      const store = scheduleStore(shopTables());
      await recordPersonSettings({ service: store.client }, { actor, locationId: A, settings: row(value), expectedId: null });
      expect(store.calls.find((c) => c.fn === "save_schedule_person_settings")?.args.p_availability).toEqual(value);
    }
  });
});
