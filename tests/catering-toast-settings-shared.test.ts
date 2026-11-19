/** Item 21 PR 5: the pure rules of the settings card and of "match the old orders". */
import { describe, expect, it } from "vitest";
import {
  canManageCateringToastSettings, DEFAULT_CATERING_TOAST_SETTINGS as OFF, fromSettingsRow, parseSettingsSave, sameSettings, SETTINGS_ERRORS, settingsErrorKey,
  settingsRefusal, toSettingsRow, type CateringToastSettingsValues,
} from "@/lib/catering/catering-toast-settings-shared";
import { oldOrderMatches, oldOrdersView, OLD_ORDER_SKIPS, OLD_ORDERS_SAMPLE, parseOldOrdersLink, type PairHead } from "@/lib/catering/catering-toast-old-orders-shared";
import type { CateringToastPlanRow, HouseStatusRow } from "@/lib/catering/catering-toast-shared";
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
    for (const reason of OLD_ORDER_SKIPS) for (const dict of [en, es] as Array<Record<string, string>>) expect(typeof dict[`admin.catering.toast.old.skipped.${reason}`]).toBe("string");
  });
  it("every admin.catering.toast key exists in both languages with the same placeholders", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("admin.catering.toast.") || k === "admin.catering.hub.toast");
    expect(keys.length).toBeGreaterThan(60);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    for (const key of keys) expect([key, holes((es as Record<string, string>)[key] ?? "missing")]).toEqual([key, holes((en as Record<string, string>)[key]!)]);
    expect(Object.keys(es).filter((k) => k.startsWith("admin.catering.toast.")).length).toBe(keys.length - 1);
  });
});

const status = (lead_id: string, event_date: string, o: Partial<HouseStatusRow> = {}): HouseStatusRow =>
  ({ lead_id, location_id: SHOP, event_date, lead_source: "toast_catering", ring_code: null, headcount: null, value_cents: 10000, toast_origin: true, status: "not_rung_in_toast", ...o });
const plan = (lead_id: string, order_guid: string, check_guid: string, business_date: string, o: Partial<CateringToastPlanRow> = {}): CateringToastPlanRow =>
  ({ lead_id, location_id: SHOP, order_guid, check_guid, toast_snapshot_id: "s", business_date, evidence: "toast_origin", check_total_cents: 10000, lead_value_cents: 10000,
    amount_diff_cents: 0, amount_mismatch: false, dual_code: false, owner: null, owner_lead_id: null, blocked: false, ...o });

describe("oldOrderMatches: only what the system is sure about", () => {
  it("strong, linkable, undisputed checks are matches; everything else is counted by reason", () => {
    const heads: PairHead[] = [{ id: "h1", lead_id: "a", kind: "link", location_id: SHOP, order_guid: "A", check_guid: "A1" }, { id: "hx", lead_id: "a", kind: "no_ring_expected", location_id: null, order_guid: null, check_guid: null }];
    const m = oldOrderMatches({
      status: [status("a", "2026-10-10"), status("b", "2026-10-11"), status("c", "2026-10-12"), status("d", "2026-10-13"), status("e", "2026-10-14"), status("f", "2026-10-15"),
        status("g", "2026-10-16", { status: "matched" }), status("h", "2026-10-17"), status("i", "2026-10-17")],
      plan: [
        plan("a", "A", "A1", "2026-10-10"), plan("a", "A", "A2", "2026-10-10", { amount_mismatch: true }),
        plan("b", "B", "B1", "2026-10-11", { evidence: "amount_date" }),
        plan("c", "C", "C1", "2026-10-12", { blocked: true }),
        plan("d", "D", "D1", "2026-10-13", { owner: "ezcater" }), plan("d", "D", "D2", "2026-10-13", { owner: "house", owner_lead_id: "zz" }),
        plan("e", "E", "E1", "2026-10-14", { dual_code: true, evidence: "ring_code" }),
        plan("f", "F", "F1", "2026-10-30"),
        plan("g", "G", "G1", "2026-10-16"),
        plan("h", "H", "H1", "2026-10-17", { evidence: "ring_code" }), plan("i", "H", "H1", "2026-10-17", { evidence: "ring_code" }),
      ],
      heads,
    });
    expect(m.orders).toBe(8);
    expect(m.matches.map((x) => [x.leadId, x.checkGuid, x.evidence, x.expectedHeadId, x.amountMismatch])).toEqual([["a", "A1", "toast_origin", "h1", false], ["a", "A2", "toast_origin", null, true]]);
    expect(m.ordersMatched).toBe(1);
    expect(m.skipped).toEqual({ blocked: 1, owned: 2, dual_code: 1, out_of_window: 1, two_orders: 2 });
  });
  it("the day-before to a-week-after window is the writer's", () => {
    const edge = (date: string) => oldOrderMatches({ status: [status("a", "2026-10-10")], plan: [plan("a", "A", "A1", date)], heads: [] }).matches.length;
    expect([edge("2026-10-08"), edge("2026-10-09"), edge("2026-10-17"), edge("2026-10-18")]).toEqual([0, 1, 1, 0]);
  });
  it("the view shows counts and a bounded sample, never more", () => {
    const many = Array.from({ length: OLD_ORDERS_SAMPLE + 5 }, (_, i) => `l${String(i).padStart(2, "0")}`);
    const v = oldOrdersView(oldOrderMatches({ status: many.map((l) => status(l, "2026-10-10")), plan: many.map((l) => plan(l, `O${l}`, "c", "2026-10-10")), heads: [] }));
    expect([v.state, v.orders, v.ordersMatched, v.checks, v.sample.length]).toEqual(["ready", OLD_ORDERS_SAMPLE + 5, OLD_ORDERS_SAMPLE + 5, OLD_ORDERS_SAMPLE + 5, OLD_ORDERS_SAMPLE]);
    expect(Object.keys(v.sample[0]!).sort()).toEqual(["amountMismatch", "businessDate", "checkGuid", "checkTotalCents", "eventDate", "evidence", "leadId", "valueCents"]);
  });
  it("parseOldOrdersLink: exactly the shop and the skip count", () => {
    expect(parseOldOrdersLink({ locationId: SHOP, skip: 0 })).toEqual({ locationId: SHOP, skip: 0 });
    for (const bad of [null, {}, { locationId: SHOP }, { locationId: SHOP, skip: -1 }, { locationId: SHOP, skip: 1.5 }, { locationId: SHOP, skip: 5001 }, { locationId: "x", skip: 0 },
      { locationId: SHOP, skip: 0, pairs: [] }]) expect(parseOldOrdersLink(bad)).toBeNull();
  });
});
