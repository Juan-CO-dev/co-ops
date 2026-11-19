/**
 * Board two labor views PR 2: the editable PURE-HOURLY target (Juan 2026-11-18: "a setting, tweak up and down";
 * default 18%; MoO+ edits settings; dark behind SCHEDULE_LABOR_VIEWS). `labor.hourlyTargetPct` is an optional key of
 * the schedule structure (0346 is its SQL twin, tests/labor-burden-0346-migration.test.ts):
 *  - the pricer's targets read it (absent = 18; on the hourly basis targetPct IS the hourly target, loaded stays 28);
 *  - the save path: only MoO+ may CHANGE it, and only with the switch on; a GM's save that leaves it as it is passes;
 *  - the settings view says who may edit it; the editor renders the field only then (Tier E, like the rest of the
 *    structure), reads it back to a GM, and shows nothing while dark.
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { audit } = await import("@/lib/audit");
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const settings = await import("@/lib/scheduling/settings");
const { loadScheduleSettings } = await import("@/lib/scheduling/settings-view");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
const { ScheduleSettings } = await import("@/components/schedule/ScheduleSettings");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
import { laborTargetsFor, rangeTargets } from "@/lib/facts/labor-cost-shared";
import { LABOR_TARGET_HOURLY_PCT, LABOR_TARGET_LOADED_PCT } from "@/lib/facts/labor-config-shared";
import type { PeopleActor } from "@/lib/people/access-shared";
import { canEditHourlyTarget } from "@/lib/scheduling/access-shared";
import { hourlyTargetAccess, structureProblemLine, structureSaveRefusal } from "@/lib/scheduling/settings-view-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { A, AGM, GM, MOO, SMM, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z");
const WEEK = "2026-10-26";
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const moo = actor(MOO, "moo", 8, []);
const owner = actor(MOO, "owner", 9, []);
const agm = actor(AGM, "agm", 6, [A]);
const smm = actor(SMM, "social_media_mgr", 8, []);
const ON = { SCHEDULE_LABOR_VIEWS: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const OFF = { FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
function shop(env: Record<string, string> = ON) {
  const s = scheduleStore(shopTables());
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId, env } };
}
const refusal = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? [e.code, e.key ?? null] : `throw:${(e as Error).message}`; } };
const saves = (s: ReturnType<typeof shop>) => s.calls.filter((c) => c.fn === "save_schedule_structure");
async function live(s: ReturnType<typeof shop>) {
  const i = await loadSchedulingInputs(s.client, { locationId: A, weekStarts: [WEEK], now: NOW });
  return { id: i.structure.id, value: structuredClone(i.structure.structure) as ScheduleStructure };
}
const withHourly = (v: ScheduleStructure, pct: number | undefined): ScheduleStructure => {
  const n = structuredClone(v);
  if (pct === undefined) delete n.labor.hourlyTargetPct; else n.labor.hourlyTargetPct = pct;
  return n;
};

describe("the pricer's targets", () => {
  it("total basis: targetPct is the fully loaded target, hourlyTargetPct the pure hourly one; absent = 18", () => {
    expect(laborTargetsFor({ labor: { targetPct: 28, basis: "total", hourlyTargetPct: 16.5 } }))
      .toEqual({ loaded: { pct: 28, source: "structure" }, hourly: { pct: 16.5, source: "structure" } });
    expect(laborTargetsFor({ labor: { targetPct: 26, basis: "total" } }))
      .toEqual({ loaded: { pct: 26, source: "structure" }, hourly: { pct: LABOR_TARGET_HOURLY_PCT, source: "default" } });
    expect(LABOR_TARGET_HOURLY_PCT).toBe(18);
  });
  it("hourly basis: targetPct IS the hourly target and the loaded target stays 28 (the key is refused there, and ignored if ever read)", () => {
    expect(laborTargetsFor({ labor: { targetPct: 17, basis: "hourly" } })).toEqual({ loaded: { pct: 28, source: "default" }, hourly: { pct: 17, source: "structure" } });
    expect(laborTargetsFor({ labor: { targetPct: 17, basis: "hourly", hourlyTargetPct: 5 } }).hourly).toEqual({ pct: 17, source: "structure" });
    expect(LABOR_TARGET_LOADED_PCT).toBe(28);
  });
  it("a range whose weeks changed the hourly target says target_varies, never an average", () => {
    const a = laborTargetsFor({ labor: { targetPct: 28, basis: "total" } }), b = laborTargetsFor({ labor: { targetPct: 28, basis: "total", hourlyTargetPct: 16 } });
    expect(rangeTargets([a, b])).toEqual({ loaded: 28, hourly: "target_varies" });
  });
});

describe("who", () => {
  it("MoO+ only, never the social media manager whatever level it claims", () => {
    expect([moo, owner, gm, agm, smm].map(canEditHourlyTarget)).toEqual([true, true, false, false, false]);
    expect(hourlyTargetAccess(moo, true)).toBe("edit");
    expect(hourlyTargetAccess(gm, true)).toBe("read");
    expect(hourlyTargetAccess(moo, false)).toBe("hidden");
    expect(hourlyTargetAccess(gm, false)).toBe("hidden");
  });
});

describe("the save path", () => {
  it("the MoO sets it with the switch on: saved through the one writer, audited", async () => {
    const s = shop();
    const l = await live(s);
    vi.mocked(audit).mockClear();
    const r = await settings.saveStructure(s.deps, { actor: moo, locationId: A, expectedId: l.id, structure: withHourly(l.value, 16.5) });
    expect(saves(s)).toHaveLength(1);
    expect((saves(s)[0]!.args.p_structure as ScheduleStructure).labor.hourlyTargetPct).toBe(16.5);
    expect(vi.mocked(audit).mock.calls.filter(([a]) => a.action === "schedule.structure_update" && (a.metadata as Record<string, unknown>).after_id === r.afterId)).toHaveLength(1);
    expect((await live(s)).value.labor.hourlyTargetPct).toBe(16.5);
  });
  it("a GM may not change, set or remove it (schedule_forbidden, nothing written), and may still save everything else around it", async () => {
    const s = shop();
    const first = await live(s);
    expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: first.id, structure: withHourly(first.value, 16) }))).toEqual(["schedule_forbidden", null]);
    await settings.saveStructure(s.deps, { actor: moo, locationId: A, expectedId: first.id, structure: withHourly(first.value, 16) });
    const l = await live(s);
    expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: l.id, structure: withHourly(l.value, 17) }))).toEqual(["schedule_forbidden", null]);
    expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: l.id, structure: withHourly(l.value, undefined) }))).toEqual(["schedule_forbidden", null]);
    expect(saves(s)).toHaveLength(1);
    const other = structuredClone(l.value);
    other.labor.budgetDeadbandH = 3;
    expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: l.id, structure: other }))).toBe("ok");
    expect((await live(s)).value.labor).toMatchObject({ hourlyTargetPct: 16, budgetDeadbandH: 3 });
  });
  it("dark: with the switch off nobody changes it (named by key), and a save that leaves it alone is untouched", async () => {
    for (const env of [OFF, { ...ON, FACT_LAYER_LABOR: "0" }]) {
      const s = shop(env);
      const l = await live(s);
      expect(await refusal(settings.saveStructure(s.deps, { actor: moo, locationId: A, expectedId: l.id, structure: withHourly(l.value, 16) }))).toEqual(["structure_invalid", "labor.hourlyTargetPct"]);
      expect(saves(s)).toHaveLength(0);
      expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: l.id, structure: l.value }))).toBe("ok");
    }
  });
  it("the validator names the key before any post: above the labor target, on the hourly basis, zero", () => {
    const base = structuredClone(shopStructure);
    expect(structureSaveRefusal(withHourly(base, 18))).toBeNull();
    expect(structureSaveRefusal(withHourly(base, base.labor.targetPct + 1))).toBe("labor.hourlyTargetPct");
    expect(structureSaveRefusal(withHourly(base, 0))).toBe("labor.hourlyTargetPct");
    expect(structureSaveRefusal({ ...withHourly(base, 18), labor: { ...withHourly(base, 18).labor, basis: "hourly" } })).toBe("labor.hourlyTargetPct");
    expect(structureProblemLine("labor.hourlyTargetPct")).toEqual({ key: "schedule.error.structure_hourly_target", params: {} });
  });
});

let shopStructure: ScheduleStructure;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = (view: Parameters<typeof ScheduleSettings>[0]["view"], language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, catalogWindow: true,
    children: createElement(ScheduleSettings, { view }) as ReactNode }) }));
{
  const s = shop();
  shopStructure = (await live(s)).value;
}

describe("the settings page", () => {
  const field = /<input[^>]*name="labor\.hourlyTargetPct"[^>]*>/;
  async function view(a: PeopleActor, env: Record<string, string>, pct?: number) {
    const s = shop(env);
    if (pct !== undefined) {
      const l = await live(s);
      await settings.saveStructure({ ...s.deps, env: ON }, { actor: moo, locationId: A, expectedId: l.id, structure: withHourly(l.value, pct) });
    }
    const v = await loadScheduleSettings(s.deps, { actor: a, locationId: A });
    if (v.state !== "ready") throw new Error("not ready");
    return v;
  }
  it("the MoO with the switch on gets the field: empty with the 18% placeholder until set, then the saved value", async () => {
    const unset = await view(moo, ON);
    expect(unset.hourlyTarget).toBe("edit");
    const html = render(unset);
    expect(html).toMatch(field);
    expect(html.match(field)![0]).toContain('value=""');
    expect(html.match(field)![0]).toContain('placeholder="18"');
    expect(html.match(field)![0]).toContain("min-h-[44px]");
    expect(text(html)).toContain(en["schedule.settings.labor.hourly_target"]);
    expect(text(html)).toContain(en["schedule.settings.labor.hourly_target_help"].replace("{pct}", "18"));
    expect(render(await view(moo, ON, 16.5)).match(field)![0]).toContain('value="16.5"');
    expect(text(render(unset, "es"))).toContain(es["schedule.settings.labor.hourly_target"]);
  });
  it("a GM with the switch on reads it and has no field; the value read is the one in force", async () => {
    const v = await view(gm, ON, 16.5);
    expect(v.hourlyTarget).toBe("read");
    const html = render(v);
    expect(html).not.toMatch(field);
    expect(text(html)).toContain(en["schedule.settings.labor.hourly_target_read"].replace("{pct}", "16.5"));
    expect(text(render(await view(gm, ON)))).toContain(en["schedule.settings.labor.hourly_target_read"].replace("{pct}", "18"));
  });
  it("dark: with the switch off nobody sees the field or the line", async () => {
    for (const a of [moo, gm]) {
      const v = await view(a, OFF, 16.5);
      expect(v.hourlyTarget).toBe("hidden");
      const html = render(v);
      expect(html).not.toMatch(field);
      expect(text(html)).not.toContain("Pure hourly target");
    }
  });
  it("the editor drops the key when the basis becomes hourly, and never writes it unless the person typed a value", () => {
    const src = readFileSync("components/schedule/StructureEditor.tsx", "utf8");
    expect(src).toContain('if (s.labor.basis === "hourly") delete s.labor.hourlyTargetPct;');
    expect(src).toContain("if (v === null) delete s.labor.hourlyTargetPct; else s.labor.hourlyTargetPct = v;");
    expect(src).toContain('requestStepUp("E")');
  });
});
