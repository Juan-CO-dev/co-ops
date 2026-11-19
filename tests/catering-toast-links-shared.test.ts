/**
 * Item 21 PR 3: the pure rules of the LINK step (lib/catering/catering-toast-links-shared.ts).
 * Who decides (Juan answer 8: catering manager + GM and up; a GM at a shop they belong to), what a request may say,
 * how a refusal is named (en + es), and how the panel orders and labels a lead's candidate checks.
 */
import { describe, expect, it } from "vitest";
import {
  buildHouseToastPanel, candidateActions, endedActions, linkRefusal, canDecideCateringToast, decisionErrorKey, parseToastDecision, TOAST_DECISION_ERRORS,
  TOAST_DECISION_KINDS, TOAST_NO_RING_REASONS,
} from "@/lib/catering/catering-toast-links-shared";
import type { CateringToastPlanRow } from "@/lib/catering/catering-toast-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEAD = U(1), SHOP = U(2), OTHER = U(3);

describe("who may decide (Juan answer 8)", () => {
  const actor = (role: string, locations: string[] = [], active = true) => ({ role, locations, active }) as never;
  it.each([
    ["catering_mgr", [], true], ["gm", [SHOP], true], ["gm", [OTHER], false], ["moo", [], true], ["owner", [], true], ["cgs", [], true],
    ["agm", [SHOP], false], ["prep_mgr", [SHOP], false], ["social_media_mgr", [SHOP], false], ["shift_lead", [SHOP], false], ["employee", [SHOP], false],
  ])("%s at %j -> %s", (role, locations, ok) => {
    expect(canDecideCateringToast(actor(role, locations as string[]), SHOP)).toBe(ok);
  });
  it("an inactive actor never decides; a lead with no shop is nobody's", () => {
    expect(canDecideCateringToast(actor("owner", [], false), SHOP)).toBe(false);
    expect(canDecideCateringToast(actor("owner"), null)).toBe(false);
  });
});

describe("parseToastDecision", () => {
  it("accepts each kind with exactly its key", () => {
    expect(parseToastDecision({ kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c", expectedHeadId: null }))
      .toEqual({ kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c", reasonCode: null, expectedHeadId: null });
    expect(parseToastDecision({ kind: "no_ring_expected", reasonCode: "paid_outside_toast", expectedHeadId: U(9) }))
      .toEqual({ kind: "no_ring_expected", locationId: null, orderGuid: null, checkGuid: null, reasonCode: "paid_outside_toast", expectedHeadId: U(9) });
    expect(parseToastDecision({ kind: "ring_expected", expectedHeadId: U(9) })?.kind).toBe("ring_expected");
  });
  it.each([
    null, [], {}, { kind: "delete" },
    { kind: "link", locationId: SHOP, orderGuid: "o", expectedHeadId: null },
    { kind: "link", locationId: "not-a-uuid", orderGuid: "o", checkGuid: "c", expectedHeadId: null },
    { kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c" },
    { kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c", expectedHeadId: null, reasonCode: "comped" },
    { kind: "no_ring_expected", expectedHeadId: null },
    { kind: "no_ring_expected", reasonCode: "because I said so", expectedHeadId: null },
    { kind: "ring_expected", locationId: SHOP, expectedHeadId: null },
    { kind: "unlink", locationId: SHOP, orderGuid: "x".repeat(201), checkGuid: "c", expectedHeadId: null },
    { kind: "link", locationId: SHOP, orderGuid: "o", checkGuid: "c", expectedHeadId: "nope" },
  ])("refuses %j", (body) => {
    expect(parseToastDecision(body)).toBeNull();
  });
  it("the vocabularies are the database's", () => {
    expect(TOAST_DECISION_KINDS).toEqual(["link", "unlink", "not_a_match", "no_ring_expected", "ring_expected"]);
    expect(TOAST_NO_RING_REASONS).toEqual(["paid_outside_toast", "cancelled", "comped", "duplicate_lead", "other"]);
  });
});

describe("refusals are named, en + es", () => {
  it("every refusal has a message in both languages; an unknown one is generic", () => {
    // The dictionaries are flat (one dotted key per string).
    const e = en as Record<string, string>, s = es as Record<string, string>;
    for (const code of TOAST_DECISION_ERRORS) {
      const key = decisionErrorKey(code);
      expect([code, key in e && key in s]).toEqual([code, true]);
    }
    expect(decisionErrorKey("something_new")).toBe("catering.toast_link.error.generic");
    for (const r of TOAST_NO_RING_REASONS) expect([r, `catering.toast_link.reason.${r}` in e && `catering.toast_link.reason.${r}` in s]).toEqual([r, true]);
  });
});

describe("buildHouseToastPanel", () => {
  const plan = (o: Partial<CateringToastPlanRow>): CateringToastPlanRow => ({
    lead_id: LEAD, location_id: SHOP, order_guid: "o", check_guid: "c", toast_snapshot_id: U(50), business_date: "2026-11-20",
    evidence: "amount_date", check_total_cents: 30000, lead_value_cents: 30000, amount_diff_cents: 0, amount_mismatch: false,
    dual_code: false, owner: null, owner_lead_id: null, blocked: false, ...o,
  });
  const base = {
    status: { lead_id: LEAD, location_id: SHOP, event_date: "2026-11-20", ring_code: null, value_cents: 30000, status: "not_rung_in_toast" as const },
    canDecide: true, linkStep: "ready" as const,
  };
  it("fix round 1: an ended link is listed once, under `ended`, with its present owner; never as a link or a suggestion", () => {
    const row = { location_id: SHOP, order_guid: "a", check_guid: "1", evidence: "manual" as const, retired_reason: "lead_moved" as const,
      head_id: U(11), owner: "ezcater" as const, total_cents: 40000, business_date: "2026-11-20", live: true };
    const panel = buildHouseToastPanel({
      ...base,
      plan: [plan({ order_guid: "a", check_guid: "1", owner: "ezcater" }), plan({ order_guid: "b", check_guid: "1" })],
      heads: [{ id: U(11), kind: "link", location_id: SHOP, order_guid: "a", check_guid: "1", reason_code: null }],
      links: [],
      ended: [row, { ...row, order_guid: "x", location_id: U(3), owner: null }, { ...row, order_guid: "y", owner: null, live: false }, { ...row, order_guid: "w", owner: null }],
    });
    expect(panel.links).toEqual([]);
    expect(panel.ended.map((e) => [e.orderGuid, e.owner, e.reason, e.headId])).toEqual([["a", "ezcater", "lead_moved", U(11)], ["y", null, "lead_moved", U(11)], ["w", null, "lead_moved", U(11)]]);
    expect(panel.candidates.map((c) => c.orderGuid)).toEqual(["b"]);
    // Fix round 3: an ended link can always be dismissed ("not a match"); Relink only while nobody holds a live check.
    expect(panel.ended.map((e) => endedActions(e, panel))).toEqual([["not_a_match"], ["not_a_match"], ["link", "not_a_match"]]);
  });
  it("fix round 1: a holder that no longer owns (planner owner null) is an OPEN candidate with its actions", () => {
    // 0347's planner answers owner from catering_toast_house_owner: a lost / moved / ezCater holder is not an owner.
    const panel = buildHouseToastPanel({ ...base, plan: [plan({ order_guid: "a", check_guid: "1", owner: null, owner_lead_id: null })], heads: [], links: [] });
    expect(panel.candidates[0]).toMatchObject({ state: "open" });
    expect(candidateActions(panel.candidates[0]!, panel)).toEqual(["link", "not_a_match"]);
    // Fix round 3 (review PORTAL3-r3): a check another order holds is dismissible, never linkable; tombstoned too.
    expect(candidateActions({ ...panel.candidates[0]!, state: "owned_house", owner: "house" }, panel)).toEqual(["not_a_match"]);
    expect(candidateActions({ ...panel.candidates[0]!, state: "owned_ezcater", owner: "ezcater" }, panel)).toEqual(["not_a_match"]);
    expect(candidateActions({ ...panel.candidates[0]!, state: "blocked", owner: "ezcater" }, panel)).toEqual([]);
    expect(candidateActions({ ...panel.candidates[0]!, state: "blocked", owner: null }, panel)).toEqual(["link"]);
  });
  it("fix round 4 (review PORTAL3-r4 P3): Link and Relink come from the writer's refusals, in the writer's order", () => {
    const lead = { eventDate: "2026-11-20", leadHead: null };
    const check = { live: true, businessDate: "2026-11-20", owner: null };
    expect(linkRefusal(lead, check)).toBeNull();
    // The window is the day before the event to a week after, on calendar days (a month boundary included).
    expect(["2026-11-18", "2026-11-19", "2026-11-27", "2026-11-28"].map((d) => linkRefusal(lead, { ...check, businessDate: d })))
      .toEqual(["check_out_of_window", null, null, "check_out_of_window"]);
    expect(linkRefusal({ eventDate: "2026-11-28", leadHead: null }, { ...check, businessDate: "2026-12-05" })).toBeNull();
    expect(linkRefusal(lead, { ...check, owner: "ezcater" })).toBe("check_owned_by_ezcater");
    expect(linkRefusal(lead, { ...check, owner: "house" })).toBe("check_owned_by_house");
    expect(linkRefusal(lead, { ...check, live: false })).toBe("check_not_found");
    // The writer's order: no ring expected, then the check, then the window, then the owner.
    const noRing = { eventDate: "2026-11-20", leadHead: { kind: "no_ring_expected" as const } };
    expect(linkRefusal(noRing, { live: false, businessDate: null, owner: "ezcater" })).toBe("lead_no_ring_expected");
    expect(linkRefusal(lead, { live: false, businessDate: "2027-01-01", owner: "ezcater" })).toBe("check_not_found");
    expect(linkRefusal(lead, { live: true, businessDate: "2027-01-01", owner: "ezcater" })).toBe("check_out_of_window");
    // An ended link nobody holds: Relink, unless the order is marked no ring expected or the check left its window.
    const ended = { orderGuid: "a", checkGuid: "1", evidence: "manual" as const, reason: "lead_moved" as const, owner: null,
      totalCents: 1, businessDate: "2026-11-20", live: true, headId: U(11) };
    expect(endedActions(ended, lead)).toEqual(["link", "not_a_match"]);
    expect(endedActions(ended, noRing)).toEqual(["not_a_match"]);
    expect(endedActions(ended, { eventDate: "2026-12-25", leadHead: null })).toEqual(["not_a_match"]);
    // A tombstoned candidate outside the window (a Toast-origin check far from the event) offers nothing.
    const cand = { orderGuid: "a", checkGuid: "1", businessDate: "2026-12-25", evidence: "toast_origin" as const, checkTotalCents: 1,
      amountDiffCents: null, amountMismatch: false, state: "blocked" as const, blockedBy: "unlink" as const, headId: null, owner: null };
    expect(candidateActions(cand, lead)).toEqual([]);
    expect(candidateActions({ ...cand, state: "open", blockedBy: null }, lead)).toEqual(["not_a_match"]);
  });
  it("fix round 1: no decision control unless the link step (0347) is installed, whoever asks", () => {
    const off = buildHouseToastPanel({ ...base, linkStep: "not_installed", plan: [plan({})], heads: [], links: [] });
    expect(off).toMatchObject({ canDecide: false, linkStep: "not_installed", ended: [] });
    expect(off.candidates).toHaveLength(1);
    expect(buildHouseToastPanel({ ...base, plan: [], heads: [], links: [] })).toMatchObject({ canDecide: true, linkStep: "ready" });
    expect(buildHouseToastPanel({ ...base, canDecide: false, plan: [], heads: [], links: [] }).canDecide).toBe(false);
  });
  it("orders candidates like the suggestion, names each state, and carries each pair's head", () => {
    const panel = buildHouseToastPanel({
      ...base,
      plan: [
        plan({ order_guid: "a", check_guid: "1", evidence: "amount_date", amount_diff_cents: 500 }),
        plan({ order_guid: "b", check_guid: "1", evidence: "ring_code" }),
        plan({ order_guid: "c", check_guid: "1", owner: "ezcater" }),
        plan({ order_guid: "d", check_guid: "1", owner: "house", owner_lead_id: U(77) }),
        plan({ order_guid: "e", check_guid: "1", dual_code: true }),
        plan({ order_guid: "f", check_guid: "1", blocked: true }),
        plan({ lead_id: U(99), order_guid: "z", check_guid: "1" }),
      ],
      heads: [{ id: U(10), kind: "unlink", location_id: SHOP, order_guid: "f", check_guid: "1", reason_code: null }],
      links: [],
    });
    expect(panel.candidates.map((c) => [c.orderGuid, c.state])).toEqual([
      ["b", "open"], ["a", "open"], ["e", "dual_code"], ["c", "owned_ezcater"], ["d", "owned_house"], ["f", "blocked"],
    ]);
    expect(panel.candidates.find((c) => c.orderGuid === "f")).toMatchObject({ headId: U(10), blockedBy: "unlink" });
    expect(panel.candidates.find((c) => c.orderGuid === "a")?.headId).toBeNull();
    expect(panel.leadHead).toBeNull();
  });
  it("a linked check is listed under links, not candidates, with its head and its money", () => {
    const panel = buildHouseToastPanel({
      ...base,
      status: { ...base.status, status: "matched" },
      plan: [plan({ order_guid: "a", check_guid: "1", owner: "house", owner_lead_id: LEAD })],
      heads: [{ id: U(11), kind: "link", location_id: SHOP, order_guid: "a", check_guid: "1", reason_code: null },
        { id: U(12), kind: "no_ring_expected", location_id: null, order_guid: null, check_guid: null, reason_code: "comped" }],
      links: [{ location_id: SHOP, order_guid: "a", check_guid: "1", evidence: "manual", total_cents: 31000, business_date: "2026-11-20", live: true }],
    });
    expect(panel.candidates).toEqual([]);
    expect(panel.links).toEqual([{ locationId: SHOP, orderGuid: "a", checkGuid: "1", evidence: "manual", totalCents: 31000,
      businessDate: "2026-11-20", live: true, headId: U(11) }]);
    expect(panel.leadHead).toEqual({ id: U(12), kind: "no_ring_expected", reasonCode: "comped" });
    expect(panel.status).toBe("matched");
  });
});
