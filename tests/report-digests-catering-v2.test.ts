import { describe, expect, it } from "vitest";
import {
  countAnchoredBalances,
  firstName,
  paymentState,
  readinessFrom,
  specialInstructions,
  stationRoster,
} from "@/lib/report-digests-catering-shared";
import { composeCateringSections, type CateringFacts, type CateringLeadFact } from "@/lib/report-digests-compose";
import { resolveDigestRecipients, type DigestDirectory } from "@/lib/report-digests-shared";
import type { StationEvent } from "@/lib/assignments-shared";

const BASE = "https://ops.example.com";
const A = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-10-08";

describe("logistics helpers", () => {
  it("special instructions come from the machine lines only (Toast + ezCater), deduplicated", () => {
    const notes = [
      "Please call Dana before noon — private human note",
      "Toast order abc — Catering · order — auto-created from the catering scan.",
      'Special request: "No onions on the Italians"',
      '• 2× Crunchy Boi [Extra chips x1] — "Cut in half"',
      "• 1× Italian",
      'Special request: "No onions on the Italians"',
    ].join("\n");
    expect(specialInstructions(notes)).toEqual(["No onions on the Italians", "Cut in half"]);
    expect(specialInstructions(null)).toEqual([]);
  });

  it("payment status: platform orders are paid on the platform; due beats paid; nothing recorded is said", () => {
    expect(paymentState("ezcater", [])).toEqual({ kind: "platform" });
    expect(paymentState("phone", [{ status: "paid", amountCents: 5000 }, { status: "due", amountCents: 2500 }])).toEqual({ kind: "due", cents: 2500 });
    expect(paymentState("phone", [{ status: "paid", amountCents: 5000 }])).toEqual({ kind: "paid", cents: 5000 });
    expect(paymentState("phone", [])).toEqual({ kind: "none" });
  });

  it("readiness reads ONLY a census-anchored oz balance; anything else is not counted yet", () => {
    const balances = countAnchoredBalances([
      { skuId: "ham", dimension: "weight", anchorSource: "census", onHandOz: 20 },
      { skuId: "rolls", dimension: "weight", anchorSource: "census", onHandOz: 100 },
      { skuId: "mayo", dimension: "weight", anchorSource: "inferred", onHandOz: 50 },
      { skuId: "cups", dimension: "count", anchorSource: "census" },
      { skuId: "tuna", dimension: "weight", anchorSource: "census", onHandOz: null },
    ]);
    expect([...balances]).toEqual([["ham", 20], ["rolls", 100]]);
    const r = readinessFrom({
      rows: [
        { skuId: "ham", skuName: "Ham", totalOz: 64, contentOz: 32 },
        { skuId: "rolls", skuName: "Rolls", totalOz: 30, contentOz: null },
        { skuId: "mayo", skuName: "Mayo", totalOz: 8, contentOz: 128 },
      ],
      unresolvedChoiceLines: 1, noRecipeLines: 2,
    }, balances);
    expect(r.rows).toEqual([
      { skuName: "Ham", needOz: 64, onHandOz: 20, shortOz: 44, orderPacks: 2, counted: true },
      { skuName: "Mayo", needOz: 8, onHandOz: null, shortOz: null, orderPacks: null, counted: false },
      { skuName: "Rolls", needOz: 30, onHandOz: 100, shortOz: 0, orderPacks: null, counted: true },
    ]);
  });

  it("regression (Astra r2): 10 cases received and 64 oz used is a count-anchored oz balance, never -54 'packs'", () => {
    // The W4b stock side subtracted entered oz from received packs: 10 - 64 = -54. Readiness no
    // longer reads it at all; the counts reader's balance is in oz: counted 0 + 10 cases x 16 oz - 64 oz.
    const w4bRowWithBogusStock = { skuId: "ham", skuName: "Ham", totalOz: 40, contentOz: 16, onHandPacks: -54, onHandOz: -864, shortfallOz: 904, suggestOrderPacks: 57 };
    const balances = countAnchoredBalances([{ skuId: "ham", dimension: "weight", anchorSource: "census", onHandOz: 0 + 10 * 16 - 64 }]);
    const r = readinessFrom({ rows: [w4bRowWithBogusStock], unresolvedChoiceLines: 0, noRecipeLines: 0 }, balances);
    expect(r.rows[0]).toEqual({ skuName: "Ham", needOz: 40, onHandOz: 96, shortOz: 0, orderPacks: null, counted: true });
  });

  it("the station roster is the latest event per person; a release takes them off", () => {
    const ev = (seq: number, userId: string, stationId: string | null, source: StationEvent["source"]): StationEvent =>
      ({ id: `e${seq}`, sequence: String(seq), locationId: A, businessDate: TODAY, userId, stationId, kind: stationId ? "assign" : "release", actorId: "m", actorName: null, at: `2026-10-08T1${seq}:00:00Z`, source });
    const roster = stationRoster(
      [ev(3, "u1", "s2", "assigned"), ev(1, "u1", "s1", "claimed"), ev(2, "u2", "s1", "claimed"), ev(4, "u3", "s1", "assigned"), ev(5, "u3", null, null)],
      new Map([["u1", "Ana María López"], ["u2", "Luis Pérez"], ["u3", "Kim"]]),
      new Map([["s1", "Grill"], ["s2", "Line"]]),
    );
    expect(roster).toEqual([{ firstName: "Luis", station: "Grill", source: "claimed" }, { firstName: "Ana", station: "Line", source: "assigned" }]);
    expect(firstName("  Pete  O ")).toBe("Pete");
  });
});

const lead = (over: Partial<CateringLeadFact>): CateringLeadFact => ({
  id: Math.random().toString(36).slice(2), contactName: "X", company: null, eventDate: TODAY, timeWindow: null, headcount: null,
  stage: "confirmed", leadSource: "phone", locationId: A, createdDay: "2026-09-01", followUpDate: null, externalRef: null,
  isDelivery: false, valueCents: 0, dueCents: 0, prep: null, ...over,
});
const facts = (leads: CateringLeadFact[], extra: Partial<CateringFacts> = {}): CateringFacts =>
  ({ today: TODAY, leads, lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [], ...extra });
const todayLines = (f: CateringFacts, showAddresses: boolean, language: "en" | "es" = "en") =>
  composeCateringSections(f, { locations: [{ id: A, name: "Shop A" }], includeUnassigned: false, showAddresses }, language, BASE)[1]!.lines.map((l) => `${l.tone}|${l.label}|${l.text}`);

describe("catering morning digest: today's orders", () => {
  const f = facts([
    lead({ contactName: "Late Co", timeWindow: "13:00", headcount: 40, isDelivery: true, deliveryAddress: "1200 First St NE", payment: { kind: "due", cents: 15000 }, instructions: ["Cut in half"] }),
    lead({ contactName: "EZCater order VPCTM5", leadSource: "ezcater", timeWindow: "10:45 AM", headcount: 25, payment: { kind: "platform" } }),
  ], {
    readiness: { [A]: { kind: "ok", value: {
      rows: [
        { skuName: "Ham", needOz: 64, onHandOz: 20, shortOz: 44, orderPacks: 2, counted: true },
        { skuName: "Mayo", needOz: 8, onHandOz: null, shortOz: null, orderPacks: null, counted: false },
        { skuName: "Rolls", needOz: 30, onHandOz: 100, shortOz: 0, orderPacks: null, counted: true },
      ],
      unresolvedChoiceLines: 1, noRecipeLines: 0,
    } } },
    staff: { [A]: { kind: "ok", value: { source: "stations", scheduleConnected: false, onStation: [{ firstName: "Luis", station: "Grill", source: "claimed" }] } } },
  });

  it("earliest ready-by first, with logistics, payment and instructions; the address only for the catering manager / level 8+", () => {
    const shown = todayLines(f, true);
    expect(shown.slice(0, 2)).toEqual([
      "info|ezCater #VPCTM5|ready by 10:45 AM · 25 guests · Pickup · paid on the platform",
      'issue|Late Co|ready by 1:00 PM · 40 guests · Delivery · 1200 First St NE · $150.00 due · notes: "Cut in half"',
    ]);
    const hidden = todayLines(f, false);
    expect(hidden.join("\n")).not.toContain("1200 First St NE");
    expect(hidden[1]).toBe('issue|Late Co|ready by 1:00 PM · 40 guests · Delivery · $150.00 due · notes: "Cut in half"');
  });

  it("inventory readiness: shortfalls highlighted, uncounted SKUs say so, covered rolled up, unchecked lines disclosed", () => {
    const lines = todayLines(f, false);
    expect(lines).toContain("issue|Ham|need 64 oz · on hand 20 oz · short 44 oz · order 2 packs");
    expect(lines).toContain("info|Mayo|need 8 oz · on hand not counted yet");
    expect(lines).toContain("ok|Inventory for today|1 ingredient covered");
    expect(lines).toContain("info|Inventory for today|1 order line cannot be checked (no recipe, or a customer choice)");
  });

  it("staff: today's stations, and the schedule is said to be not connected", () => {
    expect(todayLines(f, false)).toContain("info|Staff today|Luis (Grill) · schedule not connected");
    const none = facts([lead({})], { staff: { [A]: { kind: "ok", value: { source: "stations", scheduleConnected: false, onStation: [] } } } });
    expect(todayLines(none, false)).toContain("info|Staff today|No station assignments yet · schedule not connected");
    expect(todayLines(none, false, "es")).toContain("info|Personal hoy|Aún sin asignaciones de estación · horario no conectado");
  });

  it("a failed readiness / staff read is said; no orders today = no readiness or staff lines at all", () => {
    const failedF = facts([lead({})], { readiness: { [A]: { kind: "error" } }, staff: { [A]: { kind: "error" } } });
    expect(todayLines(failedF, false)).toEqual(expect.arrayContaining([
      "issue|Inventory for today|Could not load — check the app", "issue|Staff today|Could not load — check the app",
    ]));
    expect(todayLines(facts([]), false)).toEqual(["info|Today|Nothing booked today"]);
  });
});

describe("address access is decided by role at resolution time", () => {
  const dir: DigestDirectory = {
    users: [
      { id: "gm", name: "Alex", email: "alex@x.test", role: "gm", language: "en", active: true },
      { id: "keith", name: "Keith", email: "keith@x.test", role: "catering_mgr", language: "en", active: true },
      { id: "pete", name: "Pete", email: "pete@x.test", role: "owner", language: "en", active: true },
    ],
    memberships: [{ userId: "gm", locationId: A }, { userId: "gm", locationId: "B" }],
    overrides: [], locationIds: [A, "B"],
  };
  it("catering manager and level 8+ see addresses; a GM (even of every shop) does not", () => {
    const r = resolveDigestRecipients("catering", dir);
    expect(Object.fromEntries(r.map((x) => [x.userId, x.addressAccess === true]))).toEqual({ gm: false, keith: true, pete: true });
    expect(r.find((x) => x.userId === "gm")!.allShops).toBe(true);
  });
});
