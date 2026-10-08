import { describe, expect, it } from "vitest";
import { composeCateringSections, type CateringFacts } from "@/lib/report-digests-compose";
import { composeV2Sections } from "@/lib/report-digests-v2-compose";
import { toastRingLines } from "@/lib/report-digests-toast-shared";
import type { NotInToastOrder } from "@/lib/catering/not-in-toast-shared";
import { v2Fixture } from "./fixtures/digest-v2";

const BASE = "https://ops.example.test";
const order = (over: Partial<NotInToastOrder> = {}): NotInToastOrder => ({
  order_id: "order-a", lead_id: null, location_id: "a", event_date: "2026-10-08", order_number: "CODE-A",
  handoff_time: "2026-10-08T15:30:00Z", event_timestamp: null, headcount: 12, total_cents: 12345, ...over,
});
const facts = (rows: NotInToastOrder[]): CateringFacts => ({
  today: "2026-10-08", leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [], toRingInToast: rows,
});
const scope = { locations: [{ id: "a", name: "Shop A" }], includeUnassigned: false };
const extras = { operations: [], pmLine: null, pendingItems: 0, who: { openedBy: null, closedBy: null, openingHref: BASE, closingHref: BASE } };

describe("Toast ring digest reminders", () => {
  it.each(["en", "es"] as const)("morning includes only this shop and today's orders in %s", (language) => {
    const sections = composeCateringSections(facts([order(), order({ order_number: "OTHER-SHOP", location_id: "b" }), order({ order_number: "OTHER-DAY", event_date: "2026-10-09" })]), scope, language, BASE);
    const section = sections.find((s) => s.title.includes(language === "en" ? "To ring into Toast" : "Por registrar en Toast"));
    expect(section?.lines).toHaveLength(1);
    expect(section?.lines[0]).toMatchObject({ label: "CODE-A", href: `${BASE}/catering/pipeline` });
    expect(section?.lines[0]?.text).toContain("11:30");
    expect(section?.lines[0]?.text).toContain(language === "en" ? "12 guests" : "12 invitados");
    expect(section?.lines[0]?.text).toContain("123.45");
    expect(JSON.stringify(sections)).not.toMatch(/OTHER-SHOP|OTHER-DAY/);
  });

  it.each(["en", "es"] as const)("nightly D+1 block is scoped and disappears when linking removes the order (%s)", (language) => {
    const compose = (rows: NotInToastOrder[]) => composeV2Sections({
      shopName: "Shop A", locationId: "a", day: "2026-10-07", prefix: false, extras,
      v: v2Fixture({ catering: { kind: "ok", value: { day: { orders: 0, completedCents: 0, confirmedCents: 0 }, tomorrow: [], toRingInToast: rows } } }),
    }, language, BASE);
    const title = language === "en" ? "Ring into Toast tomorrow" : "Registra en Toast mañana";
    expect(compose([order(), order({ location_id: "b" }), order({ event_date: "2026-10-07" })]).find((s) => s.title === title)?.lines).toHaveLength(1);
    expect(compose([]).some((s) => s.title === title)).toBe(false);
    expect(composeCateringSections(facts([]), scope, language, BASE).some((s) => /To ring|Por registrar/.test(s.title))).toBe(false);
  });

  it.each(["en", "es"] as const)("unknown logistics remain explicitly unknown (%s)", (language) => {
    const line = toastRingLines([order({ handoff_time: null, headcount: null, total_cents: null, order_number: null })], "a", "2026-10-08", language, BASE)[0]!;
    expect(line.label).toContain(language === "en" ? "not available" : "no disponible");
    expect(line.text).toContain(language === "en" ? "Ready time not available" : "Hora de entrega no disponible");
    expect(line.text).toContain(language === "en" ? "Guest count not available" : "Número de invitados no disponible");
    expect(line.text).toContain(language === "en" ? "Amount not available" : "Importe no disponible");
    expect(line.text).not.toContain("$0");
  });
});
