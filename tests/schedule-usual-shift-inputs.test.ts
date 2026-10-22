import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { guessUsualShift, resolveUsualShift } from "@/lib/scheduling/usual-shift-shared";
import { toSchedPeople, type PunchEntry } from "@/lib/scheduling/people-input-shared";
import { personBody } from "@/lib/scheduling/settings-view-shared";
import { mergePositionChanges } from "@/lib/scheduling/user-positions-shared";
import type { ShiftType } from "@/lib/scheduling/structure-shared";
import { A, GM, STAFF, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";
import { structure } from "./fixtures/schedule/fixtures";
import { TranslationProvider } from "@/lib/i18n/provider";
import { UsualShiftEditor } from "@/components/schedule/UsualShiftEditor";
import { boardSource } from "./fixtures/schedule/board-source";
import { FIXTURES } from "./fixtures/schedule/fixtures";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { boardView } from "@/lib/scheduling/board-view-shared";
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
const { recordPersonSettings } = await import("@/lib/scheduling/settings");
const { loadLatestPersonSettings } = await import("@/lib/scheduling/inputs");
const { loadScheduleSettings } = await import("@/lib/scheduling/settings-view");
const { requireSession } = await import("@/lib/session");
const { getServiceRoleClient } = await import("@/lib/supabase-server");
const route = await import("@/app/api/schedule/route");
const userId = STAFF[1]!;
const actor = { userId: GM, role: "gm" as const, level: 7, locations: [A] };
const type = (id = "morning", fromQ = 28, toQ = 64): ShiftType => ({ id, name: id, fromQ, toQ, startFlexQ: 2, minLengthQ: 16, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [], countsTowardMod: true });
const punch = (date: string, start = "12:00", end = "20:00"): PunchEntry => ({ userId, businessDate: date, inAt: `${date}T${start}:00Z`, outAt: `${date}T${end}:00Z`, hours: 8, deleted: false });
const history = [punch("2026-09-28"), punch("2026-10-05"), punch("2026-10-12")];
const args = { userId, asOf: "2026-10-22", shiftTypes: [type()] };

describe("usual shift inference and resolution", () => {
  it("requires three completed weeks and ignores open/deleted/invalid/unlinked/current punches", () => {
    expect(guessUsualShift(history.slice(0, 2), args)).toBeNull();
    expect(guessUsualShift([...history, { ...punch("2026-10-13"), outAt: null }, { ...punch("2026-10-14"), deleted: true }, { ...punch("2026-10-15"), inAt: "bad" }, { ...punch("2026-10-16"), userId: null }, punch("2026-10-20", "22:00", "23:00")], args)).toEqual({ value: { typeId: "morning", fromQ: 32, toQ: 64 }, sampleDays: 3, observedWeeks: 3 });
  });
  it("collapses split punches then uses rounded median rather than percentile extrema", () => {
    const result = guessUsualShift([punch("2026-09-28", "10:00", "22:00"), punch("2026-10-05", "12:08", "15:00"), punch("2026-10-05", "16:00", "20:08"), punch("2026-10-12", "14:00", "18:00")], args);
    expect(result?.value).toEqual({ typeId: "morning", fromQ: 33, toQ: 65 });
    expect(result?.sampleDays).toBe(3);
  });
  it("ties use endpoint distance then stable id, independent of ordering; no overlap has no guess", () => {
    expect(guessUsualShift(history, { ...args, shiftTypes: [type("z", 32), type("a", 32), type("b", 28)] })?.value.typeId).toBe("a");
    expect(guessUsualShift(history, { ...args, shiftTypes: [type("night", 80, 96)] })).toBeNull();
  });
  it("uses ET wall time across DST and clamps overnight ends to 96", () => {
    const entries = [punch("2026-10-19", "22:00", "23:00"), punch("2026-10-26", "22:00", "23:00"), punch("2026-11-02", "23:00", "23:30")];
    expect(guessUsualShift(entries, { ...args, asOf: "2026-11-09", shiftTypes: [type("pm", 64, 96)] })?.value.fromQ).toBe(72);
    const overnight = history.map((e) => ({ ...e, inAt: `${e.businessDate}T22:00:00-04:00`, outAt: `${e.businessDate}T23:59:59-04:00` }));
    expect(guessUsualShift(overnight, { ...args, shiftTypes: [type("night", 80, 96)] })?.value.toQ).toBe(96);
  });
  it("manager wins, deleted type falls back with its identity retained", () => {
    const guess = guessUsualShift(history, args);
    expect(resolveUsualShift({ typeId: "morning" }, guess, args.shiftTypes).source).toBe("manager");
    expect(resolveUsualShift({ typeId: "removed" }, guess, args.shiftTypes)).toEqual({ value: guess!.value, source: "toast", deletedTypeId: "removed" });
    expect(resolveUsualShift({ typeId: "removed" }, null, []).value).toBeNull();
  });
  it("carries explicit Off separately from availability and resolved usual shifts", () => {
    const s = structure(); s.shiftTypes = [type()];
    const row = { userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, usualShift: { typeId: "removed" }, availability: { 1: { mode: "off" as const }, 2: { mode: "works" as const }, 3: { mode: "works" as const }, 4: { mode: "if_needed" as const }, 5: { mode: "works" as const }, 6: { mode: "works" as const }, 7: { mode: "works" as const } } };
    const result = toSchedPeople({ members: [{ userId, role: "employee", active: true }], settings: [row], patterns: {}, dates: ["2026-10-19"], structure: s, shopDay: { fromQ: 28, toQ: 84 }, wages: { byUserCents: {}, estimateHourlyCents: null }, skills: null, punches: history, asOf: args.asOf }).people[0]!;
    expect(result.workModes).toEqual({ "2026-10-19": "off" });
    expect(result.availability["2026-10-19"]).toBeNull();
    expect(result.usualShift?.deletedTypeId).toBe("removed");
  });
  it("persists a deleted-type note in the person context and renders it after JSON reload even without a shift", () => {
    const input = FIXTURES["F0c-no-eligible"]!();
    const person = input.people[0]!;
    person.usualShift = { value: null, source: "none", deletedTypeId: "deleted-morning" };
    const output = buildWeek(input);
    const context = JSON.parse(JSON.stringify(output.context)) as typeof output.context;
    expect(context.people[person.userId]?.usualShift?.deletedTypeId).toBe("deleted-morning");
    const source = boardSource({}, "F0c-no-eligible");
    source.week!.people = context.people;
    source.week!.shifts = [];
    const view = boardView(source);
    expect(view.days[0]!.notes).toContainEqual({ key: "schedule.note.usual_shift_deleted", params: { userId: person.userId, typeId: "deleted-morning" } });
  });
});

describe("usual shift save paths", () => {
  function shop(value: unknown = { typeId: "morning", fromQ: 30, toQ: 64 }) {
    const tables = shopTables(), s = structure(); s.shiftTypes = [type()];
    tables.schedule_structures!.push({ id: "structure", location_id: A, structure: s, created_at: "2026-10-01" });
    tables.schedule_person_settings!.push({ id: "settings", location_id: A, user_id: userId, usual_shift: value, work_type: null, leader_setting: null, soft_min_h: null, soft_max_h: null, full_time_min_h: null, roster_include: null, created_at: "2026-10-01" });
    return scheduleStore(tables);
  }
  it("loads, edits an unrelated staff setting, posts the full row, saves and reloads without wiping usual_shift", async () => {
    const store = shop();
    const loaded = (await loadLatestPersonSettings(store.client, A, userId))!;
    expect(loaded.row.usualShift).toEqual({ typeId: "morning", fromQ: 30, toQ: 64 });
    const body = personBody(A, { ...loaded.row, softMaxH: 38 }, loaded.id);
    await recordPersonSettings({ service: store.client }, { actor, locationId: A, settings: body.settings, expectedId: body.expectedId });
    expect(store.calls.at(-1)?.args.p_usual_shift).toEqual(loaded.row.usualShift);
    expect((await loadLatestPersonSettings(store.client, A, userId))?.row.usualShift).toEqual(loaded.row.usualShift);
    expect(mergePositionChanges(loaded.row, userId, { workType: "foh" }).usualShift).toEqual(loaded.row.usualShift);
  });
  it("decodes malformed stored values as null", async () => {
    expect((await loadLatestPersonSettings(shop({ typeId: 4 }).client, A, userId))?.row.usualShift).toBeNull();
  });
  it("passes shift choices to an AGM with people access while withholding the structure editor", async () => {
    const tables = shopTables(), s = structure(); s.shiftTypes = [type()];
    tables.schedule_structures!.push({ id: "structure", location_id: A, structure: s, created_at: "2026-10-01" });
    tables.schedule_shop_settings![0]!.agm_access = "edit";
    const store = scheduleStore(tables);
    const view = await loadScheduleSettings({ service: store.client, now: new Date("2026-10-22T16:00:00Z") }, { actor: { ...actor, userId: "00000000-0000-4000-8000-000000000002", role: "agm", level: 6 }, locationId: A });
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.structure).toBeNull();
    expect(view.shiftTypes).toEqual([type()]);
  });
  it("refuses unknown type IDs and stale settings before writing", async () => {
    const store = shop(); const loaded = (await loadLatestPersonSettings(store.client, A, userId))!;
    await expect(recordPersonSettings({ service: store.client }, { actor, locationId: A, expectedId: loaded.id, settings: { ...loaded.row, usualShift: { typeId: "gone" } } })).rejects.toMatchObject({ code: "invalid_payload" });
    await expect(recordPersonSettings({ service: store.client }, { actor, locationId: A, expectedId: "stale", settings: loaded.row })).rejects.toMatchObject({ code: "person_settings_moved" });
    expect(store.calls).toEqual([]);
  });
  it.each([{ typeId: "x", fromQ: 4 }, { typeId: "x", fromQ: 4, toQ: 4 }, "x", []])("route and writer reject malformed %j", async (usualShift) => {
    const store = shop(); const loaded = (await loadLatestPersonSettings(store.client, A, userId))!;
    const settings = { ...loaded.row, usualShift };
    await expect(recordPersonSettings({ service: store.client }, { actor, locationId: A, settings: settings as never, expectedId: loaded.id })).rejects.toMatchObject({ code: "invalid_payload" });
    vi.mocked(requireSession).mockResolvedValue({ user: { id: GM }, role: "gm", level: 7, locations: [A], session: {} } as never);
    vi.mocked(getServiceRoleClient).mockReturnValue(store.client);
    const response = await route.POST(new NextRequest("http://localhost/api/schedule", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(personBody(A, settings as never, loaded.id)) }));
    expect(response.status).toBe(400); expect(store.calls).toEqual([]);
  });
});

describe("usual shift editor", () => {
  it.each(["en", "es"] as const)("renders the hint, deleted-type note, time error and flexible-start warning in %s", (language) => {
    const render = (value: Parameters<typeof UsualShiftEditor>[0]["value"], types = [type()]) => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(UsualShiftEditor, { value, types, guess: guessUsualShift(history, args), onChange: () => {} }) }));
    expect(render(null, [])).toBe("");
    expect(render(null)).toContain(language === "en" ? "Guessed from Toast" : "Estimado con Toast");
    expect(render({ typeId: "gone" })).toContain(language === "en" ? "was removed" : "Se eliminó");
    expect(render({ typeId: "morning", fromQ: 40, toQ: 96 })).toContain(language === "en" ? "outside" : "fuera");
    expect(render({ typeId: "morning", fromQ: 40, toQ: 40 })).toContain('role="alert"');
    expect(render(null)).toContain("min-h-[44px]");
  });
});
