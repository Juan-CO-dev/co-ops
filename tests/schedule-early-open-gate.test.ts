/**
 * PR SCH-2 (plan r5 20.7, ruling D7): THE READINESS GATE before any earlier-opening mode write.
 * The code may merge before Juan authorizes 0354. Until 0354's sentinel (`schedule_structure_features()`) answers:
 *  - the mode select is not rendered (the settings view says `hidden`);
 *  - a structure save carrying `catering.earlyOpenMode` (any value, manual included) is refused `feature_not_ready`
 *    BEFORE any write (no `save_schedule_structure` call), and a save without the key takes today's path;
 *  - the sentinel read: "function not found" = not ready; any other error, a throw or a malformed answer = not ready
 *    (one log line); a yes is cached 10 minutes, a no 60 seconds; per service client.
 * After the apply (the fake store's sentinel answers) the select shows to GM own / MoO+ and a mode saves. The SQL
 * backstop (0346's CHECK and writer refuse the key before the apply) is scripts/sql-harness-0354.mjs S1.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const settings = await import("@/lib/scheduling/settings");
const { loadScheduleSettings } = await import("@/lib/scheduling/settings-view");
const { loadSchedulingInputs } = await import("@/lib/scheduling/inputs");
const { ScheduleSettings } = await import("@/components/schedule/ScheduleSettings");
const { ScheduleError, scheduleErrorStatus } = await import("@/lib/scheduling/errors-shared");
import { FEATURE_NO_TTL_MS, FEATURE_YES_TTL_MS, earlyOpenReady, scheduleFeatures } from "@/lib/scheduling/schedule-features";
import { EARLY_OPEN_I18N_KEYS, earlyOpenAccess } from "@/lib/scheduling/settings-view-shared";
import type { PeopleActor } from "@/lib/people/access-shared";
import type { EarlyOpenMode, ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { A, AGM, GM, MOO, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z");
const WEEK = "2026-10-26";
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const moo = actor(MOO, "moo", 8, []);
const agm = actor(AGM, "agm", 6, [A]);
const otherGm = actor(GM, "gm", 7, ["00000000-0000-4000-8000-00000000beef"]);
function shop(features?: string[]) {
  const s = scheduleStore(shopTables(), features ? { features } : {});
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId } };
}
type Shop = ReturnType<typeof shop>;
const refusal = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ScheduleError ? [e.code, e.key ?? null] : `throw:${(e as Error).message}`; } };
const saves = (s: Shop) => s.calls.filter((c) => c.fn === "save_schedule_structure");
const sentinelReads = (s: Shop) => s.calls.filter((c) => c.fn === "schedule_structure_features");
async function live(s: Shop) {
  const i = await loadSchedulingInputs(s.client, { locationId: A, weekStarts: [WEEK], now: NOW });
  return { id: i.structure.id, value: structuredClone(i.structure.structure) as ScheduleStructure };
}
const withMode = (v: ScheduleStructure, mode: unknown): ScheduleStructure => {
  const n = structuredClone(v);
  if (mode === undefined) delete n.catering.earlyOpenMode; else (n.catering as Record<string, unknown>).earlyOpenMode = mode;
  return n;
};

/** A client whose sentinel read answers `answer` (a thrown error when it is an Error). */
function sentinelClient(answer: () => { data: unknown; error: { code?: string; message: string } | null } | Error): SupabaseClient & { reads: number } {
  const c = {
    reads: 0,
    rpc(fn: string) {
      if (fn !== "schedule_structure_features") throw new Error(`unexpected rpc ${fn}`);
      c.reads++;
      const a = answer();
      const p = a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
      return Object.assign(p, { abortSignal: () => p });
    },
  };
  return c as unknown as SupabaseClient & { reads: number };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the sentinel read (scheduleFeatures)", () => {
  it("function not found (PGRST202 / 42883 / the message) = not ready, silently; the answer = ready", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const error of [{ code: "PGRST202", message: "x" }, { code: "42883", message: "x" }, { message: "Could not find the function public.schedule_structure_features" }]) {
      expect(await earlyOpenReady(sentinelClient(() => ({ data: null, error })))).toBe(false);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(await scheduleFeatures(sentinelClient(() => ({ data: ["early_open_mode"], error: null })))).toEqual(["early_open_mode"]);
    expect(await scheduleFeatures(sentinelClient(() => ({ data: ["early_open_mode", "a_future_feature"], error: null })))).toEqual(["early_open_mode"]);
  });
  it("any other error, a throw, a timeout or a malformed answer = not ready, with one log line naming no content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const answers = [() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }),
      () => new Error("network down"), () => ({ data: "early_open_mode", error: null }), () => ({ data: null, error: null }), () => ({ data: [], error: null })];
    for (const a of answers) expect(await earlyOpenReady(sentinelClient(a))).toBe(false);
    expect(warn.mock.calls.length).toBe(4); // an empty list is a well-formed "nothing installed" and logs nothing
    for (const [line] of warn.mock.calls) expect(String(line)).not.toMatch(/network down|canceling statement/);
  });
  it("a yes is cached for 10 minutes; a no is re-checked after 60 seconds, so an apply is picked up within a minute", async () => {
    let applied = false;
    const c = sentinelClient(() => (applied ? { data: ["early_open_mode"], error: null } : { data: null, error: { code: "PGRST202", message: "x" } }));
    const t0 = 1_000_000;
    expect(await earlyOpenReady(c, { now: t0 })).toBe(false);
    applied = true;
    expect(await earlyOpenReady(c, { now: t0 + FEATURE_NO_TTL_MS - 1 })).toBe(false);
    expect(c.reads).toBe(1);
    expect(await earlyOpenReady(c, { now: t0 + FEATURE_NO_TTL_MS })).toBe(true);
    expect(c.reads).toBe(2);
    expect(await earlyOpenReady(c, { now: t0 + FEATURE_NO_TTL_MS + FEATURE_YES_TTL_MS - 1 })).toBe(true);
    expect(c.reads).toBe(2);
    expect(FEATURE_YES_TTL_MS).toBe(600_000);
    expect(FEATURE_NO_TTL_MS).toBe(60_000);
  });
  it("the cache is per service client", async () => {
    const yes = sentinelClient(() => ({ data: ["early_open_mode"], error: null }));
    const no = sentinelClient(() => ({ data: null, error: { code: "PGRST202", message: "x" } }));
    expect([await earlyOpenReady(yes), await earlyOpenReady(no), await earlyOpenReady(yes)]).toEqual([true, false, true]);
    expect([yes.reads, no.reads]).toEqual([1, 1]);
  });
});

describe("the save path: no mode is written before 0354", () => {
  it("before the apply: a structure carrying the key is refused feature_not_ready (503), every value incl. manual, and nothing is written", async () => {
    for (const mode of ["manual", "semi", "auto"] as EarlyOpenMode[]) {
      for (const who of [gm, moo]) {
        const s = shop();
        const l = await live(s);
        expect(await refusal(settings.saveStructure(s.deps, { actor: who, locationId: A, expectedId: l.id, structure: withMode(l.value, mode) })))
          .toEqual(["feature_not_ready", "catering.earlyOpenMode"]);
        expect(saves(s)).toHaveLength(0);
      }
    }
    expect(scheduleErrorStatus("feature_not_ready")).toBe(503);
  });
  it("before the apply: a save WITHOUT the key takes today's path (one write) and never reads the sentinel", async () => {
    const s = shop();
    const l = await live(s);
    const other = structuredClone(l.value);
    other.catering.leadMinutes = 240;
    expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: l.id, structure: other }))).toBe("ok");
    expect(saves(s)).toHaveLength(1);
    expect(sentinelReads(s)).toHaveLength(0);
    expect("earlyOpenMode" in (saves(s)[0]!.args.p_structure as ScheduleStructure).catering).toBe(false);
  });
  it("the validator runs first: an invalid value is structure_invalid (named), ready or not, and never reads the sentinel", async () => {
    for (const features of [undefined, ["early_open_mode"]]) {
      const s = shop(features);
      const l = await live(s);
      for (const bad of ["Auto", "", null, 1, {}]) {
        expect(await refusal(settings.saveStructure(s.deps, { actor: gm, locationId: A, expectedId: l.id, structure: withMode(l.value, bad) })))
          .toEqual(["structure_invalid", "catering.earlyOpenMode"]);
      }
      expect(saves(s)).toHaveLength(0);
      expect(sentinelReads(s)).toHaveLength(0);
    }
  });
  it("the permission gate comes before everything: an AGM, or a GM of another shop, is refused with no read", async () => {
    for (const who of [agm, otherGm]) {
      const s = shop(["early_open_mode"]);
      const l = await live(s);
      const r = await refusal(settings.saveStructure(s.deps, { actor: who, locationId: A, expectedId: l.id, structure: withMode(l.value, "auto") }));
      expect(Array.isArray(r) && ["schedule_forbidden", "shop_not_allowed"].includes(r[0] as string)).toBe(true);
      expect(sentinelReads(s)).toHaveLength(0);
      expect(saves(s)).toHaveLength(0);
    }
  });
  it("after the apply: GM own and MoO+ save each mode through the one writer; choosing manual again is saving without the key", async () => {
    for (const who of [gm, moo]) {
      const s = shop(["early_open_mode"]);
      for (const mode of ["semi", "auto", undefined] as Array<EarlyOpenMode | undefined>) {
        const l = await live(s);
        expect(await refusal(settings.saveStructure(s.deps, { actor: who, locationId: A, expectedId: l.id, structure: withMode(l.value, mode) }))).toBe("ok");
        expect((await live(s)).value.catering.earlyOpenMode).toBe(mode);
      }
      expect(saves(s)).toHaveLength(3);
    }
  });
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = (view: Parameters<typeof ScheduleSettings>[0]["view"], language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, catalogWindow: true,
    children: createElement(ScheduleSettings, { view }) as ReactNode }) }));
const select = /<select[^>]*name="catering\.earlyOpenMode"[^>]*>[\s\S]*?<\/select>/;

describe("the settings page", () => {
  async function view(a: PeopleActor, features?: string[], mode?: EarlyOpenMode) {
    const s = shop(features);
    if (mode) {
      const l = await live(s);
      await settings.saveStructure(s.deps, { actor: moo, locationId: A, expectedId: l.id, structure: withMode(l.value, mode) });
    }
    const v = await loadScheduleSettings(s.deps, { actor: a, locationId: A });
    if (v.state !== "ready") throw new Error("not ready");
    return { v, s };
  }
  it("before the apply the select is not rendered, for the GM and the MoO", async () => {
    for (const a of [gm, moo]) {
      const { v } = await view(a);
      expect(v.earlyOpen).toBe("hidden");
      const html = render(v);
      expect(html).not.toMatch(select);
      expect(text(html)).not.toContain(en["schedule.settings.catering.early_open_mode"]);
    }
  });
  it("after the apply GM own and MoO+ get the select: three modes, absent shows Manual, the help line follows the mode (en and es)", async () => {
    for (const a of [gm, moo]) {
      const { v } = await view(a, ["early_open_mode"]);
      expect(v.earlyOpen).toBe("edit");
      const html = render(v);
      const sel = html.match(select)![0];
      expect([...sel.matchAll(/<option[^>]*value="([^"]+)"/g)].map((m) => m[1])).toEqual(["manual", "semi", "auto"]);
      expect(sel).toMatch(/<option[^>]*value="manual"[^>]*selected/);
      expect(text(html)).toContain(en["schedule.settings.catering.early_open_mode_manual_help"]);
      expect(text(render(v, "es"))).toContain(es["schedule.settings.catering.early_open_mode"]);
    }
    const { v } = await view(gm, ["early_open_mode"], "semi");
    expect(render(v).match(select)![0]).toMatch(/<option[^>]*value="semi"[^>]*selected/);
    expect(text(render(v))).toContain(en["schedule.settings.catering.early_open_mode_semi_help"]);
  });
  it("an AGM (no structure) never gets it and the page makes no sentinel read", async () => {
    const { v, s } = await view(agm, ["early_open_mode"]);
    expect(v.structure).toBeNull();
    expect(v.earlyOpen).toBe("hidden");
    expect(sentinelReads(s)).toHaveLength(0);
    expect(render(v)).not.toMatch(select);
  });
  it("the access rule and every string (en + es, distinct)", () => {
    expect([earlyOpenAccess(true, true), earlyOpenAccess(true, false), earlyOpenAccess(false, true), earlyOpenAccess(false, false)]).toEqual(["edit", "hidden", "hidden", "hidden"]);
    for (const k of EARLY_OPEN_I18N_KEYS) {
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((es as Record<string, string>)[k], k).toBeTruthy();
      expect((es as Record<string, string>)[k], k).not.toBe((en as Record<string, string>)[k]);
    }
  });
});
