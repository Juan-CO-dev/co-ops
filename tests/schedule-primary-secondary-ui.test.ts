/**
 * Juan 2026-10-20 — primary / secondary position: the SCREENS and the save path, over the in-memory shop
 * (tests/fixtures/schedule/lib-store) and react-dom/server:
 *  - Staff settings: "Positions (in order)" with #1 Primary, #2 Secondary, the rest "Can flex to" (en + es) for everyone
 *    below shift lead; a manager keeps "Preferred cover positions" (unchanged); ↑ ↓ × stay 44 px;
 *  - the work-type check BEFORE any post (an alert naming the slot and position, Save disabled), only once the
 *    structure is saved; the save path refuses the same thing (`position_rank_not_allowed`) before the RPC;
 *  - the Toast suggestion: loaded from the linked person's most-worked job (last 8 weeks), shown as "Use <position>",
 *    never saved on its own; no confident match → no button;
 *  - the admin user screen: the per-shop picker data (null where scheduling is not installed), the "Positions" dialog
 *    and the Add user form's pickers (below shift lead only), the row they write (only the work type and the first two
 *    positions change).
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { loadScheduleSettings } = await import("@/lib/scheduling/settings-view");
const { ScheduleSettings } = await import("@/components/schedule/ScheduleSettings");
const { recordPersonSettings } = await import("@/lib/scheduling/settings");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
const { loadUserPositionPickers } = await import("@/lib/scheduling/user-positions");
const { UserPositionsDialog } = await import("@/components/admin/users/UserPositions");
const { CreateUserForm } = await import("@/components/admin/users/CreateUserForm");
import type { PeopleActor } from "@/lib/people/access-shared";
import type { PersonSettingsRow } from "@/lib/scheduling/people-input-shared";
import { flexDropped, nextSettingsRow, pickChanged, pickOf, type ShopPositionPicker } from "@/lib/scheduling/user-positions-shared";
import { A, AGM, GM, KH, P_REG, P_WALK, SL, ST, STAFF, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const NOW = new Date("2026-10-21T16:00:00Z");
const gm: PeopleActor = { userId: GM, role: "gm", level: 7, locations: [A] };
const EMP = STAFF[1]!; // "Staff 1", employee (default work type FOH)
const EMP2 = STAFF[2]!;
const P_EXPO = "00000000-0000-4000-8000-000000000033";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const row = (userId: string, over: Partial<PersonSettingsRow> = {}): PersonSettingsRow => ({
  userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, ...over,
});
const punch = (userId: string, job: string, date: string, hours: number, n: number) => ({
  time_entry_guid: `te-${userId}-${n}`, location_id: A, user_id: userId, business_date: date, job_name: job, hours, deleted: false,
  in_at: `${date}T14:00:00Z`, out_at: `${date}T20:00:00Z`,
});

function shop(mut: (t: ReturnType<typeof shopTables>) => void = () => {}) {
  const t = shopTables();
  t.station_positions!.push({ id: P_EXPO, station_id: ST, location_id: A, name: "Expeditor", name_es: "Expedidor", sort: 3, active: true, usually_trims_at: null });
  mut(t);
  const s = scheduleStore(t);
  return { ...s, deps: { service: s.client, now: NOW } };
}
const ready = async (s: ReturnType<typeof shop>) => {
  const v = await loadScheduleSettings(s.deps, { actor: gm, locationId: A });
  if (v.state !== "ready") throw new Error(v.state);
  return v;
};
type View = Awaited<ReturnType<typeof ready>>;
/** The page's providers around one element (children as createElement arguments). */
const wrapIn = (el: ReactNode, language: "en" | "es") => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language } as Parameters<typeof TranslationProvider>[0],
  createElement(StepUpProvider, { unlocked: false, unlockedAt: null, catalogWindow: true } as Parameters<typeof StepUpProvider>[0], el)));
const render = (view: View, language: "en" | "es", initialPerson: string) =>
  wrapIn(createElement(ScheduleSettings, { view, initialPerson }), language);
const drawer = (h: string) => h.match(/<div[^>]*data-person-editor="[^"]*"[\s\S]*?data-person-editor-end/)![0];
const withSettings = (v: View, userId: string, over: Partial<PersonSettingsRow>): View =>
  ({ ...v, members: v.members.map((m) => (m.userId === userId ? { ...m, settings: row(userId, { ...(m.settings ?? {}), ...over }) } : m)) });

describe("Staff settings: Positions (in order) — Primary / Secondary / Can flex to", () => {
  it("below shift lead: the heading, the help line and one slot label per entry, en + es", async () => {
    const v = withSettings(await ready(shop()), EMP, { coverPositions: [P_WALK, P_REG, P_EXPO] });
    for (const [lang, L] of [["en", EN], ["es", ES]] as const) {
      const d = drawer(render(v, lang, EMP));
      const tx = text(d);
      expect(tx).toContain(L["schedule.settings.staff.cover"]);
      expect(tx).toContain(L["schedule.settings.staff.cover_help"]);
      expect(d.match(/data-position-slot="(primary|secondary|flex)"/g)).toEqual(['data-position-slot="primary"', 'data-position-slot="secondary"', 'data-position-slot="flex"']);
      for (const k of ["slot_primary", "slot_secondary", "slot_flex"]) expect(tx).toContain(L[`schedule.settings.staff.${k}`]);
      const buttons = d.match(/<button[^>]*data-cover-act="(up|down|remove)"[^>]*>/g) ?? [];
      expect(buttons).toHaveLength(9);
      for (const b of buttons) { expect(b).toContain("min-h-[44px]"); expect(b).toContain("min-w-[44px]"); expect(b).toContain("items-center"); }
    }
    expect(EN["schedule.settings.staff.cover"]).toBe("Positions (in order)");
  });
  it("Juan 2026-10-20: an HOURLY LEAD (shift lead, key holder): Primary = a station, Secondary = 'Manager duties' (fixed, explained), then 'Can flex to' — en + es", async () => {
    for (const lead of [SL, KH]) {
      const v = withSettings(await ready(shop()), lead, { coverPositions: [P_REG, P_WALK, P_EXPO] });
      for (const [lang, L] of [["en", EN], ["es", ES]] as const) {
        const d = drawer(render(v, lang, lead));
        const tx = text(d);
        expect(d).toContain('data-position-list="ranked"');
        expect(d.match(/data-position-slot="(primary|secondary|flex|manager_duty)"/g)).toEqual(
          ['data-position-slot="primary"', 'data-position-slot="manager_duty"', 'data-position-slot="flex"', 'data-position-slot="flex"']);
        for (const k of ["cover_help_lead", "slot_primary", "slot_manager_duty", "manager_duty_help", "slot_flex"]) expect(tx, k).toContain(L[`schedule.settings.staff.${k}`]);
      }
      // With no primary yet, the manager-duty row still says what their secondary is.
      const empty = drawer(render(withSettings(await ready(shop()), lead, { coverPositions: [] }), "en", lead));
      expect(empty.match(/data-position-slot="(primary|secondary|flex|manager_duty)"/g)).toEqual(['data-position-slot="manager_duty"']);
    }
  });
  it("a SALARIED manager (GM / AGM) keeps 'Preferred cover positions (in order)' with no slot labels — unchanged", async () => {
    const v = withSettings(await ready(shop()), AGM, { coverPositions: [P_REG, P_WALK] });
    const d = drawer(render(v, "en", AGM));
    expect(text(d)).toContain(EN["schedule.settings.staff.cover_manager"]);
    expect(EN["schedule.settings.staff.cover_manager"]).toBe("Preferred cover positions (in order)");
    expect(d).toContain('data-position-list="cover"');
    expect(d).not.toMatch(/data-position-slot="(primary|secondary|flex)"/);
    expect(text(d)).not.toContain(EN["schedule.settings.staff.slot_primary"]);
  });
  it("the work-type check before any post: once the structure is saved, a FOH primary on the dish-and-prep position is named and Save is disabled", async () => {
    const base = withSettings(await ready(shop()), EMP, { coverPositions: [P_REG, P_WALK] });
    const known: View = { ...base, positionRolesKnown: true, positions: { ...base.positions, [P_REG]: { ...base.positions[P_REG]!, role: "prep_dish" } } };
    const d = drawer(render(known, "en", EMP));
    expect(d).toContain("data-position-problems");
    expect(text(d)).toContain(EN["schedule.settings.staff.problem_work_type"]!.replace("{slot}", EN["schedule.settings.staff.slot_primary"]!).replace("{position}", "Register"));
    expect(d).toMatch(/<button[^>]*disabled=""[^>]*>Save/);
    const dEs = drawer(render(known, "es", EMP));
    expect(text(dEs)).toContain(ES["schedule.settings.staff.problem_work_type"]!.replace("{slot}", ES["schedule.settings.staff.slot_primary"]!).replace("{position}", "Register"));
    // Roles unknown (the structure not saved yet): no check, no alert.
    expect(drawer(render({ ...known, positionRolesKnown: false }, "en", EMP))).not.toContain("data-position-problems");
    // Back of house allows it.
    expect(drawer(render(withSettings(known, EMP, { workType: "boh", coverPositions: [P_REG] }), "en", EMP))).not.toContain("data-position-problems");
    // …and the same BOH person with a line secondary is named for the SECONDARY.
    expect(text(drawer(render(withSettings(known, EMP, { workType: "boh" }), "en", EMP)))).toContain(EN["schedule.settings.staff.problem_work_type"]!.replace("{slot}", EN["schedule.settings.staff.slot_secondary"]!).replace("{position}", "Walk-ins"));
  });
});

describe("the save path refuses the same thing before the RPC (position_rank_not_allowed)", () => {
  const saved = (role: string) => (t: ReturnType<typeof shopTables>) => {
    t.schedule_structures = [{ id: "sv-1", location_id: A, created_at: "2026-10-01T12:00:00Z", structure: { positions: { [P_REG]: { role }, [P_WALK]: { role: "walk" } } } }];
  };
  const save = async (s: ReturnType<typeof shop>, settings: PersonSettingsRow) => {
    try { await recordPersonSettings(s.deps, { actor: gm, locationId: A, settings }); return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; }
  };
  it("a FOH employee with the dish-and-prep position as primary or secondary: refused, nothing sent; BOH, a manager, or roles unknown: sent", async () => {
    const s = shop(saved("prep_dish"));
    expect(await save(s, row(EMP, { coverPositions: [P_REG] }))).toBe("position_rank_not_allowed");
    expect(await save(s, row(EMP, { coverPositions: [P_WALK, P_REG] }))).toBe("position_rank_not_allowed");
    expect(s.calls.filter((c) => c.fn === "record_schedule_person_settings")).toHaveLength(0);
    expect(await save(s, row(EMP, { coverPositions: [P_WALK, P_EXPO, P_REG] }))).toBe("ok"); // the flex tail is not judged
    expect(await save(s, row(EMP, { workType: "boh", coverPositions: [P_REG] }))).toBe("ok");
    expect(await save(s, row(EMP, { alsoAllowed: ["boh"], coverPositions: [P_REG] }))).toBe("ok");
    expect(await save(s, row(SL, { coverPositions: [P_REG] }))).toBe("ok");
    expect(await save(shop(), row(EMP, { coverPositions: [P_REG] }))).toBe("ok");
    expect(s.calls.filter((c) => c.fn === "record_schedule_person_settings")).toHaveLength(4);
  });
  it("the refusal's HTTP status is 422 and its message is en + es", async () => {
    const { SCHEDULE_ERROR_STATUS } = await import("@/lib/scheduling/errors-shared");
    expect(SCHEDULE_ERROR_STATUS.position_rank_not_allowed).toBe(422);
    expect(EN["schedule.error.position_rank_not_allowed"]).toBeTruthy();
    expect(ES["schedule.error.position_rank_not_allowed"]).not.toBe(EN["schedule.error.position_rank_not_allowed"]);
  });
});

describe("the Toast suggestion: most-worked job, last 8 weeks, a button never saved on its own", () => {
  const punches = (t: ReturnType<typeof shopTables>) => {
    t.toast_time_entries = [
      punch(EMP, "Register", "2026-10-01", 6, 1), punch(EMP, "Register", "2026-10-08", 6, 2), punch(EMP, "Walk-ins", "2026-10-09", 5, 3),
      punch(EMP2, "Counter", "2026-10-02", 8, 4),
      punch(KH, "Register", "2026-08-01", 40, 5), // older than 8 weeks: not counted
      punch(SL, "Register", "2026-10-02", 8, 6),
    ];
  };
  it("the loader suggests from the linked hours; no confident match ('Counter' with the roles unknown), a manager, or old hours → none", async () => {
    const v = await ready(shop(punches));
    const m = (id: string) => v.members.find((x) => x.userId === id)!;
    expect(m(EMP).suggestedPrimary).toEqual({ positionId: P_REG, jobName: "Register" });
    expect(m(EMP2).suggestedPrimary).toBeNull();
    expect(m(KH).suggestedPrimary).toBeNull(); // older than 8 weeks
    expect(m(SL).suggestedPrimary).toEqual({ positionId: P_REG, jobName: "Register" }); // an hourly lead gets a primary station too
    expect(m(AGM).suggestedPrimary).toBeNull(); // a salaried manager never
  });
  it("the drawer offers 'Use Register' with its Toast line (en + es) and only while no primary is set", async () => {
    const v = await ready(shop(punches));
    for (const [lang, L] of [["en", EN], ["es", ES]] as const) {
      const d = drawer(render(v, lang, EMP));
      expect(d).toContain(`data-toast-suggestion="${P_REG}"`);
      expect(text(d)).toContain(L["schedule.settings.staff.toast_suggest"]!.replace("{position}", "Register"));
      expect(text(d)).toContain(L["schedule.settings.staff.toast_suggest_help"]!.replace("{job}", "Register"));
    }
    expect(drawer(render(withSettings(v, EMP, { coverPositions: [P_WALK] }), "en", EMP))).not.toContain("data-toast-suggestion");
  });
});

// ─── The admin user screen ───────────────────────────────────────────────────

describe("the admin user screen: per-shop picker data", () => {
  it("live positions with labels, latest settings, suggestions; a shop without the scheduling tables is null", async () => {
    const s = shop((t) => {
      t.toast_time_entries = [punch(EMP, "Register", "2026-10-01", 6, 1)];
      t.schedule_person_settings = [
        { id: "ps1", location_id: A, user_id: KH, work_type: null, also_allowed: [], leader_setting: null, cover_positions: [P_WALK], soft_min_h: null, soft_max_h: null, full_time: false, full_time_min_h: null, roster_include: null, created_at: "2026-10-01T00:00:00Z" },
        { id: "ps2", location_id: A, user_id: KH, work_type: "boh", also_allowed: [], leader_setting: null, cover_positions: [P_REG, P_WALK], soft_min_h: null, soft_max_h: null, full_time: false, full_time_min_h: null, roster_include: null, created_at: "2026-10-02T00:00:00Z" },
      ];
    });
    const people = [{ userId: EMP, role: "employee" as const, locationIds: [A] }, { userId: KH, role: "key_holder" as const, locationIds: [A] }];
    const out = await loadUserPositionPickers(s.client, { locationIds: [A], people, today: "2026-10-21" });
    const a = out[A]!;
    expect(a.rolesKnown).toBe(false);
    expect(a.positions.map((p) => p.name)).toEqual(["Expeditor", "Register", "Walk-ins"]);
    expect(a.positions.every((p) => p.role === null)).toBe(true);
    expect(a.settings[KH]!.coverPositions).toEqual([P_REG, P_WALK]);
    expect(a.suggestions).toEqual({ [EMP]: { positionId: P_REG, jobName: "Register" } });
    const missing = shop((t) => { delete t.schedule_person_settings; });
    expect(await loadUserPositionPickers(missing.client, { locationIds: [A], people, today: "2026-10-21" })).toEqual({ [A]: null });
  });
});

describe("the row the pickers write: only the work type and the first two positions change", () => {
  it("nextSettingsRow / pickChanged / flexDropped", () => {
    const cur = row(KH, { leaderSetting: "closes", softMinH: 20, alsoAllowed: ["boh"], coverPositions: [P_REG, P_WALK, P_EXPO] });
    expect(nextSettingsRow(cur, KH, { workType: "boh", primary: P_EXPO, secondary: P_REG })).toEqual({ ...cur, workType: "boh", coverPositions: [P_EXPO, P_REG] });
    // Astra BC-013: Secondary = None clears the tail (no silent promotion of Expeditor), and the pickers count it first.
    expect(nextSettingsRow(cur, KH, { workType: null, primary: P_REG, secondary: null })).toEqual({ ...cur, coverPositions: [P_REG] });
    expect(flexDropped(cur, { workType: null, primary: P_REG, secondary: null })).toBe(1);
    expect(nextSettingsRow(null, EMP, { workType: null, primary: P_REG, secondary: P_WALK })).toEqual(row(EMP, { coverPositions: [P_REG, P_WALK] }));
    expect(pickChanged(cur, pickOf(cur))).toBe(false);
    expect(pickChanged(null, pickOf(null))).toBe(false);
    expect(pickChanged(null, { workType: null, primary: P_REG, secondary: null })).toBe(true);
    expect(flexDropped(cur, { workType: null, primary: null, secondary: null })).toBe(1);
    expect(flexDropped(cur, pickOf(cur))).toBe(0);
  });
});

describe("the admin user screen: the Positions dialog and the Add user form", () => {
  const LOC = { id: A, name: "Capitol Hill", code: "MEP" };
  const pickerShop = (over: Partial<ShopPositionPicker> = {}): ShopPositionPicker => ({
    locationId: A, rolesKnown: true, settings: {}, suggestions: {},
    positions: [{ id: P_EXPO, name: "Expeditor", nameEs: "Expedidor", role: "expo" }, { id: P_REG, name: "Prep/Dishwasher", nameEs: "Preparación/Lavaplatos", role: "prep_dish" }, { id: P_WALK, name: "Walk-ins", nameEs: null, role: "walk" }],
    ...over,
  });
  const wrap = (el: ReturnType<typeof createElement>, language: "en" | "es" = "en") => wrapIn(el, language);
  it("the dialog: work type, primary, secondary per shop (44 px selects, labelled), the suggestion button, en + es", () => {
    const shops = { [A]: pickerShop({ suggestions: { [EMP]: { positionId: P_WALK, jobName: "Walk-ins" } } }) };
    for (const [lang, L] of [["en", EN], ["es", ES]] as const) {
      const h = wrap(createElement(UserPositionsDialog, { userId: EMP, role: "employee", locations: [LOC], shops, onClose: () => {} }), lang);
      const tx = text(h);
      for (const k of ["admin.users.positions.work_type", "admin.users.positions.primary", "admin.users.positions.secondary", "admin.users.positions.help", "admin.users.positions.save"]) expect(tx, k).toContain(L[k]);
      expect(h).toContain(`data-toast-suggestion="${P_WALK}"`);
      const selects = h.match(/<select[^>]*>/g) ?? [];
      expect(selects).toHaveLength(3);
      for (const sel of selects) { expect(sel).toContain("min-h-[44px]"); expect(sel).toMatch(/id="(wt|pr|se)-/); }
      expect((h.match(/<select[^>]*>/g) ?? []).find((x) => x.includes('data-pick="secondary"'))).toContain('disabled=""');
      expect(tx).toContain(lang === "es" ? "Expedidor" : "Expeditor");
    }
  });
  it("Astra BC-013: with 'can flex to' entries behind the secondary, None says it clears them (and how many) — no silent promotion", () => {
    const shops = { [A]: pickerShop({ settings: { [EMP]: row(EMP, { coverPositions: [P_EXPO, P_WALK, P_REG] }) } }) };
    for (const [lang, L] of [["en", EN], ["es", ES]] as const) {
      const h = wrap(createElement(UserPositionsDialog, { userId: EMP, role: "employee", locations: [LOC], shops, onClose: () => {} }), lang);
      expect(text(h)).toContain(L["admin.users.positions.none_clear"]!.replace("{count}", "1"));
    }
    const cleared = wrap(createElement(UserPositionsDialog, { userId: EMP, role: "employee", locations: [LOC], shops, onClose: () => {}, initialPicksOverride: { [A]: { workType: null, primary: P_EXPO, secondary: null } } }));
    expect(text(cleared)).toContain(EN["admin.users.positions.clears_flex"]!.replace("{count}", "1"));
  });
  it("a work type that does not allow the primary is named and Save is disabled; scheduling not installed at a shop says so", () => {
    const shops = { [A]: pickerShop() };
    const h = wrap(createElement(UserPositionsDialog, { userId: EMP, role: "employee", locations: [LOC], shops, onClose: () => {}, initialPicksOverride: { [A]: { workType: null, primary: P_REG, secondary: null } } }));
    expect(h).toContain("data-position-problems");
    expect(text(h)).toContain(EN["schedule.settings.staff.problem_work_type"]!.replace("{slot}", EN["schedule.settings.staff.slot_primary"]!).replace("{position}", "Prep/Dishwasher"));
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Save positions/);
    const ok = wrap(createElement(UserPositionsDialog, { userId: EMP, role: "employee", locations: [LOC], shops, onClose: () => {}, initialPicksOverride: { [A]: { workType: "boh", primary: P_REG, secondary: null } } }));
    expect(ok).not.toContain("data-position-problems");
    expect(text(wrap(createElement(UserPositionsDialog, { userId: EMP, role: "employee", locations: [LOC], shops: { [A]: null }, onClose: () => {} })))).toContain(EN["admin.users.positions.unavailable"]);
  });
  it("Add user: the pickers appear per chosen shop for a role below shift lead, never for a manager; a refused pick blocks Add", () => {
    const shops = { [A]: pickerShop() };
    const base = { assignableRoles: ["employee", "key_holder", "shift_lead", "gm"] as const, accessibleLocations: [LOC], positionShops: shops, onClose: () => {} };
    const emp = wrap(createElement(CreateUserForm, { ...base, assignableRoles: [...base.assignableRoles], initial: { role: "employee", locationIds: [A] } }));
    expect(emp).toContain("data-create-positions");
    expect(emp).toContain(`data-position-shop="${A}"`);
    expect(text(emp)).toContain(EN["admin.users.positions.primary"]);
    const mgr = wrap(createElement(CreateUserForm, { ...base, assignableRoles: [...base.assignableRoles], initial: { role: "gm", locationIds: [A] } }));
    expect(mgr).not.toContain("data-create-positions");
    // An hourly lead gets the Primary station picker; their Secondary is shown as manager duties, never a picker.
    const lead = wrap(createElement(CreateUserForm, { ...base, assignableRoles: [...base.assignableRoles], initial: { role: "shift_lead", locationIds: [A] } }));
    expect(lead).toContain("data-create-positions");
    expect(lead).toContain("data-secondary-manager-duty");
    expect(lead).not.toContain('data-pick="secondary"');
    expect(text(lead)).toContain(EN["admin.users.positions.secondary_manager_duty"]!);
    const none = wrap(createElement(CreateUserForm, { ...base, assignableRoles: [...base.assignableRoles], initial: { role: "employee", locationIds: [] } }));
    expect(none).not.toContain("data-create-positions");
    const bad = wrap(createElement(CreateUserForm, { ...base, assignableRoles: [...base.assignableRoles], initial: { role: "employee", locationIds: [A], picks: { [A]: { workType: null, primary: P_REG, secondary: null } } } }));
    expect(bad).toContain("data-position-problems");
    expect(bad).toMatch(/<button[^>]*disabled=""[^>]*>Create user/);
  });
});
