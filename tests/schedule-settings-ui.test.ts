/**
 * Scheduling Phase 2, chunk F, Task 24 — the schedule SETTINGS page, rendered with react-dom/server from the view the
 * REAL loader builds over the in-memory fake (tests/fixtures/schedule/lib-store), plus the pure helpers:
 *  - the structure editor (every mockup section; crews as stacked cards; the closing line "measured ~N min from M
 *    finalized closes · override (wins when set)"; labor target % + basis, default Total labor), the TS validator naming
 *    the key BEFORE any post, Tier E (a cancelled prompt keeps the draft), the station-column advisory, "Settings changed
 *    — regenerate?" after a save;
 *  - staff settings (work type + also allowed, leader setting, preferred cover positions ordered with ↑ ↓ ×, soft range,
 *    full-timer, "Include on the schedule" only for a role excluded by default and never for CGS / SMM);
 *  - presence toggles and Add to schedule, both writing pins (exact bodies);
 *  - MoO only: the shop switch, wage estimates (blank by default) and AGM access; the skill-tunables editor; the prep
 *    position card — each Tier E with its exact body;
 *  - permissions (SMM refused by ROLE; a GM never sees the MoO cards), en + es, 44 px.
 */
import { readFileSync } from "node:fs";
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
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
import type { PeopleActor } from "@/lib/people/access-shared";
import { A, AGM, GM, KH, MOO, P_REG, P_WALK, SMM, STAFF, noIoClient, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z");
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const moo = actor(MOO, "moo", 8, []);
const agm = actor(AGM, "agm", 6, [A]);
const smm = actor(SMM, "social_media_mgr", 6, [A]);
const PREP_MGR = "00000000-0000-4000-8000-000000000044";
const CGS = "00000000-0000-4000-8000-000000000045";
function shop(mut: (t: ReturnType<typeof shopTables>) => void = () => {}) {
  const t = shopTables();
  t.users!.push({ id: PREP_MGR, name: "Pat", role: "prep_mgr", active: true }, { id: CGS, name: "Juan", role: "cgs", active: true });
  t.user_locations!.push({ user_id: PREP_MGR, location_id: A, active: true, assigned_at: "2026-01-01T12:00:00Z" }, { user_id: CGS, location_id: A, active: true, assigned_at: "2026-01-01T12:00:00Z" });
  mut(t);
  const s = scheduleStore(t);
  return { ...s, deps: { service: s.client, now: NOW } };
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = (view: Parameters<typeof ScheduleSettings>[0]["view"], language: "en" | "es" = "en", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, catalogWindow: true,
    children: createElement(ScheduleSettings, { view, ...extra }) as ReactNode }) }));
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}`; } };

describe("the loader: permissions first, sections by role", () => {
  it.each(["position", "station"])("loads %s trim provenance even when it equals the default", async (source) => {
    const v = await loadScheduleSettings(shop((t) => {
      t.stations![0]!.usually_closes_at = "15:30:00";
      if (source === "position") t.station_positions![0]!.usually_trims_at = "15:30:00";
      else t.stations![0]!.trims = [{ at: "15:30", to_count: 1 }];
    }).deps, { actor: gm, locationId: A });
    if (v.state !== "ready") throw new Error("not ready");
    expect(v.timeProvenance[P_REG]).toEqual({ closeFromStation: true, trimFromStation: true });
  });
  it("offers only live positions while keeping legacy labels in staff and presence", async () => {
    const v = await loadScheduleSettings(shop((t) => {
      t.station_positions![1]!.active = false;
      t.stations!.push({ ...t.stations![0]!, id: "side", staffed: false });
      t.station_positions!.push({ ...t.station_positions![0]!, id: "side-position", station_id: "side", name: "Side work" });
      t.schedule_person_settings!.push({ id: "legacy", location_id: A, user_id: KH, cover_positions: [P_WALK], also_allowed: [], full_time: false, created_at: NOW.toISOString() });
      t.schedule_pins!.push({ id: "legacy-pin", location_id: A, user_id: KH, business_date: "2026-10-21", start_q: 40, end_q: 60, positions: [P_WALK], kind: "added", active: true, retires_id: null });
    }).deps, { actor: gm, locationId: A });
    if (v.state !== "ready") throw new Error("not ready");
    expect(v.livePositionIds).toEqual([P_REG]);
    expect(v.positions[P_WALK]!.name).toBe("Walk-ins");
    expect(v.positions["side-position"]!.name).toBe("Side work");
    const h = render(v, "en", { initialPerson: KH });
    const staff = h.split('data-person-editor=')[1]!.split('data-person-editor-end')[0]!;
    expect(staff).toContain("Walk-ins");
    expect(staff).not.toContain(`<option value="${P_WALK}"`);
    expect(staff).not.toContain('<option value="side-position"');
    expect(staff).toContain(`<option value="${P_REG}"`);
    const presence = h.split('data-section="presence-add"')[1]!.split('</section>')[0]!;
    expect(presence).toContain("Walk-ins");
    expect(presence).not.toContain("Side work");
    expect(presence).not.toMatch(/type="checkbox"[^>]*\/>Walk-ins/);
  });
  it("the social media manager is refused by ROLE before any read; 0274 missing → not_installed", async () => {
    expect(await code(loadScheduleSettings({ service: noIoClient(), now: NOW }, { actor: smm, locationId: A }))).toBe("schedule_role_refused");
    expect(await loadScheduleSettings(shop((t) => { delete t.schedule_shop_settings; }).deps, { actor: gm, locationId: A })).toEqual({ state: "not_installed" });
  });
  it("a GM: structure, staff, presence and the prep card — never the MoO cards; MoO: everything; an AGM with read access: nothing to edit", async () => {
    const g = await loadScheduleSettings(shop().deps, { actor: gm, locationId: A });
    if (g.state !== "ready") throw new Error("not ready");
    expect(g.perms).toEqual({ structure: true, people: true, presence: true, shopSwitch: false, tunables: false, prepCard: true });
    expect(g.shop).toBeNull();
    expect(g.tunables).toBeNull();
    const m = await loadScheduleSettings(shop().deps, { actor: moo, locationId: A });
    if (m.state !== "ready") throw new Error("not ready");
    expect(m.perms).toEqual({ structure: true, people: true, presence: true, shopSwitch: true, tunables: true, prepCard: true });
    expect(m.shop).toEqual({ enabled: true, estimatedHourlyCents: 1800, estimatedSalariedWeeklyCents: 120000, agmAccess: "read" });
    const a = await loadScheduleSettings(shop().deps, { actor: agm, locationId: A });
    if (a.state !== "ready") throw new Error("not ready");
    expect(a.perms).toEqual({ structure: false, people: false, presence: false, shopSwitch: false, tunables: false, prepCard: false });
    const ae = await loadScheduleSettings(shop((t) => { t.schedule_shop_settings![0]!.agm_access = "edit"; }).deps, { actor: agm, locationId: A });
    if (ae.state !== "ready") throw new Error("not ready");
    expect(ae.perms).toMatchObject({ structure: false, people: true, presence: true });
  });
  it("Include on the schedule is offered only for a role the structure excludes — none by default now (Juan 2026-10-16, decision 8) — never for the CGS", async () => {
    const g = await loadScheduleSettings(shop().deps, { actor: gm, locationId: A });
    if (g.state !== "ready") throw new Error("not ready");
    // Decision 8: the prep / catering managers are ON the roster by default — nothing to include.
    expect(g.members.find((m) => m.userId === PREP_MGR)!.includeOffered).toBe(false);
    // A shop that excludes the role again offers Include for it.
    const excluded = structuredClone(g.structure!.value);
    excluded.roster.excludedRoles = [...excluded.roster.excludedRoles, "prep_mgr"];
    const x = await loadScheduleSettings(shop((t) => { t.schedule_structures!.push({ id: "sv-x", location_id: A, structure: excluded, created_at: "2026-10-01T00:00:00Z" }); }).deps, { actor: gm, locationId: A });
    if (x.state !== "ready") throw new Error("not ready");
    expect(x.members.find((m) => m.userId === PREP_MGR)!.includeOffered).toBe(true);
    expect(g.members.some((m) => m.userId === CGS)).toBe(true);
    expect(g.members.some((m) => m.userId === SMM)).toBe(true);
    expect(g.members.find((m) => m.userId === STAFF[0])!.includeOffered).toBe(false);
  });
});

describe("the structure editor", () => {
  const view = async () => { const v = await loadScheduleSettings(shop().deps, { actor: gm, locationId: A }); if (v.state !== "ready") throw new Error("x"); return v; };
  it("every mockup section; crews as stacked cards (one per day type); managers' floor 32 h; limits incl. min shift 4 h; the closing line; labor target % + basis (Total labor)", async () => {
    const h = render(await view());
    const t = text(h);
    for (const k of ["shop_day", "day_types", "crews", "positions", "leadership", "managers", "limits", "catering", "labor", "roster"]) {
      expect(h, k).toContain(`data-structure-section="${k}"`);
      expect(t, k).toContain(en[`schedule.settings.section.${k}` as keyof typeof en]);
    }
    expect((h.match(/data-crew-card="/g) ?? []).length).toBe(4);
    expect(h).toMatch(/name="limits.managerFloorH"[^>]*value="32"|value="32"[^>]*name="limits.managerFloorH"/);
    expect(h).toMatch(/name="limits.minimumShiftH"[^>]*value="4"|value="4"[^>]*name="limits.minimumShiftH"/);
    // Astra chunk H P2-4: the salaried week target (0–80) and the flex hours (0–10), quarter-hour steppers, en/es labels.
    const input = (name: string) => h.match(new RegExp(`<input[^>]*name="${name.replace(".", "\\.")}"[^>]*>`))?.[0] ?? "";
    expect(input("limits.salariedTargetWeekH")).toMatch(/value="40"/);
    expect(input("limits.salariedTargetWeekH")).toMatch(/step="0.25"/);
    expect(input("limits.salariedTargetWeekH")).toMatch(/max="80"/);
    expect(input("limits.salariedFlexH")).toMatch(/value="10"/);
    expect(input("limits.salariedFlexH")).toMatch(/step="0.25"/);
    expect(input("limits.salariedFlexH")).toMatch(/max="10"/);
    expect(en["schedule.settings.managers.week_target"]).toBe("Manager weekly target");
    expect(en["schedule.settings.managers.flex"]).toBe("Flex hours (to keep labor down)");
    expect(t).toContain(en["schedule.settings.managers.week_target"]);
    expect(t).toContain(en["schedule.settings.managers.flex"]);
    expect(text(render(await view(), "es"))).toContain(es["schedule.settings.managers.flex" as keyof typeof es]);
    expect(t).toMatch(/measured ~\d+ min from \d+ finalized closes · override \(wins when set\)|not enough finalized closes yet · override \(wins when set\)/);
    expect(h).toMatch(/<option[^>]*value="total"[^>]*selected=""/);
    expect(t).toContain(en["schedule.settings.limits.flex_phase3"]);
  });
  it("the TS validator names the key BEFORE posting; a valid draft passes", async () => {
    const { structureSaveRefusal } = await import("@/lib/scheduling/settings-view-shared");
    const v = await view();
    const bad = structuredClone(v.structure!.value);
    bad.limits.minimumShiftQ = 0;
    expect(structureSaveRefusal(bad)).toMatch(/^limits\./);
    expect(structureSaveRefusal(v.structure!.value)).toBeNull();
    expect(text(render(v, "en", { initialStructureError: "limits.minimumShiftQ" }))).toContain(en["schedule.error.structure_invalid"].replace("{key}", "limits.minimumShiftQ"));
  });
  it("Tier E before the post (a cancelled prompt keeps the draft); the exact body; after save 'Settings changed — regenerate?'", async () => {
    const src = readFileSync("components/schedule/StructureEditor.tsx", "utf8");
    expect(src).toContain('requestStepUp("E")');
    const { structureBody } = await import("@/lib/scheduling/settings-view-shared");
    const { SCHEDULE_SETTINGS_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    const v = await view();
    expect(Object.keys(structureBody(A, null, v.structure!.value)).sort()).toEqual([...SCHEDULE_SETTINGS_ACTIONS.structure!].sort());
    const { runGuarded } = await import("@/components/schedule/horizon-flow-shared");
    const post = vi.fn(async () => ({ ok: true as const, data: {} }));
    expect(await runGuarded({ tier: "E", requestStepUp: async () => "cancelled", post })).toEqual({ kind: "cancelled" });
    expect(post).not.toHaveBeenCalled();
    const after = text(render(v, "en", { initialSaved: true }));
    expect(after).toContain(en["schedule.board.banner.settings_changed"]);
  });
  it("the station-column advisory names a station time that no longer matches the saved structure", async () => {
    const { stationAdvisory } = await import("@/lib/scheduling/settings-view-shared");
    const v = await view();
    const saved = structuredClone(v.structure!.value);
    saved.positions[P_REG]!.closeQ = 80; // 8:00 PM saved; the station says 9:00 PM
    const lines = stationAdvisory(saved, v.structure!.value, { [P_REG]: { close: "station", trim: "default" } });
    expect(lines).toContainEqual({ key: "schedule.settings.advisory.close", params: { positionId: P_REG, savedQ: 80, stationQ: 84 } });
    const h = render({ ...v, stationAdvisory: lines });
    expect(text(h)).toContain("Register");
    expect(h).toContain('data-section="station-advisory"');
  });
});

describe("staff settings, presence, Add to schedule", () => {
  const view = async (a = gm) => { const v = await loadScheduleSettings(shop().deps, { actor: a, locationId: A }); if (v.state !== "ready") throw new Error("x"); return v; };
  it("a person's drawer: work type + also allowed, leader setting, cover positions with ↑ ↓ × (44 px), soft range, full-timer; Include only where offered", async () => {
    const v = await view();
    const h = render(v, "en", { initialPerson: KH });
    const drawer = h.match(/<div[^>]*data-person-editor="[^"]*"[\s\S]*?data-person-editor-end/)![0];
    const t = text(drawer);
    for (const k of ["work_type", "also_allowed", "leader", "cover", "soft_range", "full_time"]) expect(t, k).toContain(en[`schedule.settings.staff.${k}` as keyof typeof en]);
    for (const k of ["opens", "closes", "mix"]) expect(t).toContain(en[`schedule.settings.staff.leader_${k}` as keyof typeof en]);
    expect(t).not.toContain(en["schedule.settings.staff.include"]);
    const withCover = render({ ...v, members: v.members.map((m) => (m.userId === KH ? { ...m, settings: { ...(m.settings ?? emptySettings(KH)), coverPositions: [P_REG, P_WALK] } } : m)) }, "en", { initialPerson: KH });
    const buttons = withCover.match(/<button[^>]*data-cover-act="(up|down|remove)"[^>]*>/g) ?? [];
    expect(buttons.length).toBe(6);
    for (const b of buttons) { expect(b).toContain("min-h-[44px]"); expect(b).toContain("min-w-[44px]"); expect(b).toContain("items-center"); }
    const offered = { ...v, members: v.members.map((m) => (m.userId === PREP_MGR ? { ...m, includeOffered: true } : m)) };
    expect(text(render(offered, "en", { initialPerson: PREP_MGR }))).toContain(en["schedule.settings.staff.include"]);
    const { personBody } = await import("@/lib/scheduling/settings-view-shared");
    const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    expect(Object.keys(personBody(A, emptySettings(KH), null)).sort()).toEqual([...SCHEDULE_ACTIONS.person!].sort());
  });
  it("presence toggles ('Cris in today') and Add to schedule (person, block, positions), both writing pins with the exact body", async () => {
    const v = await view();
    const h = render(v);
    const t = text(h);
    expect(t).toContain(en["schedule.settings.presence.in_today"].replace("{name}", "Cris"));
    expect(h).toMatch(/<label[^>]*data-presence="[^"]+"[^>]*class="[^"]*min-h-\[44px\][^"]*items-center/);
    expect(t).toContain(en["schedule.settings.add.title"]);
    const { pinBody } = await import("@/lib/scheduling/settings-view-shared");
    const { SCHEDULE_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    const b = pinBody(A, { date: "2026-10-22", userId: MOO, startQ: 42, endQ: 58, positions: [], kind: "presence" });
    expect(Object.keys(b).sort()).toEqual([...SCHEDULE_ACTIONS.pin!].sort());
    expect(b.pin).toEqual({ date: "2026-10-22", userId: MOO, startQ: 42, endQ: 58, positions: [], kind: "presence" });
  });
  it("Astra chunk F P2-4: pins load for EVERY week the offered dates touch — Fri Oct 16 offers Oct 16 … 29, and the Oct 27 / 29 pins are there", async () => {
    const FRI = new Date("2026-10-16T16:00:00Z");
    const s = shop((t) => {
      t.schedule_pins = [
        { id: "pin-27", location_id: A, business_date: "2026-10-27", user_id: MOO, start_q: 42, end_q: 58, positions: [], kind: "presence", active: true, retires_id: null },
        { id: "pin-29", location_id: A, business_date: "2026-10-29", user_id: MOO, start_q: 42, end_q: 58, positions: [], kind: "presence", active: true, retires_id: null },
      ];
    });
    const v = await loadScheduleSettings({ ...s.deps, now: FRI }, { actor: gm, locationId: A });
    if (v.state !== "ready") throw new Error(v.state);
    expect(v.dates[0]).toBe("2026-10-16");
    expect(v.dates[v.dates.length - 1]).toBe("2026-10-29");
    expect(v.pins.map((p) => p.id).sort()).toEqual(["pin-27", "pin-29"]);
    // The offered range and the loaded range come from ONE constant.
    const shared = await import("@/lib/scheduling/settings-view-shared") as Record<string, unknown>;
    const presenceDates = shared.presenceDates as (d: string) => string[];
    const presenceWeekStarts = shared.presenceWeekStarts as (d: string) => string[];
    expect(presenceDates("2026-10-16")).toHaveLength(shared.PRESENCE_DAYS as number);
    expect(presenceWeekStarts("2026-10-16")).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(readFileSync("lib/scheduling/settings-view.ts", "utf8")).toMatch(/weekStarts: presenceWeekStarts\(today\)/);
  });
});

describe("MoO only: the shop switch, wage estimates, AGM access; the tunables editor; the prep position card", () => {
  it("a GM never sees the MoO cards; MoO sees the switch, the estimates (blank stays blank) and AGM access, Tier E with the exact body", async () => {
    const g = await loadScheduleSettings(shop().deps, { actor: gm, locationId: A });
    const m = await loadScheduleSettings(shop((t) => { t.schedule_shop_settings![0]!.estimated_hourly_cents = null; }).deps, { actor: moo, locationId: A });
    if (g.state !== "ready" || m.state !== "ready") throw new Error("x");
    expect(render(g)).not.toContain('data-section="shop-switch"');
    expect(render(g)).not.toContain('data-section="tunables"');
    const h = render(m);
    expect(h).toContain('data-section="shop-switch"');
    expect(h).toMatch(/name="estimatedHourly"[^>]*value=""|value=""[^>]*name="estimatedHourly"/);
    expect(text(h)).toContain(en["schedule.settings.shop.agm_access"]);
    const { shopBody, tunablesBody, prepBody } = await import("@/lib/scheduling/settings-view-shared");
    const { SCHEDULE_SETTINGS_ACTIONS } = await import("@/lib/scheduling/route-shapes-shared");
    expect(Object.keys(shopBody(A, { enabled: true, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: 100000, agmAccess: "read" })).sort()).toEqual([...SCHEDULE_SETTINGS_ACTIONS.shop!].sort());
    for (const f of ["ShopSettingsCard", "SkillTunablesEditor", "PrepPositionCard"]) {
      const src = readFileSync(f === "ShopSettingsCard" ? "components/schedule/ShopSettingsCard.tsx" : `components/people/${f}.tsx`, "utf8");
      expect(src, f).toContain('requestStepUp("E")');
    }
    expect(tunablesBody(null, m.tunables!)).toEqual({ action: "tunables", locationId: null, tunables: m.tunables });
    expect(prepBody(A, { pmV2: false, prepPositionId: P_REG })).toEqual({ action: "shop", locationId: A, pmV2: false, prepPositionId: P_REG });
    expect(h).toContain('data-section="tunables"');
    expect(h).toContain('data-section="prep-position"');
  });
});

describe("en + es, 44 px, no shop-code literal", () => {
  it("every schedule.settings.* key the page renders exists in en AND es (tú); the es render carries the same controls", async () => {
    const v = await loadScheduleSettings(shop().deps, { actor: moo, locationId: A });
    if (v.state !== "ready") throw new Error("x");
    const srcs = ["components/schedule/ScheduleSettings.tsx", "components/schedule/StructureEditor.tsx", "components/schedule/StaffSettings.tsx", "components/schedule/PresenceAndAdd.tsx",
      "components/schedule/ShopSettingsCard.tsx", "components/people/SkillTunablesEditor.tsx", "components/people/PrepPositionCard.tsx", "lib/scheduling/settings-view-shared.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const keys = [...new Set(srcs.match(/"schedule\.settings\.[a-z0-9_.]+"/g)?.map((k) => k.slice(1, -1)) ?? [])].filter((k) => !k.endsWith("."));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) { expect((en as Record<string, string>)[k], k).toBeTruthy(); expect((es as Record<string, string>)[k], k).toBeTruthy(); }
    for (const k of Object.keys(es).filter((x) => x.startsWith("schedule.settings."))) expect((es as Record<string, string>)[k], k).not.toMatch(/\busted\b/i);
    const a = render(v);
    const b = render(v, "es");
    expect((b.match(/<button/g) ?? []).length).toBe((a.match(/<button/g) ?? []).length);
    for (const btn of a.match(/<button[^>]*>/g) ?? []) { expect(btn, btn).toContain("min-h-[44px]"); expect(btn, btn).toContain("items-center"); }
    expect(srcs).not.toMatch(/["'](EM|MEP)["']/);
  });
});

function emptySettings(userId: string) {
  return { userId, workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null };
}

describe("Astra chunk F P2-5: collapsing a section HIDES it and never unmounts its editor (D10: drafts survive)", () => {
  it("a collapsed section still renders its editor, hidden; the toggle names its state", async () => {
    const { Section } = await import("@/components/schedule/ScheduleSettings");
    const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(Section, {
      id: "shop", title: "Shop", locked: false, defaultOpen: false, children: createElement("input", { "data-draft": "wage", defaultValue: "18.50" }) }) as ReactNode }));
    expect(html).toContain('data-draft="wage"');
    expect(html).toMatch(/<div[^>]*hidden=""[^>]*>[\s\S]*data-draft="wage"/);
    expect(html).toMatch(/aria-expanded="false"/);
    // Every section of the real page (shop settings and tunables included) goes through that Section.
    const src = readFileSync("components/schedule/ScheduleSettings.tsx", "utf8");
    expect(src).not.toMatch(/\{isOpen \? <div/);
    for (const id of ["structure", "staff", "presence", "shop", "tunables", "prep"]) expect(src).toContain(`<Section id="${id}"`);
  });
});

describe("Juan 2026-10-16 (decision 2): the hourly estimate defaults to the DC minimum wage, $18.40/h, both shops", () => {
  it("no settings row yet → the MoO's card opens on $18.40 (editable), with the dated DC note in en + es; salaried stays blank", async () => {
    const { DEFAULT_SCHEDULE_SHOP_SETTINGS, DC_MINIMUM_WAGE_CENTS, DC_MINIMUM_WAGE_SINCE } = await import("@/lib/scheduling/inputs-shared");
    expect(DC_MINIMUM_WAGE_CENTS).toBe(1840);
    expect(DC_MINIMUM_WAGE_SINCE).toBe("2026-07-01");
    expect(DEFAULT_SCHEDULE_SHOP_SETTINGS).toEqual({ enabled: false, estimatedHourlyCents: 1840, estimatedSalariedWeeklyCents: null, agmAccess: "read" });
    const m = await loadScheduleSettings(shop((t) => { t.schedule_shop_settings = []; }).deps, { actor: moo, locationId: A });
    if (m.state !== "ready") throw new Error("x");
    expect(m.shop).toEqual({ enabled: false, estimatedHourlyCents: 1840, estimatedSalariedWeeklyCents: null, agmAccess: "read" });
    const h = render(m);
    expect(h).toMatch(/name="estimatedHourly"[^>]*value="18.40"|value="18.40"[^>]*name="estimatedHourly"/);
    expect(h).toMatch(/name="estimatedSalaried"[^>]*value=""|value=""[^>]*name="estimatedSalaried"/);
    expect(text(h)).toContain(en["schedule.settings.shop.dc_minimum_wage_note"]);
    expect(en["schedule.settings.shop.dc_minimum_wage_note"]).toBe("DC minimum wage $18.40 since Jul 1, 2026; check every July 1.");
    expect(es["schedule.settings.shop.dc_minimum_wage_note"]).toMatch(/18\.40.*1 de julio/);
    // 0274 seeds the same value as the column default.
    expect(readFileSync("supabase/migrations/0274_schedule_settings.sql", "utf8")).toMatch(/estimated_hourly_cents\s+integer default 1840/);
  });
});


it("a saved position on a now-unmanned station gets the distinct advisory in both languages", async () => {
  const s = shop();
  const before = await loadScheduleSettings(s.deps, { actor: gm, locationId: A });
  if (before.state !== "ready" || !before.structure) throw new Error("not ready");
  const saved = structuredClone(before.structure.value);
  const changed = shop((t) => {
    t.schedule_structures!.push({ id: "sv-unmanned", location_id: A, structure: saved, created_at: "2026-10-21T10:00:00Z" });
    t.stations![0]!.staffed = false;
  });
  const after = await loadScheduleSettings(changed.deps, { actor: gm, locationId: A });
  if (after.state !== "ready") throw new Error("not ready");
  expect(after.stationAdvisory).toEqual([P_REG, P_WALK].sort().map((positionId) => ({
    key: "schedule.settings.advisory.unmanned_position", params: { positionId },
  })));
  expect(after.structure!.value).toEqual(saved);
  for (const language of ["en", "es"] as const) {
    const dict = language === "en" ? en : es;
    const copy = dict["schedule.settings.advisory.unmanned_position"];
    expect(copy.match(/\{positionId\}/g)).toHaveLength(1);
    expect(text(render(after, language))).toContain(copy.split("{positionId}")[1]!.trim());
  }
});

it.each(["station", "position"])("a retired %s on an unmanned station keeps the retired advisory", async (retired) => {
  const before = await loadScheduleSettings(shop().deps, { actor: gm, locationId: A });
  if (before.state !== "ready" || !before.structure) throw new Error("not ready");
  const after = await loadScheduleSettings(shop((t) => {
    t.schedule_structures!.push({ id: "saved", location_id: A, structure: before.structure!.value, created_at: NOW.toISOString() });
    t.stations![0]!.staffed = false;
    if (retired === "station") t.stations![0]!.active = false;
    else t.station_positions![0]!.active = false;
  }).deps, { actor: gm, locationId: A });
  if (after.state !== "ready") throw new Error("not ready");
  expect(after.stationAdvisory).toContainEqual({ key: "schedule.settings.advisory.retired_position", params: { positionId: P_REG } });
  expect(after.stationAdvisory).not.toContainEqual({ key: "schedule.settings.advisory.unmanned_position", params: { positionId: P_REG } });
});
