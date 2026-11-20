/** Item 21 PR 5: the pure rules of the settings card and of "match the older orders". */
import { describe, expect, it } from "vitest";
import {
  canManageCateringToastSettings, DEFAULT_CATERING_TOAST_SETTINGS as OFF, fromSettingsRow, parseSettingsSave, sameSettings, SETTINGS_ERRORS, settingsErrorKey,
  settingsRefusal, toSettingsRow, type CateringToastSettingsValues,
} from "@/lib/catering/catering-toast-settings-shared";
import { addDays, backfillSkips, backfillWindow, BACKFILL_SKIPS, BACKFILL_WINDOW_DAYS, nextCursor, parseBackfillStep, realDate, runBackfillLoop, type BackfillPost, type BackfillRun, type BackfillStep } from "@/lib/catering/catering-toast-backfill-shared";
import { readFileSync } from "node:fs";
import { ROLES, type RoleCode } from "@/lib/roles";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const SHOP = "00000000-0000-4000-8000-000000000001";
const ON: CateringToastSettingsValues = { ...OFF, enabled: true };
const READY = { linkStep: true, automatic: true };

describe("who", () => {
  it("Owner, CGS and MoO by role; nobody else, whatever their level", () => {
    const allowed = (Object.keys(ROLES) as RoleCode[]).filter(canManageCateringToastSettings).sort();
    expect(allowed).toEqual(["cgs", "moo", "owner"]);
    for (const role of ["gm", "catering_mgr", "agm", "social_media_mgr", "employee"] as RoleCode[]) expect([role, canManageCateringToastSettings(role)]).toEqual([role, false]);
  });
});

describe("settingsRefusal: the writer's dependencies, in its order", () => {
  it("a row that may be saved", () => {
    expect(settingsRefusal(OFF, { linkStep: false, automatic: false })).toBeNull();
    expect(settingsRefusal(ON, { linkStep: true, automatic: false })).toBeNull();
    expect(settingsRefusal({ ...ON, ringCodeEnabled: true, autoLinkEnabled: true, originAutoLinkEnabled: true, includeToastOriginLeads: true, autoLinkFromDate: "2026-11-19" }, READY)).toBeNull();
  });
  it("each refusal, and which one wins when several apply", () => {
    expect(settingsRefusal({ ...OFF, ringCodeEnabled: true }, READY)).toBe("switch_needs_enabled");
    expect(settingsRefusal({ ...OFF, includeToastOriginLeads: true }, READY)).toBe("switch_needs_enabled");
    expect(settingsRefusal({ ...ON, autoLinkEnabled: true }, READY)).toBe("auto_needs_start_date");
    expect(settingsRefusal({ ...ON, originAutoLinkEnabled: true }, READY)).toBe("auto_needs_start_date");
    expect(settingsRefusal({ ...ON, includeToastOriginLeads: true }, READY)).toBe("origin_listing_needs_origin_link");
    expect(settingsRefusal(ON, { linkStep: false, automatic: true })).toBe("link_step_not_installed");
    expect(settingsRefusal({ ...ON, ringCodeEnabled: true }, { linkStep: true, automatic: false })).toBe("automatic_not_installed");
    expect(settingsRefusal({ ...ON, autoLinkEnabled: true, autoLinkFromDate: "2026-11-19" }, { linkStep: false, automatic: false })).toBe("link_step_not_installed");
    expect(settingsRefusal({ ...OFF, autoLinkEnabled: true }, { linkStep: false, automatic: false })).toBe("switch_needs_enabled");
  });
});

describe("parseSettingsSave: strict", () => {
  const values = { ...ON };
  const good = { locationId: SHOP, values, expectedUpdatedAt: null };
  it("accepts the whole row and normalizes nothing but the shop id's case", () => {
    expect(parseSettingsSave({ ...good, locationId: SHOP.toUpperCase() })).toEqual({ locationId: SHOP, values, expectedUpdatedAt: null });
    expect(parseSettingsSave({ ...good, expectedUpdatedAt: "2026-11-19T12:00:00.123456+00:00", values: { ...values, autoLinkFromDate: "2026-11-19", tolerancePct: 0.125, toleranceCents: 0 } })?.values.tolerancePct).toBe(0.125);
  });
  it("refuses anything else", () => {
    const bad: unknown[] = [null, [], "x", { ...good, extra: 1 }, { ...good, locationId: "shop" }, { ...good, expectedUpdatedAt: "yesterday" }, { ...good, expectedUpdatedAt: 5 },
      { ...good, values: null }, { ...good, values: { ...values, note: "text" } }, { ...good, values: { enabled: true } }, { ...good, values: { ...values, enabled: "true" } },
      { ...good, values: { ...values, toleranceCents: 12.5 } }, { ...good, values: { ...values, toleranceCents: -1 } }, { ...good, values: { ...values, toleranceCents: 100_001 } },
      { ...good, values: { ...values, tolerancePct: 1.5 } }, { ...good, values: { ...values, tolerancePct: 0.1234 } }, { ...good, values: { ...values, tolerancePct: Number.NaN } },
      { ...good, values: { ...values, autoLinkFromDate: "2026-02-30" } }, { ...good, values: { ...values, autoLinkFromDate: "11/19/2026" } }, { ...good, values: { ...values, autoLinkFromDate: 20261119 } }];
    for (const body of bad) expect([JSON.stringify(body), parseSettingsSave(body)]).toEqual([JSON.stringify(body), null]);
  });
  it("review PORTAL5-r1: a date that looks like one and is not is REFUSED, never thrown (no month 13, no day 32, no February 30)", () => {
    for (const date of ["2026-13-01", "2026-00-10", "2026-01-32", "2026-01-00", "2026-02-30", "2025-02-29", "0000-00-00", "9999-99-99"]) {
      expect(() => parseSettingsSave({ ...good, values: { ...values, autoLinkFromDate: date } })).not.toThrow();
      expect([date, parseSettingsSave({ ...good, values: { ...values, autoLinkFromDate: date } })]).toEqual([date, null]);
      expect([date, realDate(date)]).toEqual([date, false]);
      expect(parseBackfillStep({ locationId: SHOP, cursor: date })).toBeNull();
    }
    expect(realDate("2024-02-29")).toBe(true);
    expect(parseSettingsSave({ ...good, values: { ...values, autoLinkFromDate: "2024-02-29" } })?.values.autoLinkFromDate).toBe("2024-02-29");
  });
  it("round-trips the database row", () => {
    const v = { ...ON, tolerancePct: 0.2, autoLinkFromDate: "2026-11-19" };
    expect(fromSettingsRow({ ...toSettingsRow(v), tolerance_pct: "0.200" })).toEqual(v);
    expect(sameSettings(v, { ...v })).toBe(true);
    expect(sameSettings(v, { ...v, autoLinkFromDate: null })).toBe(false);
  });
});

describe("messages", () => {
  it("every refusal has an en + es message; an unknown code is generic", () => {
    for (const code of [...SETTINGS_ERRORS, "generic"]) {
      for (const dict of [en, es] as Array<Record<string, string>>) expect([code, typeof dict[settingsErrorKey(code)]]).toEqual([code, "string"]);
    }
    expect(settingsErrorKey("nope")).toBe("admin.catering.toast.error.generic");
    expect(settingsErrorKey(undefined)).toBe("admin.catering.toast.error.generic");
    for (const reason of BACKFILL_SKIPS) for (const dict of [en, es] as Array<Record<string, string>>) expect([reason, typeof dict[`admin.catering.toast.backfill.skipped.${reason}`]]).toEqual([reason, "string"]);
  });
  it("every admin.catering.toast key exists in both languages with the same placeholders", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("admin.catering.toast.") || k === "admin.catering.hub.toast");
    expect(keys.length).toBeGreaterThan(60);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    for (const key of keys) expect([key, holes((es as Record<string, string>)[key] ?? "missing")]).toEqual([key, holes((en as Record<string, string>)[key]!)]);
    expect(Object.keys(es).filter((k) => k.startsWith("admin.catering.toast.")).length).toBe(keys.length - 1);
  });
});

describe("the backfill: stretches of dates, never offsets", () => {
  it("a stretch starts at the first unmatched event on or after the cursor, runs at most 60 days and never past today", () => {
    const dates = ["2025-10-06", "2025-10-20", "2026-01-15", "2026-11-18", "2026-12-25"];
    expect(backfillWindow(dates, "2025-01-01", "2026-11-19")).toEqual({ from: "2025-10-06", to: addDays("2025-10-06", BACKFILL_WINDOW_DAYS) });
    expect(backfillWindow(dates, "2025-10-07", "2026-11-19")).toEqual({ from: "2025-10-20", to: "2025-12-19" });
    expect(backfillWindow(dates, "2026-11-01", "2026-11-19")).toEqual({ from: "2026-11-18", to: "2026-11-19" });
    // An event after today is not rung yet: it is not the backfill's.
    expect(backfillWindow(dates, "2026-11-19", "2026-11-19")).toBeNull();
    expect(backfillWindow([], "2025-01-01", "2026-11-19")).toBeNull();
  });
  it("the next cursor is the day after the stretch; the last stretch (through today) ends the run", () => {
    expect(nextCursor({ to: "2025-12-05" }, "2026-11-19")).toBe("2025-12-06");
    expect(nextCursor({ to: "2026-11-19" }, "2026-11-19")).toBeNull();
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // a DST day is still one day
  });
  it("review PORTAL5-r1: walking the stretches visits every unmatched order exactly once, even when the list changes between steps", () => {
    const today = "2026-11-19";
    let unmatched = ["2025-10-06", "2025-11-01", "2025-12-30", "2026-03-03", "2026-03-04", "2026-11-10"];
    const visited: string[] = [];
    for (let cursor: string | null = "2025-01-01", guard = 0; cursor !== null && guard < 50; guard += 1) {
      const window = backfillWindow(unmatched, cursor, today);
      if (!window) break;
      visited.push(...unmatched.filter((d) => d >= window.from && d <= window.to));
      // Between two steps: every order of the stretch is linked (leaves the list) and someone else links a later one.
      unmatched = unmatched.filter((d) => d > window.to && d !== "2026-03-03");
      cursor = nextCursor(window, today);
    }
    expect(visited).toEqual(["2025-10-06", "2025-11-01", "2025-12-30", "2026-03-04", "2026-11-10"]);
  });
  it("parseBackfillStep: exactly the shop and a date cursor (or null to start)", () => {
    expect(parseBackfillStep({ locationId: SHOP, cursor: null })).toEqual({ locationId: SHOP, cursor: null });
    expect(parseBackfillStep({ locationId: SHOP.toUpperCase(), cursor: "2026-01-15" })).toEqual({ locationId: SHOP, cursor: "2026-01-15" });
    for (const bad of [null, [], {}, { locationId: SHOP }, { locationId: SHOP, cursor: 3 }, { locationId: SHOP, cursor: "soon" }, { locationId: "x", cursor: null },
      { locationId: SHOP, cursor: null, pairs: [] }, { locationId: SHOP, skip: 0 }]) expect(parseBackfillStep(bad)).toBeNull();
  });
  it("the reasons are the reconciler's own, in its order (0348), and only its counts are kept", () => {
    const sql = readFileSync("supabase/migrations/0348_catering_toast_reconciler.sql", "utf8").replace(/\r\n/g, "\n");
    const house = sql.match(/create function public\.reconcile_catering_toast\([\s\S]*?\nend \$\$;/)![0];
    const reasons = [...house.slice(house.indexOf("v_reason := case"), house.indexOf("else null end;")).matchAll(/then '(\w+)'/g)].map((m) => m[1]!);
    expect([...new Set(reasons)]).toEqual([...BACKFILL_SKIPS]);
    expect(backfillSkips({ owned: 2, evidence_pending: 1, dual_code: 0, bogus: 9, blocked: 1.5, switch_off: "3" })).toEqual({ owned: 2, evidence_pending: 1 });
    expect(backfillSkips("off")).toEqual({});
    expect(backfillSkips(null)).toEqual({});
  });
});

describe("review PORTAL5-r2: the run loop returns how it ended, and a failure after a success keeps both", () => {
  const step = (o: Partial<BackfillStep>): BackfillStep => ({ phase: "linked", from: "2025-10-06", to: "2025-12-05", examined: 0, pendingOrders: 0, added: 0, ringCode: 0, toastOrigin: 0, skipped: {}, next: null, ...o });
  const script = (answers: Array<Awaited<ReturnType<BackfillPost>>>) => {
    const cursors: Array<string | null> = [];
    const post: BackfillPost = async (cursor) => { cursors.push(cursor); return answers.shift() ?? { ok: false, code: "generic" }; };
    return { post, cursors };
  };

  it("a successful step, then a failed POST: not finished, the failure's code, and what was linked before it", async () => {
    const { post, cursors } = script([{ ok: true, step: step({ added: 61, skipped: { owned: 2 }, next: "2025-12-06" }) }, { ok: false, code: "settings_unavailable" }]);
    const seen: BackfillRun[] = [];
    const run = await runBackfillLoop(post, (r) => seen.push(r));
    expect(run).toEqual({ phase: "linked", added: 61, pending: 0, skipped: { owned: 2 }, finished: false, error: "settings_unavailable" });
    expect(cursors).toEqual([null, "2025-12-06"]);
    expect(seen).toHaveLength(1);
  });

  it("checking steps repeat their own stretch; the totals add up; only a null next finishes", async () => {
    const { post, cursors } = script([
      { ok: true, step: step({ phase: "checking", examined: 15, pendingOrders: 25, next: "2025-10-06" }) },
      { ok: true, step: step({ added: 3, skipped: { evidence_pending: 1, dual_code: 2 }, next: "2025-12-06" }) },
      { ok: true, step: step({ phase: "done", added: 4, skipped: { dual_code: 1 }, next: null }) }]);
    expect(await runBackfillLoop(post)).toEqual({ phase: "done", added: 7, pending: 0, skipped: { evidence_pending: 1, dual_code: 3 }, finished: true, error: null });
    expect(cursors).toEqual([null, "2025-10-06", "2025-12-06"]);
  });

  it("a failure on the very first step, and a loop that never ends, both stop with a name", async () => {
    expect(await runBackfillLoop(script([{ ok: false, code: "backfill_timeout" }]).post)).toMatchObject({ finished: false, error: "backfill_timeout", added: 0 });
    const forever: BackfillPost = async () => ({ ok: true, step: step({ phase: "checking", examined: 1, pendingOrders: 9, next: "2025-10-06" }) });
    expect(await runBackfillLoop(forever, () => {}, 5)).toMatchObject({ finished: false, error: "backfill_stopped" });
    for (const code of ["backfill_timeout", "backfill_stopped"]) for (const dict of [en, es] as Array<Record<string, string>>) expect(typeof dict[settingsErrorKey(code)]).toBe("string");
  });
});
