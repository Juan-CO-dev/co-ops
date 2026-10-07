import { describe, expect, it } from "vitest";
import {
  composeCateringSections,
  renderCateringDigest,
  summarizeCateringShop,
  type CateringFacts,
  type CateringLeadFact,
} from "@/lib/report-digests-compose";

const BASE = "https://ops.example.com";
const A = "loc-a";
const B = "loc-b";
const TODAY = "2026-10-07";
const YESTERDAY = "2026-10-06";
const TOMORROW = "2026-10-08";
const shops = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];

let n = 0;
function lead(over: Partial<CateringLeadFact>): CateringLeadFact {
  n += 1;
  return {
    id: `lead-${n}`, contactName: `Contact ${n}`, company: null, eventDate: null, timeWindow: null, headcount: null,
    stage: "inquiry", leadSource: "phone", locationId: A, createdDay: "2026-09-01", followUpDate: null, externalRef: null,
    isDelivery: false, valueCents: 0, dueCents: 0, prepLines: null, ...over,
  };
}
const empty = (leads: CateringLeadFact[] = []): CateringFacts =>
  ({ today: TODAY, leads, lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] });

describe("summary math (0195 split: completed vs confirmed)", () => {
  it("yesterday's orders split completed (earned) from confirmed/out (not yet completed)", () => {
    const f = empty([
      lead({ eventDate: YESTERDAY, stage: "completed", valueCents: 50000, headcount: 20 }),
      lead({ eventDate: YESTERDAY, stage: "out", valueCents: 30000, headcount: 10 }),
      lead({ eventDate: YESTERDAY, stage: "confirmed", valueCents: 12000 }),
      lead({ eventDate: YESTERDAY, stage: "lost", valueCents: 99999 }),
      lead({ eventDate: YESTERDAY, stage: "completed", valueCents: 7000, locationId: B }),
      lead({ eventDate: TODAY, stage: "confirmed" }),
      lead({ eventDate: TODAY, stage: "inquiry" }),
      lead({ eventDate: TOMORROW, stage: "out" }),
    ]);
    expect(summarizeCateringShop(f, A)).toEqual({
      locationId: A, ran: 3, guests: 30, completedCents: 50000, confirmedCents: 42000, today: 1, tomorrow: 1,
    });
    expect(summarizeCateringShop(f, B)).toMatchObject({ ran: 1, completedCents: 7000, confirmedCents: 0, guests: null });
  });

  it("an empty day is zeros, not a gap", () => {
    expect(summarizeCateringShop(empty(), A)).toEqual({ locationId: A, ran: 0, guests: null, completedCents: 0, confirmedCents: 0, today: 0, tomorrow: 0 });
  });
});

describe("composed sections", () => {
  const texts = (f: CateringFacts, lang: "en" | "es" = "en") =>
    composeCateringSections(f, { locations: shops, includeUnassigned: true }, lang, BASE).map((s) => [s.title, s.lines.map((l) => `${l.tone}|${l.label}|${l.text}|${l.href}`)] as const);

  it("a closed day says so explicitly, per shop: No catering yesterday / Nothing booked today", () => {
    const out = texts(empty());
    expect(out.map(([title]) => title)).toEqual([
      "Shop A · Yesterday (Tue, Oct 6)", "Shop A · Today (Wed, Oct 7)", "Shop A · Early tomorrow (Thu, Oct 8)", "Shop A · Needs action",
      "Shop B · Yesterday (Tue, Oct 6)", "Shop B · Today (Wed, Oct 7)", "Shop B · Early tomorrow (Thu, Oct 8)", "Shop B · Needs action",
    ]);
    expect(out[0]![1]).toEqual([
      `info|Yesterday|No catering yesterday|${BASE}/catering/pipeline`,
      `info|Inquiries|No new inquiries|${BASE}/catering/pipeline`,
    ]);
    expect(out[1]![1]).toEqual([`info|Today|Nothing booked today|${BASE}/catering/pipeline`]);
    expect(out[2]![1]).toEqual([`info|Tomorrow|Nothing booked tomorrow|${BASE}/catering/pipeline`]);
    expect(out[3]![1]).toEqual([`ok|Needs action|Nothing needs action|${BASE}/catering/pipeline`]);
  });

  it("Spanish recipients get the Spanish empty states", () => {
    const out = texts(empty(), "es");
    expect(out[0]![1][0]).toContain("Ayer no hubo catering");
    expect(out[1]![1][0]).toContain("Nada reservado para hoy");
  });

  it("yesterday: summary, per-order status, lost, inquiries by source, ezCater/Toast lines, quotes, refunds, overdue follow-ups", () => {
    const done = lead({ contactName: "Ana", eventDate: YESTERDAY, stage: "completed", valueCents: 50000, headcount: 20, timeWindow: "11:30" });
    const notDone = lead({ contactName: "Bo Li", company: "Acme", eventDate: YESTERDAY, stage: "out", valueCents: 30000 });
    const lost = lead({ contactName: "Cy", stage: "lost" });
    const ez = lead({ contactName: "Dee", leadSource: "ezcater", externalRef: "EZ-77", createdDay: YESTERDAY, stage: "confirmed", eventDate: TOMORROW });
    const web = lead({ contactName: "Eve", leadSource: "portal", createdDay: YESTERDAY, followUpDate: "2026-10-01", stage: "quote_sent" });
    const f: CateringFacts = {
      ...empty([done, notDone, lost, ez, web]), lostYesterdayIds: [lost.id],
      quotesSentYesterday: [{ id: "q1", locationId: A, totalCents: 25000 }, { id: "q2", locationId: B, totalCents: 1 }],
      refundsYesterday: [{ locationId: A, amountCents: 4000 }],
    };
    const y = texts(f)[0]![1];
    expect(y[0]).toBe(`issue|Yesterday|2 orders ran · 20 guests · completed $500.00 · confirmed, not completed $300.00|${BASE}/catering/pipeline`);
    expect(y[1]).toBe(`ok|Ana|11:30 · 20 guests · $500.00 · Fulfilled|${BASE}/catering/pipeline?q=Ana`);
    expect(y[2]).toBe(`issue|Bo Li (Acme)|time not set · size not set · $300.00 · Not marked completed|${BASE}/catering/pipeline?q=Bo%20Li`);
    expect(y[3]).toBe(`issue|Cy|Lost / cancelled|${BASE}/catering/pipeline?q=Cy`);
    expect(y[4]).toBe(`info|Inquiries|2 new (EZCater 1, Online portal 1)|${BASE}/catering/pipeline`);
    expect(y[5]).toBe(`info|Quotes|1 quotes sent ($250.00)|${BASE}/catering/quotes`);
    expect(y[6]).toBe(`info|EZCater|Order EZ-77: Dee|${BASE}/catering/pipeline?q=Dee`);
    expect(y[7]).toBe(`issue|Issues|1 refunds ($40.00)|${BASE}/catering/pipeline`);
    expect(y[8]).toBe(`issue|Issues|1 follow-ups overdue|${BASE}/catering/pipeline`);
  });

  it("today and early tomorrow: time, size, pickup/delivery, prep load; then what needs action", () => {
    const f: CateringFacts = {
      ...empty([
        lead({ contactName: "Late", eventDate: TODAY, stage: "confirmed", timeWindow: "17:00", headcount: 40, isDelivery: true, prepLines: 6 }),
        lead({ contactName: "Early", eventDate: TODAY, stage: "out", timeWindow: "08:00", headcount: 12, dueCents: 15000 }),
        lead({ contactName: "Tmrw", eventDate: TOMORROW, stage: "confirmed", headcount: 25, isDelivery: true }),
        lead({ contactName: "Maybe", eventDate: TOMORROW, stage: "quote_sent" }),
        lead({ contactName: "Far", eventDate: "2026-10-20", stage: "inquiry" }),
      ]),
      openQuotes: [{ id: "q", locationId: A }, { id: "q2", locationId: A }],
    };
    const out = texts(f);
    expect(out[1]![1]).toEqual([
      `info|Early|08:00 · 12 guests · Pickup · no prep ledger|${BASE}/catering/pipeline?q=Early`,
      `info|Late|17:00 · 40 guests · Delivery · 6 prep lines on the ledger|${BASE}/catering/pipeline?q=Late`,
    ]);
    expect(out[2]![1]).toEqual([`info|Tmrw|time not set · 25 guests · Delivery · no prep ledger|${BASE}/catering/pipeline?q=Tmrw`]);
    expect(out[3]![1]).toEqual([
      `issue|Maybe|Unconfirmed (Thu, Oct 8)|${BASE}/catering/pipeline?q=Maybe`,
      `issue|Early|Unpaid $150.00 (Wed, Oct 7)|${BASE}/catering/pipeline?q=Early`,
      `info|Quotes|2 open quotes awaiting the customer|${BASE}/catering/quotes`,
    ]);
  });

  it("leads with no shop show only to all-shop recipients", () => {
    const f = empty([lead({ locationId: null, eventDate: TODAY, stage: "confirmed", contactName: "Nowhere" })]);
    const all = composeCateringSections(f, { locations: shops, includeUnassigned: true }, "en", BASE);
    const scoped = composeCateringSections(f, { locations: [shops[0]!], includeUnassigned: false }, "en", BASE);
    expect(all.some((s) => s.title.startsWith("No shop set"))).toBe(true);
    expect(scoped.some((s) => s.title.startsWith("No shop set"))).toBe(false);
    expect(scoped).toHaveLength(4);
  });

  it("a GM's digest covers only their shop", () => {
    const f = empty([lead({ locationId: B, eventDate: TODAY, stage: "confirmed", contactName: "OtherShop" })]);
    const mail = renderCateringDigest(f, { locations: [shops[0]!], includeUnassigned: false }, { language: "en", baseUrl: BASE });
    expect(mail.text).not.toContain("OtherShop");
    expect(mail.text).toContain("Nothing booked today");
    expect(mail.subject).toBe("Catering — Wed, Oct 7: 0 yesterday, 0 today");
  });
});
